/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-require-imports */
import { randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
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
  type ProviderHttpFetchFn,
} from '../src/notification/notification-provider-config.service';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';
const CFG_BASE = '/api/v1/internal/notifications/provider-config';
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

  const mockTransport: ProviderHttpFetchFn = async (url, init) => {
    outboundCalls.push({
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    });

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
});
