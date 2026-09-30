/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-require-imports */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'onboarding02-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * V1-CUSTOMER-ONBOARDING-02 — workforce review + verified-phone activation gate
 * (real PostgreSQL + real HTTP). Proofs 1–13 of the task; proofs 14–17 are the
 * still-green s-fix-01 / v1-customer-onboarding-01 / hardening-06 suites run alongside.
 */
describe('V1-CUSTOMER-ONBOARDING-02 verified-phone activation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let provider: TestNotificationProvider;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: (token: string, audience: string): Promise<any> => {
      if (!token || !token.startsWith('workforce-')) {
        return Promise.reject(new UnauthorizedException('invalid workforce token'));
      }
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = [
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
        'AGENT',
        'CUSTOMER',
        'AGGREGATOR',
      ];
      if (!allowed.includes(type)) return Promise.reject(new UnauthorizedException('invalid type'));
      return Promise.resolve({
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any);
    },
  };

  const nextPhone = (() => {
    let counter = 500_000_000;
    return () => `0${8}${String(counter++).slice(0, 9)}`;
  })();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1custactivate');
    provider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    provider.clear();
  });

  // ---------------------------------------------------------------- helpers

  /** Full real public registration flow → DRAFT + verified primary phone. */
  async function registerDraft(): Promise<{
    customerId: string;
    phone: string;
    code: string;
    verificationToken: string;
  }> {
    const phone = nextPhone();
    await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp')
      .send({ phone })
      .expect(200);
    const destination = `+2348${phone.slice(2)}`;
    const sent = provider.sent.find((entry) => entry.destination === destination);
    const code = /code is (\d{6})/.exec(sent!.message)![1]!;
    const verify = await request(app.getHttpServer())
      .post('/api/v1/customers/registration/otp/verify')
      .send({ phone, code })
      .expect(200);
    const register = await request(app.getHttpServer())
      .post('/api/v1/customers/registration')
      .send({ phone, verificationToken: verify.body.verificationToken })
      .expect(201);
    return {
      customerId: register.body.id,
      phone,
      code,
      verificationToken: verify.body.verificationToken,
    };
  }

  async function createUnverifiedDraft(withPhone = true): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','DRAFT','NONE','NOT_STARTED') RETURNING id`,
      [`unver-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    if (withPhone) {
      const phone = nextPhone();
      await dataSource.query(
        `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,NULL)`,
        [customerId, `+2348${phone.slice(2)}`, `8${phone.slice(2)}`],
      );
    }
    return customerId;
  }

  /** Legit ACTIVE customer + credential + real session (for self-403). */
  async function createActiveCustomerSession(): Promise<{ customerId: string; token: string }> {
    const phone = nextPhone();
    const canonical = `8${phone.slice(2)}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`active-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${canonical}`, canonical],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, encodePbkdf2('correct-password-02')],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password: 'correct-password-02' })
      .expect(200);
    return { customerId, token: login.body.accessToken as string };
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-02-${randomUUID().slice(0, 8)}`,
        `OB2-${randomUUID().slice(0, 6)}`,
        'OB2 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-02-${randomUUID()}`, classRows[0]!.id],
    );
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentRows[0]!.id, encodePbkdf2('agent-pass-02', 'agent-salt')],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId: agentRows[0]!.id, password: 'agent-pass-02' })
      .expect(200);
    return login.body.accessToken as string;
  }

  const dbStatus = async (id: string): Promise<string> => {
    const rows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM customers WHERE id=$1`,
      [id],
    );
    return rows[0]!.status;
  };

  const countRows = async (table: string, where = ''): Promise<number> =>
    Number((await dataSource.query(`SELECT count(*)::text AS n FROM ${table} ${where}`))[0].n);

  // ---------------------------------------------------------------- proofs

  it('1,9,10: DRAFT + verified phone — OPERATOR and SUPPORT activate; audit records actor, previous→new, gate outcome, timestamp', async () => {
    const first = await registerDraft();
    const activate = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${first.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'workforce-activation' })
      .expect(200);
    expect(activate.body.status).toBe('ACTIVE');
    expect(await dbStatus(first.customerId)).toBe('ACTIVE');

    const audits: Array<any> = await dataSource.query(
      `SELECT entity_type, action, actor, previous_values, new_values, occurred_at FROM audit_events WHERE entity_id=$1 AND action='STATUS_UPDATED'`,
      [first.customerId],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].entity_type).toBe('CUSTOMER');
    expect(audits[0].actor).toBe('workforce-activation');
    expect(audits[0].previous_values.status).toBe('DRAFT');
    expect(audits[0].new_values.status).toBe('ACTIVE');
    expect(audits[0].new_values.reference).toBe(`mn-8${first.phone.slice(2)}`);
    expect(audits[0].new_values.activationGate).toEqual({ verifiedPrimaryPhone: true });
    expect(audits[0].occurred_at).toBeTruthy();

    // SUPPORT is an authorized workforce class on this surface (policy allowlist).
    const second = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${second.customerId}`)
      .set('Authorization', 'Bearer workforce-SUPPORT')
      .send({ status: 'ACTIVE', actor: 'workforce-support-activation' })
      .expect(200);
    expect(await dbStatus(second.customerId)).toBe('ACTIVE');
  });

  it('2,3,4: DRAFT + unverified (or missing) phone — activation fails closed; DRAFT persists; no wallet/credential/PIN/financial rows', async () => {
    const unverified = await createUnverifiedDraft(true);
    const noPhone = await createUnverifiedDraft(false);
    for (const customerId of [unverified, noPhone]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', 'Bearer workforce-OPERATOR')
        .send({ status: 'ACTIVE', actor: 'workforce-activation' })
        .expect(400);
      expect(res.body.message).toContain('Customer activation requires a verified primary phone');
      expect(await dbStatus(customerId)).toBe('DRAFT');
      expect(
        await countRows('customer_authentication_credentials', `WHERE customer_id='${customerId}'`),
      ).toBe(0);
      expect(
        await countRows('customer_transaction_pins', `WHERE customer_id='${customerId}'`),
      ).toBe(0);
      expect(await countRows('wallet_accounts', `WHERE customer_id='${customerId}'`)).toBe(0);
    }
    expect(await countRows('ledger_journals')).toBe(0);
    expect(await countRows('ledger_lines')).toBe(0);
  });

  it('5,8: unauthenticated and workforce-namespaced masquerade tokens are rejected; boundary unchanged', async () => {
    const draft = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .send({ status: 'ACTIVE', actor: 'no-token' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ status: 'ACTIVE', actor: 'unknown' })
      .expect(401);
    // Masquerade: workforce-issued session whose principal type is not a workforce class —
    // rejected by the controller-level workforce assertion (S-FIX-01 convention: 401).
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-CUSTOMER')
      .send({ status: 'ACTIVE', actor: 'masquerade' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-AGGREGATOR')
      .send({ status: 'ACTIVE', actor: 'masquerade' })
      .expect(401);
    expect(await dbStatus(draft.customerId)).toBe('DRAFT');
  });

  it('6: customer self cannot self-activate (real session → 403; status unchanged)', async () => {
    const self = await createActiveCustomerSession();
    const draft = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', `Bearer ${self.token}`)
      .send({ status: 'ACTIVE', actor: 'malicious-self' })
      .expect(403);
    expect(await dbStatus(draft.customerId)).toBe('DRAFT');
    // ...and cannot self-suspend its own ACTIVE either (invariant preserved).
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${self.customerId}`)
      .set('Authorization', `Bearer ${self.token}`)
      .send({ status: 'SUSPENDED', actor: 'self' })
      .expect(403);
    expect(await dbStatus(self.customerId)).toBe('ACTIVE');
  });

  it('7: a real Agent session cannot activate a customer (403; status unchanged)', async () => {
    const agentToken = await createAgentToken();
    const draft = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'ACTIVE', actor: 'agent-actor' })
      .expect(403);
    expect(await dbStatus(draft.customerId)).toBe('DRAFT');
  });

  it('11: existing lifecycle behavior preserved — ACTIVE no-op PATCH, ACTIVE→SUSPENDED, SUSPENDED→ACTIVE (reactivation also passes the gate)', async () => {
    const draft = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'activate' })
      .expect(200);
    // No-op re-activation: 200, unchanged, no second audit row.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'noop' })
      .expect(200);
    expect(await dbStatus(draft.customerId)).toBe('ACTIVE');
    // Suspend, then reactivate — the gate also applies on re-entry to ACTIVE and passes
    // because the verified phone is present.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'SUSPENDED', actor: 'suspend' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'reactivate' })
      .expect(200);
    expect(await dbStatus(draft.customerId)).toBe('ACTIVE');
    const audits: Array<any> = await dataSource.query(
      `SELECT new_values->>'status' AS status FROM audit_events WHERE entity_id=$1 AND action='STATUS_UPDATED' ORDER BY occurred_at, id`,
      [draft.customerId],
    );
    expect(audits.map((row) => row.status as string)).toEqual(['ACTIVE', 'SUSPENDED', 'ACTIVE']);
  });

  it('12: phone verification is immutable/authoritative — verified_at identical before/after activation and across later transitions', async () => {
    const draft = await registerDraft();
    const before: Array<any> = await dataSource.query(
      `SELECT verified_at FROM customer_contact_methods WHERE customer_id=$1 AND is_primary`,
      [draft.customerId],
    );
    expect(before[0].verified_at).not.toBeNull();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'activate' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'SUSPENDED', actor: 'suspend' })
      .expect(200);
    const after: Array<any> = await dataSource.query(
      `SELECT verified_at FROM customer_contact_methods WHERE customer_id=$1 AND is_primary`,
      [draft.customerId],
    );
    expect(new Date(after[0].verified_at).toISOString()).toBe(
      new Date(before[0].verified_at).toISOString(),
    );
  });

  it('13: no OTP, verification token, credential, PIN, or other secret leaks into the activation audit trail', async () => {
    const draft = await registerDraft();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${draft.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'workforce-activation' })
      .expect(200);
    const audits: Array<any> = await dataSource.query(`SELECT * FROM audit_events`);
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain(draft.code);
    expect(dump).not.toContain(draft.verificationToken);
    expect(dump.toLowerCase()).not.toContain('password');
    expect(dump.toLowerCase()).not.toContain('pinhash');
    expect(dump).not.toContain('+2348');
  });

  it('review surface: GET /internal/customers/:id/phone-verification — workforce read-only gate evidence; 401 unauth; 403 customer', async () => {
    const unverified = await createUnverifiedDraft(true);
    const wf = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${unverified}/phone-verification`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .expect(200);
    expect(wf.body.customerStatus).toBe('DRAFT');
    expect(wf.body.activationGate).toEqual({ verifiedPrimaryPhone: false });
    expect(wf.body.phones[0].verifiedAt).toBeNull();
    expect(wf.body.phones[0].maskedValue).toMatch(/^\+234\*{5}\d{4}$/);
    expect(JSON.stringify(wf.body)).not.toContain('+2348');

    const draft = await registerDraft();
    const wf2 = await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${draft.customerId}/phone-verification`)
      .set('Authorization', 'Bearer workforce-SUPPORT')
      .expect(200);
    expect(wf2.body.activationGate).toEqual({ verifiedPrimaryPhone: true });
    expect(wf2.body.phones[0].verifiedAt).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${draft.customerId}/phone-verification`)
      .expect(401);
    const self = await createActiveCustomerSession();
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${draft.customerId}/phone-verification`)
      .set('Authorization', `Bearer ${self.token}`)
      .expect(403);

    // Read-only: repeat call works and produced no audit rows/state change for the customer.
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${draft.customerId}/phone-verification`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/customers/${draft.customerId}/phone-verification`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .expect(200);
    expect(await dbStatus(draft.customerId)).toBe('DRAFT');
    expect(
      await countRows(
        'audit_events',
        `WHERE entity_id='${draft.customerId}' AND action='STATUS_UPDATED'`,
      ),
    ).toBe(0);
  });
});
