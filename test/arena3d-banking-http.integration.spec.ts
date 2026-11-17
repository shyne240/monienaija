/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { makeCustomerFinanciallyEligible } from './support/kyc-test-fixtures';
import { createIntegrationDataSource, truncateAllTables } from './support/pg-harness';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

function encodePbkdf2(password: string, saltStr = 'a3d-banking-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * ARENA 3D — banking HTTP acceptance against real PostgreSQL and the real application.
 *
 * This suite exists to prove the properties that a service-level test cannot: that the routes are
 * reachable, that authentication and audience separation actually happen at the HTTP boundary, that a
 * customer cannot address another customer's data by changing a URL, and that the responses never
 * claim money moved when nothing did.
 *
 * Every assertion here is about refusal or honesty. Banking is deliberately disabled in this
 * deployment, so the correct behaviour of every capability route is to refuse with a state — not to
 * invent an account number, a balance or a receipt.
 */
describe('ARENA 3D banking HTTP acceptance (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a3dbankinghttp');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /** A real institution row: `banking_outbound_operations.institution_id` is NOT NULL and enforced. */
  async function createInstitution(): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO financial_institutions (reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,'Banking HTTP institution','PARTNER','fixture') RETURNING id`,
      [`A3DHTTP-${suffix}`, `A3DHTTP_${suffix}`],
    );
    return rows[0]!.id;
  }

  /** Creates an ACTIVE, financially eligible customer with a wallet, and returns a real session token. */
  async function customerWithWallet(options: { institutionId?: string } = {}): Promise<{
    customerId: string;
    walletId: string;
    token: string;
  }> {
    const reference = `cust-a3d-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Banking Customer',true)`,
      [customerId],
    );
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
         (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status,
          account_locked, failed_authentication_count, version)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, encodePbkdf2('banking-password-a3d')],
    );
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);

    // A wallet requires a real ledger account (referential integrity is part of what this suite
    // proves, so the constraint is satisfied rather than relaxed).
    const ledger: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Banking HTTP fixture','LIABILITY','CREDIT','NGN') RETURNING id`,
      [randomUUID(), `A3DHTTP_${randomUUID()}`],
    );
    const wallet: Array<{ id: string }> = await dataSource.query(
      // `customer_id` is the VARCHAR owner reference and must be classified CUSTOMER: a wallet
      // written without this is owner_class='REVIEW' by default and is deliberately not treated as
      // belonging to anybody.
      `INSERT INTO wallet_accounts
         (id, customer_id, institution_id, currency, status, ledger_account_id, owner_class)
       VALUES ($1,$2,$3,'NGN','ACTIVE',$4,'CUSTOMER') RETURNING id`,
      [randomUUID(), customerId, options.institutionId ?? null, ledger[0]!.id],
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password: 'banking-password-a3d' })
      .expect(200);
    return { customerId, walletId: wallet[0]!.id, token: login.body.accessToken as string };
  }

  describe('authentication and audience separation', () => {
    it('refuses every banking route without a session', async () => {
      const walletId = randomUUID();
      const routes: Array<[string, 'get' | 'post']> = [
        [`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`, 'get'],
        [`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`, 'post'],
        ['/api/v1/customers/me/banking/deposits', 'get'],
        ['/api/v1/customers/me/banking/transfers/OPABCDEF123456', 'get'],
        ['/api/v1/internal/banking/providers?institutionId=' + randomUUID(), 'get'],
        ['/api/v1/internal/banking/capabilities', 'get'],
      ];
      for (const [path, method] of routes) {
        const res = await (method === 'get'
          ? request(app.getHttpServer()).get(path)
          : request(app.getHttpServer()).post(path).send({}));
        // 401 is the only acceptable answer: these are not public routes and must not be.
        expect(res.status).toBe(401);
      }
    });

    it('refuses the administrative surface to a customer session', async () => {
      const { token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/banking/providers?institutionId=${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`);
      // A customer bearer token must never reach a workforce surface.
      expect([401, 403]).toContain(res.status);
    });

    it('publishes no banking route as public', async () => {
      // The webhook is authenticated by HMAC, not by being public: an unauthenticated webhook must be
      // rejected, which is impossible if the route skips the guard entirely.
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks/monnify')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION' }));
      expect(res.status).toBe(401);
    });
  });

  describe('customer receiving account', () => {
    it('reports NOT_PROVISIONED with no account number rather than inventing one', async () => {
      const { walletId, token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        state: 'NOT_PROVISIONED',
        accountNumber: null,
        bankName: null,
        accountName: null,
      });
    });

    it('does not confirm another customer wallet exists', async () => {
      const alice = await customerWithWallet();
      const bob = await customerWithWallet();
      // Alice asks about Bob's wallet. The answer must be indistinguishable from a nonexistent wallet.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/me/banking/virtual-account?walletId=${bob.walletId}`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(res.status).toBe(404);
      const missing = await request(app.getHttpServer())
        .get(`/api/v1/customers/me/banking/virtual-account?walletId=${randomUUID()}`)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(missing.status).toBe(404);
      // Same status and same body shape: no existence oracle.
      expect(res.body.message).toBe(missing.body.message);
    });

    it('refuses provisioning when the wallet has no institution, with no account number', async () => {
      const { walletId, token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(/\d{10}/);
    });

    it('rejects a malformed wallet identifier before any data access', async () => {
      const { token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/me/banking/virtual-account?walletId=../../etc/passwd')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('history and transfer status', () => {
    it('returns an empty deposit history rather than a fabricated balance', async () => {
      const { token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/me/banking/deposits')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 for a transfer reference that does not belong to the caller', async () => {
      const { token } = await customerWithWallet();
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/me/banking/transfers/OPDOESNOTEXIST123')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('presents an unknown transfer as CONFIRMING, never as failed', async () => {
      const { customerId, walletId, token } = await customerWithWallet();
      // A transfer whose provider outcome is not yet known. The customer must be told it is being
      // confirmed; "failed" would invite them to send the money again.
      await dataSource.query(
        `INSERT INTO banking_outbound_operations
           (institution_id, provider_key, environment, operation_reference, external_operation_id,
            wallet_id, currency, amount_minor, destination_bank_code, destination_account_number,
            state)
         VALUES ($3, 'MONNIFY', 'sandbox', 'OPTESTUNKNOWN01', $1, $2, 'NGN', 50000, '058', '0123456789', 'UNKNOWN')`,
        [randomUUID(), walletId, await createInstitution()],
      );
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/me/banking/transfers/OPTESTUNKNOWN01')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        state: 'CONFIRMING',
        amountMinor: '50000',
        // Only the last four digits are served back, never the full destination account.
        accountNumberLast4: '6789',
      });
      expect(JSON.stringify(res.body)).not.toContain('0123456789');
      expect(res.body).not.toHaveProperty('institutionId');
      expect(customerId).toBeTruthy();
    });

    it('does not expose another customer transfer', async () => {
      const alice = await customerWithWallet();
      const bob = await customerWithWallet();
      await dataSource.query(
        `INSERT INTO banking_outbound_operations
           (institution_id, provider_key, environment, operation_reference, external_operation_id,
            wallet_id, currency, amount_minor, destination_bank_code, destination_account_number,
            state, resolved_at)
         VALUES ($3, 'MONNIFY', 'sandbox', 'OPBOBSECRET01', $1, $2, 'NGN', 90000, '058', '9988776655',
                 'SUCCESSFUL', now())`,
        [randomUUID(), bob.walletId, await createInstitution()],
      );
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/me/banking/transfers/OPBOBSECRET01')
        .set('Authorization', `Bearer ${alice.token}`);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('99000');
      expect(JSON.stringify(res.body)).not.toContain('9988776655');
    });
  });

  describe('provider webhook', () => {
    it('rejects a body with no signature without persisting anything', async () => {
      const before = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM inbound_funding_observations',
      );
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks/monnify')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { amountPaid: 1000 } }),
        );
      // Banking is not configured here, so there is no client secret to verify against. The route
      // refuses before the handler runs; 401 (unverifiable) and 503 (ingress unconfigured) are both
      // honest refusals, and neither acknowledges the event.
      expect([401, 403, 503]).toContain(res.status);
      const after = await dataSource.query<Array<{ count: string }>>(
        'SELECT count(*)::text AS count FROM inbound_funding_observations',
      );
      expect(after[0]!.count).toBe(before[0]!.count);
    });

    it('does not acknowledge an unsigned webhook as accepted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/webhooks/monnify')
        .set('Content-Type', 'application/json')
        .set('monnify-signature', 'definitely-not-a-valid-signature')
        .send(
          JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { amountPaid: 1000 } }),
        );
      expect(res.status).not.toBe(200);
      expect(res.body).not.toMatchObject({ received: true });
    });
  });
});
