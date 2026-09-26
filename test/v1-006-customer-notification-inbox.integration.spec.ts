/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { WalletService } from '../src/wallet/wallet.service';
import { SupportService } from '../src/support/support.service';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { TransferLifecycleService } from '../src/transfer/transfer-lifecycle.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a6-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-006 Customer Notification Inbox (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let fundingService: CustomerFundingService;
  let transferLifecycleService: TransferLifecycleService;
  let dispatcher: NotificationDispatcherService;
  let testProvider: TestNotificationProvider;

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
    dataSource = await createIntegrationDataSource('v1-006-inbox');
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
    transferLifecycleService = moduleRef.get(TransferLifecycleService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try { await destroyIntegrationDataSource(dataSource); } catch { try { if (dataSource.isInitialized) await dataSource.destroy().catch(()=>undefined);} catch { void 0; } }
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

  function workforceToken(type: string): string { return `workforce-${type}`; }

  async function createCustomerWithPhone(phone10: string, customerIdOverride?: string): Promise<string> {
    const customerId = customerIdOverride ?? randomUUID();
    await dataSource.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [customerId, `cust-${randomUUID()}`]);
    await dataSource.query(`INSERT INTO customer_profiles (id, customer_id, display_name, is_active) VALUES ($1,$2,$3,true)`, [randomUUID(), customerId, `Cust ${customerId.slice(0,4)}`]);
    await dataSource.query(`INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,true)`, [randomUUID(), customerId, phone10]);
    try { await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}` }); } catch {}
    await dataSource.query(
      `INSERT INTO customer_preferences (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled, notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1,$2,'EN','SYSTEM',true,true,true,true,true,true,true,false,1) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId],
    );
    return customerId;
  }

  async function createCustomerWithCredentials(phone10: string): Promise<{ customerId: string; token: string }> {
    const customerId = await createCustomerWithPhone(phone10);
    const pwd = `Pw-${randomUUID().slice(0,8)}aA1!`;
    const hash = encodePbkdf2(pwd, `salt-${customerId.slice(0,4)}`);
    await dataSource.query(`INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`, [customerId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password: pwd }).expect(200);
    const token = login.body.accessToken as string;
    return { customerId, token };
  }

  async function dispatchFundingApproved(customerId: string, phone: string, fundingId: string, amountMinor: string): Promise<void> {
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    // Create funding if not already? Use direct insert? Use HTTP flow for realism
    // For inbox tests we can directly dispatch event without HTTP if funding already created
    // But better reuse funding service: create + approve already done
  }

  // 1. Empty inbox returns 200 with pagination
  it('1. empty inbox returns 200 with empty items and pagination', async () => {
    const { token } = await createCustomerWithCredentials('8030000001');
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(0);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.pagination.hasNextPage).toBe(false);
  });

  // 2. funding approved appears in inbox with safe projection
  it('2. funding approved appears in inbox — safe, title, message, no providerRef', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000002');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '60000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    // Dispatch
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    expect(outbox.length).toBe(1);
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    expect(result.dispatched).toBe(1);
    // Inbox
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(1);
    const item = inbox.body.items[0];
    expect(item.type).toBe('customer.funding.approved');
    expect(item.category).toBe('FUNDING');
    expect(item.title).toBe('Funding Approved');
    expect(item.message).toContain('NGN');
    expect(item.message).not.toMatch(/pin|otp|password/i);
    expect(item.reference).toBeDefined();
    expect(item.channel).toBe('IN_APP');
    expect(item.status).toBe('AVAILABLE');
    expect(item.createdAt).toBeDefined();
    // Safe projection — no providerRef / ledger / pin etc.
    const bodyStr = JSON.stringify(inbox.body).toLowerCase();
    expect(bodyStr).not.toContain('providerref');
    expect(bodyStr).not.toContain('provider_ref');
    expect(bodyStr).not.toContain('ledger');
    expect(bodyStr).not.toContain('journal');
    expect(bodyStr).not.toContain('hash');
    expect(bodyStr).not.toContain('correlation');
    expect(bodyStr).not.toContain('causation');
    expect(item.id).toBeDefined();
    // No sensitive fields at top level
    expect(item).not.toHaveProperty('providerRef');
    expect(item).not.toHaveProperty('destination');
    expect(item).not.toHaveProperty('payload');
    expect(item).not.toHaveProperty('pin');
    expect(item).not.toHaveProperty('otp');
  });

  // 3. funding rejected appears
  it('3. funding rejected appears in inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000003');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('PRIVILEGED');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '30000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/reject`).set('Authorization', `Bearer ${checkerToken}`).send({ reason: 'Docs missing' }).expect(201);
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.rejected' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.rejected', eventKey: `customer.funding.rejected:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(1);
    expect(inbox.body.items[0].type).toBe('customer.funding.rejected');
    expect(inbox.body.items[0].title).toBe('Funding Rejected');
  });

  // 4. transfer.completed notifies both
  it('4. transfer.completed notifies source and destination via inbox', async () => {
    const src = await createCustomerWithCredentials('8030000004');
    const dst = await createCustomerWithCredentials('8030000005');
    const srcWalletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [src.customerId]);
    const dstWalletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [dst.customerId]);
    const transferId = randomUUID();
    const payload = {
      transferId,
      commandId: `cmd-${randomUUID()}`,
      sourceCustomerId: src.customerId,
      destinationCustomerId: dst.customerId,
      sourceWalletAccountId: randomUUID(),
      destinationWalletAccountId: randomUUID(),
      sourceLedgerAccountId: srcWalletRows[0]!.ledger_account_id,
      destinationLedgerAccountId: dstWalletRows[0]!.ledger_account_id,
      amountMinor: '10000',
      currency: 'NGN',
      reference: `TRF-${randomUUID().slice(0,8)}`,
    };
    const eventKey = `transfer.completed:${transferId}`;
    await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey, aggregateType: 'TRANSFER', aggregateId: transferId, payload, correlationId: randomUUID() });
    const srcInbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${src.token}`).expect(200);
    const dstInbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${dst.token}`).expect(200);
    expect(srcInbox.body.items.some((i: any) => i.type === 'transfer.completed')).toBe(true);
    expect(dstInbox.body.items.some((i: any) => i.type === 'transfer.completed')).toBe(true);
    expect(srcInbox.body.items[0].title).toBe('Transfer Completed');
    expect(srcInbox.body.items[0].message).toContain('NGN');
  });

  // 5. support ticket created visible
  it('5. support ticket created notifies customer via inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000006');
    // Create ticket via customer API? Use direct support service? We'll use HTTP customer ticket creation
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'Issue', category: 'OTHER', description: 'Help needed valid', priority: 'MEDIUM' }).expect(201);
    const ticketId = ticketRes.body.id as string;
    // Outbox event for support.ticket.created
    const outbox: Array<{ payload: any; correlation_id: string; event_key: string }> = await dataSource.query(`SELECT payload, correlation_id, event_key FROM outbox_events WHERE event_type='support.ticket.created' ORDER BY created_at DESC LIMIT 1`);
    expect(outbox.length).toBe(1);
    await dispatcher.dispatch({ eventType: 'support.ticket.created', eventKey: outbox[0]!.event_key as string, aggregateType: 'SUPPORT_TICKET', aggregateId: ticketId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.some((i: any) => i.type === 'support.ticket.created')).toBe(true);
  });

  // 6. support resolved visible
  it('6. support ticket resolved appears in inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000007');
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'Issue2', category: 'OTHER', description: 'Help needed valid2', priority: 'MEDIUM' }).expect(201);
    const ticketId = ticketRes.body.id as string;
    // Simulate status_changed to RESOLVED via direct payload
    const payload = { ticketId, customerId, status: 'RESOLVED', previousStatus: 'OPEN' };
    await dispatcher.dispatch({ eventType: 'support.ticket.resolved', eventKey: `support.ticket.resolved:${ticketId}:${Date.now()}`, aggregateType: 'SUPPORT_TICKET', aggregateId: ticketId, payload, correlationId: randomUUID() });
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.some((i: any) => i.type === 'support.ticket.resolved')).toBe(true);
    expect(inbox.body.items[0].category).toBe('SUPPORT');
  });

  // 7. cross-customer isolation
  it('7. cross-customer isolation — A cannot see B notifications', async () => {
    const a = await createCustomerWithCredentials('8030000010');
    const b = await createCustomerWithCredentials('8030000011');
    // Create funding for A only
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${a.customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '70000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const aInbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${a.token}`).expect(200);
    const bInbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${b.token}`).expect(200);
    expect(aInbox.body.items.length).toBe(1);
    expect(bInbox.body.items.length).toBe(0);
    expect(bInbox.body.pagination.total).toBe(0);
  });

  // 8. forged ?customerId= ignored
  it('8. forged customerId query param ignored — still own only', async () => {
    const a = await createCustomerWithCredentials('8030000012');
    const b = await createCustomerWithCredentials('8030000013');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${a.customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '80000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    // b tries to fetch with forged query param pointing to a
    const bInboxForged = await request(app.getHttpServer()).get(`/api/v1/customers/me/notifications?customerId=${a.customerId}`).set('Authorization', `Bearer ${b.token}`).expect(200);
    expect(bInboxForged.body.items.length).toBe(0);
    const aInbox = await request(app.getHttpServer()).get(`/api/v1/customers/me/notifications?customerId=${b.customerId}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(aInbox.body.items.length).toBe(1);
  });

  // 9. agent forbidden
  it('9. agent cannot access customer inbox — 403 (or 401)', async () => {
    const agentToken = workforceToken('AGENT');
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${agentToken}`);
    expect([401,403].includes(res.status)).toBe(true);
  });

  // 10. unauthenticated 401
  it('10. unauthenticated request returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').expect(401);
    expect(res.body.message).toBeDefined();
  });

  // 11. internal support message never exposed
  it('11. internal support.ticket.message_added never appears in inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000014');
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'Internal test', category: 'OTHER', description: 'Help valid internal', priority: 'MEDIUM' }).expect(201);
    const ticketId = ticketRes.body.id as string;
    const internalPayload = { ticketId, customerId, message: 'internal note', isInternal: true };
    const result = await dispatcher.dispatch({ eventType: 'support.ticket.message_added', eventKey: `support.ticket.message_added:${ticketId}:internal:${Date.now()}`, aggregateType: 'SUPPORT_TICKET', aggregateId: ticketId, payload: internalPayload, correlationId: randomUUID() });
    expect(result.generated).toBe(0);
    expect(result.dispatched).toBe(0);
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(0);
    const deliveries: Array<{ event_type: string }> = await dataSource.query(`SELECT event_type FROM notification_deliveries WHERE event_type='support.ticket.message_added' AND recipient_id=$1`, [customerId]);
    expect(deliveries.length).toBe(0);
  });

  // 12. non-internal message appears
  it('12. non-internal support.ticket.message_added appears', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000015');
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'External', category: 'OTHER', description: 'Help external valid', priority: 'MEDIUM' }).expect(201);
    const ticketId = ticketRes.body.id as string;
    const payload = { ticketId, customerId, message: 'public update', isInternal: false };
    const result = await dispatcher.dispatch({ eventType: 'support.ticket.message_added', eventKey: `support.ticket.message_added:${ticketId}:public:${Date.now()}`, aggregateType: 'SUPPORT_TICKET', aggregateId: ticketId, payload, correlationId: randomUUID() });
    expect(result.dispatched).toBe(1);
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.some((i: any) => i.type === 'support.ticket.message_added')).toBe(true);
  });

  // 13. FAILED still available in inbox (provider failure isolated)
  it('13. FAILED SMS still appears as AVAILABLE in inbox, no technical error leaked', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000016');
    testProvider.shouldFail = true;
    testProvider.failMessage = 'Simulated SMS failure';
    const transferId = randomUUID();
    const srcWallet: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [customerId]);
    const payload = {
      transferId,
      commandId: `cmd-${randomUUID()}`,
      sourceCustomerId: customerId,
      destinationCustomerId: customerId,
      sourceWalletAccountId: randomUUID(),
      destinationWalletAccountId: randomUUID(),
      sourceLedgerAccountId: srcWallet[0]!.ledger_account_id,
      destinationLedgerAccountId: srcWallet[0]!.ledger_account_id,
      amountMinor: '5000',
      currency: 'NGN',
      reference: `TRF-${randomUUID().slice(0,8)}`,
    };
    const eventKey = `transfer.completed:${transferId}`;
    const result = await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey, aggregateType: 'TRANSFER', aggregateId: transferId, payload, correlationId: randomUUID() });
    expect(result.deliveries.some(d => d.status === 'FAILED')).toBe(true);
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBeGreaterThanOrEqual(1);
    const item = inbox.body.items.find((i: any) => i.type === 'transfer.completed');
    expect(item).toBeDefined();
    expect(item.status).toBe('AVAILABLE');
    const bodyStr = JSON.stringify(inbox.body);
    expect(bodyStr).not.toContain('FAILED');
    expect(bodyStr).not.toContain('Simulated');
    // Direct DB shows FAILED
    const db: Array<{ status: string }> = await dataSource.query(`SELECT status FROM notification_deliveries WHERE event_key=$1`, [eventKey]);
    expect(db[0]!.status).toBe('FAILED');
  });

  // 14. SKIPPED not in inbox
  it('14. SKIPPED delivery not shown in inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000017');
    // Manually insert SKIPPED row for this customer
    await dataSource.query(
      `INSERT INTO notification_deliveries (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, provider_ref, correlation_id, causation_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,'PUSH','SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING',$7,$8,'SKIPPED',0,null,null,null,now(),now())`,
      [randomUUID(), 'support.ticket.assigned', `skipped-test:${randomUUID()}`, 'SUPPORT_TICKET', randomUUID(), customerId, JSON.stringify({ customerId, _templateKey: 'support.ticket.assigned' }), 'Ticket assigned',],
    );
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(0);
    const bodyStr = JSON.stringify(inbox.body);
    expect(bodyStr).not.toContain('SKIPPED');
    expect(bodyStr).not.toContain('PUSH_TOKEN');
  });

  // 15. pagination and ordering
  it('15. pagination and deterministic ordering createdAt DESC id DESC', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000018');
    const srcWallet: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [customerId]);
    // Create 5 notifications with distinct created_at via sequential dispatch with delays
    for (let i = 0; i < 5; i++) {
      const transferId = randomUUID();
      const payload = {
        transferId,
        commandId: `cmd-${randomUUID()}`,
        sourceCustomerId: customerId,
        destinationCustomerId: customerId,
        sourceWalletAccountId: randomUUID(),
        destinationWalletAccountId: randomUUID(),
        sourceLedgerAccountId: srcWallet[0]!.ledger_account_id,
        destinationLedgerAccountId: srcWallet[0]!.ledger_account_id,
        amountMinor: `${1000 + i * 100}`,
        currency: 'NGN',
        reference: `TRF-${i}-${randomUUID().slice(0,4)}`,
      };
      await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey: `transfer.completed:${transferId}`, aggregateType: 'TRANSFER', aggregateId: transferId, payload, correlationId: randomUUID() });
      // slight delay to ensure distinct created_at
      await new Promise(r => setTimeout(r, 10));
    }
    const p1 = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=1&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.pagination.total).toBe(5);
    expect(p1.body.pagination.totalPages).toBe(3);
    expect(p1.body.pagination.hasNextPage).toBe(true);
    expect(p1.body.pagination.page).toBe(1);
    expect(p1.body.pagination.limit).toBe(2);
    const p2 = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=2&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p2.body.items.length).toBe(2);
    expect(p2.body.pagination.hasNextPage).toBe(true);
    const p3 = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=3&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p3.body.items.length).toBe(1);
    expect(p3.body.pagination.hasNextPage).toBe(false);
    // Ordering: p1 first item should be newest
    const all = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=1&limit=20').set('Authorization', `Bearer ${token}`).expect(200);
    const dates = all.body.items.map((i: any) => new Date(i.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) expect(dates[i-1]).toBeGreaterThanOrEqual(dates[i]);
    // Verify no duplicate across pages
    const idsP1 = p1.body.items.map((i: any) => i.id);
    const idsP2 = p2.body.items.map((i: any) => i.id);
    expect(idsP1.some((id: string) => idsP2.includes(id))).toBe(false);
  });

  // 16. invalid pagination 400
  it('16. invalid pagination returns 400', async () => {
    const { token } = await createCustomerWithCredentials('8030000019');
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=0').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?limit=0').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?limit=101').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=abc').set('Authorization', `Bearer ${token}`).expect(400);
  });

  // 17. safe projection hides sensitive fields
  it('17. safe projection hides providerRef, ledger, pin, otp, secrets, raw payload', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000020');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '90000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    const item = inbox.body.items[0];
    const flat = JSON.stringify(inbox.body).toLowerCase();
    expect(flat).not.toContain('providerref');
    expect(flat).not.toContain('provider_ref');
    expect(flat).not.toContain('ledger');
    expect(flat).not.toContain('journal');
    expect(flat).not.toContain('pin');
    expect(flat).not.toContain('otp');
    expect(flat).not.toContain('secret');
    expect(flat).not.toContain('password');
    expect(flat).not.toContain('tokenhash');
    expect(flat).not.toContain('correlation');
    expect(flat).not.toContain('causation');
    expect(item).not.toHaveProperty('providerRef');
    expect(item).not.toHaveProperty('ledgerAccountId');
    expect(item).not.toHaveProperty('journalEntry');
  });

  // 18. agent notification not visible to customer
  it('18. AGENT recipient_type not visible in customer inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000021');
    // Insert AGENT delivery with same recipient_id (customerId) but type AGENT — should not appear because filter is recipient_type=CUSTOMER
    await dataSource.query(
      `INSERT INTO notification_deliveries (id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, provider_ref, correlation_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'AGENT',$6,'SMS','8012345678',$7,$8,'SENT',1,'ref-123',null,now(),now())`,
      [randomUUID(), 'agent.lifecycle.terminated', `agent-test:${randomUUID()}`, 'AGENT', randomUUID(), customerId, JSON.stringify({ _templateKey: 'agent.terminated' }), 'Agent terminated'],
    );
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(0);
  });

  // 19. financial isolation — inbox read does not mutate wallets/ledgers
  it('19. inbox read does not mutate financial state', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000022');
    const beforeLedgers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const beforeLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    // Create a funding and inbox read
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '120000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const afterFundingLedgers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const afterFundingLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    // Read inbox multiple times
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/customers/me/notifications?page=1&limit=1').set('Authorization', `Bearer ${token}`).expect(200);
    const afterInboxLedgers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const afterInboxLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    expect(afterInboxLedgers[0]!.count).toBe(afterFundingLedgers[0]!.count);
    expect(afterInboxLines[0]!.count).toBe(afterFundingLines[0]!.count);
    expect(Number(afterInboxLedgers[0]!.count)).toBeGreaterThan(Number(beforeLedgers[0]!.count));
    expect(Number(afterInboxLines[0]!.count)).toBeGreaterThan(Number(beforeLines[0]!.count));
  });

  // 20. migration count is 66, reuse notification_deliveries
  it('20. migration count 66, no customer_notifications table, notification_deliveries exists', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(66);
    const latest: Array<{ name: string; timestamp: string }> = await dataSource.query(`SELECT name, timestamp::text as timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600065');
    const notifExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notification_deliveries') as exists`);
    expect(notifExists[0]!.exists).toBe(true);
    const inboxExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customer_notifications') as exists`);
    expect(inboxExists[0]!.exists).toBe(false);
  });

  // 21. V1-001 funding still credits ledger
  it('21. V1-001 funding flow still credits ledger after inbox', async () => {
    const { customerId, token } = await createCustomerWithCredentials('8030000023');
    // Get ledger account for balance check via ledger_lines
    const walletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [customerId]);
    const ledgerAccountId = walletRows[0]!.ledger_account_id;
    const beforeBalRows: Array<{ balance: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`, [ledgerAccountId]);
    expect(beforeBalRows[0]!.balance).toBe('0');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '150000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const afterBalRows: Array<{ balance: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`, [ledgerAccountId]);
    expect(afterBalRows[0]!.balance).toBe('150000');
    // Inbox should have notification
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    const inbox = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(inbox.body.items.length).toBe(1);
  });

  // 22. V1-003 admin lifecycle still works
  it('22. V1-003 admin lifecycle still works', async () => {
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status) VALUES ($1,'ACTIVE') RETURNING id`, [`ref-${randomUUID()}`]);
    const agentId = agentRows[0]!.id;
    const token = workforceToken('OPERATOR');
    const suspendRes = await request(app.getHttpServer()).post(`/api/v1/internal/admin/agents/${agentId}/suspend`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(suspendRes.body.status).toBe('SUSPENDED');
    const terminateRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/terminate`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(terminateRes.body.status).toBe('TERMINATED');
  });

  // 23. V1-007 support flow still works
  it('23. V1-007 support ticket flow still works after inbox', async () => {
    const { token } = await createCustomerWithCredentials('8030000024');
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'Support after inbox', category: 'OTHER', description: 'Support after inbox valid', priority: 'MEDIUM' }).expect(201);
    expect(ticketRes.body.id).toBeDefined();
    expect(ticketRes.body.status).toBeDefined();
  });
});
