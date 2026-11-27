import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { BankingReadinessService } from '../banking/banking-readiness.service';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import type {
  CashLedgerJournalDetail,
  CashLedgerJournalLine,
  CashLedgerJournalSummary,
  FinanceBreakNextAction,
  FinanceBreakView,
  FinanceCheckView,
  FinanceInstitutionScopeView,
  FinanceInstitutionSummary,
  FinanceInstitutionsResponse,
  InternalLedgerCheckResult,
  JournalSearchResponse,
  JournalSourceLink,
  JournalSourceType,
  ProviderReadinessView,
  ReconciliationBreaksResponse,
  ReconciliationCheckSource,
  ReconciliationSourceView,
  ReversalEligibilityView,
  TransactionJournalLinkResponse,
} from './finance-operations.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const MAX_SEARCH_ROWS = 100;

/** Reference forms the ledger search actually understands, surfaced to the caller. */
const SUPPORTED_REFERENCE_FORMS = [
  'Journal UUID',
  'Journal reference',
  'Journal idempotency key',
  'Journal correlation id',
  'Transfer reference',
  'Deposit reference / payment reference',
  'Withdrawal reference / payment reference',
  'Customer funding reference',
  'Agent funding reference',
  'Cash-to-cash reference',
] as const;

const REVERSAL_ACTION_TYPE = 'LEDGER_JOURNAL_REVERSAL';
const REVERSAL_RESOURCE_TYPE = 'LEDGER_JOURNAL';

interface JournalRow {
  id: string;
  reference: string | null;
  description: string | null;
  status: string;
  currency: string;
  accounting_unit: string;
  total_minor: string;
  idempotency_key: string;
  correlation_id: string | null;
  metadata: Record<string, unknown> | null;
  reversal_of_journal_id: string | null;
  reversed_by_journal_id: string | null;
  line_count: string;
  created_at: Date | string;
  posted_at: Date | string;
  institution_id: string | null;
  institution_code: string | null;
  institution_name: string | null;
  institution_status: string | null;
}

interface SourceRow {
  source_type: JournalSourceType;
  id: string;
  reference: string | null;
  status: string;
  linked_by: 'JOURNAL_ID' | 'CLAIM_JOURNAL_ID' | 'DURABLE_INBOUND_LINK' | 'LEGACY_RECEIPT_JOURNAL';
}

/**
 * Read model for Admin Web Finance Operations.
 *
 * Scope rules, enforced here rather than in the screen:
 *
 * - A principal holding `institution.attribution.view` is platform-level and sees every
 *   institution.
 * - Everyone else sees only journals/accounts attributed to an institution they have an ACTIVE
 *   `workforce_institution_assignments` row for (read on every request), plus **unattributed**
 *   legacy rows, which are not another institution's records and are the population the existing
 *   guarded reversal workflow was built on. That last clause is deliberately narrow: it is not a
 *   general "platform data is public" rule, and the code comment is the only place it is granted.
 * - `assertCanAccessInstitution` (404 on denial) is used for every institution-addressed
 *   reconciliation read, so the surface cannot be used to probe which institutions exist.
 */
@Injectable()
export class FinanceOperationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: InstitutionWorkforceScopeService,
    private readonly readiness: BankingReadinessService,
  ) {}

  // ------------------------------------------------------------------ scope

  async scopeFor(principal: AuthorizationPrincipal): Promise<FinanceInstitutionScopeView> {
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

  async listInstitutions(principal: AuthorizationPrincipal): Promise<FinanceInstitutionsResponse> {
    const scope = await this.scopeFor(principal);
    const rows: Array<{
      id: string;
      code: string;
      legal_name: string;
      display_name: string | null;
      status: string;
    }> =
      scope.mode === 'PLATFORM'
        ? await this.dataSource.query(
            `SELECT id, code, legal_name, display_name, status
               FROM financial_institutions
              WHERE deleted_at IS NULL
              ORDER BY code ASC`,
          )
        : scope.institutionIds.length === 0
          ? []
          : await this.dataSource.query(
              `SELECT id, code, legal_name, display_name, status
                 FROM financial_institutions
                WHERE deleted_at IS NULL AND id = ANY($1::uuid[])
                ORDER BY code ASC`,
              [scope.institutionIds],
            );
    return { items: rows.map((row) => this.institution(row)), scope };
  }

  async assertInstitutionAccess(
    principal: AuthorizationPrincipal,
    institutionId: string,
  ): Promise<string> {
    const normalized = this.uuid(institutionId, 'institutionId');
    await this.scope.assertCanAccessInstitution(principal, normalized);
    return normalized;
  }

  /** Whether a journal's attribution is visible to this principal. See the class comment. */
  private async canSeeInstitution(
    principal: AuthorizationPrincipal,
    institutionId: string | null,
  ): Promise<boolean> {
    if (!institutionId) return true;
    if (this.scope.hasPlatformAuthority(principal)) return true;
    const ids = await this.scope.institutionIdsForPrincipal(principal.principalId);
    return ids.includes(institutionId.toLowerCase());
  }

  private async assertJournalVisible(
    principal: AuthorizationPrincipal,
    institutionId: string | null,
  ): Promise<void> {
    if (!(await this.canSeeInstitution(principal, institutionId))) {
      // 404, not 403: an out-of-scope identifier must not confirm that it exists.
      throw new NotFoundException('Journal not found');
    }
  }

  // ------------------------------------------------------------ ledger search

  async searchJournals(
    principal: AuthorizationPrincipal,
    query: {
      reference?: string;
      from?: string;
      to?: string;
      institutionId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    },
  ): Promise<JournalSearchResponse> {
    const limit = this.boundedInteger(query.limit, 25, 1, MAX_SEARCH_ROWS, 'limit');
    const offset = this.boundedInteger(query.offset, 0, 0, 1_000_000, 'offset');
    const { from, to } = this.range(query.from, query.to);
    const reference = this.optionalText(query.reference, 160, 'reference');
    const status = this.optionalText(query.status, 32, 'status')?.toUpperCase();
    if (status && status !== 'POSTED') {
      throw new BadRequestException('status must be POSTED (the only recorded journal status)');
    }

    const scope = await this.scopeFor(principal);
    let institutionId: string | null = null;
    if (query.institutionId) {
      institutionId = await this.assertInstitutionAccess(principal, query.institutionId);
    }

    const params: unknown[] = [from, to];
    const conditions: string[] = ['j.created_at >= $1', 'j.created_at <= $2'];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (reference) {
      const exactId = push(reference.toLowerCase());
      const like = push(this.likePattern(reference));
      conditions.push(`(
        j.id::text = ${exactId}
        OR j.reference ILIKE ${like} ESCAPE '\\'
        OR j.idempotency_key ILIKE ${like} ESCAPE '\\'
        OR j.correlation_id ILIKE ${like} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM transfers t WHERE t.journal_id = j.id AND (t.reference ILIKE ${like} ESCAPE '\\' OR t.id::text = ${exactId}))
        OR EXISTS (SELECT 1 FROM deposits d WHERE d.journal_id = j.id AND (d.reference ILIKE ${like} ESCAPE '\\' OR d.payment_reference ILIKE ${like} ESCAPE '\\' OR d.id::text = ${exactId}))
        OR EXISTS (SELECT 1 FROM withdrawals w WHERE w.journal_id = j.id AND (w.reference ILIKE ${like} ESCAPE '\\' OR w.payment_reference ILIKE ${like} ESCAPE '\\' OR w.id::text = ${exactId}))
        OR EXISTS (SELECT 1 FROM customer_funding_requests c WHERE c.journal_id = j.id AND (c.reference ILIKE ${like} ESCAPE '\\' OR c.external_reference ILIKE ${like} ESCAPE '\\' OR c.id::text = ${exactId}))
        OR EXISTS (SELECT 1 FROM agent_funding_requests a WHERE a.journal_id = j.id AND (a.reference ILIKE ${like} ESCAPE '\\' OR a.id::text = ${exactId}))
        OR EXISTS (SELECT 1 FROM cash_to_cash_transfers cc WHERE (cc.journal_id = j.id OR cc.claim_journal_id = j.id) AND (cc.reference ILIKE ${like} ESCAPE '\\' OR cc.id::text = ${exactId}))
      )`);
    }
    if (status) {
      const statusParam = push(status);
      conditions.push(`j.status = ${statusParam}`);
    }
    if (institutionId) {
      const institutionParam = push(institutionId);
      conditions.push(`j.institution_id = ${institutionParam}`);
    } else if (scope.mode !== 'PLATFORM') {
      if (scope.institutionIds.length > 0) {
        const idsParam = push(scope.institutionIds);
        conditions.push(
          `(j.institution_id IS NULL OR j.institution_id = ANY(${idsParam}::uuid[]))`,
        );
      } else {
        conditions.push('j.institution_id IS NULL');
      }
    }

    const where = conditions.join(' AND ');
    const rows = await this.dataSource.query<JournalRow[]>(
      `SELECT j.id, j.reference, j.description, j.status, j.currency, j.accounting_unit,
              j.total_minor::text AS total_minor, j.idempotency_key, j.correlation_id,
              j.metadata, j.reversal_of_journal_id, rev.id AS reversed_by_journal_id,
              j.created_at, j.posted_at, j.institution_id,
              i.code AS institution_code, COALESCE(i.display_name, i.legal_name) AS institution_name,
              i.status AS institution_status,
              (SELECT count(*) FROM ledger_lines l WHERE l.journal_id = j.id)::text AS line_count
         FROM ledger_journals j
         LEFT JOIN financial_institutions i ON i.id = j.institution_id
         LEFT JOIN ledger_journals rev ON rev.reversal_of_journal_id = j.id
        WHERE ${where}
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT ${push(limit)} OFFSET ${push(offset)}`,
      params,
    );
    const counted = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT count(*)::text AS total
         FROM ledger_journals j
        WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    const items = await Promise.all(rows.map((row) => this.toSummary(row)));
    const total = Number(counted[0]?.total ?? '0');
    return {
      items,
      total,
      hasMore: offset + items.length < total,
      limit,
      offset,
      range: { from: from.toISOString(), to: to.toISOString() },
      scope,
      supportedReferenceForms: [...SUPPORTED_REFERENCE_FORMS],
    };
  }

  async getJournal(
    principal: AuthorizationPrincipal,
    journalId: string,
  ): Promise<CashLedgerJournalDetail> {
    const id = this.uuid(journalId, 'journalId');
    const row = await this.journalRow(id);
    if (!row) throw new NotFoundException('Journal not found');
    await this.assertJournalVisible(principal, row.institution_id);
    const summary = await this.toSummary(row);
    const lines = await this.dataSource.query<
      Array<{
        id: string;
        line_number: number;
        ledger_account_id: string;
        code: string;
        name: string;
        account_type: string;
        institutional_scope: string;
        account_institution_id: string | null;
        direction: 'DEBIT' | 'CREDIT';
        amount_minor: string;
        currency: string;
        accounting_unit: string;
      }>
    >(
      `SELECT l.id, l.line_number, l.ledger_account_id, a.code, a.name, a.account_type,
              a.institutional_scope, a.institution_id AS account_institution_id,
              l.direction, l.amount_minor::text AS amount_minor, l.currency, l.accounting_unit
         FROM ledger_lines l
         JOIN ledger_accounts a ON a.id = l.ledger_account_id
        WHERE l.journal_id = $1
        ORDER BY l.line_number ASC`,
      [id],
    );
    const mappedLines: CashLedgerJournalLine[] = lines.map((line) => ({
      id: line.id,
      lineNumber: Number(line.line_number),
      accountId: line.ledger_account_id,
      accountCode: line.code,
      accountName: line.name,
      accountType: line.account_type,
      institutionalScope: line.institutional_scope,
      institutionId: line.account_institution_id,
      direction: line.direction,
      amountMinor: line.amount_minor,
      currency: line.currency,
      accountingUnit: line.accounting_unit,
    }));
    return {
      ...summary,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      metadata: row.metadata ?? {},
      lines: mappedLines,
    };
  }

  /**
   * The reverse link: a transaction the caller can address by id (or reference) to its journal.
   *
   * Journal *content* requires `ledger.view`; without it the caller is told the link exists but
   * cannot be opened, rather than being handed ledger figures through a transaction capability.
   */
  async transactionJournal(
    principal: AuthorizationPrincipal,
    transactionId: string,
    typeHint?: string,
  ): Promise<TransactionJournalLinkResponse> {
    const key = this.optionalText(transactionId, 160, 'transactionId');
    if (!key) throw new BadRequestException('transactionId is required');
    const source = await this.findSourceForTransaction(key, typeHint);
    if (!source) {
      throw new NotFoundException('Transaction not found for a supported transaction type');
    }

    if (!principal.scopes.includes('ledger.view')) {
      return {
        transaction: {
          id: source.id,
          type: source.type,
          reference: source.reference,
          status: source.status,
          createdAt: source.createdAt,
        },
        ledgerAccess: 'DENIED_LEDGER_VIEW',
        journal: null,
        outcome: 'LEDGER_ACCESS_DENIED',
        message:
          'The ledger journal for this transaction requires ledger.view. Ask a finance role with ledger.read access to open it.',
      };
    }

    if (!source.journalId) {
      return {
        transaction: {
          id: source.id,
          type: source.type,
          reference: source.reference,
          status: source.status,
          createdAt: source.createdAt,
        },
        ledgerAccess: 'GRANTED',
        journal: null,
        outcome: 'NO_JOURNAL_POSTED',
        message:
          'This transaction has no posted ledger journal. That is expected before completion and is a reconciliation break if the transaction is complete.',
      };
    }

    const row = await this.journalRow(source.journalId);
    if (!row) {
      return {
        transaction: {
          id: source.id,
          type: source.type,
          reference: source.reference,
          status: source.status,
          createdAt: source.createdAt,
        },
        ledgerAccess: 'GRANTED',
        journal: null,
        outcome: 'NO_JOURNAL_POSTED',
        message:
          'The transaction references a journal that no longer exists. Treat this as a ledger integrity break.',
      };
    }
    await this.assertJournalVisible(principal, row.institution_id);
    const journal = await this.toSummary(row);
    return {
      transaction: {
        id: source.id,
        type: source.type,
        reference: source.reference,
        status: source.status,
        createdAt: source.createdAt,
      },
      ledgerAccess: 'GRANTED',
      journal,
      outcome: 'FOUND',
      message: 'Ledger journal found for this transaction.',
    };
  }

  // ------------------------------------------------------- reversal eligibility

  async reversalEligibility(
    principal: AuthorizationPrincipal,
    journalId: string,
  ): Promise<ReversalEligibilityView> {
    const id = this.uuid(journalId, 'journalId');
    const row = await this.journalRow(id);
    if (!row) throw new NotFoundException('Journal not found');
    await this.assertJournalVisible(principal, row.institution_id);

    const readOnly = principal.readOnlyPrincipal === true;
    const canView = principal.scopes.includes('ledger.view');
    const canRequest =
      principal.scopes.includes('ledger.reverse') &&
      principal.assuranceLevel === 'MFA' &&
      !readOnly;
    const canExecute =
      !readOnly &&
      principal.assuranceLevel === 'MFA' &&
      (principal.roles.includes('FINANCE_CONTROLLER') ||
        principal.scopes.includes('privileged:execute'));

    const approval = await this.latestReversalApproval(id);
    const reversedBy = row.reversed_by_journal_id;
    const blockers: ReversalEligibilityView['blockers'] = [];

    let nextAction: ReversalEligibilityView['nextAction'] = 'NONE';
    let reasonCode = 'ELIGIBLE_TO_REQUEST';
    let reason =
      'This posted journal has not been reversed and no reversal request is outstanding. A FINANCE_PREPARER may request a governed reversal.';
    let eligible = true;

    if (!canView) {
      eligible = false;
      reasonCode = 'LEDGER_VIEW_REQUIRED';
      reason = 'You cannot inspect this journal, so you cannot decide a reversal.';
      blockers.push({
        code: 'LEDGER_VIEW_REQUIRED',
        message: 'ledger.view is required to inspect and reverse ledger journals.',
        action: 'Ask a finance administrator for ledger.view.',
      });
    } else if (row.reversal_of_journal_id) {
      eligible = false;
      reasonCode = 'JOURNAL_IS_A_REVERSAL';
      reason =
        'This journal is itself a compensating reversal. The reversal domain refuses reversals of reversals; post a new governed correction instead.';
      blockers.push({
        code: 'JOURNAL_IS_A_REVERSAL',
        message: 'A reversal cannot itself be reversed.',
        action: 'Open the original journal and request a correction through the governed path.',
      });
    } else if (reversedBy) {
      eligible = false;
      reasonCode = 'ALREADY_REVERSED';
      reason = 'A compensating journal already exists for this journal.';
      blockers.push({
        code: 'ALREADY_REVERSED',
        message: 'This journal has already been reversed.',
        action: 'Open the reversal journal to inspect the compensating postings.',
      });
    } else if (row.status !== 'POSTED') {
      eligible = false;
      reasonCode = 'JOURNAL_NOT_POSTED';
      reason = `Only a POSTED journal can be reversed (current status: ${row.status}).`;
      blockers.push({
        code: 'JOURNAL_NOT_POSTED',
        message: 'The journal is not in a posted state.',
        action: 'Investigate the journal lifecycle; do not attempt a reversal.',
      });
    } else if (approval?.status === 'REQUESTED') {
      eligible = true;
      nextAction = 'AWAIT_APPROVAL';
      reasonCode = 'APPROVAL_PENDING';
      reason =
        'A governed reversal request is outstanding. It must be approved by an independent FINANCE_CONTROLLER before execution.';
    } else if (approval?.status === 'APPROVED') {
      eligible = true;
      nextAction = canExecute ? 'EXECUTE_REVERSAL' : 'AWAIT_APPROVAL';
      reasonCode = canExecute ? 'APPROVED_AWAITING_EXECUTION' : 'APPROVED_EXECUTOR_REQUIRED';
      reason = canExecute
        ? 'The reversal request is approved. Execution consumes the approval and posts the exact inverse.'
        : 'The reversal request is approved, but execution requires the approving FINANCE_CONTROLLER or a privileged:execute principal.';
      if (!canExecute) {
        blockers.push({
          code: 'EXECUTOR_ENTITLEMENT_REQUIRED',
          message: 'Execution requires the approving FINANCE_CONTROLLER or privileged:execute.',
          action: 'Ask the approving controller to execute the approved reversal.',
        });
      }
    } else if (
      approval?.status &&
      ['REJECTED', 'EXPIRED', 'CANCELLED', 'CONSUMED'].includes(approval.status)
    ) {
      reasonCode = 'PREVIOUS_REQUEST_CLOSED';
      reason = `The most recent reversal request is ${approval.status}. A new governed request is required.`;
      nextAction = canRequest ? 'REQUEST_REVERSAL' : 'NONE';
      if (!canRequest) {
        eligible = false;
        blockers.push({
          code: 'REQUEST_ENTITLEMENT_REQUIRED',
          message:
            'Requesting a reversal requires ledger.reverse and an MFA-verified writable session.',
          action: 'Ask a FINANCE_PREPARER to raise a new reversal request.',
        });
      }
    } else if (!canRequest) {
      eligible = false;
      reasonCode = readOnly ? 'READ_ONLY_PRINCIPAL' : 'REQUEST_ENTITLEMENT_REQUIRED';
      reason = readOnly
        ? 'This session holds only read-only catalogue roles, so it can inspect but never request a reversal.'
        : 'Requesting a reversal requires ledger.reverse (FINANCE_PREPARER) on an MFA-verified session.';
      blockers.push({
        code: reasonCode,
        message: readOnly
          ? 'A read-only principal may never mutate ledger state.'
          : 'Your principal does not hold ledger.reverse.',
        action: 'Ask a FINANCE_PREPARER to raise the governed reversal request.',
      });
    } else {
      nextAction = 'REQUEST_REVERSAL';
    }

    return {
      journalId: id,
      eligible,
      nextAction,
      nextActionLabel: this.nextActionLabel(nextAction),
      reasonCode,
      reason,
      permissions: { canView, canRequest, canExecute },
      approval: approval
        ? {
            approvalId: approval.id,
            status: approval.status,
            requestedAt: this.iso(approval.requested_at),
            expiresAt: this.iso(approval.expires_at),
            requestedBy: approval.requester_principal_id,
            approvedBy: approval.approved_by,
            reason: approval.reason,
            actionType: approval.action_type,
            resourceType: approval.resource_type,
          }
        : null,
      blockers,
      governance: {
        actionType: REVERSAL_ACTION_TYPE,
        resourceType: REVERSAL_RESOURCE_TYPE,
        makerRole: 'FINANCE_PREPARER',
        checkerRole: 'FINANCE_CONTROLLER',
        note: 'Reversal runs through the registered LEDGER_JOURNAL_REVERSAL maker-checker action: a preparer requests, an independent controller approves, and execution consumes that approval in the same posting transaction. This surface never posts a journal directly.',
      },
    };
  }

  // -------------------------------------------------------- reconciliation

  async reconciliationBreaks(
    principal: AuthorizationPrincipal,
    query: {
      institutionId?: string;
      source?: string;
      state?: string;
      severity?: string;
      kind?: string;
      reference?: string;
      from?: string;
      to?: string;
      limit?: string;
    },
  ): Promise<ReconciliationBreaksResponse> {
    const institutionId = await this.assertInstitutionAccess(
      principal,
      this.requiredText(query.institutionId, 'institutionId', 64),
    );
    const limit = this.boundedInteger(query.limit, 50, 1, 200, 'limit');
    const source = this.sourceFilter(query.source);
    const state = (this.optionalText(query.state, 24, 'state') ?? 'UNRESOLVED').toUpperCase();
    if (!['OPEN', 'INVESTIGATING', 'RESOLVED', 'UNRESOLVED', 'ALL'].includes(state)) {
      throw new BadRequestException(
        'state must be OPEN, INVESTIGATING, RESOLVED, UNRESOLVED or ALL',
      );
    }
    const severity = this.optionalText(query.severity, 16, 'severity')?.toUpperCase();
    if (severity && !['INFO', 'REVIEW', 'CRITICAL'].includes(severity)) {
      throw new BadRequestException('severity must be INFO, REVIEW or CRITICAL');
    }
    const kind = this.optionalText(query.kind, 32, 'kind')?.toUpperCase();
    const reference = this.optionalText(query.reference, 160, 'reference');
    const { from, to } = this.range(query.from, query.to, { defaultDays: 90 });

    const institution = await this.institutionById(institutionId);
    if (!institution) throw new NotFoundException('Institution not found');

    const generatedAt = new Date().toISOString();
    const providerReadiness = await this.providerReadiness(institutionId);
    const external = await this.externalBreaks(institutionId, {
      state,
      severity,
      kind,
      reference,
      from,
      to,
      limit,
      providerReadiness,
      principal,
    });
    const internal = await this.internalLedgerChecks(principal, institution, limit);
    const settlementEvidence = await this.importedSettlementReportEvidence(institutionId);

    const includeInternal = source === 'ALL' || source === 'INTERNAL_LEDGER';
    const includeExternal = source === 'ALL' || source === 'EXTERNAL_PROVIDER';

    const breaks: FinanceBreakView[] = [
      ...(includeInternal ? internal.breaks : []),
      ...(includeExternal ? external.breaks : []),
    ].slice(0, limit);

    const sources = this.sourceViews({
      internalChecks: internal.checks,
      external,
      settlementEvidence,
      providerReadiness,
      generatedAt,
    });

    const errors = breaks.filter(
      (entry) => entry.state === 'ERROR' || entry.severity === 'CRITICAL',
    ).length;
    const warnings = breaks.filter(
      (entry) => entry.state === 'WARNING' || entry.state === 'UNAVAILABLE',
    ).length;
    const unavailableSources = sources.filter(
      (entry) => entry.availability === 'UNAVAILABLE',
    ).length;
    const reconciliationEstablished = sources.every(
      (entry) => entry.availability === 'AVAILABLE' && entry.result === 'AGREED',
    );

    return {
      institution,
      generatedAt,
      sources,
      checks: internal.checks,
      breaks,
      providerReadiness,
      reconciliationEstablished,
      summary: {
        breaks: breaks.length,
        errors,
        warnings,
        unavailableSources,
        checksRun: internal.checks.length,
        checksPassed: internal.checks.filter((entry) => entry.status === 'PASS').length,
        externalExceptionsOpen: external.openExceptions,
        providerReady: providerReadiness.some((entry) => entry.reconciliationCapability?.usable),
      },
      filters: {
        source,
        state,
        from: from.toISOString(),
        to: to.toISOString(),
        reference: reference ?? null,
      },
      scope: await this.scopeFor(principal),
    };
  }

  private async internalLedgerChecks(
    principal: AuthorizationPrincipal,
    institution: FinanceInstitutionSummary,
    limit: number,
  ): Promise<InternalLedgerCheckResult> {
    const checkedAt = new Date().toISOString();
    const checks: FinanceCheckView[] = [];
    const rawBreaks: FinanceBreakView[] = [];
    const canViewLedger = principal.scopes.includes('ledger.view');
    const canViewTransaction = principal.scopes.includes('transaction.view');

    const addCheck = (
      name: string,
      description: string,
      violations: number,
      evidenceCount: number,
      detail: string,
    ) => {
      checks.push({
        name,
        source: 'INTERNAL_LEDGER',
        label: 'Internal double-entry ledger check',
        description,
        status: violations > 0 ? 'ERROR' : 'PASS',
        checkedAt,
        evidenceCount,
        detail,
      });
    };

    // 1. Journal balance integrity within this institution's attribution.
    const imbalanced = await this.dataSource.query<
      Array<{
        id: string;
        reference: string | null;
        currency: string;
        total_minor: string;
        line_count: string;
        debit_total: string;
        credit_total: string;
        created_at: Date | string;
      }>
    >(
      `SELECT j.id, j.reference, j.currency, j.total_minor::text AS total_minor,
              count(l.id)::text AS line_count,
              COALESCE(SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor ELSE 0 END),0)::text AS debit_total,
              COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor ELSE 0 END),0)::text AS credit_total,
              j.created_at
         FROM ledger_journals j
         LEFT JOIN ledger_lines l ON l.journal_id = j.id
        WHERE j.institution_id = $1
        GROUP BY j.id
       HAVING count(l.id) < 2
           OR COALESCE(SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor ELSE 0 END),0)
              <> COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l.amount_minor ELSE 0 END),0)
           OR COALESCE(SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor ELSE 0 END),0) <> j.total_minor
        ORDER BY j.created_at DESC
        LIMIT $2`,
      [institution.id, limit],
    );
    addCheck(
      'journal_balance_integrity',
      'Every journal attributed to this institution has at least two lines and equal debit, credit and recorded totals.',
      imbalanced.length,
      imbalanced.length,
      imbalanced.length === 0
        ? 'All institution-attributed journals are balanced.'
        : `${imbalanced.length} journal(s) are unbalanced or incomplete.`,
    );
    for (const row of imbalanced) {
      rawBreaks.push(
        this.internalBreak(institution, {
          id: `ledger:journal_balance_integrity:${row.id}`,
          checkName: 'journal_balance_integrity',
          title: 'Journal is not balanced',
          severity: 'CRITICAL',
          subject: { type: 'JOURNAL', reference: row.reference ?? row.id },
          amounts: {
            internalMinor: row.total_minor,
            providerMinor: null,
            currency: row.currency,
          },
          detail: `Debits ${row.debit_total} vs credits ${row.credit_total} across ${row.line_count} line(s); journal total ${row.total_minor}.`,
          checkedAt,
          evidence: [
            {
              kind: 'LEDGER_QUERY',
              available: true,
              reference: row.id,
              observedAt: this.iso(row.created_at),
              note: 'Computed directly from ledger_journals and ledger_lines.',
            },
          ],
          nextAction: {
            code: canViewLedger ? 'OPEN_JOURNAL' : 'REQUEST_LEDGER_ACCESS',
            label: canViewLedger ? 'Open journal' : 'Request ledger view access',
            permitted: canViewLedger,
            reason: canViewLedger
              ? 'Ledger figures and postings can be inspected now.'
              : 'Opening the journal requires ledger.view.',
            targetKind: canViewLedger ? 'JOURNAL' : 'NONE',
            targetId: canViewLedger ? row.id : null,
          },
          journalId: row.id,
        }),
      );
    }

    // 2. Institution attribution integrity of journal lines.
    const misattributed = await this.dataSource.query<
      Array<{
        journal_id: string;
        journal_reference: string | null;
        account_id: string;
        account_code: string;
        account_scope: string;
        account_institution_id: string | null;
        created_at: Date | string;
      }>
    >(
      `SELECT DISTINCT j.id AS journal_id, j.reference AS journal_reference, a.id AS account_id,
              a.code AS account_code, a.institutional_scope AS account_scope,
              a.institution_id AS account_institution_id, j.created_at
         FROM ledger_journals j
         JOIN ledger_lines l ON l.journal_id = j.id
         JOIN ledger_accounts a ON a.id = l.ledger_account_id
        WHERE j.institution_id = $1
          AND (a.institutional_scope <> 'INSTITUTION' OR a.institution_id IS DISTINCT FROM $1)
        ORDER BY j.created_at DESC
        LIMIT $2`,
      [institution.id, limit],
    );
    addCheck(
      'journal_account_attribution',
      'Every account touched by an institution-attributed journal belongs to that institution.',
      misattributed.length,
      misattributed.length,
      misattributed.length === 0
        ? 'All institution journals touch accounts owned by the same institution.'
        : `${misattributed.length} line(s) touch an account with a different institutional owner.`,
    );
    for (const row of misattributed) {
      rawBreaks.push(
        this.internalBreak(institution, {
          id: `ledger:journal_account_attribution:${row.journal_id}:${row.account_id}`,
          checkName: 'journal_account_attribution',
          title: 'Journal touches an account outside its institution',
          severity: 'CRITICAL',
          subject: { type: 'JOURNAL', reference: row.journal_reference ?? row.journal_id },
          amounts: null,
          detail: `Account ${row.account_code} has institutional scope ${row.account_scope} and owner ${row.account_institution_id ?? 'none'}; the journal is attributed to ${institution.id}.`,
          checkedAt,
          evidence: [
            {
              kind: 'LEDGER_QUERY',
              available: true,
              reference: row.journal_id,
              observedAt: this.iso(row.created_at),
              note: 'Computed from journal lines joined to ledger account ownership.',
            },
          ],
          nextAction: {
            code: canViewLedger ? 'OPEN_JOURNAL' : 'REQUEST_LEDGER_ACCESS',
            label: canViewLedger ? 'Open journal' : 'Request ledger view access',
            permitted: canViewLedger,
            reason: canViewLedger
              ? 'Inspect the journal and account ownership now.'
              : 'Opening the journal requires ledger.view.',
            targetKind: canViewLedger ? 'JOURNAL' : 'NONE',
            targetId: canViewLedger ? row.journal_id : null,
          },
          journalId: row.journal_id,
        }),
      );
    }

    // 3. Completed transactions whose journal link is absent.
    const unlinked = await this.dataSource.query<
      Array<{
        type: string;
        id: string;
        reference: string | null;
        status: string;
        created_at: Date | string;
      }>
    >(
      `SELECT * FROM (
          SELECT 'TRANSFER' AS type, t.id, t.reference, t.status, t.created_at
            FROM transfers t
           WHERE t.status='COMPLETED'
             AND (t.journal_id IS NULL OR NOT EXISTS (SELECT 1 FROM ledger_journals j WHERE j.id=t.journal_id))
             AND EXISTS (SELECT 1 FROM wallet_accounts w WHERE w.id IN (t.source_wallet_id, t.destination_wallet_id) AND w.institution_id=$1)
          UNION ALL
          SELECT 'DEPOSIT', d.id, d.reference, d.status, d.created_at
            FROM deposits d
            JOIN wallet_accounts w ON w.id=d.wallet_id
           WHERE d.status='COMPLETED' AND w.institution_id=$1
             AND (d.journal_id IS NULL OR NOT EXISTS (SELECT 1 FROM ledger_journals j WHERE j.id=d.journal_id))
          UNION ALL
          SELECT 'WITHDRAWAL', wd.id, wd.reference, wd.status, wd.created_at
            FROM withdrawals wd
            JOIN wallet_accounts w ON w.id=wd.wallet_id
           WHERE wd.status='COMPLETED' AND w.institution_id=$1
             AND (wd.journal_id IS NULL OR NOT EXISTS (SELECT 1 FROM ledger_journals j WHERE j.id=wd.journal_id))
       ) s
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [institution.id, limit],
    );
    addCheck(
      'completed_transaction_journal_link',
      'Every completed transfer, deposit and withdrawal for this institution references an existing journal.',
      unlinked.length,
      unlinked.length,
      unlinked.length === 0
        ? 'All completed institution transactions link to a posted journal.'
        : `${unlinked.length} completed transaction(s) have no journal link.`,
    );
    for (const row of unlinked) {
      const navigable = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL'].includes(row.type);
      rawBreaks.push(
        this.internalBreak(institution, {
          id: `ledger:completed_transaction_journal_link:${row.type}:${row.id}`,
          checkName: 'completed_transaction_journal_link',
          title: 'Completed transaction has no ledger journal',
          severity: 'CRITICAL',
          subject: { type: row.type, reference: row.reference ?? row.id },
          amounts: null,
          detail: `The ${row.type.toLowerCase()} is ${row.status} but its journal link is missing or dangling.`,
          checkedAt,
          evidence: [
            {
              kind: 'LEDGER_QUERY',
              available: true,
              reference: row.id,
              observedAt: this.iso(row.created_at),
              note: 'Checked the transaction row against ledger_journals.',
            },
          ],
          nextAction: {
            code:
              navigable && canViewTransaction
                ? 'INVESTIGATE_SOURCE_TRANSACTION'
                : 'ESCALATE_LEDGER_INVESTIGATION',
            label:
              navigable && canViewTransaction
                ? 'Open source transaction'
                : 'Escalate ledger investigation',
            permitted: navigable && canViewTransaction,
            reason:
              navigable && canViewTransaction
                ? 'The source transaction can be inspected with transaction.view; no automatic correction is permitted here.'
                : 'This surface cannot correct a missing journal. Escalate to the ledger owner.',
            targetKind: 'NONE',
            targetId: null,
          },
          journalId: null,
        }),
      );
    }

    // 4. Negative wallet balances for wallets attributed to this institution.
    const negative = await this.dataSource.query<
      Array<{
        id: string;
        currency: string;
        balance_minor: string;
        account_code: string;
      }>
    >(
      `SELECT w.id, w.currency, la.code AS account_code,
              COALESCE(SUM(CASE WHEN ll.direction = la.normal_balance THEN ll.amount_minor ELSE -ll.amount_minor END),0)::text AS balance_minor
         FROM wallet_accounts w
         JOIN ledger_accounts la ON la.id = w.ledger_account_id
         LEFT JOIN ledger_lines ll ON ll.ledger_account_id = la.id
        WHERE w.institution_id = $1
        GROUP BY w.id, w.currency, la.normal_balance, la.code
       HAVING COALESCE(SUM(CASE WHEN ll.direction = la.normal_balance THEN ll.amount_minor ELSE -ll.amount_minor END),0) < 0
        LIMIT $2`,
      [institution.id, limit],
    );
    addCheck(
      'wallet_balance_non_negative',
      'Wallet balances derived from ledger lines for this institution are never negative.',
      negative.length,
      negative.length,
      negative.length === 0
        ? 'No institution wallet has a negative ledger-derived balance.'
        : `${negative.length} wallet(s) have a negative derived balance.`,
    );
    for (const row of negative) {
      rawBreaks.push(
        this.internalBreak(institution, {
          id: `ledger:wallet_balance_non_negative:${row.id}`,
          checkName: 'wallet_balance_non_negative',
          title: 'Negative wallet balance',
          severity: 'CRITICAL',
          subject: { type: 'WALLET', reference: row.id },
          amounts: {
            internalMinor: row.balance_minor,
            providerMinor: null,
            currency: row.currency,
          },
          detail: `The ledger-derived balance for wallet account ${row.account_code} is ${row.balance_minor} minor units.`,
          checkedAt,
          evidence: [
            {
              kind: 'LEDGER_QUERY',
              available: true,
              reference: row.id,
              observedAt: checkedAt,
              note: 'Derived from ledger_lines for the wallet liability account.',
            },
          ],
          nextAction: {
            code: 'ESCALATE_LEDGER_INVESTIGATION',
            label: 'Escalate ledger investigation',
            permitted: false,
            reason:
              'No automated correction exists for a negative wallet balance. It requires a ledger investigation; this surface cannot post money.',
            targetKind: 'NONE',
            targetId: null,
          },
          journalId: null,
        }),
      );
    }

    return { checks, breaks: rawBreaks };
  }

  private async externalBreaks(
    institutionId: string,
    options: {
      state: string;
      severity?: string;
      kind?: string;
      reference?: string;
      from: Date;
      to: Date;
      limit: number;
      providerReadiness: ProviderReadinessView[];
      principal: AuthorizationPrincipal;
    },
  ): Promise<{
    breaks: FinanceBreakView[];
    source: ReconciliationSourceView;
    openExceptions: number;
  }> {
    const params: unknown[] = [institutionId, options.from.toISOString(), options.to.toISOString()];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = ['e.institution_id = $1', 'e.created_at >= $2', 'e.created_at <= $3'];
    if (options.state === 'UNRESOLVED') conditions.push(`e.state <> 'RESOLVED'`);
    else if (options.state !== 'ALL') conditions.push(`e.state = ${push(options.state)}`);
    if (options.severity) conditions.push(`e.severity = ${push(options.severity)}`);
    if (options.kind) conditions.push(`e.kind = ${push(options.kind)}`);
    if (options.reference) {
      const like = push(this.likePattern(options.reference));
      const exact = push(options.reference.toLowerCase());
      conditions.push(
        `(e.subject_reference ILIKE ${like} ESCAPE '\\' OR e.detail ILIKE ${like} ESCAPE '\\' OR o.provider_reference ILIKE ${like} ESCAPE '\\' OR e.id::text = ${exact} OR r.id::text = ${exact})`,
      );
    }

    const rows = await this.dataSource.query<
      Array<{
        id: string;
        subject_type: string;
        subject_reference: string;
        kind: string;
        severity: string;
        state: string;
        internal_amount_minor: string | null;
        provider_amount_minor: string | null;
        detail: string;
        resolution: string | null;
        resolution_note: string | null;
        created_at: Date | string;
        resolved_at: Date | string | null;
        run_id: string | null;
        provider_key: string | null;
        environment: string | null;
        run_state: string | null;
        started_at: Date | string | null;
        completed_at: Date | string | null;
        failure_code: string | null;
        observation_id: string | null;
        provider_status: string | null;
        provider_reference: string | null;
        observed_at: Date | string | null;
      }>
    >(
      `SELECT e.id, e.subject_type, e.subject_reference, e.kind, e.severity, e.state,
              e.internal_amount_minor::text AS internal_amount_minor,
              e.provider_amount_minor::text AS provider_amount_minor,
              e.detail, e.resolution, e.resolution_note, e.created_at, e.resolved_at,
              r.id AS run_id, r.provider_key, r.environment, r.state AS run_state,
              r.started_at, r.completed_at, r.failure_code,
              o.id AS observation_id, o.provider_status, o.provider_reference, o.observed_at
         FROM banking_reconciliation_exceptions e
         LEFT JOIN banking_reconciliation_runs r ON r.id = e.run_id
         LEFT JOIN banking_provider_observations o ON o.id = e.observation_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END,
                 e.created_at ASC
        LIMIT ${push(options.limit)}`,
      params,
    );

    const canResolve =
      options.principal.scopes.includes('banking.reconciliation.resolve') &&
      options.principal.readOnlyPrincipal !== true;
    const canRun =
      options.principal.scopes.includes('banking.reconciliation.run') &&
      options.principal.readOnlyPrincipal !== true;

    const readinessFor = (providerKey: string | null, environment: string | null) =>
      options.providerReadiness.find(
        (entry) =>
          entry.providerKey === providerKey &&
          (environment === null || entry.environment === environment),
      ) ?? null;

    const breaks: FinanceBreakView[] = rows.map((row) => {
      const readiness = readinessFor(row.provider_key, row.environment);
      const unverifiable = row.kind === 'UNVERIFIABLE';
      const resolved = row.state === 'RESOLVED';
      const nextAction: FinanceBreakNextAction = resolved
        ? {
            code: 'NONE',
            label: 'No action — resolution recorded',
            permitted: false,
            reason: `Resolution recorded as ${row.resolution ?? 'UNKNOWN'}${row.resolution_note ? `: ${row.resolution_note}` : ''}. Recording a resolution does not adjust any balance.`,
            targetKind: 'NONE',
            targetId: null,
          }
        : canResolve
          ? {
              code: unverifiable ? 'REVIEW_UNAVAILABLE_EVIDENCE' : 'RECORD_RESOLUTION',
              label: unverifiable ? 'Review missing evidence' : 'Record resolution decision',
              permitted: true,
              reason: unverifiable
                ? 'Provider evidence is unavailable. Reviewing it records a decision; it is not a successful reconciliation.'
                : 'Records matched/accepted-difference/escalation with a note. It cannot move or correct money.',
              targetKind: 'BANKING_EXCEPTION',
              targetId: row.id,
            }
          : {
              code: 'REQUEST_RESOLUTION_ACCESS',
              label: 'Request banking reconciliation resolution access',
              permitted: false,
              reason:
                'Your principal does not hold banking.reconciliation.resolve, so you may inspect but not record a resolution.',
              targetKind: 'NONE',
              targetId: null,
            };

      return {
        id: `banking:${row.id}`,
        source: 'EXTERNAL_PROVIDER',
        checkName: row.kind.toLowerCase(),
        title: this.externalBreakTitle(row.kind),
        state: resolved
          ? 'RESOLVED'
          : row.state === 'INVESTIGATING'
            ? 'INVESTIGATING'
            : unverifiable
              ? 'UNAVAILABLE'
              : 'OPEN',
        severity: (row.severity as FinanceBreakView['severity']) ?? 'REVIEW',
        institution: { id: institutionId, code: '', name: '', status: '' },
        subject: { type: row.subject_type, reference: row.subject_reference },
        amounts:
          row.internal_amount_minor !== null || row.provider_amount_minor !== null
            ? {
                internalMinor: row.internal_amount_minor,
                providerMinor: row.provider_amount_minor,
                currency: 'NGN',
              }
            : null,
        detail: row.detail,
        checkedAt: this.iso(row.created_at),
        evidence: [
          {
            kind: 'PROVIDER_OBSERVATION',
            available: row.observation_id !== null && !unverifiable,
            reference: row.observation_id,
            observedAt: row.observed_at ? this.iso(row.observed_at) : null,
            note: unverifiable
              ? `Provider evidence could not be obtained${row.provider_status ? ` (status ${row.provider_status})` : ''}. This is an exception, not a pass.`
              : row.observation_id === null
                ? 'No provider observation is attached to this exception.'
                : `Provider reported status ${row.provider_status ?? 'unknown'}${row.provider_reference ? `, reference ${row.provider_reference}` : ''}.`,
          },
          {
            kind: 'RECONCILIATION_RUN',
            available: row.run_id !== null,
            reference: row.run_id,
            observedAt: row.started_at ? this.iso(row.started_at) : null,
            note:
              row.run_id === null
                ? 'No reconciliation run is attached to this exception.'
                : `Run ${row.run_id} (${row.provider_key ?? 'provider unknown'}, ${row.environment ?? 'environment unknown'}) is ${row.run_state ?? 'unknown'}.`,
          },
        ],
        nextAction,
        run: row.run_id
          ? {
              id: row.run_id,
              providerKey: row.provider_key ?? 'UNKNOWN',
              environment: row.environment ?? 'unknown',
              state: row.run_state ?? 'UNKNOWN',
              startedAt: row.started_at ? this.iso(row.started_at) : this.iso(row.created_at),
              completedAt: row.completed_at ? this.iso(row.completed_at) : null,
              failureCode: row.failure_code ?? null,
            }
          : null,
        provider: readiness
          ? {
              providerKey: readiness.providerKey,
              environment: readiness.environment,
              readinessState: readiness.state,
              usable: readiness.usable,
              summary: readiness.summary,
            }
          : null,
        journalId: null,
      };
    });

    // Failed runs are breaks in their own right: a run that could not complete has not reconciled.
    const failedRuns = await this.dataSource.query<
      Array<{
        id: string;
        provider_key: string;
        environment: string;
        state: string;
        started_at: Date | string;
        completed_at: Date | string | null;
        failure_code: string | null;
        exceptions_raised: number;
        observations: number;
      }>
    >(
      `SELECT id, provider_key, environment, state, started_at, completed_at, failure_code,
              exceptions_raised, observations
         FROM banking_reconciliation_runs
        WHERE institution_id = $1 AND state IN ('FAILED','ABANDONED')
        ORDER BY started_at DESC
        LIMIT 10`,
      [institutionId],
    );
    for (const run of failedRuns) {
      const readiness = readinessFor(run.provider_key, run.environment);
      breaks.push({
        id: `banking-run:${run.id}`,
        source: 'EXTERNAL_PROVIDER',
        checkName: 'provider_reconciliation_run',
        title: 'Provider reconciliation run did not complete',
        state: 'ERROR',
        severity: 'REVIEW',
        institution: { id: institutionId, code: '', name: '', status: '' },
        subject: { type: 'RECONCILIATION_RUN', reference: run.id },
        amounts: null,
        detail: `The run is ${run.state}${run.failure_code ? ` (${run.failure_code})` : ''}. ${run.observations} observation(s), ${run.exceptions_raised} exception(s) raised before it stopped.`,
        checkedAt: this.iso(run.completed_at ?? run.started_at),
        evidence: [
          {
            kind: 'RECONCILIATION_RUN',
            available: true,
            reference: run.id,
            observedAt: this.iso(run.started_at),
            note: 'Read from banking_reconciliation_runs.',
          },
        ],
        nextAction: canRun
          ? {
              code: 'RETRY_RECONCILIATION',
              label: 'Re-run provider reconciliation',
              permitted: Boolean(readiness?.usable),
              reason: readiness?.usable
                ? 'A new run records observations and exceptions; it never adjusts money.'
                : 'The provider is not operationally ready for this institution, so a new run cannot establish anything.',
              targetKind: 'PROVIDER_CONFIGURATION',
              targetId: run.provider_key,
            }
          : {
              code: 'REQUEST_RUN_ACCESS',
              label: 'Request banking reconciliation run access',
              permitted: false,
              reason: 'Your principal does not hold banking.reconciliation.run.',
              targetKind: 'NONE',
              targetId: null,
            },
        run: {
          id: run.id,
          providerKey: run.provider_key,
          environment: run.environment,
          state: run.state,
          startedAt: this.iso(run.started_at),
          completedAt: run.completed_at ? this.iso(run.completed_at) : null,
          failureCode: run.failure_code ?? null,
        },
        provider: readiness
          ? {
              providerKey: readiness.providerKey,
              environment: readiness.environment,
              readinessState: readiness.state,
              usable: readiness.usable,
              summary: readiness.summary,
            }
          : null,
        journalId: null,
      });
    }

    const openCount = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT count(*)::text AS total
         FROM banking_reconciliation_exceptions
        WHERE institution_id = $1 AND state <> 'RESOLVED'`,
      [institutionId],
    );

    const providerUsable = options.providerReadiness.some(
      (entry) => entry.reconciliationCapability?.usable,
    );
    const evidenceObserved = rows.length > 0 || failedRuns.length > 0;
    const source: ReconciliationSourceView = {
      source: 'EXTERNAL_PROVIDER',
      label: 'External provider reconciliation',
      // A provider surface that cannot be read is *not performed*, never an unavailable pass.
      result: evidenceObserved ? 'EVIDENCE_RECORDED' : 'NOT_PERFORMED',
      availability: providerUsable
        ? evidenceObserved
          ? 'AVAILABLE'
          : 'PARTIAL'
        : evidenceObserved
          ? 'PARTIAL'
          : 'UNAVAILABLE',
      description:
        'Compares what the banking provider reported (provider observations) with our internal record for the same subject. It is not an internal ledger check.',
      evidenceKind: 'PROVIDER_OBSERVATION',
      checkedAt: evidenceObserved
        ? this.iso(rows[0]?.created_at ?? failedRuns[0]?.started_at ?? new Date())
        : null,
      detail: providerUsable
        ? evidenceObserved
          ? `${rows.length} provider exception(s) in range; existing provider evidence is reviewable.`
          : 'The provider is operationally ready, but no provider observation exists yet. No provider reconciliation result has been established.'
        : options.providerReadiness.length === 0
          ? 'No banking provider is registered in this deployment, so provider reconciliation cannot run. This is not a reconciliation pass.'
          : `No provider is operationally ready for this institution (${options.providerReadiness.map((entry) => `${entry.providerKey}: ${entry.state}`).join('; ')}). Provider reconciliation cannot run, so no external result exists.`,
      providerKeys: options.providerReadiness.map((entry) => entry.providerKey),
    };

    return { breaks, source, openExceptions: Number(openCount[0]?.total ?? '0') };
  }

  private async importedSettlementReportEvidence(institutionId: string): Promise<{
    providerImportsCount: number;
    statementImportsCount: number;
    hasVerifiedStatement: boolean;
    latestProviderImportedAt: string | null;
    latestStatementImportedAt: string | null;
    statementProviders: string[];
    openProviderBreaks: number;
    openStatementBreaks: number;
  }> {
    const imports = await this.dataSource.query<
      Array<{
        provider_key: string;
        report_type: string;
        verification_status: string;
        imported_at: Date | string;
      }>
    >(
      `SELECT provider_key, report_type, verification_status, imported_at
         FROM settlement_report_imports
        WHERE institution_id = $1
        ORDER BY imported_at DESC`,
      [institutionId],
    );
    if (imports.length === 0) {
      return {
        providerImportsCount: 0,
        statementImportsCount: 0,
        hasVerifiedStatement: false,
        latestProviderImportedAt: null,
        latestStatementImportedAt: null,
        statementProviders: [],
        openProviderBreaks: 0,
        openStatementBreaks: 0,
      };
    }

    const statementImports = imports.filter(
      (i) => i.report_type === 'WALLET_STATEMENT' || i.report_type === 'BANK_STATEMENT',
    );
    const providerImports = imports.filter(
      (i) => i.report_type !== 'WALLET_STATEMENT' && i.report_type !== 'BANK_STATEMENT',
    );

    const [txBreaks, batchBreaks, retBreaks] = await Promise.all([
      this.dataSource.query<Array<{ provider_open: string; statement_open: string }>>(
        `SELECT COUNT(*) FILTER (
                  WHERE report_type NOT IN ('WALLET_STATEMENT', 'BANK_STATEMENT')
                    AND match_status <> 'MATCHED'
                    AND review_state <> 'APPROVED'
                )::text AS provider_open,
                COUNT(*) FILTER (
                  WHERE report_type IN ('WALLET_STATEMENT', 'BANK_STATEMENT')
                    AND match_status <> 'MATCHED'
                    AND review_state <> 'APPROVED'
                )::text AS statement_open
           FROM settlement_transaction_matches
          WHERE institution_id = $1`,
        [institutionId],
      ),
      this.dataSource.query<Array<{ batch_open: string }>>(
        `SELECT COUNT(*) FILTER (
                  WHERE batch_status <> 'RECONCILED'
                    AND review_state <> 'APPROVED'
                )::text AS batch_open
           FROM settlement_batch_reconciliations
          WHERE institution_id = $1`,
        [institutionId],
      ),
      this.dataSource.query<Array<{ ret_open: string }>>(
        `SELECT COUNT(*) FILTER (
                  WHERE lifecycle_status <> 'RECONCILED'
                    AND review_state <> 'APPROVED'
                )::text AS ret_open
           FROM settlement_return_dispute_cases
          WHERE institution_id = $1`,
        [institutionId],
      ),
    ]);

    return {
      providerImportsCount: providerImports.length,
      statementImportsCount: statementImports.length,
      hasVerifiedStatement: statementImports.some(
        (i) => i.verification_status === 'VERIFIED_OFFICIAL_API_JSON',
      ),
      latestProviderImportedAt: providerImports[0]
        ? this.iso(providerImports[0].imported_at)
        : null,
      latestStatementImportedAt: statementImports[0]
        ? this.iso(statementImports[0].imported_at)
        : null,
      statementProviders: Array.from(new Set(statementImports.map((i) => i.provider_key))),
      openProviderBreaks:
        Number(txBreaks[0]?.provider_open ?? '0') + Number(retBreaks[0]?.ret_open ?? '0'),
      openStatementBreaks:
        Number(txBreaks[0]?.statement_open ?? '0') + Number(batchBreaks[0]?.batch_open ?? '0'),
    };
  }

  private sourceViews(input: {
    internalChecks: FinanceCheckView[];
    external: { source: ReconciliationSourceView };
    settlementEvidence: {
      providerImportsCount: number;
      statementImportsCount: number;
      hasVerifiedStatement: boolean;
      latestProviderImportedAt: string | null;
      latestStatementImportedAt: string | null;
      statementProviders: string[];
      openProviderBreaks: number;
      openStatementBreaks: number;
    };
    providerReadiness: ProviderReadinessView[];
    generatedAt: string;
  }): ReconciliationSourceView[] {
    const allInternalPassed =
      input.internalChecks.length > 0 &&
      input.internalChecks.every((entry) => entry.status === 'PASS');
    const internal: ReconciliationSourceView = {
      source: 'INTERNAL_LEDGER',
      label: 'Internal ledger checks',
      availability: 'AVAILABLE',
      description:
        'Double-entry checks computed from our own ledger for this institution: balance integrity, account ownership, transaction-to-journal links and ledger-derived wallet balances. These compare the ledger with itself — not with a provider or a bank statement.',
      evidenceKind: 'LEDGER_QUERY',
      checkedAt: input.generatedAt,
      result: allInternalPassed ? 'AGREED' : 'DIFFERENCES',
      detail: allInternalPassed
        ? `All ${input.internalChecks.length} internal checks passed at ${input.generatedAt}.`
        : `${input.internalChecks.filter((entry) => entry.status !== 'PASS').length} of ${input.internalChecks.length} internal checks reported a difference at ${input.generatedAt}.`,
      providerKeys: [],
    } as ReconciliationSourceView;
    const ev = input.settlementEvidence;
    const external: ReconciliationSourceView =
      ev.providerImportsCount > 0 && input.external.source.result === 'NOT_PERFORMED'
        ? ({
            ...input.external.source,
            availability: 'PARTIAL',
            result: ev.openProviderBreaks > 0 ? 'DIFFERENCES' : 'EVIDENCE_RECORDED',
            checkedAt: ev.latestProviderImportedAt,
            detail:
              ev.openProviderBreaks > 0
                ? `${ev.providerImportsCount} settlement report(s) imported with ${ev.openProviderBreaks} unresolved provider break(s).`
                : `${ev.providerImportsCount} settlement report(s) imported and matched against internal records.`,
          } as ReconciliationSourceView)
        : input.external.source;
    const statement: ReconciliationSourceView =
      ev.statementImportsCount > 0
        ? ({
            source: 'EXTERNAL_STATEMENT',
            label: 'External bank statement reconciliation',
            availability: ev.hasVerifiedStatement ? 'AVAILABLE' : 'PARTIAL',
            description:
              'Compares imported Monnify Wallet or corporate settlement bank statements against settlement batches, outbound payouts, and internal ledger records.',
            evidenceKind: 'BANK_STATEMENT',
            checkedAt: ev.latestStatementImportedAt,
            result:
              ev.openStatementBreaks > 0
                ? 'DIFFERENCES'
                : ev.hasVerifiedStatement
                  ? 'AGREED'
                  : 'EVIDENCE_RECORDED',
            detail:
              ev.openStatementBreaks > 0
                ? `${ev.statementImportsCount} statement file(s) imported with ${ev.openStatementBreaks} unresolved statement or settlement batch break(s).`
                : `${ev.statementImportsCount} statement file(s) imported with zero open statement breaks.`,
            providerKeys: ev.statementProviders,
          } as ReconciliationSourceView)
        : ({
            source: 'EXTERNAL_STATEMENT',
            label: 'External bank statement reconciliation',
            availability: 'UNAVAILABLE',
            description:
              'Compares our ledger to an ingested bank/partner statement file. No statement file has been imported for this institution yet.',
            evidenceKind: 'BANK_STATEMENT',
            checkedAt: null,
            result: 'NOT_PERFORMED',
            detail:
              'No Monnify Wallet or settlement bank statement file has been imported for this institution yet. Absence of a statement result is unavailable evidence — never a successful reconciliation.',
            providerKeys: [],
          } as ReconciliationSourceView);
    return [internal, external, statement];
  }

  private async providerReadiness(institutionId: string): Promise<ProviderReadinessView[]> {
    const providers = await this.readiness.forInstitution(institutionId);
    return providers.map((provider) => {
      const reconciliation = provider.capabilities.find(
        (capability) => capability.capability === 'RECONCILIATION_OBSERVATIONS',
      );
      return {
        providerKey: provider.providerKey,
        environment: provider.environment,
        state: this.worstCapabilityState(provider.capabilities.map((entry) => entry.state)),
        usable: reconciliation?.usable === true,
        entitled: 'UNKNOWN',
        summary: provider.summary,
        reconciliationCapability: reconciliation
          ? { state: reconciliation.state, usable: reconciliation.usable }
          : null,
      };
    });
  }

  private worstCapabilityState(states: string[]): string {
    for (const state of [
      'DISABLED',
      'IMPLEMENTED_NOT_APPROVED',
      'APPROVED_NOT_CREDENTIALED',
      'CREDENTIALED_NOT_OPERATIONAL',
      'UNSUPPORTED',
      'OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED',
    ]) {
      if (states.includes(state)) return state;
    }
    return 'UNKNOWN';
  }

  // --------------------------------------------------------------- persistence helpers

  private async journalRow(journalId: string): Promise<JournalRow | null> {
    const rows = await this.dataSource.query<JournalRow[]>(
      `SELECT j.id, j.reference, j.description, j.status, j.currency, j.accounting_unit,
              j.total_minor::text AS total_minor, j.idempotency_key, j.correlation_id,
              j.metadata, j.reversal_of_journal_id, rev.id AS reversed_by_journal_id,
              j.created_at, j.posted_at, j.institution_id,
              i.code AS institution_code, COALESCE(i.display_name, i.legal_name) AS institution_name,
              i.status AS institution_status,
              (SELECT count(*) FROM ledger_lines l WHERE l.journal_id = j.id)::text AS line_count
         FROM ledger_journals j
         LEFT JOIN financial_institutions i ON i.id = j.institution_id
         LEFT JOIN ledger_journals rev ON rev.reversal_of_journal_id = j.id
        WHERE j.id = $1
        LIMIT 1`,
      [journalId],
    );
    return rows[0] ?? null;
  }

  /**
   * Durable inbound identity is owned by PR #23 (migration 0806). This service may ship before that
   * migration lands, so the relation is only queried when it actually exists — an absent link table
   * is "no proven source", never a missing-table 500.
   */
  private inboundLinkTablePresence: boolean | null = null;

  private async hasDurableInboundLinks(): Promise<boolean> {
    if (this.inboundLinkTablePresence !== null) return this.inboundLinkTablePresence;
    const rows = await this.dataSource.query<Array<{ present: boolean }>>(
      `SELECT to_regclass('public.banking_inbound_float_links') IS NOT NULL AS present`,
    );
    this.inboundLinkTablePresence = rows[0]?.present === true;
    return this.inboundLinkTablePresence;
  }

  /**
   * The authoritative Bank to Wallet business key is the immutable bank-intake UUID, resolved from
   * persisted evidence only: the posted float receipt → `banking_inbound_float_links` → the verified
   * `banking_inbound_payments` row. The float receipt UUID, the journal UUID and any reference prefix
   * are never substituted for it.
   */
  private async durableInboundSource(journalId: string): Promise<JournalSourceLink | null> {
    if (!(await this.hasDurableInboundLinks())) return null;
    const rows = await this.dataSource.query<SourceRow[]>(
      `SELECT 'BANK_TO_WALLET'::text AS source_type,
              b.id::text AS id,
              b.provider_transaction_reference AS reference,
              'CREDITED'::text AS status,
              'DURABLE_INBOUND_LINK'::text AS linked_by,
              b.recorded_at AS created_at
         FROM banking_inbound_float_links l
         JOIN agent_float_funding_receipts r ON r.id = l.float_receipt_id
         JOIN banking_inbound_payments b ON b.id = l.payment_id
        WHERE r.journal_id = $1
        LIMIT 1`,
      [journalId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      type: 'BANK_TO_WALLET',
      id: row.id,
      reference: row.reference,
      status: row.status,
      linkedBy: 'DURABLE_INBOUND_LINK',
      navigable: true,
    };
  }

  /**
   * Legacy wallet receipts have no persisted provider/environment binding, so they keep their own
   * `BANK_TO_WALLET/<receipt UUID>` identity (PR #23 contract) and are never joined to a banking row
   * by hash or reference. Suspense receipts have no implemented resolution and stay unlinked.
   */
  private async legacyInboundSource(journalId: string): Promise<JournalSourceLink | null> {
    const rows = await this.dataSource.query<SourceRow[]>(
      `SELECT 'BANK_TO_WALLET'::text AS source_type,
              r.id::text AS id,
              COALESCE(o.provider_reference, r.id::text) AS reference,
              'CREDITED'::text AS status,
              'LEGACY_RECEIPT_JOURNAL'::text AS linked_by,
              r.created_at AS created_at
         FROM inbound_funding_receipts r
         LEFT JOIN LATERAL (
           SELECT x.provider_reference
             FROM inbound_funding_observations x
            WHERE x.provider_key = r.provider_key
              AND x.provider_reference_hash = r.provider_reference_hash
              AND x.evidence_hash = r.evidence_hash
            ORDER BY x.created_at, x.id
            LIMIT 1
         ) o ON true
        WHERE r.journal_id = $1 AND r.status = 'CREDITED'
        LIMIT 1`,
      [journalId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      type: 'BANK_TO_WALLET',
      id: row.id,
      reference: row.reference,
      status: row.status,
      linkedBy: 'LEGACY_RECEIPT_JOURNAL',
      navigable: true,
    };
  }

  private async sourceFor(journalId: string): Promise<JournalSourceLink | null> {
    // Persisted inbound identity wins; the generic source rows below do not know about float receipts.
    const inbound =
      (await this.durableInboundSource(journalId)) ?? (await this.legacyInboundSource(journalId));
    if (inbound) return inbound;
    const rows = await this.dataSource.query<SourceRow[]>(
      `SELECT * FROM (
          SELECT 'TRANSFER'::text AS source_type, t.id::text AS id, t.reference, t.status,
                 'JOURNAL_ID'::text AS linked_by, t.created_at
            FROM transfers t WHERE t.journal_id = $1
          UNION ALL
          SELECT 'DEPOSIT', d.id::text, d.reference, d.status, 'JOURNAL_ID', d.created_at
            FROM deposits d WHERE d.journal_id = $1
          UNION ALL
          SELECT 'WITHDRAWAL', w.id::text, w.reference, w.status, 'JOURNAL_ID', w.created_at
            FROM withdrawals w WHERE w.journal_id = $1
          UNION ALL
          SELECT 'CUSTOMER_FUNDING', c.id::text, c.reference, c.status, 'JOURNAL_ID', c.created_at
            FROM customer_funding_requests c WHERE c.journal_id = $1
          UNION ALL
          SELECT 'AGENT_FUNDING', a.id::text, a.reference, a.status, 'JOURNAL_ID', a.created_at
            FROM agent_funding_requests a WHERE a.journal_id = $1
          UNION ALL
          SELECT 'CASH_TO_CASH', cc.id::text, cc.reference, cc.status, 'JOURNAL_ID', cc.created_at
            FROM cash_to_cash_transfers cc WHERE cc.journal_id = $1
          UNION ALL
          SELECT 'CASH_TO_CASH', cc.id::text, cc.reference, cc.status, 'CLAIM_JOURNAL_ID', cc.claimed_at
            FROM cash_to_cash_transfers cc WHERE cc.claim_journal_id = $1
       ) s
       ORDER BY s.created_at ASC NULLS LAST
       LIMIT 1`,
      [journalId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      type: row.source_type,
      id: row.id,
      reference: row.reference,
      status: row.status,
      linkedBy: row.linked_by,
      navigable: ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'BANK_TO_WALLET'].includes(row.source_type),
    };
  }

  private async findSourceForTransaction(
    key: string,
    typeHint?: string,
  ): Promise<{
    id: string;
    type: JournalSourceType;
    reference: string | null;
    status: string;
    createdAt: string;
    journalId: string | null;
  } | null> {
    const order = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL'] as const;
    const hint = typeHint?.trim().toUpperCase();
    const types = (order as readonly string[]).includes(hint ?? '')
      ? [hint as (typeof order)[number]]
      : [...order];
    for (const type of types) {
      const table =
        type === 'TRANSFER' ? 'transfers' : type === 'DEPOSIT' ? 'deposits' : 'withdrawals';
      const rows = await this.dataSource.query<
        Array<{
          id: string;
          reference: string | null;
          status: string;
          created_at: Date | string;
          journal_id: string | null;
        }>
      >(
        `SELECT id, reference, status, created_at, journal_id
           FROM ${table}
          WHERE id::text = $1 OR reference = $1 OR idempotency_key = $1
          LIMIT 1`,
        [key],
      );
      const row = rows[0];
      if (row) {
        return {
          id: row.id,
          type,
          reference: row.reference,
          status: row.status,
          createdAt: this.iso(row.created_at),
          journalId: row.journal_id,
        };
      }
    }
    return null;
  }

  private async latestReversalApproval(journalId: string): Promise<{
    id: string;
    status: string;
    requested_at: Date | string;
    expires_at: Date | string;
    requester_principal_id: string;
    approved_by: string | null;
    reason: string;
    action_type: string;
    resource_type: string;
  } | null> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        status: string;
        requested_at: Date | string;
        expires_at: Date | string;
        requester_principal_id: string;
        approved_by: string | null;
        reason: string;
        action_type: string;
        resource_type: string;
      }>
    >(
      `SELECT id, status, requested_at, expires_at, requester_principal_id, approved_by, reason,
              action_type, resource_type
         FROM privileged_action_approvals
        WHERE action_type = $1 AND resource_type = $2 AND lower(resource_id) = $3
        ORDER BY requested_at DESC
        LIMIT 1`,
      [REVERSAL_ACTION_TYPE, REVERSAL_RESOURCE_TYPE, journalId.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  // ------------------------------------------------------------------ mapping

  private async toSummary(row: JournalRow): Promise<CashLedgerJournalSummary> {
    return {
      id: row.id,
      reference: row.reference,
      description: row.description,
      status: row.status,
      currency: row.currency,
      accountingUnit: row.accounting_unit,
      totalMinor: row.total_minor,
      lineCount: Number(row.line_count),
      institution: row.institution_id
        ? {
            id: row.institution_id,
            code: row.institution_code ?? 'UNKNOWN',
            name: row.institution_name ?? 'Unknown institution',
            status: row.institution_status ?? 'UNKNOWN',
          }
        : null,
      source: await this.sourceFor(row.id),
      reversal: row.reversal_of_journal_id
        ? {
            kind: 'IS_REVERSAL',
            reversalOfJournalId: row.reversal_of_journal_id,
            reversedByJournalId: null,
          }
        : row.reversed_by_journal_id
          ? {
              kind: 'REVERSED',
              reversalOfJournalId: null,
              reversedByJournalId: row.reversed_by_journal_id,
            }
          : { kind: 'NORMAL', reversalOfJournalId: null, reversedByJournalId: null },
      createdAt: this.iso(row.created_at),
      postedAt: this.iso(row.posted_at),
    };
  }

  private internalBreak(
    institution: FinanceInstitutionSummary,
    input: Omit<FinanceBreakView, 'institution' | 'source' | 'state' | 'run' | 'provider'> &
      Partial<Pick<FinanceBreakView, 'journalId'>>,
  ): FinanceBreakView {
    return {
      ...input,
      institution,
      journalId: input.journalId ?? null,
      run: null,
      provider: null,
      source: 'INTERNAL_LEDGER',
      state: input.severity === 'CRITICAL' ? 'ERROR' : 'WARNING',
    };
  }

  private externalBreakTitle(kind: string): string {
    switch (kind) {
      case 'AMOUNT_MISMATCH':
        return 'Provider amount differs from our record';
      case 'STATUS_MISMATCH':
        return 'Provider status differs from our record';
      case 'MISSING_AT_PROVIDER':
        return 'Provider has no record of this subject';
      case 'MISSING_INTERNALLY':
        return 'Provider reports a subject we do not hold';
      case 'DUPLICATE_AT_PROVIDER':
        return 'Provider reports a duplicate subject';
      case 'UNVERIFIABLE':
        return 'Provider evidence could not be obtained';
      default:
        return 'Provider reconciliation difference';
    }
  }

  private nextActionLabel(action: ReversalEligibilityView['nextAction']): string {
    switch (action) {
      case 'REQUEST_REVERSAL':
        return 'Request governed reversal';
      case 'AWAIT_APPROVAL':
        return 'Await independent approval';
      case 'EXECUTE_REVERSAL':
        return 'Execute approved reversal';
      default:
        return 'No reversal action available';
    }
  }

  private async institutionById(id: string): Promise<FinanceInstitutionSummary | null> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        code: string;
        legal_name: string;
        display_name: string | null;
        status: string;
      }>
    >(
      `SELECT id, code, legal_name, display_name, status
         FROM financial_institutions
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [id],
    );
    return rows[0] ? this.institution(rows[0]) : null;
  }

  private institution(row: {
    id: string;
    code: string;
    legal_name: string;
    display_name: string | null;
    status: string;
  }): FinanceInstitutionSummary {
    return {
      id: row.id,
      code: row.code,
      name: row.display_name ?? row.legal_name,
      status: row.status,
    };
  }

  // ------------------------------------------------------------------ validation

  private range(
    fromInput?: string,
    toInput?: string,
    options: { defaultDays?: number } = {},
  ): { from: Date; to: Date } {
    const now = new Date();
    const defaultDays = options.defaultDays ?? 30;
    const from = fromInput
      ? this.parseBoundary(fromInput, 'from', 'start')
      : new Date(now.getTime() - defaultDays * DAY_MS);
    const to = toInput ? this.parseBoundary(toInput, 'to', 'end') : new Date(now.getTime());
    if (Number.isNaN(from.getTime())) throw new BadRequestException('from must be a valid date');
    if (Number.isNaN(to.getTime())) throw new BadRequestException('to must be a valid date');
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before or equal to to');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(`date range must not exceed ${MAX_RANGE_DAYS} days`);
    }
    return { from, to };
  }

  private parseBoundary(value: string, field: string, edge: 'start' | 'end'): Date {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = new Date(`${trimmed}T00:00:00.000Z`);
      if (edge === 'end') return new Date(date.getTime() + DAY_MS - 1);
      return date;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be an ISO date or date-time`);
    }
    return parsed;
  }

  private sourceFilter(value?: string): ReconciliationCheckSource | 'ALL' {
    const normalized = this.optionalText(value, 24, 'source')?.toUpperCase() ?? 'ALL';
    if (
      !['ALL', 'INTERNAL_LEDGER', 'EXTERNAL_PROVIDER', 'EXTERNAL_STATEMENT'].includes(normalized)
    ) {
      throw new BadRequestException(
        'source must be ALL, INTERNAL_LEDGER, EXTERNAL_PROVIDER or EXTERNAL_STATEMENT',
      );
    }
    return normalized as ReconciliationCheckSource | 'ALL';
  }

  private optionalText(value: string | undefined, max: number, field: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    if (trimmed.length > max) {
      throw new BadRequestException(`${field} must be at most ${max} characters`);
    }
    return trimmed;
  }

  private requiredText(value: string | undefined, field: string, max: number): string {
    const normalized = this.optionalText(value, max, field);
    if (!normalized) throw new BadRequestException(`${field} is required`);
    return normalized;
  }

  private boundedInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return parsed;
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private likePattern(value: string): string {
    return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  }

  private iso(value: Date | string): string {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}
