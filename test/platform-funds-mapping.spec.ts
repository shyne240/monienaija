/**
 * Platform Funds vs. Bank Balance — account classification unit tests.
 *
 * The classifier is the control that stands between "the ledger" and "the sign-off": it must bucket
 * every non-selected account exactly once, never fold an unrecognised account into a total, and
 * report the other books as a control line that must net to exactly zero. These tests pin the
 * accounting contract: commission-counted-once, fee-revenue-never-increases-expected-bank, and
 * sign-off blocked on any ambiguous mapping.
 */
import {
  classifyAccounts,
  type RawAccountRow,
  type WalletOwnerClass,
} from '../src/platform-funds/platform-funds-mapping';

function row(overrides: Partial<RawAccountRow> & Pick<RawAccountRow, 'code'>): RawAccountRow {
  return {
    accountId: overrides.accountId ?? `id-${overrides.code}`,
    code: overrides.code,
    name: overrides.name ?? overrides.code,
    accountType: overrides.accountType ?? 'LIABILITY',
    normalBalance: overrides.normalBalance ?? 'CREDIT',
    scope: overrides.scope ?? 'UNATTRIBUTED',
    institutionId: overrides.institutionId ?? null,
    institutionalPurpose: overrides.institutionalPurpose ?? null,
    debits: overrides.debits ?? 0n,
    credits: overrides.credits ?? 0n,
    lineCount: overrides.lineCount ?? 0,
    walletOwnerClass: (overrides.walletOwnerClass ?? null) as WalletOwnerClass | null,
    familyRole: overrides.familyRole ?? null,
  };
}

const DEBIT_NORMAL = { normalBalance: 'DEBIT' as const };

describe('classifyAccounts (platform funds vs bank)', () => {
  it('buckets provisioned accounts into exactly one line each and conserves the books', () => {
    const universe: RawAccountRow[] = [
      // Customer wallet liability: bank holds 1,000,000 (1000.00 in kobo-ish minor units).
      row({ code: 'WALLET-CUSTOMER-1-NGN', debits: 0n, credits: 1_000_000n, walletOwnerClass: 'CUSTOMER', lineCount: 40 }),
      // Agent wallet liability: includes 300,000 of commissions already paid into the wallet.
      row({ code: 'WALLET-AGENT-1-NGN', debits: 0n, credits: 800_000n, walletOwnerClass: 'AGENT', lineCount: 12 }),
      // Accrued, unpaid commissions: 50,000.
      row({ code: 'FINANCE-COMMISSION_PAYABLE-NGN', credits: 50_000n, familyRole: 'COMMISSION_PAYABLE', lineCount: 3 }),
      // Fee revenue recognised but not yet remitted: 120,000 (includes VAT contained in V1 fees?
      // No: VAT is a separate family account; FEE_REVENUE here is the net fee).
      row({ code: 'FINANCE-FEE_REVENUE-NGN', credits: 100_000n, familyRole: 'FEE_REVENUE', lineCount: 9 }),
      row({ code: 'FINANCE-VAT_PAYABLE-NGN', credits: 20_000n, familyRole: 'VAT_PAYABLE', lineCount: 9 }),
      // Commission expense accrued against the earnings: 30,000 (a debit-normal expense).
      row({ code: 'FINANCE-COMMISSION_EXPENSE-NGN', debits: 30_000n, credits: 0n, familyRole: 'COMMISSION_EXPENSE', accountType: 'EXPENSE', ...DEBIT_NORMAL, lineCount: 3 }),
      // System suspense: 15,000 verified inbound pending review.
      row({ code: 'PAYMENT-SYSTEM_SUSPENSE-NGN', credits: 15_000n, lineCount: 1 }),
      // Withdrawal reserve: 40,000.
      row({ code: 'PAYMENT-WITHDRAWAL_RESERVE-NGN', credits: 40_000n, accountType: 'LIABILITY', lineCount: 2 }),
      // Accounts receivable control: 25,000 owed to MonieNaija, not yet collected (debit-normal asset).
      row({ code: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN', debits: 25_000n, credits: 0n, accountType: 'ASSET', ...DEBIT_NORMAL, lineCount: 2 }),
      // Fee payable? Not provisioned — deliberately absent.
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });

    const byKey = new Map(result.lines.map((line) => [line.key, line]));
    expect(byKey.get('CUSTOMER_WALLETS')!.contribution).toBe(1_000_000n);
    expect(byKey.get('AGENT_FLOAT')!.contribution).toBe(800_000n);
    expect(byKey.get('UNPAID_AGENT_COMMISSIONS')!.contribution).toBe(50_000n);
    // Platform earnings: fee revenue MINUS commission expense (accrual deduction), once.
    expect(byKey.get('PLATFORM_EARNINGS_HELD')!.contribution).toBe(100_000n - 30_000n);
    // Other held: VAT payable (charges awaiting remittance) + suspense + withdrawal reserve.
    expect(byKey.get('OTHER_HELD')!.contribution).toBe(20_000n + 15_000n + 40_000n);
    // Receivable reduces the expected bank.
    expect(byKey.get('SECONDARY_SETTLEMENT_ASSETS')!.contribution).toBe(-25_000n);
    expect(result.blockers).toHaveLength(0);
    expect(result.mappingComplete).toBe(true);

    // Conservation: the breakdown must reproduce the expected bank exactly.
    const expectedBank =
      1_000_000n + 800_000n + 50_000n + (100_000n - 30_000n) + (20_000n + 15_000n + 40_000n) - 25_000n;
    expect(result.breakdownTotal).toBe(expectedBank);

    // Every account assigned exactly once.
    expect(result.assignments.map((a) => a.accountId).sort()).toEqual(
      universe.map((u) => u.accountId).sort(),
    );
  });

  it('counts a commission paid into an agent wallet exactly once (never in payable and wallet)', () => {
    const universe = [
      row({ code: 'WALLET-AGENT-9-NGN', credits: 300_000n, walletOwnerClass: 'AGENT' }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    const float = result.lines.find((line) => line.key === 'AGENT_FLOAT')!;
    const payable = result.lines.find((line) => line.key === 'UNPAID_AGENT_COMMISSIONS')!;
    expect(float.contribution).toBe(300_000n);
    expect(payable.contribution).toBe(0n);
    expect(float.contribution).toBeGreaterThan(0n);
  });

  it('moves nothing in the expected bank for a wallet→earnings fee transfer', () => {
    // Journal: debit customer wallet 10,000; credit FEE_REVENUE 10,000 (no bank leg).
    const before = classifyAccounts({
      universe: [
        row({ code: 'WALLET-CUSTOMER-2-NGN', credits: 500_000n, walletOwnerClass: 'CUSTOMER' }),
        row({ code: 'FINANCE-FEE_REVENUE-NGN', credits: 0n, familyRole: 'FEE_REVENUE' }),
      ],
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    const after = classifyAccounts({
      universe: [
        row({ code: 'WALLET-CUSTOMER-2-NGN', credits: 490_000n, walletOwnerClass: 'CUSTOMER' }),
        row({ code: 'FINANCE-FEE_REVENUE-NGN', credits: 10_000n, familyRole: 'FEE_REVENUE' }),
      ],
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    expect(after.breakdownTotal).toBe(before.breakdownTotal);
  });

  it('refuses to fold an unrecognised account into a total and blocks sign-off', () => {
    const universe = [
      row({ code: 'WALLET-CUSTOMER-3-NGN', credits: 100_000n, walletOwnerClass: 'CUSTOMER' }),
      row({ code: 'MYSTERY-LEDGER-NGN', accountType: 'LIABILITY', credits: 42_000n }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    const unmapped = result.lines.find((line) => line.key === 'UNMAPPED')!;
    expect(unmapped.contribution).toBe(42_000n);
    expect(result.blockers.some((b) => b.code === 'ACCOUNT_NOT_MAPPED')).toBe(true);
    expect(result.mappingComplete).toBe(false);
    expect(result.assignments.find((a) => a.accountCode === 'MYSTERY-LEDGER-NGN')!.bucket).toBe('UNMAPPED');
  });

  it('blocks sign-off on a PLATFORM-designated account with no approved mapping', () => {
    const universe = [
      row({
        code: 'PLATFORM-OPS-NGN',
        scope: 'PLATFORM',
        institutionalPurpose: 'PLATFORM_OPERATIONS',
        credits: 7_000n,
      }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    expect(result.blockers.some((b) => b.code === 'PLATFORM_ACCOUNT_NOT_CLASSIFIED')).toBe(true);
    expect(result.mappingComplete).toBe(false);
    expect(result.assignments[0]?.bucket).toBe('UNMAPPED');
  });

  it('blocks sign-off on an ambiguous wallet owner (REVIEW)', () => {
    const universe = [
      row({ code: 'WALLET-REVIEW-1-NGN', credits: 60_000n, walletOwnerClass: 'REVIEW' }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
    });
    expect(result.blockers.some((b) => b.code === 'WALLET_OWNER_AMBIGUOUS')).toBe(true);
    expect(result.mappingComplete).toBe(false);
  });

  it('blocks sign-off when the other books do not conserve to zero (control line)', () => {
    const universe = [
      row({ code: 'WALLET-CUSTOMER-4-NGN', credits: 100_000n, walletOwnerClass: 'CUSTOMER' }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 5_000n,
      controlAccountCount: 3,
      scope: 'PLATFORM',
    });
    expect(result.controlLine.ok).toBe(false);
    expect(result.controlLine.netContribution).toBe(5_000n);
    expect(result.blockers.some((b) => b.code === 'INSTITUTION_SUBLEDGER_NOT_CONSERVED')).toBe(true);
    expect(result.mappingComplete).toBe(false);
    // The control failure is carried inside the conservation total (the books really are broken).
    expect(result.breakdownTotal).toBe(105_000n);
  });

  it('uses the platform-books control for institution comparisons', () => {
    const result = classifyAccounts({
      universe: [],
      controlContribution: 0n,
      controlAccountCount: 2,
      scope: 'INSTITUTION',
    });
    expect(result.controlLine.key).toBe('PLATFORM_BOOKS_NET_ZERO');
    expect(result.mappingComplete).toBe(true);
  });

  it('classifies institution clearing/suspense accounts into transit and unallocated buckets', () => {
    const universe = [
      row({
        code: 'INST-CLEARING-NGN',
        scope: 'INSTITUTION',
        institutionId: 'inst-1',
        institutionalPurpose: 'CLEARING',
        credits: 90_000n,
      }),
      row({
        code: 'C2C-UNCLAIMED-NGN',
        scope: 'INSTITUTION',
        institutionId: 'inst-1',
        institutionalPurpose: 'SUSPENSE',
        credits: 12_000n,
      }),
      row({
        code: 'INST-SETTLEMENT-NGN',
        scope: 'INSTITUTION',
        institutionId: 'inst-1',
        institutionalPurpose: 'SETTLEMENT',
        debits: 200_000n,
        ...DEBIT_NORMAL,
        accountType: 'ASSET',
      }),
    ];
    const result = classifyAccounts({
      universe,
      controlContribution: 0n,
      controlAccountCount: 1,
      scope: 'INSTITUTION',
    });
    const byKey = new Map(result.lines.map((line) => [line.key, line]));
    expect(byKey.get('SETTLEMENT_CLEARING')!.contribution).toBe(90_000n);
    expect(byKey.get('OTHER_HELD')!.contribution).toBe(12_000n);
    expect(byKey.get('SECONDARY_SETTLEMENT_ASSETS')!.contribution).toBe(-200_000n);
    expect(result.mappingComplete).toBe(true);
  });

  it('emits notes (not blockers) for unprovisioned commercial families', () => {
    const result = classifyAccounts({
      universe: [],
      controlContribution: 0n,
      controlAccountCount: 0,
      scope: 'PLATFORM',
      unprovisionedFamilies: ['VAT_PAYABLE', 'COMMISSION_PAYABLE'],
    });
    expect(result.notes.some((note) => note.includes('VAT'))).toBe(true);
    expect(result.notes.some((note) => note.includes('commission'))).toBe(true);
    expect(result.mappingComplete).toBe(true);
  });
});
