import {
  majorToMinor,
  monnifyAdapter,
  registerAdapter,
  registeredAdapters,
} from '../src/services/settlement-preview/monnify-adapter';
import { reconcilePreview } from '../src/services/settlement-preview/matching';
import {
  parseInternalSnapshot,
  parseStatementSnapshot,
} from '../src/services/settlement-preview/internal-snapshot';
import {
  SYNTHETIC_COLLECTIONS,
  SYNTHETIC_INTERNAL_SNAPSHOT,
  SYNTHETIC_PAYOUTS,
  SYNTHETIC_SETTLEMENTS,
  SYNTHETIC_STATEMENT,
} from '../src/services/settlement-preview/synthetic-fixtures';
import type { ProviderAdapter } from '../src/services/settlement-preview/types';

describe('Monnify report adapter and shared matching workflow', () => {
  test('normalises documented collection fields including provider reference and NIP session ID', () => {
    const parsed = monnifyAdapter.parse('collections.json', SYNTHETIC_COLLECTIONS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe('COLLECTIONS');
    expect(parsed.format).toBe('WEBHOOK_EVENT_JSON');
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row.providerTransactionReference).toBe('MNFY|DEMO|20261125101500|000001');
    expect(row.merchantReference).toBe('B2W-DEMO-0001');
    expect(row.nipSessionId).toBe('NIPDEMO0001');
    expect(row.nipSessionIdSource).toBe('paymentSourceInformation[].sessionId');
    expect(row.amountMinor).toBe('1250000');
    expect(row.settlementAmountMinor).toBe('1245000');
    expect(row.status).toBe('PAID');
    expect(row.observedColumns).toContain('paymentSourceInformation[].sessionId');
    expect(row.observedColumns).toContain('transactionReference');
  });

  test('keeps settlement net rows separate from embedded collection rows', () => {
    const parsed = monnifyAdapter.parse('settlement.json', SYNTHETIC_SETTLEMENTS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe('SETTLEMENTS');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].settlementReference).toBe('SETDEMO0001');
    expect(parsed.rows[0].amountMinor).toBe('2580000');
    expect(parsed.rows[0].settlementDestination?.accountNumber).toBe('9000001234');
    expect(parsed.embeddedCollections).toHaveLength(3);
    expect(parsed.embeddedCollections.every((row) => row.settlementReference === 'SETDEMO0001')).toBe(true);
  });

  test('normalises documented payout fields including sessionId and status', () => {
    const parsed = monnifyAdapter.parse('payouts.json', SYNTHETIC_PAYOUTS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe('PAYOUTS');
    expect(parsed.rows[0].providerTransactionReference).toBe('MFDS|DEMO|20261125113000|000001');
    expect(parsed.rows[0].merchantReference).toBe('PAYDEMO0001');
    expect(parsed.rows[0].nipSessionId).toBe('NIPPAY0001');
    expect(parsed.rows[0].status).toBe('SUCCESS');
    expect(parsed.rows[0].feeMinor).toBe('2500');
  });

  test('converts documented major-unit amounts to integer minor units', () => {
    expect(majorToMinor('1,234.56')).toBe('123456');
    expect(majorToMinor(12500)).toBe('1250000');
    expect(majorToMinor('not-an-amount')).toBeUndefined();
  });

  test('refuses CSV without a redacted sample and names the exact export', () => {
    const result = monnifyAdapter.parse(
      'settlement.csv',
      'settlementReference,amount,date\nABC,100.00,2026-11-25\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNVERIFIED_CSV_FORMAT');
    expect(result.exactExportNeeded).toContain('Settlement → Export Settlements');
    expect(result.exactExportNeeded).toContain('Transactions → Export CSV');
    expect(result.exactExportNeeded).toContain('Transfers → Export CSV');
  });

  test('shared matcher reports matched, mismatch, ambiguous, duplicate and unmatched rows', () => {
    const collections = monnifyAdapter.parse('collections.json', SYNTHETIC_COLLECTIONS);
    const duplicate = monnifyAdapter.parse('collections-copy.json', SYNTHETIC_COLLECTIONS);
    const settlements = monnifyAdapter.parse('settlement.json', SYNTHETIC_SETTLEMENTS);
    expect(collections.ok && duplicate.ok && settlements.ok).toBe(true);
    if (!collections.ok || !duplicate.ok || !settlements.ok) return;
    const internal = parseInternalSnapshot(SYNTHETIC_INTERNAL_SNAPSHOT);
    const statement = parseStatementSnapshot(SYNTHETIC_STATEMENT);
    expect(internal.ok && statement.ok).toBe(true);
    if (!internal.ok || !statement.ok) return;

    const result = reconcilePreview({
      rows: [
        ...collections.rows,
        ...duplicate.rows,
        ...settlements.rows,
        // Embedded rows are supplied by a settlement document; two of them exercise
        // mismatch and ambiguity against the same internal snapshot.
        settlements.embeddedCollections[1],
        settlements.embeddedCollections[2],
      ],
      internalRecords: internal.records,
      statementEntries: statement.entries,
      generatedAt: '2026-11-26T00:00:00.000Z',
    });

    const outcomes = result.transactions.map((match) => match.outcome);
    expect(outcomes).toContain('MATCHED');
    expect(outcomes).toContain('MISMATCH');
    expect(outcomes).toContain('AMBIGUOUS');
    expect(outcomes).toContain('DUPLICATE_UPLOAD');
    expect(result.summary.reconciliationEstablished).toBe(false);
    expect(result.transactions.every((match) => match.settlementEstablished === false)).toBe(true);
    expect(result.reviewQueue.length).toBeGreaterThan(0);
    const mismatch = result.transactions.find((match) => match.outcome === 'MISMATCH');
    expect(mismatch?.reasons.join(' ')).toContain('Amount mismatch');
    const ambiguous = result.transactions.find((match) => match.outcome === 'AMBIGUOUS');
    expect(ambiguous?.candidates.length).toBeGreaterThan(1);
  });

  test('matches a net settlement to the statement destination independently of transaction rows', () => {
    const settlements = monnifyAdapter.parse('settlement.json', SYNTHETIC_SETTLEMENTS);
    expect(settlements.ok).toBe(true);
    if (!settlements.ok) return;
    const statement = parseStatementSnapshot(SYNTHETIC_STATEMENT);
    expect(statement.ok).toBe(true);
    if (!statement.ok) return;

    const withStatement = reconcilePreview({
      rows: settlements.rows,
      embeddedCollections: settlements.embeddedCollections,
      internalRecords: [],
      statementEntries: statement.entries,
      generatedAt: '2026-11-26T00:00:00.000Z',
    });
    expect(withStatement.settlements[0].outcome).toBe('MATCHED');
    expect(withStatement.settlements[0].keyUsed).toBe('SETTLEMENT_REFERENCE');
    expect(withStatement.settlements[0].expectedNetMinor).toBe('2580000');

    // Internal records can be perfect without supplying a statement: settlement is NOT_PERFORMED.
    const withoutStatement = reconcilePreview({
      rows: [...settlements.rows, ...settlements.embeddedCollections],
      internalRecords: [
        {
          id: 'internal-1',
          providerTransactionReference: 'MNFY|DEMO|20261125101500|000001',
          amountMinor: '1250000',
          currency: 'NGN',
          status: 'CREDITED',
          type: 'BANK_TO_WALLET',
        },
      ],
      statementEntries: [],
      generatedAt: '2026-11-26T00:00:00.000Z',
    });
    expect(
      withoutStatement.transactions.find(
        (match) => match.row.providerTransactionReference === 'MNFY|DEMO|20261125101500|000001',
      )?.outcome,
    ).toBe('MATCHED');
    expect(withoutStatement.settlements[0].outcome).toBe('NOT_PERFORMED');
    expect(withoutStatement.summary.reconciliationEstablished).toBe(false);
  });

  test('a future NIBSS adapter can be registered without changing the matcher', () => {
    const nibssAdapter: ProviderAdapter = {
      provider: 'NIBSS',
      label: 'NIBSS test adapter',
      confirmedFormats: ['test'],
      parse: () => ({
        ok: false,
        code: 'UNSUPPORTED_FORMAT',
        message: 'NIBSS format not supplied in this branch',
      }),
    };
    registerAdapter(nibssAdapter);
    expect(registeredAdapters().map((adapter) => adapter.provider)).toContain('NIBSS');
    expect(monnifyAdapter.provider).toBe('MONNIFY');
    const result = reconcilePreview({
      rows: [],
      internalRecords: [],
      statementEntries: [],
      generatedAt: '2026-11-26T00:00:00.000Z',
    });
    expect(result.summary.reconciliationEstablished).toBe(false);
    expect(result.settlements[0].outcome).toBe('NOT_PERFORMED');
  });
});
