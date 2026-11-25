/**
 * Platform Funds vs. Bank Balance — the withdrawal payout lifecycle, proved against real posted
 * journal shapes.
 *
 * Journals below are the exact shapes the real posting boundaries produce
 * (src/ledger/ledger.service.ts):
 *
 *   RESERVE  (postWithdrawalReservationInTransaction): DR customer wallet / CR PAYMENT-WITHDRAWAL_RESERVE-NGN
 *   SETTLE   (postWithdrawalSettlementInTransaction):   DR PAYMENT-WITHDRAWAL_RESERVE-NGN / CR PAYMENT-SETTLEMENT_ASSET-NGN
 *   RELEASE  (postWithdrawalReleaseInTransaction):      reversal of the reservation: DR reserve / CR customer wallet
 *
 * Every test drives a tiny in-memory ledger that only accepts BALANCED journals, accumulates raw
 * per-account debit/credit totals (the same source columns the service reads), and classifies the
 * resulting rows with the exact function the comparison screen consumes. Because the books are
 * conserved by construction, `breakdownTotal === expected(S)` must hold exactly at every step.
 *
 *   1. Reserving a payout leaves the expected bank balance UNCHANGED.
 *   2. Settling it reduces the expected bank balance exactly ONCE.
 *   3. Releasing it restores the wallet liability and records NO bank outflow.
 *   4. Commission already credited to an agent wallet is never counted twice.
 *   5. A fee recognised out of a customer wallet never increases expected bank cash.
 *
 * What this suite does NOT prove (and cannot): a duplicated bank payout would keep the ledger
 * conserved too — the control there is the RESERVED-commitment binding in the settlement domain,
 * not this comparison. Library evidence: postWithdrawalSettlementInTransaction locks the
 * RESERVED commitment and requires the governed reversal compliance of the source account.
 *
 * Airtime and bill payment flows are out of scope for this work and are deliberately absent.
 */
import {
  classifyAccounts,
  type FamilyRole,
  type RawAccountRow,
  type WalletOwnerClass,
} from '../src/platform-funds/platform-funds-mapping';

type AccountKey =
  | 'settlement'
  | 'walletCustomer'
  | 'walletAgent'
  | 'commissionPayable'
  | 'commissionExpense'
  | 'feeRevenue'
  | 'withdrawalReserve';

type Direction = 'DEBIT' | 'CREDIT';
interface AccountDef {
  code: string;
  name: string;
  accountType: string;
  normalBalance: Direction;
  walletOwnerClass: WalletOwnerClass | null;
  familyRole: FamilyRole | null;
}

const ACCOUNTS: Record<AccountKey, AccountDef> = {
  settlement: {
    code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
    name: 'Payment Settlement Asset NGN',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    walletOwnerClass: null,
    familyRole: null,
  },
  walletCustomer: {
    code: 'WALLET-CUSTOMER-001-NGN',
    name: 'Customer wallet liability',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    walletOwnerClass: 'CUSTOMER',
    familyRole: null,
  },
  walletAgent: {
    code: 'WALLET-AGENT-001-NGN',
    name: 'Agent wallet liability',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    walletOwnerClass: 'AGENT',
    familyRole: null,
  },
  commissionPayable: {
    code: 'FINANCE-COMMISSION_PAYABLE-NGN',
    name: 'Finance Commission Payable NGN',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    walletOwnerClass: null,
    familyRole: 'COMMISSION_PAYABLE',
  },
  commissionExpense: {
    code: 'FINANCE-COMMISSION_EXPENSE-NGN',
    name: 'Finance Commission Expense NGN',
    accountType: 'EXPENSE',
    normalBalance: 'DEBIT',
    walletOwnerClass: null,
    familyRole: 'COMMISSION_EXPENSE',
  },
  feeRevenue: {
    code: 'FINANCE-FEE_REVENUE-NGN',
    name: 'Finance Fee Revenue NGN (pooled)',
    accountType: 'REVENUE',
    normalBalance: 'CREDIT',
    walletOwnerClass: null,
    familyRole: 'FEE_REVENUE',
  },
  withdrawalReserve: {
    code: 'PAYMENT-WITHDRAWAL_RESERVE-NGN',
    name: 'Payment Withdrawal Reserve NGN',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    walletOwnerClass: null,
    familyRole: null,
  },
};

class TinyLedger {
  private totals = new Map<AccountKey, { debits: bigint; credits: bigint; lines: number }>();

  post(legs: ReadonlyArray<readonly [AccountKey, Direction, bigint]>): void {
    const debits = legs
      .filter(([, d]) => d === 'DEBIT')
      .reduce((sum, [, , amount]) => sum + amount, 0n);
    const credits = legs
      .filter(([, d]) => d === 'CREDIT')
      .reduce((sum, [, , amount]) => sum + amount, 0n);
    if (debits !== credits) {
      throw new Error(`unbalanced journal refused: debits ${debits} !== credits ${credits}`);
    }
    for (const [key, direction, amount] of legs) {
      const totals = this.totals.get(key) ?? { debits: 0n, credits: 0n, lines: 0 };
      if (direction === 'DEBIT') totals.debits += amount;
      else totals.credits += amount;
      totals.lines += 1;
      this.totals.set(key, totals);
    }
  }

  snapshot(): RawAccountRow[] {
    return (Object.keys(ACCOUNTS) as AccountKey[])
      .filter((key) => this.totals.has(key))
      .map((key) => {
        const def = ACCOUNTS[key]!;
        const totals = this.totals.get(key)!;
        return {
          accountId: `acct-${key}`,
          code: def.code,
          name: def.name,
          accountType: def.accountType,
          normalBalance: def.normalBalance,
          scope: 'UNATTRIBUTED',
          institutionId: null,
          institutionalPurpose: null,
          debits: totals.debits,
          credits: totals.credits,
          lineCount: totals.lines,
          walletOwnerClass: def.walletOwnerClass,
          familyRole: def.familyRole,
        };
      });
  }

  /** Ledger expected balance of the selected settlement asset. */
  expectedBank(): bigint {
    const totals = this.totals.get('settlement');
    return (totals?.debits ?? 0n) - (totals?.credits ?? 0n);
  }
}

const classify = (ledger: TinyLedger) =>
  classifyAccounts({
    universe: ledger.snapshot().filter((row) => row.code !== 'PAYMENT-SETTLEMENT_ASSET-NGN'),
    controlContribution: 0n,
    controlAccountCount: 0,
    scope: 'PLATFORM',
  });

const contributionOf = (
  result: ReturnType<typeof classify>,
  key: string,
): bigint => result.lines.find((line) => line.key === key)!.contribution;

/** A realistic, conserved opening book built from the journals that fund it. */
const fundedLedger = (): TinyLedger => {
  const ledger = new TinyLedger();
  ledger.post([
    ['settlement', 'DEBIT', 600_000n],
    ['walletCustomer', 'CREDIT', 600_000n],
  ]); // customer cash-in
  ledger.post([
    ['settlement', 'DEBIT', 300_000n],
    ['walletAgent', 'CREDIT', 300_000n],
  ]); // agent funding
  ledger.post([
    ['commissionExpense', 'DEBIT', 150_000n],
    ['commissionPayable', 'CREDIT', 150_000n],
  ]); // accrual: unpaid agent commissions
  ledger.post([
    ['walletCustomer', 'DEBIT', 10_000n],
    ['feeRevenue', 'CREDIT', 10_000n],
  ]); // fee recognised out of a customer wallet
  return ledger;
};

const agentValueOnce = (result: ReturnType<typeof classify>) => ({
  agentFloat: contributionOf(result, 'AGENT_FLOAT'),
  unpaid: contributionOf(result, 'UNPAID_AGENT_COMMISSIONS'),
});

describe('Withdrawal payout lifecycle — expected bank balance', () => {
  it('opening books conserve exactly (sanity)', () => {
    const ledger = fundedLedger();
    const result = classify(ledger);
    expect(result.mappingComplete).toBe(true);
    expect(result.controlLine.ok).toBe(true);
    expect(result.breakdownTotal).toBe(ledger.expectedBank());
    expect(ledger.expectedBank()).toBe(900_000n);
  });

  it('case 1: reserving a payout leaves expected bank cash unchanged', () => {
    const ledger = fundedLedger();
    const before = ledger.expectedBank();
    ledger.post([
      ['walletCustomer', 'DEBIT', 250_000n],
      ['withdrawalReserve', 'CREDIT', 250_000n],
    ]); // RESERVE: no settlement-asset leg

    expect(ledger.expectedBank()).toBe(before);
    const result = classify(ledger);
    expect(result.breakdownTotal).toBe(ledger.expectedBank());
    expect(contributionOf(result, 'CUSTOMER_WALLETS')).toBe(340_000n); // 600,000 − 10,000 fee − 250,000 reserve
    expect(contributionOf(result, 'OTHER_HELD')).toBe(250_000n); // the reserved obligation
    expect(result.mappingComplete).toBe(true);
  });

  it('case 2: settling a reserved payout reduces expected bank cash exactly once', () => {
    const ledger = fundedLedger();
    ledger.post([
      ['walletCustomer', 'DEBIT', 250_000n],
      ['withdrawalReserve', 'CREDIT', 250_000n],
    ]); // RESERVE
    const before = ledger.expectedBank();

    ledger.post([
      ['withdrawalReserve', 'DEBIT', 250_000n],
      ['settlement', 'CREDIT', 250_000n],
    ]); // SETTLE: the bank pays out

    expect(ledger.expectedBank()).toBe(before - 250_000n);
    expect(ledger.expectedBank()).toBe(650_000n);

    const result = classify(ledger);
    expect(result.breakdownTotal).toBe(ledger.expectedBank());
    expect(contributionOf(result, 'OTHER_HELD')).toBe(0n); // reserve consumed exactly once
    expect(result.mappingComplete).toBe(true);
  });

  it('case 3: releasing a reserved payout restores the wallet and records no bank outflow', () => {
    const ledger = fundedLedger();
    const before = ledger.expectedBank();
    ledger.post([
      ['walletCustomer', 'DEBIT', 250_000n],
      ['withdrawalReserve', 'CREDIT', 250_000n],
    ]); // RESERVE

    ledger.post([
      ['withdrawalReserve', 'DEBIT', 250_000n],
      ['walletCustomer', 'CREDIT', 250_000n],
    ]); // RELEASE: exact inversion of the reservation, no settlement-asset leg

    expect(ledger.expectedBank()).toBe(before);
    const result = classify(ledger);
    expect(result.breakdownTotal).toBe(ledger.expectedBank());
    expect(contributionOf(result, 'CUSTOMER_WALLETS')).toBe(590_000n); // fully restored (600,000 − 10,000 fee)
    expect(contributionOf(result, 'OTHER_HELD')).toBe(0n); // reserve back to base
    expect(result.mappingComplete).toBe(true);
  });

  it('commission already credited to an agent wallet is never counted twice', () => {
    const ledger = fundedLedger();
    expect(agentValueOnce(classify(ledger))).toEqual({
      agentFloat: 300_000n,
      unpaid: 150_000n,
    });

    // Settle 100,000 of accrued commission into the agent wallet (payable → wallet).
    ledger.post([
      ['commissionPayable', 'DEBIT', 100_000n],
      ['walletAgent', 'CREDIT', 100_000n],
    ]);
    const afterCredit = classify(ledger);
    expect(afterCredit.breakdownTotal).toBe(ledger.expectedBank());
    expect(agentValueOnce(afterCredit)).toEqual({
      agentFloat: 400_000n, // paid value now lives in the wallet
      unpaid: 50_000n, // the unsettled remainder
    });
    // Total agent-attributable value is preserved, never doubled:
    expect(400_000n + 50_000n).toBe(300_000n + 150_000n);

    // And a payout of the agent float does not resurrect the payable bucket:
    ledger.post([
      ['walletAgent', 'DEBIT', 400_000n],
      ['withdrawalReserve', 'CREDIT', 400_000n],
    ]);
    ledger.post([
      ['withdrawalReserve', 'DEBIT', 400_000n],
      ['settlement', 'CREDIT', 400_000n],
    ]);
    const afterPayout = classify(ledger);
    expect(agentValueOnce(afterPayout)).toEqual({ agentFloat: 0n, unpaid: 50_000n });
    expect(ledger.expectedBank()).toBe(500_000n); // 900,000 − 400,000 paid out
    expect(afterPayout.breakdownTotal).toBe(ledger.expectedBank());
  });

  it('a fee recognised from a customer wallet never increases expected bank cash', () => {
    const ledger = fundedLedger();
    const before = ledger.expectedBank();
    ledger.post([
      ['walletCustomer', 'DEBIT', 25_000n],
      ['feeRevenue', 'CREDIT', 25_000n],
    ]); // FEE: wallet → earnings, no bank leg
    expect(ledger.expectedBank()).toBe(before);
    const result = classify(ledger);
    expect(result.breakdownTotal).toBe(before);
    // PLATFORM_EARNINGS_HELD = fee revenue (35,000) minus commission expense accrued (150,000).
    expect(contributionOf(result, 'PLATFORM_EARNINGS_HELD')).toBe(35_000n - 150_000n);
  });
});
