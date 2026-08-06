import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { MetricsService } from '../operations/metrics.service';

import {
  CustomerFinancialAccountDiscrepancyType,
  type CustomerFinancialAccountDiscrepancy,
  type CustomerFinancialAccountDiscrepancyOwner,
  type CustomerFinancialAccountReconciliationReport,
} from './customer-financial-account-reconciliation.types';
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
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async runReconciliation(): Promise<ReconciliationReport> {
    const startedAt = performance.now();
    const report = await this.withReadOnlyTransaction(async (manager) => {
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
          'completed_payment_journal_integrity',
          `
            SELECT (
              (SELECT COUNT(*)
                 FROM transfers t
                 LEFT JOIN ledger_journals j ON j.id = t.journal_id
                WHERE t.status = 'COMPLETED' AND (t.journal_id IS NULL OR j.id IS NULL))
              + (SELECT COUNT(*)
                   FROM deposits d
                   LEFT JOIN ledger_journals j ON j.id = d.journal_id
                  WHERE d.status = 'COMPLETED' AND (d.journal_id IS NULL OR j.id IS NULL))
              + (SELECT COUNT(*)
                   FROM withdrawals w
                   LEFT JOIN ledger_journals j ON j.id = w.journal_id
                  WHERE w.status = 'COMPLETED' AND (w.journal_id IS NULL OR j.id IS NULL))
            )::text AS violations
          `,
          'Every completed transfer, deposit, and withdrawal references an existing journal.',
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
              + (SELECT COUNT(*)
                   FROM deposits d
                   JOIN wallet_accounts w ON w.id = d.wallet_id
                  WHERE d.currency <> w.currency)
              + (SELECT COUNT(*)
                   FROM withdrawals wth
                   JOIN wallet_accounts w ON w.id = wth.wallet_id
                  WHERE wth.currency <> w.currency)
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

      const binding = await this.collectBindingReconciliation(manager);
      checks.push(this.bindingCheck(binding));
      return {
        status: this.aggregateStatus(checks),
        generatedAt: new Date().toISOString(),
        checks,
        binding,
      };
    });
    await this.metricsService?.observeDuration('reconciliation.duration_ms', startedAt);
    return report;
  }

  async getBindingReconciliation(): Promise<CustomerFinancialAccountReconciliationReport> {
    return this.withReadOnlyTransaction((manager) => this.collectBindingReconciliation(manager));
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

  private async collectBindingReconciliation(
    manager: EntityManager,
  ): Promise<CustomerFinancialAccountReconciliationReport> {
    try {
      const countRows = await this.queryRows<SqlRow>(
        manager,
        `
          /* A3T07 binding population counts */
          SELECT
            (SELECT COUNT(*)::text FROM customer_financial_account_bindings) AS bindings_checked,
            (SELECT COUNT(*)::text
               FROM customer_financial_account_bindings
              WHERE state = 'ACTIVE') AS active_bindings_checked,
            (SELECT COUNT(*)::text
               FROM customer_wallets
              WHERE deleted_at IS NULL) AS customer_wallets_checked,
            (SELECT COUNT(*)::text FROM wallet_accounts) AS financial_wallets_checked
        `,
      );
      const counts = countRows[0] ?? {};
      const discrepancies: CustomerFinancialAccountDiscrepancy[] = [];

      const duplicateRows = await this.queryRows<SqlRow>(
        manager,
        `
          /* A3T07 active binding duplicate scopes */
          WITH duplicate_scopes AS (
            SELECT 'CUSTOMER_WALLET' AS duplicate_dimension,
                   customer_wallet_id::text AS scope_value,
                   NULL::text AS customer_id,
                   NULL::text AS currency,
                   COUNT(*)::text AS occurrence_count
              FROM customer_financial_account_bindings
             WHERE state = 'ACTIVE'
             GROUP BY customer_wallet_id
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'WALLET_ACCOUNT',
                   wallet_account_id::text,
                   NULL,
                   NULL,
                   COUNT(*)::text
              FROM customer_financial_account_bindings
             WHERE state = 'ACTIVE'
             GROUP BY wallet_account_id
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'LEDGER_ACCOUNT',
                   ledger_account_id::text,
                   NULL,
                   NULL,
                   COUNT(*)::text
              FROM customer_financial_account_bindings
             WHERE state = 'ACTIVE'
             GROUP BY ledger_account_id
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT 'CUSTOMER_CURRENCY',
                   NULL,
                   customer_id::text,
                   currency,
                   COUNT(*)::text
              FROM customer_financial_account_bindings
             WHERE state = 'ACTIVE'
             GROUP BY customer_id, currency
            HAVING COUNT(*) > 1
          )
          SELECT duplicate_dimension,
                 scope_value,
                 customer_id,
                 currency,
                 occurrence_count
            FROM duplicate_scopes
           ORDER BY duplicate_dimension, scope_value, customer_id, currency
        `,
      );
      for (const row of duplicateRows) {
        if (this.numberValue(row.occurrence_count) <= 1) continue;
        const dimension = this.textValue(row.duplicate_dimension);
        const scopeValue = this.nullableText(row.scope_value);
        const customerId = this.nullableText(row.customer_id);
        const currency = this.nullableText(row.currency);
        discrepancies.push(
          this.createBindingDiscrepancy(
            CustomerFinancialAccountDiscrepancyType.DUPLICATE_ACTIVE_BINDING,
            'ERROR',
            'RECONCILIATION',
            'A3T08_HANDOFF',
            {
              customerId,
              currency,
              scopeValue: scopeValue ?? dimension,
            },
            `Multiple active bindings claim the ${dimension} scope`,
          ),
        );
      }

      const sourceRows = await this.queryRows<SqlRow>(
        manager,
        `
          /* A3T07 active binding source integrity */
          SELECT b.id AS binding_id,
                 b.customer_id::text AS customer_id,
                 b.customer_wallet_id::text AS customer_wallet_id,
                 b.wallet_account_id::text AS wallet_account_id,
                 b.ledger_account_id::text AS ledger_account_id,
                 b.currency AS binding_currency,
                 b.accounting_unit AS binding_accounting_unit,
                 b.source_customer_version,
                 b.source_customer_wallet_version,
                 c.id IS NOT NULL AS customer_exists,
                 c.status AS customer_status,
                 c.deleted_at IS NOT NULL AS customer_deleted,
                 c.version AS customer_version,
                 cw.id IS NOT NULL AS customer_wallet_exists,
                 cw.customer_id::text = b.customer_id::text AS customer_wallet_customer_matches,
                 cw.status AS customer_wallet_status,
                 cw.currency AS customer_wallet_currency,
                 cw.deleted_at IS NOT NULL AS customer_wallet_deleted,
                 cw.version AS customer_wallet_version,
                 wa.id IS NOT NULL AS wallet_account_exists,
                 lower(wa.customer_id) = lower(b.customer_id::text) AS wallet_customer_matches,
                 wa.status AS wallet_status,
                 wa.currency AS wallet_currency,
                 wa.ledger_account_id::text = b.ledger_account_id::text AS wallet_ledger_matches,
                 la.id IS NOT NULL AS ledger_account_exists,
                 la.currency AS ledger_currency,
                 la.accounting_unit AS ledger_accounting_unit,
                 la.account_type AS ledger_account_type,
                 la.normal_balance AS ledger_normal_balance,
                 la.allow_negative_balance AS ledger_allow_negative_balance,
                 la.is_active AS ledger_is_active
            FROM customer_financial_account_bindings b
            LEFT JOIN customers c ON c.id = b.customer_id
            LEFT JOIN customer_wallets cw ON cw.id = b.customer_wallet_id
            LEFT JOIN wallet_accounts wa ON wa.id = b.wallet_account_id
            LEFT JOIN ledger_accounts la ON la.id = b.ledger_account_id
           WHERE b.state = 'ACTIVE'
           ORDER BY b.id
        `,
      );
      for (const row of sourceRows) {
        this.collectSourceDiscrepancies(discrepancies, row);
      }

      const metadataRows = await this.queryRows<SqlRow>(
        manager,
        `
          /* A3T07 customer wallet coverage */
          SELECT cw.id AS customer_wallet_id,
                 cw.customer_id::text AS customer_id,
                 cw.currency,
                 wo.id IS NOT NULL AS ownership_exists,
                 wo.customer_id::text = cw.customer_id::text AS ownership_customer_matches,
                 b.id IS NOT NULL AS active_binding_exists
            FROM customer_wallets cw
            LEFT JOIN wallet_ownerships wo
              ON wo.wallet_id = cw.id
             AND wo.deleted_at IS NULL
            LEFT JOIN customer_financial_account_bindings b
              ON b.customer_wallet_id = cw.id
             AND b.state = 'ACTIVE'
           WHERE cw.deleted_at IS NULL
             AND cw.status = 'ACTIVE'
             AND (
               wo.id IS NULL
               OR wo.customer_id::text <> cw.customer_id::text
               OR b.id IS NULL
             )
           ORDER BY cw.id
        `,
      );
      for (const row of metadataRows) {
        const customerWalletId = this.nullableText(row.customer_wallet_id);
        if (!customerWalletId) continue;
        const customerId = this.nullableText(row.customer_id);
        const currency = this.nullableText(row.currency);
        if (!this.booleanValue(row.ownership_exists)) {
          discrepancies.push(
            this.createBindingDiscrepancy(
              CustomerFinancialAccountDiscrepancyType.ORPHANED_CUSTOMER_WALLET,
              'ERROR',
              'CUSTOMER_ENGINEERING',
              'A3T08_HANDOFF',
              { customerId, customerWalletId, currency, scopeValue: customerWalletId },
              'Active customer wallet has no active ownership evidence',
            ),
          );
        } else if (!this.booleanValue(row.ownership_customer_matches)) {
          discrepancies.push(
            this.createBindingDiscrepancy(
              CustomerFinancialAccountDiscrepancyType.CUSTOMER_OWNERSHIP_MISMATCH,
              'ERROR',
              'CUSTOMER_ENGINEERING',
              'A3T08_HANDOFF',
              { customerId, customerWalletId, currency, scopeValue: customerWalletId },
              'Customer wallet ownership evidence does not match the metadata customer',
            ),
          );
        }
        if (!this.booleanValue(row.active_binding_exists)) {
          discrepancies.push(
            this.createBindingDiscrepancy(
              CustomerFinancialAccountDiscrepancyType.MISSING_ACTIVE_BINDING,
              'WARNING',
              'WALLET',
              'MANUAL_REVIEW_REQUIRED',
              { customerId, customerWalletId, currency, scopeValue: customerWalletId },
              'Active customer wallet has no active financial account binding',
            ),
          );
        }
      }

      const unboundRows = await this.queryRows<SqlRow>(
        manager,
        `
          /* A3T07 unbound financial wallet coverage */
          SELECT wa.id AS wallet_account_id,
                 wa.currency,
                 wa.status AS wallet_status,
                 wa.ledger_account_id::text AS ledger_account_id,
                 la.id IS NOT NULL AS ledger_account_exists
            FROM wallet_accounts wa
            LEFT JOIN customer_financial_account_bindings b
              ON b.wallet_account_id = wa.id
            LEFT JOIN ledger_accounts la ON la.id = wa.ledger_account_id
           WHERE b.id IS NULL
             AND wa.status IN ('ACTIVE', 'SUSPENDED')
           ORDER BY wa.id
        `,
      );
      for (const row of unboundRows) {
        const walletAccountId = this.nullableText(row.wallet_account_id);
        if (!walletAccountId) continue;
        const ledgerAccountId = this.nullableText(row.ledger_account_id);
        discrepancies.push(
          this.createBindingDiscrepancy(
            CustomerFinancialAccountDiscrepancyType.UNBOUND_FINANCIAL_WALLET,
            'WARNING',
            'WALLET',
            'MANUAL_REVIEW_REQUIRED',
            {
              walletAccountId,
              ledgerAccountId,
              currency: this.nullableText(row.currency),
              scopeValue: walletAccountId,
            },
            'Financial wallet has no customer financial account binding',
          ),
        );
        if (!this.booleanValue(row.ledger_account_exists)) {
          discrepancies.push(
            this.createBindingDiscrepancy(
              CustomerFinancialAccountDiscrepancyType.MISSING_LEDGER_ACCOUNT,
              'ERROR',
              'LEDGER',
              'A3T08_HANDOFF',
              {
                walletAccountId,
                ledgerAccountId,
                currency: this.nullableText(row.currency),
                scopeValue: walletAccountId,
              },
              'Unbound financial wallet references a missing ledger account',
            ),
          );
        }
      }

      return this.createBindingReport(
        discrepancies,
        this.numberValue(counts.bindings_checked),
        this.numberValue(counts.active_bindings_checked),
        this.numberValue(counts.customer_wallets_checked),
        this.numberValue(counts.financial_wallets_checked),
      );
    } catch {
      const queryFailure = this.createBindingDiscrepancy(
        CustomerFinancialAccountDiscrepancyType.QUERY_UNAVAILABLE,
        'ERROR',
        'RECONCILIATION',
        'MANUAL_REVIEW_REQUIRED',
        { scopeValue: 'A3T07' },
        'Binding reconciliation query could not be executed',
      );
      return this.createBindingReport([queryFailure], 0, 0, 0, 0);
    }
  }

  private collectSourceDiscrepancies(
    discrepancies: CustomerFinancialAccountDiscrepancy[],
    row: SqlRow,
  ): void {
    const bindingId = this.nullableText(row.binding_id);
    if (!bindingId) return;
    const references = {
      bindingId,
      customerId: this.nullableText(row.customer_id),
      customerWalletId: this.nullableText(row.customer_wallet_id),
      walletAccountId: this.nullableText(row.wallet_account_id),
      ledgerAccountId: this.nullableText(row.ledger_account_id),
      currency: this.nullableText(row.binding_currency),
      accountingUnit: this.nullableText(row.binding_accounting_unit),
      scopeValue: bindingId,
    };
    const missingSources: Array<
      [CustomerFinancialAccountDiscrepancyType, string, CustomerFinancialAccountDiscrepancyOwner]
    > = [];
    if (!this.booleanValue(row.customer_exists)) {
      missingSources.push([
        CustomerFinancialAccountDiscrepancyType.MISSING_CUSTOMER,
        'Active binding references a missing customer',
        'CUSTOMER_ENGINEERING',
      ]);
    }
    if (!this.booleanValue(row.customer_wallet_exists)) {
      missingSources.push([
        CustomerFinancialAccountDiscrepancyType.MISSING_CUSTOMER_WALLET,
        'Active binding references a missing customer wallet',
        'CUSTOMER_ENGINEERING',
      ]);
    }
    if (!this.booleanValue(row.wallet_account_exists)) {
      missingSources.push([
        CustomerFinancialAccountDiscrepancyType.MISSING_WALLET_ACCOUNT,
        'Active binding references a missing wallet account',
        'WALLET',
      ]);
    }
    if (!this.booleanValue(row.ledger_account_exists)) {
      missingSources.push([
        CustomerFinancialAccountDiscrepancyType.MISSING_LEDGER_ACCOUNT,
        'Active binding references a missing ledger account',
        'LEDGER',
      ]);
    }
    if (missingSources.length > 0) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.ORPHANED_BINDING,
          'ERROR',
          'RECONCILIATION',
          'A3T08_HANDOFF',
          references,
          'Active binding is orphaned from one or more authoritative source records',
        ),
      );
    }
    for (const [type, message, owner] of missingSources) {
      discrepancies.push(
        this.createBindingDiscrepancy(type, 'ERROR', owner, 'A3T08_HANDOFF', references, message),
      );
    }
    if (missingSources.length > 0) return;

    if (!this.booleanValue(row.customer_wallet_customer_matches)) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.CUSTOMER_OWNERSHIP_MISMATCH,
          'ERROR',
          'CUSTOMER_ENGINEERING',
          'A3T08_HANDOFF',
          references,
          'Binding customer wallet does not belong to the binding customer',
        ),
      );
    }
    if (!this.booleanValue(row.wallet_customer_matches)) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.ACCOUNT_OWNERSHIP_MISMATCH,
          'ERROR',
          'WALLET',
          'A3T08_HANDOFF',
          references,
          'Wallet account customer compatibility value does not match canonical customer identity',
        ),
      );
    }
    if (!this.booleanValue(row.wallet_ledger_matches)) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.WALLET_LEDGER_RELATIONSHIP_MISMATCH,
          'ERROR',
          'WALLET',
          'A3T08_HANDOFF',
          references,
          'Wallet account ledger relationship does not match the binding',
        ),
      );
    }

    const currencyValues = [
      row.binding_currency,
      row.customer_wallet_currency,
      row.wallet_currency,
      row.ledger_currency,
    ].map((value) => this.nullableText(value));
    if (new Set(currencyValues).size !== 1) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.CURRENCY_MISMATCH,
          'ERROR',
          'FINANCE',
          'A3T08_HANDOFF',
          references,
          'Binding and source records do not use one currency',
        ),
      );
    }
    if (
      this.textValue(row.binding_accounting_unit) !== 'CUSTOMER_FUNDS' ||
      this.textValue(row.ledger_accounting_unit) !== this.textValue(row.binding_accounting_unit)
    ) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.ACCOUNTING_UNIT_MISMATCH,
          'ERROR',
          'FINANCE',
          'A3T08_HANDOFF',
          references,
          'Binding and ledger account accounting units are incompatible',
        ),
      );
    }
    if (this.textValue(row.ledger_account_type) !== 'LIABILITY') {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.ACCOUNT_TYPE_MISMATCH,
          'ERROR',
          'LEDGER',
          'A3T08_HANDOFF',
          references,
          'Ledger account type is not a customer-funds liability account',
        ),
      );
    }
    if (this.textValue(row.ledger_normal_balance) !== 'CREDIT') {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.NORMAL_BALANCE_MISMATCH,
          'ERROR',
          'LEDGER',
          'A3T08_HANDOFF',
          references,
          'Ledger account normal balance is not CREDIT',
        ),
      );
    }
    if (this.booleanValue(row.ledger_allow_negative_balance)) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.NEGATIVE_BALANCE_ALLOWED,
          'ERROR',
          'LEDGER',
          'A3T08_HANDOFF',
          references,
          'Ledger account allows negative balance',
        ),
      );
    }
    if (!this.booleanValue(row.ledger_is_active)) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.INACTIVE_LEDGER_ACCOUNT,
          'ERROR',
          'LEDGER',
          'A3T08_HANDOFF',
          references,
          'Active binding references an inactive ledger account',
        ),
      );
    }
    if (
      this.numberValue(row.source_customer_version) !== this.numberValue(row.customer_version) ||
      this.numberValue(row.source_customer_wallet_version) !==
        this.numberValue(row.customer_wallet_version)
    ) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.STALE_BINDING,
          'ERROR',
          'WALLET',
          'A3T08_HANDOFF',
          references,
          'Binding source version is stale',
        ),
      );
    }
    if (
      this.textValue(row.customer_status) !== 'ACTIVE' ||
      this.booleanValue(row.customer_deleted) ||
      this.textValue(row.customer_wallet_status) !== 'ACTIVE' ||
      this.booleanValue(row.customer_wallet_deleted) ||
      this.textValue(row.wallet_status) !== 'ACTIVE'
    ) {
      discrepancies.push(
        this.createBindingDiscrepancy(
          CustomerFinancialAccountDiscrepancyType.LIFECYCLE_MISMATCH,
          'ERROR',
          'WALLET',
          'A3T08_HANDOFF',
          references,
          'Active binding sources are not all active',
        ),
      );
    }
  }

  private createBindingReport(
    discrepancies: CustomerFinancialAccountDiscrepancy[],
    bindingsChecked: number,
    activeBindingsChecked: number,
    customerWalletsChecked: number,
    financialWalletsChecked: number,
  ): CustomerFinancialAccountReconciliationReport {
    const sorted = [...discrepancies].sort((left, right) => left.key.localeCompare(right.key));
    const byType: Record<string, number> = {};
    for (const discrepancy of sorted) {
      byType[discrepancy.type] = (byType[discrepancy.type] ?? 0) + 1;
    }
    const errors = sorted.filter((discrepancy) => discrepancy.severity === 'ERROR').length;
    const warnings = sorted.filter((discrepancy) => discrepancy.severity === 'WARNING').length;
    return {
      status:
        errors > 0
          ? VerificationStatus.ERROR
          : warnings > 0
            ? VerificationStatus.WARNING
            : VerificationStatus.PASS,
      generatedAt: new Date().toISOString(),
      summary: {
        bindingsChecked,
        activeBindingsChecked,
        customerWalletsChecked,
        financialWalletsChecked,
        discrepancies: sorted.length,
        errors,
        warnings,
        byType,
      },
      discrepancies: sorted,
      repairPerformed: false,
    };
  }

  private bindingCheck(report: CustomerFinancialAccountReconciliationReport): ReconciliationCheck {
    const { summary } = report;
    return {
      name: 'customer_financial_account_binding_integrity',
      status: report.status,
      message:
        report.status === VerificationStatus.PASS
          ? 'Customer financial account bindings are consistent with customer-wallet, wallet, and ledger sources.'
          : `Customer financial account binding reconciliation reported ${summary.discrepancies} discrepancy(s).`,
      details: {
        bindings_checked: summary.bindingsChecked,
        active_bindings_checked: summary.activeBindingsChecked,
        customer_wallets_checked: summary.customerWalletsChecked,
        financial_wallets_checked: summary.financialWalletsChecked,
        discrepancies: summary.discrepancies,
        errors: summary.errors,
        warnings: summary.warnings,
        repair_performed: report.repairPerformed,
      },
    };
  }

  private createBindingDiscrepancy(
    type: CustomerFinancialAccountDiscrepancyType,
    severity: 'WARNING' | 'ERROR',
    owner: CustomerFinancialAccountDiscrepancy['owner'],
    recoveryState: CustomerFinancialAccountDiscrepancy['recoveryState'],
    references: Partial<CustomerFinancialAccountDiscrepancy>,
    message: string,
  ): CustomerFinancialAccountDiscrepancy {
    const bindingId = references.bindingId ?? null;
    const customerWalletId = references.customerWalletId ?? null;
    const walletAccountId = references.walletAccountId ?? null;
    const ledgerAccountId = references.ledgerAccountId ?? null;
    const scopeValue = references.scopeValue ?? null;
    const key = [type, bindingId, customerWalletId, walletAccountId, ledgerAccountId, scopeValue]
      .map((value) => value ?? '')
      .join(':');
    return {
      key,
      type,
      severity,
      owner,
      recoveryState,
      bindingId,
      customerId: references.customerId ?? null,
      customerWalletId,
      walletAccountId,
      ledgerAccountId,
      currency: references.currency ?? null,
      accountingUnit: references.accountingUnit ?? null,
      scopeValue,
      message,
    };
  }

  private booleanValue(value: unknown): boolean {
    return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
  }

  private nullableText(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    return this.textValue(value);
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
