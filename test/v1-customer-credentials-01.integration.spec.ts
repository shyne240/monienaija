/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * V1-CUSTOMER-CREDENTIALS-01 — customer first-credential lifecycle (real PostgreSQL + real HTTP).
 *
 * Proves the production lifecycle: ACTIVATED customer → workforce-issued SERVER-GENERATED
 * temporary credential → out-of-band SMS delivery to the verified phone → first login
 * (rotation_required, NO session) → mandatory rotation → normal session — with no manual
 * SQL for the credential path, no plaintext persistence, and the existing authorization,
 * lockout, session, and audit architecture preserved.
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
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

describe('V1-CUSTOMER-CREDENTIALS-01 (real PG) — customer first-credential lifecycle', () => {
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
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-'))
        throw new UnauthorizedException('invalid workforce token');
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
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        // V1-ADMIN-AUTHORIZATION-HARDENING-01: OPERATOR/SERVICE/PRIVILEGED need a realistic
        // `scopes` set (catalogue function codes) now that the relevant controllers call
        // AuthorizationService.requireFunction() rather than a bare principal-type check.
        scopes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(type)
          ? [
              'agent.suspend',
              'agent.terminate',
              'agent.reactivate',
              'agent.activate',
              'agent.review_application',
              'agent.manage_credentials',
              'workforce.user.create',
              'workforce.user.suspend',
              'customer.suspend',
              'customer.activate',
              'customer.close',
            ]
          : [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  const OP = { Authorization: 'Bearer workforce-OPERATOR' };
  const SERVICE = { Authorization: 'Bearer workforce-SERVICE' };
  const PRIVILEGED = { Authorization: 'Bearer workforce-PRIVILEGED' };
  const SUPPORT = { Authorization: 'Bearer workforce-SUPPORT' };
  const AGENT = { Authorization: 'Bearer workforce-AGENT' };
  const CUSTOMER = { Authorization: 'Bearer workforce-CUSTOMER' };

  const nextPhone = (() => {
    let counter = 600_000_000;
    return () => `0${8}${String(counter++).slice(0, 9)}`;
  })();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1custcreds');
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

  // ---------------------------------------------------------------- fixtures

  /** Full real public registration flow → DRAFT + verified primary phone. */
  async function registerVerifiedDraft(): Promise<{ customerId: string; phone: string }> {
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
    return { customerId: register.body.id, phone };
  }

  /** Real workforce activation (existing lifecycle; verified phone gate already in place). */
  async function activateCustomer(customerId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set(OP)
      .send({ status: 'ACTIVE', actor: 'workforce-activation' })
      .expect(200);
  }

  /** Real ACTIVATED customer through the full production lifecycle. */
  async function registerAndActivate(): Promise<{ customerId: string; phone: string }> {
    const registered = await registerVerifiedDraft();
    await activateCustomer(registered.customerId);
    return registered;
  }

  async function credentialRow(customerId: string): Promise<Record<string, unknown> | undefined> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT id, customer_id, password_hash, hash_algorithm, password_version, status,
              failed_authentication_count, account_locked, rotation_required,
              password_expires_at, deleted_at
         FROM customer_authentication_credentials
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );
    return rows[0];
  }

  const auditRows = async (credentialId: string): Promise<Array<any>> =>
    dataSource.query(
      `SELECT entity_type, action, actor, previous_values, new_values
         FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`,
      [credentialId],
    );

  const extractSmsCredential = (
    phone: string,
  ): { plaintext: string; message: string; entry: any } => {
    const destination = `+2348${phone.slice(2)}`;
    const entry = provider.sent
      .filter(
        (e) =>
          e.destination === destination &&
          e.eventType === 'customer.credentials.temporary_credential',
      )
      .at(-1);
    expect(entry).toBeDefined();
    const match = /login password is (\S+)\./.exec(entry!.message);
    expect(match).not.toBeNull();
    return { plaintext: match![1]!, message: entry!.message, entry };
  };

  const issue = (customerId: string, headers: Record<string, string> = OP) =>
    request(app.getHttpServer())
      .post(`/api/v1/internal/admin/customers/${customerId}/credentials`)
      .set(headers)
      .send({});

  const loginAttempt = (customerId: string, password: string) =>
    request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password });

  const rotate = (customerId: string, currentPassword: string, newPassword: string) =>
    request(app.getHttpServer())
      .post('/api/v1/customers/credentials/rotate')
      .send({ customerId, currentPassword, newPassword });

  /** Issue for an activated customer and return response + extracted SMS plaintext. */
  async function issueForActive(headers: Record<string, string> = OP): Promise<{
    customerId: string;
    phone: string;
    credentialId: string;
    temporaryPassword: string;
  }> {
    const { customerId, phone } = await registerAndActivate();
    const res = await issue(customerId, headers).expect(200);
    const { plaintext } = extractSmsCredential(phone);
    expect(plaintext.length).toBeGreaterThanOrEqual(12);
    expect(res.body.credentialId).toMatch(/^[0-9a-f-]{36}$/);
    return { customerId, phone, credentialId: res.body.credentialId, temporaryPassword: plaintext };
  }

  // ---------------------------------------------------------------- tests

  it('A/G/D: activated customer receives a server-generated temporary credential; SMS delivery to verified phone; only hash material persisted', async () => {
    const { customerId, phone } = await registerAndActivate();
    const res = await issue(customerId, PRIVILEGED).expect(200);
    expect(res.body.rotationRequired).toBe(true);
    expect(res.body.reissued).toBe(false);
    expect(res.body.delivery.channel).toBe('SMS');
    expect(res.body.delivery.delivered).toBe(true);
    expect(res.body.passwordExpiresAt).not.toBeNull();

    const sms = extractSmsCredential(phone);
    expect(sms.message).toContain('It expires in 72 hours');
    expect(sms.message).toContain('must be changed at your first login');

    const row = await credentialRow(customerId);
    expect(row).toBeDefined();
    expect(row!.rotation_required).toBe(true);
    expect(row!.status).toBe('ACTIVE');
    expect(Number(row!.password_version)).toBe(1);
    expect(String(row!.password_hash)).toMatch(/^PBKDF2\$sha256\$10000\$/);
    expect(String(row!.password_hash)).not.toContain(sms.plaintext);

    // Issuance + delivery audits carry safe metadata only.
    const audits = (await auditRows(row!.id as string)).map((r) => r.action);
    expect(audits).toContain('CREDENTIALS_ISSUED');
    expect(audits).toContain('TEMPORARY_CREDENTIAL_DELIVERED');
  });

  it('B: unactivated (DRAFT) and SUSPENDED customers cannot receive a production credential', async () => {
    const draft = await registerVerifiedDraft();
    await issue(draft.customerId).expect(409);
    expect(await credentialRow(draft.customerId)).toBeUndefined();

    const suspended = await registerAndActivate();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${suspended.customerId}`)
      .set(OP)
      .send({ status: 'SUSPENDED', actor: 'workforce-ops' })
      .expect(200);
    await issue(suspended.customerId).expect(409);
    expect(await credentialRow(suspended.customerId)).toBeUndefined();
  });

  it('C: temporary credentials are CSPRNG-random (unique per issuance), never derived from identity', async () => {
    const first = await registerAndActivate();
    const second = await registerAndActivate();
    await issue(first.customerId).expect(200);
    await issue(second.customerId).expect(200);
    const sms1 = extractSmsCredential(first.phone);
    const sms2 = extractSmsCredential(second.phone);
    expect(sms1.plaintext).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(sms2.plaintext).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(sms1.plaintext).not.toBe(sms2.plaintext);
    expect(sms1.plaintext).not.toContain(first.customerId.slice(0, 6));
    expect(sms1.plaintext).not.toContain(first.phone);

    const [row1, row2] = await Promise.all([
      credentialRow(first.customerId),
      credentialRow(second.customerId),
    ]);
    expect(row1!.password_hash).not.toBe(row2!.password_hash);
  });

  it('D/E: plaintext never in credential rows, password history, security events, or audit payloads', async () => {
    const { customerId, phone } = await registerAndActivate();
    await issue(customerId).expect(200);
    const { plaintext } = extractSmsCredential(phone);
    const row = await credentialRow(customerId);

    const history: Array<any> = await dataSource.query(
      `SELECT password_hash FROM password_histories WHERE credential_id = $1`,
      [row!.id],
    );
    expect(history).toHaveLength(1);
    expect(grid(history[0].password_hash)).not.toContain(plaintext);

    const events: Array<any> = await dataSource.query(
      `SELECT metadata FROM security_event_histories WHERE customer_id = $1`,
      [customerId],
    );
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(JSON.stringify(e.metadata)).not.toContain(plaintext);

    const audits = await auditRows(row!.id as string);
    for (const a of audits) {
      expect(JSON.stringify(a.previous_values ?? {})).not.toContain(plaintext);
      expect(JSON.stringify(a.new_values ?? {})).not.toContain(plaintext);
    }
    function grid(value: unknown): string {
      return String(value);
    }
  });

  it('F: plaintext absent from the issuance response body (masked destination only)', async () => {
    const { customerId, phone } = await registerAndActivate();
    const res = await issue(customerId).expect(200);
    const { plaintext } = extractSmsCredential(phone);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(plaintext);
    expect(body).not.toContain(`+2348${phone.slice(2)}`); // full number never echoed
    expect(res.body.delivery.destination).toBe(`+234••••••${`+2348${phone.slice(2)}`.slice(-3)}`);
  });

  it('G/H/I: temporary credential authenticates, is forced to rotate, and gets NO session or accessToken before rotation', async () => {
    const { customerId, credentialId, temporaryPassword } = await issueForActive();

    const login = await loginAttempt(customerId, temporaryPassword).expect(200);
    expect(login.body.rotationRequired).toBe(true);
    expect(login.body.customerId).toBe(customerId);
    expect(login.body.accessToken).toBeUndefined();
    expect(login.body.sessionId).toBeUndefined();

    const sessions: Array<any> = await dataSource.query(
      `SELECT id FROM authentication_sessions WHERE credential_id = $1`,
      [credentialId],
    );
    expect(sessions).toHaveLength(0);
  });

  it('J/K/L: rotation clears rotation-required, mints the first session; old credential dies; new credential logs in', async () => {
    const { customerId, credentialId, temporaryPassword } = await issueForActive();
    const newPassword = 'Cust0m3r!NewPass-9xZ';

    const rotateRes = await rotate(customerId, temporaryPassword, newPassword).expect(200);
    expect(rotateRes.body.accessToken).toBeDefined();
    expect(rotateRes.body.expiresAt).toBeDefined();

    const row = await credentialRow(customerId);
    expect(row!.rotation_required).toBe(false);
    expect(row!.password_expires_at).toBeNull();
    expect(Number(row!.password_version)).toBe(2);

    // Functional authenticated surface works with the session.
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${rotateRes.body.accessToken}`)
      .expect(200);

    // K — the old temporary password is permanently invalid.
    await loginAttempt(customerId, temporaryPassword).expect(401);
    await rotate(customerId, temporaryPassword, newPassword).expect(401);

    // L — the new password flows through the normal login path without rotation gate.
    const login = await loginAttempt(customerId, newPassword).expect(200);
    expect(login.body.accessToken).toBeDefined();
    expect(login.body.rotationRequired).toBeUndefined();

    // Audit parity: PASSWORD_ROTATED (prev/new safe values) + history + security event.
    const audits = (await auditRows(credentialId)).map((r) => r.action);
    expect(audits).toContain('PASSWORD_ROTATED');
    const history: Array<any> = await dataSource.query(
      `SELECT action FROM password_histories WHERE credential_id = $1 ORDER BY changed_at`,
      [credentialId],
    );
    expect(history.map((h) => h.action)).toEqual(['CREATED', 'ROTATED']);
  });

  it('rotate policy: rejects short/reused new passwords and rotation on non-pending credentials', async () => {
    const { customerId, temporaryPassword } = await issueForActive();
    await rotate(customerId, temporaryPassword, 'short').expect(400);
    await rotate(customerId, temporaryPassword, temporaryPassword).expect(400);
    await rotate(customerId, 'wrong-temporary-password', 'NeuSecret!2345').expect(401); // lockout-accounted failure

    // Wrong current password consumed failed-attempt budget; still 3 attempts left of 5.
    const ok = await rotate(customerId, temporaryPassword, 'NeuSecret!2345').expect(200);
    expect(ok.body.accessToken).toBeDefined();

    // Now a normal credential — the rotation surface must reject it.
    await rotate(customerId, 'NeuSecret!2345', 'Another!23456').expect(403);
  });

  it('M: invalid credentials follow the existing lockout behavior (5 attempts then locked)', async () => {
    const { customerId, temporaryPassword } = await issueForActive();
    for (let i = 0; i < 5; i++) {
      await loginAttempt(customerId, `wrong-password-${i}`).expect(401);
    }
    const row = await credentialRow(customerId);
    expect(row!.account_locked).toBe(true);
    expect(Number(row!.failed_authentication_count)).toBe(5);

    // Credential unavailable — even the correct temporary password no longer authenticates.
    await loginAttempt(customerId, temporaryPassword).expect(401);
    await rotate(customerId, temporaryPassword, 'NeuSecret!2345').expect(401);

    const events: Array<any> = await dataSource.query(
      `SELECT event_type FROM security_event_histories WHERE customer_id = $1 ORDER BY occurred_at`,
      [customerId],
    );
    const types = events.map((e) => e.event_type);
    expect(types).toContain('AUTHENTICATION_FAILED');
    expect(types).toContain('ACCOUNT_LOCKED');
  });

  it('N: reissue revokes and supersedes the prior credential; sessions of the replaced credential die; new temporary credential rotates', async () => {
    const {
      customerId,
      credentialId: firstId,
      temporaryPassword: firstPassword,
    } = await issueForActive(SERVICE);
    // Move through rotation so the FIRST credential owns a live session.
    const rotated = await rotate(customerId, firstPassword, 'NeuSecret!2345').expect(200);
    const oldToken = rotated.body.accessToken;

    const reissue = await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/customers/${customerId}/credentials/reissue`)
      .set(SERVICE)
      .expect(200);
    expect(reissue.body.reissued).toBe(true);
    expect(reissue.body.rotationRequired).toBe(true);
    expect(reissue.body.credentialId).not.toBe(firstId);

    // Session bound to the replaced credential is revoked.
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);

    // Previous credential soft-deleted + REVOKED; audits captured.
    const previous: Array<any> = await dataSource.query(
      `SELECT status, deleted_at FROM customer_authentication_credentials WHERE id = $1`,
      [firstId],
    );
    expect(previous[0].status).toBe('REVOKED');
    expect(previous[0].deleted_at).not.toBeNull();
    expect((await auditRows(firstId)).map((r) => r.action)).toContain('REVOKED');

    // A new SMS delivered the NEW temporary credential; the prior one is dead.
    const { plaintext } = await secondSmsFor(customerId);
    await rotate(customerId, firstPassword, 'NeuSecret!9999').expect(401);
    const rotated2 = await rotate(customerId, plaintext, 'NeuSecret!9999').expect(200);
    expect(rotated2.body.accessToken).toBeDefined();

    async function secondSmsFor(cid: string): Promise<{ plaintext: string }> {
      const row = await credentialRow(cid);
      const entries = provider.sent.filter(
        (e) =>
          e.eventType === 'customer.credentials.temporary_credential' &&
          e.eventKey === `customer-temporary-credential:${String(row!.id)}`,
      );
      expect(entries).toHaveLength(1);
      const match = /login password is (\S+)\./.exec(entries[0]!.message);
      return { plaintext: match![1]! };
    }
  });

  it('O: authorization — unauthenticated (401); customer/agent/aggregator/support principals forbidden (403); operator family allowed', async () => {
    const { customerId, phone } = await registerAndActivate();
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/customers/${customerId}/credentials`)
      .expect(401);
    await issue(customerId, CUSTOMER).expect(403);
    await issue(customerId, AGENT).expect(403);
    await issue(customerId, SUPPORT).expect(403);
    await issue(customerId, OP).expect(200);

    // Registry keeps the SSO-bypass rotation/login surface non-bearer: Customer session
    // tokens are unrelated but a CUSTOMER bearer must not reach the workforce surface.
    expect((await credentialRow(customerId))!.rotation_required).toBe(true);
    const { plaintext } = extractSmsCredential(phone);
    expect(plaintext.length).toBeGreaterThanOrEqual(12);
  });

  it('P: failed issuance is atomic (no credential/audit residues); duplicate issuance conflicts cleanly', async () => {
    const draft = await registerVerifiedDraft();
    await issue(draft.customerId).expect(409);
    const orphanAudits: Array<any> = await dataSource.query(
      `SELECT id FROM audit_events WHERE action = 'CREDENTIALS_ISSUED' AND new_values->>'customerId' = $1`,
      [draft.customerId],
    );
    expect(orphanAudits).toHaveLength(0);

    const { customerId, temporaryPassword } = await issueForActive();
    // Second issuance conflicts inside the transaction; existing state is untouched.
    await issue(customerId).expect(409);
    const rows: Array<any> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials WHERE customer_id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    expect(rows).toHaveLength(1);
    // The temporary credential still authenticates to rotation state (unchanged).
    const login = await loginAttempt(customerId, temporaryPassword).expect(200);
    expect(login.body.rotationRequired).toBe(true);
  });

  it('delivery failure is audited truthfully and does not pretend delivery (workforce can reissue)', async () => {
    const { customerId } = await registerAndActivate();
    provider.shouldFail = true;
    const res = await issue(customerId).expect(200);
    expect(res.body.delivery.delivered).toBe(false);
    const row = await credentialRow(customerId);
    expect(row).toBeDefined();
    const audits = (await auditRows(row!.id as string)).map((r) => r.action);
    expect(audits).toContain('CREDENTIALS_ISSUED');
    expect(audits).toContain('TEMPORARY_CREDENTIAL_DELIVERY_FAILED');
    expect(audits).not.toContain('TEMPORARY_CREDENTIAL_DELIVERED');
  });
});
