/**
 * Platform Funds vs. Bank Balance — account classification (pure, no I/O).
 *
 * THE ACCOUNTING CONTRACT (documented in docs/integration/PLATFORM-FUNDS-VS-BANK-MAPPING-01.md)
 *
 * Per (currency, accounting unit), the ledger is a closed double-entry system: every posted
 * journal's debits equal its credits, so
 *
 *     expected_bank = −Σ_{a ≠ selected} net(a)        where net(a) = debits − credits
 *                   =  Σ_{a ≠ selected} (credits − debits)
 *
 * This module classifies every non-selected account in the selected account's universe
 * (UNATTRIBUTED∪PLATFORM books for a platform settlement account; the institution's own books for
 * an institution settlement account) into exactly one breakdown bucket, and reports the other books
 * as a control line that must net to zero — it is exactly zero whenever the institutional guard
 * triggers held, because institutional and platform journals can never mix.
 *
 * Rules that Finance cares about, and how the code keeps them true:
 *
 *  1. A commission already credited to an agent wallet lives in the AGENT_FLOAT line (the wallet
 *     liability) and nowhere else. The accrued-but-unpaid balance is the COMMISSION_PAYABLE family
 *     account. COMMISSION_EXPENSE offsets the expense against either, once.
 *  2. A fee moved from a wallet to platform earnings debits the wallet and credits FEE_REVENUE.
 *     The wallet line falls and the earnings line rises by the same amount; the bank — and the
 *     expected bank balance — does not move. Nothing in this module can change that: the
 *     settlement asset only moves when a journal touches it.
 *  3. An account we cannot classify is never folded into a friendly-looking total. It appears in
 *     the UNMAPPED line with its real balance and a blocker says what Finance must resolve, and
 *     sign-off is blocked until it is.
 */

export type WalletOwnerClass = 'CUSTOMER' | 'AGENT' | 'REVIEW';
export type FamilyRole = 'FEE_REVENUE' | 'VAT_PAYABLE' | 'COMMISSION_EXPENSE' | 'COMMISSION_PAYABLE';

export interface RawAccountRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  scope: string;
  institutionId: string | null;
  institutionalPurpose: string | null;
  /** Raw signed totals as of the cutoff. */
  debits: bigint;
  credits: bigint;
  lineCount: number;
  walletOwnerClass: WalletOwnerClass | null;
  familyRole: FamilyRole | null;
}

export type PlatformFundsBucketKey =
  | 'CUSTOMER_WALLETS'
  | 'AGENT_FLOAT'
  | 'UNPAID_AGENT_COMMISSIONS'
  | 'PLATFORM_EARNINGS_HELD'
  | 'OTHER_HELD'
  | 'SETTLEMENT_CLEARING'
  | 'SECONDARY_SETTLEMENT_ASSETS'
  | 'CONTROL_SUBLEDGER'
  | 'UNMAPPED';

export type PlatformFundsLineKind =
  | 'CUSTOMER_FUNDS'
  | 'AGENT_COMMISSION_ACCRUAL'
  | 'PLATFORM_REVENUE'
  | 'PAYMENT_OBLIGATION'
  | 'UNALLOCATED'
  | 'IN_TRANSIT'
  | 'ASSET'
  | 'CONTROL';

export interface BucketLine {
  key: PlatformFundsBucketKey;
  label: string;
  kind: PlatformFundsLineKind;
  group: string;
  note: string;
  accounts: RawAccountRow[];
  debits: bigint;
  credits: bigint;
  contribution: bigint;
}

export interface AccountAssignment {
  accountId: string;
  accountCode: string;
  bucket: PlatformFundsBucketKey;
  subLine: string;
}

export interface ClassificationResult {
  lines: BucketLine[];
  assignments: AccountAssignment[];
  controlLine: {
    key: 'INSTITUTION_SUBLEDGER_NET_ZERO' | 'PLATFORM_BOOKS_NET_ZERO';
    label: string;
    netContribution: bigint;
    ok: boolean;
    accountCount: number;
  };
  blockers: Array<{ code: string; message: string; needed: string; accountCode?: string | null; accountId?: string | null }>;
  /** Σ of every line contribution INCLUDING unmapped rows. */
  breakdownTotal: bigint;
  /** Σ of every line contribution EXCLUDING unmapped rows. */
  classifiedTotal: bigint;
  mappingComplete: boolean;
  notes: string[];
}

const CODE_PATTERNS: Array<{ pattern: RegExp; subLine: string; bucket: PlatformFundsBucketKey; kind: PlatformFundsLineKind; group: string; label: string; note: string }> = [
  { pattern: /^PAYMENT-SETTLEMENT_CLEARING-/, subLine: 'SETTLEMENT_CLEARING', bucket: 'SETTLEMENT_CLEARING', kind: 'IN_TRANSIT', group: 'SETTLEMENT_CLEARING', label: 'Settlement clearing (in transit)', note: 'Provider settlement clearing: funds in transit, not yet in the bank.' },
  { pattern: /^PAYMENT-SYSTEM_SUSPENSE-/, subLine: 'UNALLOCATED_FUNDS', bucket: 'OTHER_HELD', kind: 'UNALLOCATED', group: 'UNALLOCATED_FUNDS', label: 'Unallocated funds (system suspense)', note: 'Verified inbound funds pending review; not yet attributable.' },
  { pattern: /^PAYMENT-WITHDRAWAL_RESERVE-/, subLine: 'WITHDRAWAL_RESERVE', bucket: 'OTHER_HELD', kind: 'PAYMENT_OBLIGATION', group: 'WITHDRAWAL_RESERVE', label: 'Withdrawals reserved', note: 'Customer withdrawals reserved, awaiting settlement rail completion.' },
  { pattern: /^CASH_TO_CASH-UNCLAIMED-/, subLine: 'UNCLAIMED_TRANSFERS', bucket: 'OTHER_HELD', kind: 'UNALLOCATED', group: 'UNCLAIMED_TRANSFERS', label: 'Unclaimed cash-to-cash transfers', note: 'Cash collected for recipients who have not claimed (legacy platform-wide obligation account).' },
  { pattern: /^C2C-UNCLAIMED-/, subLine: 'UNCLAIMED_TRANSFERS', bucket: 'OTHER_HELD', kind: 'UNALLOCATED', group: 'UNCLAIMED_TRANSFERS', label: 'Unclaimed cash-to-cash transfers', note: 'Cash collected for recipients who have not claimed (institution suspense obligation account).' },
  { pattern: /^AGENT_FUNDING_POOL-/, subLine: 'AGENT_FUNDING_POOL', bucket: 'OTHER_HELD', kind: 'PAYMENT_OBLIGATION', group: 'AGENT_FUNDING_POOL', label: 'Agent funding pool (internal)', note: 'Internal platform funding pool; not a CBN/NIBSS regulatory or bank account.' },
  { pattern: /^FINANCE-ACCOUNTS_RECEIVABLE-/, subLine: 'AR_CONTROL', bucket: 'SECONDARY_SETTLEMENT_ASSETS', kind: 'ASSET', group: 'AR_CONTROL', label: 'Accounts receivable (control)', note: 'Control receivable: owed to MonieNaija but not yet collected; reduces the expected bank.' },
];

/**
 * Classify the universe rows. `controlContribution` is the signed (credits − debits) sum over the
 * *other* books — institution books for a platform settlement account, the platform books for an
 * institution settlement account. It must be exactly zero; see module header.
 */
export function classifyAccounts(input: {
  universe: RawAccountRow[];
  controlContribution: bigint;
  controlAccountCount: number;
  scope: 'PLATFORM' | 'INSTITUTION';
  /** Family roles that could not be resolved to any account (NOT_PROVISIONED notes). */
  unprovisionedFamilies?: FamilyRole[];
}): ClassificationResult {
  const { universe, controlContribution, controlAccountCount, scope } = input;
  const blockers: ClassificationResult['blockers'] = [];
  const notes: string[] = [];

  const lineDefs: Array<{
    key: PlatformFundsBucketKey;
    label: string;
    kind: PlatformFundsLineKind;
    group: string;
    note: string;
  }> = [
    { key: 'CUSTOMER_WALLETS', label: 'Customer wallets', kind: 'CUSTOMER_FUNDS', group: 'CUSTOMER_FUNDS', note: 'Ledger liability of customer-owned wallet accounts.' },
    { key: 'AGENT_FLOAT', label: 'Agent float and commissions already paid into agent wallets', kind: 'CUSTOMER_FUNDS', group: 'AGENT_FUNDS', note: 'Agent wallet liabilities. Commissions already credited to agent wallets are included here exactly once.' },
    { key: 'UNPAID_AGENT_COMMISSIONS', label: 'Unpaid agent commissions', kind: 'AGENT_COMMISSION_ACCRUAL', group: 'AGENT_COMMISSIONS', note: 'Accrued commission payable, not yet settled or netted into an agent wallet.' },
    { key: 'PLATFORM_EARNINGS_HELD', label: 'Platform earnings still held', kind: 'PLATFORM_REVENUE', group: 'PLATFORM_EARNINGS', note: 'Fee revenue recognized but not yet remitted. Accrued commission expense is deducted once.' },
    { key: 'OTHER_HELD', label: 'Other amounts held', kind: 'PAYMENT_OBLIGATION', group: 'OTHER_HELD', note: 'Charges awaiting remittance, unallocated funds and similar obligations held with the bank funds.' },
    { key: 'SETTLEMENT_CLEARING', label: 'Settlement clearing (in transit)', kind: 'IN_TRANSIT', group: 'SETTLEMENT_CLEARING', note: 'Funds in transit through provider settlement clearing; not yet in the bank.' },
    { key: 'SECONDARY_SETTLEMENT_ASSETS', label: 'Other settlement assets and receivables', kind: 'ASSET', group: 'OTHER_ASSETS', note: 'Other asset accounts in the same books; each reduces the expected bank.' },
    { key: 'UNMAPPED', label: 'Unmapped accounts (mapping incomplete)', kind: 'UNALLOCATED', group: 'UNMAPPED', note: 'Accounts with no approved bucket mapping. Sign-off is blocked until Finance resolves them.' },
  ];

  const assignments: AccountAssignment[] = [];
  const lines = new Map<string, BucketLine & { accounts: RawAccountRow[] }>();
  for (const def of lineDefs) {
    lines.set(def.key, {
      key: def.key,
      label: def.label,
      kind: def.kind,
      group: def.group,
      note: def.note,
      accounts: [],
      debits: 0n,
      credits: 0n,
      contribution: 0n,
    });
  }
  const push = (row: RawAccountRow, key: PlatformFundsBucketKey) => {
    const line = lines.get(key)!;
    line.accounts.push(row);
    line.debits += row.debits;
    line.credits += row.credits;
    line.contribution += row.credits - row.debits;
  };

  for (const row of universe) {
    const contribution = row.credits - row.debits;
    let bucket: PlatformFundsBucketKey | null = null;

    let subLine = 'UNMAPPED';
    if (row.walletOwnerClass) {
      if (row.walletOwnerClass === 'CUSTOMER') { bucket = 'CUSTOMER_WALLETS'; subLine = 'CUSTOMER_WALLETS'; }
      else if (row.walletOwnerClass === 'AGENT') { bucket = 'AGENT_FLOAT'; subLine = 'AGENT_FLOAT'; }
      else
        blockers.push({
          code: 'WALLET_OWNER_AMBIGUOUS',
          message: `Wallet-linked ledger account ${row.code} has owner class REVIEW; its owner cannot be attributed to a customer or an agent from the ledger.`,
          needed:
            'Resolve the wallet ownership (governed wallet-ownership resolution) or attribute the wallet to an institution/owner so the liability can be bucketed. Do not sign off while this is unresolved.',
          accountCode: row.code,
          accountId: row.accountId,
        });
    } else if (row.familyRole === 'COMMISSION_PAYABLE') { bucket = 'UNPAID_AGENT_COMMISSIONS'; subLine = 'COMMISSION_PAYABLE'; }
    else if (row.familyRole === 'FEE_REVENUE') { bucket = 'PLATFORM_EARNINGS_HELD'; subLine = 'FEE_REVENUE'; }
    else if (row.familyRole === 'VAT_PAYABLE') { bucket = 'OTHER_HELD'; subLine = 'CHARGES_AWAITING_REMITTANCE'; }
    else if (row.familyRole === 'COMMISSION_EXPENSE') { bucket = 'PLATFORM_EARNINGS_HELD'; subLine = 'COMMISSION_EXPENSE'; }
    else if (row.institutionalPurpose === 'CLEARING') { bucket = 'SETTLEMENT_CLEARING'; subLine = 'SETTLEMENT_CLEARING'; }
    else if (row.institutionalPurpose === 'SUSPENSE') { bucket = 'OTHER_HELD'; subLine = row.code.startsWith('C2C-UNCLAIMED-') || row.code.startsWith('CASH_TO_CASH-UNCLAIMED-') ? 'UNCLAIMED_TRANSFERS' : 'UNALLOCATED_FUNDS'; }
    else if (row.institutionalPurpose === 'SETTLEMENT') { bucket = 'SECONDARY_SETTLEMENT_ASSETS'; subLine = 'OTHER_SETTLEMENT_ASSETS'; }
    else {
      const hit = CODE_PATTERNS.find((entry) => entry.pattern.test(row.code));
      if (hit) { bucket = hit.bucket; subLine = hit.subLine; }
    }

    if (row.scope === 'PLATFORM') {
      // A PLATFORM-designated account (institutional_purpose PLATFORM_OPERATIONS by design) has no
      // approved bucket. Refusing to guess is the control: Finance must classify it.
      bucket = null;
      blockers.push({
        code: 'PLATFORM_ACCOUNT_NOT_CLASSIFIED',
        message: `Platform-designated ledger account ${row.code} (${row.name}) has no bucket mapping in the comparison contract.`,
        needed:
          'Record the approved treatment for this account in the comparison contract (docs/integration/PLATFORM-FUNDS-VS-BANK-MAPPING-01.md) or de-designate it; do not sign off while it is unclassified.',
        accountCode: row.code,
        accountId: row.accountId,
      });
    } else if (bucket === null) {
      blockers.push({
        code: 'ACCOUNT_NOT_MAPPED',
        message: `Ledger account ${row.code} (${row.name}, ${row.accountType} ${row.normalBalance}-normal, scope ${row.scope}${row.institutionalPurpose ? `, purpose ${row.institutionalPurpose}` : ''}) has no bucket mapping in the comparison contract.`,
        needed:
          'Classify this account in the comparison contract (which bucket it belongs to, and why) or close it if it is obsolete. Sign-off is blocked until then.',
        accountCode: row.code,
        accountId: row.accountId,
      });
    } else if (bucket === 'UNMAPPED') {
      // unreachable: patterns never resolve to UNMAPPED directly
      blockers.push({
        code: 'ACCOUNT_NOT_MAPPED',
        message: `Ledger account ${row.code} could not be classified.`,
        needed: 'Classify this account in the comparison contract.',
        accountCode: row.code,
        accountId: row.accountId,
      });
    }

    push(row, bucket ?? 'UNMAPPED');
    void contribution;
    assignments.push({ accountId: row.accountId, accountCode: row.code, bucket: bucket ?? 'UNMAPPED', subLine });
  }

  // ---- control line over the other books -------------------------------------------------
  const controlOk = controlContribution === 0n;
  if (!controlOk) {
    blockers.push({
      code: scope === 'PLATFORM' ? 'INSTITUTION_SUBLEDGER_NOT_CONSERVED' : 'PLATFORM_BOOKS_NOT_CONSERVED',
      message:
        scope === 'PLATFORM'
          ? 'The institution sub-ledgers do not net to zero. Every institutional journal must be internal to its institution; a non-zero net means the institutional guard or the ledger is broken.'
          : 'The platform books (unattributed/platform accounts) do not net to zero. Every platform journal must be internal to the platform books; a non-zero net means the ledger is broken.',
      needed:
        'Run the ledger integrity checks and fix the ledger (governed reversal of the offending journal) before any bank comparison is signed off. Escalate to the Finance Controller and ledger governance.',
    });
  }

  const unprovisioned = input.unprovisionedFamilies ?? [];
  for (const family of unprovisioned) {
    notes.push(
      family === 'VAT_PAYABLE'
        ? 'No VAT payable account is provisioned; charges awaiting remittance are reported as zero. Postings cannot accrue VAT without the account.'
        : family === 'COMMISSION_PAYABLE'
          ? 'No commission payable account is provisioned; accrued unpaid commissions are reported as zero. Postings cannot accrue unpaid commissions without the account.'
          : family === 'FEE_REVENUE'
            ? 'No fee revenue account is provisioned; platform earnings are reported as fee-free. Postings cannot recognize fees without the account.'
            : 'No commission expense account is provisioned; accrued commission deductions are reported as zero.',
    );
  }

  const orderedKeys: PlatformFundsBucketKey[] = [
    'CUSTOMER_WALLETS',
    'AGENT_FLOAT',
    'UNPAID_AGENT_COMMISSIONS',
    'PLATFORM_EARNINGS_HELD',
    'OTHER_HELD',
    'SETTLEMENT_CLEARING',
    'SECONDARY_SETTLEMENT_ASSETS',
    'UNMAPPED',
  ];
  const orderedLines = orderedKeys.map((key) => lines.get(key)!);

  let breakdownTotal = controlContribution;
  let classifiedTotal = controlContribution;
  for (const line of orderedLines) {
    breakdownTotal += line.contribution;
    if (line.key !== 'UNMAPPED') classifiedTotal += line.contribution;
  }

  return {
    lines: orderedLines,
    controlLine: {
      key: scope === 'PLATFORM' ? 'INSTITUTION_SUBLEDGER_NET_ZERO' : 'PLATFORM_BOOKS_NET_ZERO',
      label:
        scope === 'PLATFORM'
          ? 'Institutional sub-ledgers (control: must net to zero)'
          : 'Platform books (control: must net to zero)',
      netContribution: controlContribution,
      ok: controlOk,
      accountCount: controlAccountCount,
    },
    blockers,
    assignments,
    breakdownTotal,
    classifiedTotal,
    mappingComplete: blockers.length === 0,
    notes,
  };
}
