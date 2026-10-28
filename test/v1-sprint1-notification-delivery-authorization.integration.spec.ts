/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { SupportAuthenticationService } from '../src/support-authentication/support-authentication.service';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOCAL_ADMIN_LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';

function encodePbkdf2(password: string, saltStr = 'sprint1-notif-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * ARENA 2 — SPRINT 1: NOTIFICATION DELIVERY AUTHORIZATION HARDENING (F-02 / P0-02).
 *
 * Zero-mock, real-HTTP + real-PostgreSQL verification against:
 *   - Real seeded `authorization_functions` / `authorization_roles` / `authorization_role_functions`
 *   - Real `A2WorkforceSessionService` + `LocalAdminAuthenticationService`
 *   - Real `SupportAuthenticationService` (`SUPPORT` workforce session)
 *   - Real Customer (`POST /api/v1/customers/sessions`) and Agent (`POST /api/v1/agents/sessions`) sessions
 *   - Real `RuntimeAccessGuard` + `RoutePolicyRegistry` + `AuthorizationService.requireFunction()`
 *   - Real `AuditService` (`audit_events` rows)
 */
describe('SPRINT-1 Notification Delivery Authorization Hardening — F-02 / P0-02 (real PostgreSQL + HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  let supportAuth: SupportAuthenticationService;
  let authorizationService: AuthorizationService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ROBASE_API_KEY = 'robase_super_secret_key_do_not_expose_9999';
    process.env.RESEND_API_KEY = 're_super_secret_key_do_not_expose_8888';

    dataSource = await createIntegrationDataSource('v1sprint1notifauthz');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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
    supportAuth = moduleRef.get(SupportAuthenticationService);
    authorizationService = moduleRef.get(AuthorizationService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    delete process.env.ROBASE_API_KEY;
    delete process.env.RESEND_API_KEY;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function superAdminToken(): Promise<string> {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const login = await request(app.getHttpServer())
      .post(LOCAL_ADMIN_LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    if (login.status !== 201) {
      throw new Error(`SUPER_ADMIN login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    return login.body.accessToken as string;
  }

  async function establishRoleSession(
    roleKey: string,
  ): Promise<{ accessToken: string; principalId: string }> {
    const principalId = `sprint1notif:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-sprint1-notif-authz:${principalId}:${roleKey}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'sprint1-test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const established = await sessionService.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'sprint1-test-harness-key',
    });
    return { accessToken: established.accessToken, principalId };
  }

  async function createSupportToken(): Promise<{ accessToken: string; supportUserId: string }> {
    const username = `sup.${randomUUID().slice(0, 8)}`;
    const provisioned = await supportAuth.provision({
      username,
      actor: 'sprint1-test-harness',
    });
    const login = await supportAuth.login(username, provisioned.temporaryPassword);
    return { accessToken: login.accessToken, supportUserId: provisioned.user.id };
  }

  async function createCustomerSession(phone10: string): Promise<{ customerId: string; accessToken: string }> {
    const password = 'CustomerPassword!123';
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
      [`cust-s1-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1, $2, true)`,
      [customerId, 'Sprint 1 Customer'],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1, 'PHONE', $2, $3, true, now())`,
      [customerId, `+234${phone10}`, phone10],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
        (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version)
       VALUES ($1, $2, 'PBKDF2', 1, now(), 'ACTIVE', false, 0, 1)`,
      [customerId, encodePbkdf2(password)],
    );
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    return { customerId, accessToken: loginRes.body.accessToken as string };
  }

  async function createAgentSession(): Promise<{ agentId: string; accessToken: string }> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
      [
        `cls-s1-${randomUUID().slice(0, 8)}`,
        `S1-${randomUUID().slice(0, 6)}`,
        'Sprint 1 Agent Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1, 'ACTIVE', $2) RETURNING id`,
      [`agent-s1-${randomUUID().slice(0, 8)}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const password = 'agent-password-sprint1!';
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials
        (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1, $2, 'PBKDF2', 1, now(), 'ACTIVE')`,
      [agentId, encodePbkdf2(password)],
    );
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password })
      .expect(200);
    return { agentId, accessToken: loginRes.body.accessToken as string };
  }

  async function insertDeliveryRow(opts: {
    eventType?: string;
    recipientType?: 'CUSTOMER' | 'AGENT' | 'PHONE';
    recipientId: string;
    channel?: 'SMS' | 'PUSH' | 'EMAIL';
    destination: string;
    status?: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    payload?: Record<string, unknown>;
    message?: string;
    lastError?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const eventType = opts.eventType ?? 'customer.funding.approved';
    const recipientType = opts.recipientType ?? 'CUSTOMER';
    const channel = opts.channel ?? 'SMS';
    const status = opts.status ?? 'SENT';
    const payload = opts.payload ?? { reference: 'REF-S1' };
    const message = opts.message ?? 'Notification body';
    await dataSource.query(
      `INSERT INTO notification_deliveries
        (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, provider_ref, last_error, created_at, updated_at, sent_at, failed_at)
       VALUES ($1,$2,$3,'TEST',$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,now(),now(),$15,$16)`,
      [
        id,
        eventType,
        `${eventType}:${randomUUID()}`,
        randomUUID(),
        recipientType,
        opts.recipientId,
        channel,
        opts.destination,
        JSON.stringify(payload),
        message,
        status,
        status === 'PENDING' ? 0 : 1,
        status === 'SENT' ? `prov-${randomUUID().slice(0, 8)}` : null,
        opts.lastError ?? (status === 'FAILED' ? 'PROVIDER_TIMEOUT' : null),
        status === 'SENT' ? new Date() : null,
        status === 'FAILED' ? new Date() : null,
      ],
    );
    return id;
  }

  // -------------------------------------------------------------------------
  // Section A — Seeded catalogue truth & positive/negative workforce role matrix
  // -------------------------------------------------------------------------
  it('A0: seeded catalogue assigns notification.view_deliveries exclusively to SUPER_ADMIN, FINANCE_AUDITOR, and OPERATIONS', async () => {
    const rows: Array<{ role_key: string; access_type: string }> = await dataSource.query(
      `SELECT r.role_key AS role_key, rf.access_type AS access_type
         FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
        WHERE rf.function_code = 'notification.view_deliveries'
        ORDER BY r.role_key ASC`,
    );
    expect(rows).toEqual([
      { role_key: 'FINANCE_AUDITOR', access_type: 'VIEW' },
      { role_key: 'OPERATIONS', access_type: 'VIEW' },
      { role_key: 'SUPER_ADMIN', access_type: 'VIEW' },
    ]);
  });

  it('A1: SUPER_ADMIN (real local-admin session) -> 200 on GET /internal/notifications/deliveries', async () => {
    const token = await superAdminToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('A2: OPERATIONS (real workforce session) -> 200 on GET /internal/notifications/deliveries', async () => {
    const { accessToken } = await establishRoleSession('OPERATIONS');
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('A3: FINANCE_AUDITOR (read-only audit role) -> 200 on GET /internal/notifications/deliveries and still 403 on mutations', async () => {
    const { accessToken } = await establishRoleSession('FINANCE_AUDITOR');
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    // Read grant never confers write authority
    await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ username: `auditor.denied.${Date.now()}` })
      .expect(403);
  });

  const UNAUTHORIZED_WORKFORCE_ROLES = [
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'AGENT_NETWORK_MANAGER',
    'COMPLIANCE',
    'RISK_FRAUD',
    'CUSTOMER_SERVICE',
    'TREASURY',
    'ADMINISTRATOR',
  ] as const;

  it.each(UNAUTHORIZED_WORKFORCE_ROLES)(
    'A4: workforce role %s (lacking notification.view_deliveries) -> 403 FUNCTION_MISSING',
    async (roleKey) => {
      const { accessToken, principalId } = await establishRoleSession(roleKey);
      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/notifications/deliveries')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(String(res.body.message ?? '')).toContain('FUNCTION_MISSING');

      const auditRows: Array<{ action: string; new_values: Record<string, unknown> }> =
        await dataSource.query(
          `SELECT action, new_values
             FROM audit_events
            WHERE entity_type = 'AUTHORIZATION_DECISION'
              AND actor = $1
            ORDER BY created_at DESC
            LIMIT 1`,
          [principalId],
        );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0]!.action).toBe('DENIED');
      expect(auditRows[0]!.new_values).toMatchObject({
        allowed: false,
        reason: 'FUNCTION_MISSING',
        resourceType: 'internal-notifications',
        action: 'notification.view_deliveries',
        requiredFunctions: ['notification.view_deliveries'],
      });
    },
  );

  it('A5: genuine SUPPORT workforce session -> 403 FUNCTION_MISSING', async () => {
    const { accessToken, supportUserId } = await createSupportToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(String(res.body.message ?? '')).toContain('FUNCTION_MISSING');

    const auditRows: Array<{ action: string; new_values: Record<string, unknown> }> =
      await dataSource.query(
        `SELECT action, new_values
           FROM audit_events
          WHERE entity_type = 'AUTHORIZATION_DECISION'
            AND actor = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [supportUserId],
      );
    expect(auditRows[0]?.action).toBe('DENIED');
    expect(auditRows[0]?.new_values).toMatchObject({
      allowed: false,
      reason: 'FUNCTION_MISSING',
    });
  });

  // -------------------------------------------------------------------------
  // Section B — Unauthorized principal types & missing/invalid authentication
  // -------------------------------------------------------------------------
  it('B1: missing, malformed, and unknown bearer tokens -> 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer unknown-token-${randomUUID()}`)
      .expect(401);
  });

  it('B2: genuine CUSTOMER, AGENT, and AGGREGATOR principals are rejected', async () => {
    const { customerId, accessToken: customerToken } = await createCustomerSession('8031112222');
    const { agentId, accessToken: agentToken } = await createAgentSession();
    await insertDeliveryRow({
      recipientType: 'CUSTOMER',
      recipientId: customerId,
      channel: 'SMS',
      destination: '8031112222',
    });
    await insertDeliveryRow({
      recipientType: 'AGENT',
      recipientId: agentId,
      channel: 'SMS',
      destination: '8033334444',
    });

    // Real CUSTOMER and AGENT bearer tokens are rejected with 403 by RuntimeAccessGuard
    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);

    // AGGREGATOR has no login endpoint in V1; verify controller/service gate rejects AGGREGATOR principal
    const aggregatorId = randomUUID();
    await expect(
      authorizationService.requireFunction(
        {
          type: 'AGGREGATOR',
          principalId: aggregatorId,
          aggregatorId,
          roles: ['AGGREGATOR'],
          scopes: ['notification.view_deliveries'],
          customerAccess: 'NONE',
          aggregatorAccess: 'SELF',
        },
        'notification.view_deliveries',
        'internal-notifications',
        ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
        { deniedStatus: 401 },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  // -------------------------------------------------------------------------
  // Section C — Query parameter non-bypass & filtered delivery queries
  // -------------------------------------------------------------------------
  it('C1: query parameters (including own recipientId or malformed filters) cannot bypass authorization', async () => {
    const { customerId, accessToken: customerToken } = await createCustomerSession('8051112222');
    const { accessToken: complianceToken } = await establishRoleSession('COMPLIANCE');
    const { accessToken: financeControllerToken } = await establishRoleSession('FINANCE_CONTROLLER');
    const { accessToken: supportToken } = await createSupportToken();

    await insertDeliveryRow({
      recipientType: 'CUSTOMER',
      recipientId: customerId,
      channel: 'EMAIL',
      destination: 'customer.private@example.com',
      status: 'FAILED',
      eventType: 'customer.funding.approved',
    });

    const queryPermutations = [
      `?recipientId=${customerId}`,
      `?recipientType=CUSTOMER&recipientId=${customerId}`,
      `?status=FAILED&channel=EMAIL`,
      `?channel=SMS&page=1&limit=1`,
      `?eventType=customer.funding.approved`,
      `?recipientType=PHONE`,
      // Invalid filters must still fail authorization (403/401), never 400 validation oracle
      `?page=0&limit=999&status=INVALID&channel=WHATSAPP&recipientId=not-a-uuid`,
    ];

    for (const qs of queryPermutations) {
      await request(app.getHttpServer())
        .get(`/api/v1/internal/notifications/deliveries${qs}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/internal/notifications/deliveries${qs}`)
        .set('Authorization', `Bearer ${financeControllerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/internal/notifications/deliveries${qs}`)
        .set('Authorization', `Bearer ${supportToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/internal/notifications/deliveries${qs}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/internal/notifications/deliveries${qs}`)
        .expect(401);
    }
  });

  it('C2: authorized OPERATIONS and FINANCE_AUDITOR can filter by status, channel (SMS/PUSH/EMAIL), recipientType (CUSTOMER/AGENT/PHONE), eventType, and recipientId', async () => {
    const { customerId } = await createCustomerSession('8061112222');
    const { agentId } = await createAgentSession();
    const { accessToken: opsToken } = await establishRoleSession('OPERATIONS');
    const { accessToken: auditorToken } = await establishRoleSession('FINANCE_AUDITOR');

    const emailId = await insertDeliveryRow({
      recipientType: 'CUSTOMER',
      recipientId: customerId,
      channel: 'EMAIL',
      destination: 'ops.filter.secret@example.com',
      status: 'SENT',
      eventType: 'transfer.completed',
    });
    const agentSmsId = await insertDeliveryRow({
      recipientType: 'AGENT',
      recipientId: agentId,
      channel: 'SMS',
      destination: '8063334444',
      status: 'FAILED',
      eventType: 'agent.suspended',
    });
    const phoneC2cId = await insertDeliveryRow({
      recipientType: 'PHONE',
      recipientId: '8099887766',
      channel: 'SMS',
      destination: '8099887766',
      status: 'SENT',
      eventType: 'cash_to_cash.created',
    });

    const emailRes = await request(app.getHttpServer())
      .get(`/api/v1/internal/notifications/deliveries?channel=EMAIL&recipientId=${customerId}`)
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);
    expect(emailRes.body.total).toBe(1);
    expect(emailRes.body.data[0].id).toBe(emailId);

    const failedAgentRes = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries?status=FAILED&recipientType=AGENT')
      .set('Authorization', `Bearer ${auditorToken}`)
      .expect(200);
    expect(failedAgentRes.body.total).toBe(1);
    expect(failedAgentRes.body.data[0].id).toBe(agentSmsId);

    const phoneRes = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries?recipientType=PHONE&eventType=cash_to_cash.created')
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);
    expect(phoneRes.body.total).toBe(1);
    expect(phoneRes.body.data[0].id).toBe(phoneC2cId);
    expect(phoneRes.body.data[0].recipientId).toBe('*******766');
  });

  // -------------------------------------------------------------------------
  // Section D — Recipient/destination redaction, credential secrecy, & audit
  // -------------------------------------------------------------------------
  it('D1: preserves strict destination/payload/recipient redaction, provider credential secrecy, and ALLOWED audit recording', async () => {
    const { customerId } = await createCustomerSession('8071112222');
    const { accessToken: opsToken, principalId: opsPrincipalId } =
      await establishRoleSession('OPERATIONS');

    await insertDeliveryRow({
      recipientType: 'CUSTOMER',
      recipientId: customerId,
      channel: 'EMAIL',
      destination: 'alice.private.inbox@example.com',
      status: 'SENT',
      eventType: 'customer.funding.approved',
      payload: {
        pin: '9876',
        password: 'ultra-secret-password',
        otp: '654321',
        apiKey: 'robase_super_secret_key_do_not_expose_9999',
      },
      message: 'Your funding of NGN 5,000.00 has been approved.',
    });

    await insertDeliveryRow({
      recipientType: 'PHONE',
      recipientId: '8091234567',
      channel: 'SMS',
      destination: '8091234567',
      status: 'SENT',
      eventType: 'cash_to_cash.created',
      payload: { senderDisplayName: 'Customer', amountMinor: '2000', currency: 'NGN' },
      message: 'Cash-to-Cash transfer notification.',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/deliveries')
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);

    expect(res.body.total).toBe(2);
    for (const item of res.body.data) {
      expect(item).not.toHaveProperty('destination');
      expect(item).not.toHaveProperty('payload');
    }

    const phoneRow = res.body.data.find((d: any) => d.recipientType === 'PHONE');
    expect(phoneRow).toBeDefined();
    expect(phoneRow.recipientId).toBe('*******567');

    const custRow = res.body.data.find((d: any) => d.recipientType === 'CUSTOMER');
    expect(custRow).toBeDefined();
    expect(custRow.recipientId).toBe(customerId);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain('alice.private.inbox@example.com');
    expect(bodyText).not.toContain('8091234567');
    expect(bodyText).not.toContain('ultra-secret-password');
    expect(bodyText).not.toContain('654321');
    expect(bodyText).not.toContain('robase_super_secret_key_do_not_expose_9999');
    expect(bodyText).not.toContain('re_super_secret_key_do_not_expose_8888');

    const auditRows: Array<{ action: string; new_values: Record<string, unknown> }> =
      await dataSource.query(
        `SELECT action, new_values
           FROM audit_events
          WHERE entity_type = 'AUTHORIZATION_DECISION'
            AND actor = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [opsPrincipalId],
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.action).toBe('ALLOWED');
    expect(auditRows[0]!.new_values).toMatchObject({
      allowed: true,
      resourceType: 'internal-notifications',
      action: 'notification.view_deliveries',
      requiredFunctions: ['notification.view_deliveries'],
    });
    const auditText = JSON.stringify(auditRows[0]!.new_values);
    expect(auditText).not.toContain('alice.private.inbox@example.com');
    expect(auditText).not.toContain('8091234567');
    expect(auditText).not.toContain('robase_super_secret_key_do_not_expose_9999');
  });
});
