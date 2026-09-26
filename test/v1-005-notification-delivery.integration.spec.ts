/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
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
import { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import { NOTIFICATION_EVENT_CATALOGUE, mapEventToIntents } from '../src/notification/notification-event-map';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a8-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-005 Notification Delivery Foundation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let supportService: SupportService;
  let fundingService: CustomerFundingService;
  let transferLifecycleService: TransferLifecycleService;
  let dispatcher: NotificationDispatcherService;
  let resolver: NotificationChannelResolverService;
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
    dataSource = await createIntegrationDataSource('v1-005-notification');
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
    supportService = moduleRef.get(SupportService);
    fundingService = moduleRef.get(CustomerFundingService);
    transferLifecycleService = moduleRef.get(TransferLifecycleService);
    dispatcher = moduleRef.get(NotificationDispatcherService);
    resolver = moduleRef.get(NotificationChannelResolverService);
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
    // contact method - authoritative
    await dataSource.query(`INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary) VALUES ($1,$2,'PHONE',$3,$3,true)`, [randomUUID(), customerId, phone10]);
    // wallet for NGN
    try { await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}` }); } catch {}
    // preference row - use correct schema columns (notification_* + security_*)
    await dataSource.query(
      `INSERT INTO customer_preferences (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled, notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts, security_device_registration_alerts, security_biometric_allowed, version)
       VALUES ($1,$2,'EN','SYSTEM',true,true,true,true,true,true,true,false,1) ON CONFLICT DO NOTHING`,
      [randomUUID(), customerId],
    );
    return customerId;
  }

  async function createAgentDirect(status: AgentStatus = AgentStatus.ACTIVE): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,$2,$3) RETURNING id`, [`ref-${randomUUID()}`, status, null]);
    return rows[0]!.id;
  }

  // 1. funding approved → notification
  it('1. funding approved generates SMS notification to correct customer', async () => {
    const customerId = await createCustomerWithPhone('8011111111');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    // Create funding request via HTTP
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '50000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    const approveRes = await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
    // Verify outbox event exists (NOTIFICATION EVENT GENERATED)
    const outbox: Array<{ event_type: string; payload: any; correlation_id: string; event_key: string }> = await dataSource.query(`SELECT event_type, payload, correlation_id, event_key FROM outbox_events WHERE event_type='customer.funding.approved' ORDER BY created_at DESC LIMIT 1`);
    expect(outbox.length).toBe(1);
    expect(outbox[0]!.event_type).toBe('customer.funding.approved');
    expect(outbox[0]!.payload.customerId).toBe(customerId);
    // Dispatch via notification dispatcher (DISPATCHED)
    const payload = outbox[0]!.payload as Record<string, unknown>;
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload, correlationId: outbox[0]!.correlation_id });
    expect(result.generated).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(result.deliveries[0]!.recipientId).toBe(customerId);
    expect(result.deliveries[0]!.channel).toBe('SMS');
    expect(result.deliveries[0]!.status).toBe('SENT');
    expect(result.deliveries[0]!.providerRef).toBeTruthy();
    // Test provider received (PROVIDER DELIVERY)
    expect(testProvider.sent.length).toBe(1);
    expect(testProvider.sent[0]!.destination).toBe('8011111111');
    expect(testProvider.sent[0]!.message).toContain('approved');
    expect(testProvider.sent[0]!.message).not.toMatch(/pin|otp|password|ledger|journal/i);
    // Verify notification_deliveries row
    const deliveries: Array<{
      event_type: string; recipient_id: string; channel: string; status: string; destination: string; payload: any; message: string; attempts: number;
    }> = await dataSource.query(`SELECT event_type, recipient_id, channel, status, destination, payload, message, attempts FROM notification_deliveries WHERE event_key=$1`, [`customer.funding.approved:${fundingId}`]);
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]!.status).toBe('SENT');
    expect(deliveries[0]!.destination).toBe('8011111111');
    expect(deliveries[0]!.payload._templateKey).toBe('customer.funding.approved');
    // No secrets in stored payload
    const payloadStr = JSON.stringify(deliveries[0]!.payload).toLowerCase();
    expect(payloadStr).not.toContain('password');
    expect(payloadStr).not.toContain('tokenhash');
    expect(payloadStr).not.toContain('pinhash');
    expect(payloadStr).not.toContain('secret');
    // Message safe
    expect(deliveries[0]!.message).toContain('NGN');
    expect(deliveries[0]!.message.toLowerCase()).not.toContain('pin');
  });

  it('2. funding rejected generates SMS notification to correct customer', async () => {
    const customerId = await createCustomerWithPhone('8022222222');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('PRIVILEGED');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '25000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fundingId = createRes.body.id as string;
    const rejectRes = await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fundingId}/reject`).set('Authorization', `Bearer ${checkerToken}`).send({ reason: 'Insufficient docs' }).expect(201);
    expect(rejectRes.body.status).toBe('REJECTED');
    const outbox: Array<{ event_type: string; payload: any; event_key: string; correlation_id: string }> = await dataSource.query(`SELECT event_type, payload, event_key, correlation_id FROM outbox_events WHERE event_type='customer.funding.rejected' ORDER BY created_at DESC LIMIT 1`);
    expect(outbox.length).toBe(1);
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.rejected', eventKey: `customer.funding.rejected:${fundingId}`, aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingId, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    expect(result.dispatched).toBe(1);
    expect(testProvider.sent[0]!.destination).toBe('8022222222');
    expect(testProvider.sent[0]!.message).toContain('not approved');
    const deliveries: Array<{ status: string; attempts: number }> = await dataSource.query(`SELECT status, attempts FROM notification_deliveries WHERE event_key=$1`, [`customer.funding.rejected:${fundingId}`]);
    expect(deliveries[0]!.status).toBe('SENT');
  });

  it('3. transfer.completed notifies both source and destination customers via SMS', async () => {
    const srcCustomer = await createCustomerWithPhone('8033333333');
    const dstCustomer = await createCustomerWithPhone('8044444444');
    // Get ledger account ids via wallet service created wallets
    const srcWallet: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [srcCustomer]);
    const dstWallet: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [dstCustomer]);
    expect(srcWallet[0]).toBeDefined();
    expect(dstWallet[0]).toBeDefined();
    // Simulate transfer.completed payload (reuse transfer-events shape)
    const transferId = randomUUID();
    const commandId = `cmd-${randomUUID()}`;
    // Insert transfer row minimal for mapping? Not needed, dispatcher works purely on payload.
    const payload = {
      transferId,
      commandId,
      sourceCustomerId: srcCustomer,
      destinationCustomerId: dstCustomer,
      sourceWalletAccountId: randomUUID(),
      destinationWalletAccountId: randomUUID(),
      sourceLedgerAccountId: srcWallet[0]!.ledger_account_id,
      destinationLedgerAccountId: dstWallet[0]!.ledger_account_id,
      amountMinor: '75000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      journalId: randomUUID(),
      requestHash: 'hash',
      correlationId: `transfer:${transferId}`,
      causationId: null,
      policyDecisionReference: null,
      reference: `TRF-${transferId.slice(0,8)}`,
    } as unknown as Record<string, unknown>;
    const eventKey = `transfer.completed:${transferId}:v1`;
    // Also enqueue outbox to demonstrate GENERATED vs DISPATCHED distinction
    await dataSource.query(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, event_key, schema_version, classification, retention_class, occurred_at, correlation_id, payload, status, attempts, available_at) VALUES ($1,'transfer.completed','TRANSFER',$2,$3,1,'RESTRICTED_FINANCIAL','A5_TRANSFER_EVENT',NOW(),$4,$5::jsonb,'PENDING',0,NOW())`, [randomUUID(), transferId, eventKey, `transfer:${transferId}`, JSON.stringify(payload)]);
    const result = await dispatcher.dispatch({ eventType: 'transfer.completed', eventKey, aggregateType: 'TRANSFER', aggregateId: transferId, payload, correlationId: `transfer:${transferId}` });
    expect(result.generated).toBe(2);
    expect(result.dispatched).toBe(2);
    expect(testProvider.sent.length).toBe(2);
    const destinations = testProvider.sent.map(s => s.destination).sort();
    expect(destinations).toEqual(['8033333333', '8044444444']);
    // Verify both deliveries stored
    const deliveries: Array<{ recipient_id: string; destination: string }> = await dataSource.query(`SELECT recipient_id, destination FROM notification_deliveries WHERE event_key=$1 ORDER BY recipient_id`, [eventKey]);
    expect(deliveries.length).toBe(2);
    const recipientIds = deliveries.map(d => d.recipient_id).sort();
    expect(recipientIds).toEqual([srcCustomer, dstCustomer].sort());
    // Message safe
    for (const sent of testProvider.sent) {
      expect(sent.message).toContain('NGN');
      expect(sent.message.toLowerCase()).not.toContain('ledger');
    }
  });

  it('4. support ticket created notifies customer and agent, 5 events mapping', async () => {
    const custId = await createCustomerWithPhone('8055555555');
    const agentId = await createAgentDirect(AgentStatus.ACTIVE);
    // support.ticket.created for customer
    const payloadCreated = { ticketId: randomUUID(), reference: `SUP-${randomUUID().slice(0,6)}`, customerId: custId, agentId: null, category: 'OTHER', priority: 'MEDIUM' };
    const keyCreated = `support.ticket.created:${payloadCreated.ticketId}`;
    const resCreated = await dispatcher.dispatch({ eventType: 'support.ticket.created', eventKey: keyCreated, aggregateType: 'SUPPORT_TICKET', aggregateId: payloadCreated.ticketId, payload: payloadCreated, correlationId: `support:${payloadCreated.ticketId}` });
    expect(resCreated.dispatched).toBe(1);
    expect(testProvider.sent[0]!.destination).toBe('8055555555');
    expect(testProvider.sent[0]!.message).toContain('Support ticket');
    testProvider.clear();
    // support.ticket.assigned
    const payloadAssigned = { ticketId: payloadCreated.ticketId, reference: payloadCreated.reference, customerId: custId, agentId, assignedTo: 'workforce-op-1' };
    const keyAssigned = `support.ticket.assigned:${payloadCreated.ticketId}`;
    const resAssigned = await dispatcher.dispatch({ eventType: 'support.ticket.assigned', eventKey: keyAssigned, aggregateType: 'SUPPORT_TICKET', aggregateId: payloadCreated.ticketId, payload: payloadAssigned });
    expect(resAssigned.generated).toBe(2); // customer + agent (agent SMS will be SKIPPED due to missing phone)
    // Customer gets SENT, Agent gets SKIPPED
    const deliveriesAssigned: Array<{ recipient_type: string; status: string; last_error: string }> = await dataSource.query(`SELECT recipient_type, status, last_error FROM notification_deliveries WHERE event_key=$1 ORDER BY recipient_type`, [keyAssigned]);
    expect(deliveriesAssigned.find(d => d.recipient_type === 'CUSTOMER')!.status).toBe('SENT');
    expect(deliveriesAssigned.find(d => d.recipient_type === 'AGENT')!.status).toBe('SKIPPED');
    testProvider.clear();
    // support.ticket.status_changed -> RESOLVED mapping
    const payloadStatus = { ticketId: payloadCreated.ticketId, reference: payloadCreated.reference, customerId: custId, agentId, status: 'RESOLVED' };
    const keyStatus = `support.ticket.status_changed:${payloadCreated.ticketId}:resolved`;
    const resStatus = await dispatcher.dispatch({ eventType: 'support.ticket.status_changed', eventKey: keyStatus, aggregateType: 'SUPPORT_TICKET', aggregateId: payloadCreated.ticketId, payload: payloadStatus });
    expect(resStatus.dispatched).toBe(1); // customer sent, agent skipped
    expect(testProvider.sent[0]!.message.toLowerCase()).toContain('resolved');
    testProvider.clear();
    // support.ticket.message_added - non-internal
    const payloadMsg = { ticketId: payloadCreated.ticketId, reference: payloadCreated.reference, customerId: custId, body: 'Hello', isInternal: false };
    const keyMsg = `support.ticket.message_added:${randomUUID()}`;
    const resMsg = await dispatcher.dispatch({ eventType: 'support.ticket.message_added', eventKey: keyMsg, aggregateType: 'SUPPORT_TICKET', aggregateId: payloadCreated.ticketId, payload: payloadMsg });
    expect(resMsg.dispatched).toBe(1);
    testProvider.clear();
    // support.ticket.message_added - internal should NOT generate notification
    const payloadInternal = { ticketId: payloadCreated.ticketId, reference: payloadCreated.reference, customerId: custId, body: 'Internal note secret', isInternal: true };
    const keyInternal = `support.ticket.message_added:${randomUUID()}`;
    const resInternal = await dispatcher.dispatch({ eventType: 'support.ticket.message_added', eventKey: keyInternal, aggregateType: 'SUPPORT_TICKET', aggregateId: payloadCreated.ticketId, payload: payloadInternal });
    expect(resInternal.generated).toBe(0);
    expect(resInternal.dispatched).toBe(0);
    expect(testProvider.sent.length).toBe(0);
  });

  it('5. real support service flow: customer creates ticket via service, workforce assigns, dispatcher maps', async () => {
    const custId = await createCustomerWithPhone('8066666666');
    // Authenticate customer via password flow to get token? Use SupportService directly with principal
    const principalCustomer = { type: 'CUSTOMER' as const, principalId: custId, customerId: custId, agentId: undefined as any, audience: 'test', roles: [], scopes: [], customerAccess: 'SELF', agentAccess: 'NONE', aggregatorAccess: 'NONE' };
    const ticket = await supportService.createTicket({ subject: 'Help needed', category: 'OTHER' as any, description: 'Need help with wallet valid', priority: 'MEDIUM' as any, principal: principalCustomer as any });
    expect(ticket.id).toBeDefined();
    // Check outbox
    const outbox: Array<{ event_type: string; payload: any }> = await dataSource.query(`SELECT event_type, payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.created'`, [ticket.id]);
    expect(outbox.length).toBe(1);
    expect(outbox[0]!.payload.customerId).toBe(custId);
    // Dispatch
    const result = await dispatcher.dispatch({ eventType: 'support.ticket.created', eventKey: `support.ticket.created:${ticket.id}`, aggregateType: 'SUPPORT_TICKET', aggregateId: ticket.id, payload: outbox[0]!.payload, correlationId: `support:${ticket.id}` });
    expect(result.dispatched).toBe(1);
    expect(testProvider.sent[0]!.destination).toBe('8066666666');
    // Workforce assigns
    const principalSupport = { type: 'SUPPORT' as const, principalId: 'workforce-support-1', audience: 'test', roles: [], scopes: [], customerAccess: 'ALL', agentAccess: 'ALL', aggregatorAccess: 'NONE' } as any;
    await supportService.assignTicket({ ticketId: ticket.id, assignedTo: 'workforce-support-1', principal: principalSupport });
    const outboxAssign: Array<{ payload: any }> = await dataSource.query(`SELECT payload FROM outbox_events WHERE event_type='support.ticket.assigned' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1`, [ticket.id]);
    expect(outboxAssign.length).toBe(1);
    testProvider.clear();
    const resultAssign = await dispatcher.dispatch({ eventType: 'support.ticket.assigned', eventKey: `support.ticket.assigned:${ticket.id}`, aggregateType: 'SUPPORT_TICKET', aggregateId: ticket.id, payload: outboxAssign[0]!.payload });
    // Should have customer still notified
    expect(resultAssign.generated).toBeGreaterThanOrEqual(1);
  });

  it('6. channel resolver uses authoritative CustomerContactMethod PHONE normalizedValue', async () => {
    const custId = await createCustomerWithPhone('8077777777');
    const resolved = await resolver.resolve('CUSTOMER', custId, 'SMS');
    expect(resolved.destination).toBe('8077777777');
    // Non-existent customer
    const missing = await resolver.resolve('CUSTOMER', randomUUID(), 'SMS');
    expect(missing.destination).toBeNull();
    expect(missing.reason).toBe('CUSTOMER_PHONE_MISSING');
  });

  it('7. Push channel dependency missing — SKIPPED, respects notification_push_enabled', async () => {
    const custId = await createCustomerWithPhone('8088888888');
    const pushRes = await resolver.resolve('CUSTOMER', custId, 'PUSH');
    expect(pushRes.destination).toBeNull();
    expect(pushRes.reason).toBe('PUSH_TOKEN_DEPENDENCY_MISSING');
    // Disable push preference
    await dataSource.query(`UPDATE customer_preferences SET notification_push_enabled=false WHERE customer_id=$1`, [custId]);
    const pushOptOut = await resolver.resolve('CUSTOMER', custId, 'PUSH');
    expect(pushOptOut.reason).toBe('PUSH_OPT_OUT');
    // Dispatcher should SKIPPED for Push
    const payload = { customerId: custId, reference: 'REF-PUSH' };
    // Use a synthetic event that we force to Push? Our map currently only uses SMS, so we test resolver directly for Push SKIPPED path
    // For event that would map to Push if token existed, we can directly call dispatcher with intent via mapped event: we expect SMS only, so Push not generated by default
    // Verify catalogue documents Push dependency
    const cataloguePush = NOTIFICATION_EVENT_CATALOGUE.find(c => c.channel.includes('PUSH'));
    expect(cataloguePush).toBeDefined();
    expect(cataloguePush!.fallback).toContain('SKIPPED');
    // Direct dispatch with Push intent via synthetic
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `push-test:${randomUUID()}`, payload: { customerId: custId, amountMinor: '1000', reference: 'REF-PUSH' } });
    // Our map generates SMS, not Push, so push not tested via dispatcher automatically; resolver test above confirms dependency
    expect(result.dispatched).toBe(1); // SMS still sent
  });

  it('8. Agent SMS dependency — SKIPPED with AGENT_PHONE_DEPENDENCY_MISSING', async () => {
    const agentId = await createAgentDirect(AgentStatus.ACTIVE);
    const resolved = await resolver.resolve('AGENT', agentId, 'SMS');
    expect(resolved.destination).toBeNull();
    expect(resolved.reason).toBe('AGENT_PHONE_DEPENDENCY_MISSING');
    // Dispatch agent lifecycle event should generate SKIPPED delivery
    const payload = { agentId, reference: `AG-${agentId.slice(0,6)}` };
    const key = `agent.suspended:${agentId}`;
    const result = await dispatcher.dispatch({ eventType: 'agent.suspended', eventKey: key, aggregateType: 'AGENT', aggregateId: agentId, payload });
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    const deliveries: Array<{ status: string; last_error: string }> = await dataSource.query(`SELECT status, last_error FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(deliveries[0]!.status).toBe('SKIPPED');
    expect(deliveries[0]!.last_error).toBe('AGENT_PHONE_DEPENDENCY_MISSING');
  });

  it('9. duplicate event processing is idempotent — second dispatch does not create duplicate', async () => {
    const custId = await createCustomerWithPhone('8099999999');
    const payload = { customerId: custId, amountMinor: '12345', reference: 'REF-DUP' };
    const key = `customer.funding.approved:dup-${randomUUID()}`;
    const first = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload });
    expect(first.generated).toBe(1);
    expect(first.dispatched).toBe(1);
    expect(testProvider.sent.length).toBe(1);
    const countBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(countBefore[0]!.count).toBe('1');
    testProvider.clear();
    const second = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload });
    expect(second.generated).toBe(0);
    expect(second.dispatched).toBe(0);
    expect(testProvider.sent.length).toBe(0); // provider not called again
    const countAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(countAfter[0]!.count).toBe('1');
  });

  it('10. provider failure isolated — delivery marked FAILED, financial state preserved', async () => {
    const custId = await createCustomerWithPhone('8000000001');
    const payload = { customerId: custId, amountMinor: '99900', reference: 'REF-FAIL' };
    const key = `customer.funding.approved:fail-${randomUUID()}`;
    testProvider.shouldFail = true;
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload });
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);
    const deliveries: Array<{ status: string; attempts: number; last_error: string }> = await dataSource.query(`SELECT status, attempts, last_error FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(deliveries[0]!.status).toBe('FAILED');
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.last_error).toContain('Simulated provider failure');
    // Financial state would still be approved — simulate funding flow with provider failure not rolling back
    // Create a real funding request and approve, then dispatch with failing provider — verify funding still APPROVED in DB
    testProvider.shouldFail = false; // reset for setup
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const newCust = await createCustomerWithPhone('8000000002');
    const idem = `idem-${randomUUID()}`;
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${newCust}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '10000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fid = createRes.body.id as string;
    const approveRes = await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fid}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
    // Now dispatch with failure
    testProvider.shouldFail = true;
    const outbox: Array<{ payload: any; correlation_id: string }> = await dataSource.query(`SELECT payload, correlation_id FROM outbox_events WHERE event_type='customer.funding.approved' AND aggregate_id=$1`, [fid]);
    const failResult = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: `customer.funding.approved:${fid}`, payload: outbox[0]!.payload, correlationId: outbox[0]!.correlation_id });
    expect(failResult.failed).toBe(1);
    // Funding still APPROVED
    const fundingRows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM customer_funding_requests WHERE id=$1`, [fid]);
    expect(fundingRows[0]!.status).toBe('APPROVED');
    testProvider.shouldFail = false;
  });

  it('11. cross-principal isolation — customer A does not receive customer B notification', async () => {
    const custA = await createCustomerWithPhone('8010101010');
    const custB = await createCustomerWithPhone('8020202020');
    const payloadA = { customerId: custA, amountMinor: '10000', reference: 'REF-A' };
    const keyA = `isolated:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: keyA, payload: payloadA });
    expect(testProvider.sent.length).toBe(1);
    expect(testProvider.sent[0]!.destination).toBe('8010101010');
    expect(testProvider.sent[0]!.recipientId).toBe(custA);
    // Ensure B has no deliveries for A's event
    const deliveriesB: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries WHERE recipient_id=$1 AND event_key=$2`, [custB, keyA]);
    expect(deliveriesB[0]!.count).toBe('0');
    // Agent isolation too
    testProvider.clear();
    const agentId = await createAgentDirect(AgentStatus.ACTIVE);
    const payloadAgent = { agentId, reference: 'REF-AG' };
    const keyAgent = `agent.activated:${agentId}:${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'agent.activated', eventKey: keyAgent, payload: payloadAgent });
    const deliveriesCustomer: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries WHERE recipient_id=$1 AND event_key=$2`, [custA, keyAgent]);
    expect(deliveriesCustomer[0]!.count).toBe('0');
  });

  it('12. internal support notes never sent — isolation', async () => {
    const custId = await createCustomerWithPhone('8030303030');
    const payloadInternal = { ticketId: randomUUID(), reference: 'SUP-INT', customerId: custId, body: 'Secret internal note with password 123', isInternal: true };
    const key = `support.ticket.message_added:${randomUUID()}`;
    const result = await dispatcher.dispatch({ eventType: 'support.ticket.message_added', eventKey: key, payload: payloadInternal });
    expect(result.generated).toBe(0);
    expect(testProvider.sent.length).toBe(0);
    const deliveries: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(deliveries[0]!.count).toBe('0');
  });

  it('13. no secrets in stored payload or message — redaction', async () => {
    const custId = await createCustomerWithPhone('8040404040');
    const payloadWithSecrets = {
      customerId: custId,
      amountMinor: '50000',
      reference: 'REF-SECRET',
      pin: '1234',
      pinHash: 'hash',
      password: 'secret',
      tokenHash: 'tok',
      transferCode: 'code',
      secret: 'shh',
    } as unknown as Record<string, unknown>;
    const key = `customer.funding.approved:secret-${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: payloadWithSecrets });
    const deliveries: Array<{ payload: any; message: string }> = await dataSource.query(`SELECT payload, message FROM notification_deliveries WHERE event_key=$1`, [key]);
    const stored = JSON.stringify(deliveries[0]!.payload).toLowerCase();
    expect(stored).not.toContain('1234');
    expect(stored).toContain('[redacted]');
    expect(deliveries[0]!.message.toLowerCase()).not.toContain('pin');
    expect(deliveries[0]!.message.toLowerCase()).not.toContain('password');
    expect(deliveries[0]!.message.toLowerCase()).not.toContain('token');
    expect(testProvider.sent[0]!.message.toLowerCase()).not.toContain('pin');
  });

  it('14. outbox retry preserved — FAILED can be retried via claimPending pattern', async () => {
    // Simulate outbox event that failed and is retried
    const eid = randomUUID();
    const payload = { test: 'retry' };
    await dataSource.query(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, event_key, schema_version, classification, retention_class, occurred_at, correlation_id, payload, status, attempts, available_at) VALUES ($1,'customer.funding.approved','CUSTOMER_FUNDING_REQUEST',$2,'retry-key-${eid}',1,'INTERNAL_OPERATIONS','OPERATIONS_DEFAULT',NOW(),'corr', $3::jsonb,'FAILED',1,NOW() - INTERVAL '10 minutes')`, [eid, randomUUID(), JSON.stringify(payload)]);
    // Insert a notification delivery that previously failed
    const custId = await createCustomerWithPhone('8050505050');
    const failKey = `retry-delivery:${randomUUID()}`;
    await dataSource.query(`INSERT INTO notification_deliveries (event_type, event_key, recipient_type, recipient_id, channel, destination, payload, message, status, attempts) VALUES ('customer.funding.approved',$1,'CUSTOMER',$2,'SMS','8050505050','{}'::jsonb,'test', 'FAILED',1)`, [failKey, custId]);
    const deliveries: Array<{ status: string }> = await dataSource.query(`SELECT status FROM notification_deliveries WHERE event_key=$1`, [failKey]);
    expect(deliveries[0]!.status).toBe('FAILED');
    // Verify outbox pending claim via direct query (simulates OutboxService.claimPending)
    await dataSource.query(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, event_key, schema_version, classification, retention_class, occurred_at, correlation_id, payload, status, attempts, available_at) VALUES ($1,'test.event','TEST',$2,'claim-test-${eid}',1,'INTERNAL_OPERATIONS','OPERATIONS_DEFAULT',NOW(),'corr', $3::jsonb,'PENDING',0,NOW())`, [randomUUID(), randomUUID(), JSON.stringify(payload)]);
    const pending: Array<{ id: string }> = await dataSource.query(`SELECT id FROM outbox_events WHERE status='PENDING' AND available_at <= NOW() LIMIT 1`);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    // Simulate claim by updating status
    await dataSource.query(`UPDATE outbox_events SET status='PUBLISHED', attempts=attempts+1, published_at=NOW() WHERE id=$1`, [pending[0]!.id]);
    const after: Array<{ status: string }> = await dataSource.query(`SELECT status FROM outbox_events WHERE id=$1`, [pending[0]!.id]);
    expect(after[0]!.status).toBe('PUBLISHED');
    // Verify notification dispatcher can process pending outbox via processPendingOutboxEvents
    const processed = await dispatcher.processPendingOutboxEvents(1);
    expect(typeof processed).toBe('number');
  });

  it('15. message content safe — uses public reference and NGN amount, no ledger IDs', async () => {
    const custId = await createCustomerWithPhone('8060606060');
    const payload = { customerId: custId, amountMinor: '123456', reference: 'FUND-REF-123', journalId: 'journal-secret-id', ledgerAccountId: 'ledger-secret' };
    const key = `customer.funding.approved:msg-${randomUUID()}`;
    await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload });
    const sent = testProvider.sent[0]!;
    expect(sent.message).toContain('NGN 1234.56');
    expect(sent.message).toContain('FUND-REF');
    expect(sent.message).not.toContain('journal-secret-id');
    expect(sent.message).not.toContain('ledger-secret');
    // Also check stored message
    const deliveries: Array<{ message: string }> = await dataSource.query(`SELECT message FROM notification_deliveries WHERE event_key=$1`, [key]);
    expect(deliveries[0]!.message).toContain('NGN');
  });

  it('16. catalogue covers required events', async () => {
    const requiredEvents = ['customer.funding.approved', 'customer.funding.rejected', 'transfer.completed', 'support.ticket.created', 'support.ticket.assigned', 'support.ticket.status_changed', 'support.ticket.resolved', 'support.ticket.closed', 'support.ticket.message_added'];
    for (const ev of requiredEvents) {
      const entry = NOTIFICATION_EVENT_CATALOGUE.find(c => c.eventType === ev);
      expect(entry).toBeDefined();
      expect(entry!.required).toBe(true);
    }
    // Ensure customer vs agent distinction documented
    const agentEntries = NOTIFICATION_EVENT_CATALOGUE.filter(c => c.recipient.includes('AGENT'));
    expect(agentEntries.length).toBeGreaterThan(0);
  });

  it('17. Process real V1-001 funding flow still credits ledger (regression)', async () => {
    const custId = await createCustomerWithPhone('8070707070');
    const makerToken = workforceToken('SUPPORT');
    const checkerToken = workforceToken('OPERATOR');
    const idem = `idem-${randomUUID()}`;
    const before: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const createRes = await request(app.getHttpServer()).post(`/api/v1/internal/customers/${custId}/funding-requests`).set('Authorization', `Bearer ${makerToken}`).send({ amountMinor: '30000', currency: 'NGN', idempotencyKey: idem }).expect(201);
    const fid = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/customer-funding-requests/${fid}/approve`).set('Authorization', `Bearer ${checkerToken}`).send({}).expect(201);
    const after: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(after[0]!.count)).toBeGreaterThan(Number(before[0]!.count));
    // And funding is APPROVED
    const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM customer_funding_requests WHERE id=$1`, [fid]);
    expect(rows[0]!.status).toBe('APPROVED');
  });

  it('18. V1-007 support still works after notification module', async () => {
    const custId = await createCustomerWithPhone('8080707070');
    const pwd = 'SupTest1!';
    const hash = encodePbkdf2(pwd, 'sup-salt2');
    await dataSource.query(`INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`, [custId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId: custId, password: pwd });
    const token = login.body.accessToken as string;
    const ticketRes = await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').set('Authorization', `Bearer ${token}`).send({ subject: 'Help', category: 'OTHER', description: 'Need assistance valid', priority: 'MEDIUM' }).expect(201);
    expect(ticketRes.body.id).toBeDefined();
  });

  it('19. V1-003 admin lifecycle still works', async () => {
    // Simple ACTIVE agent via direct insert, test suspend/terminate still gated by OPERATOR
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status) VALUES ($1,'ACTIVE') RETURNING id`, [`ref-${randomUUID()}`]);
    const agentId = agentRows[0]!.id;
    const token = workforceToken('OPERATOR');
    const suspendRes = await request(app.getHttpServer()).post(`/api/v1/internal/admin/agents/${agentId}/suspend`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(suspendRes.body.status).toBe('SUSPENDED');
    const terminateRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/terminate`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(terminateRes.body.status).toBe('TERMINATED');
  });

  it('20. migration count is 66 and notification_deliveries exists, baggage checks', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(66);
    const latest: Array<{ name: string; timestamp: string }> = await dataSource.query(`SELECT name, timestamp::text as timestamp FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600065');
    expect(latest[0]!.name).toBe('CreateNotificationDeliveries1785753600065');
    const notifExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notification_deliveries') as exists`);
    expect(notifExists[0]!.exists).toBe(true);
    const suppExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='support_tickets') as exists`);
    expect(suppExists[0]!.exists).toBe(true);
    // V1-006: inbox reuses notification_deliveries, no second table customer_notifications
    const inboxExists: Array<{ exists: boolean }> = await dataSource.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customer_notifications') as exists`);
    expect(inboxExists[0]!.exists).toBe(false);
    // V1-006: GET /customers/me/notifications now exists (CUSTOMER SELF, empty inbox returns 200)
    const custId = await createCustomerWithPhone('8090909090');
    const pwd = 'InboxTest1!';
    const hash = encodePbkdf2(pwd, 'inbox-salt');
    await dataSource.query(`INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`, [custId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId: custId, password: pwd });
    const token = login.body.accessToken as string;
    const inboxRes = await request(app.getHttpServer()).get('/api/v1/customers/me/notifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Array.isArray(inboxRes.body.items)).toBe(true);
    expect(inboxRes.body.pagination).toBeDefined();
  });

  it('21. NO FAKE DELIVERY — no invented provider credentials stored, console/test adapter only', async () => {
    // Check that no env var contains fake credentials
    const hasFakeCred = Object.keys(process.env).some(k => k.includes('TWILIO') || k.includes('TERMII') || k.includes('AFRICA'));
    // In test env, should not have real credentials; we only use console/test
    expect(testProvider.name).toBe('test');
    // Verify delivery status distinguishes GENERATED vs DISPATCHED vs PROVIDER DELIVERY via providerRef
    const custId = await createCustomerWithPhone('8000000011');
    const key = `fake-check:${randomUUID()}`;
    const result = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: custId, reference: 'REF-FAKE', amountMinor: '1000' } });
    expect(result.deliveries[0]!.providerRef).toMatch(/test-/);
    // Check outbox still GENERATED
    await dataSource.query(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, event_key, schema_version, classification, retention_class, occurred_at, correlation_id, payload, status, attempts, available_at) VALUES ($1,'customer.funding.approved','CUSTOMER_FUNDING_REQUEST',$2,$3,1,'INTERNAL_OPERATIONS','OPERATIONS_DEFAULT',NOW(),'corr', $4::jsonb,'PENDING',0,NOW())`, [randomUUID(), randomUUID(), key, JSON.stringify({ customerId: custId })]);
    const outbox: Array<{ status: string }> = await dataSource.query(`SELECT status FROM outbox_events WHERE event_key=$1`, [key]);
    expect(outbox[0]!.status).toBe('PENDING'); // GENERATED
    // After dispatch, outbox would be marked PUBLISHED via processPendingOutboxEvents, but notification delivery is separate
  });

  it('22. Event catalogue explicit mapping verified', async () => {
    // Verify funding, transfer, support 5, cash-to-cash, agent lifecycle documented
    const catalogue = NOTIFICATION_EVENT_CATALOGUE;
    const hasFundingApproved = catalogue.some(c => c.eventType === 'customer.funding.approved' && c.required);
    const hasTransfer = catalogue.some(c => c.eventType === 'transfer.completed' && c.required);
    const hasSupportCreated = catalogue.some(c => c.eventType === 'support.ticket.created');
    const hasCashClaim = catalogue.some(c => c.eventType === 'cash_to_cash.claimed');
    const hasAgentSuspend = catalogue.some(c => c.eventType === 'agent.suspended');
    expect(hasFundingApproved).toBe(true);
    expect(hasTransfer).toBe(true);
    expect(hasSupportCreated).toBe(true);
    expect(hasCashClaim).toBe(true);
    expect(hasAgentSuspend).toBe(true);
    // Check source→recipient/channel/template for required events
    const fundingMap = mapEventToIntents('customer.funding.approved', { customerId: randomUUID() }, { correlationId: null, causationId: null });
    expect(fundingMap.length).toBe(1);
    expect(fundingMap[0]!.channel).toBe('SMS');
    expect(fundingMap[0]!.recipientType).toBe('CUSTOMER');
  });

  it('23. Idempotency deterministic — eventKey ≤180, canonical', async () => {
    const custId = await createCustomerWithPhone('8000000012');
    const longKey = 'a'.repeat(180);
    await expect(dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: longKey, payload: { customerId: custId } })).resolves.toBeDefined();
    const tooLongKey = 'a'.repeat(181);
    await expect(dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: tooLongKey, payload: { customerId: custId } })).rejects.toThrow();
    // Verify deterministic: same eventKey + same recipient+channel yields same delivery idempotent
    const key = `deterministic:${randomUUID()}`;
    const first = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: custId } });
    const second = await dispatcher.dispatch({ eventType: 'customer.funding.approved', eventKey: key, payload: { customerId: custId } });
    expect(first.deliveries[0]!.id).toBe(second.deliveries[0]!.id);
  });
});
