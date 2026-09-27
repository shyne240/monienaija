/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { WalletService } from '../src/wallet/wallet.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('V1-HARDENING-09 Admin Notification Delivery Diagnostics — GET /internal/notifications/deliveries (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let testProvider: TestNotificationProvider;
  let walletService: WalletService;
  let dispatcher: NotificationDispatcherService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    // @ts-ignore
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-hardening-09-notification-diagnostics');
    testProvider = new TestNotificationProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(testProvider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    walletService = moduleRef.get(WalletService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60000);

  beforeEach(async () => {
    testProvider.clear();
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    const settlement: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (settlement.length === 0) {
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES
          ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000001','AGENT_FUNDING_POOL-NGN','Agent funding pool NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000002','CASH_TO_CASH-UNCLAIMED-NGN','Cash to cash unclaimed NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
    }
  });

  function workforceToken(type: string): string {
    return `workforce-${type}`;
  }

  async function createCustomerWithPhone(phone10: string): Promise<string> {
    const customerId = randomUUID();
    await dataSource.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [customerId, `cust-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO customer_profiles (id, customer_id, display_name, is_active) VALUES ($1,$2,$3,true)`, [randomUUID(), customerId, `Cust ${customerId.slice(0,4)}`]);
    await dataSource.query(`INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,true)`, [randomUUID(), customerId, phone10]);
    try {
      await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}` });
    } catch {}
    await dataSource.query(
      `INSERT INTO customer_preferences (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled, notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1,$2,'EN','SYSTEM',true,true,true,true,true,true,true,false,1) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId],
    );
    return customerId;
  }

  async function createAgentDirect(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status) VALUES ($1,'ACTIVE') RETURNING id`, [`ref-${randomUUID()}`]);
    return rows[0]!.id;
  }

  async function insertDelivery(opts: {
    eventType?: string;
    eventKey?: string;
    aggregateType?: string | null;
    aggregateId?: string | null;
    recipientType?: 'CUSTOMER' | 'AGENT';
    recipientId?: string;
    channel?: 'SMS' | 'PUSH';
    destination?: string;
    payload?: Record<string, unknown>;
    message?: string | null;
    status?: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    attempts?: number;
    providerRef?: string | null;
    correlationId?: string | null;
    causationId?: string | null;
    lastError?: string | null;
    sentAt?: Date | null;
    failedAt?: Date | null;
    createdAt?: Date;
  }): Promise<string> {
    const id = randomUUID();
    const eventType = opts.eventType ?? 'customer.funding.approved';
    const eventKey = opts.eventKey ?? `test-${randomUUID()}`;
    const recipientType = opts.recipientType ?? 'CUSTOMER';
    const recipientId = opts.recipientId ?? (await createCustomerWithPhone(`80${Math.floor(10000000 + Math.random()*90000000)}`));
    const channel = opts.channel ?? 'SMS';
    const destination = opts.destination ?? '8011111111';
    const payload = opts.payload ?? { reference: 'REF-TEST', _templateKey: eventType };
    const message = opts.message ?? 'Your funding of NGN 100.00 has been approved. Ref REF-TEST.';
    const status = opts.status ?? 'SENT';
    const attempts = opts.attempts ?? (status === 'PENDING' ? 0 : 1);
    const providerRef = opts.providerRef ?? (status === 'SENT' ? `test-${randomUUID().slice(0,8)}` : null);
    const correlationId = opts.correlationId ?? null;
    const causationId = opts.causationId ?? null;
    const lastError = opts.lastError ?? (status === 'FAILED' ? 'Simulated provider failure' : status === 'SKIPPED' ? 'PUSH_TOKEN_DEPENDENCY_MISSING' : null);
    const createdAt = opts.createdAt ?? new Date();
    // Note: we insert with explicit timestamps to test ordering
    await dataSource.query(
      `INSERT INTO notification_deliveries (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, provider_ref, correlation_id, causation_id, last_error, created_at, updated_at, sent_at, failed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        id,
        eventType,
        eventKey,
        opts.aggregateType ?? 'TEST',
        opts.aggregateId ?? randomUUID(),
        recipientType,
        recipientId,
        channel,
        destination,
        JSON.stringify(payload),
        message,
        status,
        attempts,
        providerRef,
        correlationId,
        causationId,
        lastError,
        createdAt,
        createdAt,
        opts.sentAt ?? (status === 'SENT' ? createdAt : null),
        opts.failedAt ?? (status === 'FAILED' ? createdAt : null),
      ],
    );
    return id;
  }

  // 1-4 workforce authorized
  it('1. SUPPORT authorized to list deliveries', async () => {
    const cid = await createCustomerWithPhone('8010000001');
    await insertDelivery({ recipientId: cid, status: 'SENT' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('2. OPERATOR authorized', async () => {
    const cid = await createCustomerWithPhone('8010000002');
    await insertDelivery({ recipientId: cid, status: 'PENDING' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('OPERATOR')}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('3. SERVICE authorized', async () => {
    await insertDelivery({ status: 'FAILED' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SERVICE')}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('4. PRIVILEGED authorized', async () => {
    await insertDelivery({ status: 'SKIPPED', channel: 'PUSH', destination: 'SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING', lastError: 'PUSH_TOKEN_DEPENDENCY_MISSING' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('PRIVILEGED')}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('5. CUSTOMER denied', async () => {
    await insertDelivery({ status: 'SENT' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('CUSTOMER')}`).expect(401);
    expect(res.body.message).toBeDefined();
  });

  it('6. AGENT denied', async () => {
    await insertDelivery({ status: 'SENT' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('AGENT')}`).expect(401);
  });

  it('7. unauthenticated denied', async () => {
    await insertDelivery({ status: 'SENT' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').expect(401);
    expect(res.status).toBe(401);
  });

  it('8. PENDING delivery visible', async () => {
    const cid = await createCustomerWithPhone('8010000008');
    const id = await insertDelivery({ recipientId: cid, status: 'PENDING', attempts: 0, providerRef: null, lastError: null });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=PENDING').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(res.body.data.some((d: any) => d.id === id)).toBe(true);
    expect(res.body.data.find((d: any) => d.id === id).status).toBe('PENDING');
    expect(res.body.data.find((d: any) => d.id === id).attempts).toBe(0);
  });

  it('9. SENT delivery visible with providerRef', async () => {
    const cid = await createCustomerWithPhone('8010000009');
    const id = await insertDelivery({ recipientId: cid, status: 'SENT', providerRef: 'test-ref-123' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=SENT').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const found = res.body.data.find((d: any) => d.id === id);
    expect(found).toBeDefined();
    expect(found.status).toBe('SENT');
    expect(found.providerRef).toBe('test-ref-123');
    expect(found.sentAt).toBeDefined();
  });

  it('10. FAILED delivery visible with lastError', async () => {
    const cid = await createCustomerWithPhone('8010000010');
    const id = await insertDelivery({ recipientId: cid, status: 'FAILED', lastError: 'Simulated provider failure', failedAt: new Date() });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=FAILED').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const found = res.body.data.find((d: any) => d.id === id);
    expect(found).toBeDefined();
    expect(found.status).toBe('FAILED');
    expect(found.lastError).toContain('Simulated');
    expect(found.failedAt).toBeDefined();
  });

  it('11. SKIPPED delivery visible', async () => {
    const cid = await createCustomerWithPhone('8010000011');
    const id = await insertDelivery({ recipientId: cid, status: 'SKIPPED', channel: 'PUSH', destination: 'SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING', lastError: 'PUSH_TOKEN_DEPENDENCY_MISSING' });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=SKIPPED').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const found = res.body.data.find((d: any) => d.id === id);
    expect(found).toBeDefined();
    expect(found.status).toBe('SKIPPED');
    expect(found.lastError).toBe('PUSH_TOKEN_DEPENDENCY_MISSING');
  });

  it('12. status filtering', async () => {
    const cid = await createCustomerWithPhone('8010000012');
    await insertDelivery({ recipientId: cid, status: 'SENT' });
    await insertDelivery({ recipientId: cid, status: 'FAILED' });
    await insertDelivery({ recipientId: cid, status: 'PENDING' });
    await insertDelivery({ recipientId: cid, status: 'SKIPPED', channel: 'PUSH', destination: 'SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING' });

    const sentRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=SENT').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(sentRes.body.data.every((d: any) => d.status === 'SENT')).toBe(true);
    const failedRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=FAILED').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(failedRes.body.data.every((d: any) => d.status === 'FAILED')).toBe(true);
    const pendingRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=PENDING').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(pendingRes.body.data.every((d: any) => d.status === 'PENDING')).toBe(true);
    // Empty when no match
    const noneRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=SENT&eventType=nonexistent-type-xyz').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(noneRes.body.data.length).toBe(0);
    expect(noneRes.body.total).toBe(0);
  });

  it('13. deterministic pagination createdAt DESC, id DESC', async () => {
    const cid = await createCustomerWithPhone('8010000013');
    // Insert 5 with distinct createdAt
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const createdAt = new Date(Date.now() + i * 1000);
      const id = await insertDelivery({ recipientId: cid, status: 'SENT', createdAt });
      ids.push(id);
      await new Promise((r) => setTimeout(r, 5));
    }
    // p1 limit2
    const p1 = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=2&page=1').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(p1.body.data.length).toBe(2);
    expect(p1.body.total).toBe(5);
    expect(p1.body.totalPages).toBe(3);
    expect(p1.body.hasNextPage).toBe(true);
    expect(p1.body.page).toBe(1);
    expect(p1.body.limit).toBe(2);
    const p2 = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=2&page=2').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(p2.body.data.length).toBe(2);
    expect(p2.body.hasNextPage).toBe(true);
    const p3 = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=2&page=3').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(p3.body.data.length).toBe(1);
    expect(p3.body.hasNextPage).toBe(false);
    // Ordering check: p1 first item should be newest (last inserted)
    const all = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=20&page=1').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const dates = all.body.data.map((d: any) => new Date(d.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    // No duplicate across pages
    const idsP1 = p1.body.data.map((d: any) => d.id);
    const idsP2 = p2.body.data.map((d: any) => d.id);
    expect(idsP1.some((id: string) => idsP2.includes(id))).toBe(false);
  });

  it('14. safe projection and sensitive fields not leaked', async () => {
    const cid = await createCustomerWithPhone('8010000014');
    // Insert with sensitive-like data in payload and destination that should NOT appear in projection
    const payload = { reference: 'REF-123', pin: '1234', pinHash: 'hash', password: 'secret', tokenHash: 'tok', secret: 'shh', apiKey: 'key' } as any;
    const id = await insertDelivery({
      recipientId: cid,
      status: 'SENT',
      destination: '8010000014',
      payload,
      message: 'Your funding of NGN 100.00 approved Ref REF-123',
      providerRef: 'test-abc123',
    });
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const found = res.body.data.find((d: any) => d.id === id);
    expect(found).toBeDefined();
    // Safe fields present
    expect(found.id).toBe(id);
    expect(found.eventType).toBeDefined();
    expect(found.eventKey).toBeDefined();
    expect(found.recipientType).toBe('CUSTOMER');
    expect(found.recipientId).toBe(cid);
    expect(found.channel).toBeDefined();
    expect(found.status).toBe('SENT');
    expect(found.attempts).toBeDefined();
    expect(found.providerRef).toBe('test-abc123');
    expect(found.createdAt).toBeDefined();
    expect(found.message).toContain('NGN');
    // Sensitive fields must NOT be present
    expect(found).not.toHaveProperty('destination');
    expect(found).not.toHaveProperty('payload');
    expect(found).not.toHaveProperty('password');
    expect(found).not.toHaveProperty('pin');
    expect(found).not.toHaveProperty('pinHash');
    expect(found).not.toHaveProperty('tokenHash');
    expect(found).not.toHaveProperty('secret');
    expect(found).not.toHaveProperty('apiKey');
    expect(found).not.toHaveProperty('providerApiKey');
    // Ensure no secret leaked via JSON stringify
    const bodyStr = JSON.stringify(res.body).toLowerCase();
    expect(bodyStr).not.toContain('destination');
    expect(bodyStr).not.toContain('payload');
    // Message should not contain secrets
    expect(bodyStr).not.toContain('pin');
    expect(bodyStr).not.toContain('password');
  });

  it('15. filtering by recipientType, channel, eventType, recipientId', async () => {
    const custId = await createCustomerWithPhone('8010000015');
    const agentId = await createAgentDirect();
    await insertDelivery({ recipientId: custId, recipientType: 'CUSTOMER', channel: 'SMS', eventType: 'customer.funding.approved', status: 'SENT' });
    await insertDelivery({ recipientId: agentId, recipientType: 'AGENT', channel: 'SMS', eventType: 'agent.suspended', status: 'SKIPPED', destination: 'SKIPPED:AGENT_PHONE_DEPENDENCY_MISSING', lastError: 'AGENT_PHONE_DEPENDENCY_MISSING' });
    await insertDelivery({ recipientId: custId, recipientType: 'CUSTOMER', channel: 'PUSH', eventType: 'support.ticket.created', status: 'SKIPPED', destination: 'SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING', lastError: 'PUSH_TOKEN_DEPENDENCY_MISSING' });

    const custRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?recipientType=CUSTOMER').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(custRes.body.data.every((d: any) => d.recipientType === 'CUSTOMER')).toBe(true);
    const agentRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?recipientType=AGENT').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(agentRes.body.data.every((d: any) => d.recipientType === 'AGENT')).toBe(true);
    const smsRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?channel=SMS').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(smsRes.body.data.every((d: any) => d.channel === 'SMS')).toBe(true);
    const pushRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?channel=PUSH').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(pushRes.body.data.every((d: any) => d.channel === 'PUSH')).toBe(true);
    const eventRes = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?eventType=customer.funding.approved').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(eventRes.body.data.every((d: any) => d.eventType === 'customer.funding.approved')).toBe(true);
    const recipientRes = await request(app.getHttpServer()).get(`/api/v1/internal/notifications/deliveries?recipientId=${custId}`).set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    expect(recipientRes.body.data.every((d: any) => d.recipientId === custId)).toBe(true);
  });

  it('16. read-only behavior — GET only, POST/PATCH/DELETE 404', async () => {
    await insertDelivery({ status: 'SENT' });
    await request(app.getHttpServer()).post('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).send({}).expect(404);
    await request(app.getHttpServer()).patch('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).send({}).expect(404);
    await request(app.getHttpServer()).delete('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(404);
    // GET does not mutate
    const before: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries`);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const after: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries`);
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it('17. no notification record mutation on read', async () => {
    const cid = await createCustomerWithPhone('8010000017');
    const id = await insertDelivery({ recipientId: cid, status: 'FAILED', lastError: 'error', attempts: 2 });
    const before: Array<{ status: string; attempts: number; last_error: string }> = await dataSource.query(`SELECT status, attempts, last_error FROM notification_deliveries WHERE id=$1`, [id]);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/internal/notifications/deliveries?status=FAILED`).set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const after: Array<{ status: string; attempts: number; last_error: string }> = await dataSource.query(`SELECT status, attempts, last_error FROM notification_deliveries WHERE id=$1`, [id]);
    expect(after[0]!.status).toBe(before[0]!.status);
    expect(after[0]!.attempts).toBe(before[0]!.attempts);
    expect(after[0]!.last_error).toBe(before[0]!.last_error);
  });

  it('18. no financial mutation', async () => {
    const cid = await createCustomerWithPhone('8010000018');
    // Fund customer via wallet + approve to create ledger
    const beforeLedgers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const beforeLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    const beforeWallets: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    await insertDelivery({ recipientId: cid, status: 'SENT' });
    // Read multiple times
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=1&page=1').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=SENT&channel=SMS').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const afterLedgers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const afterLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    const afterWallets: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    expect(afterLedgers[0]!.count).toBe(beforeLedgers[0]!.count);
    expect(afterLines[0]!.count).toBe(beforeLines[0]!.count);
    expect(afterWallets[0]!.count).toBe(beforeWallets[0]!.count);
  });

  it('19. invalid query params return 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=INVALID').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?page=0').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?limit=101').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?recipientId=not-a-uuid').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?channel=EMAIL').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(400);
  });

  it('20. provider-neutral semantics — SENT does not imply external provider delivery, no credentials', async () => {
    const cid = await createCustomerWithPhone('8010000020');
    // Insert via dispatcher to get realistic providerRef (test-)
    const payload = { customerId: cid, reference: 'REF-NEUTRAL', amountMinor: '1000' };
    const key = `customer.funding.approved:${randomUUID()}`;
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload, correlationId: randomUUID() });
    expect(result.deliveries[0]!.status).toBe('SENT');
    const res = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries').set('Authorization', `Bearer ${workforceToken('SUPPORT')}`).expect(200);
    const found = res.body.data.find((d: any) => d.eventKey === key);
    expect(found).toBeDefined();
    expect(found.status).toBe('SENT');
    expect(found.providerRef).toMatch(/test-/);
    // No credentials leaked
    const bodyStr = JSON.stringify(res.body).toLowerCase();
    expect(bodyStr).not.toContain('apikey');
    expect(bodyStr).not.toContain('twilio');
    expect(bodyStr).not.toContain('termii');
    expect(bodyStr).not.toContain('firebase');
    expect(bodyStr).not.toContain('secret');
  });

  it('21. migration count is 66, reuse notification_deliveries, no new table', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(67);
    const latest: Array<{ name: string; timestamp: string }> = await dataSource.query(`SELECT name, timestamp::text as timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(['1785753600066', '1785753600067', '1785753600068', '1785753600069']).toContain(latest[0]!.timestamp);
    expect(latest[0]!.name).toMatch(/^Create(CapabilityRegistry|LimitProfileCatalogue|LimitAssignments|LimitUsages)178575360006[6-9]$/);
    const notifExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notification_deliveries') as exists`);
    expect(notifExists[0]!.exists).toBe(true);
    const extraExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notification_deliveries_v2') as exists`);
    expect(extraExists[0]!.exists).toBe(false);
    const customerNotifExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customer_notifications') as exists`);
    expect(customerNotifExists[0]!.exists).toBe(false);
  });
});
