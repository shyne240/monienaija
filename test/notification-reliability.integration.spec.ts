/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-require-imports */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { WalletService } from '../src/wallet/wallet.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDeliveryProcessor } from '../src/notification/notification-delivery-processor';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { seedNotificationDefaultsV1 } from '../src/notification/notification-defaults-v1';
import { RobaseNotificationProvider } from '../src/notification/robase-notification-provider';
import type { ConfigurableSmsNotificationProvider } from '../src/notification/notification-provider-config.service';
import { NormalizingSmsNotificationProvider } from '../src/notification/normalizing-sms-notification-provider';
import { TestEmailProvider } from '../src/notification/email-provider.interface';
import { CodeNotificationEmailTemplateService } from '../src/notification/notification-email-template.service';
import type { NotificationProvider, NotificationSendRequest, NotificationSendResult } from '../src/notification/notification.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

class RecordingProvider implements NotificationProvider {
  readonly name = 'test';
  sent: NotificationSendRequest[] = [];
  response: NotificationSendResult = { success: true, providerRef: 'synthetic-ref' };
  delay = 0;
  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    this.sent.push(request);
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
    return this.response;
  }
}

describe('notification reliability (real HTTP and PostgreSQL, synthetic providers only)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;
  let resolver: NotificationChannelResolverService;
  let templates: NotificationTemplateService;
  let wallet: WalletService;
  let config: ConfigService;
  let provider: RecordingProvider;

  const workforceConfig = {
    enabled: true, oidcIssuer: 'https://workforce.test', oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce', oidcClientId: 'test-client', internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900, jwksJson: [], financeRoles: [], makerCheckerRules: [], rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  };
  const workforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token.startsWith('workforce-')) throw new UnauthorizedException('invalid');
      const noScope = token.toUpperCase().endsWith('-NOSCOPE');
      const type = token.replace('workforce-', '').replace(/-NOSCOPE$/i, '').toUpperCase();
      return { type, principalId: `test-${type}`, audience, roles: [],
        scopes: noScope ? [] : ['notification.view_deliveries'], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE' };
    },
  };

  beforeAll(async () => {
    ds = await createIntegrationDataSource('notif-reliability');
    provider = new RecordingProvider();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(ds)
      .overrideProvider(A2WorkforceSessionService).useValue(workforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG).useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN).useValue(provider).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    dispatcher = module.get(NotificationDispatcherService);
    worker = module.get(NotificationWorkerService);
    resolver = module.get(NotificationChannelResolverService);
    templates = module.get(NotificationTemplateService);
    wallet = module.get(WalletService);
    config = module.get(ConfigService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  beforeEach(async () => {
    provider.sent = [];
    provider.response = { success: true, providerRef: 'synthetic-ref' };
    provider.delay = 0;
    const rows: Array<{ tablename: string }> = await ds.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) await ds.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await seedNotificationDefaultsV1(ds.manager);
    await ds.query(`INSERT INTO ledger_accounts
      (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES
      ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
      ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
      ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
      ('00000000-0000-4000-8000-000000000001','AGENT_FUNDING_POOL-NGN','Agent funding pool NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
      ('00000000-0000-4000-8000-000000000002','CASH_TO_CASH-UNCLAIMED-NGN','Cash to cash unclaimed NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
      ON CONFLICT (code) DO NOTHING`);
  });

  async function customer(phone = '8012345678', options: { verified?: boolean; preference?: boolean | null; email?: string } = {}): Promise<string> {
    const id = randomUUID();
    await ds.query(`INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status)
      VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [id, `cust-${id}`]);
    await ds.query(`INSERT INTO customer_profiles (id,customer_id,display_name,is_active) VALUES ($1,$2,'Synthetic Customer',true)`, [randomUUID(), id]);
    await ds.query(`INSERT INTO customer_contact_methods (id,customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES ($1,$2,'PHONE',$3,$3,true,CASE WHEN $4::boolean THEN NOW() ELSE NULL END)`,
      [randomUUID(), id, phone, options.verified ?? true]);
    if (options.email) await ds.query(`INSERT INTO customer_contact_methods (id,customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES ($1,$2,'EMAIL',$3,$3,true,NOW())`, [randomUUID(), id, options.email]);
    if (options.preference !== null) await ds.query(`INSERT INTO customer_preferences
      (id,customer_id,language_code,theme_code,notification_email_enabled,notification_sms_enabled,notification_push_enabled,
       notification_in_app_enabled,security_login_alerts,security_transaction_alerts,security_device_registration_alerts,
       security_biometric_allowed,version) VALUES ($1,$2,'EN','SYSTEM',true,$3,true,true,true,true,true,false,1)`,
      [randomUUID(), id, options.preference ?? true]);
    return id;
  }

  async function event(eventType: string, payload: Record<string, unknown>, options: { status?: string; schema?: number; key?: string; futureAvailable?: boolean } = {}) {
    const id = randomUUID();
    const key = options.key ?? `${eventType}:${id}`;
    await ds.query(`INSERT INTO outbox_events
      (id,event_type,event_key,aggregate_type,aggregate_id,payload,status,schema_version,attempts,available_at,last_error)
      VALUES ($1,$2,$3,'TEST',$4,$5::jsonb,$6,$7,7,CASE WHEN $8 THEN NOW()+INTERVAL '1 day' ELSE NOW() END,'OTHER_CONSUMER_ERROR')`,
      [id, eventType, key, randomUUID(), JSON.stringify(payload), options.status ?? 'PENDING', options.schema ?? 1, options.futureAvailable ?? false]);
    return { id, key };
  }

  function processor(smsProvider: NotificationProvider = provider, emailProvider: NotificationProvider | null = null): NotificationDeliveryProcessor {
    return new NotificationDeliveryProcessor({ dataSource: ds, resolver, templates, smsProvider, emailProvider,
      maxAttempts: 3, baseDelaySeconds: 1, leaseSeconds: 30 });
  }

  async function materialize(customerId: string, key = `customer.funding.approved:${randomUUID()}`): Promise<string> {
    const result = await ds.transaction((manager) => dispatcher.dispatch({ eventType: 'customer.funding.approved',
      eventKey: key, payload: { customerId, amountMinor: '25000', reference: 'FUND-OK' } }, manager));
    return result.deliveries[0]!.id;
  }

  it('independently checkpoints shared PENDING/FAILED/PUBLISHED events without altering another consumer, and replay is idempotent', async () => {
    const cid = await customer();
    const a = await event('customer.funding.approved', { customerId: cid, reference: 'FUND-A' });
    const b = await event('customer.funding.requested', { customerId: cid, reference: 'FUND-B' }, { status: 'FAILED', futureAvailable: true });
    const c = await event('customer.funding.rejected', { customerId: cid, reference: 'FUND-C' }, { status: 'PUBLISHED' });
    await ds.query(`INSERT INTO notification_outbox_receipts (consumer_name,outbox_event_id,status,reason,attempts)
      VALUES ('other.v1',$1,'MATERIALIZED','OTHER_CONSUMER',9)`, [a.id]);
    const before = await ds.query(`SELECT id,status,attempts,last_error,available_at,published_at FROM outbox_events ORDER BY id`);
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(3);
    expect(provider.sent).toHaveLength(0); // transaction never calls provider
    expect(await ds.query(`SELECT id,status,attempts,last_error,available_at,published_at FROM outbox_events ORDER BY id`)).toEqual(before);
    expect(await ds.query(`SELECT status,reason,attempts FROM notification_outbox_receipts WHERE consumer_name='other.v1'`))
      .toEqual([{ status: 'MATERIALIZED', reason: 'OTHER_CONSUMER', attempts: 9 }]);
    expect(await ds.query(`SELECT status FROM notification_outbox_receipts WHERE consumer_name='notification.v1' ORDER BY outbox_event_id`))
      .toEqual([{ status: 'MATERIALIZED' }, { status: 'MATERIALIZED' }, { status: 'MATERIALIZED' }]);
    await ds.query(`DELETE FROM notification_outbox_receipts WHERE consumer_name='notification.v1' AND outbox_event_id=$1`, [a.id]);
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(1);
    expect((await ds.query(`SELECT id FROM notification_deliveries`))).toHaveLength(3);
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(0);
    expect([b.id, c.id]).toHaveLength(2);
  });

  it('refreshes provider configuration outside materialization transactions with a single-connection pool', async () => {
    const singleConnection = new DataSource({ ...ds.options, extra: { max: 1, connectionTimeoutMillis: 1000 } });
    await singleConnection.initialize();
    const refreshRuntimeCache = jest.fn(async () => { await singleConnection.query('SELECT 1'); });
    const onePoolDispatcher = new NotificationDispatcherService(singleConnection,
      new NotificationChannelResolverService(singleConnection), templates, provider, null, null,
      { refreshRuntimeCache } as never, config);
    try {
      const cid = await customer();
      const direct = await onePoolDispatcher.dispatch({ eventType: 'customer.funding.approved',
        eventKey: `direct:${randomUUID()}`, payload: { customerId: cid } });
      expect(direct.dispatched).toBe(1);
      const ev = await event('customer.funding.approved', { customerId: cid });
      expect(await onePoolDispatcher.processPendingOutboxEvents(1)).toBe(1);
      expect(await ds.query(`SELECT status FROM notification_outbox_receipts WHERE outbox_event_id=$1`, [ev.id]))
        .toEqual([{ status: 'MATERIALIZED' }]);
      expect(provider.sent).toHaveLength(1); // no provider call in the outbox transaction
      expect(refreshRuntimeCache).toHaveBeenCalledTimes(2);
    } finally { await singleConnection.destroy(); }
  });

  it('quarantines zero-intent, partial transfer, unknown-schema and unsafe visibility; unsupported and internal events are explicit', async () => {
    const cid = await customer();
    const cases = [
      await event('unknown.business.event', { private: 'SENTINEL' }),
      await event('transfer.completed', { transferId: randomUUID() }),
      await event('transfer.completed', { sourceCustomerId: cid }),
      await event('customer.funding.approved', { customerId: cid }, { schema: 2 }),
      await event('support.ticket.message_added', { customerId: cid }),
      await event('support.ticket.message_added', { customerId: cid, isInternal: true }),
    ];
    await dispatcher.processPendingOutboxEvents(20);
    const receipts = await ds.query(`SELECT outbox_event_id,status,reason FROM notification_outbox_receipts WHERE consumer_name='notification.v1'`);
    const byId = new Map(receipts.map((r: any) => [r.outbox_event_id, r]));
    expect(byId.get(cases[0]!.id)).toMatchObject({ status: 'QUARANTINED', reason: 'EVENT_TYPE_UNSUPPORTED' });
    expect(byId.get(cases[1]!.id)).toMatchObject({ status: 'QUARANTINED', reason: 'NO_NOTIFICATION_INTENTS' });
    expect(byId.get(cases[2]!.id)).toMatchObject({ status: 'QUARANTINED', reason: 'NO_NOTIFICATION_INTENTS' });
    expect(byId.get(cases[3]!.id)).toMatchObject({ status: 'QUARANTINED', reason: 'UNSUPPORTED_SCHEMA_VERSION' });
    expect(byId.get(cases[4]!.id)).toMatchObject({ status: 'QUARANTINED', reason: 'SUPPORT_VISIBILITY_UNKNOWN' });
    expect(byId.get(cases[5]!.id)).toMatchObject({ status: 'SUPPRESSED', reason: 'INTERNAL_SUPPORT_MESSAGE' });
    expect(await ds.query('SELECT id FROM notification_deliveries')).toHaveLength(0);
    expect(JSON.stringify(receipts)).not.toContain('SENTINEL');
    // Even a corrupt/legacy reason is not returned as raw text in authorized diagnostics.
    await ds.query(`UPDATE notification_outbox_receipts SET reason='PRIVATE_REASON_SENTINEL' WHERE outbox_event_id=$1`, [cases[0]!.id]);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/outbox-receipts').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/outbox-receipts')
      .set('Authorization', 'Bearer workforce-SUPPORT-NOSCOPE').expect(403);
    const diagnostics = await request(app.getHttpServer()).get('/api/v1/internal/notifications/outbox-receipts?status=QUARANTINED')
      .set('Authorization', 'Bearer workforce-SUPPORT').expect(200);
    expect(diagnostics.body.data).toHaveLength(5);
    expect(diagnostics.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'UNCLASSIFIED' })]));
    expect(JSON.stringify(diagnostics.body)).not.toContain('SENTINEL');
  });

  it('rolls back every intended delivery on an insert failure, records a safe retry, and recovers atomically', async () => {
    const first = await customer('8011111111');
    const second = await customer('8022222222');
    const ev = await event('transfer.completed', { sourceCustomerId: first, destinationCustomerId: second, amountMinor: '10000' });
    await ds.query(`CREATE OR REPLACE FUNCTION notif_test_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.recipient_id='${second}' THEN RAISE EXCEPTION 'PRIVATE_INSERT_SENTINEL'; END IF; RETURN NEW; END $$`);
    await ds.query(`CREATE TRIGGER notif_test_insert_failure BEFORE INSERT ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION notif_test_insert_failure()`);
    const log = jest.spyOn((dispatcher as any).logger, 'warn');
    try {
      await dispatcher.processPendingOutboxEvents(10);
      expect(await ds.query(`SELECT id FROM notification_deliveries WHERE event_key=$1`, [ev.key])).toHaveLength(0);
      expect(await ds.query(`SELECT status,reason,attempts FROM notification_outbox_receipts WHERE outbox_event_id=$1`, [ev.id]))
        .toEqual([{ status: 'FAILED', reason: 'MATERIALIZATION_FAILED', attempts: 1 }]);
      expect(provider.sent).toHaveLength(0);
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_INSERT_SENTINEL');
    } finally {
      log.mockRestore();
      await ds.query('DROP TRIGGER notif_test_insert_failure ON notification_deliveries');
      await ds.query('DROP FUNCTION notif_test_insert_failure()');
    }
    await ds.query(`UPDATE notification_outbox_receipts SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE outbox_event_id=$1`, [ev.id]);
    await dispatcher.processPendingOutboxEvents(10);
    expect(await ds.query(`SELECT id FROM notification_deliveries WHERE event_key=$1`, [ev.key])).toHaveLength(2);
    expect(await ds.query(`SELECT status,attempts FROM notification_outbox_receipts WHERE outbox_event_id=$1`, [ev.id]))
      .toEqual([{ status: 'MATERIALIZED', attempts: 2 }]);
    expect(provider.sent).toHaveLength(0);
  });

  it('claims concurrent PENDING work once, with durable attempt numbers and no duplicate submissions', async () => {
    for (let i = 0; i < 6; i += 1) {
      const cid = await customer(`80${String(10000000 + i)}`);
      await materialize(cid);
    }
    provider.delay = 15;
    const results = await Promise.all([processor().processBatch(10), processor().processBatch(10)]);
    expect(results[0].sent + results[1].sent).toBe(6);
    expect(provider.sent).toHaveLength(6);
    expect(new Set(provider.sent.map((sent) => sent.eventKey)).size).toBe(6);
    expect(await ds.query(`SELECT status,attempts FROM notification_deliveries ORDER BY id`))
      .toEqual(Array(6).fill({ status: 'SENT', attempts: 1 }));
    expect(await ds.query(`SELECT status FROM notification_delivery_attempts ORDER BY id`))
      .toEqual(Array(6).fill({ status: 'ACCEPTED' }));
    await processor().processBatch(10);
    expect(provider.sent).toHaveLength(6);
  });

  it('recovers an expired pre-send claim and fences a stale owner', async () => {
    const id = await materialize(await customer());
    const p = processor();
    const stale = await (p as any).claim(id);
    await ds.query(`UPDATE notification_deliveries SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
    expect(await p.recoverExpiredLeases()).toBe(1);
    expect(await ds.query(`SELECT status,attempts,last_error FROM notification_deliveries WHERE id=$1`, [id]))
      .toEqual([{ status: 'FAILED', attempts: 1, last_error: 'LEASE_EXPIRED_BEFORE_SEND' }]);
    await ds.query(`UPDATE notification_deliveries SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
    expect((await processor().processBatch(1)).sent).toBe(1);
    expect(await (p as any).execute(stale)).toBe('LOST');
    expect(provider.sent).toHaveLength(1);
    expect(await ds.query(`SELECT attempt_number,status FROM notification_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt_number`, [id]))
      .toEqual([{ attempt_number: 1, status: 'FAILED' }, { attempt_number: 2, status: 'ACCEPTED' }]);
  });

  it('quarantines possible provider acceptance when the status commit fails, and never blindly resends', async () => {
    const id = await materialize(await customer());
    await ds.query(`CREATE OR REPLACE FUNCTION notif_test_finish_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='SENT' THEN RAISE EXCEPTION 'PRIVATE_FINISH_SENTINEL'; END IF; RETURN NEW; END $$`);
    await ds.query('CREATE TRIGGER notif_test_finish_failure BEFORE UPDATE ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION notif_test_finish_failure()');
    try {
      const result = await processor().processBatch(1);
      expect(result.failed).toBe(1);
      expect(provider.sent).toHaveLength(1); // synthetic provider accepted before DB failure
      expect(await ds.query(`SELECT status,attempts,lease_token IS NOT NULL AS leased FROM notification_deliveries WHERE id=$1`, [id]))
        .toEqual([{ status: 'PENDING', attempts: 1, leased: true }]);
      expect(await ds.query(`SELECT status FROM notification_delivery_attempts WHERE delivery_id=$1`, [id]))
        .toEqual([{ status: 'STARTED' }]);
    } finally {
      await ds.query('DROP TRIGGER notif_test_finish_failure ON notification_deliveries');
      await ds.query('DROP FUNCTION notif_test_finish_failure()');
    }
    await ds.query(`UPDATE notification_deliveries SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
    const recovery = processor();
    await recovery.recoverExpiredLeases();
    expect(await ds.query(`SELECT status,attempts,last_error FROM notification_deliveries WHERE id=$1`, [id]))
      .toEqual([{ status: 'UNKNOWN', attempts: 1, last_error: 'LEASE_EXPIRED_AFTER_START' }]);
    expect(await ds.query(`SELECT status FROM notification_delivery_attempts WHERE delivery_id=$1`, [id]))
      .toEqual([{ status: 'UNKNOWN' }]);
    expect((await recovery.processBatch(10)).claimed).toBe(0);
    expect(provider.sent).toHaveLength(1);
  });

  it('bounds definitely rejected retries, but quarantines an ambiguous timeout immediately', async () => {
    const id = await materialize(await customer());
    provider.response = { success: false, failureDisposition: 'RETRYABLE', error: 'PRIVATE_PROVIDER_SENTINEL' };
    for (let i = 0; i < 3; i += 1) {
      await processor().processBatch(1);
      await ds.query(`UPDATE notification_deliveries SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [id]);
    }
    const terminal = await ds.query(`SELECT status,attempts,last_error FROM notification_deliveries WHERE id=$1`, [id]);
    expect(terminal).toEqual([{ status: 'DEAD', attempts: 3, last_error: 'PROVIDER_REJECTED_OR_EXHAUSTED' }]);
    expect(JSON.stringify(terminal)).not.toContain('PRIVATE_PROVIDER_SENTINEL');
    const id2 = await materialize(await customer('8023456789'));
    provider.response = { success: false, error: 'ROBASE_TIMEOUT' };
    await processor().processBatch(10);
    expect(await ds.query(`SELECT status,attempts FROM notification_deliveries WHERE id=$1`, [id2]))
      .toEqual([{ status: 'UNKNOWN', attempts: 1 }]);
    const calls = provider.sent.length;
    await processor().processBatch(10);
    expect(provider.sent).toHaveLength(calls);
  });

  it('suppresses unverified contacts and missing preferences; real preference lookup outage records a retry without sending', async () => {
    const unverified = await customer('8012345678', { verified: false });
    const noPreference = await customer('8023456789', { preference: null });
    const one = await materialize(unverified);
    const two = await materialize(noPreference);
    expect(await ds.query(`SELECT id,status,last_error FROM notification_deliveries WHERE id=ANY($1::uuid[]) ORDER BY id`, [[one, two]]))
      .toEqual(expect.arrayContaining([
        { id: one, status: 'SKIPPED', last_error: 'CUSTOMER_PHONE_VERIFIED_MISSING' },
        { id: two, status: 'SKIPPED', last_error: 'SMS_PREFERENCE_UNAVAILABLE' },
      ]));
    const withSecondary = await customer('8045678901', { verified: false });
    await ds.query(`INSERT INTO customer_contact_methods
      (id,customer_id,type,value,normalized_value,is_primary,verified_at)
      VALUES ($1,$2,'PHONE','8056789012','8056789012',false,NOW())`, [randomUUID(), withSecondary]);
    expect(await resolver.resolve('CUSTOMER', withSecondary, 'SMS')).toMatchObject({ destination: '8056789012' });
    const cid = await customer('8034567890');
    const ev = await event('customer.funding.approved', { customerId: cid });
    await ds.query('ALTER TABLE customer_preferences RENAME TO customer_preferences_temporarily_unavailable');
    try { await dispatcher.processPendingOutboxEvents(10); }
    finally { await ds.query('ALTER TABLE customer_preferences_temporarily_unavailable RENAME TO customer_preferences'); }
    expect(await ds.query(`SELECT status,reason FROM notification_outbox_receipts WHERE outbox_event_id=$1`, [ev.id]))
      .toEqual([{ status: 'FAILED', reason: 'MATERIALIZATION_FAILED' }]);
    expect(provider.sent).toHaveLength(0);
    await ds.query(`UPDATE notification_outbox_receipts SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE outbox_event_id=$1`, [ev.id]);
    await dispatcher.processPendingOutboxEvents(10);
    expect(await ds.query(`SELECT status FROM notification_outbox_receipts WHERE outbox_event_id=$1`, [ev.id]))
      .toEqual([{ status: 'MATERIALIZED' }]);
  });

  it('rechecks verified destination and preferences immediately before sending, including real lookup failures', async () => {
    const first = await customer('8012345678');
    const firstDelivery = await materialize(first);
    await ds.query(`UPDATE customer_contact_methods SET verified_at=NULL WHERE customer_id=$1`, [first]);
    await processor().processBatch(10);
    expect(await ds.query(`SELECT status,last_error FROM notification_deliveries WHERE id=$1`, [firstDelivery]))
      .toEqual([{ status: 'SKIPPED', last_error: 'CUSTOMER_PHONE_VERIFIED_MISSING' }]);
    const second = await customer('8023456789');
    const secondDelivery = await materialize(second);
    await ds.query(`UPDATE customer_preferences SET notification_sms_enabled=false WHERE customer_id=$1`, [second]);
    await processor().processBatch(10);
    expect(await ds.query(`SELECT status,last_error FROM notification_deliveries WHERE id=$1`, [secondDelivery]))
      .toEqual([{ status: 'SKIPPED', last_error: 'SMS_OPT_OUT' }]);
    const third = await customer('8034567890');
    const thirdDelivery = await materialize(third);
    await ds.query('ALTER TABLE customer_preferences RENAME TO customer_preferences_temporarily_unavailable');
    try { await processor().processBatch(10); }
    finally { await ds.query('ALTER TABLE customer_preferences_temporarily_unavailable RENAME TO customer_preferences'); }
    expect(await ds.query(`SELECT status,attempts,last_error FROM notification_deliveries WHERE id=$1`, [thirdDelivery]))
      .toEqual([{ status: 'FAILED', attempts: 1, last_error: 'PRE_SEND_FAILED' }]);
    expect(provider.sent).toHaveLength(0);
    await ds.query(`UPDATE notification_deliveries SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [thirdDelivery]);
    expect((await processor().processBatch(10)).sent).toBe(1);
  });

  it('sends C2C via the actual Robase adapter with fake transport, only E.164 and approved safe content', async () => {
    const bodies: any[] = [];
    const adapter = new RobaseNotificationProvider({ baseUrl: 'https://api.robase.dev', apiKey: 'robe_' + 'a'.repeat(64), requestTimeoutMs: 1000 },
      async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'fake-ref' }) }; });
    const normalized = new NormalizingSmsNotificationProvider(adapter as unknown as ConfigurableSmsNotificationProvider);
    const ev = await event('cash_to_cash.created', { beneficiaryPhone: '08012345678', senderDisplayName: 'Ada Example',
      amountMinor: '250000', currency: 'NGN', locatorUrl: 'https://locator.example.ng/agents',
      transferNumber: '123456', transferCode: 'C2C_SECRET_SENTINEL', senderPhone: '8098765432', journalId: 'JOURNAL_SENTINEL' });
    await dispatcher.processPendingOutboxEvents(10);
    const stored = await ds.query(`SELECT payload,message,destination FROM notification_deliveries WHERE event_key=$1`, [ev.key]);
    expect(stored).toHaveLength(1);
    expect(stored[0].destination).toBe('8012345678');
    expect(JSON.stringify(stored[0].payload)).not.toMatch(/C2C_SECRET_SENTINEL|JOURNAL_SENTINEL|123456|8098765432/);
    expect((await processor(normalized).processBatch(1)).sent).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].phone_number).toBe('+2348012345678');
    expect(bodies[0].message).toContain('NGN 2500.00');
    expect(JSON.stringify({ message: bodies[0].message, metadata: bodies[0].metadata }))
      .not.toMatch(/C2C_SECRET_SENTINEL|JOURNAL_SENTINEL|123456|8098765432/);
  });

  it('does not use the unregistered C2C exception for a registered unverified or opted-out contact', async () => {
    const cid = await customer('8012345678', { verified: false });
    const first = await event('cash_to_cash.created', { beneficiaryPhone: '8012345678', amountMinor: '100', currency: 'NGN' });
    await dispatcher.processPendingOutboxEvents(10);
    expect(await ds.query(`SELECT status,last_error FROM notification_deliveries WHERE event_key=$1`, [first.key]))
      .toEqual([{ status: 'SKIPPED', last_error: 'PHONE_RECIPIENT_UNVERIFIED' }]);
    await ds.query(`UPDATE customer_contact_methods SET verified_at=NOW() WHERE customer_id=$1`, [cid]);
    await ds.query(`UPDATE customer_preferences SET notification_sms_enabled=false WHERE customer_id=$1`, [cid]);
    const second = await event('cash_to_cash.created', { beneficiaryPhone: '+2348012345678', amountMinor: '100', currency: 'NGN' });
    await dispatcher.processPendingOutboxEvents(10);
    expect(await ds.query(`SELECT status,last_error FROM notification_deliveries WHERE event_key=$1`, [second.key]))
      .toEqual([{ status: 'SKIPPED', last_error: 'SMS_OPT_OUT' }]);
    await processor().processBatch(10);
    expect(provider.sent).toHaveLength(0);
  });

  it('persists and sends the exact EMAIL subject/body snapshot rather than re-rendering at retry', async () => {
    const cid = await customer('8012345678', { email: 'verified@example.test' });
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=true, version=version+1 WHERE event_type='customer.funding.approved' AND channel='EMAIL'`);
    await ds.transaction(async (manager) => {
      await manager.query(`UPDATE notification_templates SET is_active=false
        WHERE event_type='customer.funding.approved' AND channel='EMAIL' AND is_active`);
      await manager.query(`INSERT INTO notification_templates
        (event_type,channel,locale,version,is_active,subject,body,created_by)
        VALUES ('customer.funding.approved','EMAIL','en-NG',2,true,'Long synthetic subject',$1,'synthetic-test')`, ['A'.repeat(3800)]);
    });
    const email = new TestEmailProvider();
    const local = new NotificationDispatcherService(ds, resolver, templates, provider, email,
      new CodeNotificationEmailTemplateService(templates), undefined, config);
    const result = await ds.transaction((manager) => local.dispatch({ eventType: 'customer.funding.approved',
      eventKey: `customer.funding.approved:${randomUUID()}`, payload: { customerId: cid, amountMinor: '10000' } }, manager));
    const row = await ds.query(`SELECT message,rendered_subject,rendered_html FROM notification_deliveries WHERE id=$1`,
      [result.deliveries.find((delivery) => delivery.channel === 'EMAIL')!.id]);
    expect(row[0].message).toHaveLength(3800);
    email.shouldFail = true;
    const first = await processor(provider, email).processBatch(10);
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(1);
    // Simulate a later governed template version in the disposable test database. Retry must
    // still use the original immutable snapshot, not the currently active version.
    await ds.transaction(async (manager) => {
      await manager.query(`UPDATE notification_templates SET is_active=false
        WHERE event_type='customer.funding.approved' AND channel='EMAIL' AND is_active`);
      await manager.query(`INSERT INTO notification_templates
        (event_type,channel,locale,version,is_active,subject,body,created_by)
        VALUES ('customer.funding.approved','EMAIL','en-NG',3,true,'Changed subject','Changed text','synthetic-test')`);
    });
    email.shouldFail = false;
    await ds.query(`UPDATE notification_deliveries SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE channel='EMAIL'`);
    expect((await processor(provider, email).processBatch(10)).sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.message).toBe(row[0].message);
    expect(email.sent[0]!.subject).toBe(row[0].rendered_subject);
    expect(email.sent[0]!.html).toBe(row[0].rendered_html);
  });

  it('uses the real funding HTTP flow, preserves journals/shared outbox, and exposes safe terminal diagnostics over HTTP', async () => {
    const cid = await customer();
    await wallet.createWallet({ customerId: cid, currency: 'NGN', idempotencyKey: `wallet-${cid}` });
    const created = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${cid}/funding-requests`)
      .set('Authorization', 'Bearer workforce-SUPPORT')
      .send({ amountMinor: '50000', currency: 'NGN', idempotencyKey: `idem-${randomUUID()}` }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${created.body.id}/approve`)
      .set('Authorization', 'Bearer workforce-OPERATOR').send({}).expect(201);
    const journals = await ds.query(`SELECT id,accounting_unit FROM ledger_journals ORDER BY id`);
    const lines = await ds.query(`SELECT id,journal_id,amount_minor,direction FROM ledger_lines ORDER BY id`);
    const shared = await ds.query(`SELECT id,status,attempts,last_error FROM outbox_events ORDER BY id`);
    expect(journals.length).toBeGreaterThan(0);
    expect(await dispatcher.processPendingOutboxEvents(20)).toBeGreaterThanOrEqual(2);
    expect(provider.sent).toHaveLength(0);
    await worker.tick();
    expect(provider.sent.length).toBeGreaterThanOrEqual(2);
    expect(await ds.query(`SELECT id,accounting_unit FROM ledger_journals ORDER BY id`)).toEqual(journals);
    expect(await ds.query(`SELECT id,journal_id,amount_minor,direction FROM ledger_lines ORDER BY id`)).toEqual(lines);
    expect(await ds.query(`SELECT id,status,attempts,last_error FROM outbox_events ORDER BY id`)).toEqual(shared);
    const deliveryId = (await ds.query(`SELECT id FROM notification_deliveries LIMIT 1`))[0].id;
    await ds.query(`UPDATE notification_deliveries SET status='UNKNOWN',last_error='PROVIDER_OUTCOME_UNKNOWN',message='PRIVATE_MESSAGE_SENTINEL' WHERE id=$1`, [deliveryId]);
    const response = await request(app.getHttpServer()).get('/api/v1/internal/notifications/deliveries?status=UNKNOWN')
      .set('Authorization', 'Bearer workforce-SUPPORT').expect(200);
    expect(response.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: deliveryId, status: 'UNKNOWN', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' })]));
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_MESSAGE_SENTINEL');
  });
});
