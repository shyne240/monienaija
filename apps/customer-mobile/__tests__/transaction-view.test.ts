import { mapTransactionToRow, type TransferListItem } from '../src/services/transfer-view';

/**
 * V1-CUSTOMER-07 — pure unit coverage for the unified transaction-history
 * view-model. These tests pin down the direction/sign and status-badge
 * mapping for every V1-visible transaction type and lifecycle state
 * returned by `GET /customers/me/transactions`, independent of any screen
 * rendering concerns.
 */
function baseItem(overrides: Partial<TransferListItem>): TransferListItem {
  return {
    id: 'id-1',
    type: 'WALLET_TRANSFER',
    narration: null,
    reference: 'ref-1',
    amountMinor: '10000',
    currency: 'NGN',
    direction: 'UNKNOWN',
    status: 'COMPLETED',
    createdAt: new Date().toISOString(),
    counterparty: null,
    ...overrides,
  };
}

describe('mapTransactionToRow — Wallet to Wallet', () => {
  test('SENT + COMPLETED renders as outgoing/SUCCESS', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'WALLET_TRANSFER', direction: 'SENT', status: 'COMPLETED' }),
    );
    expect(row.sign).toBe('OUT');
    expect(row.status).toBe('SUCCESS');
    expect(row.amountMinor).toBe(10000);
  });

  test('RECEIVED + COMPLETED renders as incoming/SUCCESS with counterparty name', () => {
    const row = mapTransactionToRow(
      baseItem({
        type: 'WALLET_TRANSFER',
        direction: 'RECEIVED',
        status: 'COMPLETED',
        narration: null,
        counterparty: { displayName: 'Jane Doe' },
      }),
    );
    expect(row.sign).toBe('IN');
    expect(row.status).toBe('SUCCESS');
    expect(row.narration).toBe('Received from Jane Doe');
  });

  test('FAILED wallet transfer never renders as SUCCESS', () => {
    const row = mapTransactionToRow(baseItem({ type: 'WALLET_TRANSFER', direction: 'SENT', status: 'FAILED' }));
    expect(row.status).toBe('FAILED');
  });

  test('CANCELLED wallet transfer renders as CANCELLED, not SUCCESS', () => {
    const row = mapTransactionToRow(baseItem({ type: 'WALLET_TRANSFER', direction: 'SENT', status: 'CANCELLED' }));
    expect(row.status).toBe('CANCELLED');
  });

  test('PENDING/PROCESSING wallet transfer renders as PENDING with neutral-safe sign still OUT/IN by direction', () => {
    const pending = mapTransactionToRow(baseItem({ type: 'WALLET_TRANSFER', direction: 'SENT', status: 'PROCESSING' }));
    expect(pending.status).toBe('PENDING');
    expect(pending.sign).toBe('OUT');
  });
});

describe('mapTransactionToRow — Cash to Wallet (CASH_IN) and Wallet to Cash (CASH_OUT)', () => {
  test('CASH_IN (Cash→Wallet) renders as incoming credit, always SUCCESS', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'CASH_IN', direction: 'CREDIT', status: 'COMPLETED', narration: null }),
    );
    expect(row.sign).toBe('IN');
    expect(row.status).toBe('SUCCESS');
    expect(row.narration).toBe('Cash Deposit via Agent');
  });

  test('CASH_OUT (Wallet→Cash) renders as outgoing debit, always SUCCESS', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'CASH_OUT', direction: 'DEBIT', status: 'COMPLETED', narration: null }),
    );
    expect(row.sign).toBe('OUT');
    expect(row.status).toBe('SUCCESS');
    expect(row.narration).toBe('Cash Withdrawal via Agent');
  });
});

describe('mapTransactionToRow — Cash to Cash', () => {
  test('UNCLAIMED (pending) renders neutral sign + PENDING status, never SUCCESS', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'CASH_TO_CASH', direction: 'PENDING', status: 'UNCLAIMED', narration: null }),
    );
    expect(row.sign).toBe('NEUTRAL');
    expect(row.status).toBe('PENDING');
    expect(row.narration).toBe('Cash Transfer Awaiting Claim');
  });

  test('CLAIMED by this customer renders incoming + SUCCESS', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'CASH_TO_CASH', direction: 'RECEIVED', status: 'CLAIMED', narration: null }),
    );
    expect(row.sign).toBe('IN');
    expect(row.status).toBe('SUCCESS');
    expect(row.narration).toBe('Cash Transfer Received (Agent)');
  });

  test('EXPIRED renders neutral sign + EXPIRED status, never SUCCESS and never a silent-fail-as-success', () => {
    const row = mapTransactionToRow(
      baseItem({ type: 'CASH_TO_CASH', direction: 'EXPIRED', status: 'EXPIRED', narration: null }),
    );
    expect(row.sign).toBe('NEUTRAL');
    expect(row.status).toBe('EXPIRED');
    expect(row.narration).toBe('Cash Transfer Expired (Unclaimed)');
  });
});

describe('mapTransactionToRow — Funding', () => {
  test('APPROVED funding renders incoming + SUCCESS', () => {
    const row = mapTransactionToRow(baseItem({ type: 'FUNDING', direction: 'CREDIT', status: 'APPROVED', narration: null }));
    expect(row.sign).toBe('IN');
    expect(row.status).toBe('SUCCESS');
  });

  test('PENDING funding renders neutral sign (no premature credit) + PENDING status', () => {
    const row = mapTransactionToRow(baseItem({ type: 'FUNDING', direction: 'CREDIT', status: 'PENDING', narration: null }));
    expect(row.sign).toBe('NEUTRAL');
    expect(row.status).toBe('PENDING');
  });

  test('REJECTED funding renders neutral sign + FAILED status, never shown as a credit', () => {
    const row = mapTransactionToRow(baseItem({ type: 'FUNDING', direction: 'CREDIT', status: 'REJECTED', narration: null }));
    expect(row.sign).toBe('NEUTRAL');
    expect(row.status).toBe('FAILED');
  });
});

describe('mapTransactionToRow — generic field passthrough', () => {
  test('preserves reference, currency, and amount exactly as supplied', () => {
    const row = mapTransactionToRow(
      baseItem({ reference: 'REF-XYZ-001', currency: 'NGN', amountMinor: '123456' }),
    );
    expect(row.reference).toBe('REF-XYZ-001');
    expect(row.currency).toBe('NGN');
    expect(row.amountMinor).toBe(123456);
  });

  test('uses explicit narration over the computed default label when present', () => {
    const row = mapTransactionToRow(baseItem({ narration: 'Rent contribution' }));
    expect(row.narration).toBe('Rent contribution');
  });
});
