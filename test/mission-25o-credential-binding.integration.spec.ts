/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-require-imports */
import { randomBytes, randomUUID } from 'node:crypto';
import { Logger, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import {
  NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN,
  NotificationProviderConfigService,
  type ProviderHttpFetchFn,
  type ProviderConfigProposalView,
} from '../src/notification/notification-provider-config.service';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const CFG_BASE = '/api/v1/internal/notifications/provider-config';
const OVERVIEW_PATH = CFG_BASE;
const PROPOSALS_PATH = `${CFG_BASE}/proposals`;
const STATUS_PATH = '/api/v1/internal/notifications/provider-status';
const TEST_SEND_PATH = '/api/v1/internal/notifications/test-send';

const ENCRYPTION_KEY_V1 = randomBytes(32).toString('base64');
const BINDING_KEY_V1 = randomBytes(32).toString('base64');
const SYNTHETIC_ROBASE_KEY = 'robe_' + '1a2b3c4d5e6f7081'.repeat(4);
const SYNTHETIC_BREVO_KEY = 'xkeysib-' + 'abcdef0123456789'.repeat(4) + '-Key1';

interface RecordedHttpCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

describe('MISSION-25O — exact credential identity (isolated real PostgreSQL + fake transport)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;

  const ORIGINAL_ENV = { ...process.env };
  const outboundCalls: RecordedHttpCall[] = [];
  let robaseNextStatus = 200;
  let brevoSendNextStatus = 201;
  let brevoVerifiedSenders = ['notifications@monienaija.ng'];
  let customTransportOverride: ProviderHttpFetchFn | null = null;

  const mockTransport: ProviderHttpFetchFn = async (url, init) => {
    outboundCalls.push({
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    });

    if (customTransportOverride) {
      return customTransportOverride(url, init);
    }

    if (url.startsWith('https://api.robase.dev/v1/sms/send')) {
      if (robaseNextStatus >= 200 && robaseNextStatus < 300) {
        return {
          ok: true,
          status: robaseNextStatus,
          json: async () => ({
            id: `robase-msg-${randomUUID().slice(0, 8)}`,
            status: 'pending',
            country_code: 'NG',
            credit_cost: 1,
            segments: 1,
          }),
        };
      }
      return {
        ok: false,
        status: robaseNextStatus,
        json: async () => ({
          error: {
            type: robaseNextStatus === 503 ? 'service_unavailable' : 'unauthorized',
            message: `Sensitive upstream diagnostic ${SYNTHETIC_ROBASE_KEY}`,
          },
        }),
      };
    }

    if (url === 'https://api.brevo.com/v3/account') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ email: 'postmaster@monienaija.ng', companyName: 'MonieNaija' }),
      };
    }

    if (url === 'https://api.brevo.com/v3/senders') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          senders: brevoVerifiedSenders.map((email) => ({
            email,
            name: 'MonieNaija',
            active: true,
          })),
        }),
      };
    }

    if (url === 'https://api.brevo.com/v3/smtp/email') {
      if (brevoSendNextStatus >= 200 && brevoSendNextStatus < 300) {
        return {
          ok: true,
          status: brevoSendNextStatus,
          json: async () => ({
            messageId: `<brevo-${randomUUID().slice(0, 8)}@smtp-relay.mailin.fr>`,
          }),
        };
      }
      return {
        ok: false,
        status: brevoSendNextStatus,
        json: async () => ({
          code: brevoSendNextStatus === 503 ? 'service_unavailable' : 'unauthorized',
          message: `Sensitive Brevo prose ${SYNTHETIC_BREVO_KEY}`,
        }),
      };
    }

    throw new Error(`Unexpected outbound URL in mocked transport: ${url}`);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON = JSON.stringify({
      v1: ENCRYPTION_KEY_V1,
    });
    process.env.NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    process.env.NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON = JSON.stringify({ v1: BINDING_KEY_V1 });
    process.env.NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION = 'v1';
    process.env.NOTIFICATION_WORKER_ENABLED = 'true';
    process.env.NOTIFICATION_WORKER_POLL_INTERVAL_MS = '60000';

    dataSource = await createIntegrationDataSource('m25oh07');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN)
      .useValue(mockTransport)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    localAdminService = moduleRef.get(LocalAdminAuthenticationService);
    sessionService = moduleRef.get(A2WorkforceSessionService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
    worker = moduleRef.get(NotificationWorkerService);
  }, 180_000);

  afterAll(async () => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL_ENV);
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() => undefined);
    }
  }, 60_000);

  beforeEach(async () => {
    outboundCalls.length = 0;
    robaseNextStatus = 200;
    brevoSendNextStatus = 201;
    brevoVerifiedSenders = ['notifications@monienaija.ng'];
    customTransportOverride = null;
    process.env.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON = JSON.stringify({
      v1: ENCRYPTION_KEY_V1,
    });
    process.env.NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION = 'v1';
    await truncateAllTables(dataSource);
  });

  async function loginSuperAdmin(): Promise<string> {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const login = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  async function provisionRole(
    roleKeys: string | string[],
    assuranceLevel: 'MFA' | 'PASSWORD' = 'MFA',
  ): Promise<{ principalId: string; token: string }> {
    const keys = Array.isArray(roleKeys) ? roleKeys : [roleKeys];
    const principalId = `notifcfg:${keys.join('+')}:${randomUUID().slice(0, 8)}`;
    const now = new Date();
    for (const roleKey of keys) {
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `notifcfg:${principalId}:${roleKey}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 86_400_000),
        assignedBy: 'test-harness',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      } as any);
    }
    const session = await sessionService.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel,
      amr: assuranceLevel === 'MFA' ? ['pwd', 'otp'] : ['pwd'],
      acr: null,
      signingKeyId: 'test-key',
    });
    return { principalId, token: session.accessToken };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const credentialA = `robe_${randomBytes(24).toString('hex')}tail`;
  const credentialB = `robe_${randomBytes(24).toString('hex')}tail`;
  const secondBindingKey = randomBytes(32).toString('base64');
  const config = () => app.get(ConfigService);
  const service = () => app.get(NotificationProviderConfigService);
  const message = () => ({
    channel: 'SMS' as const,
    destination: '+2348012345678',
    message: 'Synthetic test',
    payload: {},
    eventType: 'customer.funding.approved',
    eventKey: randomUUID(),
    recipientType: 'CUSTOMER' as const,
    recipientId: randomUUID(),
  });
  const resetSecrets = () => {
    config().set('ROBASE_API_KEY', credentialA);
    config().set(
      'NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON',
      JSON.stringify({ v1: BINDING_KEY_V1 }),
    );
    config().set('NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION', 'v1');
    config().set(
      'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON',
      JSON.stringify({ v1: ENCRYPTION_KEY_V1 }),
    );
    config().set('NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION', 'v1');
  };
  async function actors() {
    resetSecrets();
    const maker = await loginSuperAdmin();
    const checker = await provisionRole('FINANCE_CONTROLLER');
    return { maker, checker: checker.token };
  }
  async function propose(maker: string, overrides: Record<string, unknown> = {}) {
    const response = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(maker))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'USE_ENV_SECRET',
        reason: 'Synthetic governed credential change',
        ...overrides,
      })
      .expect(201);
    return response.body as ProviderConfigProposalView;
  }
  async function decide(id: string, checker: string, status = 200) {
    return request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${id}/approve`)
      .set(auth(checker))
      .expect(status);
  }
  async function activate(id: string, checker: string, status = 200) {
    return request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${id}/activate`)
      .set(auth(checker))
      .expect(status);
  }
  async function active() {
    const { maker, checker } = await actors();
    const proposal = await propose(maker);
    await decide(proposal.id, checker);
    await activate(proposal.id, checker);
    return { maker, checker, proposal };
  }

  it('uses the exact approved environment credential in the in-memory fake adapter', async () => {
    await active();
    const result = await service().sendSms(message());
    expect(result.success).toBe(true);
    expect(outboundCalls).toHaveLength(1);
    const headerValues = Object.values(outboundCalls[0]!.headers);
    expect(headerValues.some((value) => value.includes(credentialA))).toBe(true);
  });

  it('rejects same-last-four substitution before checker, rolling back approval', async () => {
    const { maker, checker } = await actors();
    const p = await propose(maker);
    config().set('ROBASE_API_KEY', credentialB);
    await decide(p.id, checker, 409);
    const rows = await dataSource.query(
      `SELECT status FROM notification_provider_config_proposals WHERE id=$1`,
      [p.id],
    );
    expect(rows[0].status).toBe('REQUESTED');
    expect(outboundCalls).toHaveLength(0);
  });

  it('rejects substitution after approval but before activation without consuming approval', async () => {
    const { maker, checker } = await actors();
    const p = await propose(maker);
    await decide(p.id, checker);
    config().set('ROBASE_API_KEY', credentialB);
    await activate(p.id, checker, 409);
    const rows = await dataSource.query(
      `SELECT status FROM notification_provider_config_proposals WHERE id=$1`,
      [p.id],
    );
    expect(rows[0].status).toBe('APPROVED');
    expect(
      await dataSource.query(
        `SELECT 1 FROM notification_provider_configurations WHERE channel='SMS'`,
      ),
    ).toHaveLength(0);
    expect(outboundCalls).toHaveLength(0);
  });

  it('blocks changed and missing credentials after activation and never calls the vendor', async () => {
    await active();
    config().set('ROBASE_API_KEY', credentialB);
    const changed = await service().sendSms(message());
    expect(changed.success).toBe(false);
    expect(changed.failureDisposition).toBe('RETRYABLE');
    const overview = await service().getOverview();
    expect(overview.sms.gates.configured).toBe(false);
    config().set('ROBASE_API_KEY', '');
    const missing = await service().sendSms(message());
    expect(missing.success).toBe(false);
    expect(missing.failureDisposition).toBe('RETRYABLE');
    expect(outboundCalls).toHaveLength(0);
  });

  it('does not fall back from an encrypted source to a configured environment credential', async () => {
    const { maker, checker } = await actors();
    const p = await propose(maker, { credentialAction: 'SET_ENCRYPTED', apiKey: credentialA });
    await decide(p.id, checker);
    await activate(p.id, checker);
    config().set('NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON', '{}');
    config().set('ROBASE_API_KEY', credentialA);
    expect((await service().sendSms(message())).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
  });

  it('prohibits self-approval even for a dual-role maker, and rejects a password-only checker', async () => {
    resetSecrets();
    const dual = await provisionRole(['SUPER_ADMIN', 'FINANCE_CONTROLLER']);
    await expect(provisionRole('FINANCE_CONTROLLER', 'PASSWORD')).rejects.toThrow('recent MFA');
    const p = await propose(dual.token);
    await decide(p.id, dual.token, 403);
    expect(outboundCalls).toHaveLength(0);
  });

  it('fences stale approved proposals and concurrent first activation', async () => {
    const { maker, checker } = await actors();
    const first = await propose(maker);
    const second = await propose(maker);
    await decide(first.id, checker);
    await decide(second.id, checker);
    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${first.id}/activate`)
        .set(auth(checker)),
      request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${second.id}/activate`)
        .set(auth(checker)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await dataSource.query(
      `SELECT version FROM notification_provider_configurations WHERE channel='SMS'`,
    );
    expect(rows).toEqual([{ version: 1 }]);
    await activate((results[0].status === 200 ? first : second).id, checker, 409);
  });

  it('requires a fresh governed approval for rotation and resets old readiness evidence', async () => {
    const { maker, checker } = await active();
    const ops = await provisionRole('OPERATIONS');
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/SMS/verify`)
      .set(auth(ops.token))
      .expect(200);
    await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(201);
    config().set('ROBASE_API_KEY', credentialB);
    outboundCalls.length = 0;
    expect((await service().sendSms(message())).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
    const p = await propose(maker, {
      expectedVersion: 1,
      reason: 'Synthetic rotation requiring reapproval',
    });
    await activate(p.id, checker, 409);
    await decide(p.id, checker);
    await activate(p.id, checker);
    const rows = await dataSource.query(
      `SELECT version,verified_at,delivery_tested_at FROM notification_provider_configurations WHERE channel='SMS'`,
    );
    expect(rows).toEqual([{ version: 2, verified_at: null, delivery_tested_at: null }]);
    expect((await service().sendSms(message())).success).toBe(true);
    expect(Object.values(outboundCalls[0]!.headers).some((v) => v.includes(credentialB))).toBe(
      true,
    );
  });

  it('retains old verification versions only when present; missing, revoked and invalid keys fail closed', async () => {
    await active();
    config().set(
      'NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON',
      JSON.stringify({ v1: BINDING_KEY_V1, v2: secondBindingKey }),
    );
    config().set('NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION', 'v2');
    expect((await service().sendSms(message())).success).toBe(true);
    outboundCalls.length = 0;
    for (const bad of [
      JSON.stringify({ v2: secondBindingKey }),
      '{}',
      '{broken',
      JSON.stringify({ v1: 'invalid' }),
    ]) {
      config().set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', bad);
      expect((await service().sendSms(message())).success).toBe(false);
    }
    expect(outboundCalls).toHaveLength(0);
  });

  it('does not disclose credential, HMAC key or binding tag in responses, audit and captured logs', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { maker, checker, proposal } = await active();
      const overview = await request(app.getHttpServer())
        .get(OVERVIEW_PATH)
        .set(auth(maker))
        .expect(200);
      const status = await request(app.getHttpServer())
        .get(STATUS_PATH)
        .set(auth(maker))
        .expect(200);
      const metadata = await dataSource.query<Array<{ credential_binding_mac: string }>>(
        `SELECT credential_binding_mac FROM notification_provider_configurations WHERE channel='SMS'`,
      );
      const tag = metadata[0]!.credential_binding_mac;
      expect(typeof tag).toBe('string');
      const audit = await dataSource.query(
        `SELECT entity_type,action,previous_values,new_values FROM audit_events WHERE entity_type='NOTIFICATION_PROVIDER_CONFIG'`,
      );
      const contents = JSON.stringify([
        proposal,
        overview.body,
        status.body,
        audit,
        log.mock.calls,
        warn.mock.calls,
        error.mock.calls,
      ]);
      for (const value of [credentialA, credentialB, BINDING_KEY_V1, tag])
        expect(contents.includes(value)).toBe(false);
      const stored = JSON.stringify(
        await dataSource.query(`SELECT * FROM notification_provider_configurations`),
      );
      expect(stored.includes(credentialA)).toBe(false);
      expect(stored.includes(BINDING_KEY_V1)).toBe(false);
      expect(checker).toBeTruthy();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('fails legacy unbound configurations closed, without allowing environment fallback', async () => {
    await active();
    await dataSource.query(
      `UPDATE notification_provider_configurations SET credential_binding_scheme=NULL,credential_binding_key_version=NULL,credential_binding_mac=NULL WHERE channel='SMS'`,
    );
    expect((await service().sendSms(message())).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
    const overview = await service().getOverview();
    expect(overview.sms.gates.configured).toBe(false);
  });

  it('honors unconfigured and governed disabled behavior with zero external calls', async () => {
    const { maker, checker } = await actors();
    config().set('NOTIFICATION_SMS_PROVIDER', 'robase');
    expect((await service().sendSms(message())).success).toBe(false);
    const p = await propose(maker, { enabled: false });
    await decide(p.id, checker);
    await activate(p.id, checker);
    expect((await service().sendSms(message())).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
  });

  it('preserves durable retry and event idempotency for a blocked pre-send binding mismatch', async () => {
    await active();
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [id, `cust-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (id,customer_id,display_name,is_active) VALUES ($1,$2,'Synthetic',TRUE)`,
      [randomUUID(), id],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id,customer_id,type,value,normalized_value,is_primary,verified_at) VALUES ($1,$2,'PHONE','8031112222','8031112222',TRUE,NOW())`,
      [randomUUID(), id],
    );
    await dataSource.query(
      `INSERT INTO customer_preferences (id,customer_id,language_code,theme_code,notification_email_enabled,notification_sms_enabled,notification_push_enabled,notification_in_app_enabled,security_login_alerts,security_transaction_alerts,security_device_registration_alerts,security_biometric_allowed,version) VALUES ($1,$2,'EN','SYSTEM',FALSE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,FALSE,1)`,
      [randomUUID(), id],
    );
    config().set('ROBASE_API_KEY', credentialB);
    const eventKey = `customer.funding.approved:${randomUUID()}`;
    const command = {
      eventType: 'customer.funding.approved',
      eventKey,
      payload: { customerId: id, amountMinor: '25000', reference: 'M25O-FAKE' },
    };
    await dispatcher.dispatch(command);
    const failed = await dataSource.query(
      `SELECT status,attempts FROM notification_deliveries WHERE event_key=$1 AND channel='SMS'`,
      [eventKey],
    );
    expect(failed).toEqual([{ status: 'FAILED', attempts: 1 }]);
    expect(outboundCalls).toHaveLength(0);
    await dispatcher.dispatch(command);
    expect(outboundCalls).toHaveLength(0);
    expect(
      await dataSource.query(
        `SELECT id FROM notification_deliveries WHERE event_key=$1 AND channel='SMS'`,
        [eventKey],
      ),
    ).toHaveLength(1);
    config().set('ROBASE_API_KEY', credentialA);
    await dataSource.query(
      `UPDATE notification_deliveries SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE event_key=$1`,
      [eventKey],
    );
    await worker.tick();
    expect(
      await dataSource.query(
        `SELECT status,attempts FROM notification_deliveries WHERE event_key=$1 AND channel='SMS'`,
        [eventKey],
      ),
    ).toEqual([{ status: 'SENT', attempts: 2 }]);
    expect(outboundCalls).toHaveLength(1);
    await worker.tick();
    expect(outboundCalls).toHaveLength(1);
  });
  it('refuses a legacy approval and a tampered encrypted proposal before checker or activation', async () => {
    const { maker, checker } = await actors();
    const one = await propose(maker, { credentialAction: 'SET_ENCRYPTED', apiKey: credentialA });
    const two = await propose(maker, { credentialAction: 'SET_ENCRYPTED', apiKey: credentialB });
    await dataSource.query(
      `UPDATE notification_provider_config_proposals AS p SET proposed_encrypted_api_key=(SELECT proposed_encrypted_api_key FROM notification_provider_config_proposals WHERE id=$2) WHERE p.id=$1`,
      [one.id, two.id],
    );
    await decide(one.id, checker, 409);
    await decide(two.id, checker);
    await dataSource.query(
      `UPDATE notification_provider_config_proposals SET action_fingerprint_version=NULL,proposed_credential_source=NULL,credential_binding_scheme=NULL,credential_binding_key_version=NULL,credential_binding_mac=NULL WHERE id=$1`,
      [two.id],
    );
    await activate(two.id, checker, 409);
    expect(outboundCalls).toHaveLength(0);
    expect(
      await dataSource.query(
        `SELECT 1 FROM notification_provider_configurations WHERE channel='SMS'`,
      ),
    ).toHaveLength(0);
  });

  it('blocks proposal and activation with unavailable keys but allows a governed disable', async () => {
    const { maker, checker } = await actors();
    config().set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', '{}');
    await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(maker))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        credentialAction: 'USE_ENV_SECRET',
        reason: 'Synthetic unavailable key',
      })
      .expect(400);
    resetSecrets();
    const p = await propose(maker);
    await decide(p.id, checker);
    config().set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', '{}');
    await activate(p.id, checker, 409);
    resetSecrets();
    await activate(p.id, checker);
    config().set('NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON', '{}');
    const disable = await propose(maker, {
      expectedVersion: 1,
      enabled: false,
      credentialAction: 'CLEAR',
      reason: 'Governed fail-closed disable',
    });
    await decide(disable.id, checker);
    await activate(disable.id, checker);
    expect((await service().sendSms(message())).success).toBe(false);
    const rows = await dataSource.query(
      `SELECT version,enabled,credential_source FROM notification_provider_configurations WHERE channel='SMS'`,
    );
    expect(rows).toEqual([{ version: 2, enabled: false, credential_source: 'NONE' }]);
    expect(outboundCalls).toHaveLength(0);
  });

  it('does not promote readiness when a test-send completes after a new configuration activates', async () => {
    const { maker, checker } = await active();
    const ops = await provisionRole('OPERATIONS');
    let began!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    customTransportOverride = async () => {
      began();
      await gate;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', id: 'm25o-safe-ref' }),
      };
    };
    const sending = request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .then((response) => response);
    try {
      await started;
      const p = await propose(maker, {
        expectedVersion: 1,
        senderId: 'Updated',
        credentialAction: 'KEEP_EXISTING',
        reason: 'Synthetic config race',
      });
      await decide(p.id, checker);
      await activate(p.id, checker);
    } finally {
      release();
    }
    await sending;
    const rows = await dataSource.query(
      `SELECT version,delivery_tested_at,verified_at,last_test_at FROM notification_provider_configurations WHERE channel='SMS'`,
    );
    expect(rows).toEqual([
      { version: 2, delivery_tested_at: null, verified_at: null, last_test_at: null },
    ]);
    expect(outboundCalls).toHaveLength(1);
  });
  it('rejects copying the effective credential into proposal reasons or approval comments', async () => {
    const { maker, checker } = await actors();
    const base = {
      channel: 'SMS',
      expectedVersion: 0,
      provider: 'robase',
      enabled: true,
      baseUrl: 'https://api.robase.dev',
      credentialAction: 'USE_ENV_SECRET',
    };
    const rejected = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(maker))
      .send({
        ...base,
        reason: `accidental ${credentialA}`,
      })
      .expect(400);
    expect(JSON.stringify(rejected.body).includes(credentialA)).toBe(false);
    expect(
      await dataSource.query(`SELECT 1 FROM notification_provider_config_proposals`),
    ).toHaveLength(0);
    const p = await propose(maker);
    const rejectedComment = await request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${p.id}/approve`)
      .set(auth(checker))
      .send({ comment: `accidental ${credentialA}` })
      .expect(400);
    expect(JSON.stringify(rejectedComment.body).includes(credentialA)).toBe(false);
    const rows = await dataSource.query(
      `SELECT reason,decision_reason,status FROM notification_provider_config_proposals WHERE id=$1`,
      [p.id],
    );
    expect(rows[0].status).toBe('REQUESTED');
    expect(JSON.stringify(rows).includes(credentialA)).toBe(false);
    const audit = await dataSource.query(`SELECT new_values,previous_values FROM audit_events`);
    expect(JSON.stringify(audit).includes(credentialA)).toBe(false);
    expect(outboundCalls).toHaveLength(0);
  });
  it('binds Brevo and Resend independently and forbids cross-provider KEEP_EXISTING', async () => {
    const { maker, checker } = await actors();
    const brevoA = `xkeysib-${randomBytes(24).toString('hex')}tail`;
    const brevoB = `xkeysib-${randomBytes(24).toString('hex')}tail`;
    const resendA = `re_${randomBytes(24).toString('hex')}tail`;
    const resendB = `re_${randomBytes(24).toString('hex')}tail`;
    config().set('BREVO_API_KEY', brevoA);
    config().set('RESEND_API_KEY', resendA);
    customTransportOverride = async (url) =>
      url.includes('resend.com')
        ? { ok: true, status: 200, json: async () => ({ id: 'm25o-resend-fake' }) }
        : { ok: true, status: 201, json: async () => ({ messageId: 'm25o-brevo-fake' }) };
    const email = {
      ...message(),
      channel: 'EMAIL' as const,
      destination: 'synthetic@example.test',
      subject: 'Synthetic',
    };
    const base = {
      channel: 'EMAIL',
      expectedVersion: 0,
      provider: 'brevo',
      baseUrl: 'https://api.brevo.com',
      fromEmail: 'notifications@monienaija.ng',
      fromName: 'MonieNaija',
      spfConfigured: true,
      dkimConfigured: true,
      dmarcConfigured: true,
    };
    const brevo = await propose(maker, base);
    await decide(brevo.id, checker);
    await activate(brevo.id, checker);
    expect((await service().sendEmail(email)).success).toBe(true);
    outboundCalls.length = 0;
    config().set('BREVO_API_KEY', brevoB);
    expect((await service().sendEmail(email)).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
    await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(maker))
      .send({
        ...base,
        expectedVersion: 1,
        provider: 'resend',
        baseUrl: 'https://api.resend.com',
        enabled: true,
        credentialAction: 'KEEP_EXISTING',
        reason: 'Synthetic provider switch',
      })
      .expect(400);
    const resend = await propose(maker, {
      ...base,
      expectedVersion: 1,
      provider: 'resend',
      baseUrl: 'https://api.resend.com',
    });
    await decide(resend.id, checker);
    await activate(resend.id, checker);
    expect((await service().sendEmail(email)).success).toBe(true);
    outboundCalls.length = 0;
    config().set('RESEND_API_KEY', resendB);
    expect((await service().sendEmail(email)).success).toBe(false);
    expect(outboundCalls).toHaveLength(0);
  });

  it('fences a delayed Brevo verification from promoting the next configuration version', async () => {
    const { maker, checker } = await actors();
    const brevo = `xkeysib-${randomBytes(24).toString('hex')}tail`;
    config().set('BREVO_API_KEY', brevo);
    const ops = await provisionRole('OPERATIONS');
    const base = {
      channel: 'EMAIL',
      expectedVersion: 0,
      provider: 'brevo',
      baseUrl: 'https://api.brevo.com',
      fromEmail: 'notifications@monienaija.ng',
      fromName: 'MonieNaija',
      spfConfigured: true,
      dkimConfigured: true,
      dmarcConfigured: true,
    };
    const p = await propose(maker, base);
    await decide(p.id, checker);
    await activate(p.id, checker);
    let began!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    customTransportOverride = async (url) => {
      if (url.endsWith('/account')) {
        began();
        await gate;
        return { ok: true, status: 200, json: async () => ({ email: 'synthetic@example.test' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ senders: [{ email: 'notifications@monienaija.ng', active: true }] }),
      };
    };
    const verifying = request(app.getHttpServer())
      .post(`${CFG_BASE}/EMAIL/verify`)
      .set(auth(ops.token))
      .then((response) => response);
    try {
      await started;
      const next = await propose(maker, {
        ...base,
        expectedVersion: 1,
        fromName: 'Updated',
        credentialAction: 'KEEP_EXISTING',
        reason: 'Synthetic verification race',
      });
      await decide(next.id, checker);
      await activate(next.id, checker);
    } finally {
      release();
    }
    expect((await verifying).status).toBe(409);
    const rows = await dataSource.query(
      `SELECT version,verified_at,verification_method FROM notification_provider_configurations WHERE channel='EMAIL'`,
    );
    expect(rows).toEqual([{ version: 2, verified_at: null, verification_method: null }]);
  });
  it('refuses to approve a proposal whose independent approval record has a different fingerprint', async () => {
    const { maker, checker } = await actors();
    const p = await propose(maker);
    await dataSource.query(
      `UPDATE privileged_action_approvals SET action_fingerprint=$1 WHERE id=(SELECT approval_id FROM notification_provider_config_proposals WHERE id=$2)`,
      ['f'.repeat(64), p.id],
    );
    await decide(p.id, checker, 409);
    const rows = await dataSource.query(
      `SELECT p.status AS proposal_status,a.status AS approval_status FROM notification_provider_config_proposals p JOIN privileged_action_approvals a ON a.id=p.approval_id WHERE p.id=$1`,
      [p.id],
    );
    expect(rows).toEqual([{ proposal_status: 'REQUESTED', approval_status: 'REQUESTED' }]);
    expect(outboundCalls).toHaveLength(0);
  });
  it('rejects expired or cancelled approvals without allowing activation or delivery', async () => {
    const { maker, checker } = await actors();
    const expired = await propose(maker);
    await dataSource.query(
      `UPDATE privileged_action_approvals SET expires_at=NOW()-INTERVAL '1 second' WHERE id=(SELECT approval_id FROM notification_provider_config_proposals WHERE id=$1)`,
      [expired.id],
    );
    await decide(expired.id, checker, 403);
    await activate(expired.id, checker, 409);
    const cancelled = await propose(maker);
    await dataSource.query(
      `UPDATE privileged_action_approvals SET status='CANCELLED',cancelled_at=NOW() WHERE id=(SELECT approval_id FROM notification_provider_config_proposals WHERE id=$1)`,
      [cancelled.id],
    );
    await decide(cancelled.id, checker, 403);
    await activate(cancelled.id, checker, 409);
    const approved = await propose(maker);
    await decide(approved.id, checker);
    await dataSource.query(
      `UPDATE privileged_action_approvals SET expires_at=NOW()-INTERVAL '1 second' WHERE id=(SELECT approval_id FROM notification_provider_config_proposals WHERE id=$1)`,
      [approved.id],
    );
    await activate(approved.id, checker, 403);
    expect(
      await dataSource.query(
        `SELECT status FROM notification_provider_config_proposals WHERE id=$1`,
        [approved.id],
      ),
    ).toEqual([{ status: 'APPROVED' }]);
    expect(
      await dataSource.query(
        `SELECT 1 FROM notification_provider_configurations WHERE channel='SMS'`,
      ),
    ).toHaveLength(0);
    expect(outboundCalls).toHaveLength(0);
  });
});
