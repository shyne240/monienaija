import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { VerificationStatus } from './reconciliation.types';
import type {
  AccountActivitySummary,
  AccountTypeTotal,
  BalanceConservationDimension,
  FinanceVerificationReport,
  JournalIntegrityReport,
  ReconciliationCheck,
  ReconciliationReport,
  TrialBalanceDimension,
  TrialBalanceReport,
  TrialBalanceRow,
} from './reconciliation.types';

type SqlExecutor = DataSource | EntityManager;
type SqlRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ReconciliationService {
  constructor(private readonly dataSource: DataSource) {}

  async runReconciliation(): Promise<ReconciliationReport> {
    return this.withReadOnlyTransaction(async (manager) => {
      const checks: ReconciliationCheck[] = [];
      checks.push(
        await this.executeCheck(
          manager,
          'wallet_balances_ledger_derived',
          `
            WITH wallet_balances AS (
              SELECT w.id,
                     w.currency,
                     la.currency AS account_currency,
                     COALESCE(
                       SUM(
                         CASE
                           WHEN ll.direction = la.normal_balance THEN ll.amount_minor
                           ELSE -ll.amount_minor
                         END
                       ),
                       0
                     ) AS balance_minor
                FROM wallet_accounts w
                LEFT JOIN ledger_accounts la ON la.id = w.ledger_account_id
                LEFT JOIN ledger_lines ll ON ll.ledger_account_id = la.id
               GROUP BY w.id, w.currency, la.currency, la.normal_balance
            )
            SELECT COUNT(*)::text AS wallets_checked,
                   COUNT(*) FILTER (WHERE account_currency IS NULL)::text AS missing_accounts,
                   COUNT(*) FILTER (
                     WHERE account_currency IS NOT NULL AND currency <> account_currency
                   )::text AS currency_mismatches,
                   COUNT(*) FILTER (WHERE balance_minor < 0)::text AS negative_balances,
                   (
                     COUNT(*) FILTER (WHERE account_currency IS NULL)
                     + COUNT(*) FILTER (
                         WHERE account_currency IS NOT NULL AND currency <> account_currency
                       )
                     + COUNT(*) FILTER (WHERE balance_minor < 0)
                   )::text AS violations
              FROM wallet_balances
          `,
          'Every wallet has a calculable ledger-derived balance and no negative balance.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'wallet_liability_account_ownership',
          `
            SELECT COUNT(*)::text AS wallets_checked,
                   COUNT(*) FILTER (
                     WHERE la.id IS NULL
                        OR la.account_type <> 'LIABILITY'
                        OR la.normal_balance <> 'CREDIT'
                        OR la.currency <> w.currency
                        OR la.accounting_unit <> 'CUSTOMER_FUNDS'
                        OR la.allow_negative_balance
                   )::text AS violations
              FROM wallet_accounts w
              LEFT JOIN ledger_accounts la ON la.id = w.ledger_account_id
          `,
          'Every wallet has exactly one compatible non-negative liability account.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'journal_balance_integrity',
          `
            WITH journal_totals AS (
              SELECT j.id,
                     j.currency,
                     j.accounting_unit,
                     j.total_minor,
                     COUNT(l.id) AS line_count,
                     COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0) AS debits,
                     COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0) AS credits
                FROM ledger_journals j
                LEFT JOIN ledger_lines l ON l.journal_id = j.id
               GROUP BY j.id, j.currency, j.accounting_unit, j.total_minor
            )
            SELECT COUNT(*)::text AS journals_checked,
                   COUNT(*) FILTER (
                     WHERE line_count < 2 OR debits <> credits OR debits <> total_minor
                   )::text AS violations
              FROM journal_totals
          `,
          'Every journal has at least two lines and equal debit, credit, and recorded totals.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'orphan_ledger_entries',
          `
            SELECT COUNT(*)::text AS violations
              FROM ledger_lines l
              LEFT JOIN ledger_journals j ON j.id = l.journal_id
             WHERE j.id IS NULL
          `,
          'Every ledger line references an existing journal.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'journal_line_account_integrity',
          `
            SELECT COUNT(*)::text AS violations
              FROM ledger_lines l
              LEFT JOIN ledger_accounts a ON a.id = l.ledger_account_id
             WHERE a.id IS NULL
          `,
          'Every journal line references an existing ledger account.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'completed_transfer_journal_integrity',
          `
            SELECT COUNT(*) FILTER (
                     WHERE t.status = 'COMPLETED' AND (t.journal_id IS NULL OR j.id IS NULL)
                   )::text AS violations,
                   COUNT(*) FILTER (WHERE t.status = 'COMPLETED')::text AS completed_transfers
              FROM transfers t
              LEFT JOIN ledger_journals j ON j.id = t.journal_id
          `,
          'Every completed transfer references an existing journal.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'failed_transfer_attempts',
          `
            SELECT COUNT(*)::text AS failed_transfers,
                   COUNT(*)::text AS violations
              FROM transfers
             WHERE status = 'FAILED'
          `,
          'No failed transfer attempts are awaiting investigation.',
          [],
          VerificationStatus.WARNING,
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'currency_consistency',
          `
            SELECT (
              (SELECT COUNT(*)
                 FROM ledger_lines l
                 JOIN ledger_journals j ON j.id = l.journal_id
                WHERE l.currency <> j.currency)
              + (SELECT COUNT(*)
                   FROM ledger_lines l
                   JOIN ledger_accounts a ON a.id = l.ledger_account_id
                  WHERE l.currency <> a.currency)
              + (SELECT COUNT(*)
                   FROM wallet_accounts w
                   JOIN ledger_accounts a ON a.id = w.ledger_account_id
                  WHERE w.currency <> a.currency)
              + (SELECT COUNT(*)
                   FROM transfers t
                   JOIN wallet_accounts sw ON sw.id = t.source_wallet_id
                   JOIN wallet_accounts dw ON dw.id = t.destination_wallet_id
                  WHERE t.status = 'COMPLETED'
                    AND (t.currency <> sw.currency OR t.currency <> dw.currency))
            )::text AS violations
          `,
          'Wallets, transfers, journals, lines, and accounts use consistent currencies.',
        ),
      );
      checks.push(
        await this.executeCheck(
          manager,
          'accounting_unit_consistency',
          `
            SELECT (
              (SELECT COUNT(*)
                 FROM ledger_lines l
                 JOIN ledger_journals j ON j.id = l.journal_id
                WHERE l.accounting_unit <> j.accounting_unit)
              + (SELECT COUNT(*)
                   FROM ledger_lines l
                   JOIN ledger_accounts a ON a.id = l.ledger_account_id
                  WHERE l.accounting_unit <> a.accounting_unit)
              + (SELECT COUNT(*)
                   FROM wallet_accounts w
                   JOIN ledger_accounts a ON a.id = w.ledger_account_id
                  WHERE a.accounting_unit <> 'CUSTOMER_FUNDS')
            )::text AS violations
          `,
          'Wallet and ledger records use consistent accounting units.',
        ),
      );

      return {
        status: this.aggregateStatus(checks),
        generatedAt: new Date().toISOString(),
        checks,
      };
    });
  }

  async getTrialBalance(): Promise<TrialBalanceReport> {
    return this.withReadOnlyTransaction((manager) => this.collectTrialBalance(manager));
  }

  async getFinanceVerification(): Promise<FinanceVerificationReport> {
    return this.withReadOnlyTransaction(async (manager) => {
      const trialBalance = await this.collectTrialBalance(manager);
      const [
        totalAssets,
        totalLiabilities,
        journalIntegrity,
        balanceConservation,
        accountActivity,
      ] = await Promise.all([
        this.collectAccountTypeTotals(manager, 'ASSET'),
        this.collectAccountTypeTotals(manager, 'LIABILITY'),
        this.collectJournalIntegrity(manager),
        this.collectBalanceConservation(manager),
        this.collectAccountActivity(manager),
      ]);

      return {
        generatedAt: new Date().toISOString(),
        trialBalance,
        totalAssets,
        totalLiabilities,
        journalIntegrity,
        balanceConservation,
        accountActivity,
      };
    });
  }

  async getAccountActivity(accountId?: string): Promise<AccountActivitySummary[]> {
    if (accountId !== undefined && !this.isUuid(accountId)) {
      throw new BadRequestException('accountId must be a UUID');
    }

    return this.withReadOnlyTransaction((manager) =>
      this.collectAccountActivity(manager, accountId),
    );
  }

  private async collectTrialBalance(manager: EntityManager): Promise<TrialBalanceReport> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT a.id AS account_id,
               a.code AS account_code,
               a.name AS account_name,
               a.account_type,
               a.currency,
               a.accounting_unit,
               COUNT(l.id)::text AS entry_count,
               COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS total_debits_minor,
               COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS total_credits_minor,
               COALESCE(
                 SUM(
                   CASE
                     WHEN l.direction = a.normal_balance THEN l.amount_minor
                     ELSE -l.amount_minor
                   END
                 ),
                 0
               )::text AS balance_minor
          FROM ledger_accounts a
          LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
         GROUP BY a.id, a.code, a.name, a.account_type, a.currency, a.accounting_unit
         ORDER BY a.code ASC, a.id ASC
      `,
    );

    const trialRows: TrialBalanceRow[] = rows.map((row) => ({
      accountId: this.stringValue(row.account_id),
      accountCode: this.stringValue(row.account_code),
      accountName: this.stringValue(row.account_name),
      accountType: this.stringValue(row.account_type),
      currency: this.stringValue(row.currency),
      accountingUnit: this.stringValue(row.accounting_unit),
      entryCount: this.numberValue(row.entry_count),
      totalDebitsMinor: this.integerValue(row.total_debits_minor),
      totalCreditsMinor: this.integerValue(row.total_credits_minor),
      balanceMinor: this.signedIntegerValue(row.balance_minor),
    }));
    const dimensions = this.aggregateTrialBalanceDimensions(trialRows);

    return {
      generatedAt: new Date().toISOString(),
      rows: trialRows,
      dimensions,
      balanced: dimensions.every((dimension) => dimension.balanced),
    };
  }

  private async collectAccountTypeTotals(
    manager: EntityManager,
    accountType: 'ASSET' | 'LIABILITY',
  ): Promise<AccountTypeTotal[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT a.account_type,
               a.currency,
               a.accounting_unit,
               COALESCE(
                 SUM(
                   CASE
                     WHEN l.direction = a.normal_balance THEN l.amount_minor
                     ELSE -l.amount_minor
                   END
                 ),
                 0
               )::text AS total_balance_minor
          FROM ledger_accounts a
          LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
         WHERE a.account_type = $1
         GROUP BY a.account_type, a.currency, a.accounting_unit
         ORDER BY a.currency ASC, a.accounting_unit ASC
      `,
      [accountType],
    );

    return rows.map((row) => ({
      accountType,
      currency: this.stringValue(row.currency),
      accountingUnit: this.stringValue(row.accounting_unit),
      totalBalanceMinor: this.signedIntegerValue(row.total_balance_minor),
    }));
  }

  private async collectJournalIntegrity(manager: EntityManager): Promise<JournalIntegrityReport> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        WITH journal_totals AS (
          SELECT j.id,
                 j.total_minor,
                 COUNT(l.id) AS line_count,
                 COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0) AS debits,
                 COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0) AS credits
            FROM ledger_journals j
            LEFT JOIN ledger_lines l ON l.journal_id = j.id
           GROUP BY j.id, j.total_minor
        )
        SELECT (SELECT COUNT(*)::text FROM ledger_journals) AS total_journals,
               (SELECT COUNT(*)::text
                  FROM journal_totals
                 WHERE line_count < 2 OR debits <> credits OR debits <> total_minor) AS invalid_journals,
               (SELECT COUNT(*)::text FROM ledger_lines) AS total_lines,
               (SELECT COUNT(*)::text
                  FROM ledger_lines l
                  LEFT JOIN ledger_journals j ON j.id = l.journal_id
                 WHERE j.id IS NULL) AS orphan_lines
      `,
    );
    const row = rows[0] ?? {};
    const invalidJournals = this.numberValue(row.invalid_journals);
    const orphanLines = this.numberValue(row.orphan_lines);

    return {
      generatedAt: new Date().toISOString(),
      totalJournals: this.numberValue(row.total_journals),
      invalidJournals,
      totalLines: this.numberValue(row.total_lines),
      orphanLines,
      balanced: invalidJournals === 0 && orphanLines === 0,
    };
  }

  private async collectBalanceConservation(
    manager: EntityManager,
  ): Promise<BalanceConservationDimension[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT currency,
               accounting_unit,
               COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor ELSE 0 END), 0)::text AS total_debits_minor,
               COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE 0 END), 0)::text AS total_credits_minor
          FROM ledger_lines
         GROUP BY currency, accounting_unit
         ORDER BY currency ASC, accounting_unit ASC
      `,
    );

    return rows.map((row) => {
      const totalDebitsMinor = this.integerValue(row.total_debits_minor);
      const totalCreditsMinor = this.integerValue(row.total_credits_minor);
      return {
        currency: this.stringValue(row.currency),
        accountingUnit: this.stringValue(row.accounting_unit),
        totalDebitsMinor,
        totalCreditsMinor,
        balanced: totalDebitsMinor === totalCreditsMinor,
      };
    });
  }

  private async collectAccountActivity(
    manager: EntityManager,
    accountId?: string,
  ): Promise<AccountActivitySummary[]> {
    const rows = await this.queryRows<SqlRow>(
      manager,
      `
        SELECT a.id AS account_id,
               a.code AS account_code,
               a.name AS account_name,
               a.account_type,
               a.currency,
               a.accounting_unit,
               COUNT(l.id)::text AS entry_count,
               COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS total_debits_minor,
               COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS total_credits_minor,
               COALESCE(
                 SUM(
                   CASE
                     WHEN l.direction = a.normal_balance THEN l.amount_minor
                     ELSE -l.amount_minor
                   END
                 ),
                 0
               )::text AS balance_minor,
               MIN(l.created_at)::text AS first_activity_at,
               MAX(l.created_at)::text AS last_activity_at
          FROM ledger_accounts a
          LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
         WHERE ($1::uuid IS NULL OR a.id = $1::uuid)
         GROUP BY a.id, a.code, a.name, a.account_type, a.currency, a.accounting_unit
         ORDER BY a.code ASC, a.id ASC
      `,
      [accountId ?? null],
    );

    return rows.map((row) => ({
      accountId: this.stringValue(row.account_id),
      accountCode: this.stringValue(row.account_code),
      accountName: this.stringValue(row.account_name),
      accountType: this.stringValue(row.account_type),
      currency: this.stringValue(row.currency),
      accountingUnit: this.stringValue(row.accounting_unit),
      entryCount: this.numberValue(row.entry_count),
      totalDebitsMinor: this.integerValue(row.total_debits_minor),
      totalCreditsMinor: this.integerValue(row.total_credits_minor),
      balanceMinor: this.signedIntegerValue(row.balance_minor),
      firstActivityAt: this.isoDateValue(row.first_activity_at),
      lastActivityAt: this.isoDateValue(row.last_activity_at),
    }));
  }

  private aggregateTrialBalanceDimensions(rows: TrialBalanceRow[]): TrialBalanceDimension[] {
    const dimensions = new Map<
      string,
      { currency: string; accountingUnit: string; debits: bigint; credits: bigint }
    >();
    for (const row of rows) {
      const key = `${row.currency}:${row.accountingUnit}`;
      const current = dimensions.get(key) ?? {
        currency: row.currency,
        accountingUnit: row.accountingUnit,
        debits: 0n,
        credits: 0n,
      };
      current.debits += BigInt(row.totalDebitsMinor);
      current.credits += BigInt(row.totalCreditsMinor);
      dimensions.set(key, current);
    }

    return [...dimensions.values()].map((dimension) => ({
      currency: dimension.currency,
      accountingUnit: dimension.accountingUnit,
      totalDebitsMinor: dimension.debits.toString(),
      totalCreditsMinor: dimension.credits.toString(),
      balanced: dimension.debits === dimension.credits,
    }));
  }

  private async executeCheck(
    executor: SqlExecutor,
    name: string,
    sql: string,
    message: string,
    parameters: unknown[] = [],
    violationStatus: VerificationStatus = VerificationStatus.ERROR,
  ): Promise<ReconciliationCheck> {
    try {
      const rows = await this.queryRows<SqlRow>(executor, sql, parameters);
      const row = rows[0] ?? {};
      const violations = this.numberValue(row.violations);
      return {
        name,
        status: violations === 0 ? VerificationStatus.PASS : violationStatus,
        message: violations === 0 ? message : `${name} reported ${violations} violation(s).`,
        details: this.scalarDetails(row),
      };
    } catch {
      return {
        name,
        status: VerificationStatus.ERROR,
        message: `${name} could not be executed.`,
        details: { violations: 'UNAVAILABLE' },
      };
    }
  }

  private aggregateStatus(checks: ReconciliationCheck[]): VerificationStatus {
    if (checks.some((check) => check.status === VerificationStatus.ERROR)) {
      return VerificationStatus.ERROR;
    }
    if (checks.some((check) => check.status === VerificationStatus.WARNING)) {
      return VerificationStatus.WARNING;
    }
    return VerificationStatus.PASS;
  }

  private async withReadOnlyTransaction<T>(
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return callback(manager);
    });
  }

  private async queryRows<T extends SqlRow>(
    executor: SqlExecutor,
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return executor.query(sql, parameters);
  }

  private scalarDetails(row: SqlRow): Record<string, string | number | boolean | null> {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, this.scalarValue(value)]),
    );
  }

  private scalarValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value) ?? '';
  }

  private stringValue(value: unknown): string {
    return this.textValue(value);
  }

  private numberValue(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'bigint' || typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private integerValue(value: unknown): string {
    return this.signedIntegerValue(value).replace(/^-/, '');
  }

  private signedIntegerValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    return BigInt(this.textValue(value)).toString();
  }

  private isoDateValue(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const date = new Date(this.textValue(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private textValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value) ?? '';
  }

  private isUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
  }
}
