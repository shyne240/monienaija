/**
 * Governed wallet ownership resolution vocabulary.
 *
 * `REVIEW` is the fail-closed classification produced by migration `1785753600116` for every
 * historical owner reference that is not an unambiguous canonical customer or agent UUID. It is
 * never a target: a wallet may only move out of `REVIEW` through a consumed maker-checker
 * approval bound to server-verified evidence (migration `1785753600118`).
 */
export enum WalletOwnerClass {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  REVIEW = 'REVIEW',
  /** Platform custody: a registered `wallet_system_owners` designation, never a financial lane. */
  SYSTEM = 'SYSTEM',
}

/** The classes a `REVIEW` wallet may be resolved to. `REVIEW` is deliberately absent. */
export enum WalletOwnershipResolutionClass {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
}

/**
 * Evidence types a governed resolution may cite. Every type is verified server-side against
 * authoritative rows; nothing the caller asserts is trusted.
 *
 *  - `CUSTOMER_RECORD_REFERENCE`: the target customer record exists, is not synthetic/deleted,
 *    and its own `reference` equals the cited reference.
 *  - `CUSTOMER_FINANCIAL_ACCOUNT_BINDING`: an ACTIVE `customer_financial_account_bindings` row
 *    binds this exact wallet account + ledger account to the target customer, and its id is cited.
 *  - `AGENT_RECORD_REFERENCE`: the target agent record exists, is not deleted, and its own
 *    `reference` equals the cited reference.
 *  - `ZERO_LEDGER_ACTIVITY`: the wallet's ledger account has no posted lines at all.
 *  - `ZERO_LEDGER_BALANCE`: the wallet's ledger account nets to zero across all posted lines.
 *
 * The two SYSTEM evidence types are the only sanctioned proof that a wallet holds no customer or
 * agent money, which is why SYSTEM custody can never be used to move value.
 */
export enum WalletOwnershipEvidenceType {
  CUSTOMER_RECORD_REFERENCE = 'CUSTOMER_RECORD_REFERENCE',
  CUSTOMER_FINANCIAL_ACCOUNT_BINDING = 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
  AGENT_RECORD_REFERENCE = 'AGENT_RECORD_REFERENCE',
  ZERO_LEDGER_ACTIVITY = 'ZERO_LEDGER_ACTIVITY',
  ZERO_LEDGER_BALANCE = 'ZERO_LEDGER_BALANCE',
}

/** Evidence type -> resolution classes it is allowed to support (mirrors the DB check). */
export const WALLET_OWNERSHIP_EVIDENCE_MATRIX: Readonly<
  Record<WalletOwnershipEvidenceType, readonly WalletOwnershipResolutionClass[]>
> = {
  [WalletOwnershipEvidenceType.CUSTOMER_RECORD_REFERENCE]: [
    WalletOwnershipResolutionClass.CUSTOMER,
  ],
  [WalletOwnershipEvidenceType.CUSTOMER_FINANCIAL_ACCOUNT_BINDING]: [
    WalletOwnershipResolutionClass.CUSTOMER,
  ],
  [WalletOwnershipEvidenceType.AGENT_RECORD_REFERENCE]: [WalletOwnershipResolutionClass.AGENT],
  [WalletOwnershipEvidenceType.ZERO_LEDGER_ACTIVITY]: [WalletOwnershipResolutionClass.SYSTEM],
  [WalletOwnershipEvidenceType.ZERO_LEDGER_BALANCE]: [WalletOwnershipResolutionClass.SYSTEM],
};

/**
 * Why an administrative reconciliation item is still unresolved. Derived server-side from the
 * authoritative rows — never supplied by a caller.
 */
export enum WalletOwnershipReviewReason {
  NON_CANONICAL_REFERENCE = 'NON_CANONICAL_REFERENCE',
  AMBIGUOUS_CUSTOMER_AND_AGENT = 'AMBIGUOUS_CUSTOMER_AND_AGENT',
  NO_AUTHORITATIVE_OWNER = 'NO_AUTHORITATIVE_OWNER',
  UNRESOLVED = 'UNRESOLVED',
}
