import {
  resolveTransactionHistoryLink,
  transactionHistoryLink,
} from '../src/screens/authenticated/transaction-history-link';

const journal = (kind: 'NORMAL' | 'IS_REVERSAL' | 'REVERSED' = 'NORMAL') => ({
  id: '5f0c6f4e-1111-4222-8333-444455556666',
  reversal: { kind },
});

describe('Finance → Transaction History detail-link contract', () => {
  it('uses the published hash format', () => {
    expect(transactionHistoryLink('WALLET_TRANSFER', 'abc-123')).toBe(
      '#transaction-history/WALLET_TRANSFER/abc-123',
    );
  });

  it('links a wallet transfer by transfers.id', () => {
    const resolved = resolveTransactionHistoryLink(
      { type: 'TRANSFER', id: 'transfer-id' },
      journal(),
    );
    expect(resolved).toEqual({
      available: true,
      target: { type: 'WALLET_TRANSFER', id: 'transfer-id' },
    });
  });

  it('links cash-to-cash by the parent cash_to_cash_transfers.id', () => {
    const resolved = resolveTransactionHistoryLink(
      { type: 'CASH_TO_CASH', id: 'c2c-id' },
      journal(),
    );
    expect(resolved.available && resolved.target).toEqual({
      type: 'CASH_TO_CASH',
      id: 'c2c-id',
    });
  });

  it('links cash-in/out by the original posted journal ID, not the deposit id', () => {
    const deposit = resolveTransactionHistoryLink({ type: 'DEPOSIT', id: 'deposit-id' }, journal());
    const withdrawal = resolveTransactionHistoryLink(
      { type: 'WITHDRAWAL', id: 'withdrawal-id' },
      journal('REVERSED'),
    );
    expect(deposit.available && deposit.target).toEqual({
      type: 'CASH_IN',
      id: journal().id,
    });
    expect(withdrawal.available && withdrawal.target).toEqual({
      type: 'CASH_OUT',
      id: journal().id,
    });
  });

  it('never links a reversal journal as the cash-in/out business key', () => {
    const resolved = resolveTransactionHistoryLink(
      { type: 'DEPOSIT', id: 'deposit-id' },
      journal('IS_REVERSAL'),
    );
    expect(resolved.available).toBe(false);
    if (!resolved.available) expect(resolved.reason).toMatch(/reversal journal/i);
  });

  it('reports unavailable for products without a history mapping', () => {
    for (const type of [
      'CUSTOMER_FUNDING',
      'AGENT_FUNDING',
      'INBOUND_FUNDING',
      'CASH_OUT_EXECUTION',
    ]) {
      const resolved = resolveTransactionHistoryLink({ type, id: 'x' }, journal());
      expect(resolved.available).toBe(false);
    }
  });

  it('reports unavailable when no source transaction is linked', () => {
    expect(resolveTransactionHistoryLink(null, journal()).available).toBe(false);
  });
});
