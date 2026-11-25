import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  governedAction,
  governedChangeFingerprint,
  PLATFORM_FUNDS_BANK_COMPARISON_ACTION,
} from '../authorization/governed-action.registry';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import { AuditService } from '../operations/audit.service';
import { canonical } from '../authorization/workforce-crypto';
import {
  classifyAccounts,
  type FamilyRole,
  type RawAccountRow,
  type WalletOwnerClass,
} from './platform-funds-mapping';
import type {
  PlatformFundsBlocker,
  PlatformFundsBreakdown,
  PlatformFundsComparisonDetail,
  PlatformFundsComparisonScope,
  PlatformFundsComparisonStatus,
  PlatformFundsComparisonSummary,
  PlatformFundsJournalEvidence,
  PlatformFundsListResponse,
  PlatformFundsScopeView,
  PlatformFundsSettlementAccountOption,
  PlatformFundsTimingItem,
} from './platform-funds.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINOR_UNITS_SIGNED = /^-?\d{1,19}$/;
const ACTION = PLATFORM_FUNDS_BANK_COMPARISON_ACTION.action;
const RESOURCE_TYPE = PLATFORM_FUNDS_BANK_COMPARISON_ACTION.resourceType;
const MAX_TIMING_ITEMS = 50;
const MAX_FUTURE_SKEW_MS = 60_000;

/** Well-known provisioned family codes (migration 1785753600076), used only as a fallback. */
const WELL_KNOWN_FAMILY_CODE: Record<FamilyRole, string> = {
  FEE_REVENUE: 'FINANCE-FEE_REVENUE',
  VAT_PAYABLE: 'FINANCE-VAT_PAYABLE',
  COMMISSION_EXPENSE: 'FINANCE-COMMISSION_EXPENSE',
  COMMISSION_PAYABLE: 'FINANCE-COMMISSION_PAYABLE',
};

interface SettlementAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
  currency: string;
  institutional_scope: string;
  institution_id: string | null;
  institution_code: string | null;
  institution_name: string | null;
  institutional_purpose: string | null;
  is_active: boolean;
}

interface AggregateRow {
  account_id: string;
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
  scope: string;
  institution_id: string | null;
  institutional_purpose: string | null;
  debits: string;
  credits: string;
  line_count: string;
}

interface ComparisonRow {
  id: string;
  institution_id: string | null;
  scope: PlatformFundsComparisonScope;
  settlement_account_id: string;
  settlement_account_code: string;
  settlement_account_name: string;
  currency: string;
  accounting_unit: string;
  ledger_cutoff: Date;
  bank_cutoff: Date;
  statement_reference: string;
  bank_balance_minor: string;
  expected_minor: string;
  difference_minor: string;
  timing_total_minor: string;
  unexplained_minor: string;
  mapping_complete: boolean;
  blockers: PlatformFundsBlocker[];
  status: PlatformFundsComparisonStatus;
  approval_id: string | null;
  decision_reason: string | null;
  created_by: string;
  created_at: Date;
  submitted_by: string | null;
  submitted_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
}

interface TimingItemRow {
  id: string;
  comparison_id: string;
  title: string;
  reference: string;
  explanation: string;
  amount_minor: string;
  created_by: string;
  created_at: Date;
}

/**
 * Finance → Reconciliation, "Platform Funds vs. Bank Balance".
 *
 * Scope rules (enforced here, never in the screen):
 *
 * - PLATFORM comparisons (against an unattributed/platform-designated settlement account) are the
 *   platform bank's comparison and are visible to the finance audience (`ledger.view`).
 * - INSTITUTION comparisons (against an institution's own SETTLEMENT account) require platform
 *   authority (`institution.attribution.view`) or an ACTIVE
 *   `workforce_institution_assignments` row for that institution — read on every request.
 *   Out-of-scope identifiers are 404, never 403 (anti-probe).
 * - Creating, submitting or reviewing a comparison is additionally role-gated: FINANCE_PREPARER
 *   records and submits; FINANCE_CONTROLLER reviews. SUPER_ADMIN views but is neither maker nor
 *   checker (mirrors the FINANCE_PREPARER/FINANCE_CONTROLLER split used by LEDGER_JOURNAL_REVERSAL).
 */
@Injectable()
export class PlatformFundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: InstitutionWorkforceScopeService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ scope

  async scopeFor(principal: AuthorizationPrincipal): Promise<PlatformFundsScopeView> {
    const platformFunctionGranted = this.scope.hasPlatformAuthority(principal);
    if (platformFunctionGranted) {
      return { mode: 'PLATFORM', institutionIds: [], platformFunctionGranted };
    }
    const institutionIds = await this.scope.institutionIdsForPrincipal(principal.principalId);
    return {
      mode: institutionIds.length > 0 ? 'INSTITUTIONS' : 'NONE',
      institutionIds,
      platformFunctionGranted,
    };
  }

  private async institutionVisible(
    principal: AuthorizationPrincipal,
    institutionId: string | null,
  ): Promise<boolean> {
    if (!institutionId) return true; // PLATFORM scope row
    if (this.scope.hasPlatformAuthority(principal)) return true;
    const ids = await this.scope.institutionIdsForPrincipal(principal.principalId);
    return ids.includes(institutionId);
  }

  private async assertVisible(
    principal: AuthorizationPrincipal,
    row: ComparisonRow,
  ): Promise<void> {
    if (!(await this.institutionVisible(principal, row.institution_id))) {
      throw new NotFoundException('Comparison not found');
    }
  }

  private requireMaker(principal: AuthorizationPrincipal): void {
    if (!principal.roles.includes('FINANCE_PREPARER')) {
      throw new ForbiddenException(
        'Recording or submitting a platform funds comparison requires the FINANCE_PREPARER role',
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException('Recording or submitting a comparison requires an MFA session');
    }
  }

  private requireChecker(principal: AuthorizationPrincipal): void {
    if (!principal.roles.includes('FINANCE_CONTROLLER')) {
      throw new ForbiddenException(
        'Reviewing a platform funds comparison requires the FINANCE_CONTROLLER role',
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException('Reviewing a comparison requires an MFA session');
    }
  }

  // ---------------------------------------------------- settlement accounts

  async listSettlementAccounts(
    principal: AuthorizationPrincipal,
  ): Promise<{ items: PlatformFundsSettlementAccountOption[] }> {
    const platformAuthority = this.scope.hasPlatformAuthority(principal);
    const assigned = platformAuthority
      ? null
      : await this.scope.institutionIdsForPrincipal(principal.principalId);
    const rows: SettlementAccountRow[] = await this.dataSource.query(
      `SELECT a.id::text AS id, a.code, a.name, a.account_type, a.normal_balance, a.currency,
              a.institutional_scope, a.institution_id::text AS institution_id,
              a.institutional_purpose, fi.code AS institution_code, fi.display_name AS institution_name,
              a.is_active
         FROM ledger_accounts a
         LEFT JOIN financial_institutions fi ON fi.id = a.institution_id AND fi.deleted_at IS NULL
        WHERE a.is_active
          AND a.account_type = 'ASSET'
          AND a.accounting_unit = 'CUSTOMER_FUNDS'
          AND (
                (a.institutional_scope IN ('UNATTRIBUTED', 'PLATFORM')
                  AND a.code LIKE 'PAYMENT-SETTLEMENT_ASSET-%')
             OR (a.institutional_scope = 'INSTITUTION' AND a.institutional_purpose = 'SETTLEMENT')
              )
        ORDER BY a.currency ASC, a.code ASC`,
    );
    const items = rows.filter((row) => {
      if (row.institutional_scope !== 'INSTITUTION') return true;
      if (platformAuthority) return true;
      return assigned !== null && row.institution_id !== null && assigned.includes(row.institution_id);
    });
    return {
      items: items.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        accountType: row.account_type,
        currency: row.currency,
        scope: row.institutional_scope as 'UNATTRIBUTED' | 'PLATFORM' | 'INSTITUTION',
        institutionId: row.institution_id,
        institutionCode: row.institution_code,
        selectable: true,
        unavailableReason: null,
      })),
    };
  }

  private async getSelectableSettlementAccount(
    principal: AuthorizationPrincipal,
    settlementAccountId: string,
    queryable: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  ): Promise<SettlementAccountRow> {
    if (!UUID_PATTERN.test(settlementAccountId)) {
      throw new BadRequestException('settlementAccountId must be a UUID');
    }
    const rows = (await queryable.query(
      `SELECT a.id::text AS id, a.code, a.name, a.account_type, a.normal_balance, a.currency,
              a.institutional_scope, a.institution_id::text AS institution_id,
              a.institutional_purpose, fi.code AS institution_code, fi.display_name AS institution_name,
              a.is_active
         FROM ledger_accounts a
         LEFT JOIN financial_institutions fi ON fi.id = a.institution_id AND fi.deleted_at IS NULL
        WHERE a.id = $1`,
      [settlementAccountId],
    )) as SettlementAccountRow[];
    const row = rows[0];
    if (!row || !row.is_active) {
      throw new NotFoundException('Settlement account not found');
    }
    const platformEligible =
      row.institutional_scope !== 'INSTITUTION' &&
      row.account_type === 'ASSET' &&
      row.code.startsWith('PAYMENT-SETTLEMENT_ASSET-');
    const institutionEligible =
      row.institutional_scope === 'INSTITUTION' &&
      row.account_type === 'ASSET' &&
      row.institutional_purpose === 'SETTLEMENT' &&
      row.institution_id !== null;
    if (!platformEligible && !institutionEligible) {
      throw new BadRequestException(
        'Selected account is not a selectable bank or settlement account for this comparison',
      );
    }
    if (institutionEligible) {
      // 404 (never 403): an out-of-scope institution's settlement account must not be probeable.
      await this.scope.assertCanAccessInstitution(principal, row.institution_id!);
    }
    return row;
  }

  // ------------------------------------------------------- breakdown build

  private readonly aggregateSelect = `
    SELECT a.id::text AS account_id, a.code, a.name, a.account_type, a.normal_balance,
           a.institutional_scope AS scope, a.institution_id::text AS institution_id,
           a.institutional_purpose,
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS debits,
           COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS credits,
           COUNT(l.id)::text AS line_count
      FROM ledger_accounts a
      LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
      LEFT JOIN ledger_journals j
             ON j.id = l.journal_id AND j.status = 'POSTED' AND j.posted_at <= $2
     WHERE a.currency = $1 AND a.accounting_unit = 'CUSTOMER_FUNDS'
       AND `;

  private async buildBreakdown(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    selected: SettlementAccountRow,
    ledgerCutoff: Date,
  ): Promise<PlatformFundsBreakdown> {
    const q = (sql: string, params: unknown[]) =>
      queryable.query(sql, params) as Promise<unknown>;
    const currency = selected.currency;
    const scope: PlatformFundsComparisonScope =
      selected.institutional_scope === 'INSTITUTION' ? 'INSTITUTION' : 'PLATFORM';
    const institutionId = scope === 'INSTITUTION' ? selected.institution_id! : null;

    // ---- universe rows (every in-scope account except the selected one) ---------------------
    const universePredicate =
      scope === 'PLATFORM'
        ? `a.institutional_scope IN ('UNATTRIBUTED', 'PLATFORM') AND a.id <> $3`
        : `a.institutional_scope = 'INSTITUTION' AND a.institution_id = $3 AND a.id <> $4`;
    const universeParams: unknown[] =
      scope === 'PLATFORM'
        ? [currency, ledgerCutoff, selected.id]
        : [currency, ledgerCutoff, institutionId, selected.id];
    const universeRows = (await q(
      `${this.aggregateSelect}${universePredicate}
       GROUP BY a.id
       ORDER BY a.code`,
      universeParams,
    )) as AggregateRow[];

    // ---- the other books (control line) ------------------------------------------------------
    const controlPredicate =
      scope === 'PLATFORM'
        ? `a.institutional_scope = 'INSTITUTION'`
        : `a.institutional_scope IN ('UNATTRIBUTED', 'PLATFORM')`;
    const controlParams: unknown[] =
      scope === 'PLATFORM' ? [currency, ledgerCutoff] : [currency, ledgerCutoff];
    const controlRows = (await q(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS contribution,
              COUNT(DISTINCT a.id)::text AS account_count
         FROM ledger_accounts a
         JOIN ledger_lines l ON l.ledger_account_id = a.id
         JOIN ledger_journals j ON j.id = l.journal_id AND j.status = 'POSTED' AND j.posted_at <= $2
        WHERE a.currency = $1 AND a.accounting_unit = 'CUSTOMER_FUNDS'
          AND ${controlPredicate}`,
      controlParams,
    )) as Array<{ contribution: string; account_count: string }>;
    const controlContribution = BigInt(controlRows[0]?.contribution ?? '0');
    const controlAccountCount = Number(controlRows[0]?.account_count ?? '0');

    // ---- wallet enrichment (owner class per wallet-linked account) ----------------------------
    const walletPredicate = (
      scope === 'PLATFORM'
        ? `la.institutional_scope IN ('UNATTRIBUTED', 'PLATFORM')`
        : `la.institutional_scope = 'INSTITUTION' AND la.institution_id = $2`
    );
    const walletRows = (await q(
      `SELECT la.id::text AS account_id, w.owner_class
         FROM wallet_accounts w
         JOIN ledger_accounts la ON la.id = w.ledger_account_id
        WHERE la.currency = $1 AND la.accounting_unit = 'CUSTOMER_FUNDS'
          AND ${walletPredicate}`,
      scope === 'PLATFORM' ? [currency] : [currency, institutionId],
    )) as Array<{ account_id: string; owner_class: string }>;
    const walletOwner = new Map<string, WalletOwnerClass>();
    for (const row of walletRows) {
      walletOwner.set(row.account_id, row.owner_class as WalletOwnerClass);
    }

    // ---- commercial family resolution (registry first, well-known codes as fallback) ----------
    const familyAccounts = await this.resolveFamilyAccounts(q, currency);

    // ---- classify ------------------------------------------------------------------------------
    const rawRows: RawAccountRow[] = universeRows.map((row) => ({
      accountId: row.account_id,
      code: row.code,
      name: row.name,
      accountType: row.account_type,
      normalBalance: row.normal_balance as 'DEBIT' | 'CREDIT',
      scope: row.scope,
      institutionId: row.institution_id,
      institutionalPurpose: row.institutional_purpose,
      debits: BigInt(row.debits),
      credits: BigInt(row.credits),
      lineCount: Number(row.line_count),
      walletOwnerClass: walletOwner.get(row.account_id) ?? null,
      familyRole: familyAccounts.byAccountId.get(row.account_id) ?? null,
    }));
    const classified = classifyAccounts({
      universe: rawRows,
      controlContribution,
      controlAccountCount,
      scope,
      unprovisionedFamilies: familyAccounts.unprovisioned,
    });
    const notes = [...familyAccounts.notes, ...classified.notes];

    // ---- selected account evidence -------------------------------------------------------------
    const selectedRows = (await q(
      `${this.aggregateSelect}a.id = $3 GROUP BY a.id`,
      [currency, ledgerCutoff, selected.id],
    )) as AggregateRow[];
    const sel = selectedRows[0];
    const selDebits = BigInt(sel?.debits ?? '0');
    const selCredits = BigInt(sel?.credits ?? '0');
    const selectedNet = selDebits - selCredits;

    // ---- conservation of the entire books in this currency/unit --------------------------------
    const totalsRows = (await q(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS debits,
              COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS credits
         FROM ledger_lines l
         JOIN ledger_journals j ON j.id = l.journal_id
        WHERE j.status = 'POSTED' AND j.posted_at <= $2
          AND j.currency = $1 AND j.accounting_unit = 'CUSTOMER_FUNDS'`,
      [currency, ledgerCutoff],
    )) as Array<{ debits: string; credits: string }>;
    const totalDebits = BigInt(totalsRows[0]?.debits ?? '0');
    const totalCredits = BigInt(totalsRows[0]?.credits ?? '0');

    const journalRows = (await q(
      `SELECT COUNT(*)::text AS count, MAX(j.posted_at) AS max_posted_at
         FROM ledger_journals j
        WHERE j.status = 'POSTED' AND j.posted_at <= $2
          AND j.currency = $1 AND j.accounting_unit = 'CUSTOMER_FUNDS'`,
      [currency, ledgerCutoff],
    )) as Array<{ count: string; max_posted_at: Date | null }>;

    const linesConsidered =
      rawRows.reduce((sum, row) => sum + row.lineCount, 0) + Number(sel?.line_count ?? '0');

    const journalEvidence: PlatformFundsJournalEvidence = {
      ledgerCutoff: ledgerCutoff.toISOString(),
      journalsConsidered: Number(journalRows[0]?.count ?? '0'),
      linesConsidered: String(linesConsidered),
      maxPostedAt: journalRows[0]?.max_posted_at
        ? new Date(journalRows[0].max_posted_at).toISOString()
        : null,
      totalDebitsMinor: totalDebits.toString(),
      totalCreditsMinor: totalCredits.toString(),
      conserved: totalDebits === totalCredits,
    };

    // ---- totals, gap and blockers --------------------------------------------------------------
    const toEvidence = (row: RawAccountRow) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      accountType: row.accountType,
      normalBalance: row.normalBalance,
      scope: row.scope,
      institutionId: row.institutionId,
      institutionalPurpose: row.institutionalPurpose,
      debitMinor: row.debits.toString(),
      creditMinor: row.credits.toString(),
      balanceMinor: (row.normalBalance === 'DEBIT'
        ? row.debits - row.credits
        : row.credits - row.debits).toString(),
      contributionMinor: (row.credits - row.debits).toString(),
      lineCount: row.lineCount,
    });

    const lines = classified.lines.map((line) => ({
      key: line.key,
      label: line.label,
      kind: line.kind,
      group: line.group,
      note: line.note,
      accounts: line.accounts.map(toEvidence),
      debitMinor: line.debits.toString(),
      creditMinor: line.credits.toString(),
      contributionMinor: line.contribution.toString(),
    }));

    const breakdownTotal = classified.breakdownTotal;
    const reconciliationGap = breakdownTotal - selectedNet;
    const blockers: PlatformFundsBlocker[] = [...classified.blockers];
    if (reconciliationGap !== 0n) {
      blockers.push({
        code: 'CONSERVATION_GAP',
        message:
          'The breakdown does not reconcile to the settlement account balance. Double-entry conservation is broken somewhere in the books.',
        needed:
          'Run the ledger integrity checks (Finance → Reconciliation → internal checks) and escalate to the Finance Controller. Do not sign off until the gap is exactly zero.',
      });
    }
    if (!journalEvidence.conserved) {
      blockers.push({
        code: 'LEDGER_NOT_CONSERVED',
        message:
          'Posted journals in this currency/accounting unit do not conserve debits = credits. The ledger itself is inconsistent.',
        needed:
          'Finance escalation + ledger governance repair (governed reversal of the offending journals). Do not sign off.',
      });
    }

    const mappingComplete = blockers.length === 0;

    const evidenceHash = createHash('sha256')
      .update(
        canonical({
          settlementAccountId: selected.id,
          currency,
          accountingUnit: 'CUSTOMER_FUNDS',
          ledgerCutoff: ledgerCutoff.toISOString(),
          scope,
          expectedMinor: selectedNet.toString(),
          breakdownTotalMinor: breakdownTotal.toString(),
          control: classified.controlLine.netContribution.toString(),
          conserved: journalEvidence.conserved,
          lines: lines.map((line) => ({
            key: line.key,
            contributionMinor: line.contributionMinor,
            accounts: line.accounts.map((account) => ({
              id: account.accountId,
              contributionMinor: account.contributionMinor,
              lineCount: account.lineCount,
            })),
          })),
          blockerCodes: blockers.map((blocker) => blocker.code).sort(),
        }),
      )
      .digest('hex');

    return {
      scope,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      ledgerCutoff: ledgerCutoff.toISOString(),
      settlementAccount: {
        id: selected.id,
        code: selected.code,
        name: selected.name,
        accountType: selected.account_type,
        normalBalance: selected.normal_balance,
        scope: selected.institutional_scope,
        institutionId: selected.institution_id,
        institutionalPurpose: selected.institutional_purpose,
        expectedMinor: selectedNet.toString(),
        debitMinor: selDebits.toString(),
        creditMinor: selCredits.toString(),
        balanceMinor:
          selected.normal_balance === 'DEBIT'
            ? selectedNet.toString()
            : (selCredits - selDebits).toString(),
        lineCount: Number(sel?.line_count ?? '0'),
      },
      lines,
      controlLine: {
        key: classified.controlLine.key,
        label: classified.controlLine.label,
        netMinor: classified.controlLine.netContribution.toString(),
        ok: classified.controlLine.ok,
        accountCount: classified.controlLine.accountCount,
      },
      breakdownTotalMinor: breakdownTotal.toString(),
      reconciliationGapMinor: reconciliationGap.toString(),
      mappingComplete,
      blockers,
      journalEvidence,
      notes,
      evidenceHash,
      generatedAt: new Date().toISOString(),
    };
  }

  private async resolveFamilyAccounts(
    q: (sql: string, params: unknown[]) => Promise<unknown>,
    currency: string,
  ): Promise<{
    byAccountId: Map<string, FamilyRole>;
    unprovisioned: FamilyRole[];
    notes: string[];
  }> {
    const byAccountId = new Map<string, FamilyRole>();
    const unprovisioned: FamilyRole[] = [];
    const notes: string[] = [];
    let registryRows: Array<{ family_code: string; account_code: string }> = [];
    try {
      registryRows = (await q(
        `SELECT family_code, account_code FROM commercial_accounting_registry WHERE currency = $1`,
        [currency],
      )) as Array<{ family_code: string; account_code: string }>;
    } catch {
      registryRows = []; // registry missing (pre-commercial deployments) — fall back to well-known codes
    }
    const registryByFamily = new Map(registryRows.map((row) => [row.family_code, row.account_code]));

    for (const role of [
      'FEE_REVENUE',
      'VAT_PAYABLE',
      'COMMISSION_EXPENSE',
      'COMMISSION_PAYABLE',
    ] as FamilyRole[]) {
      const fromRegistry = registryByFamily.get(role);
      const candidates = [fromRegistry, `${WELL_KNOWN_FAMILY_CODE[role]}-${currency}`].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      let resolvedId: string | null = null;
      for (const code of candidates) {
        const rows = (await q(
          `SELECT id::text AS id FROM ledger_accounts
            WHERE code = $1 AND currency = $2 AND accounting_unit = 'CUSTOMER_FUNDS' AND is_active = TRUE
            LIMIT 1`,
          [code, currency],
        )) as Array<{ id: string }>;
        if (rows[0]) {
          resolvedId = rows[0].id;
          if (!fromRegistry) {
            notes.push(
              `${role} resolved by well-known code ${code} (no commercial_accounting_registry row); confirm the registry is provisioned.`,
            );
          }
          break;
        }
      }
      if (resolvedId) byAccountId.set(resolvedId, role);
      else unprovisioned.push(role);
    }
    return { byAccountId, unprovisioned, notes };
  }

  // ------------------------------------------------------------ serialization

  private readonly rowSelect = `
    SELECT c.id::text AS id, c.institution_id::text AS institution_id, c.scope,
           c.settlement_account_id::text AS settlement_account_id,
           sa.code AS settlement_account_code, sa.name AS settlement_account_name,
           c.currency, c.accounting_unit, c.ledger_cutoff, c.bank_cutoff, c.statement_reference,
           c.bank_balance_minor::text AS bank_balance_minor, c.expected_minor::text AS expected_minor,
           c.difference_minor::text AS difference_minor, c.timing_total_minor::text AS timing_total_minor,
           c.unexplained_minor::text AS unexplained_minor, c.mapping_complete, c.blockers, c.status,
           c.approval_id::text AS approval_id, c.decision_reason,
           c.created_by, c.created_at, c.submitted_by, c.submitted_at, c.reviewed_by, c.reviewed_at
      FROM platform_funds_comparisons c
      JOIN ledger_accounts sa ON sa.id = c.settlement_account_id`;

  private iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  }

  private isoNullable(value: unknown): string | null {
    return value == null ? null : this.iso(value);
  }

  private serializeSummary(row: ComparisonRow): PlatformFundsComparisonSummary {
    return {
      id: row.id,
      scope: row.scope,
      institutionId: row.institution_id,
      settlementAccountId: row.settlement_account_id,
      settlementAccountCode: row.settlement_account_code,
      settlementAccountName: row.settlement_account_name,
      currency: row.currency,
      accountingUnit: row.accounting_unit,
      status: row.status,
      ledgerCutoff: this.iso(row.ledger_cutoff),
      bankCutoff: this.iso(row.bank_cutoff),
      statementReference: row.statement_reference,
      bankBalanceMinor: row.bank_balance_minor,
      expectedMinor: row.expected_minor,
      differenceMinor: row.difference_minor,
      timingTotalMinor: row.timing_total_minor,
      unexplainedMinor: row.unexplained_minor,
      mappingComplete: row.mapping_complete,
      createdBy: row.created_by,
      createdAt: this.iso(row.created_at),
      submittedBy: row.submitted_by,
      submittedAt: this.isoNullable(row.submitted_at),
      reviewedBy: row.reviewed_by,
      reviewedAt: this.isoNullable(row.reviewed_at),
    };
  }

  private serializeTimingItem(row: TimingItemRow): PlatformFundsTimingItem {
    return {
      id: row.id,
      title: row.title,
      reference: row.reference,
      explanation: row.explanation,
      amountMinor: row.amount_minor,
      createdBy: row.created_by,
      createdAt: this.iso(row.created_at),
    };
  }

  private async timingItemsFor(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    comparisonId: string,
  ): Promise<PlatformFundsTimingItem[]> {
    const rows = (await queryable.query(
      `SELECT id::text AS id, comparison_id::text AS comparison_id, title, reference, explanation,
              amount_minor::text AS amount_minor, created_by, created_at
         FROM platform_funds_timing_items
        WHERE comparison_id = $1
        ORDER BY created_at ASC, id ASC`,
      [comparisonId],
    )) as TimingItemRow[];
    return rows.map((row) => this.serializeTimingItem(row));
  }

  private timingTotal(items: PlatformFundsTimingItem[]): bigint {
    return items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  }

  private async lockComparison(
    manager: EntityManager,
    id: string,
  ): Promise<ComparisonRow> {
    const rows = (await manager.query(
      `${this.rowSelect} WHERE c.id = $1 FOR UPDATE OF c`,
      [id],
    )) as ComparisonRow[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Comparison not found');
    return row;
  }

  private async insertSnapshot(
    manager: EntityManager,
    input: {
      comparisonId: string;
      reason: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED';
      breakdown: PlatformFundsBreakdown;
      row: { ledgerCutoff: Date; bankCutoff: Date; statementReference: string; bankBalanceMinor: string };
      timingItems: PlatformFundsTimingItem[];
      differenceMinor: bigint;
      unexplainedMinor: bigint;
      createdBy: string;
    },
  ): Promise<void> {
    const timingTotal = this.timingTotal(input.timingItems);
    const id = randomUUID();
    // The caller holds a FOR UPDATE lock on the comparison row, so no concurrent snapshot
    // writer exists for this comparison: read-then-insert is race-free.
    const versionRows = (await manager.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM platform_funds_comparison_snapshots WHERE comparison_id = $1`,
      [input.comparisonId],
    )) as Array<{ next: string }>;
    const version = Number(versionRows[0]?.next ?? '1');
    const snapshotJson = {
      ...input.breakdown,
      comparisonId: input.comparisonId,
      bankCutoff: this.iso(input.row.bankCutoff),
      statementReference: input.row.statementReference,
      bankBalanceMinor: input.row.bankBalanceMinor,
      differenceMinor: input.differenceMinor.toString(),
      timingItems: input.timingItems,
      timingTotalMinor: timingTotal.toString(),
      unexplainedMinor: input.unexplainedMinor.toString(),
      snapshotReason: input.reason,
      snapshotVersion: version,
    };
    await manager.query(
      `INSERT INTO platform_funds_comparison_snapshots
         (id, comparison_id, version, reason, snapshot, evidence_hash, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        id,
        input.comparisonId,
        version,
        input.reason,
        JSON.stringify(snapshotJson),
        input.breakdown.evidenceHash,
        input.createdBy,
      ],
    );
  }

  // -------------------------------------------------------------- rendering

  private parseCutoff(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO-8601 timestamp`);
    }
    if (date.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException(`${field} cannot be in the future`);
    }
    return date;
  }

  private parseSignedMinor(value: string, field: string): bigint {
    const trimmed = value.trim();
    if (!MINOR_UNITS_SIGNED.test(trimmed)) {
      throw new BadRequestException(`${field} must be a signed integer string of minor units`);
    }
    const parsed = BigInt(trimmed);
    if (parsed > 9223372036854775807n || parsed < -9223372036854775808n) {
      throw new BadRequestException(`${field} is out of range for a bigint column`);
    }
    return parsed;
  }

  private async getSettlementRow(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    settlementAccountId: string,
  ): Promise<SettlementAccountRow> {
    const rows = (await queryable.query(
      `SELECT a.id::text AS id, a.code, a.name, a.account_type, a.normal_balance, a.currency,
              a.institutional_scope, a.institution_id::text AS institution_id,
              a.institutional_purpose, fi.code AS institution_code, fi.display_name AS institution_name,
              a.is_active
         FROM ledger_accounts a
         LEFT JOIN financial_institutions fi ON fi.id = a.institution_id AND fi.deleted_at IS NULL
        WHERE a.id = $1`,
      [settlementAccountId],
    )) as SettlementAccountRow[];
    if (!rows[0]) throw new NotFoundException('Settlement account not found');
    return rows[0];
  }

  private async buildDetail(
    principal: AuthorizationPrincipal,
    row: ComparisonRow,
    precomputedBreakdown?: PlatformFundsBreakdown,
    queryable: { query: (sql: string, params?: unknown[]) => Promise<unknown> } = this.dataSource,
    approvalOverride?: PlatformFundsComparisonDetail['approval'] | null,
  ): Promise<PlatformFundsComparisonDetail> {
    const decided = row.status === 'APPROVED' || row.status === 'REJECTED';
    let breakdown: PlatformFundsBreakdown;
    if (precomputedBreakdown) {
      breakdown = precomputedBreakdown;
    } else if (decided) {
      const snapshotRows = (await queryable.query(
        `SELECT snapshot FROM platform_funds_comparison_snapshots
          WHERE comparison_id = $1 ORDER BY version DESC LIMIT 1`,
        [row.id],
      )) as Array<{ snapshot: Record<string, unknown> }>;
      if (!snapshotRows[0]) {
        // Unreachable in practice (every decided comparison carries REVIEW_* snapshots); fall back
        // to a live recompute rather than serving an empty page.
        const selected = await this.getSettlementRow(queryable, row.settlement_account_id);
        breakdown = await this.buildBreakdown(queryable, selected, this.isoDate(row.ledger_cutoff));
      } else {
        breakdown = snapshotRows[0].snapshot as unknown as PlatformFundsBreakdown;
      }
    } else {
      const selected = await this.getSettlementRow(queryable, row.settlement_account_id);
      breakdown = await this.buildBreakdown(queryable, selected, this.isoDate(row.ledger_cutoff));
    }

    const timingItems = await this.timingItemsFor(queryable, row.id);
    const snapshotCountRows = (await queryable.query(
      `SELECT COUNT(*)::text AS count FROM platform_funds_comparison_snapshots WHERE comparison_id = $1`,
      [row.id],
    )) as Array<{ count: string }>;
    let approvalView: Awaited<ReturnType<PrivilegedActionApprovalService['getApproval']>> = null;
    if (approvalOverride === undefined && row.approval_id) {
      try {
        approvalView = await this.approvals.getApproval(row.approval_id);
      } catch {
        approvalView = null; // approval row not yet visible outside the open transaction
      }
    }
    const approval: PlatformFundsComparisonDetail['approval'] =
      approvalOverride !== undefined
        ? approvalOverride
        : approvalView
          ? {
              id: approvalView.id,
              status: approvalView.status,
              actionType: approvalView.actionType,
              requestedBy: approvalView.requesterPrincipalId,
              approvedBy: approvalView.approvedBy,
              requestedAt: this.iso(approvalView.requestedAt),
              expiresAt: this.iso(approvalView.expiresAt),
              reason: approvalView.reason ?? '',
            }
          : null;
    const selfApprovalDenied =
      row.submitted_by !== null && row.submitted_by === principal.principalId;

    const blockingReasons: string[] = [];
    if (row.status === 'DRAFT' && !breakdown.mappingComplete) {
      blockingReasons.push(...breakdown.blockers.map((blocker) => blocker.message));
    }
    if (row.status === 'SUBMITTED' && selfApprovalDenied) {
      blockingReasons.push('You submitted this comparison; a different FINANCE_CONTROLLER must review it.');
    }
    if (approval && approval.status === 'EXPIRED') {
      blockingReasons.push('The governed approval expired before review; the comparison must be resubmitted.');
    }

    const canSubmit = row.status === 'DRAFT' && breakdown.mappingComplete;
    const canReview =
      row.status === 'SUBMITTED' &&
      principal.roles.includes('FINANCE_CONTROLLER') &&
      principal.assuranceLevel === 'MFA' &&
      !selfApprovalDenied &&
      approval?.status === 'REQUESTED';

    return {
      ...this.serializeSummary(row),
      blockers: decided ? breakdown.blockers : breakdown.blockers,
      decisionReason: row.decision_reason,
      timingItems,
      breakdown,
      approvalId: row.approval_id,
      approval,
      selfApprovalDenied,
      snapshotCount: Number(snapshotCountRows[0]?.count ?? '0'),
      canSubmit,
      canReview,
      blockingReasons,
    };
  }

  private isoDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(String(value));
  }

  private async auditEvent(
    manager: EntityManager,
    action: string,
    principal: AuthorizationPrincipal,
    comparisonId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(manager, {
      entityType: 'PLATFORM_FUNDS_COMPARISON',
      entityId: comparisonId,
      action,
      actor: principal.principalId,
      newValues: values,
    });
  }

  // -------------------------------------------------------------- public API

  async preview(
    principal: AuthorizationPrincipal,
    dto: { settlementAccountId: string; ledgerCutoff: string },
  ): Promise<PlatformFundsBreakdown> {
    const selected = await this.getSelectableSettlementAccount(
      principal,
      dto.settlementAccountId,
      this.dataSource,
    );
    return this.buildBreakdown(this.dataSource, selected, this.parseCutoff(dto.ledgerCutoff, 'ledgerCutoff'));
  }

  async list(
    principal: AuthorizationPrincipal,
    query: {
      scope?: 'PLATFORM' | 'INSTITUTION';
      status?: PlatformFundsComparisonStatus;
      institutionId?: string;
      limit?: string;
      offset?: string;
    },
  ): Promise<PlatformFundsListResponse> {
    const limit = Math.min(Math.max(Number(query.limit ?? '25') || 25, 1), 100);
    const offset = Math.max(Number(query.offset ?? '0') || 0, 0);
    const scopeView = await this.scopeFor(principal);

    const conditions: string[] = ['1 = 1'];
    const params: unknown[] = [];
    const push = (condition: string, value: unknown): void => {
      params.push(value);
      conditions.push(condition.replace('?', `$${params.length}`));
    };

    if (scopeView.mode === 'NONE') {
      return { items: [], total: 0, limit, offset, scope: scopeView };
    }
    if (scopeView.mode === 'PLATFORM') {
      if (query.scope) push('c.scope = ?', query.scope);
    } else {
      // Institution-assigned workforce: institution visibility is OR'ed with platform-scope rows,
      // never wider than the ACTIVE assignment list.
      params.push(scopeView.institutionIds);
      conditions.push(`(c.scope = 'PLATFORM' OR c.institution_id = ANY($${params.length}::uuid[]))`);
      if (query.scope) push('c.scope = ?', query.scope);
    }
    if (query.institutionId) {
      if (!UUID_PATTERN.test(query.institutionId)) {
        throw new BadRequestException('institutionId must be a UUID');
      }
      await this.scope.assertCanAccessInstitution(principal, query.institutionId);
      push('c.institution_id = ?', query.institutionId);
    }
    if (query.status) push('c.status = ?', query.status);

    const where = conditions.join(' AND ');
    const totalRows = (await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM platform_funds_comparisons c WHERE ${where}`,
      params,
    )) as Array<{ count: string }>;
    const rows = (await this.dataSource.query(
      `${this.rowSelect} WHERE ${where} ORDER BY c.created_at DESC, c.id ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    )) as ComparisonRow[];
    return {
      items: rows.map((row) => this.serializeSummary(row)),
      total: Number(totalRows[0]?.count ?? '0'),
      limit,
      offset,
      scope: scopeView,
    };
  }

  async get(principal: AuthorizationPrincipal, id: string): Promise<PlatformFundsComparisonDetail> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException('Comparison not found');
    const rows = (await this.dataSource.query(`${this.rowSelect} WHERE c.id = $1`, [
      id,
    ])) as ComparisonRow[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Comparison not found');
    await this.assertVisible(principal, row);
    return this.buildDetail(principal, row);
  }

  async snapshots(
    principal: AuthorizationPrincipal,
    id: string,
  ): Promise<{ items: unknown[] }> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException('Comparison not found');
    const rows = (await this.dataSource.query(`${this.rowSelect} WHERE c.id = $1`, [
      id,
    ])) as ComparisonRow[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Comparison not found');
    await this.assertVisible(principal, row);
    const snapshotRows = (await this.dataSource.query(
      `SELECT id::text AS id, comparison_id::text AS "comparisonId", version, reason,
              snapshot, evidence_hash AS "evidenceHash", created_by AS "createdBy", created_at AS "createdAt"
         FROM platform_funds_comparison_snapshots
        WHERE comparison_id = $1
        ORDER BY version ASC`,
      [id],
    )) as Array<Record<string, unknown>>;
    return {
      items: snapshotRows.map((snapshot) => ({
        ...snapshot,
        createdAt: this.iso(snapshot.createdAt),
      })),
    };
  }

  async create(
    principal: AuthorizationPrincipal,
    dto: {
      settlementAccountId: string;
      ledgerCutoff: string;
      bankCutoff: string;
      statementReference: string;
      bankBalanceMinor: string;
    },
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireMaker(principal);
    const ledgerCutoff = this.parseCutoff(dto.ledgerCutoff, 'ledgerCutoff');
    const bankCutoff = this.parseCutoff(dto.bankCutoff, 'bankCutoff');
    const statementReference = dto.statementReference.trim();
    if (statementReference.length < 3 || statementReference.length > 255) {
      throw new BadRequestException('statementReference must be 3-255 characters');
    }
    const bankBalance = this.parseSignedMinor(dto.bankBalanceMinor, 'bankBalanceMinor');
    const id = randomUUID();

    return this.dataSource.transaction(async (manager) => {
      const selected = await this.getSelectableSettlementAccount(
        principal,
        dto.settlementAccountId,
        manager,
      );
      const breakdown = await this.buildBreakdown(manager, selected, ledgerCutoff);
      const scope: PlatformFundsComparisonScope =
        selected.institutional_scope === 'INSTITUTION' ? 'INSTITUTION' : 'PLATFORM';
      const institutionId = scope === 'INSTITUTION' ? selected.institution_id! : null;
      const expected = BigInt(breakdown.settlementAccount.expectedMinor);
      const difference = bankBalance - expected;
      const timingTotal = 0n;
      const unexplained = difference - timingTotal;

      await manager.query(
        `INSERT INTO platform_funds_comparisons
           (id, institution_id, scope, settlement_account_id, currency, accounting_unit,
            ledger_cutoff, bank_cutoff, statement_reference, bank_balance_minor, expected_minor,
            difference_minor, timing_total_minor, unexplained_minor, mapping_complete, blockers,
            status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'CUSTOMER_FUNDS', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 'DRAFT', $16)`,
        [
          id,
          institutionId,
          scope,
          selected.id,
          selected.currency,
          ledgerCutoff,
          bankCutoff,
          statementReference,
          bankBalance.toString(),
          expected.toString(),
          difference.toString(),
          timingTotal.toString(),
          unexplained.toString(),
          breakdown.mappingComplete,
          JSON.stringify(breakdown.blockers),
          principal.principalId,
        ],
      );
      const row = await this.lockComparison(manager, id);
      await this.insertSnapshot(manager, {
        comparisonId: id,
        reason: 'CREATED',
        breakdown,
        row: {
          ledgerCutoff,
          bankCutoff,
          statementReference,
          bankBalanceMinor: bankBalance.toString(),
        },
        timingItems: [],
        differenceMinor: difference,
        unexplainedMinor: unexplained,
        createdBy: principal.principalId,
      });
      await this.auditEvent(manager, 'PLATFORM_FUNDS_COMPARISON_CREATED', principal, id, {
        scope,
        settlementAccountId: selected.id,
        currency: selected.currency,
        ledgerCutoff: ledgerCutoff.toISOString(),
        bankCutoff: bankCutoff.toISOString(),
        statementReference,
        bankBalanceMinor: bankBalance.toString(),
        expectedMinor: expected.toString(),
        differenceMinor: difference.toString(),
        mappingComplete: breakdown.mappingComplete,
        evidenceHash: breakdown.evidenceHash,
      });
      return this.buildDetail(principal, row, breakdown, manager, null);
    });
  }

  private async loadLockedVisibleComparison(
    principal: AuthorizationPrincipal,
    manager: EntityManager,
    id: string,
  ): Promise<ComparisonRow> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException('Comparison not found');
    const row = await this.lockComparison(manager, id);
    await this.assertVisible(principal, row);
    return row;
  }

  private async refreshDerived(
    manager: EntityManager,
    row: ComparisonRow,
    breakdown: PlatformFundsBreakdown,
    timingItems: PlatformFundsTimingItem[],
    bankBalanceMinor: bigint,
  ): Promise<{ difference: bigint; timingTotal: bigint; unexplained: bigint }> {
    const expected = BigInt(breakdown.settlementAccount.expectedMinor);
    const difference = bankBalanceMinor - expected;
    const timingTotal = this.timingTotal(timingItems);
    const unexplained = difference - timingTotal;
    await manager.query(
      `UPDATE platform_funds_comparisons
          SET expected_minor = $2, difference_minor = $3, timing_total_minor = $4,
              unexplained_minor = $5, mapping_complete = $6, blockers = $7::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        row.id,
        expected.toString(),
        difference.toString(),
        timingTotal.toString(),
        unexplained.toString(),
        breakdown.mappingComplete,
        JSON.stringify(breakdown.blockers),
      ],
    );
    return { difference, timingTotal, unexplained };
  }

  async update(
    principal: AuthorizationPrincipal,
    id: string,
    dto: {
      ledgerCutoff?: string;
      bankCutoff?: string;
      statementReference?: string;
      bankBalanceMinor?: string;
    },
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireMaker(principal);
    return this.dataSource.transaction(async (manager) => {
      const row = await this.loadLockedVisibleComparison(principal, manager, id);
      if (row.status !== 'DRAFT') {
        throw new ConflictException('Only a DRAFT comparison can be edited');
      }
      const ledgerCutoff = dto.ledgerCutoff
        ? this.parseCutoff(dto.ledgerCutoff, 'ledgerCutoff')
        : this.isoDate(row.ledger_cutoff);
      const bankCutoff = dto.bankCutoff
        ? this.parseCutoff(dto.bankCutoff, 'bankCutoff')
        : this.isoDate(row.bank_cutoff);
      const statementReference = dto.statementReference?.trim() ?? row.statement_reference;
      if (statementReference.length < 3 || statementReference.length > 255) {
        throw new BadRequestException('statementReference must be 3-255 characters');
      }
      const bankBalance = dto.bankBalanceMinor
        ? this.parseSignedMinor(dto.bankBalanceMinor, 'bankBalanceMinor')
        : BigInt(row.bank_balance_minor);

      const selected = await this.getSettlementRow(manager, row.settlement_account_id);
      const breakdown = await this.buildBreakdown(manager, selected, ledgerCutoff);
      const timingItems = await this.timingItemsFor(manager, row.id);
      const { difference, unexplained } = await this.refreshDerived(
        manager,
        row,
        breakdown,
        timingItems,
        bankBalance,
      );
      await manager.query(
        `UPDATE platform_funds_comparisons
            SET ledger_cutoff = $2, bank_cutoff = $3, statement_reference = $4,
                bank_balance_minor = $5, updated_at = now()
          WHERE id = $1`,
        [row.id, ledgerCutoff, bankCutoff, statementReference, bankBalance.toString()],
      );
      const updatedRow = await this.lockComparison(manager, row.id);
      await this.insertSnapshot(manager, {
        comparisonId: row.id,
        reason: 'UPDATED',
        breakdown,
        row: {
          ledgerCutoff,
          bankCutoff,
          statementReference,
          bankBalanceMinor: bankBalance.toString(),
        },
        timingItems,
        differenceMinor: difference,
        unexplainedMinor: unexplained,
        createdBy: principal.principalId,
      });
      await this.auditEvent(manager, 'PLATFORM_FUNDS_COMPARISON_UPDATED', principal, row.id, {
        ledgerCutoff: ledgerCutoff.toISOString(),
        bankCutoff: bankCutoff.toISOString(),
        statementReference,
        bankBalanceMinor: bankBalance.toString(),
        evidenceHash: breakdown.evidenceHash,
      });
      return this.buildDetail(principal, updatedRow, breakdown, manager, null);
    });
  }

  async addTimingItem(
    principal: AuthorizationPrincipal,
    id: string,
    dto: { title: string; reference: string; explanation: string; amountMinor: string },
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireMaker(principal);
    const title = dto.title.trim();
    const reference = dto.reference.trim();
    const explanation = dto.explanation.trim();
    if (title.length < 3 || title.length > 160)
      throw new BadRequestException('title must be 3-160 characters');
    if (reference.length < 3 || reference.length > 120)
      throw new BadRequestException('reference must be 3-120 characters');
    if (explanation.length < 3 || explanation.length > 1000)
      throw new BadRequestException('explanation must be 3-1000 characters');
    const amount = this.parseSignedMinor(dto.amountMinor, 'amountMinor');
    if (amount === 0n) throw new BadRequestException('amountMinor must not be zero');

    return this.dataSource.transaction(async (manager) => {
      const row = await this.loadLockedVisibleComparison(principal, manager, id);
      if (row.status !== 'DRAFT') {
        throw new ConflictException('Timing items can only change while the comparison is a DRAFT');
      }
      const countRows = (await manager.query(
        `SELECT COUNT(*)::text AS count FROM platform_funds_timing_items WHERE comparison_id = $1`,
        [row.id],
      )) as Array<{ count: string }>;
      if (Number(countRows[0]?.count ?? '0') >= MAX_TIMING_ITEMS) {
        throw new BadRequestException(`A comparison may hold at most ${MAX_TIMING_ITEMS} timing items`);
      }
      await manager.query(
        `INSERT INTO platform_funds_timing_items
           (id, comparison_id, title, reference, explanation, amount_minor, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), row.id, title, reference, explanation, amount.toString(), principal.principalId],
      );
      const timingItems = await this.timingItemsFor(manager, row.id);
      const selected = await this.getSettlementRow(manager, row.settlement_account_id);
      const breakdown = await this.buildBreakdown(
        manager,
        selected,
        this.isoDate(row.ledger_cutoff),
      );
      await this.refreshDerived(
        manager,
        row,
        breakdown,
        timingItems,
        BigInt(row.bank_balance_minor),
      );
      await this.auditEvent(manager, 'PLATFORM_FUNDS_TIMING_ITEM_ADDED', principal, row.id, {
        title,
        reference,
        amountMinor: amount.toString(),
      });
      const updatedRow = await this.lockComparison(manager, row.id);
      return this.buildDetail(principal, updatedRow, breakdown, manager, null);
    });
  }

  async removeTimingItem(
    principal: AuthorizationPrincipal,
    id: string,
    itemId: string,
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireMaker(principal);
    if (!UUID_PATTERN.test(itemId)) throw new NotFoundException('Timing item not found');
    return this.dataSource.transaction(async (manager) => {
      const row = await this.loadLockedVisibleComparison(principal, manager, id);
      if (row.status !== 'DRAFT') {
        throw new ConflictException('Timing items can only change while the comparison is a DRAFT');
      }
      const deleted = (await manager.query(
        `DELETE FROM platform_funds_timing_items WHERE id = $1 AND comparison_id = $2 RETURNING id::text AS id, title, reference, amount_minor::text AS amount_minor`,
        [itemId, row.id],
      )) as Array<{ id: string; title: string; reference: string; amount_minor: string }>;
      if (!deleted[0]) throw new NotFoundException('Timing item not found');
      const timingItems = await this.timingItemsFor(manager, row.id);
      const selected = await this.getSettlementRow(manager, row.settlement_account_id);
      const breakdown = await this.buildBreakdown(
        manager,
        selected,
        this.isoDate(row.ledger_cutoff),
      );
      await this.refreshDerived(
        manager,
        row,
        breakdown,
        timingItems,
        BigInt(row.bank_balance_minor),
      );
      await this.auditEvent(manager, 'PLATFORM_FUNDS_TIMING_ITEM_REMOVED', principal, row.id, {
        itemId,
        title: deleted[0].title,
        reference: deleted[0].reference,
        amountMinor: deleted[0].amount_minor,
      });
      const updatedRow = await this.lockComparison(manager, row.id);
      return this.buildDetail(principal, updatedRow, breakdown, manager, null);
    });
  }

  async submit(
    principal: AuthorizationPrincipal,
    id: string,
    dto: { reason: string },
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireMaker(principal);
    const reason = dto.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new BadRequestException('reason must be 3-500 characters');
    }
    return this.dataSource.transaction(async (manager) => {
      const row = await this.loadLockedVisibleComparison(principal, manager, id);
      if (row.status !== 'DRAFT') {
        throw new ConflictException('Only a DRAFT comparison can be submitted for review');
      }
      const selected = await this.getSettlementRow(manager, row.settlement_account_id);
      const breakdown = await this.buildBreakdown(manager, selected, this.isoDate(row.ledger_cutoff));
      const timingItems = await this.timingItemsFor(manager, row.id);
      const bankBalance = BigInt(row.bank_balance_minor);
      const { difference, timingTotal, unexplained } = await this.refreshDerived(
        manager,
        row,
        breakdown,
        timingItems,
        bankBalance,
      );
      if (!breakdown.mappingComplete) {
        throw new ConflictException({
          message:
            'Sign-off is blocked: the ledger mapping is incomplete or ambiguous. Resolve the listed blockers, then submit again.',
          blockers: breakdown.blockers,
        });
      }

      const ledgerCutoffIso = this.iso(row.ledger_cutoff);
      const bankCutoffIso = this.iso(row.bank_cutoff);
      const fingerprint = governedChangeFingerprint(ACTION, RESOURCE_TYPE, row.id, {
        settlementAccountId: row.settlement_account_id,
        currency: row.currency,
        accountingUnit: row.accounting_unit,
        ledgerCutoff: ledgerCutoffIso,
        bankCutoff: bankCutoffIso,
        statementReference: row.statement_reference,
        bankBalanceMinor: bankBalance.toString(),
        expectedMinor: breakdown.settlementAccount.expectedMinor,
        differenceMinor: difference.toString(),
        timingTotalMinor: timingTotal.toString(),
        unexplainedMinor: unexplained.toString(),
        timingItems: timingItems.map((item) => ({
          title: item.title,
          reference: item.reference,
          amountMinor: item.amountMinor,
        })),
        evidenceHash: breakdown.evidenceHash,
      });

      const definition = governedAction(ACTION)!;
      const decision = await this.approvals.requestInTransaction(manager, {
        principal,
        policy: {
          resourceType: RESOURCE_TYPE,
          action: ACTION,
          allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
          requiredRoles: definition.initiatingRoles,
          requiredFunctions: definition.initiatingFunctionCodes,
          minimumAssurance: 'MFA',
          customerAccess: 'NONE',
        },
        resource: { type: RESOURCE_TYPE, id: row.id },
        actionFingerprint: fingerprint,
        reason,
        requestDetails: {
          scope: row.scope,
          institutionId: row.institution_id,
          settlementAccountCode: row.settlement_account_code,
          currency: row.currency,
          ledgerCutoff: ledgerCutoffIso,
          bankCutoff: bankCutoffIso,
          statementReference: row.statement_reference,
          bankBalanceMinor: bankBalance.toString(),
          expectedMinor: breakdown.settlementAccount.expectedMinor,
          differenceMinor: difference.toString(),
          timingTotalMinor: timingTotal.toString(),
          unexplainedMinor: unexplained.toString(),
          timingItems: timingItems.map((item) => ({
            title: item.title,
            reference: item.reference,
            amountMinor: item.amountMinor,
          })),
          evidenceHash: breakdown.evidenceHash,
        },
        approvalScope: definition.approvalScope,
      });
      if (!decision.approval) {
        throw new ForbiddenException(
          `Submission denied: ${decision.reason ?? 'the governed policy refused the request'}`,
        );
      }

      const submittedAt = new Date();
      await manager.query(
        `UPDATE platform_funds_comparisons
            SET status = 'SUBMITTED', submitted_by = $2, submitted_at = $3, approval_id = $4,
                decision_reason = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, principal.principalId, submittedAt, decision.approval.id],
      );
      const submittedRow = await this.lockComparison(manager, row.id);
      await this.insertSnapshot(manager, {
        comparisonId: row.id,
        reason: 'SUBMITTED',
        breakdown,
        row: {
          ledgerCutoff: this.isoDate(row.ledger_cutoff),
          bankCutoff: this.isoDate(row.bank_cutoff),
          statementReference: row.statement_reference,
          bankBalanceMinor: bankBalance.toString(),
        },
        timingItems,
        differenceMinor: difference,
        unexplainedMinor: unexplained,
        createdBy: principal.principalId,
      });
      await this.auditEvent(manager, 'PLATFORM_FUNDS_COMPARISON_SUBMITTED', principal, row.id, {
        approvalId: decision.approval.id,
        actionFingerprint: fingerprint,
        evidenceHash: breakdown.evidenceHash,
        differenceMinor: difference.toString(),
        unexplainedMinor: unexplained.toString(),
      });
      const approvalView = decision.approval;
      return this.buildDetail(principal, submittedRow, breakdown, manager, {
        id: approvalView.id,
        status: approvalView.status,
        actionType: approvalView.actionType,
        requestedBy: approvalView.requesterPrincipalId,
        approvedBy: approvalView.approvedBy,
        requestedAt: this.iso(approvalView.requestedAt),
        expiresAt: this.iso(approvalView.expiresAt),
        reason: approvalView.reason ?? reason,
      });
    });
  }

  async review(
    principal: AuthorizationPrincipal,
    id: string,
    dto: { decision: 'APPROVE' | 'REJECT'; reason: string },
  ): Promise<PlatformFundsComparisonDetail> {
    this.requireChecker(principal);
    const approve = dto.decision === 'APPROVE';
    const reason = dto.reason.trim();
    if (reason.length < 3 || reason.length > 1000) {
      throw new BadRequestException('reason must be 3-1000 characters');
    }
    return this.dataSource.transaction(async (manager) => {
      const row = await this.loadLockedVisibleComparison(principal, manager, id);
      if (row.status !== 'SUBMITTED') {
        throw new ConflictException('Only a SUBMITTED comparison can be reviewed');
      }
      if (!row.approval_id) {
        throw new ConflictException('The comparison has no governed approval linked');
      }

      const submittedSnapshot = (await manager.query(
        `SELECT evidence_hash FROM platform_funds_comparison_snapshots
          WHERE comparison_id = $1 AND reason = 'SUBMITTED'
          ORDER BY version DESC LIMIT 1`,
        [row.id],
      )) as Array<{ evidence_hash: string }>;

      const selected = await this.getSettlementRow(manager, row.settlement_account_id);
      const breakdown = await this.buildBreakdown(manager, selected, this.isoDate(row.ledger_cutoff));
      const timingItems = await this.timingItemsFor(manager, row.id);
      const submittedHash = submittedSnapshot[0]?.evidence_hash ?? null;
      const evidenceDrift = submittedHash !== null && submittedHash !== breakdown.evidenceHash;
      if (approve && evidenceDrift) {
        throw new ConflictException(
          'The ledger evidence changed since this comparison was submitted (posted journals at or before the cutoff moved). The maker must revise and resubmit it before it can be signed off.',
        );
      }

      const decision = approve
        ? await this.approvals.approveInTransaction(manager, {
            principal,
            approvalId: row.approval_id,
            comment: reason,
          })
        : await this.approvals.rejectInTransaction(manager, {
            principal,
            approvalId: row.approval_id,
            comment: reason,
          });
      const expectedReason = approve ? 'APPROVED' : 'REJECTED';
      if (decision.reason !== expectedReason) {
        throw new ForbiddenException(
          `Review denied: ${decision.reason ?? 'the governed policy refused the decision'}`,
        );
      }

      const reviewedAt = new Date();
      await manager.query(
        `UPDATE platform_funds_comparisons
            SET status = $2, reviewed_by = $3, reviewed_at = $4, decision_reason = $5, updated_at = now()
          WHERE id = $1`,
        [
          row.id,
          approve ? 'APPROVED' : 'REJECTED',
          principal.principalId,
          reviewedAt,
          reason,
        ],
      );

      await this.insertSnapshot(manager, {
        comparisonId: row.id,
        reason: approve ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
        breakdown,
        row: {
          ledgerCutoff: this.isoDate(row.ledger_cutoff),
          bankCutoff: this.isoDate(row.bank_cutoff),
          statementReference: row.statement_reference,
          bankBalanceMinor: row.bank_balance_minor,
        },
        timingItems,
        differenceMinor: BigInt(row.difference_minor),
        unexplainedMinor: BigInt(row.unexplained_minor),
        createdBy: principal.principalId,
      });
      await this.auditEvent(
        manager,
        approve ? 'PLATFORM_FUNDS_COMPARISON_APPROVED' : 'PLATFORM_FUNDS_COMPARISON_REJECTED',
        principal,
        row.id,
        {
          decision: dto.decision,
          reason,
          approvalId: row.approval_id,
          evidenceHash: breakdown.evidenceHash,
          evidenceDrift,
        },
      );
      const finalRow = await this.lockComparison(manager, row.id);
      const approvalView = decision.approval;
      return this.buildDetail(principal, finalRow, breakdown, manager, {
        id: approvalView?.id ?? row.approval_id,
        status: approvalView?.status ?? expectedReason,
        actionType: approvalView?.actionType ?? ACTION,
        requestedBy: approvalView?.requesterPrincipalId ?? row.submitted_by ?? principal.principalId,
        approvedBy: approvalView?.approvedBy ?? (approve ? principal.principalId : null),
        requestedAt: this.iso(approvalView?.requestedAt ?? row.created_at),
        expiresAt: this.iso(approvalView?.expiresAt ?? reviewedAt),
        reason: approvalView?.reason ?? reason,
      });
    });
  }
}
