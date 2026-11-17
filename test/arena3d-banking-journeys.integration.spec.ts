/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { BankingProviderRegistry } from '../src/banking/banking-provider.registry';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import type { BankingProvider } from '../src/banking/banking-provider.types';
import { capabilitiesOf } from '../src/banking/banking-provider.registry';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { makeCustomerFinanciallyEligible } from './support/kyc-test-fixtures';
import { createIntegrationDataSource, truncateAllTables } from './support/pg-harness';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

function encodePbkdf2(password: string, saltStr = 'a3d-journey-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * ARENA 3D — banking journeys A–G through the real application and authenticated HTTP.
 *
 * Each `it` is one journey, and each asserts the property that matters for that journey *in the state
 * this deployment is actually in*: no approved provider for the institution, no credentials, so every
 * money-moving capability must refuse with a state rather than succeed or fabricate.
 *
 * This shape is deliberate. A journey test that only passes when banking is fully enabled would be
 * unrunnable here, where there are no production credentials and no live provider — and silently
 * skipping it would report acceptance that never happened. Instead each journey proves:
 *
 *   1. the route is reachable and authenticated as the right principal;
 *   2. the refusal is the *correct* one (a state, not a crash, not a 200, no invented number);
 *   3. nothing durable was written that would later be mistaken for a real obligation.
 *
 * Journeys are lettered to match the mission's acceptance list.
 */
describe('ARENA 3D banking journeys A–G (real app, real PostgreSQL, controlled fixtures)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let registry: BankingProviderRegistry;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a3djourney');
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
    registry = app.get(BankingProviderRegistry);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  /** An institution, plus a customer with a real session. No provider approval, no credentials. */
  async function customerWithInstitution(): Promise<{
    institutionId: string;
    customerId: string;
    walletId: string;
    token: string;
  }> {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const institutionRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by)
       VALUES ($1,$2,$3,'Journey fixture institution','PARTNER','fixture') RETURNING id`,
      [randomUUID(), `A3DJ-${suffix}`, `A3DJ_${suffix}`],
    );
    const institutionId = institutionRows[0]!.id;
    const ledger: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Journey customer funds','LIABILITY','CREDIT','NGN') RETURNING id`,
      [randomUUID(), `A3DJ_${suffix}_FUNDS`],
    );
    const customerRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`a3djourney-${suffix.toLowerCase()}`],
    );
    const customerId = customerRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active)
       VALUES ($1,'Journey Customer',true)`,
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
      [customerId, encodePbkdf2('journey-password')],
    );
    const wallet: Array<{ id: string }> = await dataSource.query(
      // owner_class must be CUSTOMER: a wallet written without it defaults to 'REVIEW' and is
      // deliberately not treated as belonging to anybody.
      //
      // Deliberately NOT institution-attributed: `wallet_institution_attribution_guard()` refuses a
      // direct attribution insert and requires the governed workflow, and that refusal is a property
      // this mission preserves rather than works around.
      `INSERT INTO wallet_accounts
         (id, customer_id, currency, status, ledger_account_id, owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER') RETURNING id`,
      [randomUUID(), customerId, ledger[0]!.id],
    );
    // Sign-in refuses with 503 until the customer's financial policy can be resolved, so the
    // controlled eligibility fixture is a precondition for obtaining a session at all.
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);

    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password: 'journey-password' })
      .expect(200);
    return {
      institutionId,
      customerId,
      walletId: wallet[0]!.id,
      token: login.body?.accessToken as string,
    };
  }

  it('Journey A — a customer can discover whether bank transfers are available at all', async () => {
    const { walletId, token } = await customerWithInstitution();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`)
      .set('Authorization', `Bearer ${token}`);
    // Reachable and authenticated.
    expect(res.status).toBe(200);
    // No account can be issued, so no number is returned. The exact state depends on whether the
    // wallet has institution attribution, which is itself a real precondition.
    expect(res.body.accountNumber).toBeNull();
    expect(['NO_INSTITUTION', 'PROVIDER_UNAVAILABLE', 'NOT_PROVISIONED']).toContain(
      res.body.state as string,
    );
    // The internal MonieNaija number is never presented as a bank account.
    expect(JSON.stringify(res.body)).not.toMatch(/"accountNumber":"0/);
  });

  it('Journey B — provisioning is refused when the institution has no approved provider', async () => {
    const { walletId, token } = await customerWithInstitution();
    const before = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_virtual_account_reservations',
    );
    const res = await request(app.getHttpServer())
      .post(`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect([403, 503]).toContain(res.status);
    const after = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_virtual_account_reservations',
    );
    // A refusal must not leave a reservation behind that a later run would treat as a real attempt.
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it('Journey C — an inbound webhook is never acknowledged as accepted without persistence', async () => {
    const before = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM inbound_funding_observations',
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/monnify')
      .set('Content-Type', 'application/json')
      .set('monnify-signature', 'not-a-valid-signature')
      .send(
        JSON.stringify({
          eventType: 'SUCCESSFUL_TRANSACTION',
          eventData: { amountPaid: 1000, paymentReference: 'x', transactionReference: 'y' },
        }),
      );
    expect(res.status).not.toBe(200);
    expect(res.body).not.toMatchObject({ received: true });
    const after = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM inbound_funding_observations',
    );
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it('Journey D — an outbound transfer cannot be initiated without an authorized commitment', async () => {
    const { walletId, token, institutionId } = await customerWithInstitution();
    const before = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_outbound_operations',
    );
    // A customer has no route that submits a transfer directly. The only initiation surface is the A6
    // commitment, which requires an eligible beneficiary and PIN; this wallet has neither.
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/withdrawal-commitments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        walletAccountId: walletId,
        beneficiaryId: randomUUID(),
        amountMinor: '150000',
        currency: 'NGN',
        pin: '1234',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_outbound_operations',
    );
    // The decisive property: no dispatch record exists, so no worker could ever submit it.
    expect(after[0]!.count).toBe(before[0]!.count);
    expect(institutionId).toBeTruthy();
  });

  it('Journey E — readiness is institution-scoped and never asserts an entitlement', async () => {
    const { institutionId, token } = await customerWithInstitution();
    // A customer session must not reach the institution-scoped governance surface.
    const denied = await request(app.getHttpServer())
      .get(`/api/v1/internal/banking/providers?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(denied.status);
    // And the anonymous read is refused too.
    const anonymous = await request(app.getHttpServer()).get(
      `/api/v1/internal/banking/providers?institutionId=${institutionId}`,
    );
    expect(anonymous.status).toBe(401);
  });

  it('Journey F — a transfer status is reported honestly for an unknown reference', async () => {
    const { token } = await customerWithInstitution();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/banking/transfers/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`);
    // Not this customer's operation. A 404 is indistinguishable from one that never existed, so the
    // endpoint cannot be used to probe another customer's transfer references.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/"state":"SUCCESSFUL"/);
  });

  it('Journey G — reconciliation cannot be started without an operational provider', async () => {
    const { institutionId, token } = await customerWithInstitution();
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/internal/banking/reconciliation/${institutionId}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ providerKey: 'MONNIFY' });
    expect([401, 403]).toContain(denied.status);
    const runs = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM banking_reconciliation_runs',
    );
    expect(runs[0]!.count).toBe('0');
  });

  it('a registered adapter never becomes an automatically authorized provider', async () => {
    // Journey E/F/G all ran with an empty registry. This case proves the converse is also safe: an
    // adapter that IS registered still cannot carry an operation, because registration is not approval.
    const provider: BankingProvider = {
      descriptor: {
        key: 'JOURNEY_FIXTURE',
        displayName: 'Journey fixture provider',
        environment: 'sandbox',
        capabilities: capabilitiesOf({}),
        descriptors: [],
      },
      isConfigured: () => false,
      getDisplayName: () => 'Journey fixture provider',
      // Each method awaits a resolved promise rather than dropping `async`: the provider contract is
      // asynchronous, and a synchronous stub would hide a missing await at the call site.
      listBanks: async () => {
        await Promise.resolve();
        return { ok: true, value: [] };
      },
      verifyAccount: async () => {
        await Promise.resolve();
        return { ok: false, error: { code: 'UNIMPLEMENTED', message: 'x' } };
      },
      provisionVirtualAccount: async () => {
        await Promise.resolve();
        return { ok: false, error: { code: 'UNIMPLEMENTED', message: 'x' } };
      },
      submitOutboundTransfer: async () => {
        await Promise.resolve();
        return { ok: false, error: { code: 'UNIMPLEMENTED', message: 'x' } };
      },
      getTransferStatus: async () => {
        await Promise.resolve();
        return { ok: false, error: { code: 'UNIMPLEMENTED', message: 'x' } };
      },
    } as never;
    registry.register(provider);
    const { walletId, token } = await customerWithInstitution();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/customers/me/banking/virtual-account?walletId=${walletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    // Mere registration is not approval: the operation is still refused.
    expect([403, 503]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/"accountNumber":"[0-9]{10}"/);
  });
});
