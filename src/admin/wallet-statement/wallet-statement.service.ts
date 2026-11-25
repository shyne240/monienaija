import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LedgerService } from '../../ledger/ledger.service';
import { LedgerNormalBalance } from '../../ledger/ledger.enums';
import { minorUnitsToDecimal, statementNarration } from './wallet-statement.format';
import type {
  StatementPeriod,
  WalletStatementBalances,
  WalletStatementRow,
} from './wallet-statement.types';

/**
 * Largest statement the product will produce.
 *
 * Above this the request FAILS and says so — the statement is never silently truncated. A wallet
 * statement is a financial document, and a document that quietly drops rows is worse than no
 * document: the reader cannot tell the difference between "no further activity" and "the rest was
 * cut". The operator is told to shorten the period.
 */
export const MAX_STATEMENT_ROWS = 2_000;

export interface WalletLedgerContext {
  readonly walletId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly status: string;
  readonly ledgerAccountId: string;
  readonly institutionId: string | null;
  readonly normalBalance: LedgerNormalBalance | null;
}

interface LineRow {
  posted_at: Date;
  reference: string | null;
  description: string | null;
  reversal_of_journal_id: string | null;
  direction: string;
  amount_minor: string;
}

export interface WalletStatementActivity {
  readonly rows: readonly WalletStatementRow[];
  readonly balances: WalletStatementBalances;
}

/**
 * Reads one wallet's authoritative posted activity for a Lagos-day period.
 *
 * ## The balance authority is the ledger, never a stored figure
 *
 * Opening and closing balances are sums over `ledger_lines` for the wallet's own
 * `ledger_account_id`, signed by that account's `normal_balance` — the same rule
 * `LedgerService.calculateBalancesWithQuery` applies to the balance endpoint. There is no cached
 * balance column involved, so a statement can never disagree with the balance the operator sees
 * on screen for a reason of its own.
 *
 * ## "Unavailable" is a real answer
 *
 * If the wallet has no resolvable ledger account, or that account's `normal_balance` is not one of
 * `DEBIT`/`CREDIT`, the effect of a debit versus a credit on this wallet is genuinely unknown.
 * Rather than assume the common case (customer wallets are credit-normal) and print a number that
 * might be sign-flipped, every derived figure becomes `null` and the document prints
 * "Unavailable". Amounts and directions still come straight from `ledger_lines`, which are
 * authoritative on their own.
 */
@Injectable()
export class WalletStatementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
  ) {}

  /** Resolves the wallet to its ledger account and normal-balance convention. */
  async loadContext(walletId: string): Promise<WalletLedgerContext> {
    const rows: Array<{
      id: string;
      customer_id: string;
      currency: string;
      status: string;
      ledger_account_id: string;
      institution_id: string | null;
      normal_balance: string | null;
    }> = await this.dataSource.query(
      `SELECT w.id::text AS id, w.customer_id::text AS customer_id, w.currency::text AS currency,
              w.status::text AS status, w.ledger_account_id::text AS ledger_account_id,
              w.institution_id::text AS institution_id, a.normal_balance::text AS normal_balance
         FROM wallet_accounts w
         LEFT JOIN ledger_accounts a ON a.id = w.ledger_account_id
        WHERE w.id = $1`,
      [walletId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Wallet not found');
    const normal = row.normal_balance;
    return {
      walletId: row.id,
      customerId: row.customer_id,
      currency: row.currency,
      status: row.status,
      ledgerAccountId: row.ledger_account_id,
      institutionId: row.institution_id,
      normalBalance:
        normal === LedgerNormalBalance.DEBIT || normal === LedgerNormalBalance.CREDIT
          ? normal
          : null,
    };
  }

  /** Reads posted activity for the period, with the balances the ledger can support. */
  async read(
    context: WalletLedgerContext,
    period: StatementPeriod,
  ): Promise<WalletStatementActivity> {
    const sign = (direction: string): 1n | -1n | null => {
      if (context.normalBalance === null) return null;
      const normal = context.normalBalance === LedgerNormalBalance.CREDIT ? 'CREDIT' : 'DEBIT';
      return direction === normal ? 1n : -1n;
    };

    /*
     * Opening balance: every posted line strictly before the period, summed with the same
     * normal-balance rule the ledger uses. A wallet with no prior activity has a genuine opening
     * balance of zero — that is a computed fact, not a substitute for a missing value.
     */
    let openingMinor: string | null = null;
    if (context.normalBalance !== null) {
      const opening: Array<{ total: string | null }> = await this.dataSource.query(
        `SELECT COALESCE(SUM(
                  CASE WHEN l.direction = $3 THEN l.amount_minor ELSE -l.amount_minor END
                ), 0)::text AS total
           FROM ledger_lines l
           JOIN ledger_journals j ON j.id = l.journal_id
          WHERE l.ledger_account_id = $1::uuid
            AND j.status = 'POSTED'
            AND j.posted_at < $2::timestamptz`,
        [context.ledgerAccountId, period.fromInstant, context.normalBalance],
      );
      openingMinor = opening[0]?.total ?? null;
    }

    const lines: LineRow[] = await this.dataSource.query(
      `SELECT j.posted_at, j.reference::text AS reference, j.description::text AS description,
              j.reversal_of_journal_id::text AS reversal_of_journal_id,
              l.direction::text AS direction, l.amount_minor::text AS amount_minor
         FROM ledger_lines l
         JOIN ledger_journals j ON j.id = l.journal_id
        WHERE l.ledger_account_id = $1::uuid
          AND j.status = 'POSTED'
          AND j.posted_at >= $2::timestamptz
          AND j.posted_at < $3::timestamptz
        ORDER BY j.posted_at ASC, l.line_number ASC
        LIMIT $4`,
      [
        context.ledgerAccountId,
        period.fromInstant,
        period.toInstantExclusive,
        MAX_STATEMENT_ROWS + 1,
      ],
    );

    if (lines.length > MAX_STATEMENT_ROWS) {
      throw new PayloadTooLargeException(
        `This wallet has more than ${MAX_STATEMENT_ROWS.toLocaleString('en-NG')} posted entries in the ` +
          'selected period, which is above the supported statement size. Shorten the period and ' +
          'generate the statement again. No document was produced.',
      );
    }

    /*
     * One pass, one accumulator. The running column, the closing balance and the period totals are
     * all derived from the same walk over the same signed amounts, so they cannot disagree with
     * each other or with the rows the reader can see.
     */
    let total: bigint | null = openingMinor === null ? null : BigInt(openingMinor);
    let credits: bigint | null = openingMinor === null ? null : 0n;
    let debits: bigint | null = openingMinor === null ? null : 0n;
    const rows: WalletStatementRow[] = [];

    for (const line of lines) {
      const factor = sign(line.direction);
      let signedMinor: string | null = null;
      let runningMinor: string | null = null;
      if (factor !== null && total !== null) {
        const effect = factor * BigInt(line.amount_minor);
        total = total + effect;
        signedMinor = effect.toString();
        // `total` is a local mutation, so it is reassigned here rather than captured.
        runningMinor = (total as bigint).toString();
        if (effect >= 0n) credits = (credits ?? 0n) + effect;
        else debits = (debits ?? 0n) + effect;
      }
      rows.push({
        postedAt: line.posted_at.toISOString(),
        reference: line.reference,
        description: statementNarration({
          description: line.description,
          reversalOfJournalId: line.reversal_of_journal_id,
        }),
        amountMinor: line.amount_minor,
        direction: line.direction === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        signedMinor,
        runningMinor,
      });
    }

    const currentMinor = await this.authoritativeCurrentBalance(context);

    return {
      rows,
      balances: {
        openingMinor,
        closingMinor: total === null ? null : total.toString(),
        creditsMinor: credits === null ? null : credits.toString(),
        // Money out is reported as a positive magnitude under a "money out" heading.
        debitsMinor: debits === null ? null : (debits < 0n ? -debits : debits).toString(),
        currentMinor,
      },
    };
  }

  /**
   * The wallet's ledger balance right now, from {@link LedgerService}.
   *
   * Deliberately the same call the Customer 360 balance panel makes, so a statement can be
   * reconciled against the screen without a second arithmetic path. When the ledger cannot produce
   * it, the statement says so instead of printing zero.
   */
  private async authoritativeCurrentBalance(context: WalletLedgerContext): Promise<string | null> {
    try {
      const balance = await this.ledgerService.getAccountBalance(context.ledgerAccountId);
      return balance.balanceMinor;
    } catch {
      return null;
    }
  }
}

/** Exported for the unit tests that pin the exact decimal rendering of a statement amount. */
export function statementAmount(amountMinor: string): string {
  if (!/^\d+$/.test(amountMinor)) throw new BadRequestException('Invalid statement amount');
  return minorUnitsToDecimal(amountMinor);
}

/**
 * A figure as the document and the preview show it. `null` is always the literal word
 * "Unavailable": zero is a real balance and must never be used to mean "we do not know".
 */
export function financialOrUnavailable(minor: string | null, currency: string): string {
  if (minor === null) return 'Unavailable';
  return `${currency} ${minorUnitsToDecimal(minor)}`;
}
