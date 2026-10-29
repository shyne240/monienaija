import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import type { AgentFinancialExecutionService } from '../src/agent/agent-financial-execution.service';
import type { AgentTransactionAuthorizationService } from '../src/agent/agent-transaction-authorization.service';
import type { RecipientResolutionService } from '../src/agent/recipient-resolution.service';
import type { NotificationChannelResolverService } from '../src/notification/notification-channel-resolver.service';
import type { NotificationTemplateService } from '../src/notification/notification-template.service';
import type { NotificationProvider } from '../src/notification/notification.types';
import type { WalletService } from '../src/wallet/wallet.service';

import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import { createRequestContext } from '../src/production/request-context';
import { NotificationDeliveryProcessor } from '../src/notification/notification-delivery-processor';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * Arena 4 report 26 (N-02) — dedicated PostgreSQL persistence verification.
 *
 * Submits synthetic credential-shaped business correlation ids through the real
 * application/service boundaries (AgentCashInService.execute, AuditService.record,
 * OutboxService.enqueue/enqueueOnce, NotificationDispatcherService.dispatch), exercises
 * the audit/outbox/notification-delivery persistence paths on a disposable `mn_it_*`
 * database with safe mocks (mocked financial execution — NO money moves; mocked
 * providers — NO external calls), reads the persisted records back, and verifies:
 *  1. credentials are absent from every persisted row and every read projection,
 *  2. legitimate business correlation identifiers are preserved byte-for-byte,
 *  3. downstream notification mapping/delivery persistence carries only sanitized ids,
 *  4. legacy raw rows persisted before the remediation are masked at the read
 *     boundaries (audit list, outbox views, delivery listings, provider send commands),
 *  5. deterministic sanitization keeps outbox retry equality (enqueueOnce) consistent.
 */

const CREDENTIAL_ID = 'Bearer abcdefgh'; // synthetic canonical credential-shaped id
const LOWER_CREDENTIAL_ID = 'bearer abc'; // synthetic short/lowercase variant
const LEGITIMATE_ID = 'corr-biz-r26-42';
const REDACTED = '[REDACTED]';

jest.setTimeout(240000);

describe('report 26 N-02 — business correlation id persistence (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let auditService: AuditService;
  let outboxService: OutboxService;
  let dispatcher: NotificationDispatcherService;
  const sentProviderCommands: Array<Record<string, unknown>> = [];

  const templateMock = {
    redactPayload: (payload: Record<string, unknown>) => payload,
    definition: () => undefined,
    isEventEnabled: () => Promise.resolve(true),
    renderActive: () => Promise.resolve({ body: 'R26 persistence test message' }),
    buildMessage: () => 'R26 persistence test message',
    assertSafe: () => undefined,
  } as unknown as NotificationTemplateService;
  const resolverMock = {
    resolve: () => Promise.resolve({ destination: '08012345678' }),
  } as unknown as NotificationChannelResolverService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('r26corr');
    auditService = new AuditService(dataSource.getRepository(AuditEvent));
    outboxService = new OutboxService(dataSource.getRepository(OutboxEvent));
    dispatcher = new NotificationDispatcherService(
      dataSource,
      resolverMock,
      templateMock,
      null,
      null,
      null,
      undefined,
      undefined,
    );
  });

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  });

  async function insertCustomer(id: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [id, `r26-${randomUUID().slice(0, 8)}`],
    );
  }

  async function insertWallet(ownerId: string): Promise<void> {
    const ledgerAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency)
       VALUES ($1,$2,'R26 persistence wallet','LIABILITY','CREDIT','NGN')`,
      [ledgerAccountId, `R26-${randomUUID().slice(0, 12)}`],
    );
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, currency, ledger_account_id)
       VALUES ($1,$2,'NGN',$3)`,
      [randomUUID(), ownerId, ledgerAccountId],
    );
  }

  describe('audit persistence boundary', () => {
    it('sanitizes a credential-shaped correlation id before the audit row is written', async () => {
      const entityId = randomUUID();
      await dataSource.transaction((manager) =>
        auditService.record(manager, {
          entityType: 'AGENT_CASH_IN',
          entityId,
          action: 'CASH_IN_COMPLETED',
          actor: randomUUID(),
          correlationId: CREDENTIAL_ID,
          newValues: { amountMinor: '100' },
        }),
      );
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM audit_events WHERE entity_id=$1`,
        [entityId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.correlation_id).toBe(REDACTED);
      expect(rows[0]?.correlation_id).not.toContain('abcdefgh');
    });

    it('preserves a legitimate business correlation id byte-for-byte', async () => {
      const entityId = randomUUID();
      await dataSource.transaction((manager) =>
        auditService.record(manager, {
          entityType: 'AGENT_CASH_IN',
          entityId,
          action: 'CASH_IN_COMPLETED',
          actor: randomUUID(),
          correlationId: LEGITIMATE_ID,
        }),
      );
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM audit_events WHERE entity_id=$1`,
        [entityId],
      );
      expect(rows[0]?.correlation_id).toBe(LEGITIMATE_ID);
    });

    it('row 10 — a credential-shaped request-context id is sanitized at creation and stays clean through the real audit/POA persistence sink', async () => {
      // Report 26 inventory row 10 gap: "No dedicated assertion writes a
      // credential-shaped request-context ID through the real POA/audit sink
      // and reads it back." The POA controller persists exactly this shape:
      // auditContext { correlationId: context.correlationId, requestId: context.requestId }.
      const context = createRequestContext({
        'x-correlation-id': CREDENTIAL_ID,
        'x-request-id': `req-r26-${randomUUID()}`,
      });
      expect(context.correlationId).not.toContain('abcdefgh');
      expect(context.correlationId).toBe(REDACTED);
      const entityId = randomUUID();
      await dataSource.transaction((manager) =>
        auditService.record(manager, {
          entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
          entityId,
          action: 'SUBMISSION_RECORDED',
          actor: randomUUID(),
          correlationId: context.correlationId,
          requestId: context.requestId,
        }),
      );
      const rows: Array<{ correlation_id: string | null; request_id: string | null }> =
        await dataSource.query(
          `SELECT correlation_id, request_id FROM audit_events WHERE entity_id=$1`,
          [entityId],
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.correlation_id).toBe(REDACTED);
      expect(rows[0]?.request_id).toBe(context.requestId);
      expect(JSON.stringify(rows[0])).not.toContain('abcdefgh');
    });

    it('row 10 — a legitimate request-context correlation header survives creation and audit persistence unchanged', async () => {
      const header = `corr-ctx-r26-${randomUUID().slice(0, 8)}`;
      const context = createRequestContext({ 'x-correlation-id': header });
      expect(context.correlationId).toBe(header);
      const entityId = randomUUID();
      await dataSource.transaction((manager) =>
        auditService.record(manager, {
          entityType: 'CUSTOMER_PROOF_OF_ADDRESS',
          entityId,
          action: 'SUBMISSION_RECORDED',
          actor: randomUUID(),
          correlationId: context.correlationId,
          requestId: context.requestId,
        }),
      );
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM audit_events WHERE entity_id=$1`,
        [entityId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.correlation_id).toBe(header);
    });

    it('lookup by correlation id is symmetric: the same deterministic value finds the row', async () => {
      const views = await auditService.list({ correlationId: CREDENTIAL_ID });
      expect(views.length).toBeGreaterThan(0);
      for (const view of views) {
        expect(view.correlationId).toBe(REDACTED);
      }
      const legitimateViews = await auditService.list({ correlationId: LEGITIMATE_ID });
      expect(legitimateViews.length).toBeGreaterThan(0);
      expect(legitimateViews[0]?.correlationId).toBe(LEGITIMATE_ID);
    });

    it('masks a legacy raw row at the read boundary (row-15 protection, no backfill)', async () => {
      const legacyId = randomUUID();
      const legacyEntity = randomUUID();
      await dataSource.query(
        `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, correlation_id,
           request_id, previous_values, new_values, occurred_at)
         VALUES ($1,'AGENT_CASH_IN',$2,'CASH_IN_COMPLETED',$3,'bearer abcdefgh',NULL,NULL,NULL,NOW())`,
        [legacyId, legacyEntity, randomUUID()],
      );
      const views = await auditService.list({ entityId: legacyEntity });
      expect(views).toHaveLength(1);
      expect(views[0]?.correlationId).toBe(REDACTED);
      // The stored row itself is untouched (no production-data modification).
      const stored: Array<{ correlation_id: string }> = await dataSource.query(
        `SELECT correlation_id FROM audit_events WHERE id=$1`,
        [legacyId],
      );
      expect(stored[0]?.correlation_id).toBe('bearer abcdefgh');
    });
  });

  describe('outbox persistence boundary', () => {
    it('sanitizes a credential-shaped correlation id before the outbox row is written', async () => {
      const aggregateId = randomUUID();
      const event = await dataSource.transaction((manager) =>
        outboxService.enqueue(manager, {
          eventType: 'cash_to_cash.created',
          aggregateType: 'CASH_TO_CASH',
          aggregateId,
          payload: { amountMinor: '100' },
          correlationId: LOWER_CREDENTIAL_ID,
        }),
      );
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM outbox_events WHERE id=$1`,
        [event.id],
      );
      expect(rows[0]?.correlation_id).toBe(REDACTED);
    });

    it('enqueueOnce retry equality holds for identical credential-shaped ids (no false conflict)', async () => {
      const eventKey = `r26-once-${randomUUID()}`;
      const command = {
        eventType: 'cash_to_cash.created',
        aggregateType: 'CASH_TO_CASH',
        aggregateId: randomUUID(),
        payload: { amountMinor: '100' },
        correlationId: CREDENTIAL_ID,
        eventKey,
      };
      const first = await dataSource.transaction((manager) =>
        outboxService.enqueueOnce(manager, command),
      );
      const second = await dataSource.transaction((manager) =>
        outboxService.enqueueOnce(manager, { ...command }),
      );
      expect(second.id).toBe(first.id);
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM outbox_events WHERE event_key=$1`,
        [eventKey],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.correlation_id).toBe(REDACTED);
    });

    it('preserves a legitimate business correlation id byte-for-byte', async () => {
      const event = await dataSource.transaction((manager) =>
        outboxService.enqueue(manager, {
          eventType: 'cash_to_cash.created',
          aggregateType: 'CASH_TO_CASH',
          aggregateId: randomUUID(),
          payload: {},
          correlationId: LEGITIMATE_ID,
        }),
      );
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM outbox_events WHERE id=$1`,
        [event.id],
      );
      expect(rows[0]?.correlation_id).toBe(LEGITIMATE_ID);
    });

    it('masks a legacy raw outbox row in list views', async () => {
      await dataSource.query(
        `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, event_key,
           schema_version, classification, retention_class, occurred_at, correlation_id,
           causation_id, payload, status, attempts, available_at, last_error, published_at)
         VALUES ($1,'cash_to_cash.created','CASH_TO_CASH',$2,$3,1,'INTERNAL_OPERATIONS',
           'OPERATIONS_DEFAULT',NOW(),'bearer abcdefgh',NULL,'{}','PENDING',0,NOW(),NULL,NULL)`,
        [randomUUID(), randomUUID(), `r26-legacy-${randomUUID()}`],
      );
      const views = await outboxService.list({});
      for (const view of views) {
        expect(String(view.correlationId ?? '')).not.toContain('abcdefgh');
      }
      const masked = views.filter((view) => view.correlationId === REDACTED);
      expect(masked.length).toBeGreaterThan(0);
    });
  });

  describe('notification delivery persistence (dispatcher + event mapping)', () => {
    it('a credential-shaped correlation id is sanitized into intents and the delivery row', async () => {
      const customerId = randomUUID();
      const eventKey = `r26-dispatch-${randomUUID()}`;
      const result = await dispatcher.dispatch({
        eventType: 'customer.funding.approved',
        eventKey,
        payload: { customerId },
        correlationId: LOWER_CREDENTIAL_ID,
      });
      expect(result.generated).toBe(1);
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM notification_deliveries WHERE event_key=$1`,
        [eventKey],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.correlation_id).toBe(REDACTED);
    });

    it('preserves a legitimate business correlation id into the delivery row', async () => {
      const customerId = randomUUID();
      const eventKey = `r26-dispatch-legit-${randomUUID()}`;
      const result = await dispatcher.dispatch({
        eventType: 'customer.funding.approved',
        eventKey,
        payload: { customerId },
        correlationId: LEGITIMATE_ID,
      });
      expect(result.generated).toBe(1);
      const rows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM notification_deliveries WHERE event_key=$1`,
        [eventKey],
      );
      expect(rows[0]?.correlation_id).toBe(LEGITIMATE_ID);
    });

    it('masks legacy raw correlation ids in listDeliveriesForEventKey projections', async () => {
      const eventKey = `r26-legacy-delivery-${randomUUID()}`;
      await dataSource.query(
        `INSERT INTO notification_deliveries (event_type, event_key, aggregate_type, aggregate_id,
           recipient_type, recipient_id, channel, destination, payload, message, rendered_subject,
           rendered_html, status, attempts, last_error, correlation_id, causation_id,
           created_at, updated_at)
         VALUES ('customer.funding.approved',$1,NULL,NULL,'CUSTOMER',$2,'SMS','08012345678',
           '{}','R26 legacy',NULL,NULL,'SENT',1,NULL,'bearer abcdefgh',NULL,NOW(),NOW())`,
        [eventKey, randomUUID()],
      );
      const deliveries = await dispatcher.listDeliveriesForEventKey(eventKey);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.['correlation_id']).toBe(REDACTED);
    });

    it('the delivery processor hands only sanitized correlation ids to providers (legacy rows included)', async () => {
      const smsProvider = {
        name: 'r26-test-provider',
        send: (request: Record<string, unknown>) => {
          sentProviderCommands.push(request);
          return Promise.resolve({ success: true, providerRef: `r26-ref-${randomUUID()}` });
        },
      } as unknown as NotificationProvider;
      const processor = new NotificationDeliveryProcessor({
        dataSource,
        resolver: resolverMock,
        templates: templateMock,
        smsProvider,
        emailProvider: null,
        maxAttempts: 3,
        baseDelaySeconds: 60,
      });
      const eventKey = `r26-processor-${randomUUID()}`;
      await dataSource.query(
        `INSERT INTO notification_deliveries (event_type, event_key, aggregate_type, aggregate_id,
           recipient_type, recipient_id, channel, destination, payload, message, rendered_subject,
           rendered_html, status, attempts, last_error, correlation_id, causation_id,
           created_at, updated_at)
         VALUES ('customer.funding.approved',$1,NULL,NULL,'CUSTOMER',$2,'SMS','08012345678',
           '{}','R26 processor',NULL,NULL,'PENDING',0,NULL,'bearer abcdefgh',NULL,NOW(),NOW())`,
        [eventKey, randomUUID()],
      );
      const summary = await processor.processBatch(5);
      expect(summary.claimed).toBeGreaterThan(0);
      expect(sentProviderCommands.length).toBeGreaterThan(0);
      for (const command of sentProviderCommands) {
        expect(typeof command.correlationId).toBe('string');
        expect(command.correlationId).not.toContain('abcdefgh');
      }
      const processed = sentProviderCommands.filter(
        (command) => command.correlationId === REDACTED,
      );
      expect(processed.length).toBeGreaterThan(0);
    });
  });

  describe('AgentCashInService boundary (safe mocks: no financial execution, no providers)', () => {
    function buildCashInService(agentId: string, executionCalls: Array<Record<string, unknown>>) {
      const customerIdHolder: { id: string } = { id: '' };
      const resolutionMock = {
        resolve: () =>
          Promise.resolve({
            ownerType: 'CUSTOMER',
            ownerId: customerIdHolder.id,
            receivingNumber: '08012345678',
            display: 'R26 Recipient',
            status: 'ACTIVE',
          }),
      } as unknown as RecipientResolutionService;
      const authzMock = {
        authorize: () =>
          Promise.resolve({
            allowed: true,
            context: { agentId, canonicalService: 'CASH_IN' },
          }),
      } as unknown as AgentTransactionAuthorizationService;
      const executionMock = {
        execute: (command: Record<string, unknown>) => {
          executionCalls.push(command);
          return Promise.resolve({
            status: 'POSTED',
            journalId: randomUUID(),
            idempotencyKey: command.idempotencyKey,
            requestHash: 'r26-request-hash',
            replayed: false,
            agentId,
            createdAt: new Date(),
          });
        },
      } as unknown as AgentFinancialExecutionService;
      const walletMock = {} as unknown as WalletService; // wallets pre-created via SQL; never reached
      const service = new AgentCashInService(
        dataSource,
        resolutionMock,
        authzMock,
        executionMock,
        walletMock,
        auditService,
      );
      return { service, customerIdHolder };
    }

    async function seedAgentAndCustomer(agentId: string, customerId: string): Promise<void> {
      await insertCustomer(customerId);
      await insertWallet(customerId);
      await insertWallet(agentId);
    }

    it('a credential-shaped correlation id never reaches execution, audit persistence, or the response', async () => {
      const agentId = randomUUID();
      const customerId = randomUUID();
      await seedAgentAndCustomer(agentId, customerId);
      const executionCalls: Array<Record<string, unknown>> = [];
      const { service, customerIdHolder } = buildCashInService(agentId, executionCalls);
      customerIdHolder.id = customerId;

      const result = await service.execute({
        agentId,
        principal: {
          type: 'AGENT',
          principalId: agentId,
          agentId,
          roles: [],
          scopes: [],
          customerAccess: 'NONE',
        },
        pin: '0000',
        recipientIdentifier: '08012345678',
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `r26-cashin-${randomUUID()}`,
        correlationId: CREDENTIAL_ID,
      });

      expect(result.correlationId).toBe(REDACTED);
      expect(executionCalls).toHaveLength(1);
      expect(executionCalls[0]?.correlationId).toBe(REDACTED);
      const auditRows: Array<{ correlation_id: string | null; new_values: unknown }> =
        await dataSource.query(
          `SELECT correlation_id, new_values FROM audit_events WHERE entity_id=$1`,
          [result.journalId],
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.correlation_id).toBe(REDACTED);
      expect(JSON.stringify(auditRows[0]?.new_values ?? {})).not.toContain('abcdefgh');
    });

    it('a legitimate business correlation id flows through execution, audit and response unchanged', async () => {
      const agentId = randomUUID();
      const customerId = randomUUID();
      await seedAgentAndCustomer(agentId, customerId);
      const executionCalls: Array<Record<string, unknown>> = [];
      const { service, customerIdHolder } = buildCashInService(agentId, executionCalls);
      customerIdHolder.id = customerId;
      const legitimate = `corr-cashin-r26-${randomUUID().slice(0, 8)}`;

      const result = await service.execute({
        agentId,
        principal: {
          type: 'AGENT',
          principalId: agentId,
          agentId,
          roles: [],
          scopes: [],
          customerAccess: 'NONE',
        },
        pin: '0000',
        recipientIdentifier: '08012345678',
        amountMinor: '100',
        currency: 'NGN',
        idempotencyKey: `r26-cashin-${randomUUID()}`,
        correlationId: legitimate,
      });

      expect(result.correlationId).toBe(legitimate);
      expect(executionCalls[0]?.correlationId).toBe(legitimate);
      const auditRows: Array<{ correlation_id: string | null }> = await dataSource.query(
        `SELECT correlation_id FROM audit_events WHERE entity_id=$1`,
        [result.journalId],
      );
      expect(auditRows[0]?.correlation_id).toBe(legitimate);
    });
  });
});
