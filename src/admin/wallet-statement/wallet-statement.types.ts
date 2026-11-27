/**
 * Branded customer wallet statement — data contracts.
 *
 * Every field here is either authoritative ledger data or an explicit statement that authoritative
 * data was unavailable. There is deliberately no `0` default anywhere in this file: a balance the
 * ledger cannot support is `null`, and `null` renders as "Unavailable", never as a number.
 */

/** One posted ledger line, already scoped to one wallet and one Lagos-day period. */
export interface WalletStatementRow {
  /** Posting instant (UTC ISO-8601). The statement renders it in Lagos wall-clock time. */
  readonly postedAt: string;
  /** Business reference from the journal. `null` when the journal records none — never the id. */
  readonly reference: string | null;
  /** Sanitised narration. `null` when the journal records none. */
  readonly description: string | null;
  /** Minor units, always present: a posted line always has a positive amount. */
  readonly amountMinor: string;
  /** `DEBIT` or `CREDIT`, exactly as posted. */
  readonly direction: 'DEBIT' | 'CREDIT';
  /**
   * Signed effect on this wallet (`+` money in, `-` money out), or `null` when the wallet's
   * normal-balance convention is unknown so the direction of the effect cannot be stated.
   */
  readonly signedMinor: string | null;
  /** Running balance after this row, or `null` if the ledger cannot support a running balance. */
  readonly runningMinor: string | null;
}

/** Summary figures. Each is `null` when the ledger cannot support it. */
export interface WalletStatementBalances {
  readonly openingMinor: string | null;
  readonly closingMinor: string | null;
  /** Money in during the period (sum of credit-effect lines). */
  readonly creditsMinor: string | null;
  /** Money out during the period (sum of debit-effect lines). */
  readonly debitsMinor: string | null;
  /** The wallet's actual ledger balance right now, independent of the statement period. */
  readonly currentMinor: string | null;
}

export interface WalletStatementHeader {
  /** Customer-facing display name, or a masked customer reference when no name is recorded. */
  readonly customerName: string;
  /** Masked wallet identifier: the full wallet id is never rendered into the document. */
  readonly walletLabel: string;
  readonly currency: string;
  readonly walletStatus: string;
  /** Lagos calendar days, `YYYY-MM-DD`, inclusive. */
  readonly periodFrom: string;
  readonly periodTo: string;
  /** Instant the document was produced, UTC ISO-8601. */
  readonly generatedAt: string;
  /** Identifier shared by the document and its audit record. */
  readonly statementId: string;
}

export interface WalletStatementDocument {
  readonly header: WalletStatementHeader;
  readonly balances: WalletStatementBalances;
  /** Chronological (oldest first) posted activity inside the period. */
  readonly rows: readonly WalletStatementRow[];
}

/** A validated, inclusive Lagos-day period. */
export interface StatementPeriod {
  readonly from: string;
  readonly to: string;
  /** Inclusive lower bound as a UTC instant (`from` 00:00 Africa/Lagos). */
  readonly fromInstant: string;
  /** Exclusive upper bound as a UTC instant (`to` + 1 day, 00:00 Africa/Lagos). */
  readonly toInstantExclusive: string;
}
