/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
/**
 * Arena 3 producer-contract correction — transfer.completed / transfer.failed events
 * emitted by the audited TransferService must carry the versioned (schema v1) recipient
 * identity and safe facts the notification.v1 consumer requires, derived from
 * authoritative domain state (locked wallet rows + persisted transfer entity).
 *
 * Producer-shaped: this suite drives the REAL TransferService against real PostgreSQL
 * (SERIALIZABLE transactions, real ledger posting, real outbox rows) and then the REAL
 * Arena 1 subscriber/dispatcher/processor chain with synthetic recording providers only —
 * no vendor call, no credential, no financial amount/fee/ledger logic is altered.
 *
 * Verifies:
 *  - materialization of the intended notifications for BOTH audiences (completed) and the
 *    source audience only (failed), with no duplication on replay/re-drain;
 *  - atomicity: outbox row commits with the financial state (or not at all);
 *  - accounting invariants: exactly one balanced journal per completed transfer, none for
 *    a failed transfer, no double posting on idempotent replay;
 *  - privacy: journal ids, payment references, request hashes, failure prose and any
 *    PIN/secret never enter delivery payloads or rendered messages;
 *  - shared-outbox isolation: the notification consumer never mutates outbox_events;
 *  - Nigerian E.164 convergence at the transport boundary;
 *  - F-01 boundary sanitization on the new processor persistence path (opaque pvr1 refs);
 *  - the consumer still quarantines legacy zero-recipient producer payloads (no guessing).
 */
import { HttpException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerNormalBalance, LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { NotificationDispatcherService } from '../src/notification/notification-dispatcher.service';
import { NotificationWorkerService } from '../src/notification/notification-worker.service';
import { ConfigurableSmsNotificationProvider } from '../src/notification/notification-provider-config.service';
import { seedNotificationDefaultsV1 } from '../src/notification/notification-defaults-v1';
import type { NotificationProvider, NotificationSendRequest, NotificationSendResult } from '../src/notification/notification.types';
import { TransferService } from '../src/transfer/transfer.service';
import { TransferStatus } from '../src/transfer/transfer.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  seedTransferParticipant,
} from './support/pg-harness';

class RecordingSmsProvider implements NotificationProvider {
  readonly name = 'test';
  sent: NotificationSendRequest[] = [];
  response: NotificationSendResult = { success: true, providerRef: 'synthetic-ref' };
  async send(request: NotificationSendRequest): Promise<NotificationSendResult> {
    this.sent.push(request);
    return this.response;
  }
}

describe('transfer notification producer contract v1 (real PostgreSQL, synthetic providers only)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let transfers: TransferService;
  let ledger: LedgerService;
  let dispatcher: NotificationDispatcherService;
  let worker: NotificationWorkerService;
  let config: ConfigService;
  let provider: RecordingSmsProvider;
  let fundingAccountId: string;

  const workforceConfig = {
    enabled: true, oidcIssuer: 'https://workforce.test', oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce', oidcClientId: 'test-client', internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900, jwksJson: [], financeRoles: [], makerCheckerRules: [], rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  };
  const workforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token.startsWith('workforce-')) throw new UnauthorizedException('invalid');
      const type = token.replace('workforce-', '').toUpperCase();
      return { type, principalId: `test-${type}`, audience, roles: [],
        scopes: ['notification.view_deliveries'], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE' };
    },
  };

  beforeAll(async () => {
    ds = await createIntegrationDataSource('trnotprod1');
    provider = new RecordingSmsProvider();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(ds)
      .overrideProvider(A2WorkforceSessionService).useValue(workforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG).useValue(workforceConfig)
      // Override the CONFIGURABLE SMS delegate, not NOTIFICATION_PROVIDER_TOKEN, so
      // Arena 1's NormalizingSmsNotificationProvider boundary stays in the dispatch path
      // and Nigerian E.164 convergence is exercised end-to-end.
      .overrideProvider(ConfigurableSmsNotificationProvider).useValue(provider).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    transfers = module.get(TransferService);
    ledger = module.get(LedgerService);
    dispatcher = module.get(NotificationDispatcherService);
    worker = module.get(NotificationWorkerService);
    config = module.get(ConfigService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  beforeEach(async () => {
    provider.sent = [];
    provider.response = { success: true, providerRef: 'synthetic-ref' };
    const rows: Array<{ tablename: string }> = await ds.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) await ds.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await seedNotificationDefaultsV1(ds.manager);
    const funding = await ledger.createAccount({
      code: `TEST-FUNDING-${randomUUID().slice(0, 8)}`,
      name: 'Seed funding source',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    fundingAccountId = funding.id;
  });

  interface SeededWallet {
    customerId: string;
    walletAccountId: string;
    ledgerAccountId: string;
    phone: string;
  }

  async function seedWalletPair(label: string, fundMinor = '100000'): Promise<{ source: SeededWallet; destination: SeededWallet }> {
    const seed = async (side: string, phone: string): Promise<SeededWallet> => {
      const account = await ledger.createAccount({
        code: `WALLET-${label}-${side}-${randomUUID().slice(0, 8)}`,
        name: `Customer wallet ${label}-${side}`,
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
      });
      const participant = await seedTransferParticipant(ds, `${label}-${side}`, account.id);
      // Verified contact + explicit true SMS preference — the Arena 1 resolver fails closed
      // without both, so the producer contract must be proven against a resolvable audience.
      await ds.query(
        `INSERT INTO customer_contact_methods (id, customer_id, type, value, normalized_value, is_primary, verified_at)
         VALUES ($1, $2, 'PHONE', $3, $3, true, NOW())`,
        [randomUUID(), participant.customerId, phone],
      );
      await ds.query(
        `INSERT INTO customer_preferences
           (id, customer_id, language_code, theme_code, notification_email_enabled, notification_sms_enabled,
            notification_push_enabled, notification_in_app_enabled, security_login_alerts, security_transaction_alerts,
            security_device_registration_alerts, security_biometric_allowed, version)
         VALUES ($1, $2, 'EN', 'SYSTEM', false, true, false, true, true, true, true, false, 1)`,
        [randomUUID(), participant.customerId],
      );
      await ledger.postJournal({
        idempotencyKey: `fund:${account.id}:${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `fund-${randomUUID().slice(0, 8)}`,
        description: 'Seed wallet balance',
        lines: [
          { accountId: fundingAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: fundMinor },
          { accountId: account.id, direction: LedgerEntryDirection.CREDIT, amountMinor: fundMinor },
        ],
      });
      return { customerId: participant.customerId, walletAccountId: participant.walletAccountId, ledgerAccountId: account.id, phone };
    };
    return { source: await seed('src', '8030000001'), destination: await seed('dst', '8030000002') };
  }

  async function outboxRows(eventType: string): Promise<Array<Record<string, any>>> {
    return ds.query(
      `SELECT id, event_type, event_key, schema_version, classification, retention_class,
              aggregate_type, aggregate_id, correlation_id, status, attempts, published_at, last_error, payload
         FROM outbox_events WHERE event_type = $1 ORDER BY created_at, id`,
      [eventType],
    );
  }

  async function deliveries(): Promise<Array<Record<string, any>>> {
    return ds.query(
      `SELECT id, event_type, event_key, recipient_type, recipient_id, channel, status, attempts,
              destination, message, payload, provider_ref, last_error
         FROM notification_deliveries ORDER BY created_at, id`,
    );
  }

  it('1. completed transfer: the audited producer emits the v1 contract from authoritative state, the consumer materializes exactly one SMS per audience atomically, replay never duplicates, accounting posts exactly one balanced journal, and no journal/payment/request/prose detail reaches payloads or messages', async () => {
    const { source, destination } = await seedWalletPair('tr-ok');

    const idempotencyKey = `tr-${randomUUID()}`;
    const command = {
      sourceWalletId: source.walletAccountId,
      destinationWalletId: destination.walletAccountId,
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey,
      reference: 'transfer-ref',
      narration: 'integration transfer PIN 123456 sentinel-narration',
    };
    const view = await transfers.createTransfer(command as any);
    expect(view.status).toBe(TransferStatus.COMPLETED);
    expect(view.journalId).toBeTruthy();

    // --- Producer contract: exactly one versioned outbox row, committed with the money ---
    const rows = await outboxRows('transfer.completed');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.event_key).toBe(`transfer.completed:${view.id}:v1`);
    expect(row.schema_version).toBe(1);
    expect(row.classification).toBe('RESTRICTED_FINANCIAL');
    expect(row.retention_class).toBe('A5_TRANSFER_EVENT');
    expect(row.aggregate_type).toBe('TRANSFER');
    expect(row.aggregate_id).toBe(view.id);
    expect(row.correlation_id).toBe(`transfer:${view.id}`);
    const payload = row.payload as Record<string, any>;
    // Versioned recipient identity derived from the locked wallet rows (authoritative state).
    expect(payload.sourceCustomerId).toBe(source.customerId);
    expect(payload.destinationCustomerId).toBe(destination.customerId);
    expect(payload.transferId).toBe(view.id);
    expect(payload.amountMinor).toBe('12000');
    expect(payload.currency).toBe('NGN');
    expect(payload.journalId).toBe(view.journalId);
    // Reconciliation v1 shape: entity-mirrored fields stay exact (nulls stay null).
    expect(payload.eventKey).toBe(`transfer.completed:${view.id}:v1`);
    expect(payload.eventType).toBe('transfer.completed');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.commandId).toBeNull();
    expect(payload.accountingUnit).toBeNull();
    expect(typeof payload.requestHash).toBe('string');

    // --- Accounting invariants: exactly one balanced journal, correct direction/amounts ---
    const journals: Array<{ id: string }> = await ds.query(
      `SELECT id FROM ledger_journals WHERE idempotency_key = $1`, [`transfer:${view.id}`]);
    expect(journals).toHaveLength(1);
    const lines: Array<{ ledger_account_id: string; direction: string; amount_minor: string }> = await ds.query(
      `SELECT ledger_account_id, direction, amount_minor FROM ledger_lines WHERE journal_id = $1`, [view.journalId]);
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(expect.arrayContaining([
      { ledger_account_id: source.ledgerAccountId, direction: 'DEBIT', amount_minor: '12000' },
      { ledger_account_id: destination.ledgerAccountId, direction: 'CREDIT', amount_minor: '12000' },
    ]));

    // --- Shared-outbox isolation: snapshot before the notification consumer runs ---
    const before = await ds.query(
      `SELECT status, attempts, published_at, last_error, available_at FROM outbox_events WHERE id = $1`, [row.id]);

    // --- Consumer: one tick materializes AND sends (worker drains outbox, then processor) ---
    const tick = await worker.tick();
    expect(tick.outboxProcessed).toBe(1);

    const after = await ds.query(
      `SELECT status, attempts, published_at, last_error, available_at FROM outbox_events WHERE id = $1`, [row.id]);
    expect(after).toEqual(before); // the notification consumer never acknowledges/mutates shared outbox state

    const receipts = await ds.query(
      `SELECT consumer_name, status FROM notification_outbox_receipts WHERE outbox_event_id = $1`, [row.id]);
    expect(receipts).toEqual([{ consumer_name: 'notification.v1', status: 'MATERIALIZED' }]);

    const sent = await deliveries();
    expect(sent).toHaveLength(2);
    const byRecipient = new Map(sent.map((d) => [d.recipient_id, d]));
    expect(byRecipient.has(source.customerId)).toBe(true);
    expect(byRecipient.has(destination.customerId)).toBe(true);
    for (const d of sent) {
      expect(d.event_type).toBe('transfer.completed');
      expect(d.event_key).toBe(`transfer.completed:${view.id}:v1`);
      expect(d.channel).toBe('SMS');
      expect(d.recipient_type).toBe('CUSTOMER');
      expect(d.status).toBe('SENT');
      // Rendered message: committed amount + short public reference only.
      expect(d.message).toContain('NGN 120.00');
      expect(d.message).toContain('completed');
      // The template reference guard deliberately rejects 8-hex prefixes carrying >= 6
      // digits (financial-identifier shape) and falls back to the safe default, so the
      // rendered reference is UUID-prefix dependent by design — assert the real contract.
      expect(d.message).toMatch(/Ref (?:[0-9a-f]{8}|your request)\./);
      // Privacy: no journal id, payment reference, request hash, narration prose, or PIN.
      for (const forbidden of [String(view.journalId), 'transfer-ref', String(payload.requestHash),
        'sentinel-narration', '123456', 'integration transfer']) {
        expect(d.message).not.toContain(forbidden);
        expect(JSON.stringify(d.payload)).not.toContain(forbidden);
      }
      expect(JSON.stringify(d.payload)).not.toContain('journalId');
      expect(JSON.stringify(d.payload)).not.toContain('paymentReference');
      expect(JSON.stringify(d.payload)).not.toContain('requestHash');
      // F-01 boundary sanitization on the new Arena 1 processor persistence path:
      // the synthetic harness ref is not an approved local pattern, so only the opaque
      // keyed-HMAC representation may be persisted.
      expect(d.provider_ref).toMatch(/^pvr1:[a-z]+:[0-9a-f]{32}$/);
      expect(d.provider_ref).not.toContain('synthetic-ref');
    }
    // Separate sender/recipient audience semantics: distinct destinations, E.164 convergence.
    expect(provider.sent).toHaveLength(2);
    const destinations = provider.sent.map((s) => s.destination).sort();
    expect(destinations).toEqual(['+2348030000001', '+2348030000002']);

    // --- Replay: re-drain and re-process converge with zero duplication ---
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(0);
    const tick2 = await worker.tick();
    expect(tick2.outboxProcessed).toBe(0);
    expect(await deliveries()).toHaveLength(2);
    expect(await outboxRows('transfer.completed')).toHaveLength(1);
    expect(provider.sent).toHaveLength(2);

    // --- Idempotent producer replay: identical command converges on the same transfer and
    // never double-posts a journal or re-emits/duplicates the outbox event ---
    const replayView = await transfers.createTransfer(command as any);
    expect(replayView.id).toBe(view.id);
    expect(await outboxRows('transfer.completed')).toHaveLength(1);
    expect((await ds.query(`SELECT id FROM ledger_journals WHERE idempotency_key = $1`, [`transfer:${view.id}`])).length).toBe(1);
    expect(await deliveries()).toHaveLength(2);
  }, 120_000);

  it('2. failed transfer: the audited producer emits a v1 transfer.failed event with authoritative recipient identity, only the source audience is notified, no journal exists, failure prose never renders, and replay does not duplicate', async () => {
    const { source, destination } = await seedWalletPair('tr-fail');
    await ds.query(`UPDATE wallet_accounts SET status = 'SUSPENDED' WHERE id = $1`, [destination.walletAccountId]);

    const failure = await transfers.createTransfer({
      sourceWalletId: source.walletAccountId,
      destinationWalletId: destination.walletAccountId,
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey: `tr-${randomUUID()}`,
      reference: 'transfer-ref',
      narration: 'failure-path narration',
    } as any).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(409);
    {
      // capture the machine failure code from the persisted row instead of prose
      const failedRows: Array<{ id: string; failure_code: string }> = await ds.query(
        `SELECT id, failure_code FROM transfers WHERE status = 'FAILED'`);
      expect(failedRows).toHaveLength(1);
      expect(failedRows[0]!.failure_code).toBe('WALLET_NOT_ACTIVE');

      const rows = await outboxRows('transfer.failed');
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.event_key).toBe(`transfer.failed:${failedRows[0]!.id}:v1`);
      expect(row.schema_version).toBe(1);
      expect(row.aggregate_id).toBe(failedRows[0]!.id);
      const payload = row.payload as Record<string, any>;
      expect(payload.sourceCustomerId).toBe(source.customerId);
      expect(payload.destinationCustomerId).toBe(destination.customerId);
      expect(payload.amountMinor).toBe('12000');
      expect(payload.currency).toBe('NGN');
      expect(payload.failureCode).toBe('WALLET_NOT_ACTIVE');
      expect(payload.reference).toMatch(/^[0-9a-f]{8}$/);
      // No journal for a failed transfer; no failure prose in the event.
      expect(payload.journalId).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('Both wallets must be active');

      // Accounting: no value moved.
      const lines: Array<{ ledger_account_id: string }> = await ds.query(
        `SELECT ledger_account_id FROM ledger_lines WHERE ledger_account_id IN ($1, $2)`,
        [source.ledgerAccountId, destination.ledgerAccountId]);
      // (funding seed lines exist only on the funding->wallet journals; the transfer posted none)
      const transferJournals = await ds.query(
        `SELECT id FROM ledger_journals WHERE idempotency_key = $1`, [`transfer:${failedRows[0]!.id}`]);
      expect(transferJournals).toHaveLength(0);
      expect(lines.length).toBe(2); // exactly the two seed funding credits, one per wallet

      const before = await ds.query(
        `SELECT status, attempts, published_at, last_error FROM outbox_events WHERE id = $1`, [row.id]);
      const tick = await worker.tick();
      expect(tick.outboxProcessed).toBe(1);
      const after = await ds.query(
        `SELECT status, attempts, published_at, last_error FROM outbox_events WHERE id = $1`, [row.id]);
      expect(after).toEqual(before);

      const sent = await deliveries();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.recipient_id).toBe(source.customerId); // sender-only audience for failures
      expect(sent[0]!.channel).toBe('SMS');
      expect(sent[0]!.status).toBe('SENT');
      expect(sent[0]!.message).toContain('NGN 120.00');
      expect(sent[0]!.message).toContain('failed');
      expect(sent[0]!.message).not.toContain('Both wallets must be active');
      expect(sent[0]!.message).not.toContain('WALLET_NOT_ACTIVE');
      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]!.destination).toBe('+2348030000001');

      expect(await dispatcher.processPendingOutboxEvents(10)).toBe(0);
      expect(await worker.tick()).toMatchObject({ outboxProcessed: 0 });
      expect(await deliveries()).toHaveLength(1);
    }
  }, 120_000);

  it('3. legacy producer payloads without recipient identity are still quarantined — the consumer never guesses audiences', async () => {
    const transferId = randomUUID();
    await ds.query(
      `INSERT INTO outbox_events
         (id, event_type, event_key, aggregate_type, aggregate_id, payload, status, schema_version, attempts, available_at)
       VALUES ($1, 'transfer.completed', $2, 'TRANSFER', $3, $4::jsonb, 'PENDING', 1, 0, NOW())`,
      [randomUUID(), `transfer.completed:${transferId}:v1`, transferId,
        JSON.stringify({ transferId, journalId: randomUUID(), paymentReference: 'PR-1' })],
    );
    expect(await dispatcher.processPendingOutboxEvents(10)).toBe(1);
    const receipts = await ds.query(
      `SELECT status, reason FROM notification_outbox_receipts WHERE consumer_name = 'notification.v1'`);
    expect(receipts).toEqual([{ status: 'QUARANTINED', reason: 'NO_NOTIFICATION_INTENTS' }]);
    expect(await deliveries()).toHaveLength(0);
    expect(provider.sent).toHaveLength(0);
  }, 60_000);

  it('4. producer event emission is atomic with the financial transaction — an aborted completion leaves no transfer.completed event', async () => {
    const { source, destination } = await seedWalletPair('tr-atomic');
    // Sabotage the outbox enqueue inside the SERIALIZABLE completion transaction: the
    // financial state (transfer row + posted journal) must roll back atomically with the
    // event — no half-committed producer state and nothing for the consumer to see.
    const outbox = (transfers as any).outboxService;
    expect(outbox).toBeDefined();
    const originalEnqueueOnce = outbox.enqueueOnce.bind(outbox);
    outbox.enqueueOnce = async () => {
      throw new Error('SIMULATED_OUTBOX_ENQUEUE_FAILURE');
    };
    try {
      await expect(
        transfers.createTransfer({
          sourceWalletId: source.walletAccountId,
          destinationWalletId: destination.walletAccountId,
          amountMinor: '12000',
          currency: 'NGN',
          idempotencyKey: `tr-${randomUUID()}`,
          reference: 'transfer-ref',
        } as any),
      ).rejects.toBeDefined();
    } finally {
      outbox.enqueueOnce = originalEnqueueOnce;
    }
    // The SERIALIZABLE transaction rolled back: no completed transfer, no journal, no event.
    expect(await outboxRows('transfer.completed')).toHaveLength(0);
    const completed = await ds.query(`SELECT id FROM transfers WHERE status = 'COMPLETED'`);
    expect(completed).toHaveLength(0);
    const journals = await ds.query(
      `SELECT id FROM ledger_journals WHERE idempotency_key LIKE 'transfer:%'`);
    expect(journals).toHaveLength(0);
    const consumerRan = await dispatcher.processPendingOutboxEvents(10);
    expect(consumerRan).toBe(0);
    expect(await deliveries()).toHaveLength(0);
    expect(config).toBeDefined();
  }, 60_000);
});
