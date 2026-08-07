import type { DataSource } from 'typeorm';

import { TransferStatus } from '../src/transfer/transfer.enums';
import {
  evaluateTransferReconciliation,
  TransferReconciliationService,
} from '../src/reconciliation/transfer-reconciliation.service';
import {
  TransferReconciliationDiscrepancyCode,
  type TransferReconciliationFacts,
  type TransferReconciliationJournalFact,
  type TransferReconciliationLineFact,
  type TransferReconciliationOutboxFact,
  type TransferReconciliationTransferFact,
} from '../src/reconciliation/transfer-reconciliation.types';

const TRANSFER_ID = '00000000-0000-4000-8000-000000000001';
const COMMAND_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_CUSTOMER_ID = '00000000-0000-4000-8000-000000000003';
const DESTINATION_CUSTOMER_ID = '00000000-0000-4000-8000-000000000004';
const SOURCE_WALLET_ID = '00000000-0000-4000-8000-000000000005';
const DESTINATION_WALLET_ID = '00000000-0000-4000-8000-000000000006';
const SOURCE_LEDGER_ID = '00000000-0000-4000-8000-000000000007';
const DESTINATION_LEDGER_ID = '00000000-0000-4000-8000-000000000008';
const JOURNAL_ID = '00000000-0000-4000-8000-000000000009';
const OUTBOX_ID = '00000000-0000-4000-8000-000000000010';
const AUDIT_ID = '00000000-0000-4000-8000-000000000011';
const CORRELATION_ID = 'correlation-transfer-1';
const REQUEST_HASH = 'a'.repeat(64);
const EVENT_KEY = `transfer.completed:${TRANSFER_ID}:v1`;

function makeTransfer(overrides: Partial<TransferReconciliationTransferFact> = {}) {
  return {
    id: TRANSFER_ID,
    commandId: COMMAND_ID,
    status: TransferStatus.COMPLETED,
    sourceCustomerId: SOURCE_CUSTOMER_ID,
    destinationCustomerId: DESTINATION_CUSTOMER_ID,
    sourceWalletAccountId: SOURCE_WALLET_ID,
    destinationWalletAccountId: DESTINATION_WALLET_ID,
    sourceLedgerAccountId: SOURCE_LEDGER_ID,
    destinationLedgerAccountId: DESTINATION_LEDGER_ID,
    amountMinor: '10000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    journalId: JOURNAL_ID,
    requestHash: REQUEST_HASH,
    correlationId: CORRELATION_ID,
    causationId: null,
    ...overrides,
  } satisfies TransferReconciliationTransferFact;
}

function makeJournal(overrides: Partial<TransferReconciliationJournalFact> = {}) {
  return {
    id: JOURNAL_ID,
    idempotencyKey: `transfer:${TRANSFER_ID}:ledger-post`,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    totalMinor: '10000',
    correlationId: CORRELATION_ID,
    transferId: TRANSFER_ID,
    ...overrides,
  } satisfies TransferReconciliationJournalFact;
}

function makeLines(overrides: Partial<TransferReconciliationLineFact>[] = []) {
  const base = [
    {
      id: 'line-1',
      journalId: JOURNAL_ID,
      accountId: SOURCE_LEDGER_ID,
      direction: 'DEBIT' as const,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    },
    {
      id: 'line-2',
      journalId: JOURNAL_ID,
      accountId: DESTINATION_LEDGER_ID,
      direction: 'CREDIT' as const,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    },
  ];
  return base.map((line, index) => ({ ...line, ...(overrides[index] ?? {}) }));
}

function makeOutbox(overrides: Partial<TransferReconciliationOutboxFact> = {}) {
  return {
    id: OUTBOX_ID,
    eventKey: EVENT_KEY,
    eventType: 'transfer.completed',
    schemaVersion: 1,
    aggregateType: 'TRANSFER',
    aggregateId: TRANSFER_ID,
    correlationId: CORRELATION_ID,
    causationId: null,
    payload: {
      eventKey: EVENT_KEY,
      eventType: 'transfer.completed',
      schemaVersion: 1,
      aggregateType: 'TRANSFER',
      aggregateId: TRANSFER_ID,
      transferId: TRANSFER_ID,
      commandId: COMMAND_ID,
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      destinationCustomerId: DESTINATION_CUSTOMER_ID,
      sourceWalletAccountId: SOURCE_WALLET_ID,
      destinationWalletAccountId: DESTINATION_WALLET_ID,
      sourceLedgerAccountId: SOURCE_LEDGER_ID,
      destinationLedgerAccountId: DESTINATION_LEDGER_ID,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      journalId: JOURNAL_ID,
      requestHash: REQUEST_HASH,
    },
    ...overrides,
  } satisfies TransferReconciliationOutboxFact;
}

function makeFacts(
  overrides: Partial<TransferReconciliationFacts> = {},
): TransferReconciliationFacts {
  return {
    transfer: makeTransfer(),
    journal: makeJournal(),
    journalCandidates: [makeJournal()],
    lines: makeLines(),
    outboxEvents: [makeOutbox()],
    auditEvents: [
      {
        id: AUDIT_ID,
        entityType: 'TRANSFER',
        entityId: TRANSFER_ID,
        action: 'LEDGER_POSTED',
        correlationId: CORRELATION_ID,
        newValues: { journalId: JOURNAL_ID },
      },
    ],
    ...overrides,
  };
}

function expectCode(
  facts: TransferReconciliationFacts,
  code: TransferReconciliationDiscrepancyCode,
) {
  const report = evaluateTransferReconciliation(facts);
  expect(report.status).toBe('ERROR');
  expect(report.discrepancies.map((discrepancy) => discrepancy.code)).toContain(code);
  expect(report.readOnly).toBe(true);
  return report;
}

describe('internal transfer reconciliation evaluation', () => {
  it('reports a complete transfer, Ledger, outbox, and audit trace as PASS', () => {
    const report = evaluateTransferReconciliation(makeFacts(), '2026-08-07T12:00:00.000Z');

    expect(report).toMatchObject({
      status: 'PASS',
      readOnly: true,
      generatedAt: '2026-08-07T12:00:00.000Z',
      trace: {
        transferId: TRANSFER_ID,
        journalId: JOURNAL_ID,
        outboxEventIds: [OUTBOX_ID],
        auditEventIds: [AUDIT_ID],
      },
      discrepancies: [],
    });
  });

  it('classifies a completed transfer without a journal', () => {
    expectCode(
      makeFacts({
        transfer: makeTransfer({ journalId: null }),
        journal: null,
        journalCandidates: [],
        lines: [],
      }),
      TransferReconciliationDiscrepancyCode.ORPHAN_TRANSFER,
    );
  });

  it('classifies a missing outbox event', () => {
    expectCode(
      makeFacts({ outboxEvents: [] }),
      TransferReconciliationDiscrepancyCode.MISSING_OUTBOX_EVENT,
    );
  });

  it('classifies an amount mismatch', () => {
    expectCode(
      makeFacts({
        journal: makeJournal({ totalMinor: '9000' }),
        lines: makeLines([{ amountMinor: '9000' }, { amountMinor: '9000' }]),
      }),
      TransferReconciliationDiscrepancyCode.AMOUNT_MISMATCH,
    );
  });

  it('classifies a currency mismatch', () => {
    expectCode(
      makeFacts({
        journal: makeJournal({ currency: 'USD' }),
        lines: makeLines([{ currency: 'USD' }, { currency: 'USD' }]),
      }),
      TransferReconciliationDiscrepancyCode.CURRENCY_MISMATCH,
    );
  });

  it('classifies a source or destination account mismatch', () => {
    const report = expectCode(
      makeFacts({
        lines: makeLines([
          { accountId: '00000000-0000-4000-8000-000000000099' },
          { accountId: '00000000-0000-4000-8000-000000000098' },
        ]),
      }),
      TransferReconciliationDiscrepancyCode.SOURCE_ACCOUNT_MISMATCH,
    );
    expect(report.discrepancies.map((discrepancy) => discrepancy.code)).toContain(
      TransferReconciliationDiscrepancyCode.DESTINATION_ACCOUNT_MISMATCH,
    );
  });

  it('classifies duplicate journal correlation', () => {
    expectCode(
      makeFacts({
        journalCandidates: [
          makeJournal(),
          makeJournal({ id: '00000000-0000-4000-8000-000000000099' }),
        ],
      }),
      TransferReconciliationDiscrepancyCode.DUPLICATE_JOURNAL,
    );
  });

  it('classifies an orphan journal when no transfer exists', () => {
    const report = evaluateTransferReconciliation(makeFacts({ transfer: null, journal: null }));
    expect(report.discrepancies.map((discrepancy) => discrepancy.code)).toEqual(
      expect.arrayContaining([
        TransferReconciliationDiscrepancyCode.TRANSFER_NOT_FOUND,
        TransferReconciliationDiscrepancyCode.ORPHAN_JOURNAL,
      ]),
    );
  });
});

class ReadOnlyReconciliationDataSource {
  readOnly = false;

  transaction<T>(
    _isolation: string,
    callback: (manager: {
      query: (sql: string, parameters?: unknown[]) => Promise<unknown[]>;
    }) => Promise<T>,
  ): Promise<T> {
    const manager = {
      query: async (sql: string): Promise<unknown[]> => {
        await Promise.resolve();
        if (sql.startsWith('SET TRANSACTION READ ONLY')) {
          this.readOnly = true;
          return [];
        }
        if (sql.includes('FROM transfers')) {
          const transfer = makeTransfer();
          return [
            {
              id: transfer.id,
              command_id: transfer.commandId,
              status: transfer.status,
              source_customer_id: transfer.sourceCustomerId,
              destination_customer_id: transfer.destinationCustomerId,
              source_wallet_account_id: transfer.sourceWalletAccountId,
              destination_wallet_account_id: transfer.destinationWalletAccountId,
              source_ledger_account_id: transfer.sourceLedgerAccountId,
              destination_ledger_account_id: transfer.destinationLedgerAccountId,
              amount_minor: transfer.amountMinor,
              currency: transfer.currency,
              accounting_unit: transfer.accountingUnit,
              journal_id: transfer.journalId,
              request_hash: transfer.requestHash,
              correlation_id: transfer.correlationId,
              causation_id: transfer.causationId,
            },
          ];
        }
        if (sql.includes('FROM ledger_journals')) {
          const journal = makeJournal();
          return [
            {
              id: journal.id,
              idempotency_key: journal.idempotencyKey,
              currency: journal.currency,
              accounting_unit: journal.accountingUnit,
              total_minor: journal.totalMinor,
              correlation_id: journal.correlationId,
              transfer_id: journal.transferId,
            },
          ];
        }
        if (sql.includes('FROM ledger_lines')) {
          return makeLines().map((line) => ({
            id: line.id,
            journal_id: line.journalId,
            account_id: line.accountId,
            direction: line.direction,
            amount_minor: line.amountMinor,
            currency: line.currency,
            accounting_unit: line.accountingUnit,
          }));
        }
        if (sql.includes('FROM outbox_events')) {
          const event = makeOutbox();
          return [
            {
              id: event.id,
              event_key: event.eventKey,
              event_type: event.eventType,
              schema_version: event.schemaVersion,
              aggregate_type: event.aggregateType,
              aggregate_id: event.aggregateId,
              correlation_id: event.correlationId,
              causation_id: event.causationId,
              payload: event.payload,
            },
          ];
        }
        if (sql.includes('FROM audit_events')) {
          return [
            {
              id: AUDIT_ID,
              entity_type: 'TRANSFER',
              entity_id: TRANSFER_ID,
              action: 'LEDGER_POSTED',
              correlation_id: CORRELATION_ID,
              new_values: { journalId: JOURNAL_ID },
            },
          ];
        }
        return [];
      },
    };
    return callback(manager);
  }
}

describe('TransferReconciliationService', () => {
  it('uses a repeatable-read read-only transaction and does not expose a write path', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const service = new TransferReconciliationService(dataSource as unknown as DataSource);

    const report = await service.reconcileTransfer(TRANSFER_ID);

    expect(dataSource.readOnly).toBe(true);
    expect(report.status).toBe('PASS');
    expect(report.readOnly).toBe(true);
  });
});
