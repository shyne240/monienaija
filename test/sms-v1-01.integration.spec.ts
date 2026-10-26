/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { WalletService } from '../src/wallet/wallet.service';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationInboxService } from '../src/notification/notification-inbox.service';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import {
  ConsoleNotificationProvider,
  TestNotificationProvider,
} from '../src/notification/notification-provider.interface';
import { SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES } from '../src/notification/notification-security.constants';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * SMS-V1-01 — production SMS integration verification (real PostgreSQL).
 * Covers: worker-driven delivery, provider failure + bounded retry + exhaustion,
 * concurrent claiming, idempotency, SMS opt-out (+security bypass), phone resolution,
 * inbox isolation, delivery/provider-ref persistence, financial integrity under SMS
 * failure, secret hygiene, provider-neutral defaults.
 */
describe('SMS-V1-01 Production SMS Integration (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let fundingService: CustomerFundingService;
  let dispatcher: NotificationDispatcherService;
  let resolver: NotificationChannelResolverService;
  let inboxService: NotificationInboxService;
  let worker: NotificationWorkerService;
  let testProvider: TestNotificationProvider;
  let configService: ConfigService;

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
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
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
    dataSource = await createIntegrationDataSource('sms-v1-01');
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
    fundingService = moduleRef.get(CustomerFundingService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
    resolver = moduleRef.get(NotificationChannelResolverService);
    inboxService = moduleRef.get(NotificationInboxService);
    worker = moduleRef.get(NotificationWorkerService);
    configService = moduleRef.get(ConfigService);
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
    const settlement: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
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

  async function createCustomerWithPhone(phone: string, smsEnabled = true): Promise<string> {
    const customerId = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [customerId, `cust-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (id, customer_id, display_name, is_active) VALUES ($1,$2,$3,true)`,
      [randomUUID(), customerId, `Cust ${customerId.slice(0, 4)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,true)`,
      [randomUUID(), customerId, phone],
    );
    try {
      await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}` });
    } catch {
      // wallet may already exist per helpers
    }
    await dataSource.query(
      `INSERT INTO customer_preferences (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled, notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1,$2,'EN','SYSTEM',true,$3,true,true,true,true,true,false,1) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId, smsEnabled],
    );
    return customerId;
  }

  async function walletLedgerBalance(customerId: string): Promise<number> {
    const rows: Array<{ bal: string | null }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN ll.direction='CREDIT' THEN ll.amount_minor ELSE -ll.amount_minor END),0)::text AS bal
         FROM ledger_lines ll
         JOIN wallet_accounts w ON w.ledger_account_id = ll.ledger_account_id
        WHERE w.customer_id = $1`,
      [customerId],
    );
    return Number(rows[0]?.bal ?? '0');
  }

  async function walletLedgerLineCount(customerId: string): Promise<number> {
    const rows: Array<{ c: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS c FROM ledger_lines ll JOIN wallet_accounts w ON w.ledger_account_id=ll.ledger_account_id WHERE w.customer_id=$1`,
      [customerId],
    );
    return Number(rows[0]?.c ?? '0');
  }

  async function approveFundingViaHttp(customerId: string, amountMinor: string): Promise<{ fundingId: string; status: string }> {
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/customers/${customerId}/funding-requests`)
      .set('Authorization', `Bearer ${workforceToken('SUPPORT')}`)
      .send({ amountMinor, currency: 'NGN', idempotencyKey: idem })
      .expect(201);
    const fundingId = createRes.body.id as string;
    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`)
      .set('Authorization', `Bearer ${workforceToken('OPERATOR')}`)
      .send({})
      .expect(201);
    return { fundingId, status: approveRes.body.status as string };
  }

  async function makeRetryEligible(): Promise<void> {
    await dataSource.query(`UPDATE notification_deliveries SET updated_at = NOW() - INTERVAL '1 day' WHERE status='FAILED'`);
  }

  it('10. worker drains pending outbox end-to-end: funding approved → SENT delivery + inbox entry', async () => {
    const customerId = await createCustomerWithPhone('8022222221');
    const { fundingId, status } = await approveFundingViaHttp(customerId, '50000');
    expect(status).toBe('APPROVED');
    // Outbox rows enqueued in-transaction by the funding flow (requested + approved)
    const pending: Array<{ n: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS n FROM outbox_events WHERE status='PENDING'`,
    );
    expect(Number(pending[0]!.n)).toBeGreaterThanOrEqual(2);
    // Worker tick: drain outbox → dispatch → provider (test adapter)
    const tick = await worker.tick();
    expect(tick.outboxProcessed).toBeGreaterThanOrEqual(2);
    const deliveries: Array<{ event_key: string; status: string; attempts: number; provider_ref: string | null; destination: string }> =
      await dataSource.query(
        `SELECT event_key, status, attempts, provider_ref, destination FROM notification_deliveries WHERE recipient_id=$1 ORDER BY event_type`,
        [customerId],
      );
    expect(deliveries.length).toBe(2);
    expect(deliveries.every((d) => d.status === 'SENT')).toBe(true);
    expect(deliveries.every((d) => d.attempts === 1 && d.provider_ref && d.provider_ref.startsWith('test-'))).toBe(true);
    expect(deliveries.every((d) => d.destination === '8022222221')).toBe(true);
    void fundingId;
    // Inbox (customer self-view) shows the notifications
    const inbox = await inboxService.listForCustomer(customerId, 1, 10);
    expect(inbox.items.length).toBe(2);
    expect(inbox.items.every((i: any) => ['FUNDING'].includes(i.category))).toBe(true);
  });

  it('4/8/9. provider failure → FAILED + retry → SENT with providerRef and attempts counted', async () => {
    const customerId = await createCustomerWithPhone('8022222222');
    await approveFundingViaHttp(customerId, '25000');
    testProvider.shouldFail = true;
    testProvider.failMessage = 'Simulated provider failure';
    await worker.tick(); // dispatch happens with failing provider
    let rows: Array<{ status: string; attempts: number; last_error: string | null; failed_at: Date | null }> =
      await dataSource.query(
        `SELECT status, attempts, last_error, failed_at FROM notification_deliveries WHERE recipient_id=$1 ORDER BY created_at LIMIT 1`,
        [customerId],
      );
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.last_error).toBe('Simulated provider failure');
    expect(rows[0]!.failed_at).toBeTruthy();
    // Backoff gate: immediately, retry claim must find nothing (row not yet eligible)
    const tooEarly = await worker.tick();
    expect(tooEarly.retriesClaimed).toBe(0);
    // Force eligibility (simulate the exploit window passing), provider healthy now
    testProvider.shouldFail = false;
    await makeRetryEligible();
    const retryTick = await worker.tick();
    expect(retryTick.retriesClaimed).toBeGreaterThanOrEqual(1);
    expect(retryTick.retriesSent).toBeGreaterThanOrEqual(1);
    rows = await dataSource.query(
      `SELECT status, attempts, provider_ref::text AS provider_ref, last_error, sent_at FROM notification_deliveries WHERE recipient_id=$1 ORDER BY created_at LIMIT 1`,
      [customerId],
    );
    const anyRows = rows as any;
    expect(rows[0]!.status).toBe('SENT');
    expect(rows[0]!.attempts).toBe(2);
    expect(anyRows[0].provider_ref).toBeTruthy();
    expect(rows[0]!.last_error).toBeNull();
    expect(anyRows[0].sent_at).toBeTruthy();
  });

  it('5. retry exhaustion: terminally FAILED after SMS_RETRY_MAX_ATTEMPTS, never re-claimed', async () => {
    const maxAttempts = configService.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? 3;
    const customerId = await createCustomerWithPhone('8022222223');
    await approveFundingViaHttp(customerId, '15000');
    testProvider.shouldFail = true;
    await worker.tick(); // attempt 1 (initial dispatch)
    for (let i = 0; i < maxAttempts - 1; i += 1) {
      await makeRetryEligible();
      await worker.tick(); // retry attempts
    }
    const rows: Array<{ status: string; attempts: number; last_error: string | null }> =
      await dataSource.query(
        `SELECT status, attempts, last_error FROM notification_deliveries WHERE recipient_id=$1 AND status='FAILED'`,
        [customerId],
      );
    expect(rows.length).toBe(2); // requested + approved both FAILED (only approved+requested dispatched)
    expect(rows.every((r) => r.attempts === maxAttempts)).toBe(true);
    expect(rows.every((r) => r.last_error === 'Simulated provider failure')).toBe(true);
    // Recovery: provider healthy, but exhausted rows must never be claimed again
    testProvider.shouldFail = false;
    await makeRetryEligible();
    const finalTick = await worker.tick();
    expect(finalTick.retriesClaimed).toBe(0);
    expect(testProvider.sent.length).toBe(0);
    const finalRows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM notification_deliveries WHERE recipient_id=$1`,
      [customerId],
    );
    expect(finalRows.every((r) => r.status === 'FAILED')).toBe(true);
  });

  it('6/7. concurrent workers claim disjoint rows; idempotent processing never re-sends', async () => {
    // Prepare 6 FAILED deliveries via dispatch with failing provider
    const customerIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const cid = await createCustomerWithPhone(`803000000${i}`);
      customerIds.push(cid);
      await dispatcher.dispatch({
        eventType: 'customer.funding.approved',
        eventKey: `concurrent-funding-${i}`,
        aggregateType: 'CUSTOMER_FUNDING_REQUEST',
        aggregateId: randomUUID(),
        payload: { customerId: cid, fundingRequestId: randomUUID(), amountMinor: '1000' },
      });
    }
    testProvider.shouldFail = true;
    const firstRow = await dataSource.query(
      `SELECT COUNT(*)::text AS n FROM notification_deliveries WHERE status='FAILED'`,
    );
    expect(Number(firstRow[0]!.n)).toBe(0); // dispatch above used healthy provider
    // Re-dispatch with failing provider on NEW event keys to create 6 FAILED rows
    for (let i = 0; i < 6; i += 1) {
      await dispatcher.dispatch({
        eventType: 'customer.funding.approved',
        eventKey: `concurrent-fail-${i}`,
        aggregateType: 'CUSTOMER_FUNDING_REQUEST',
        aggregateId: randomUUID(),
        payload: { customerId: customerIds[i], fundingRequestId: randomUUID(), amountMinor: '1000' },
      });
    }
    const failedCount: Array<{ n: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS n FROM notification_deliveries WHERE status='FAILED'`,
    );
    expect(Number(failedCount[0]!.n)).toBe(6);
    // Two independent worker instances racing the same claim window
    const workerA = new NotificationWorkerService(dataSource, dispatcher, configService, testProvider);
    const workerB = new NotificationWorkerService(dataSource, dispatcher, configService, testProvider);
    testProvider.shouldFail = false;
    testProvider.clear();
    await makeRetryEligible();
    const [tickA, tickB] = await Promise.all([workerA.tick(), workerB.tick()]);
    // FOR UPDATE SKIP LOCKED partitions the eligible set across the two workers:
    // their claimed sets are disjoint and their union covers all 6 rows exactly once.
    expect(tickA.retriesClaimed + tickB.retriesClaimed).toBe(6);
    expect(tickA.retriesSent + tickB.retriesSent).toBe(6);
    // Whatever was claimed was processed exactly once; union covers all 6 rows
    const rows: Array<{ attempts: number; status: string }> = await dataSource.query(
      `SELECT attempts, status FROM notification_deliveries WHERE event_key LIKE 'concurrent-fail-%'`,
    );
    expect(rows.length).toBe(6);
    expect(rows.filter((r) => r.status === 'SENT').length).toBe(6);
    expect(rows.every((r) => r.attempts === 2)).toBe(true); // 1 dispatch failure + exactly 1 worker attempt
    // Each success carry a provider send → exactly 6 successful sends recorded
    expect(testProvider.sent.length).toBe(6);
    // Idempotent re-run: SENT rows are never claimed/re-sent
    await makeRetryEligible();
    const again = await workerA.tick();
    expect(again.retriesClaimed).toBe(0);
    expect(testProvider.sent.length).toBe(6);
  });

  it('12. SMS opt-out: preference false → SKIPPED SMS_OPT_OUT, provider never called, inbox hides', async () => {
    const customerId = await createCustomerWithPhone('8022222224', false);
    const result = await dispatcher.dispatch({
      eventType: 'customer.funding.approved',
      eventKey: `optout-${randomUUID()}`,
      aggregateType: 'CUSTOMER_FUNDING_REQUEST',
      aggregateId: randomUUID(),
      payload: { customerId, fundingRequestId: randomUUID(), amountMinor: '1000' },
    });
    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(testProvider.sent.length).toBe(0);
    const rows: Array<{ status: string; last_error: string | null; destination: string }> =
      await dataSource.query(
        `SELECT status, last_error, destination FROM notification_deliveries WHERE recipient_id=$1`,
        [customerId],
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('SKIPPED');
    expect(rows[0]!.last_error).toBe('SMS_OPT_OUT');
    expect(rows[0]!.destination).toBe('SKIPPED:SMS_OPT_OUT');
    // Inbox: SKIPPED rows stay hidden (existing V1-006 semantics)
    const inbox = await inboxService.listForCustomer(customerId, 1, 10);
    expect(inbox.items.length).toBe(0);
    // Retry machinery must never resurrect an opted-out/SKIPPED row
    const tick = await worker.tick();
    expect(tick.retriesClaimed).toBe(0);
  });

  it('12b. opt-out recorded after initial failure is honored at retry time', async () => {
    const customerId = await createCustomerWithPhone('8022222225', true);
    testProvider.shouldFail = true;
    await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: `late-optout-${randomUUID()}`,
      aggregateType: 'TRANSFER',
      aggregateId: randomUUID(),
      payload: { transferId: randomUUID(), sourceCustomerId: customerId, destinationCustomerId: randomUUID(), amountMinor: '500' },
    });
    const failed: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM notification_deliveries WHERE recipient_id=$1`,
      [customerId],
    );
    expect(failed[0]!.status).toBe('FAILED');
    // Customer opts out after the failure
    await dataSource.query(`UPDATE customer_preferences SET notification_sms_enabled=false WHERE customer_id=$1`, [customerId]);
    testProvider.shouldFail = false;
    await makeRetryEligible();
    const tick = await worker.tick();
    expect(tick.retriesOptedOut).toBe(1);
    expect(tick.retriesSent).toBe(0);
    const final: Array<{ status: string; last_error: string | null }> = await dataSource.query(
      `SELECT status, last_error FROM notification_deliveries WHERE recipient_id=$1`,
      [customerId],
    );
    expect(final[0]!.status).toBe('SKIPPED');
    expect(final[0]!.last_error).toBe('SMS_OPT_OUT');
  });

  it('13. security-critical events bypass the SMS opt-out (mandatory class)', async () => {
    const customerId = await createCustomerWithPhone('8022222226', false);
    // V1 fact: the REQUIRED transactional events are NOT security-critical
    expect(SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES.has('customer.funding.approved')).toBe(false);
    expect(SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES.has('transfer.completed')).toBe(false);
    // Prove the bypass mechanism with a representative OTP-class event added to the registry
    const mutable = SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES as unknown as Set<string>;
    mutable.add('security.test.otp');
    try {
      const resolved = await resolver.resolve('CUSTOMER', customerId, 'SMS', undefined, 'security.test.otp');
      expect(resolved.destination).toBe('8022222226'); // bypassed opt-out → phone resolved
      // Same event NOT in the registry → opt-out applies
      const gated = await resolver.resolve('CUSTOMER', customerId, 'SMS', undefined, 'security.test.other');
      expect(gated.destination).toBeNull();
      expect(gated.reason).toBe('SMS_OPT_OUT');
    } finally {
      mutable.delete('security.test.otp');
    }
  });

  it('10b. customer phone resolution: primary phone preferred from authoritative contact methods', async () => {
    const customerId = await createCustomerWithPhone('8099999999');
    // Secondary non-primary phone exists too — resolver must return the primary
    await dataSource.query(
      `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,false)`,
      [randomUUID(), customerId, '8055555555'],
    );
    const resolved = await resolver.resolve('CUSTOMER', customerId, 'SMS');
    expect(resolved.destination).toBe('8099999999');
  });

  it('11. customer notification isolation: inbox never leaks across customers', async () => {
    const a = await createCustomerWithPhone('8077777771');
    const b = await createCustomerWithPhone('8077777772');
    for (const [cid, key] of [
      [a, `iso-a-${randomUUID()}`],
      [b, `iso-b-${randomUUID()}`],
    ] as const) {
      await dispatcher.dispatch({
        eventType: 'transfer.completed',
        eventKey: key,
        aggregateType: 'TRANSFER',
        aggregateId: randomUUID(),
        payload: { transferId: randomUUID(), sourceCustomerId: cid, destinationCustomerId: randomUUID(), amountMinor: '700' },
      });
    }
    const inboxA = await inboxService.listForCustomer(a, 1, 20);
    const inboxB = await inboxService.listForCustomer(b, 1, 20);
    expect(inboxA.items.length).toBe(1);
    expect(inboxB.items.length).toBe(1);
    const idsA = new Set(inboxA.items.map((i: any) => i.id));
    const idsB = new Set(inboxB.items.map((i: any) => i.id));
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
  });

  it('14. informational SMS failure never reverses or mutates financial state', async () => {
    const customerId = await createCustomerWithPhone('8022222227');
    const { fundingId, status } = await approveFundingViaHttp(customerId, '25000');
    expect(status).toBe('APPROVED');
    const balanceAfterApproval = await walletLedgerBalance(customerId);
    expect(balanceAfterApproval).toBe(25000);
    const lineCountAfterApproval = await walletLedgerLineCount(customerId);
    expect(lineCountAfterApproval).toBe(1);
    // Provider down: process notifications → FAILED delivery
    testProvider.shouldFail = true;
    await worker.tick();
    const failed: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM notification_deliveries WHERE recipient_id=$1 AND status='FAILED'`,
      [customerId],
    );
    expect(failed.length).toBeGreaterThanOrEqual(1);
    // Financial invariants untouched
    const fundingRow: Array<{ status: string }> = await dataSource.query(
      `SELECT status::text AS status FROM customer_funding_requests WHERE id=$1`,
      [fundingId],
    );
    expect(fundingRow[0]!.status).toBe('APPROVED');
    expect(await walletLedgerBalance(customerId)).toBe(25000);
    expect(await walletLedgerLineCount(customerId)).toBe(lineCountAfterApproval);
    const journals: Array<{ c: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS c FROM ledger_journals lj JOIN ledger_lines ll ON ll.journal_id=lj.id
         JOIN wallet_accounts w ON w.ledger_account_id=ll.ledger_account_id WHERE w.customer_id=$1`,
      [customerId],
    );
    expect(Number(journals[0]!.c)).toBe(1);
    // Outbox marked PUBLISHED regardless of provider failure (isolation semantics)
    const outboxStates: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM outbox_events`,
    );
    expect(outboxStates.every((o) => o.status === 'PUBLISHED')).toBe(true);
    // Late recovery: SMS succeeds afterwards; financial state still identical
    testProvider.shouldFail = false;
    await makeRetryEligible();
    await worker.tick();
    expect(await walletLedgerBalance(customerId)).toBe(25000);
    expect(fundingRow[0]!.status).toBe('APPROVED');
  });

  it('15. persisted surfaces carry no secrets, no provider key material', async () => {
    const customerId = await createCustomerWithPhone('8022222228');
    testProvider.shouldFail = true;
    testProvider.failMessage = 'ROBASE_HTTP_402:insufficient_credits';
    await dispatcher.dispatch({
      eventType: 'customer.funding.approved',
      eventKey: `sechygiene-${randomUUID()}`,
      aggregateType: 'CUSTOMER_FUNDING_REQUEST',
      aggregateId: randomUUID(),
      payload: { customerId, fundingRequestId: randomUUID(), amountMinor: '1000' },
    });
    const rows: Array<{ payload: any; message: string; last_error: string | null }> =
      await dataSource.query(
        `SELECT payload, message, last_error FROM notification_deliveries WHERE recipient_id=$1`,
        [customerId],
      );
    const surface = JSON.stringify(rows[0]).toLowerCase();
    expect(surface).not.toContain('robe_');
    expect(surface).not.toContain('apikey');
    expect(surface).not.toContain('authorization');
    expect(surface).not.toContain('pin');
    expect(surface).not.toContain('password');
    expect(surface).not.toContain('secret');
    expect(rows[0]!.last_error).toBe('ROBASE_HTTP_402:insufficient_credits');
  });

  it('16/worker-default. Console/Test adapters intact; worker disabled by default in this environment', async () => {
    // Test adapter intact (isolation semantics relied on by earlier suites)
    testProvider.shouldFail = true;
    const failing = await testProvider.send({
      channel: 'SMS',
      destination: '8011111111',
      message: 'x',
      payload: {},
      eventType: 'test',
      eventKey: 'k',
      recipientType: 'CUSTOMER',
      recipientId: 'c',
    } as any);
    expect(failing.success).toBe(false);
    testProvider.clear();
    // Console adapter intact and provider-neutral default
    const consoleProvider = new ConsoleNotificationProvider();
    const ok = await consoleProvider.send({
      channel: 'SMS',
      destination: '8011111111',
      message: 'hello',
      payload: {},
      eventType: 'test',
      eventKey: 'k',
      recipientType: 'CUSTOMER',
      recipientId: 'c',
    } as any);
    expect(ok.success).toBe(true);
    expect(ok.providerRef).toMatch(/^console-/);
    // Worker is NOT auto-running in the test environment (env default false)
    expect(configService.get<boolean>('NOTIFICATION_WORKER_ENABLED')).toBe(false);
    expect((worker as any).timer).toBeNull();
  });
});
