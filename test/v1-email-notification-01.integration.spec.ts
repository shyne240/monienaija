/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
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
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { NoneEmailProvider, TestEmailProvider } from '../src/notification/email-provider.interface';
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationInboxService } from '../src/notification/notification-inbox.service';
import { NotificationTemplateService } from '../src/notification/notification-template.service';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { WalletService } from '../src/wallet/wallet.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { seedNotificationDefaultsV1 } from '../src/notification/notification-defaults-v1';

/**
 * ARENA3-NOTIFICATION-EMAIL — EMAIL delivery infrastructure integration suite (real PostgreSQL).
 *
 * Covers: migration 097 constraint widening (EMAIL accepted; existing SMS/PUSH semantics
 * untouched), dark-posture parity (provider none ⇒ zero EMAIL intents/rows ⇒ SMS behaviour
 * byte-identical), configured dispatch e2e (SMS + EMAIL rows, subject/html/text contracts),
 * opt-out and missing-destination SKIPPED reasons, AGENT email dependency, idempotency,
 * worker retry channel routing (EMAIL never re-sends via the SMS provider and vice versa),
 * email opt-out re-check at retry, inbox projection, and the provider-status / test-send
 * APIs (401/403/400/429/audit + zero credential material anywhere).
 *
 * Harness pattern: v1-hardening-09 (AppModule + overridden DataSource/workforce session/
 * provider tokens; Fastify; api/v1 prefix; supertest).
 */
describe('V1-EMAIL-NOTIFICATION-01 EMAIL delivery infrastructure (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let smsProvider: TestNotificationProvider;
  let emailProvider: TestEmailProvider;
  let walletService: WalletService;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;
  let inboxService: NotificationInboxService;

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

  // Token suffix → granted function scopes (server-side checks are fail-closed on these).
  const scopeMap: Record<string, string[]> = {
    ops: ['notification.view_deliveries', 'notification.provider.view', 'notification.test_send'],
    viewer: ['notification.view_deliveries', 'notification.provider.view'],
    deliveryonly: ['notification.view_deliveries'],
    noscopes: [],
  };

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const suffix = token.replace('workforce-', '').toLowerCase();
      if (suffix === 'customer' || suffix === 'agent') {
        return {
          type: suffix.toUpperCase(),
          principalId: `workforce-${suffix}-1`,
          audience,
          roles: [],
          scopes: [],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        } as any;
      }
      if (!(suffix in scopeMap)) throw new UnauthorizedException('invalid type');
      return {
        type: 'SUPPORT',
        principalId: `workforce-${suffix}-1`,
        audience,
        roles: [],
        scopes: scopeMap[suffix],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-email-notification-01');
    smsProvider = new TestNotificationProvider();
    emailProvider = new TestEmailProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
      .useValue(smsProvider)
      .overrideProvider(NOTIFICATION_EMAIL_PROVIDER_TOKEN)
      .useValue(emailProvider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    walletService = moduleRef.get(WalletService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
    worker = moduleRef.get(NotificationWorkerService);
    inboxService = moduleRef.get(NotificationInboxService);
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
    smsProvider.clear();
    emailProvider.clear();
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    // Arena 1 registry defaults are migration-owned reference data — restore after TRUNCATE
    // (same pattern as pg-harness truncateAllTables), then enable the EMAIL channel rows:
    // the seed ships EMAIL event configurations DISABLED (email dark by default at the
    // registry level too); these tests exercise the configured-email posture.
    await seedNotificationDefaultsV1(dataSource.manager);
    await dataSource.query(
      `UPDATE notification_event_configurations SET is_enabled=true, version=version+1, updated_at=now()
        WHERE channel='EMAIL' AND delivery_class <> 'SECURITY'`,
    );
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

  function token(suffix: string): string {
    return `workforce-${suffix}`;
  }

  async function createCustomer(opts: { phone?: string; email?: string; smsEnabled?: boolean; emailEnabled?: boolean } = {}): Promise<string> {
    const customerId = randomUUID();
    await dataSource.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [customerId, `cust-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO customer_profiles (id, customer_id, display_name, is_active) VALUES ($1,$2,$3,true)`, [randomUUID(), customerId, `Cust ${customerId.slice(0, 4)}`]);
    if (opts.phone) {
      await dataSource.query(`INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,true)`, [randomUUID(), customerId, opts.phone]);
    }
    if (opts.email) {
      await dataSource.query(`INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'EMAIL',$3,$4,true)`, [randomUUID(), customerId, opts.email, opts.email.toLowerCase()]);
    }
    try {
      await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}` });
    } catch {}
    await dataSource.query(
      `INSERT INTO customer_preferences (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled, notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1,$2,'EN','SYSTEM',$3,$4,true,true,true,true,true,false,1) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId, opts.emailEnabled !== false, opts.smsEnabled !== false],
    );
    return customerId;
  }

  async function createAgentDirect(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status) VALUES ($1,'ACTIVE') RETURNING id`, [`ref-${randomUUID()}`]);
    return rows[0]!.id;
  }

  async function makeRetryEligible(deliveryId: string): Promise<void> {
    await dataSource.query(`UPDATE notification_deliveries SET updated_at = NOW() - INTERVAL '300 seconds' WHERE id=$1`, [deliveryId]);
  }

  it('1. migration 097 applied — CHECK accepts EMAIL; SMS/PUSH unchanged; chain consistent', async () => {
    const mig: Array<{ name: string }> = await dataSource.query(`SELECT name FROM typeorm_migrations WHERE name='AddEmailNotificationChannel1785753600097'`);
    expect(mig.length).toBe(1);
    const applied: Array<{ name: string }> = await dataSource.query(`SELECT name FROM typeorm_migrations ORDER BY timestamp ASC`);
    const configured = dataSource.migrations.map((m) => m.name!);
    expect(applied.map((m) => m.name).sort()).toEqual([...configured].sort());
    expect(await dataSource.showMigrations()).toBe(false);

    // Constraint definition includes all three channels
    const cons: Array<{ def: string }> = await dataSource.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='chk_notification_deliveries_channel'`,
    );
    expect(cons.length).toBe(1);
    expect(cons[0]!.def).toContain('EMAIL');
    expect(cons[0]!.def).toContain('SMS');
    expect(cons[0]!.def).toContain('PUSH');

    // Direct inserts for all three channels succeed
    const cid = await createCustomer({ phone: '8011000001', email: `c1-${randomUUID().slice(0, 8)}@example.com` });
    for (const channel of ['SMS', 'PUSH', 'EMAIL']) {
      await dataSource.query(
        `INSERT INTO notification_deliveries (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, message, status, attempts)
         VALUES ('customer.funding.approved',$1,'CUSTOMER',$2,$3,'dest','{}'::jsonb,'m','SENT',1)`,
        [`m097:${channel}:${randomUUID()}`, cid, channel],
      );
    }
    // An unknown channel is still rejected by the constraint
    await expect(
      dataSource.query(
        `INSERT INTO notification_deliveries (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, message, status, attempts)
         VALUES ('customer.funding.approved',$1,'CUSTOMER',$2,'WHATSAPP','dest','{}'::jsonb,'m','SENT',1)`,
        [`m097:bad:${randomUUID()}`, cid],
      ),
    ).rejects.toThrow(/chk_notification_deliveries_channel/);
  });

  it('2. dark posture — provider none ⇒ no EMAIL intents, SMS behaviour byte-identical', async () => {
    const resolver = new NotificationChannelResolverService(dataSource);
    const templates = new NotificationTemplateService();
    const darkDispatcher = new NotificationDispatcherService(
      dataSource,
      resolver,
      templates,
      smsProvider,
      new NoneEmailProvider(),
      null,
    );
    const cid = await createCustomer({ phone: '8011000002', email: `c2-${randomUUID().slice(0, 8)}@example.com` });
    const key = `customer.funding.approved:${randomUUID()}`;
    const result = await darkDispatcher.dispatch({
      eventType: 'customer.funding.approved',
      eventKey: key,
      payload: { customerId: cid, reference: 'REF-DARK', amountMinor: '10000' },
    });
    expect(result.generated).toBe(1); // SMS only — identical to pre-email behaviour
    expect(result.dispatched).toBe(1);
    expect(result.deliveries.length).toBe(1);
    expect(result.deliveries[0]!.channel).toBe('SMS');
    const rows: Array<{ channel: string }> = await dataSource.query(`SELECT channel FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.channel).toBe('SMS');
    expect(emailProvider.sent.length).toBe(0);
    expect(smsProvider.sent.length).toBe(1);
  });

  it('3. configured dispatch e2e — SMS + EMAIL rows, text parity, subject/html contract', async () => {
    const email = `c3-${randomUUID().slice(0, 8)}@example.com`;
    const cid = await createCustomer({ phone: '8011000003', email });
    const key = `transfer.completed:${randomUUID()}`;
    const payload = { sourceCustomerId: cid, transferId: 'abcdef12-3456-7890', amountMinor: '25000', reference: 'REF-E2E' };
    const result = await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey: key, payload });

    expect(result.generated).toBe(2);
    expect(result.dispatched).toBe(2);
    const smsRow = result.deliveries.find((d) => d.channel === 'SMS')!;
    const emailRow = result.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(smsRow.status).toBe('SENT');
    expect(emailRow.status).toBe('SENT');
    expect(emailRow.destination).toBe(email);

    // SMS provider received ONLY the SMS request; email provider ONLY the EMAIL request
    expect(smsProvider.sent.length).toBe(1);
    expect(smsProvider.sent[0]!.channel).toBe('SMS');
    expect(emailProvider.sent.length).toBe(1);
    const sentEmail = emailProvider.sent[0]!;
    expect(sentEmail.channel).toBe('EMAIL');
    expect(sentEmail.destination).toBe(email);
    // INTEGRATION: the Arena 1 registry's ACTIVE approved EMAIL version now controls the
    // subject (seeded 'MonieNaija account update'); curated code subjects apply only in
    // no-registry unit contexts. Body parity with SMS is asserted below.
    expect(sentEmail.subject).toBe('MonieNaija account update');
    expect(sentEmail.html).toContain('<!DOCTYPE html>');
    expect(sentEmail.html).not.toContain('<script');

    // Text parity: email plain-text body identical to the SMS message
    expect(sentEmail.message).toBe(smsProvider.sent[0]!.message);

    // Delivery rows: EMAIL row persists the text body + redacted payload with _templateKey
    const rows: Array<{ channel: string; message: string; status: string; payload: Record<string, unknown>; provider_ref: string | null }> =
      await dataSource.query(`SELECT channel, message, status, payload, provider_ref FROM notification_deliveries WHERE event_key=$1 ORDER BY channel`, [key]);
    expect(rows.length).toBe(2);
    const emailDb = rows.find((r) => r.channel === 'EMAIL')!;
    expect(emailDb.status).toBe('SENT');
    expect(emailDb.message).toBe(sentEmail.message);
    expect(emailDb.message!.length).toBeLessThanOrEqual(1000);
    expect(emailDb.payload._templateKey).toBe('transfer.completed');
    expect(emailDb.provider_ref).toMatch(/^test-email-/);
    // Subject/html are NOT persisted (ephemeral render inputs; text body is the record)
    expect(JSON.stringify(emailDb.payload)).not.toContain('<!DOCTYPE');
  });

  it('4. EMAIL opt-out — SKIPPED EMAIL_OPT_OUT while SMS still delivers; channels independent', async () => {
    const cid = await createCustomer({ phone: '8011000004', email: `c4-${randomUUID().slice(0, 8)}@example.com`, emailEnabled: false });
    const key = `customer.funding.approved:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: cid, reference: 'REF-OPT' } });
    const rows: Array<{ channel: string; status: string; last_error: string | null; destination: string }> =
      await dataSource.query(`SELECT channel, status, last_error, destination FROM notification_deliveries WHERE event_key=$1 ORDER BY channel`, [key]);
    expect(rows.length).toBe(2);
    const emailDb = rows.find((r) => r.channel === 'EMAIL')!;
    const smsDb = rows.find((r) => r.channel === 'SMS')!;
    expect(emailDb.status).toBe('SKIPPED');
    expect(emailDb.last_error).toBe('EMAIL_OPT_OUT');
    expect(emailDb.destination).toBe('SKIPPED:EMAIL_OPT_OUT');
    expect(smsDb.status).toBe('SENT'); // SMS opt-out independence
    expect(emailProvider.sent.length).toBe(0);

    // Reverse: SMS opted out, EMAIL enabled → EMAIL delivers, SMS skipped
    const cid2 = await createCustomer({ phone: '8011000044', email: `c44-${randomUUID().slice(0, 8)}@example.com`, smsEnabled: false });
    const key2 = `customer.funding.approved:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key2, payload: { customerId: cid2, reference: 'REF-OPT2' } });
    const rows2: Array<{ channel: string; status: string; last_error: string | null }> =
      await dataSource.query(`SELECT channel, status, last_error FROM notification_deliveries WHERE event_key=$1 ORDER BY channel`, [key2]);
    expect(rows2.find((r) => r.channel === 'SMS')!.status).toBe('SKIPPED');
    expect(rows2.find((r) => r.channel === 'SMS')!.last_error).toBe('SMS_OPT_OUT');
    expect(rows2.find((r) => r.channel === 'EMAIL')!.status).toBe('SENT');
    expect(emailProvider.sent.length).toBe(1);
  });

  it('5. missing email contact — SKIPPED CUSTOMER_EMAIL_MISSING; SMS unaffected', async () => {
    const cid = await createCustomer({ phone: '8011000005' }); // no EMAIL contact method
    const key = `customer.funding.rejected:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.rejected', eventKey: key, payload: { customerId: cid, reference: 'REF-NOEMAIL' } });
    const rows: Array<{ channel: string; status: string; last_error: string | null }> =
      await dataSource.query(`SELECT channel, status, last_error FROM notification_deliveries WHERE event_key=$1 ORDER BY channel`, [key]);
    expect(rows.find((r) => r.channel === 'EMAIL')!.status).toBe('SKIPPED');
    expect(rows.find((r) => r.channel === 'EMAIL')!.last_error).toBe('CUSTOMER_EMAIL_MISSING');
    expect(rows.find((r) => r.channel === 'SMS')!.status).toBe('SENT');
    expect(emailProvider.sent.length).toBe(0);
  });

  it('6. AGENT recipients get NO EMAIL intents; support events keep agent SMS dependency skip', async () => {
    const cid = await createCustomer({ phone: '8011000006', email: `c6-${randomUUID().slice(0, 8)}@example.com` });
    const agentId = await createAgentDirect();
    const key = `support.ticket.assigned:${randomUUID()}`;
    await dispatcher.dispatch({
      eventType: 'support.ticket.assigned',
      eventKey: key,
      payload: { ticketId: randomUUID(), reference: 'SUP-E6', customerId: cid, agentId },
    });
    const rows: Array<{ recipient_type: string; channel: string; status: string; last_error: string | null }> =
      await dataSource.query(`SELECT recipient_type, channel, status, last_error FROM notification_deliveries WHERE event_key=$1 ORDER BY recipient_type, channel`, [key]);
    // CUSTOMER: SMS + EMAIL. AGENT: SMS dependency SKIPPED only — no EMAIL row (appendCustomerEmailIntents is CUSTOMER-only)
    expect(rows.filter((r) => r.recipient_type === 'AGENT').length).toBe(1);
    const agentRow = rows.find((r) => r.recipient_type === 'AGENT')!;
    expect(agentRow.channel).toBe('SMS');
    expect(agentRow.status).toBe('SKIPPED');
    expect(agentRow.last_error).toBe('AGENT_PHONE_DEPENDENCY_MISSING');
    const custEmail = rows.find((r) => r.recipient_type === 'CUSTOMER' && r.channel === 'EMAIL')!;
    expect(custEmail.status).toBe('SENT');
    // Agent resolver dependency reason is also directly verifiable
    const resolver = new NotificationChannelResolverService(dataSource);
    const agentEmail = await resolver.resolve('AGENT', agentId, 'EMAIL');
    expect(agentEmail).toEqual({ channel: 'EMAIL', destination: null, reason: 'AGENT_EMAIL_DEPENDENCY_MISSING' });
  });

  it('7. idempotency — duplicate dispatch adds nothing, never re-sends email', async () => {
    const cid = await createCustomer({ phone: '8011000007', email: `c7-${randomUUID().slice(0, 8)}@example.com` });
    const key = `customer.funding.requested:${randomUUID()}`;
    const payload = { customerId: cid, fundingRequestId: 'fndreq12-3456', amountMinor: '5000' };
    const first = await dispatcher.dispatch({ eventType: 'customer.funding.requested', eventKey: key, payload });
    const second = await dispatcher.dispatch({ eventType: 'customer.funding.requested', eventKey: key, payload });
    expect(first.generated).toBe(2);
    expect(second.generated).toBe(0);
    expect(second.dispatched).toBe(0);
    expect(smsProvider.sent.length).toBe(1);
    expect(emailProvider.sent.length).toBe(1); // exactly one email, ever
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(rows.length).toBe(2);
    expect(first.deliveries.map((d) => d.id).sort()).toEqual(second.deliveries.map((d) => d.id).sort());
  });

  it('8. worker retry routes EMAIL failures to the EMAIL provider with re-rendered subject/html', async () => {
    const cid = await createCustomer({ phone: '8011000008', email: `c8-${randomUUID().slice(0, 8)}@example.com` });
    const key = `transfer.failed:${randomUUID()}`;
    emailProvider.shouldFail = true;
    emailProvider.failMessage = 'RESEND_HTTP_503:unknown';
    const result = await dispatcher.dispatch({
      eventType: 'transfer.failed',
      eventKey: key,
      payload: { sourceCustomerId: cid, reference: 'REF-RETRY', amountMinor: '1500' },
    });
    const emailDelivery = result.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(emailDelivery.status).toBe('FAILED');
    expect(result.deliveries.find((d) => d.channel === 'SMS')!.status).toBe('SENT');

    const failedRow: Array<{ last_error: string; attempts: number }> = await dataSource.query(
      `SELECT last_error, attempts FROM notification_deliveries WHERE id=$1`,
      [emailDelivery.id],
    );
    expect(failedRow[0]!.last_error).toBe('RESEND_HTTP_503:unknown');
    expect(failedRow[0]!.attempts).toBe(1);

    // Recover provider, make retry-eligible, tick the worker
    emailProvider.shouldFail = false;
    emailProvider.clear();
    const smsSentBefore = smsProvider.sent.length;
    await makeRetryEligible(emailDelivery.id);
    const tick = await worker.tick();
    expect(tick.retriesSent).toBe(1);

    // The retry went to the EMAIL provider — NOT the SMS provider — with re-rendered subject/html
    expect(smsProvider.sent.length).toBe(smsSentBefore);
    expect(emailProvider.sent.length).toBe(1);
    const retried = emailProvider.sent[0]!;
    expect(retried.channel).toBe('EMAIL');
    // Worker re-render also reads the registry (dataSource passed through the seam).
    expect(retried.subject).toBe('MonieNaija account update');
    expect(retried.html).toContain('<!DOCTYPE html>');
    expect(retried.message).toContain('REF-RETRY');

    const sentRow: Array<{ status: string; attempts: number; provider_ref: string | null; last_error: string | null }> =
      await dataSource.query(`SELECT status, attempts, provider_ref, last_error FROM notification_deliveries WHERE id=$1`, [emailDelivery.id]);
    expect(sentRow[0]!.status).toBe('SENT');
    expect(sentRow[0]!.attempts).toBe(2);
    expect(sentRow[0]!.provider_ref).toMatch(/^test-email-/);
    expect(sentRow[0]!.last_error).toBeNull();
  });

  it('9. worker retry — bounded attempts; exhausted EMAIL row stays FAILED and auditable', async () => {
    const cid = await createCustomer({ phone: '8011000009', email: `c9-${randomUUID().slice(0, 8)}@example.com` });
    const key = `customer.funding.approved:${randomUUID()}`;
    emailProvider.shouldFail = true;
    emailProvider.failMessage = 'Simulated email provider failure'; // clear() does not reset custom messages
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: cid, reference: 'REF-EXH' } });
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM notification_deliveries WHERE event_key=$1 AND channel='EMAIL'`, [key]);
    const emailId = rows[0]!.id;
    // attempts=1 after dispatch failure; two more retries exhaust SMS_RETRY_MAX_ATTEMPTS=3
    await makeRetryEligible(emailId);
    await worker.tick();
    await makeRetryEligible(emailId);
    const tick = await worker.tick();
    expect(tick.retriesFailed).toBeGreaterThanOrEqual(1);
    const exhausted: Array<{ status: string; attempts: number; last_error: string }> = await dataSource.query(
      `SELECT status, attempts, last_error FROM notification_deliveries WHERE id=$1`,
      [emailId],
    );
    expect(exhausted[0]!.status).toBe('FAILED');
    expect(exhausted[0]!.attempts).toBe(3);
    expect(exhausted[0]!.last_error).toBe('Simulated email provider failure');
    // No longer retry-eligible
    await makeRetryEligible(emailId);
    emailProvider.clear();
    const tick2 = await worker.tick();
    expect(tick2.retriesClaimed).toBe(0);
    expect(emailProvider.sent.length).toBe(0);
    emailProvider.shouldFail = false;
  });

  it('10. worker retry re-checks EMAIL opt-out — FAILED row becomes SKIPPED EMAIL_OPT_OUT', async () => {
    const cid = await createCustomer({ phone: '8011000010', email: `c10-${randomUUID().slice(0, 8)}@example.com` });
    const key = `customer.funding.approved:${randomUUID()}`;
    emailProvider.shouldFail = true;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: cid, reference: 'REF-OPTRETRY' } });
    emailProvider.shouldFail = false;
    emailProvider.clear();
    // Customer opts out of email AFTER the initial failure
    await dataSource.query(`UPDATE customer_preferences SET notification_email_enabled=false WHERE customer_id=$1`, [cid]);
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM notification_deliveries WHERE event_key=$1 AND channel='EMAIL'`, [key]);
    await makeRetryEligible(rows[0]!.id);
    const tick = await worker.tick();
    expect(tick.retriesOptedOut).toBe(1);
    expect(emailProvider.sent.length).toBe(0); // never sent after opt-out
    const skipped: Array<{ status: string; last_error: string }> = await dataSource.query(`SELECT status, last_error FROM notification_deliveries WHERE id=$1`, [rows[0]!.id]);
    expect(skipped[0]!.status).toBe('SKIPPED');
    expect(skipped[0]!.last_error).toBe('EMAIL_OPT_OUT');
  });

  it('11. worker retry — SMS path preserved: FAILED SMS row retries via the SMS provider only', async () => {
    const cid = await createCustomer({ phone: '8011000011', email: `c11-${randomUUID().slice(0, 8)}@example.com` });
    const key = `customer.funding.approved:${randomUUID()}`;
    smsProvider.shouldFail = true;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: cid, reference: 'REF-SMSRETRY' } });
    smsProvider.shouldFail = false;
    smsProvider.clear();
    emailProvider.clear();
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM notification_deliveries WHERE event_key=$1 AND channel='SMS'`, [key]);
    await makeRetryEligible(rows[0]!.id);
    const tick = await worker.tick();
    expect(tick.retriesSent).toBe(1);
    expect(smsProvider.sent.length).toBe(1);
    expect(smsProvider.sent[0]!.channel).toBe('SMS');
    expect(emailProvider.sent.length).toBe(0); // EMAIL row was SENT at dispatch — not retried
    const sentRow: Array<{ status: string; provider_ref: string }> = await dataSource.query(`SELECT status, provider_ref FROM notification_deliveries WHERE id=$1`, [rows[0]!.id]);
    expect(sentRow[0]!.status).toBe('SENT');
    expect(sentRow[0]!.provider_ref).not.toMatch(/^test-email-/);
  });

  it('12. inbox projection includes EMAIL SENT rows (no channel filter; SKIPPED excluded)', async () => {
    const cid = await createCustomer({ phone: '8011000012', email: `c12-${randomUUID().slice(0, 8)}@example.com` });
    const key = `transfer.completed:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey: key, payload: { sourceCustomerId: cid, transferId: 'inbox123-456', amountMinor: '900' } });
    const inbox = await inboxService.listForCustomer(cid, 1, 20);
    // SMS + EMAIL rows both project (documented behaviour; product grouping is a follow-up)
    expect(inbox.items.length).toBe(2);
    expect(inbox.items.every((i) => i.status === 'AVAILABLE')).toBe(true);
    expect(inbox.items.every((i) => i.channel === 'IN_APP')).toBe(true);
    // SKIPPED rows never surface
    const cid2 = await createCustomer({ phone: '8011000013' }); // no email → SKIPPED EMAIL row
    const key2 = `transfer.completed:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey: key2, payload: { sourceCustomerId: cid2, transferId: 'inbox124-456' } });
    const inbox2 = await inboxService.listForCustomer(cid2, 1, 20);
    expect(inbox2.items.length).toBe(1); // SMS only; EMAIL SKIPPED excluded
  });

  it('13. provider-status — 401 unauthenticated / customer, 403 without function scope', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/notifications/provider-status').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('customer')}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('agent')}`)
      .expect(401);
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('noscopes')}`)
      .expect(403);
    expect(res.body.message).toBe('FUNCTION_MISSING');
  });

  it('14. provider-status — 200 read-only non-secret snapshot, zero key material', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('viewer')}`)
      .expect(200);
    const body = res.body;
    expect(body.channels).toEqual(['SMS', 'PUSH', 'EMAIL']);
    expect(['console', 'robase']).toContain(body.sms.provider);
    expect(['none', 'console', 'resend']).toContain(body.email.provider);
    // Test env has no provider keys configured → dark defaults, no fingerprints
    expect(body.email.provider).toBe('none');
    expect(body.email.configured).toBe(false);
    expect(body.email.keyFingerprint).toBeNull();
    expect(body.sms.keyFingerprint).toBeNull();
    expect(typeof body.worker.enabled).toBe('boolean');
    // Credential hygiene: no key material or secret-ish fields anywhere in the response
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('re_');
    expect(raw).not.toContain('robe_');
    expect(raw.toLowerCase()).not.toContain('apikey');
    expect(raw.toLowerCase()).not.toContain('authorization');
    // Delivery-only principal receives strict coarse MINIMAL availability only (F-04)
    const minimalRes = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('deliveryonly')}`)
      .expect(200);
    expect(minimalRes.body).toEqual({
      channels: ['SMS', 'PUSH', 'EMAIL'],
      projectionScope: 'MINIMAL',
      sms: { available: expect.any(Boolean) },
      push: { available: false },
      email: { available: false },
    });
    expect(minimalRes.body.sms.provider).toBeUndefined();
    expect(minimalRes.body.email.provider).toBeUndefined();
    expect(minimalRes.body.worker).toBeUndefined();

    // Read-only: GET does not mutate anything
    const before: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries`);
    await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('viewer')}`)
      .expect(200);
    const after: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries`);
    expect(after[0]!.count).toBe(before[0]!.count);
  });

  it('15. test-send — 401/403 gates identical to provider-status', async () => {
    await request(app.getHttpServer()).post('/api/v1/internal/notifications/test-send').send({ channel: 'EMAIL', destination: 'ops@example.com' }).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('customer')}`)
      .send({ channel: 'EMAIL', destination: 'ops@example.com' })
      .expect(401);
    // viewer lacks notification.test_send → fail-closed 403 even though it may view status
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('viewer')}`)
      .send({ channel: 'EMAIL', destination: 'ops@example.com' })
      .expect(403);
    expect(res.body.message).toBe('FUNCTION_MISSING');
    expect(emailProvider.sent.length).toBe(0);
  });

  it('16. test-send — strict destination validation returns 400 without provider calls', async () => {
    const badBodies = [
      { channel: 'WHATSAPP', destination: 'ops@example.com' },
      { channel: 'EMAIL', destination: 'not-an-email' },
      { channel: 'EMAIL', destination: 'two@example.com,three@example.com' },
      { channel: 'EMAIL', destination: `${'x'.repeat(250)}@example.com` },
      { channel: 'SMS', destination: '12345' },
      { channel: 'SMS', destination: '+0123456789' },
      { channel: 'EMAIL' },
      {},
    ];
    for (const bad of badBodies) {
      await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/test-send')
        .set('Authorization', `Bearer ${token('ops')}`)
        .send(bad)
        .expect(400);
    }
    expect(emailProvider.sent.length).toBe(0);
    expect(smsProvider.sent.length).toBe(0);
    // Validation failures consume no rate-limit quota (no audit rows written)
    const audit: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM audit_events WHERE entity_type='NOTIFICATION_TEST_SEND'`);
    expect(Number(audit[0]!.count)).toBe(0);
  });

  it('17. test-send EMAIL — SENT response, fixed safe content, masked-destination audit row', async () => {
    const destination = `ops.test-${randomUUID().slice(0, 8)}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('ops')}`)
      .send({ channel: 'EMAIL', destination })
      .expect(201);
    expect(res.body.status).toBe('SENT');
    expect(res.body.channel).toBe('EMAIL');
    expect(res.body.providerRef).toMatch(/^test-email-/);
    expect(res.body.errorCode).toBeNull();
    expect(typeof res.body.correlationId).toBe('string');
    // Response destination is masked
    expect(res.body.destination).toContain('***');
    expect(res.body.destination).not.toBe(destination);

    // Provider received fixed safe content — no financial data, no event templates
    expect(emailProvider.sent.length).toBe(1);
    const sent = emailProvider.sent[0]!;
    expect(sent.subject).toBe('MonieNaija notification test');
    expect(sent.message).toContain('controlled connectivity test');
    expect(sent.message.toLowerCase()).not.toContain('ngn');
    expect(sent.message.toLowerCase()).not.toContain('transfer');
    expect(sent.html).toContain('<!DOCTYPE html>');

    // Audit row: masked destination, stable fields, no raw destination
    const audit: Array<{ action: string; actor: string; new_values: Record<string, unknown> }> = await dataSource.query(
      `SELECT action, actor, new_values FROM audit_events WHERE entity_type='NOTIFICATION_TEST_SEND'`,
    );
    expect(audit.length).toBe(1);
    expect(audit[0]!.action).toBe('NOTIFICATION_TEST_SENT');
    expect(audit[0]!.actor).toBe('workforce-ops-1');
    expect(audit[0]!.new_values.channel).toBe('EMAIL');
    expect(String(audit[0]!.new_values.destination)).toContain('***');
    expect(JSON.stringify(audit[0]!.new_values)).not.toContain(destination);
    expect(audit[0]!.new_values.providerRef).toMatch(/^test-email-/);

    // NO notification_deliveries row is written for test sends
    const deliveries: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries`);
    expect(Number(deliveries[0]!.count)).toBe(0);
  });

  it('18. test-send SMS — routes to the SMS provider; EMAIL never crosses providers', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('ops')}`)
      .send({ channel: 'SMS', destination: '+2348012345678' })
      .expect(201);
    expect(res.body.status).toBe('SENT');
    expect(res.body.channel).toBe('SMS');
    expect(smsProvider.sent.length).toBe(1);
    expect(smsProvider.sent[0]!.channel).toBe('SMS');
    expect(emailProvider.sent.length).toBe(0);
    expect(res.body.destination).toContain('*');
    expect(res.body.destination).toContain('678'); // last-3 visible, rest masked
  });

  it('19. test-send — provider failure returns FAILED with bounded error code and audit trail', async () => {
    emailProvider.shouldFail = true;
    emailProvider.failMessage = 'RESEND_HTTP_429:rate_limited';
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('ops')}`)
      .send({ channel: 'EMAIL', destination: 'fail@example.com' })
      .expect(201);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorCode).toBe('RESEND_HTTP_429:rate_limited');
    expect(res.body.providerRef).toBeNull();
    const audit: Array<{ action: string; new_values: Record<string, unknown> }> = await dataSource.query(
      `SELECT action, new_values FROM audit_events WHERE entity_type='NOTIFICATION_TEST_SEND'`,
    );
    expect(audit.length).toBe(1);
    expect(audit[0]!.action).toBe('NOTIFICATION_TEST_FAILED');
    expect(audit[0]!.new_values.errorCode).toBe('RESEND_HTTP_429:rate_limited');
    emailProvider.shouldFail = false;
  });

  it('20. test-send — rate limited to 5 per hour per principal (durable audit-based counter)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/internal/notifications/test-send')
        .set('Authorization', `Bearer ${token('ops')}`)
        .send({ channel: 'EMAIL', destination: `rate${i}@example.com` })
        .expect(201);
    }
    const sixth = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('ops')}`)
      .send({ channel: 'EMAIL', destination: 'rate6@example.com' })
      .expect(429);
    expect(sixth.body.message).toBe('NOTIFICATION_TEST_RATE_LIMITED');
    expect(emailProvider.sent.length).toBe(5); // the 6th never reached the provider
    // A different principal has an independent budget
    await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('viewer')}`)
      .send({ channel: 'EMAIL', destination: 'other@example.com' })
      .expect(403); // viewer still lacks the function — scope gate precedes rate limit
  });

  it('21. credential + PII hygiene — no key material in any response, log-facing error, or audit record', async () => {
    const destination = `hygiene-${randomUUID().slice(0, 8)}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/notifications/test-send')
      .set('Authorization', `Bearer ${token('ops')}`)
      .send({ channel: 'EMAIL', destination })
      .expect(201);
    const statusRes = await request(app.getHttpServer())
      .get('/api/v1/internal/notifications/provider-status')
      .set('Authorization', `Bearer ${token('viewer')}`)
      .expect(200);
    const auditRows: Array<{ new_values: Record<string, unknown> }> = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='NOTIFICATION_TEST_SEND'`,
    );
    for (const blob of [JSON.stringify(res.body), JSON.stringify(statusRes.body), JSON.stringify(auditRows)]) {
      expect(blob).not.toContain('re_');
      expect(blob).not.toContain('robe_');
      expect(blob.toLowerCase()).not.toContain('bearer');
      expect(blob.toLowerCase()).not.toContain('apikey');
      expect(blob.toLowerCase()).not.toContain('api_key');
    }
  });

  // ---- Phase 3 integration: registry governance over the EMAIL channel ----

  it('22. EVENT_DISABLED gating — disabling the EMAIL configuration skips email while SMS delivers', async () => {
    const cid = await createCustomer({ phone: '8011000022', email: `c22-${randomUUID().slice(0, 8)}@example.com` });
    // Arena 1 registry: disable ONLY the EMAIL configuration row for this event (guard
    // triggers permit is_enabled flips; identity changes are refused).
    await dataSource.query(
      `UPDATE notification_event_configurations SET is_enabled=false, version=version+1, updated_at=now()
        WHERE event_type='transfer.completed' AND channel='EMAIL'`,
    );
    const key = `transfer.completed:${randomUUID()}`;
    const result = await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: key,
      payload: { sourceCustomerId: cid, transferId: 'abcdef12-3456-7890', amountMinor: '25000', reference: 'REF-DIS22' },
    });
    const smsRow = result.deliveries.find((d) => d.channel === 'SMS')!;
    const emailRow = result.deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(smsRow.status).toBe('SENT');
    expect(emailRow.status).toBe('SKIPPED');
    // Provider never invoked for email; SMS unaffected (channel-level enablement is independent)
    expect(emailProvider.sent.length).toBe(0);
    expect(smsProvider.sent.length).toBe(1);
    const rows: Array<{ channel: string; status: string; message: string; last_error: string | null }> =
      await dataSource.query(
        `SELECT channel, status, message, last_error FROM notification_deliveries WHERE event_key=$1 ORDER BY channel`,
        [key],
      );
    const emailDb = rows.find((r) => r.channel === 'EMAIL')!;
    expect(emailDb.status).toBe('SKIPPED');
    expect(emailDb.last_error).toBe('EVENT_DISABLED');
    expect(emailDb.message).toBe('Notification disabled.');
  });

  it('23. registry ACTIVE EMAIL version controls rendering — approved v2 subject/body replace seeded v1', async () => {
    const cid = await createCustomer({ phone: '8011000023', email: `c23-${randomUUID().slice(0, 8)}@example.com` });
    // Simulate an approved maker-checker change request outcome: deactivate the seeded v1
    // EMAIL template (guard trigger permits is_active true->false only) and activate a v2
    // with a distinct approved subject/body. SMS templates are untouched.
    await dataSource.query(
      `UPDATE notification_templates SET is_active=false
        WHERE event_type='transfer.completed' AND channel='EMAIL' AND version=1 AND is_active=true`,
    );
    await dataSource.query(
      `INSERT INTO notification_templates (event_type, channel, locale, version, is_active, subject, body, created_by)
       VALUES ('transfer.completed','EMAIL','en-NG',2,true,'Your transfer arrived','Approved body: transfer{{amount_clause}} landed, ref {{reference}}.','test')`,
    );
    const key = `transfer.completed:${randomUUID()}`;
    const result = await dispatcher.dispatch({
      eventType: 'transfer.completed',
      eventKey: key,
      payload: { sourceCustomerId: cid, transferId: 'abcdef12-3456-7890', amountMinor: '25000', reference: 'REF-V2' },
    });
    expect(result.deliveries.find((d) => d.channel === 'EMAIL')!.status).toBe('SENT');
    const sent = emailProvider.sent[0]!;
    // The approved registry version — not the code defaults — controls subject and body
    expect(sent.subject).toBe('Your transfer arrived');
    // reference resolver precedence for transfer.completed: short transferId prefix wins
    expect(sent.message).toBe('Approved body: transfer of NGN 250.00 landed, ref abcdef12.');
    expect(sent.html).toContain('Your transfer arrived');
    expect(sent.html).toContain('abcdef12');
    // SMS renders its OWN active registry version — channels/versioning are independent
    expect(smsProvider.sent[0]!.message).toBe('Transfer of NGN 250.00 completed. Ref abcdef12.');
    // Database-level guarantee behind the fail-closed seam: at most ONE ACTIVE template
    // version per (event, channel, locale) — the partial unique index rejects a second
    // ACTIVE row outright, so renderActive can never have to guess between versions.
    await expect(
      dataSource.query(
        `INSERT INTO notification_templates (event_type, channel, locale, version, is_active, subject, body, created_by)
         VALUES ('transfer.completed','EMAIL','en-NG',3,true,'Your transfer arrived','duplicate active','test')`,
      ),
    ).rejects.toThrow();
    expect(emailProvider.sent.length).toBe(1); // no additional email left the seam
  });
});
