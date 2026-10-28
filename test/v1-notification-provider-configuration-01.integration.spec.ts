/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-require-imports */
import { randomBytes, randomUUID } from 'node:crypto';
import { Logger, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
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
} from '../src/notification/notification-provider-config.service';
import { SAFE_PROVIDER_REF_PATTERN } from '../src/notification/provider-security';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
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
const LIVE_ROBASE_KEY_1 = 'robe_' + '1a2b3c4d5e6f7081'.repeat(4);
const LIVE_ROBASE_KEY_2 = 'robe_' + '9988776655443322'.repeat(4);
const LIVE_BREVO_KEY_1 = 'xkeysib-' + 'abcdef0123456789'.repeat(4) + '-Key1';

interface RecordedHttpCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

describe('V1-NOTIFICATION-PROVIDER-CONFIGURATION-01 — Governed Robase SMS & Brevo Email (real PostgreSQL + HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;
  let readinessService: ProductionReadinessService;

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
            message: `Sensitive upstream diagnostic ${LIVE_ROBASE_KEY_1}`,
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
          message: `Sensitive Brevo prose ${LIVE_BREVO_KEY_1}`,
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
    process.env.NOTIFICATION_WORKER_ENABLED = 'true';
    process.env.NOTIFICATION_WORKER_POLL_INTERVAL_MS = '60000';

    dataSource = await createIntegrationDataSource('notifprovcfg');

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
    readinessService = moduleRef.get(ProductionReadinessService);
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

  it('1. migration 100 schema, production readiness sync, catalogue invariants, and DB CHECK constraints reject plaintext secrets & self-approval', async () => {
    const readiness = await readinessService.getReadiness();
    expect(readiness.migrations.status).toBe('ok');

    // Exact role assignments for notification.provider.view and notification.provider.configure
    const viewRoles: Array<{ role_key: string }> = await dataSource.query(
      `SELECT r.role_key
         FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
        WHERE rf.function_code = 'notification.provider.view' AND rf.is_active = TRUE
        ORDER BY r.role_key`,
    );
    expect(viewRoles.map((r) => r.role_key)).toEqual([
      'FINANCE_AUDITOR',
      'FINANCE_CONTROLLER',
      'OPERATIONS',
      'SUPER_ADMIN',
    ]);

    const configRoles: Array<{ role_key: string; access_type: string }> = await dataSource.query(
      `SELECT r.role_key, rf.access_type
         FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
        WHERE rf.function_code = 'notification.provider.configure' AND rf.is_active = TRUE
        ORDER BY r.role_key`,
    );
    expect(configRoles).toEqual([
      { role_key: 'FINANCE_CONTROLLER', access_type: 'APPROVE' },
      { role_key: 'SUPER_ADMIN', access_type: 'INITIATE' },
    ]);

    // DB CHECK constraint rejects plaintext API keys directly at PostgreSQL level
    await expect(
      dataSource.query(
        `INSERT INTO notification_provider_configurations
           (channel, provider, enabled, base_url, credential_source, encrypted_api_key,
            encryption_key_version, key_fingerprint, updated_by, approved_by)
         VALUES
           ('SMS', 'robase', FALSE, 'https://api.robase.dev', 'ENCRYPTED_DB', $1, 'v1', '****7081', 'u1', 'u2')`,
        [LIVE_ROBASE_KEY_1],
      ),
    ).rejects.toThrow();
  });

  it('2. enforces HTTP authentication, negative role permissions, read-only auditor blocks, and MFA assurance gates', async () => {
    // Unauthenticated -> 401
    await request(app.getHttpServer()).get(CFG_BASE).expect(401);
    await request(app.getHttpServer()).post(`${CFG_BASE}/proposals`).send({}).expect(401);

    // Unrelated roles (TREASURY, CUSTOMER_SERVICE) -> 403 on GET and POST
    const treasury = await provisionRole('TREASURY');
    const customerService = await provisionRole('CUSTOMER_SERVICE');
    await request(app.getHttpServer()).get(CFG_BASE).set(auth(treasury.token)).expect(403);
    await request(app.getHttpServer()).get(CFG_BASE).set(auth(customerService.token)).expect(403);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(treasury.token))
      .send({})
      .expect(403);

    // OPERATIONS and FINANCE_AUDITOR can GET non-secret overview, but CANNOT propose changes (403)
    const ops = await provisionRole('OPERATIONS');
    const auditor = await provisionRole('FINANCE_AUDITOR');
    const opsGet = await request(app.getHttpServer()).get(CFG_BASE).set(auth(ops.token)).expect(200);
    expect(opsGet.body.sms.lifecycleState).toBe('CONSOLE_ONLY');
    expect(opsGet.body.email.lifecycleState).toBe('NOT_CONFIGURED');

    await request(app.getHttpServer()).get(CFG_BASE).set(auth(auditor.token)).expect(200);

    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(ops.token))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Unauthorized ops attempt to configure Robase',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(auditor.token))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Read-only auditor attempt to configure Robase',
      })
      .expect(403);

    // Workforce session establishment rejects PASSWORD assurance without MFA, AND a stale/non-MFA
    // session in DB is rejected at HTTP boundary (401/403).
    await expect(provisionRole('SUPER_ADMIN', 'PASSWORD')).rejects.toThrow(/MFA/);
    const superAdminDegraded = await provisionRole('SUPER_ADMIN', 'MFA');
    await dataSource.query(
      `UPDATE a2_workforce_sessions
          SET assurance_level = 'PASSWORD'
        WHERE principal_id = $1`,
      [superAdminDegraded.principalId],
    );
    const noMfaRes = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(superAdminDegraded.token))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Attempt without MFA assurance',
      });
    expect([401, 403]).toContain(noMfaRes.status);
  });

  it('3. enforces strict self-approval prohibition and rejects xsmtpsib- SMTP keys on Brevo', async () => {
    const dualRoleMaker = await provisionRole(['SUPER_ADMIN', 'FINANCE_CONTROLLER']);

    // Reject xsmtpsib- SMTP password with understandable 400 guidance
    const smtpKeyAttempt = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(dualRoleMaker.token))
      .send({
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: false,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: 'xsmtpsib-abcdef1234567890abcdef1234567890',
        spfConfigured: false,
        dkimConfigured: false,
        dmarcConfigured: false,
        reason: 'Accidental SMTP relay password entry',
      })
      .expect(400);
    expect(String(smtpKeyAttempt.body.message)).toContain('xkeysib-');

    // Valid maker proposal by dual-role principal
    const created = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(dualRoleMaker.token))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Stage Robase SMS credentials under maker-checker',
      })
      .expect(201);

    // Initiating administrator CANNOT approve their own proposal even if holding FINANCE_CONTROLLER!
    const selfApprove = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${created.body.id}/approve`)
      .set(auth(dualRoleMaker.token))
      .send({ comment: 'Attempting self approval' })
      .expect(403);
    expect(String(selfApprove.body.message)).toContain('SELF_APPROVAL_FORBIDDEN');

    // Cannot activate an unapproved REQUESTED proposal -> 409 Conflict
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${created.body.id}/activate`)
      .set(auth(dualRoleMaker.token))
      .expect(409);
  });

  it('4. full governed lifecycle: CONFIGURED -> VERIFIED -> ENABLED -> DELIVERY_TESTED -> PRODUCTION_READY, strict secret redaction, rotation reset, and fail-closed missing key', async () => {
    const makerToken = await loginSuperAdmin();
    const checker = await provisionRole('FINANCE_CONTROLLER');
    const ops = await provisionRole('OPERATIONS');

    // --- STAGE 1: Propose, Approve, and Activate Staged (Disabled) Robase & Brevo -> CONFIGURED ---
    const smsProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Stage Robase live SMS key for connectivity verification',
      })
      .expect(201);

    const emailProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: false,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        replyToEmail: 'support@monienaija.ng',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_BREVO_KEY_1,
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: false,
        reason: 'Stage Brevo v3 REST API key and verified sender identity',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${smsProp.body.id}/approve`)
      .set(auth(checker.token))
      .send({ comment: 'Verified Robase workspace approval' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${emailProp.body.id}/approve`)
      .set(auth(checker.token))
      .send({ comment: 'Verified Brevo account & DNS records' })
      .expect(200);

    const smsAct1 = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${smsProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);
    const emailAct1 = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${emailProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);

    // State 1: CONFIGURED (saved key alone NEVER marks VERIFIED, ENABLED, DELIVERY_TESTED, or PRODUCTION_READY!)
    expect(smsAct1.body.configuration.lifecycleState).toBe('CONFIGURED');
    expect(smsAct1.body.configuration.gates).toEqual({
      configured: true,
      verified: false,
      enabled: false,
      deliveryTested: false,
      productionReady: false,
    });
    expect(emailAct1.body.configuration.lifecycleState).toBe('CONFIGURED');
    expect(emailAct1.body.configuration.gates).toEqual({
      configured: true,
      verified: false,
      enabled: false,
      deliveryTested: false,
      productionReady: false,
    });

    // Fail-closed while disabled: test-send returns 400 PROVIDER_DISABLED and makes ZERO HTTP calls
    const disabledSmsTest = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(400);
    expect(disabledSmsTest.body.message).toBe('SMS_PROVIDER_DISABLED');
    const disabledEmailTest = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'EMAIL', destination: 'ops@monienaija.ng' })
      .expect(400);
    expect(disabledEmailTest.body.message).toBe('EMAIL_PROVIDER_DISABLED');
    expect(outboundCalls.length).toBe(0);

    // --- STAGE 2: Verify Connection & Cryptographic Integrity -> VERIFIED ---
    const smsVerify = await request(app.getHttpServer())
      .post(`${CFG_BASE}/SMS/verify`)
      .set(auth(ops.token))
      .expect(200);
    expect(smsVerify.body.verified).toBe(true);
    expect(smsVerify.body.snapshot.lifecycleState).toBe('VERIFIED');

    const emailVerify = await request(app.getHttpServer())
      .post(`${CFG_BASE}/EMAIL/verify`)
      .set(auth(ops.token))
      .expect(200);
    expect(emailVerify.body.verified).toBe(true);
    expect(emailVerify.body.snapshot.lifecycleState).toBe('VERIFIED');
    // Verify Brevo connection called GET /v3/account and GET /v3/senders with api-key header
    expect(outboundCalls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.brevo.com/v3/account',
      'GET https://api.brevo.com/v3/senders',
    ]);
    expect(outboundCalls[0]!.headers['api-key']).toBe(LIVE_BREVO_KEY_1);

    // --- STAGE 3: Enable Providers via Maker-Checker (KEEP_EXISTING) -> ENABLED ---
    outboundCalls.length = 0;
    const smsEnableProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'SMS',
        expectedVersion: 1,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'KEEP_EXISTING',
        reason: 'Enable verified Robase SMS provider for live test-send',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${smsEnableProp.body.id}/approve`)
      .set(auth(checker.token))
      .expect(200);
    const smsAct2 = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${smsEnableProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);
    expect(smsAct2.body.configuration.lifecycleState).toBe('ENABLED');
    expect(smsAct2.body.configuration.gates).toEqual({
      configured: true,
      verified: true,
      enabled: true,
      deliveryTested: false,
      productionReady: false,
    });

    const emailEnableProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'EMAIL',
        expectedVersion: 1,
        provider: 'brevo',
        enabled: true,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        replyToEmail: 'support@monienaija.ng',
        credentialAction: 'KEEP_EXISTING',
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: false,
        reason: 'Enable verified Brevo Email provider for live test-send',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${emailEnableProp.body.id}/approve`)
      .set(auth(checker.token))
      .expect(200);
    const emailAct2 = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${emailEnableProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);
    expect(emailAct2.body.configuration.lifecycleState).toBe('ENABLED');

    // --- STAGE 4: Controlled Test-Send -> SMS reaches PRODUCTION_READY; EMAIL reaches DELIVERY_TESTED (awaiting DMARC) ---
    const smsTest = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(201);
    expect(smsTest.body.status).toBe('SENT');
    expect(smsTest.body.provider).toBe('robase');

    const emailTest = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'EMAIL', destination: 'ops.verify@monienaija.ng' })
      .expect(201);
    expect(emailTest.body.status).toBe('SENT');
    expect(emailTest.body.provider).toBe('brevo');

    // Assert exact Robase & Brevo HTTP wire contracts (and NO unverified sender_id wire field on Robase!)
    expect(outboundCalls.length).toBe(2);
    expect(outboundCalls[0]!.url).toBe('https://api.robase.dev/v1/sms/send');
    expect(outboundCalls[0]!.headers['Authorization']).toBe(`Bearer ${LIVE_ROBASE_KEY_1}`);
    const robaseWire = JSON.parse(outboundCalls[0]!.body!);
    expect(robaseWire.phone_number).toBe('+2348012345678');
    expect(robaseWire.sender_id).toBeUndefined();

    expect(outboundCalls[1]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(outboundCalls[1]!.headers['api-key']).toBe(LIVE_BREVO_KEY_1);
    const brevoWire = JSON.parse(outboundCalls[1]!.body!);
    expect(brevoWire.sender).toEqual({
      email: 'notifications@monienaija.ng',
      name: 'MonieNaija',
    });
    expect(brevoWire.to).toEqual([{ email: 'ops.verify@monienaija.ng' }]);

    const afterTestOverview = await request(app.getHttpServer())
      .get(CFG_BASE)
      .set(auth(ops.token))
      .expect(200);
    expect(afterTestOverview.body.sms.lifecycleState).toBe('PRODUCTION_READY');
    expect(afterTestOverview.body.email.lifecycleState).toBe('DELIVERY_TESTED');
    expect(afterTestOverview.body.email.gates).toEqual({
      configured: true,
      verified: true,
      enabled: true,
      deliveryTested: true,
      productionReady: false,
    });

    // --- STAGE 5: Complete DMARC attestation on EMAIL -> PRODUCTION_READY ---
    const dmarcProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'EMAIL',
        expectedVersion: 2,
        provider: 'brevo',
        enabled: true,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        replyToEmail: 'support@monienaija.ng',
        credentialAction: 'KEEP_EXISTING',
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        reason: 'Confirm DMARC TXT record published on monienaija.ng',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${dmarcProp.body.id}/approve`)
      .set(auth(checker.token))
      .expect(200);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${dmarcProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);

    const prodReadyOverview = await request(app.getHttpServer())
      .get(CFG_BASE)
      .set(auth(ops.token))
      .expect(200);
    expect(prodReadyOverview.body.sms.lifecycleState).toBe('PRODUCTION_READY');
    expect(prodReadyOverview.body.sms.gates.productionReady).toBe(true);
    expect(prodReadyOverview.body.email.lifecycleState).toBe('PRODUCTION_READY');
    expect(prodReadyOverview.body.email.gates.productionReady).toBe(true);

    // --- CREDENTIAL REDACTION AUDIT ACROSS ALL DB TABLES AND HTTP GET ENDPOINTS ---
    const statusSnapshot = await request(app.getHttpServer())
      .get(STATUS_PATH)
      .set(auth(ops.token))
      .expect(200);
    const proposalsSnapshot = await request(app.getHttpServer())
      .get(`${CFG_BASE}/proposals`)
      .set(auth(ops.token))
      .expect(200);
    const dbConfigs = await dataSource.query(
      `SELECT * FROM notification_provider_configurations`,
    );
    const dbProposals = await dataSource.query(
      `SELECT * FROM notification_provider_config_proposals`,
    );
    const dbAudits = await dataSource.query(
      `SELECT action, previous_values, new_values FROM audit_events`,
    );

    // Encrypted at rest in DB with MNNPS1:v1: envelope; zero plaintext keys anywhere in DB!
    expect(dbConfigs.length).toBe(2);
    for (const row of dbConfigs) {
      expect(String(row.encrypted_api_key).startsWith('MNNPS1:v1:')).toBe(true);
    }
    const dbSerialized = JSON.stringify({ dbConfigs, dbProposals, dbAudits });
    expect(dbSerialized).not.toContain(LIVE_ROBASE_KEY_1);
    expect(dbSerialized).not.toContain(LIVE_BREVO_KEY_1);
    expect(dbSerialized).not.toContain('ops.verify@monienaija.ng');

    // HTTP GET responses never expose MNNPS1 ciphertexts OR plaintext keys — only ****xxxx fingerprints!
    const httpSerialized = JSON.stringify({
      overview: prodReadyOverview.body,
      status: statusSnapshot.body,
      proposals: proposalsSnapshot.body,
    });
    expect(httpSerialized).not.toContain(LIVE_ROBASE_KEY_1);
    expect(httpSerialized).not.toContain(LIVE_BREVO_KEY_1);
    expect(httpSerialized).not.toContain('MNNPS1:');
    expect(prodReadyOverview.body.sms.keyFingerprint).toBe('****7081');
    expect(prodReadyOverview.body.email.keyFingerprint).toBe('****Key1');

    // --- CREDENTIAL ROTATION RESETS VERIFIED / DELIVERY_TESTED / PRODUCTION_READY ---
    const rotateProp = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals`)
      .set(auth(makerToken))
      .send({
        channel: 'SMS',
        expectedVersion: 2,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_2,
        reason: 'Scheduled quarterly Robase live API key rotation',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${rotateProp.body.id}/approve`)
      .set(auth(checker.token))
      .expect(200);
    const rotated = await request(app.getHttpServer())
      .post(`${CFG_BASE}/proposals/${rotateProp.body.id}/activate`)
      .set(auth(checker.token))
      .expect(200);

    expect(rotated.body.configuration.version).toBe(3);
    expect(rotated.body.configuration.keyFingerprint).toBe('****3322');
    // Rotated key drops back to ENABLED (verified=false, deliveryTested=false, productionReady=false)!
    expect(rotated.body.configuration.lifecycleState).toBe('ENABLED');
    expect(rotated.body.configuration.gates).toEqual({
      configured: true,
      verified: false,
      enabled: true,
      deliveryTested: false,
      productionReady: false,
    });

    // --- FAIL-CLOSED WHEN REQUIRED ENCRYPTION KEY VERSION IS UNAVAILABLE (NEVER FALLS BACK TO CONSOLE) ---
    await dataSource.query(
      `UPDATE notification_provider_configurations
          SET encryption_key_version = 'v99_missing',
              encrypted_api_key = regexp_replace(encrypted_api_key, '^MNNPS1:v1:', 'MNNPS1:v99_missing:')`,
    );

    const missingKeyOverview = await request(app.getHttpServer())
      .get(CFG_BASE)
      .set(auth(ops.token))
      .expect(200);
    expect(missingKeyOverview.body.sms.lifecycleState).toBe('MISCONFIGURED');
    expect(missingKeyOverview.body.sms.misconfigurationCode).toBe(
      'PROVIDER_ENCRYPTION_KEY_VERSION_MISSING',
    );
    expect(missingKeyOverview.body.email.lifecycleState).toBe('MISCONFIGURED');

    outboundCalls.length = 0;
    const failClosedSend = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(ops.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(400);
    expect(failClosedSend.body.message).toBe('PROVIDER_ENCRYPTION_KEY_VERSION_MISSING');
    expect(outboundCalls.length).toBe(0);
  });

  it('5. preserves business notification outbox dispatch, customer email opt-out, and worker retry semantics across governed Robase & Brevo', async () => {
    const makerToken = await loginSuperAdmin();
    const checker = await provisionRole('FINANCE_CONTROLLER');

    // Activate enabled Robase SMS + Brevo Email
    for (const payload of [
      {
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Activate Robase for outbox integration test',
      },
      {
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: true,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_BREVO_KEY_1,
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        reason: 'Activate Brevo for outbox integration test',
      },
    ]) {
      const p = await request(app.getHttpServer())
        .post(`${CFG_BASE}/proposals`)
        .set(auth(makerToken))
        .send(payload)
        .expect(201);
      await request(app.getHttpServer())
        .post(`${CFG_BASE}/proposals/${p.body.id}/approve`)
        .set(auth(checker.token))
        .expect(200);
      await request(app.getHttpServer())
        .post(`${CFG_BASE}/proposals/${p.body.id}/activate`)
        .set(auth(checker.token))
        .expect(200);
    }

    // Enable transfer.completed EMAIL trigger in notification_event_configurations
    await dataSource.query(
      `UPDATE notification_event_configurations
          SET is_enabled = TRUE, version = version + 1, updated_at = NOW()
        WHERE event_type = 'transfer.completed' AND channel = 'EMAIL'`,
    );

    // Seed two customers: custOptIn (email enabled) and custOptOut (email opted out)
    async function seedCustomer(phone: string, email: string, emailEnabled: boolean): Promise<string> {
      const cid = randomUUID();
      await dataSource.query(
        `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED')`,
        [cid, `cust-${randomUUID()}`],
      );
      await dataSource.query(
        `INSERT INTO customer_profiles (id, customer_id, display_name, is_active)
         VALUES ($1, $2, $3, TRUE)`,
        [randomUUID(), cid, `Cust ${cid.slice(0, 4)}`],
      );
      await dataSource.query(
        `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary)
         VALUES ($1, $2, 'PHONE', $3, $3, TRUE),
                ($4, $2, 'EMAIL', $5, $6, TRUE)`,
        [randomUUID(), cid, phone, randomUUID(), email, email.toLowerCase()],
      );
      await dataSource.query(
        `INSERT INTO customer_preferences
           (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled,
            notification_push_enabled, notification_in_app_enabled, security_login_alerts,
            security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
         VALUES ($1, $2, 'EN', 'SYSTEM', $3, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, 1)`,
        [randomUUID(), cid, emailEnabled],
      );
      return cid;
    }

    const custOptIn = await seedCustomer('8031112222', 'adaeze@example.com', true);
    const custOptOut = await seedCustomer('8033334444', 'chinedu@example.com', false);

    outboundCalls.length = 0;

    // 5a. Opted-in customer receives BOTH Robase SMS and Brevo Email, idempotently
    const eventKey1 = `transfer.completed:${randomUUID()}`;
    const dispatch1 = await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: eventKey1,
      payload: {
        sourceCustomerId: custOptIn,
        amountMinor: '250000',
        transferId: 'tx-prov-0001',
        reference: 'REF-PROV-1',
      },
    });
    expect(dispatch1.dispatched).toBe(2);
    expect(outboundCalls.map((c) => c.url).sort()).toEqual([
      'https://api.brevo.com/v3/smtp/email',
      'https://api.robase.dev/v1/sms/send',
    ]);

    // Duplicate dispatch with same eventKey is a strict idempotent no-op
    outboundCalls.length = 0;
    const dup = await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: eventKey1,
      payload: {
        sourceCustomerId: custOptIn,
        amountMinor: '250000',
        transferId: 'tx-prov-0001',
        reference: 'REF-PROV-1',
      },
    });
    expect(dup.dispatched).toBe(0);
    expect(outboundCalls.length).toBe(0);

    // 5b. Opted-out email customer: SMS sends via Robase, EMAIL is SKIPPED (EMAIL_OPT_OUT)
    const eventKey2 = `transfer.completed:${randomUUID()}`;
    await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: eventKey2,
      payload: {
        sourceCustomerId: custOptOut,
        amountMinor: '100000',
        transferId: 'tx-prov-0002',
        reference: 'REF-PROV-2',
      },
    });
    const optOutRows: Array<{ channel: string; status: string; last_error: string | null }> =
      await dataSource.query(
        `SELECT channel, status, last_error
           FROM notification_deliveries
          WHERE event_key = $1
          ORDER BY channel`,
        [eventKey2],
      );
    expect(optOutRows).toEqual([
      { channel: 'EMAIL', status: 'SKIPPED', last_error: 'EMAIL_OPT_OUT' },
      { channel: 'SMS', status: 'SENT', last_error: null },
    ]);

    // 5c. Transient 503 failure -> NotificationWorkerService retries via governed Robase & Brevo to SENT
    robaseNextStatus = 503;
    brevoSendNextStatus = 503;
    const eventKey3 = `transfer.completed:${randomUUID()}`;
    const failedDispatch = await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: eventKey3,
      payload: {
        sourceCustomerId: custOptIn,
        amountMinor: '75000',
        transferId: 'tx-prov-0003',
        reference: 'REF-PROV-3',
      },
    });
    expect(failedDispatch.failed).toBe(2);

    // Fast-forward updated_at lease so worker claims both failed rows immediately
    await dataSource.query(
      `UPDATE notification_deliveries
          SET updated_at = NOW() - INTERVAL '5 minutes'
        WHERE event_key = $1`,
      [eventKey3],
    );

    robaseNextStatus = 200;
    brevoSendNextStatus = 201;
    const retryStats = await worker.tick();
    expect(retryStats.retriesSent).toBe(2);

    const recoveredRows: Array<{ channel: string; status: string; attempts: number }> =
      await dataSource.query(
        `SELECT channel, status, attempts
           FROM notification_deliveries
          WHERE event_key = $1
          ORDER BY channel`,
        [eventKey3],
      );
    expect(recoveredRows).toEqual([
      { channel: 'EMAIL', status: 'SENT', attempts: 2 },
      { channel: 'SMS', status: 'SENT', attempts: 2 },
    ]);
  });

  it('6. provider-status enforces AuthorizationService audit & 11-role matrix, hiding key fingerprints, sender config, and lastTest sentinels from delivery-only roles', async () => {
    const superAdminToken = await loginSuperAdmin();
    const controller = await provisionRole('FINANCE_CONTROLLER', 'MFA');
    const auditor = await provisionRole('FINANCE_AUDITOR', 'MFA');
    const operations = await provisionRole('OPERATIONS', 'MFA');

    // Provision a custom non-seeded role carrying ONLY notification.view_deliveries (without expanding any seeded role grant)
    const deliveryViewerRoleRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO authorization_roles (role_key, display_name, description, is_active, is_system_seeded)
       VALUES ('NOTIF_DELIVERY_VIEWER_ONLY', 'Delivery Viewer Only', 'Test-only role carrying notification.view_deliveries without notification.provider.view', true, false)
       RETURNING id`,
    );
    const deliveryViewerRoleId = deliveryViewerRoleRows[0]!.id;
    await dataSource.query(
      `INSERT INTO authorization_role_functions (role_id, function_code, access_type, is_active, assigned_by)
       VALUES ($1, 'notification.view_deliveries', 'VIEW', true, 'test-harness')`,
      [deliveryViewerRoleId],
    );
    const deliveryOnlyViewer = await provisionRole('NOTIF_DELIVERY_VIEWER_ONLY', 'MFA');

    try {
      const sentinelSenderId = 'SNTSMS99';
      const sentinelFromEmail = 'sentinel-from-8811@monienaija.ng';
      const sentinelFromName = 'SentinelBrandName8811';
      const sentinelReplyTo = 'sentinel-reply-8811@monienaija.ng';
      brevoVerifiedSenders = [sentinelFromEmail];

      // Activate governed Robase SMS & Brevo Email with sentinel sender metadata + encrypted keys
      const smsProp = await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/provider-config/proposals')
        .set(auth(superAdminToken))
        .send({
          channel: 'SMS',
          expectedVersion: 0,
          provider: 'robase',
          enabled: true,
          senderId: sentinelSenderId,
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_ROBASE_KEY_1,
          reason: 'Configure Robase with sentinel sender metadata for status hardening test',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/notifications/provider-config/proposals/${smsProp.body.id}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'Approved SMS status sentinel config' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/notifications/provider-config/proposals/${smsProp.body.id}/activate`)
        .set(auth(controller.token))
        .expect(200);

      const emailProp = await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/provider-config/proposals')
        .set(auth(superAdminToken))
        .send({
          channel: 'EMAIL',
          expectedVersion: 0,
          provider: 'brevo',
          enabled: true,
          fromEmail: sentinelFromEmail,
          fromName: sentinelFromName,
          replyToEmail: sentinelReplyTo,
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_BREVO_KEY_1,
          spfConfigured: true,
          dkimConfigured: true,
          dmarcConfigured: true,
          reason: 'Configure Brevo with sentinel sender metadata for status hardening test',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/notifications/provider-config/proposals/${emailProp.body.id}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'Approved EMAIL status sentinel config' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/notifications/provider-config/proposals/${emailProp.body.id}/activate`)
        .set(auth(controller.token))
        .expect(200);

      // Run Brevo verify + test-send so `lastTest` carries destinationMasked & providerRef sentinels
      await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/provider-config/EMAIL/verify')
        .set(auth(superAdminToken))
        .expect(200);
      const testSendRes = await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/test-send')
        .set(auth(operations.token))
        .send({ channel: 'EMAIL', destination: 'sentinel-probe@monienaija.ng' })
        .expect(201);
      const sentinelProviderRef = testSendRes.body.providerRef as string;
      expect(typeof sentinelProviderRef).toBe('string');

      // A) Unauthenticated -> 401 + AUTHORIZATION_DECISION
      await request(app.getHttpServer())
        .get('/api/v1/internal/notifications/provider-status')
        .expect(401);

      // B) All 7 seeded catalogue roles with NEITHER notification.provider.view NOR notification.view_deliveries -> 403 FUNCTION_MISSING
      const deniedRoles = [
        'FINANCE_PREPARER',
        'TREASURY',
        'RISK_FRAUD',
        'AGENT_NETWORK_MANAGER',
        'ADMINISTRATOR',
        'COMPLIANCE',
        'CUSTOMER_SERVICE',
      ] as const;
      for (const roleKey of deniedRoles) {
        const roleSession = await provisionRole(roleKey, 'MFA');
        const denied = await request(app.getHttpServer())
          .get('/api/v1/internal/notifications/provider-status')
          .set(auth(roleSession.token))
          .expect(403);
        expect(denied.body.message).toBe('FUNCTION_MISSING');

        const decisionRows: Array<{ action: string; new_values: Record<string, any> }> =
          await dataSource.query(
            `SELECT action, new_values
               FROM audit_events
              WHERE entity_type = 'AUTHORIZATION_DECISION'
                AND actor = $1
              ORDER BY occurred_at DESC
              LIMIT 1`,
            [roleSession.principalId],
          );
        expect(decisionRows.length).toBe(1);
        expect(decisionRows[0]!.action).toBe('DENIED');
        expect(decisionRows[0]!.new_values.resourceType).toBe('notification-provider-status');
        expect(decisionRows[0]!.new_values.reason).toBe('FUNCTION_MISSING');
      }

      // C) Principal entitled ONLY to notification.view_deliveries -> 200 strict coarse MINIMAL schema (F-04)
      const minimalRes = await request(app.getHttpServer())
        .get('/api/v1/internal/notifications/provider-status')
        .set(auth(deliveryOnlyViewer.token))
        .expect(200);

      // Exact full-schema assertion: ONLY coarse channel availability booleans exist
      expect(minimalRes.body).toEqual({
        channels: ['SMS', 'PUSH', 'EMAIL'],
        projectionScope: 'MINIMAL',
        sms: { available: true },
        push: { available: false },
        email: { available: true },
      });
      expect(Object.keys(minimalRes.body as Record<string, unknown>).sort()).toEqual([
        'channels',
        'email',
        'projectionScope',
        'push',
        'sms',
      ]);
      expect(Object.keys(minimalRes.body.sms as Record<string, unknown>)).toEqual(['available']);
      expect(Object.keys(minimalRes.body.push as Record<string, unknown>)).toEqual(['available']);
      expect(Object.keys(minimalRes.body.email as Record<string, unknown>)).toEqual(['available']);
      expect(minimalRes.body.sms.provider).toBeUndefined();
      expect(minimalRes.body.sms.enabled).toBeUndefined();
      expect(minimalRes.body.sms.configured).toBeUndefined();
      expect(minimalRes.body.sms.deliveryTested).toBeUndefined();
      expect(minimalRes.body.sms.lifecycleState).toBeUndefined();
      expect(minimalRes.body.sms.keyFingerprint).toBeUndefined();
      expect(minimalRes.body.sms.senderId).toBeUndefined();
      expect(minimalRes.body.sms.lastTest).toBeUndefined();
      expect(minimalRes.body.email.provider).toBeUndefined();
      expect(minimalRes.body.email.enabled).toBeUndefined();
      expect(minimalRes.body.email.configured).toBeUndefined();
      expect(minimalRes.body.email.deliveryTested).toBeUndefined();
      expect(minimalRes.body.email.lifecycleState).toBeUndefined();
      expect(minimalRes.body.email.keyFingerprint).toBeUndefined();
      expect(minimalRes.body.email.from).toBeUndefined();
      expect(minimalRes.body.email.replyTo).toBeUndefined();
      expect(minimalRes.body.email.fromName).toBeUndefined();
      expect(minimalRes.body.email.domainAuth).toBeUndefined();
      expect(minimalRes.body.email.lastTest).toBeUndefined();
      expect(minimalRes.body.worker).toBeUndefined();

      const rawMinimal = JSON.stringify(minimalRes.body);
      expect(rawMinimal).not.toContain('robase');
      expect(rawMinimal).not.toContain('brevo');
      expect(rawMinimal).not.toContain('PRODUCTION_READY');
      expect(rawMinimal).not.toContain('****7081');
      expect(rawMinimal).not.toContain('****Key1');
      expect(rawMinimal).not.toContain(sentinelSenderId);
      expect(rawMinimal).not.toContain(sentinelFromEmail);
      expect(rawMinimal).not.toContain(sentinelFromName);
      expect(rawMinimal).not.toContain(sentinelReplyTo);
      expect(rawMinimal).not.toContain(sentinelProviderRef);
      expect(rawMinimal).not.toContain('se***@monienaija.ng');
      expect(rawMinimal).not.toContain('api.robase.dev');
      expect(rawMinimal).not.toContain('api.brevo.com');

      const allowAudit: Array<{ action: string; new_values: Record<string, any> }> =
        await dataSource.query(
          `SELECT action, new_values
             FROM audit_events
            WHERE entity_type = 'AUTHORIZATION_DECISION'
              AND actor = $1
            ORDER BY occurred_at DESC
            LIMIT 1`,
          [deliveryOnlyViewer.principalId],
        );
      expect(allowAudit.length).toBe(1);
      expect(allowAudit[0]!.action).toBe('ALLOWED');
      expect(allowAudit[0]!.new_values.resourceType).toBe('notification-provider-status');
      expect(allowAudit[0]!.new_values.action).toBe('notification.view_deliveries');

      // D) Provider-view roles (SUPER_ADMIN, FINANCE_CONTROLLER, FINANCE_AUDITOR, OPERATIONS) -> 200 FULL non-secret projection
      for (const token of [superAdminToken, controller.token, auditor.token, operations.token]) {
        const fullRes = await request(app.getHttpServer())
          .get('/api/v1/internal/notifications/provider-status')
          .set(auth(token))
          .expect(200);
        expect(fullRes.body.projectionScope).toBe('FULL');
        expect(fullRes.body.sms.keyFingerprint).toBe('****7081');
        expect(fullRes.body.sms.senderId).toBe(sentinelSenderId);
        expect(fullRes.body.email.keyFingerprint).toBe('****Key1');
        expect(fullRes.body.email.from).toBe(sentinelFromEmail);
        expect(fullRes.body.email.fromName).toBe(sentinelFromName);
        expect(fullRes.body.email.replyTo).toBe(sentinelReplyTo);
        expect(fullRes.body.email.lastTest.providerRef).toBe(sentinelProviderRef);

        const rawFull = JSON.stringify(fullRes.body);
        expect(rawFull).not.toContain(LIVE_ROBASE_KEY_1);
        expect(rawFull).not.toContain(LIVE_BREVO_KEY_1);
        expect(rawFull).not.toContain('MNNPS1:');
      }
    } finally {
      await dataSource.query(
        `DELETE FROM authorization_role_functions WHERE role_id = $1`,
        [deliveryViewerRoleId],
      );
      await dataSource.query(`DELETE FROM authorization_roles WHERE id = $1`, [
        deliveryViewerRoleId,
      ]);
    }
  });

  it('7. restricts NOTIFICATION_PROVIDER_CONFIG and NOTIFICATION_TEST_SEND in GET /internal/audit unless caller holds notification.provider.view while preserving DB records & oversight', async () => {
    const superAdminToken = await loginSuperAdmin();
    const controller = await provisionRole('FINANCE_CONTROLLER', 'MFA');
    const auditor = await provisionRole('FINANCE_AUDITOR', 'MFA');
    const operations = await provisionRole('OPERATIONS', 'MFA');
    const compliance = await provisionRole('COMPLIANCE', 'MFA');
    const customerService = await provisionRole('CUSTOMER_SERVICE', 'MFA');
    const financePreparer = await provisionRole('FINANCE_PREPARER', 'MFA');

    const auditSentinelEmail = 'audit-sentinel-7744@monienaija.ng';
    const auditSentinelName = 'AuditSentinelBrand7744';
    const auditSentinelComment = 'AUDIT_SENTINEL_CHECKER_COMMENT_7744';
    brevoVerifiedSenders = [auditSentinelEmail];

    const propRes = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/provider-config/proposals')
      .set(auth(superAdminToken))
      .send({
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: true,
        fromEmail: auditSentinelEmail,
        fromName: auditSentinelName,
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_BREVO_KEY_1,
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        reason: 'Audit visibility hardening integration check',
      })
      .expect(201);
    const proposalId = propRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/internal/notifications/provider-config/proposals/${proposalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: auditSentinelComment })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/notifications/provider-config/proposals/${proposalId}/activate`)
      .set(auth(controller.token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set(auth(operations.token))
      .send({ channel: 'EMAIL', destination: 'audit-test-dest@monienaija.ng' })
      .expect(201);

    // Insert a general non-provider audit event to verify normal audit visibility stays intact
    const generalEntityId = randomUUID();
    await dataSource.query(
      `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, new_values, occurred_at, created_at)
       VALUES ($1, 'WALLET_OPERATION', $2, 'GENERAL_AUDIT_VISIBLE_SENTINEL', 'system', '{"ok":true}'::jsonb, NOW(), NOW())`,
      [randomUUID(), generalEntityId],
    );

    // Underlying PostgreSQL audit_events table preserves all NOTIFICATION_PROVIDER_CONFIG & NOTIFICATION_TEST_SEND rows
    const dbProviderAuditCount: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count
         FROM audit_events
        WHERE entity_type IN ('NOTIFICATION_PROVIDER_CONFIG', 'NOTIFICATION_TEST_SEND')`,
    );
    expect(Number(dbProviderAuditCount[0]!.count)).toBeGreaterThanOrEqual(4);

    // Unentitled callers (COMPLIANCE, CUSTOMER_SERVICE, FINANCE_PREPARER) see general audit rows ONLY — zero provider audit sentinels
    for (const unentitled of [compliance, customerService, financePreparer]) {
      const genericList = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?limit=200')
        .set(auth(unentitled.token))
        .expect(200);

      expect(Array.isArray(genericList.body)).toBe(true);
      const genericItems = genericList.body as Array<{ action?: string; entityType?: string }>;
      expect(
        genericItems.some((e) => e.action === 'GENERAL_AUDIT_VISIBLE_SENTINEL'),
      ).toBe(true);
      expect(
        genericItems.some(
          (e) =>
            e.entityType === 'NOTIFICATION_PROVIDER_CONFIG' ||
            e.entityType === 'NOTIFICATION_TEST_SEND',
        ),
      ).toBe(false);

      const serializedGeneric = JSON.stringify(genericList.body);
      expect(serializedGeneric).not.toContain(auditSentinelEmail);
      expect(serializedGeneric).not.toContain(auditSentinelName);
      expect(serializedGeneric).not.toContain(auditSentinelComment);
      expect(serializedGeneric).not.toContain('****Key1');
      expect(serializedGeneric).not.toContain('au***@monienaija.ng');

      // Direct entityType / entityId filters also return empty [] for unentitled callers
      const byEntityType = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?entityType=NOTIFICATION_PROVIDER_CONFIG')
        .set(auth(unentitled.token))
        .expect(200);
      expect(byEntityType.body).toEqual([]);

      const byTestType = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?entityType=NOTIFICATION_TEST_SEND')
        .set(auth(unentitled.token))
        .expect(200);
      expect(byTestType.body).toEqual([]);

      const byEntityId = await request(app.getHttpServer())
        .get(`/api/v1/internal/audit?entityId=${proposalId}`)
        .set(auth(unentitled.token))
        .expect(200);
      const byEntityIdItems = byEntityId.body as Array<{ entityType?: string }>;
      expect(
        byEntityIdItems.some(
          (e) =>
            e.entityType === 'NOTIFICATION_PROVIDER_CONFIG' ||
            e.entityType === 'NOTIFICATION_TEST_SEND' ||
            e.entityType === 'PRIVILEGED_ACTION_APPROVAL',
        ),
      ).toBe(false);
      const serializedByEntityId = JSON.stringify(byEntityId.body);
      expect(serializedByEntityId).not.toContain(auditSentinelEmail);
      expect(serializedByEntityId).not.toContain(auditSentinelName);
      expect(serializedByEntityId).not.toContain(auditSentinelComment);
      expect(serializedByEntityId).not.toContain('****Key1');
    }

    // Authorized oversight callers (FINANCE_AUDITOR, SUPER_ADMIN, FINANCE_CONTROLLER, OPERATIONS) see full non-secret provider audit records
    for (const entitledToken of [
      auditor.token,
      superAdminToken,
      controller.token,
      operations.token,
    ]) {
      const oversightRes = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?entityType=NOTIFICATION_PROVIDER_CONFIG&limit=50')
        .set(auth(entitledToken))
        .expect(200);

      expect(oversightRes.body.length).toBeGreaterThanOrEqual(3);
      const serializedOversight = JSON.stringify(oversightRes.body);
      expect(serializedOversight).toContain(auditSentinelEmail);
      expect(serializedOversight).toContain(auditSentinelComment);
      expect(serializedOversight).toContain('****Key1');
      expect(serializedOversight).not.toContain(LIVE_BREVO_KEY_1);
      expect(serializedOversight).not.toContain('MNNPS1:');
    }

    // Unfiltered GET /internal/audit by a notification.provider.view holder ALSO records an AUTHORIZATION_DECISION read-audit event
    await request(app.getHttpServer())
      .get('/api/v1/internal/audit?limit=25')
      .set(auth(auditor.token))
      .expect(200);

    const unfilteredOversightDecision: Array<{ action: string; new_values: Record<string, any> }> =
      await dataSource.query(
        `SELECT action, new_values
           FROM audit_events
          WHERE entity_type = 'AUTHORIZATION_DECISION'
            AND actor = $1
            AND new_values ->> 'resourceType' = 'notification-provider-config-audit'
          ORDER BY occurred_at DESC
          LIMIT 1`,
        [auditor.principalId],
      );
    expect(unfilteredOversightDecision.length).toBe(1);
    expect(unfilteredOversightDecision[0]!.action).toBe('ALLOWED');
    expect(unfilteredOversightDecision[0]!.new_values.action).toBe('notification.provider.view');
  });

  it('8. prevents PostgreSQL trigger/driver exceptions, bound parameters, and MNNPS1 envelopes from leaking into HTTP responses or logs on transaction failure', async () => {
    const superAdminToken = await loginSuperAdmin();

    const capturedLogs: string[] = [];
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        capturedLogs.push(JSON.stringify(args));
      });
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        capturedLogs.push(JSON.stringify(args));
      });

    await dataSource.query(`
      CREATE OR REPLACE FUNCTION test_fail_notif_provider_proposal_insert()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'PG_TRIGGER_SENTINEL_9988 table=notification_provider_config_proposals envelope=%', NEW.proposed_encrypted_api_key
          USING ERRCODE = 'P0001';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_test_fail_notif_provider_proposal
        BEFORE INSERT ON notification_provider_config_proposals
        FOR EACH ROW
        EXECUTE FUNCTION test_fail_notif_provider_proposal_insert();
    `);

    try {
      const failRes = await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/provider-config/proposals')
        .set(auth(superAdminToken))
        .send({
          channel: 'SMS',
          expectedVersion: 0,
          provider: 'robase',
          enabled: false,
          senderId: 'MonieNaija',
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_ROBASE_KEY_1,
          reason: 'Trigger simulated PostgreSQL failure during proposal insert',
        })
        .expect(500);

      const responseBlob = JSON.stringify(failRes.body);
      const logsBlob = capturedLogs.join('\n');

      for (const blob of [responseBlob, logsBlob]) {
        expect(blob).not.toContain('PG_TRIGGER_SENTINEL_9988');
        expect(blob).not.toContain('MNNPS1:');
        expect(blob).not.toContain(LIVE_ROBASE_KEY_1);
        expect(blob).not.toContain('notification_provider_config_proposals');
        expect(blob).not.toContain('test_fail_notif_provider_proposal_insert');
      }
      expect(logsBlob).toContain('"sqlState":"P0001"');

      // Transaction rolled back cleanly and pre-created privileged_action_approvals row was cancelled
      const proposalRows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text AS count FROM notification_provider_config_proposals`,
      );
      expect(Number(proposalRows[0]!.count)).toBe(0);

      const approvalRows: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM privileged_action_approvals WHERE resource_type = 'NOTIFICATION_PROVIDER_CONFIG_PROPOSAL'`,
      );
      expect(approvalRows.length).toBe(1);
      expect(approvalRows[0]!.status).toBe('CANCELLED');
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      await dataSource.query(
        `DROP TRIGGER IF EXISTS trg_test_fail_notif_provider_proposal ON notification_provider_config_proposals`,
      );
      await dataSource.query(
        `DROP FUNCTION IF EXISTS test_fail_notif_provider_proposal_insert()`,
      );
    }
  });

  it('9. F-01: strips credential-like and financial sentinels in upstream Robase/Brevo error codes across test-send, verify, provider-status, provider-config, PostgreSQL columns, audit JSON, and logs', async () => {
    const superAdminToken = await loginSuperAdmin();
    const controller = await provisionRole('FINANCE_CONTROLLER', 'MFA');
    const operations = await provisionRole('OPERATIONS', 'MFA');

    const smsSentinel = 'robe_SENTINEL_CRED_881122.TX_NGN_950000_ACCT_0123456789';
    const emailSentinel = 'xkeysib-SENTINEL_CRED_993344.TX_NGN_950000_ACCT_9876543210';

    const capturedLogs: string[] = [];
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((...args: unknown[]) => {
        capturedLogs.push(JSON.stringify(args));
      });
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        capturedLogs.push(JSON.stringify(args));
      });

    try {
      // Activate both SMS (Robase) and EMAIL (Brevo) via maker-checker
      const smsProp = await request(app.getHttpServer())
        .post(PROPOSALS_PATH)
        .set(auth(superAdminToken))
        .send({
          channel: 'SMS',
          expectedVersion: 0,
          provider: 'robase',
          enabled: true,
          baseUrl: 'https://api.robase.dev',
          senderId: 'MonieNaija',
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_ROBASE_KEY_1,
          reason: 'F-01 SMS error sanitization verification',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${smsProp.body.id}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'Approved SMS F-01' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${smsProp.body.id}/activate`)
        .set(auth(controller.token))
        .expect(200);

      const emailProp = await request(app.getHttpServer())
        .post(PROPOSALS_PATH)
        .set(auth(superAdminToken))
        .send({
          channel: 'EMAIL',
          expectedVersion: 0,
          provider: 'brevo',
          enabled: true,
          baseUrl: 'https://api.brevo.com',
          fromEmail: 'notifications@monienaija.ng',
          fromName: 'MonieNaija',
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_BREVO_KEY_1,
          spfConfigured: true,
          dkimConfigured: true,
          dmarcConfigured: true,
          reason: 'F-01 EMAIL error sanitization verification',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${emailProp.body.id}/approve`)
        .set(auth(controller.token))
        .send({ comment: 'Approved EMAIL F-01' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`${PROPOSALS_PATH}/${emailProp.body.id}/activate`)
        .set(auth(controller.token))
        .expect(200);

      // Upstream returns 401 with pattern-matching credential & financial sentinels in error.type / code
      customTransportOverride = async (url) => {
        if (url.includes('robase.dev')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: { type: smsSentinel, message: `Raw key ${LIVE_ROBASE_KEY_1}` },
            }),
          };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({
            code: emailSentinel,
            message: `Raw key ${LIVE_BREVO_KEY_1}`,
          }),
        };
      };

      const verifyRes = await request(app.getHttpServer())
        .post(`${OVERVIEW_PATH}/EMAIL/verify`)
        .set(auth(superAdminToken))
        .expect(200);
      expect(verifyRes.body.verified).toBe(false);
      expect(verifyRes.body.errorCode).toBe('BREVO_VERIFY_HTTP_401');

      const smsTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(operations.token))
        .send({ channel: 'SMS', destination: '+2348012345678' })
        .expect(201);
      expect(smsTestRes.body.status).toBe('FAILED');
      expect(smsTestRes.body.errorCode).toBe('ROBASE_HTTP_401:unknown');

      const emailTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(operations.token))
        .send({ channel: 'EMAIL', destination: 'ops.f01@monienaija.ng' })
        .expect(201);
      expect(emailTestRes.body.status).toBe('FAILED');
      expect(emailTestRes.body.errorCode).toBe('BREVO_HTTP_401');

      const fullStatusRes = await request(app.getHttpServer())
        .get(STATUS_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(fullStatusRes.body.sms.lastTest.errorCode).toBe('ROBASE_HTTP_401:unknown');
      expect(fullStatusRes.body.email.lastTest.errorCode).toBe('BREVO_HTTP_401');

      const overviewRes = await request(app.getHttpServer())
        .get(OVERVIEW_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(overviewRes.body.sms.lastTest.errorCode).toBe('ROBASE_HTTP_401:unknown');
      expect(overviewRes.body.email.lastTest.errorCode).toBe('BREVO_HTTP_401');
      expect(overviewRes.body.email.verification.lastVerificationError).toBe(
        'BREVO_VERIFY_HTTP_401',
      );

      const dbConfigRows = await dataSource.query(
        `SELECT channel, last_verification_error, last_test_error_code FROM notification_provider_configurations`,
      );
      const dbAuditRows = await dataSource.query(
        `SELECT entity_type, action, new_values FROM audit_events WHERE entity_type IN ('NOTIFICATION_TEST_SEND', 'NOTIFICATION_PROVIDER_CONFIG')`,
      );

      for (const surface of [
        JSON.stringify(verifyRes.body),
        JSON.stringify(smsTestRes.body),
        JSON.stringify(emailTestRes.body),
        JSON.stringify(fullStatusRes.body),
        JSON.stringify(overviewRes.body),
        JSON.stringify(dbConfigRows),
        JSON.stringify(dbAuditRows),
        capturedLogs.join('\n'),
      ]) {
        expect(surface).not.toContain('SENTINEL_CRED_881122');
        expect(surface).not.toContain('SENTINEL_CRED_993344');
        expect(surface).not.toContain('TX_NGN_950000');
        expect(surface).not.toContain('ACCT_0123456789');
        expect(surface).not.toContain('ACCT_9876543210');
        expect(surface).not.toContain('robe_');
        expect(surface).not.toContain('xkeysib-');
      }
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('10. F-02: rejects unpinned public hosts, lookalikes, custom ports, IP literals, redirects, DNS rebinding, and tampered DB base_url values without sending credentials', async () => {
    const http = await import('node:http');
    const { createPinnedProviderHttpFetch } = await import(
      '../src/notification/provider-security'
    );
    const superAdminToken = await loginSuperAdmin();
    const controller = await provisionRole('FINANCE_CONTROLLER', 'MFA');
    const operations = await provisionRole('OPERATIONS', 'MFA');

    // A) Negative proposal tests: arbitrary public HTTPS hosts, lookalikes, ports, credentials, paths, private/metadata IPs
    const invalidRobaseUrls = [
      'https://attacker-controlled.example.test',
      'https://api.robase.dev.attacker.test',
      'https://robase.dev',
      'https://api.robase.dev:8443',
      'https://api.robase.dev:443',
      'https://api.robase.dev/evil',
      'https://user:secret@api.robase.dev',
      'https://api.robase.dev?token=1',
      'http://api.robase.dev',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://169.254.169.254',
      'https://[::1]',
      'https://[fe80::1]',
      'https://api.brevo.com',
    ];

    for (const badUrl of invalidRobaseUrls) {
      await request(app.getHttpServer())
        .post(PROPOSALS_PATH)
        .set(auth(superAdminToken))
        .send({
          channel: 'SMS',
          expectedVersion: 0,
          provider: 'robase',
          enabled: false,
          baseUrl: badUrl,
          senderId: 'MonieNaija',
          credentialAction: 'SET_ENCRYPTED',
          apiKey: LIVE_ROBASE_KEY_1,
          reason: 'Negative host pinning proposal test',
        })
        .expect(400);
    }
    expect(outboundCalls.length).toBe(0);

    // B) Activate valid pinned Robase config, then verify 302 redirect is blocked without forwarding Authorization header
    const validProp = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(superAdminToken))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Activate pinned Robase for redirect and tamper defense checks',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${validProp.body.id}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'Approved' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${validProp.body.id}/activate`)
      .set(auth(controller.token))
      .expect(200);

    outboundCalls.length = 0;
    customTransportOverride = async () => ({
      ok: false,
      status: 302,
      json: async () => null,
    });

    const redirectSend = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(operations.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(201);
    expect(redirectSend.body.status).toBe('FAILED');
    expect(redirectSend.body.errorCode).toBe('ROBASE_EGRESS_BLOCKED');
    expect(outboundCalls.length).toBe(1);
    expect(outboundCalls[0]!.url).toBe('https://api.robase.dev/v1/sms/send');

    // C) Direct DB tamper of base_url fails closed as MISCONFIGURED / PROVIDER_BASE_URL_UNTRUSTED with ZERO outbound calls
    outboundCalls.length = 0;
    customTransportOverride = null;
    await dataSource.query(
      `UPDATE notification_provider_configurations SET base_url = 'https://attacker-controlled.example.test' WHERE channel = 'SMS'`,
    );

    const tamperedTest = await request(app.getHttpServer())
      .post(TEST_SEND_PATH)
      .set(auth(operations.token))
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(400);
    expect(tamperedTest.body.message).toBe('PROVIDER_BASE_URL_UNTRUSTED');
    expect(outboundCalls.length).toBe(0);

    // D) Real local TCP/HTTP listener proves createPinnedProviderHttpFetch blocks DNS rebinding to 127.0.0.1 / 169.254.169.254 with zero socket connections
    let localServerConnections = 0;
    const localServer = http.createServer((_req, res) => {
      localServerConnections += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"id":"stolen"}');
    });
    await new Promise<void>((resolve) => localServer.listen(0, '127.0.0.1', () => resolve()));
    try {
      for (const reboundIp of ['127.0.0.1', '10.0.0.9', '169.254.169.254', '::1']) {
        const pinnedFetch = createPinnedProviderHttpFetch({
          lookupImpl: async () => [
            { address: reboundIp, family: reboundIp.includes(':') ? 6 : 4 },
          ],
        });
        await expect(
          pinnedFetch('https://api.robase.dev/v1/sms/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${LIVE_ROBASE_KEY_1}` },
            body: '{}',
            signal: new AbortController().signal,
          }),
        ).rejects.toThrow();
      }
      expect(localServerConnections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
    }
  });

  it('11. F-03: enforces atomic 5-per-rolling-hour test-send quota under concurrent bursts and preserves quota across post-send DB persistence failures', async () => {
    const superAdminToken = await loginSuperAdmin();
    const controller = await provisionRole('FINANCE_CONTROLLER', 'MFA');
    const operations = await provisionRole('OPERATIONS', 'MFA');

    // Activate Brevo EMAIL config
    const emailProp = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(superAdminToken))
      .send({
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: true,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_BREVO_KEY_1,
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        reason: 'Enable Brevo for F-03 atomic concurrency quota verification',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${emailProp.body.id}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'Approved' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${PROPOSALS_PATH}/${emailProp.body.id}/activate`)
      .set(auth(controller.token))
      .expect(200);

    // Slow down provider HTTP response (75ms) to widen the concurrency window
    outboundCalls.length = 0;
    customTransportOverride = async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return {
        ok: true,
        status: 201,
        json: async () => ({ messageId: `<concurrent-${randomUUID().slice(0, 8)}@brevo>` }),
      };
    };

    // Scenario A (exact Arena 4 reproducer): 2 prior attempts + 8 simultaneous parallel requests for SUPER_ADMIN
    for (let i = 0; i < 2; i += 1) {
      await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(superAdminToken))
        .send({ channel: 'EMAIL', destination: `prior${i}@monienaija.ng` })
        .expect(201);
    }
    expect(outboundCalls.length).toBe(2);

    const burst8 = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        request(app.getHttpServer())
          .post(TEST_SEND_PATH)
          .set(auth(superAdminToken))
          .send({ channel: 'EMAIL', destination: `burst${idx}@monienaija.ng` }),
      ),
    );
    const statuses8 = burst8.map((r) => r.status);
    expect(statuses8.filter((s) => s === 201).length).toBe(3);
    expect(statuses8.filter((s) => s === 429).length).toBe(5);
    expect(outboundCalls.length).toBe(5); // Strictly capped at 2 + 3 = 5 provider-reaching calls!

    // Scenario B: Independent principal (OPERATIONS) fires 10 simultaneous requests (with 4th/5th failing upstream and post-send DB failure injected)
    outboundCalls.length = 0;
    let opsProviderCalls = 0;
    customTransportOverride = async () => {
      opsProviderCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        ok: false,
        status: 503,
        json: async () => ({ code: 'service_unavailable' }),
      };
    };

    await dataSource.query(`
      CREATE OR REPLACE FUNCTION test_fail_post_send_config_update()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.last_test_at IS DISTINCT FROM OLD.last_test_at THEN
          RAISE EXCEPTION 'SIMULATED_POST_SEND_CONFIG_UPDATE_FAILURE' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_test_fail_post_send_config_update
        BEFORE UPDATE ON notification_provider_configurations
        FOR EACH ROW
        EXECUTE FUNCTION test_fail_post_send_config_update();
    `);

    try {
      const burst10 = await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
          request(app.getHttpServer())
            .post(TEST_SEND_PATH)
            .set(auth(operations.token))
            .send({ channel: 'EMAIL', destination: `opsburst${idx}@monienaija.ng` }),
        ),
      );
      const statuses10 = burst10.map((r) => r.status);
      expect(statuses10.filter((s) => s === 201).length).toBe(5);
      expect(statuses10.filter((s) => s === 429).length).toBe(5);
      expect(opsProviderCalls).toBe(5);

      // Even after post-send config update failures AND failed upstream sends, 11th attempt is still 429
      const eleventh = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(operations.token))
        .send({ channel: 'EMAIL', destination: 'opsburst11@monienaija.ng' })
        .expect(429);
      expect(eleventh.body.message).toBe('NOTIFICATION_TEST_RATE_LIMITED');
      expect(opsProviderCalls).toBe(5);
    } finally {
      await dataSource.query(
        `DROP TRIGGER IF EXISTS trg_test_fail_post_send_config_update ON notification_provider_configurations`,
      );
      await dataSource.query(`DROP FUNCTION IF EXISTS test_fail_post_send_config_update()`);
    }
  });

  it('12. F-05: rejects truthy/falsy non-boolean types for enabled, spfConfigured, dkimConfigured, and dmarcConfigured with 400', async () => {
    const superAdminToken = await loginSuperAdmin();

    const basePayload = {
      channel: 'EMAIL',
      expectedVersion: 0,
      provider: 'brevo',
      enabled: false,
      baseUrl: 'https://api.brevo.com',
      fromEmail: 'notifications@monienaija.ng',
      fromName: 'MonieNaija',
      credentialAction: 'SET_ENCRYPTED',
      apiKey: LIVE_BREVO_KEY_1,
      spfConfigured: false,
      dkimConfigured: false,
      dmarcConfigured: false,
      reason: 'Strict boolean input validation check',
    };

    const malformedPayloads: Array<Record<string, unknown>> = [
      { ...basePayload, enabled: 'false' },
      { ...basePayload, enabled: 'true' },
      { ...basePayload, enabled: 0 },
      { ...basePayload, enabled: 1 },
      { ...basePayload, enabled: null },
      { ...basePayload, enabled: [] },
      (() => {
        const clone: Record<string, unknown> = { ...basePayload };
        delete clone.enabled;
        return clone;
      })(),
      { ...basePayload, spfConfigured: 'false' },
      { ...basePayload, spfConfigured: 1 },
      { ...basePayload, spfConfigured: null },
      { ...basePayload, dkimConfigured: 'true' },
      { ...basePayload, dmarcConfigured: 'false' },
      { ...basePayload, expectedVersion: '0' },
      { ...basePayload, requestTimeoutMs: '5000' },
    ];

    for (const invalidBody of malformedPayloads) {
      await request(app.getHttpServer())
        .post(PROPOSALS_PATH)
        .set(auth(superAdminToken))
        .send(invalidBody)
        .expect(400);
    }

    const proposalsCount: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM notification_provider_config_proposals`,
    );
    expect(Number(proposalsCount[0]!.count)).toBe(0);
  });

  it('13. F-01 adversarial 2xx vendor response IDs (Robase, Brevo, Resend): replaces credential & financial sentinels with opaque keyed-HMAC references across HTTP, FULL status, config overview, DB columns, delivery rows, audit JSON, and captured logs; rejects malformed/overlong/control-char IDs; and protects historical persisted rows', async () => {
    const superAdminToken = await loginSuperAdmin();
    const checker = await provisionRole('FINANCE_CONTROLLER');
    const opsBatch1 = await provisionRole('OPERATIONS');
    const opsBatch2 = await provisionRole('OPERATIONS');
    const opsBatch3 = await provisionRole('OPERATIONS');
    const providerConfigSvc = app.get(NotificationProviderConfigService);

    const LIVE_RESEND_KEY_1 = 're_' + 'a1b2c3d4e5f60718'.repeat(3);

    const ROBASE_2XX_SENTINEL =
      'robe_2XX_CRED_SENTINEL_77112233_TX_NGN_95000000_ACCT_0123456789_PIN_4821';
    const BREVO_2XX_SENTINEL =
      '<xkeysib-2XX_CRED_SENTINEL_88442211@TX-NGN-76543210-ACCT-9988776655-OTP-619204.example>';
    const BREVO_BATCH_2XX_SENTINEL =
      'MNNPS1:v1:2XX_BATCH_ENVELOPE_LEAK:robe_5544332211:LEDGER_JRN_909090';
    const RESEND_2XX_SENTINEL =
      're_2XX_CRED_SENTINEL_66554433_TX_NGN_44332211_ACCT_1122334455_BEARER_SECRET';
    const HISTORICAL_DB_SENTINEL =
      'xkeysib-HISTORICAL_DB_REF_918273_TX_NGN_55000000_ACCT_2233445566';
    const HISTORICAL_AUDIT_SENTINEL =
      'xkeysib-HISTORICAL_AUDIT_REF_654321_TX_NGN_33000000_ACCT_7788990011';

    const ALL_FORBIDDEN_SUBSTRINGS = [
      ROBASE_2XX_SENTINEL,
      BREVO_2XX_SENTINEL,
      BREVO_BATCH_2XX_SENTINEL,
      RESEND_2XX_SENTINEL,
      HISTORICAL_DB_SENTINEL,
      HISTORICAL_AUDIT_SENTINEL,
      '2XX_CRED_SENTINEL',
      '2XX_BATCH_ENVELOPE_LEAK',
      'HISTORICAL_DB_REF',
      'HISTORICAL_AUDIT_REF',
      'TX_NGN_95000000',
      'TX-NGN-76543210',
      'TX_NGN_44332211',
      'TX_NGN_55000000',
      'TX_NGN_33000000',
      '0123456789',
      '9988776655',
      '1122334455',
      '2233445566',
      '7788990011',
      'PIN_4821',
      'OTP-619204',
      'LEDGER_JRN_909090',
    ];

    const assertZeroSentinels = (surface: unknown, label: string) => {
      const serialized = typeof surface === 'string' ? surface : JSON.stringify(surface);
      for (const token of ALL_FORBIDDEN_SUBSTRINGS) {
        if (serialized.includes(token)) {
          throw new Error(`Sentinel "${token}" leaked in ${label}`);
        }
      }
    };

    const capturedLogs: string[] = [];
    const recordLog = (...args: unknown[]) => {
      capturedLogs.push(
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      );
    };
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(recordLog);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(recordLog);
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(recordLog);
    const dbgSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(recordLog);

    try {
      // Helper to propose + approve + activate a provider config cleanly
      const activateConfig = async (payload: Record<string, unknown>) => {
        const prop = await request(app.getHttpServer())
          .post(PROPOSALS_PATH)
          .set(auth(superAdminToken))
          .send(payload)
          .expect(201);
        await request(app.getHttpServer())
          .post(`${PROPOSALS_PATH}/${prop.body.id}/approve`)
          .set(auth(checker.token))
          .send({ comment: 'Approved F-01 adversarial vendor config' })
          .expect(200);
        await request(app.getHttpServer())
          .post(`${PROPOSALS_PATH}/${prop.body.id}/activate`)
          .set(auth(checker.token))
          .expect(200);
      };

      await activateConfig({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: true,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Activate Robase for F-01 2xx sentinel verification',
      });

      await activateConfig({
        channel: 'EMAIL',
        expectedVersion: 0,
        provider: 'brevo',
        enabled: true,
        baseUrl: 'https://api.brevo.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_BREVO_KEY_1,
        spfConfigured: true,
        dkimConfigured: true,
        dmarcConfigured: true,
        reason: 'Activate Brevo for F-01 2xx sentinel verification',
      });

      // --- A) Successful 2xx sentinel responses on Robase & Brevo (messageId + messageIds) ---
      let brevoUseBatchArray = false;
      customTransportOverride = async (url) => {
        if (url === 'https://api.robase.dev/v1/sms/send') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: ROBASE_2XX_SENTINEL,
              status: 'pending',
              phone_number: '+2348012345678',
              credit_cost: 1,
            }),
          };
        }
        if (url === 'https://api.brevo.com/v3/smtp/email') {
          return {
            ok: true,
            status: 201,
            json: async () =>
              brevoUseBatchArray
                ? { messageIds: [BREVO_BATCH_2XX_SENTINEL] }
                : { messageId: BREVO_2XX_SENTINEL },
          };
        }
        if (url === 'https://api.resend.com/emails') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: RESEND_2XX_SENTINEL }),
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      };

      const robaseTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(opsBatch1.token))
        .send({ channel: 'SMS', destination: '+2348012345678' })
        .expect(201);
      expect(robaseTestRes.body.status).toBe('SENT');
      expect(robaseTestRes.body.providerRef).toMatch(/^pvr1:robase:[0-9a-f]{32}$/);
      assertZeroSentinels(robaseTestRes.body, 'Robase test-send HTTP response');

      const brevoTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(opsBatch1.token))
        .send({ channel: 'EMAIL', destination: 'ops.f01@monienaija.ng' })
        .expect(201);
      expect(brevoTestRes.body.status).toBe('SENT');
      expect(brevoTestRes.body.providerRef).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);
      assertZeroSentinels(brevoTestRes.body, 'Brevo messageId test-send HTTP response');

      brevoUseBatchArray = true;
      const brevoBatchTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(opsBatch1.token))
        .send({ channel: 'EMAIL', destination: 'ops.f01.batch@monienaija.ng' })
        .expect(201);
      expect(brevoBatchTestRes.body.status).toBe('SENT');
      expect(brevoBatchTestRes.body.providerRef).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);
      assertZeroSentinels(brevoBatchTestRes.body, 'Brevo messageIds test-send HTTP response');

      // Inspect FULL provider-status & provider-config overview after Robase + Brevo sends
      const fullStatusAfterBrevo = await request(app.getHttpServer())
        .get(STATUS_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(fullStatusAfterBrevo.body.projectionScope).toBe('FULL');
      expect(fullStatusAfterBrevo.body.sms.lastTest.providerRef).toBe(
        robaseTestRes.body.providerRef,
      );
      expect(fullStatusAfterBrevo.body.email.lastTest.providerRef).toBe(
        brevoBatchTestRes.body.providerRef,
      );
      assertZeroSentinels(fullStatusAfterBrevo.body, 'FULL provider-status after Robase+Brevo');

      const overviewAfterBrevo = await request(app.getHttpServer())
        .get(OVERVIEW_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(overviewAfterBrevo.body.sms.lastTest.providerRef).toBe(
        robaseTestRes.body.providerRef,
      );
      expect(overviewAfterBrevo.body.email.lastTest.providerRef).toBe(
        brevoBatchTestRes.body.providerRef,
      );
      assertZeroSentinels(overviewAfterBrevo.body, 'provider-config overview after Robase+Brevo');

      // Also verify outbox/dispatcher + worker retry delivery path writes safe pvr1:* refs into notification_deliveries.provider_ref
      await dataSource.query(
        `UPDATE notification_event_configurations
            SET is_enabled = TRUE, version = version + 1, updated_at = NOW()
          WHERE event_type = 'transfer.completed' AND channel = 'EMAIL'`,
      );
      const custId = randomUUID();
      await dataSource.query(
        `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED')`,
        [custId, `cust-f01-${randomUUID()}`],
      );
      await dataSource.query(
        `INSERT INTO customer_profiles (id, customer_id, display_name, is_active)
         VALUES ($1, $2, 'F01 Customer', TRUE)`,
        [randomUUID(), custId],
      );
      await dataSource.query(
        `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary)
         VALUES ($1, $2, 'PHONE', '8039998877', '8039998877', TRUE),
                ($3, $2, 'EMAIL', $4, 'f01.customer@example.com', TRUE)`,
        [randomUUID(), custId, randomUUID(), 'f01.customer@example.com'],
      );
      await dataSource.query(
        `INSERT INTO customer_preferences
           (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled,
            notification_push_enabled, notification_in_app_enabled, security_login_alerts,
            security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
         VALUES ($1, $2, 'EN', 'SYSTEM', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, 1)`,
        [randomUUID(), custId],
      );

      const dispatchOutcome = await dispatcher.dispatch({
        eventType: 'transfer.completed',
        eventKey: `transfer.completed:f01:${randomUUID()}`,
        payload: {
          sourceCustomerId: custId,
          amountMinor: '100000',
          transferId: 'tx-f01-1',
          reference: 'REF-F01-1',
        },
      });
      expect(dispatchOutcome.dispatched).toBe(2);
      for (const del of dispatchOutcome.deliveries) {
        expect(del.providerRef).toMatch(SAFE_PROVIDER_REF_PATTERN);
      }

      const deliveryRows = await dataSource.query<
        Array<{ channel: string; status: string; provider_ref: string | null }>
      >(
        `SELECT channel, status, provider_ref FROM notification_deliveries WHERE recipient_id = $1`,
        [custId],
      );
      expect(deliveryRows.length).toBe(2);
      for (const row of deliveryRows) {
        expect(row.status).toBe('SENT');
        expect(row.provider_ref).toMatch(SAFE_PROVIDER_REF_PATTERN);
      }
      assertZeroSentinels(deliveryRows, 'notification_deliveries.provider_ref');

      // Also verify worker retry path converts sentinel 2xx IDs to pvr1:*
      await dataSource.query(
        `UPDATE notification_deliveries
            SET status = 'FAILED', attempts = 1, provider_ref = NULL,
                updated_at = NOW() - INTERVAL '10 minutes'
          WHERE recipient_id = $1`,
        [custId],
      );
      const tickRes = await worker.tick();
      expect(tickRes.retriesSent).toBe(2);
      const retriedRows = await dataSource.query<
        Array<{ channel: string; status: string; provider_ref: string | null }>
      >(
        `SELECT channel, status, provider_ref FROM notification_deliveries WHERE recipient_id = $1`,
        [custId],
      );
      for (const row of retriedRows) {
        expect(row.status).toBe('SENT');
        expect(row.provider_ref).toMatch(SAFE_PROVIDER_REF_PATTERN);
      }
      assertZeroSentinels(retriedRows, 'worker-retried notification_deliveries.provider_ref');

      // --- B) Switch EMAIL channel to Resend and inject Resend 2xx sentinel ---
      await activateConfig({
        channel: 'EMAIL',
        expectedVersion: 1,
        provider: 'resend',
        enabled: true,
        baseUrl: 'https://api.resend.com',
        fromEmail: 'notifications@monienaija.ng',
        fromName: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_RESEND_KEY_1,
        reason: 'Switch EMAIL to Resend for F-01 2xx sentinel verification',
      });

      const resendTestRes = await request(app.getHttpServer())
        .post(TEST_SEND_PATH)
        .set(auth(opsBatch1.token))
        .send({ channel: 'EMAIL', destination: 'ops.resend@monienaija.ng' })
        .expect(201);
      expect(resendTestRes.body.status).toBe('SENT');
      expect(resendTestRes.body.providerRef).toMatch(/^pvr1:resend:[0-9a-f]{32}$/);
      assertZeroSentinels(resendTestRes.body, 'Resend test-send HTTP response');

      const fullStatusAfterResend = await request(app.getHttpServer())
        .get(STATUS_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(fullStatusAfterResend.body.email.lastTest.providerRef).toBe(
        resendTestRes.body.providerRef,
      );
      assertZeroSentinels(fullStatusAfterResend.body, 'FULL provider-status after Resend');

      const overviewAfterResend = await request(app.getHttpServer())
        .get(OVERVIEW_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(overviewAfterResend.body.email.lastTest.providerRef).toBe(
        resendTestRes.body.providerRef,
      );
      assertZeroSentinels(overviewAfterResend.body, 'provider-config overview after Resend');

      // --- C) Malformed 2xx vendor IDs (arrays, objects, overlong >512 without truncation, control chars) fail closed ---
      const malformedRobaseIds: unknown[] = [
        ['robe_array_leak'],
        { id: 'robe_object_leak' },
        ROBASE_2XX_SENTINEL + '_OVERLONG_' + 'x'.repeat(600),
        `robe_crlf\r\n${ROBASE_2XX_SENTINEL}`,
      ];
      for (const badId of malformedRobaseIds) {
        customTransportOverride = async () => ({
          ok: true,
          status: 200,
          json: async () => ({ id: badId }),
        });
        const badRes = await request(app.getHttpServer())
          .post(TEST_SEND_PATH)
          .set(auth(opsBatch2.token))
          .send({ channel: 'SMS', destination: '+2348012345678' })
          .expect(201);
        expect(badRes.body.status).toBe('FAILED');
        expect(badRes.body.providerRef).toBeNull();
        expect(badRes.body.errorCode).toBe('ROBASE_UNRECOGNIZED_SUCCESS_RESPONSE');
        assertZeroSentinels(badRes.body, 'Malformed Robase 2xx response');
      }

      const malformedResendIds: unknown[] = [
        null,
        { nested: RESEND_2XX_SENTINEL },
        RESEND_2XX_SENTINEL + '_OVERLONG_' + 'y'.repeat(600),
        `re_nul\u0000${RESEND_2XX_SENTINEL}`,
      ];
      for (const badId of malformedResendIds) {
        customTransportOverride = async () => ({
          ok: true,
          status: 200,
          json: async () => ({ id: badId }),
        });
        const badRes = await request(app.getHttpServer())
          .post(TEST_SEND_PATH)
          .set(auth(opsBatch3.token))
          .send({ channel: 'EMAIL', destination: 'ops.bad@monienaija.ng' })
          .expect(201);
        expect(badRes.body.status).toBe('FAILED');
        expect(badRes.body.providerRef).toBeNull();
        expect(badRes.body.errorCode).toBe('RESEND_UNRECOGNIZED_SUCCESS_RESPONSE');
        assertZeroSentinels(badRes.body, 'Malformed Resend 2xx response');
      }

      // Inspect raw DB diagnostic columns & raw audit_events rows written during all sends above
      const dbConfigRows = await dataSource.query(
        `SELECT channel, provider, last_test_status, last_test_provider_ref, last_test_error_code, last_verification_error
           FROM notification_provider_configurations`,
      );
      assertZeroSentinels(dbConfigRows, 'notification_provider_configurations DB columns');

      const dbAuditRows = await dataSource.query(
        `SELECT entity_type, action, previous_values, new_values
           FROM audit_events
          WHERE entity_type IN ('NOTIFICATION_TEST_SEND', 'NOTIFICATION_PROVIDER_CONFIG')`,
      );
      expect(dbAuditRows.length).toBeGreaterThanOrEqual(4);
      assertZeroSentinels(dbAuditRows, 'audit_events DB JSON columns');

      const httpAuditRes = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?entityType=NOTIFICATION_TEST_SEND&limit=50')
        .set(auth(superAdminToken))
        .expect(200);
      assertZeroSentinels(httpAuditRes.body, 'GET /internal/audit NOTIFICATION_TEST_SEND');
      assertZeroSentinels(capturedLogs, 'Captured application logs');

      // --- D) Historical persisted unsafe references (DB row + immutable audit_events row) ---
      await dataSource.query(
        `UPDATE notification_provider_configurations
            SET provider = 'brevo',
                last_test_status = 'SENT',
                last_test_provider_ref = $1
          WHERE channel = 'EMAIL'`,
        [HISTORICAL_DB_SENTINEL],
      );
      const versionBeforeBackfillRows: Array<{ version: number }> = await dataSource.query(
        `SELECT version FROM notification_provider_configurations WHERE channel = 'EMAIL'`,
      );
      const versionBeforeBackfill = versionBeforeBackfillRows[0]!.version;

      const historicalAuditId = randomUUID();
      await dataSource.query(
        `INSERT INTO audit_events
           (id, entity_type, entity_id, action, actor, correlation_id, request_id, previous_values, new_values, occurred_at, created_at)
         VALUES ($1, 'NOTIFICATION_TEST_SEND', $2, 'NOTIFICATION_TEST_SENT', $3, 'corr-legacy-f01', 'req-legacy-f01', NULL, $4::jsonb, NOW(), NOW())`,
        [
          historicalAuditId,
          randomUUID(),
          opsBatch1.principalId,
          JSON.stringify({
            channel: 'EMAIL',
            destination: 'le***@monienaija.ng',
            provider: 'brevo',
            providerRef: HISTORICAL_AUDIT_SENTINEL,
            errorCode: null,
            unrelatedEvidenceField: 'PRESERVE_HISTORICAL_EVIDENCE_99',
          }),
        ],
      );

      // Even BEFORE startup normalization runs, read boundaries never leak historical raw refs!
      const statusWithHistoricalRow = await request(app.getHttpServer())
        .get(STATUS_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(statusWithHistoricalRow.body.email.lastTest.providerRef).toMatch(
        /^pvr1:brevo:[0-9a-f]{32}$/,
      );
      assertZeroSentinels(
        statusWithHistoricalRow.body,
        'FULL provider-status with historical unbackfilled DB row',
      );

      const overviewWithHistoricalRow = await request(app.getHttpServer())
        .get(OVERVIEW_PATH)
        .set(auth(superAdminToken))
        .expect(200);
      expect(overviewWithHistoricalRow.body.email.lastTest.providerRef).toMatch(
        /^pvr1:brevo:[0-9a-f]{32}$/,
      );
      assertZeroSentinels(
        overviewWithHistoricalRow.body,
        'provider-config overview with historical unbackfilled DB row',
      );

      const auditWithHistoricalRow = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?entityType=NOTIFICATION_TEST_SEND&limit=100')
        .set(auth(superAdminToken))
        .expect(200);
      const projectedHistoricalAudit = (auditWithHistoricalRow.body as Array<any>).find(
        (item) => item.id === historicalAuditId,
      );
      expect(projectedHistoricalAudit).toBeDefined();
      expect(projectedHistoricalAudit.newValues.providerRef).toMatch(
        /^pvr1:brevo:[0-9a-f]{32}$/,
      );
      expect(projectedHistoricalAudit.newValues.unrelatedEvidenceField).toBe(
        'PRESERVE_HISTORICAL_EVIDENCE_99',
      );
      assertZeroSentinels(
        auditWithHistoricalRow.body,
        'GET /internal/audit with historical NOTIFICATION_TEST_SEND row',
      );

      // Additive startup normalization updates last_test_provider_ref in-place idempotently without bumping version
      const normalizedCount = await providerConfigSvc.normalizeHistoricalProviderRefs();
      expect(normalizedCount).toBe(1);
      expect(await providerConfigSvc.normalizeHistoricalProviderRefs()).toBe(0);

      const postBackfillRow: Array<{ version: number; last_test_provider_ref: string }> =
        await dataSource.query(
          `SELECT version, last_test_provider_ref
             FROM notification_provider_configurations
            WHERE channel = 'EMAIL'`,
        );
      expect(postBackfillRow[0]!.version).toBe(versionBeforeBackfill);
      expect(postBackfillRow[0]!.last_test_provider_ref).toMatch(/^pvr1:brevo:[0-9a-f]{32}$/);
      assertZeroSentinels(postBackfillRow, 'post-backfill notification_provider_configurations');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
      dbgSpy.mockRestore();
    }
  });

  it('14. F-05 adversarial Brevo DNS boolean contract: rejects individually omitted or mistyped spfConfigured/dkimConfigured/dmarcConfigured with 400 and zero DB/audit mutations, accepts explicit false values, and leaves unrelated providers unaffected', async () => {
    const superAdminToken = await loginSuperAdmin();

    const validExplicitFalseBrevo = {
      channel: 'EMAIL',
      expectedVersion: 0,
      provider: 'brevo',
      enabled: false,
      baseUrl: 'https://api.brevo.com',
      fromEmail: 'notifications@monienaija.ng',
      fromName: 'MonieNaija',
      credentialAction: 'SET_ENCRYPTED',
      apiKey: LIVE_BREVO_KEY_1,
      spfConfigured: false,
      dkimConfigured: false,
      dmarcConfigured: false,
      reason: 'Stage Brevo configuration with explicit false DNS booleans',
    };

    const countMutations = async () => {
      const [proposals, configs, approvals, configAudits] = await Promise.all([
        dataSource.query<Array<{ c: string }>>(
          `SELECT count(*)::text AS c FROM notification_provider_config_proposals`,
        ),
        dataSource.query<Array<{ c: string }>>(
          `SELECT count(*)::text AS c FROM notification_provider_configurations`,
        ),
        dataSource.query<Array<{ c: string }>>(
          `SELECT count(*)::text AS c FROM privileged_action_approvals WHERE resource_type = 'NOTIFICATION_PROVIDER_CONFIG_PROPOSAL'`,
        ),
        dataSource.query<Array<{ c: string }>>(
          `SELECT count(*)::text AS c FROM audit_events WHERE entity_type = 'NOTIFICATION_PROVIDER_CONFIG'`,
        ),
      ]);
      return {
        proposals: Number(proposals[0]!.c),
        configs: Number(configs[0]!.c),
        approvals: Number(approvals[0]!.c),
        configAudits: Number(configAudits[0]!.c),
      };
    };

    // 1. Individually omit each of spfConfigured, dkimConfigured, dmarcConfigured + omit all three
    for (const omittedField of ['spfConfigured', 'dkimConfigured', 'dmarcConfigured'] as const) {
      const body: Record<string, unknown> = { ...validExplicitFalseBrevo };
      delete body[omittedField];
      const res = await request(app.getHttpServer())
        .post(PROPOSALS_PATH)
        .set(auth(superAdminToken))
        .send(body)
        .expect(400);
      expect(String(res.body.message)).toContain(omittedField);
    }

    const allThreeOmitted: Record<string, unknown> = { ...validExplicitFalseBrevo };
    delete allThreeOmitted.spfConfigured;
    delete allThreeOmitted.dkimConfigured;
    delete allThreeOmitted.dmarcConfigured;
    await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(superAdminToken))
      .send(allThreeOmitted)
      .expect(400);

    // 2. Non-boolean types for every single DNS field (strings, numbers, null, arrays, objects)
    for (const field of ['spfConfigured', 'dkimConfigured', 'dmarcConfigured'] as const) {
      for (const badType of ['true', 'false', '0', '1', '', 0, 1, null, [], [true], { value: true }]) {
        await request(app.getHttpServer())
          .post(PROPOSALS_PATH)
          .set(auth(superAdminToken))
          .send({ ...validExplicitFalseBrevo, [field]: badType })
          .expect(400);
      }
    }

    // Strict zero-mutation guarantee across proposals, configs, approvals, and config audit rows
    expect(await countMutations()).toEqual({
      proposals: 0,
      configs: 0,
      approvals: 0,
      configAudits: 0,
    });

    // 3. Valid explicit `false` values on all three DNS booleans succeed with 201 and persist false
    const createdFalseRes = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(superAdminToken))
      .send(validExplicitFalseBrevo)
      .expect(201);
    expect(createdFalseRes.body.proposedDomainAuthentication).toEqual({
      spfConfigured: false,
      dkimConfigured: false,
      dmarcConfigured: false,
    });

    const persistedProposalRows: Array<{
      proposed_spf_configured: boolean;
      proposed_dkim_configured: boolean;
      proposed_dmarc_configured: boolean;
    }> = await dataSource.query(
      `SELECT proposed_spf_configured, proposed_dkim_configured, proposed_dmarc_configured
         FROM notification_provider_config_proposals
        WHERE id = $1`,
      [createdFalseRes.body.id],
    );
    expect(persistedProposalRows[0]).toEqual({
      proposed_spf_configured: false,
      proposed_dkim_configured: false,
      proposed_dmarc_configured: false,
    });

    // 4. Unrelated provider contracts (e.g. Robase SMS without DNS booleans) remain unaffected
    const robaseWithoutDns = await request(app.getHttpServer())
      .post(PROPOSALS_PATH)
      .set(auth(superAdminToken))
      .send({
        channel: 'SMS',
        expectedVersion: 0,
        provider: 'robase',
        enabled: false,
        baseUrl: 'https://api.robase.dev',
        senderId: 'MonieNaija',
        credentialAction: 'SET_ENCRYPTED',
        apiKey: LIVE_ROBASE_KEY_1,
        reason: 'Robase SMS proposal without email DNS fields',
      })
      .expect(201);
    expect(robaseWithoutDns.body.proposedProvider).toBe('robase');
  });
});
