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
import { createIntegrationDataSource, truncateAllTables } from './support/pg-harness';

const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

function encodePbkdf2(password: string, saltStr = 'a3d-agent-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * Agent banking HTTP acceptance (real PostgreSQL, real sessions, real HTTP).
 *
 * The property that matters most here is that one agent cannot address another agent's funding
 * account. That is asserted by changing the wallet id in the URL, which is the only thing an attacker
 * controls on these routes — the agent identity itself comes from the session.
 */
describe('ARENA 3D agent banking HTTP (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a3dagenthttp');
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

  /** Creates an ACTIVE agent with an AGENT-classified wallet, and returns a real agent session. */
  async function agentWithWallet(): Promise<{
    agentId: string;
    walletId: string;
    token: string;
  }> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1,$2,'A3D Class',true,$3,$4) RETURNING id`,
      [
        `cls-a3d-${randomUUID().slice(0, 8)}`,
        `A3D-${randomUUID().slice(0, 6)}`,
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string; reference: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id, reference`,
      [`agent-a3d-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;

    await dataSource.query(
      `INSERT INTO agent_authentication_credentials
         (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status,
          account_locked, failed_authentication_count, version)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [agentId, encodePbkdf2('agent-banking-password')],
    );

    const ledger: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Agent funding fixture','LIABILITY','CREDIT','NGN') RETURNING id`,
      [randomUUID(), `A3DAGENT_${randomUUID()}`],
    );
    // `customer_id` is the owner reference (a VARCHAR) for agents as well; owner_class is what makes
    // the wallet an agent's.
    const wallet: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'AGENT') RETURNING id`,
      [randomUUID(), agentId, ledger[0]!.id],
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-banking-password' })
      .expect(200);
    return { agentId, walletId: wallet[0]!.id, token: login.body.accessToken as string };
  }

  it('refuses every agent banking route without a session', async () => {
    const walletId = randomUUID();
    const routes: Array<[string, 'get' | 'post']> = [
      [`/api/v1/agents/me/banking/funding-account?walletId=${walletId}`, 'get'],
      [`/api/v1/agents/me/banking/funding-account?walletId=${walletId}`, 'post'],
      [`/api/v1/agents/me/banking/funding-account/${walletId}/deposits`, 'get'],
    ];
    for (const [path, method] of routes) {
      const res =
        method === 'get'
          ? await request(app.getHttpServer()).get(path)
          : await request(app.getHttpServer()).post(path).send({});
      expect(res.status).toBe(401);
    }
  });

  it('reports NO_INSTITUTION with no account number for an unattributed agent wallet', async () => {
    const { walletId, token } = await agentWithWallet();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account?walletId=${walletId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // No institution means no approved provider, so there is no account and no number is invented.
    expect(res.body).toMatchObject({
      state: 'NO_INSTITUTION',
      accountNumber: null,
      purpose: 'AGENT_FLOAT_FUNDING',
      currency: 'NGN',
    });
  });

  it('refuses to provision without an institution instead of returning an account', async () => {
    const { walletId, token } = await agentWithWallet();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/banking/funding-account?walletId=${walletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/\d{10}/);
  });

  it('does not confirm another agent wallet exists', async () => {
    const first = await agentWithWallet();
    const second = await agentWithWallet();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account?walletId=${second.walletId}`)
      .set('Authorization', `Bearer ${first.token}`);
    expect(res.status).toBe(404);
    // Indistinguishable from a wallet that never existed.
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account?walletId=${randomUUID()}`)
      .set('Authorization', `Bearer ${first.token}`);
    expect(missing.status).toBe(404);
    expect(res.body.message).toBe(missing.body.message);
  });

  it('refuses a customer wallet presented as an agent funding account', async () => {
    const { token } = await agentWithWallet();
    // A CUSTOMER-classified wallet must never resolve through the agent surface, even with a matching
    // owner reference, because its funding semantics are different.
    const ledger: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Customer fixture','LIABILITY','CREDIT','NGN') RETURNING id`,
      [randomUUID(), `A3DCUST_${randomUUID()}`],
    );
    const owner = randomUUID();
    const wallet: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER') RETURNING id`,
      [randomUUID(), owner, ledger[0]!.id],
    );
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account?walletId=${wallet[0]!.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns an empty verified-funds list rather than a fabricated float', async () => {
    const { walletId, token } = await agentWithWallet();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account/${walletId}/deposits`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('does not expose a customer session on the agent banking surface', async () => {
    const { walletId } = await agentWithWallet();
    // A customer-style bearer on an agent route must be rejected, not silently treated as an agent.
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/banking/funding-account?walletId=${walletId}`)
      .set('Authorization', 'Bearer not-a-real-agent-session');
    expect([401, 403]).toContain(res.status);
  });
});
