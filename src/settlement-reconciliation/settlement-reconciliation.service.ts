import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import { AuditService } from '../operations/audit.service';
import { SettlementReportAdapterRegistry } from './adapters/settlement-report-adapter.registry';
import type {
  ImportSettlementReportDto,
  ListSettlementReconciliationQueryDto,
  ProposeReturnDisputeResolutionDto,
  ProposeSettlementMatchResolutionDto,
  ProposeTransactionMatchResolutionDto,
  ReviewReconciliationProposalDto,
} from './dto/settlement-reconciliation.dto';
import {
  detectOptionalSchemaCapabilities,
  eventFingerprint,
  findInboundCandidates,
  findMatchingInternalDisputes,
  findOutboundCandidates,
  toAmbiguousInboundCandidate,
  toAmbiguousOutboundCandidate,
  type InternalInboundCandidate,
  type InternalOutboundCandidate,
  type OptionalArena9SchemaCapabilities,
  type SqlQueryable,
} from './settlement-reconciliation-queries';
import type {
  AmbiguousMatchCandidate,
  NormalizedSettlementReportRow,
  RejectedSettlementReportRow,
  ReconciliationReviewState,
  ReturnDisputeCaseKind,
  ReturnDisputeLifecycleStatus,
  SettlementBatchStatus,
  SettlementReconciliationScope,
  SettlementReportFormatDescriptor,
  SettlementReportType,
  StatementDestination,
  TransactionMatchStatus,
} from './settlement-reconciliation.types';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function rAccountFallback(row: NormalizedSettlementReportRow): string | null {
  return row.maskedCounterpartyAccount;
}

export interface ImportPreviewResponse {
  providerKey: string;
  reportType: SettlementReportType;
  fileFormat: 'CSV' | 'JSON';
  scope: SettlementReconciliationScope;
  institutionId: string | null;
  fileName: string;
  contentSha256: string;
  alreadyImportedFileId: string | null;
  verificationStatus: string;
  verificationNote: string;
  missingSampleNeeded: string | null;
  currency: string;
  detectedMaskedAccount: string | null;
  totalRows: number;
  validRowsCount: number;
  rejectedRowsCount: number;
  intraFileDuplicateRowsCount: number;
  priorImportDuplicateRowsCount: number;
  grossTotalMinor: string;
  providerFeeTotalMinor: string;
  netTotalMinor: string;
  financeReviewRowsCount: number;
  internalMerchantSettlementTotalMinor: string;
  internalPlatformFeeTotalMinor: string;
  internalCustomerCreditTotalMinor: string;
  predictedCounts: Record<string, number>;
  sampleValidRows: Array<{
    rowNumber: number;
    direction: string;
    providerTransactionReference: string | null;
    platformReference: string | null;
    settlementReference: string | null;
    nipSessionId: string | null;
    grossAmountMinor: string;
    providerFeeMinor: string;
    netAmountMinor: string;
    providerStatus: string;
    occurredAt: string | null;
    maskedAccount: string | null;
    predictedStatus: string;
    requiresFinanceReview: boolean;
    internalMerchantSettlementMinor: string | null;
    internalPlatformFeeMinor: string | null;
    internalCustomerCreditMinor: string | null;
    ambiguousCandidatesCount: number;
    explanation: string;
  }>;
  rejectedRows: RejectedSettlementReportRow[];
}

@Injectable()
export class SettlementReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scopeService: InstitutionWorkforceScopeService,
    private readonly audit: AuditService,
    private readonly adapters: SettlementReportAdapterRegistry,
  ) {}

  // --------------------------------------------------- scope & authorization

  private requireWorkforceLedgerReader(principal: AuthorizationPrincipal): void {
    if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException(
        'Settlement report reconciliation is restricted to workforce principals',
      );
    }
    if (!principal.scopes.includes('ledger.view')) {
      throw new ForbiddenException('Settlement report reconciliation requires ledger.view');
    }
  }

  private requireMaker(principal: AuthorizationPrincipal): void {
    this.requireWorkforceLedgerReader(principal);
    if (!principal.roles.includes('FINANCE_PREPARER')) {
      throw new ForbiddenException(
        'Importing settlement reports or proposing reconciliation resolutions requires the FINANCE_PREPARER role',
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException(
        'Importing settlement reports or proposing reconciliation resolutions requires an MFA-verified session',
      );
    }
  }

  private requireChecker(principal: AuthorizationPrincipal): void {
    this.requireWorkforceLedgerReader(principal);
    if (!principal.roles.includes('FINANCE_CONTROLLER')) {
      throw new ForbiddenException(
        'Reviewing settlement reconciliation proposals requires the FINANCE_CONTROLLER role',
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException(
        'Reviewing settlement reconciliation proposals requires an MFA-verified session',
      );
    }
  }

  private async verifyInstitutionExistsAndVisible(
    q: SqlQueryable,
    principal: AuthorizationPrincipal,
    institutionId: string,
  ): Promise<{ id: string; code: string; displayName: string }> {
    const rows = await q.query<Array<{ id: string; code: string; display_name: string }>>(
      `SELECT id::text AS id, code, display_name
         FROM financial_institutions
        WHERE id = $1::uuid AND deleted_at IS NULL`,
      [institutionId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Institution not found');
    }
    if (!this.scopeService.hasPlatformAuthority(principal)) {
      const assigned = await this.scopeService.institutionIdsForPrincipal(principal.principalId);
      if (!assigned.includes(institutionId)) {
        // 404 anti-probe on out-of-scope institution IDs
        throw new NotFoundException('Institution not found');
      }
    }
    return {
      id: rows[0].id,
      code: rows[0].code,
      displayName: rows[0].display_name,
    };
  }

  private async isRecordVisible(
    principal: AuthorizationPrincipal,
    institutionId: string | null,
  ): Promise<boolean> {
    if (this.scopeService.hasPlatformAuthority(principal)) {
      return true;
    }
    if (!institutionId) {
      // Institution-scoped staff only see their assigned institutions
      return false;
    }
    const assigned = await this.scopeService.institutionIdsForPrincipal(principal.principalId);
    return assigned.includes(institutionId);
  }

  private async resolveWriteTargetScope(
    q: SqlQueryable,
    principal: AuthorizationPrincipal,
    requestedInstitutionId: string | undefined,
  ): Promise<{ scope: SettlementReconciliationScope; institutionId: string | null }> {
    if (requestedInstitutionId) {
      await this.verifyInstitutionExistsAndVisible(q, principal, requestedInstitutionId);
      return { scope: 'INSTITUTION', institutionId: requestedInstitutionId };
    }
    if (this.scopeService.hasPlatformAuthority(principal)) {
      return { scope: 'PLATFORM', institutionId: null };
    }
    const assigned = await this.scopeService.institutionIdsForPrincipal(principal.principalId);
    if (assigned.length === 1) {
      await this.verifyInstitutionExistsAndVisible(q, principal, assigned[0]!);
      return { scope: 'INSTITUTION', institutionId: assigned[0]! };
    }
    throw new BadRequestException(
      'Select a specific assigned institution before importing or previewing a settlement report.',
    );
  }

  private async buildReadFilterSql(
    q: SqlQueryable,
    principal: AuthorizationPrincipal,
    requestedInstitutionId: string | undefined,
    alias: string,
    params: unknown[],
  ): Promise<{ clause: string; emptyShortCircuit: boolean }> {
    this.requireWorkforceLedgerReader(principal);
    if (requestedInstitutionId) {
      await this.verifyInstitutionExistsAndVisible(q, principal, requestedInstitutionId);
      params.push(requestedInstitutionId);
      return {
        clause: `${alias}.institution_id = $${params.length}::uuid`,
        emptyShortCircuit: false,
      };
    }
    if (this.scopeService.hasPlatformAuthority(principal)) {
      return { clause: 'TRUE', emptyShortCircuit: false };
    }
    const assigned = await this.scopeService.institutionIdsForPrincipal(principal.principalId);
    if (assigned.length === 0) {
      return { clause: 'FALSE', emptyShortCircuit: true };
    }
    params.push(assigned);
    return {
      clause: `${alias}.institution_id = ANY($${params.length}::uuid[])`,
      emptyShortCircuit: false,
    };
  }

  // ------------------------------------------------ workspace & format matrix

  async getWorkspaceOverview(
    principal: AuthorizationPrincipal,
    query: { institutionId?: string },
  ): Promise<{
    capabilities: {
      canImportAndPropose: boolean;
      canReview: boolean;
      mfaVerified: boolean;
      hasPlatformAuthority: boolean;
      assignedInstitutionIds: string[];
    };
    selectableInstitutions: Array<{ id: string; code: string; displayName: string }>;
    formatDescriptors: SettlementReportFormatDescriptor[];
    summary: {
      importsCount: number;
      unverifiedFormatImportsCount: number;
      matchedTransactionsCount: number;
      exceptionTransactionsCount: number;
      pendingTransactionReviewsCount: number;
      reconciledSettlementsCount: number;
      openSettlementBreaksCount: number;
      pendingSettlementReviewsCount: number;
      openReturnDisputeCasesCount: number;
      reconciledReturnDisputeCasesCount: number;
      pendingReturnDisputeReviewsCount: number;
    };
  }> {
    this.requireWorkforceLedgerReader(principal);
    const hasPlatformAuthority = this.scopeService.hasPlatformAuthority(principal);
    const assignedInstitutionIds = hasPlatformAuthority
      ? []
      : await this.scopeService.institutionIdsForPrincipal(principal.principalId);

    // Ensure internal return candidates (e.g. Arena 9 APPROVED_FOR_RETURN / reversed payouts) are synced
    await this.syncInternalReturnCandidates(this.dataSource, principal, query.institutionId);

    const institutionsRows = hasPlatformAuthority
      ? await this.dataSource.query<Array<{ id: string; code: string; display_name: string }>>(
          `SELECT id::text AS id, code, display_name
             FROM financial_institutions
            WHERE deleted_at IS NULL
            ORDER BY code ASC`,
        )
      : assignedInstitutionIds.length > 0
        ? await this.dataSource.query<Array<{ id: string; code: string; display_name: string }>>(
            `SELECT id::text AS id, code, display_name
               FROM financial_institutions
              WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
              ORDER BY code ASC`,
            [assignedInstitutionIds],
          )
        : [];

    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(
      this.dataSource,
      principal,
      query.institutionId,
      't',
      params,
    );

    if (filter.emptyShortCircuit) {
      return {
        capabilities: {
          canImportAndPropose: principal.roles.includes('FINANCE_PREPARER'),
          canReview: principal.roles.includes('FINANCE_CONTROLLER'),
          mfaVerified: principal.assuranceLevel === 'MFA',
          hasPlatformAuthority,
          assignedInstitutionIds,
        },
        selectableInstitutions: [],
        formatDescriptors: this.adapters.listFormatDescriptors(),
        summary: {
          importsCount: 0,
          unverifiedFormatImportsCount: 0,
          matchedTransactionsCount: 0,
          exceptionTransactionsCount: 0,
          pendingTransactionReviewsCount: 0,
          reconciledSettlementsCount: 0,
          openSettlementBreaksCount: 0,
          pendingSettlementReviewsCount: 0,
          openReturnDisputeCasesCount: 0,
          reconciledReturnDisputeCasesCount: 0,
          pendingReturnDisputeReviewsCount: 0,
        },
      };
    }

    const [impAgg, txAgg, setAgg, retAgg] = await Promise.all([
      this.dataSource.query<Array<{ total: number; unverified: number }>>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE t.verification_status = 'UNVERIFIED_MISSING_REDACTED_EXPORT')::int AS unverified
           FROM settlement_report_imports t
          WHERE ${filter.clause}`,
        params,
      ),
      this.dataSource.query<
        Array<{ matched: number; exceptions: number; pending_reviews: number }>
      >(
        `SELECT COUNT(*) FILTER (WHERE t.match_status = 'MATCHED')::int AS matched,
                COUNT(*) FILTER (WHERE t.match_status <> 'MATCHED' AND t.review_state <> 'APPROVED')::int AS exceptions,
                COUNT(*) FILTER (WHERE t.review_state = 'PROPOSED')::int AS pending_reviews
           FROM settlement_transaction_matches t
          WHERE ${filter.clause}`,
        params,
      ),
      this.dataSource.query<
        Array<{ reconciled: number; open_breaks: number; pending_reviews: number }>
      >(
        `SELECT COUNT(*) FILTER (WHERE t.batch_status = 'RECONCILED' OR t.review_state = 'APPROVED')::int AS reconciled,
                COUNT(*) FILTER (WHERE t.batch_status <> 'RECONCILED' AND t.review_state <> 'APPROVED')::int AS open_breaks,
                COUNT(*) FILTER (WHERE t.review_state = 'PROPOSED')::int AS pending_reviews
           FROM settlement_batch_reconciliations t
          WHERE ${filter.clause}`,
        params,
      ),
      this.dataSource.query<
        Array<{ reconciled: number; open_cases: number; pending_reviews: number }>
      >(
        `SELECT COUNT(*) FILTER (WHERE t.lifecycle_status = 'RECONCILED' OR t.review_state = 'APPROVED')::int AS reconciled,
                COUNT(*) FILTER (WHERE t.lifecycle_status <> 'RECONCILED' AND t.review_state <> 'APPROVED')::int AS open_cases,
                COUNT(*) FILTER (WHERE t.review_state = 'PROPOSED')::int AS pending_reviews
           FROM settlement_return_dispute_cases t
          WHERE ${filter.clause}`,
        params,
      ),
    ]);

    return {
      capabilities: {
        canImportAndPropose: principal.roles.includes('FINANCE_PREPARER'),
        canReview: principal.roles.includes('FINANCE_CONTROLLER'),
        mfaVerified: principal.assuranceLevel === 'MFA',
        hasPlatformAuthority,
        assignedInstitutionIds,
      },
      selectableInstitutions: institutionsRows.map((r) => ({
        id: r.id,
        code: r.code,
        displayName: r.display_name,
      })),
      formatDescriptors: this.adapters.listFormatDescriptors(),
      summary: {
        importsCount: impAgg[0]?.total ?? 0,
        unverifiedFormatImportsCount: impAgg[0]?.unverified ?? 0,
        matchedTransactionsCount: txAgg[0]?.matched ?? 0,
        exceptionTransactionsCount: txAgg[0]?.exceptions ?? 0,
        pendingTransactionReviewsCount: txAgg[0]?.pending_reviews ?? 0,
        reconciledSettlementsCount: setAgg[0]?.reconciled ?? 0,
        openSettlementBreaksCount: setAgg[0]?.open_breaks ?? 0,
        pendingSettlementReviewsCount: setAgg[0]?.pending_reviews ?? 0,
        openReturnDisputeCasesCount: retAgg[0]?.open_cases ?? 0,
        reconciledReturnDisputeCasesCount: retAgg[0]?.reconciled ?? 0,
        pendingReturnDisputeReviewsCount: retAgg[0]?.pending_reviews ?? 0,
      },
    };
  }

  // ------------------------------------------------ Workflow 1: Report Import

  async previewImport(
    principal: AuthorizationPrincipal,
    dto: ImportSettlementReportDto & { institutionId?: string },
  ): Promise<ImportPreviewResponse> {
    const target = await this.resolveWriteTargetScope(
      this.dataSource,
      principal,
      dto.institutionId,
    );
    const adapter = this.adapters.getOrThrow(dto.providerKey);
    const parsed = adapter.parse({
      reportType: dto.reportType,
      fileName: dto.fileName,
      content: dto.content,
      defaultCurrency: dto.defaultCurrency ?? 'NGN',
    });

    const contentSha256 = createHash('sha256').update(dto.content, 'utf8').digest('hex');

    const existingImportRows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM settlement_report_imports
        WHERE COALESCE(institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND provider_key = $3
          AND report_type = $4
          AND content_sha256 = $5
        LIMIT 1`,
      [ZERO_UUID, target.institutionId, parsed.providerKey, parsed.reportType, contentSha256],
    );

    // Detect intra-file duplicate fingerprints
    const seenFingerprints = new Set<string>();
    const deduplicatedRows: NormalizedSettlementReportRow[] = [];
    const rejectedRows: RejectedSettlementReportRow[] = [...parsed.rejectedRows];
    let intraFileDuplicateRowsCount = 0;

    for (const row of parsed.validRows) {
      if (seenFingerprints.has(row.rowFingerprint)) {
        intraFileDuplicateRowsCount += 1;
        rejectedRows.push({
          rowNumber: row.rowNumber,
          reasonCode: 'DUPLICATE_ROW_IN_FILE',
          message:
            'Duplicate row fingerprint within the same uploaded report file; skipped to prevent double-counting.',
          sanitizedPreview: {
            providerTransactionReference: row.providerTransactionReference,
            platformReference: row.platformReference,
            settlementReference: row.settlementReference,
            grossAmountMinor: row.grossAmountMinor,
          },
        });
        continue;
      }
      seenFingerprints.add(row.rowFingerprint);
      deduplicatedRows.push(row);
    }

    // Detect fingerprints already imported in earlier overlapping files for this scope/provider/reportType
    let priorImportDuplicateRowsCount = 0;
    let freshRows = deduplicatedRows;
    if (deduplicatedRows.length > 0 && !existingImportRows[0]) {
      const priorRows = await this.dataSource.query<Array<{ row_fingerprint: string }>>(
        `SELECT r.row_fingerprint
           FROM settlement_report_rows r
           JOIN settlement_report_imports i ON i.id = r.import_id
          WHERE COALESCE(i.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
            AND i.provider_key = $3
            AND i.report_type = $4
            AND r.row_fingerprint = ANY($5::text[])`,
        [
          ZERO_UUID,
          target.institutionId,
          parsed.providerKey,
          parsed.reportType,
          deduplicatedRows.map((r) => r.rowFingerprint),
        ],
      );
      const priorSet = new Set(priorRows.map((r) => r.row_fingerprint));
      priorImportDuplicateRowsCount = priorSet.size;
      freshRows = deduplicatedRows.filter((r) => !priorSet.has(r.rowFingerprint));
    }

    const grossTotal = freshRows.reduce((acc, r) => acc + BigInt(r.grossAmountMinor), 0n);
    const feeTotal = freshRows.reduce((acc, r) => acc + BigInt(r.providerFeeMinor), 0n);
    const netTotal = freshRows.reduce((acc, r) => acc + BigInt(r.netAmountMinor), 0n);

    const caps = await detectOptionalSchemaCapabilities(this.dataSource);
    const predictedCounts: Record<string, number> = {};
    let financeReviewRowsCount = 0;
    let internalMerchantSettlementTotal = 0n;
    let internalPlatformFeeTotal = 0n;
    let internalCustomerCreditTotal = 0n;

    const evaluatedPreviewRows: ImportPreviewResponse['sampleValidRows'] = [];
    for (const [idx, row] of freshRows.slice(0, 200).entries()) {
      const detail = await this.evaluatePreviewRow(
        this.dataSource,
        caps,
        target.institutionId,
        parsed.providerKey,
        parsed.reportType,
        row,
      );
      predictedCounts[detail.predictedStatus] = (predictedCounts[detail.predictedStatus] ?? 0) + 1;
      if (detail.requiresFinanceReview) {
        financeReviewRowsCount += 1;
      }
      if (detail.internalMerchantSettlementMinor !== null) {
        internalMerchantSettlementTotal += BigInt(detail.internalMerchantSettlementMinor);
      }
      if (detail.internalPlatformFeeMinor !== null) {
        internalPlatformFeeTotal += BigInt(detail.internalPlatformFeeMinor);
      }
      if (detail.internalCustomerCreditMinor !== null) {
        internalCustomerCreditTotal += BigInt(detail.internalCustomerCreditMinor);
      }
      if (idx < 25) {
        evaluatedPreviewRows.push({
          rowNumber: row.rowNumber,
          direction: row.direction,
          providerTransactionReference: row.providerTransactionReference,
          platformReference: row.platformReference,
          settlementReference: row.settlementReference,
          nipSessionId: row.nipSessionId,
          grossAmountMinor: row.grossAmountMinor,
          providerFeeMinor: row.providerFeeMinor,
          netAmountMinor: row.netAmountMinor,
          providerStatus: row.providerStatus,
          occurredAt: row.occurredAt,
          maskedAccount: row.maskedDestinationAccount ?? rAccountFallback(row),
          predictedStatus: detail.predictedStatus,
          requiresFinanceReview: detail.requiresFinanceReview,
          internalMerchantSettlementMinor: detail.internalMerchantSettlementMinor,
          internalPlatformFeeMinor: detail.internalPlatformFeeMinor,
          internalCustomerCreditMinor: detail.internalCustomerCreditMinor,
          ambiguousCandidatesCount: detail.ambiguousCandidatesCount,
          explanation: detail.explanation,
        });
      }
    }

    return {
      providerKey: parsed.providerKey,
      reportType: parsed.reportType,
      fileFormat: parsed.fileFormat,
      scope: target.scope,
      institutionId: target.institutionId,
      fileName: dto.fileName,
      contentSha256,
      alreadyImportedFileId: existingImportRows[0]?.id ?? null,
      verificationStatus: parsed.verificationStatus,
      verificationNote: parsed.verificationNote,
      missingSampleNeeded: parsed.missingSampleNeeded,
      currency: parsed.currency,
      detectedMaskedAccount: parsed.detectedMaskedAccount,
      totalRows: parsed.totalRows,
      validRowsCount: freshRows.length,
      rejectedRowsCount: rejectedRows.length,
      intraFileDuplicateRowsCount,
      priorImportDuplicateRowsCount,
      grossTotalMinor: grossTotal.toString(),
      providerFeeTotalMinor: feeTotal.toString(),
      netTotalMinor: netTotal.toString(),
      financeReviewRowsCount,
      internalMerchantSettlementTotalMinor: internalMerchantSettlementTotal.toString(),
      internalPlatformFeeTotalMinor: internalPlatformFeeTotal.toString(),
      internalCustomerCreditTotalMinor: internalCustomerCreditTotal.toString(),
      predictedCounts,
      sampleValidRows: evaluatedPreviewRows,
      rejectedRows: rejectedRows.slice(0, 100),
    };
  }

  async importReport(
    principal: AuthorizationPrincipal,
    dto: ImportSettlementReportDto & { institutionId?: string },
  ): Promise<{
    idempotentReplay: boolean;
    priorImportDuplicateRowsSkipped: number;
    importRecord: Awaited<ReturnType<SettlementReconciliationService['getImportDetail']>>;
  }> {
    this.requireMaker(principal);
    const target = await this.resolveWriteTargetScope(
      this.dataSource,
      principal,
      dto.institutionId,
    );
    if (
      dto.periodStart &&
      dto.periodEnd &&
      Date.parse(dto.periodEnd) < Date.parse(dto.periodStart)
    ) {
      throw new BadRequestException('periodEnd cannot precede periodStart');
    }

    const adapter = this.adapters.getOrThrow(dto.providerKey);
    const parsed = adapter.parse({
      reportType: dto.reportType,
      fileName: dto.fileName,
      content: dto.content,
      defaultCurrency: dto.defaultCurrency ?? 'NGN',
    });
    const contentSha256 = createHash('sha256').update(dto.content, 'utf8').digest('hex');

    // Idempotent check for exact file re-upload
    const existing = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM settlement_report_imports
        WHERE COALESCE(institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND provider_key = $3
          AND report_type = $4
          AND content_sha256 = $5
        LIMIT 1`,
      [ZERO_UUID, target.institutionId, parsed.providerKey, parsed.reportType, contentSha256],
    );
    if (existing[0]) {
      const detail = await this.getImportDetail(principal, existing[0].id);
      return {
        idempotentReplay: true,
        priorImportDuplicateRowsSkipped: 0,
        importRecord: detail,
      };
    }

    const statementDestination: StatementDestination =
      dto.statementDestination ??
      (parsed.reportType === 'WALLET_STATEMENT'
        ? 'MONNIFY_WALLET'
        : parsed.reportType === 'BANK_STATEMENT'
          ? 'BANK_ACCOUNT'
          : 'UNSPECIFIED');

    const outcome = await this.dataSource.transaction(async (manager) => {
      // Re-check inside transaction under lock-safe unique index
      const raceCheck = await manager.query<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM settlement_report_imports
          WHERE COALESCE(institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
            AND provider_key = $3
            AND report_type = $4
            AND content_sha256 = $5
          LIMIT 1`,
        [ZERO_UUID, target.institutionId, parsed.providerKey, parsed.reportType, contentSha256],
      );
      if (raceCheck[0]) {
        return { importId: raceCheck[0].id, idempotentReplay: true, skippedPrior: 0 };
      }

      const seenInFile = new Set<string>();
      const rejectedRows: RejectedSettlementReportRow[] = [...parsed.rejectedRows];
      const uniqueRows: NormalizedSettlementReportRow[] = [];
      for (const row of parsed.validRows) {
        if (seenInFile.has(row.rowFingerprint)) {
          rejectedRows.push({
            rowNumber: row.rowNumber,
            reasonCode: 'DUPLICATE_ROW_IN_FILE',
            message:
              'Duplicate row fingerprint within the same uploaded report file; skipped to prevent double-counting.',
            sanitizedPreview: {
              providerTransactionReference: row.providerTransactionReference,
              platformReference: row.platformReference,
              settlementReference: row.settlementReference,
              grossAmountMinor: row.grossAmountMinor,
            },
          });
          continue;
        }
        seenInFile.add(row.rowFingerprint);
        uniqueRows.push(row);
      }

      // Skip rows already imported in an earlier overlapping report for the same scope/provider/type
      let freshRows = uniqueRows;
      let skippedPrior = 0;
      if (uniqueRows.length > 0) {
        const priorRows = await manager.query<Array<{ row_fingerprint: string }>>(
          `SELECT r.row_fingerprint
             FROM settlement_report_rows r
             JOIN settlement_report_imports i ON i.id = r.import_id
            WHERE COALESCE(i.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
              AND i.provider_key = $3
              AND i.report_type = $4
              AND r.row_fingerprint = ANY($5::text[])`,
          [
            ZERO_UUID,
            target.institutionId,
            parsed.providerKey,
            parsed.reportType,
            uniqueRows.map((r) => r.rowFingerprint),
          ],
        );
        const priorSet = new Set(priorRows.map((r) => r.row_fingerprint));
        skippedPrior = priorSet.size;
        freshRows = uniqueRows.filter((r) => {
          if (priorSet.has(r.rowFingerprint)) {
            rejectedRows.push({
              rowNumber: r.rowNumber,
              reasonCode: 'ALREADY_IMPORTED_IN_PRIOR_BATCH',
              message:
                'Identical row fingerprint was already imported in an earlier report batch; skipped to preserve idempotent totals.',
              sanitizedPreview: {
                providerTransactionReference: r.providerTransactionReference,
                settlementReference: r.settlementReference,
                grossAmountMinor: r.grossAmountMinor,
              },
            });
            return false;
          }
          return true;
        });
      }

      if (freshRows.length === 0 && parsed.totalRows === 0) {
        throw new BadRequestException('Report file contains zero rows to import');
      }

      const grossTotal = freshRows.reduce((acc, r) => acc + BigInt(r.grossAmountMinor), 0n);
      const feeTotal = freshRows.reduce((acc, r) => acc + BigInt(r.providerFeeMinor), 0n);
      const netTotal = freshRows.reduce((acc, r) => acc + BigInt(r.netAmountMinor), 0n);

      const insertedImport = await manager.query<Array<{ id: string }>>(
        `INSERT INTO settlement_report_imports (
           scope, institution_id, provider_key, report_type, file_format,
           verification_status, statement_destination, masked_statement_account,
           source_filename, content_sha256, byte_length, currency,
           period_start, period_end,
           total_rows, valid_rows, rejected_rows,
           gross_total_minor, provider_fee_total_minor, net_total_minor,
           imported_by, importer_note
         )
         VALUES (
           $1, $2::uuid, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12,
           $13::timestamptz, $14::timestamptz,
           $15, $16, $17,
           $18::numeric, $19::numeric, $20::numeric,
           $21, $22
         )
         RETURNING id::text AS id`,
        [
          target.scope,
          target.institutionId,
          parsed.providerKey,
          parsed.reportType,
          parsed.fileFormat,
          parsed.verificationStatus,
          statementDestination,
          parsed.detectedMaskedAccount,
          dto.fileName,
          contentSha256,
          Buffer.byteLength(dto.content, 'utf8'),
          parsed.currency,
          dto.periodStart ?? null,
          dto.periodEnd ?? null,
          parsed.totalRows,
          freshRows.length,
          rejectedRows.length,
          grossTotal.toString(),
          feeTotal.toString(),
          netTotal.toString(),
          principal.principalId,
          dto.note ?? null,
        ],
      );
      const importId = insertedImport[0]!.id;

      const persistedRows: Array<{ rowId: string; row: NormalizedSettlementReportRow }> = [];
      for (const row of freshRows) {
        const res = await manager.query<Array<{ id: string }>>(
          `INSERT INTO settlement_report_rows (
             import_id, row_number, direction,
             provider_transaction_reference, platform_reference, payment_reference,
             settlement_reference, payout_reference, nip_session_id, refund_or_dispute_reference,
             currency, gross_amount_minor, provider_fee_minor, net_amount_minor, running_balance_after_minor,
             provider_status, occurred_at, settled_at,
             masked_counterparty_account, masked_destination_account, counterparty_bank_code,
             narration, underlying_items, normalized_attributes, row_fingerprint
           )
           VALUES (
             $1::uuid, $2, $3,
             $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric,
             $16, $17::timestamptz, $18::timestamptz,
             $19, $20, $21,
             $22, $23::jsonb, $24::jsonb, $25
           )
           RETURNING id::text AS id`,
          [
            importId,
            row.rowNumber,
            row.direction,
            row.providerTransactionReference,
            row.platformReference,
            row.paymentReference,
            row.settlementReference,
            row.payoutReference,
            row.nipSessionId,
            row.refundOrDisputeReference,
            row.currency,
            row.grossAmountMinor,
            row.providerFeeMinor,
            row.netAmountMinor,
            row.runningBalanceAfterMinor,
            row.providerStatus,
            row.occurredAt,
            row.settledAt,
            row.maskedCounterpartyAccount,
            row.maskedDestinationAccount,
            row.counterpartyBankCode,
            row.narration,
            JSON.stringify(row.underlyingItems),
            JSON.stringify(row.normalizedAttributes),
            row.rowFingerprint,
          ],
        );
        persistedRows.push({ rowId: res[0]!.id, row });
      }

      for (const rej of rejectedRows) {
        await manager.query(
          `INSERT INTO settlement_report_rejected_rows (
             import_id, row_number, reason_code, message, sanitized_preview
           )
           VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
          [
            importId,
            rej.rowNumber,
            rej.reasonCode,
            rej.message.slice(0, 500),
            JSON.stringify(rej.sanitizedPreview),
          ],
        );
      }

      // Run Workflows 2, 3, and 4 deterministically on persisted evidence
      const caps = await detectOptionalSchemaCapabilities(manager);
      await this.executeReconciliationForImport(manager, caps, {
        importId,
        scope: target.scope,
        institutionId: target.institutionId,
        providerKey: parsed.providerKey,
        reportType: parsed.reportType,
        statementDestination,
        periodStart: dto.periodStart ?? null,
        periodEnd: dto.periodEnd ?? null,
        persistedRows,
      });

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_REPORT_IMPORT',
        entityId: importId,
        action: 'SETTLEMENT_REPORT_IMPORTED',
        actor: principal.principalId,
        newValues: {
          scope: target.scope,
          institutionId: target.institutionId,
          providerKey: parsed.providerKey,
          reportType: parsed.reportType,
          fileFormat: parsed.fileFormat,
          verificationStatus: parsed.verificationStatus,
          contentSha256,
          totalRows: parsed.totalRows,
          validRows: freshRows.length,
          rejectedRows: rejectedRows.length,
          priorImportDuplicateRowsSkipped: skippedPrior,
          grossTotalMinor: grossTotal.toString(),
          providerFeeTotalMinor: feeTotal.toString(),
          netTotalMinor: netTotal.toString(),
        },
      });

      return { importId, idempotentReplay: false, skippedPrior };
    });

    const detail = await this.getImportDetail(principal, outcome.importId);
    return {
      idempotentReplay: outcome.idempotentReplay,
      priorImportDuplicateRowsSkipped: outcome.skippedPrior,
      importRecord: detail,
    };
  }

  async listImports(
    principal: AuthorizationPrincipal,
    query: ListSettlementReconciliationQueryDto,
  ) {
    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(
      this.dataSource,
      principal,
      query.institutionId,
      'i',
      params,
    );
    if (filter.emptyShortCircuit) return { items: [] };

    const clauses = [filter.clause];
    if (query.reportType) {
      params.push(query.reportType);
      clauses.push(`i.report_type = $${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      clauses.push(
        `(i.source_filename ILIKE $${params.length} OR i.provider_key ILIKE $${params.length})`,
      );
    }

    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT i.id::text AS id,
              i.scope,
              i.institution_id::text AS institution_id,
              fi.code AS institution_code,
              i.provider_key,
              i.report_type,
              i.file_format,
              i.verification_status,
              i.statement_destination,
              i.masked_statement_account,
              i.source_filename,
              i.content_sha256,
              i.byte_length,
              i.currency,
              i.period_start,
              i.period_end,
              i.total_rows,
              i.valid_rows,
              i.rejected_rows,
              i.gross_total_minor::text AS gross_total_minor,
              i.provider_fee_total_minor::text AS provider_fee_total_minor,
              i.net_total_minor::text AS net_total_minor,
              i.imported_by,
              i.importer_note,
              i.imported_at
         FROM settlement_report_imports i
         LEFT JOIN financial_institutions fi ON fi.id = i.institution_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.imported_at DESC
        LIMIT 200`,
      params,
    );

    return {
      items: rows.map((r) => ({
        id: String(r.id),
        scope: String(r.scope),
        institutionId: (r.institution_id as string | null) ?? null,
        institutionCode: (r.institution_code as string | null) ?? null,
        providerKey: String(r.provider_key),
        reportType: String(r.report_type),
        fileFormat: String(r.file_format),
        verificationStatus: String(r.verification_status),
        statementDestination: String(r.statement_destination),
        maskedStatementAccount: (r.masked_statement_account as string | null) ?? null,
        sourceFilename: String(r.source_filename),
        contentSha256: String(r.content_sha256),
        byteLength: Number(r.byte_length),
        currency: String(r.currency),
        periodStart: r.period_start ? (r.period_start as Date).toISOString() : null,
        periodEnd: r.period_end ? (r.period_end as Date).toISOString() : null,
        totalRows: Number(r.total_rows),
        validRows: Number(r.valid_rows),
        rejectedRows: Number(r.rejected_rows),
        grossTotalMinor: String(r.gross_total_minor),
        providerFeeTotalMinor: String(r.provider_fee_total_minor),
        netTotalMinor: String(r.net_total_minor),
        importedBy: String(r.imported_by),
        importerNote: (r.importer_note as string | null) ?? null,
        importedAt: (r.imported_at as Date).toISOString(),
      })),
    };
  }

  async getImportDetail(principal: AuthorizationPrincipal, importId: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT i.id::text AS id,
              i.scope,
              i.institution_id::text AS institution_id,
              fi.code AS institution_code,
              i.provider_key,
              i.report_type,
              i.file_format,
              i.verification_status,
              i.statement_destination,
              i.masked_statement_account,
              i.source_filename,
              i.content_sha256,
              i.byte_length,
              i.currency,
              i.period_start,
              i.period_end,
              i.total_rows,
              i.valid_rows,
              i.rejected_rows,
              i.gross_total_minor::text AS gross_total_minor,
              i.provider_fee_total_minor::text AS provider_fee_total_minor,
              i.net_total_minor::text AS net_total_minor,
              i.imported_by,
              i.importer_note,
              i.imported_at
         FROM settlement_report_imports i
         LEFT JOIN financial_institutions fi ON fi.id = i.institution_id
        WHERE i.id = $1::uuid`,
      [importId],
    );
    const header = rows[0];
    if (
      !header ||
      !(await this.isRecordVisible(principal, (header.institution_id as string | null) ?? null))
    ) {
      throw new NotFoundException('Settlement report import not found');
    }

    const [normalizedRows, rejectedRows] = await Promise.all([
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                row_number,
                direction,
                provider_transaction_reference,
                platform_reference,
                payment_reference,
                settlement_reference,
                payout_reference,
                nip_session_id,
                refund_or_dispute_reference,
                currency,
                gross_amount_minor::text AS gross_amount_minor,
                provider_fee_minor::text AS provider_fee_minor,
                net_amount_minor::text AS net_amount_minor,
                running_balance_after_minor::text AS running_balance_after_minor,
                provider_status,
                occurred_at,
                settled_at,
                masked_counterparty_account,
                masked_destination_account,
                counterparty_bank_code,
                narration
           FROM settlement_report_rows
          WHERE import_id = $1::uuid
          ORDER BY row_number ASC
          LIMIT 500`,
        [importId],
      ),
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id, row_number, reason_code, message, sanitized_preview
           FROM settlement_report_rejected_rows
          WHERE import_id = $1::uuid
          ORDER BY row_number ASC
          LIMIT 500`,
        [importId],
      ),
    ]);

    return {
      id: String(header.id),
      scope: String(header.scope),
      institutionId: (header.institution_id as string | null) ?? null,
      institutionCode: (header.institution_code as string | null) ?? null,
      providerKey: String(header.provider_key),
      reportType: String(header.report_type),
      fileFormat: String(header.file_format),
      verificationStatus: String(header.verification_status),
      statementDestination: String(header.statement_destination),
      maskedStatementAccount: (header.masked_statement_account as string | null) ?? null,
      sourceFilename: String(header.source_filename),
      contentSha256: String(header.content_sha256),
      byteLength: Number(header.byte_length),
      currency: String(header.currency),
      periodStart: header.period_start ? (header.period_start as Date).toISOString() : null,
      periodEnd: header.period_end ? (header.period_end as Date).toISOString() : null,
      totalRows: Number(header.total_rows),
      validRows: Number(header.valid_rows),
      rejectedRows: Number(header.rejected_rows),
      grossTotalMinor: String(header.gross_total_minor),
      providerFeeTotalMinor: String(header.provider_fee_total_minor),
      netTotalMinor: String(header.net_total_minor),
      importedBy: String(header.imported_by),
      importerNote: (header.importer_note as string | null) ?? null,
      importedAt: (header.imported_at as Date).toISOString(),
      rows: normalizedRows.map((r) => ({
        id: String(r.id),
        rowNumber: Number(r.row_number),
        direction: String(r.direction),
        providerTransactionReference: (r.provider_transaction_reference as string | null) ?? null,
        platformReference: (r.platform_reference as string | null) ?? null,
        paymentReference: (r.payment_reference as string | null) ?? null,
        settlementReference: (r.settlement_reference as string | null) ?? null,
        payoutReference: (r.payout_reference as string | null) ?? null,
        nipSessionId: (r.nip_session_id as string | null) ?? null,
        refundOrDisputeReference: (r.refund_or_dispute_reference as string | null) ?? null,
        currency: String(r.currency),
        grossAmountMinor: String(r.gross_amount_minor),
        providerFeeMinor: String(r.provider_fee_minor),
        netAmountMinor: String(r.net_amount_minor),
        runningBalanceAfterMinor: (r.running_balance_after_minor as string | null) ?? null,
        providerStatus: String(r.provider_status),
        occurredAt: r.occurred_at ? (r.occurred_at as Date).toISOString() : null,
        settledAt: r.settled_at ? (r.settled_at as Date).toISOString() : null,
        maskedCounterpartyAccount: (r.masked_counterparty_account as string | null) ?? null,
        maskedDestinationAccount: (r.masked_destination_account as string | null) ?? null,
        counterpartyBankCode: (r.counterparty_bank_code as string | null) ?? null,
        narration: (r.narration as string | null) ?? null,
      })),
      rejections: rejectedRows.map((r) => ({
        id: String(r.id),
        rowNumber: Number(r.row_number),
        reasonCode: String(r.reason_code),
        message: String(r.message),
        sanitizedPreview: (r.sanitized_preview as Record<string, string | null>) ?? {},
      })),
    };
  }

  // ------------------------------------------------ matching orchestration

  private async evaluatePreviewRow(
    q: SqlQueryable,
    caps: OptionalArena9SchemaCapabilities,
    institutionId: string | null,
    providerKey: string,
    reportType: SettlementReportType,
    row: NormalizedSettlementReportRow,
  ): Promise<{
    predictedStatus: string;
    requiresFinanceReview: boolean;
    internalMerchantSettlementMinor: string | null;
    internalPlatformFeeMinor: string | null;
    internalCustomerCreditMinor: string | null;
    ambiguousCandidatesCount: number;
    explanation: string;
  }> {
    if (reportType === 'COLLECTIONS') {
      const evaluated = await this.evaluateCollectionRow(q, caps, institutionId, providerKey, row);
      return {
        predictedStatus: evaluated.matchStatus,
        requiresFinanceReview: evaluated.matchStatus !== 'MATCHED',
        internalMerchantSettlementMinor: evaluated.candidate?.merchantSettlementMinor ?? null,
        internalPlatformFeeMinor: evaluated.candidate?.platformFeeMinor ?? null,
        internalCustomerCreditMinor: evaluated.candidate?.customerCreditMinor ?? null,
        ambiguousCandidatesCount: evaluated.ambiguousCandidates.length,
        explanation: evaluated.explanation,
      };
    }
    if (reportType === 'PAYOUTS') {
      const evaluated = await this.evaluatePayoutRow(q, institutionId, providerKey, row);
      return {
        predictedStatus: evaluated.matchStatus,
        requiresFinanceReview: evaluated.matchStatus !== 'MATCHED',
        internalMerchantSettlementMinor: evaluated.candidate?.amountMinor ?? null,
        internalPlatformFeeMinor: evaluated.candidate?.platformFeeMinor ?? null,
        internalCustomerCreditMinor: null,
        ambiguousCandidatesCount: evaluated.ambiguousCandidates.length,
        explanation: evaluated.explanation,
      };
    }
    if (reportType === 'SETTLEMENTS') {
      return {
        predictedStatus: 'SETTLEMENT_BATCH_EVALUATION',
        requiresFinanceReview: false,
        internalMerchantSettlementMinor: row.netAmountMinor,
        internalPlatformFeeMinor: null,
        internalCustomerCreditMinor: null,
        ambiguousCandidatesCount: 0,
        explanation:
          'Settlement batch will be reconciled against underlying collections and bank/wallet statement credits.',
      };
    }
    if (reportType === 'REFUNDS_DISPUTES') {
      return {
        predictedStatus: 'RETURN_DISPUTE_CASE_CORRELATION',
        requiresFinanceReview: true,
        internalMerchantSettlementMinor: null,
        internalPlatformFeeMinor: null,
        internalCustomerCreditMinor: null,
        ambiguousCandidatesCount: 0,
        explanation:
          'Return/refund/dispute row will open or update a Finance review case while preserving original settlement figures.',
      };
    }
    return {
      predictedStatus:
        row.direction === 'STATEMENT_CREDIT'
          ? 'STATEMENT_CREDIT_EVALUATION'
          : 'STATEMENT_DEBIT_EVALUATION',
      requiresFinanceReview: false,
      internalMerchantSettlementMinor: null,
      internalPlatformFeeMinor: null,
      internalCustomerCreditMinor: null,
      ambiguousCandidatesCount: 0,
      explanation:
        'Statement line will be matched against settlement batches or return/recall cases.',
    };
  }

  private async executeReconciliationForImport(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    ctx: {
      importId: string;
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      reportType: SettlementReportType;
      statementDestination: StatementDestination;
      periodStart: string | null;
      periodEnd: string | null;
      persistedRows: Array<{ rowId: string; row: NormalizedSettlementReportRow }>;
    },
  ): Promise<void> {
    if (ctx.reportType === 'COLLECTIONS') {
      await this.reconcileCollectionRows(manager, caps, ctx);
      // Re-evaluate any previously imported settlement batches in this scope that were missing collection detail
      await this.reevaluateOpenSettlementBatches(manager, caps, ctx.scope, ctx.institutionId);
      return;
    }

    if (ctx.reportType === 'PAYOUTS') {
      await this.reconcilePayoutRows(manager, ctx);
      return;
    }

    if (ctx.reportType === 'SETTLEMENTS') {
      for (const item of ctx.persistedRows) {
        await this.reconcileSettlementBatchRow(manager, caps, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          statementDestination: ctx.statementDestination,
          settlementRowId: item.rowId,
          row: item.row,
        });
      }
      return;
    }

    if (ctx.reportType === 'WALLET_STATEMENT' || ctx.reportType === 'BANK_STATEMENT') {
      await this.reconcileStatementRows(manager, caps, {
        ...ctx,
        reportType: ctx.reportType,
      });
      return;
    }

    if (ctx.reportType === 'REFUNDS_DISPUTES') {
      for (const item of ctx.persistedRows) {
        await this.correlateReturnDisputeRow(manager, caps, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportRowId: item.rowId,
          row: item.row,
        });
      }
    }
  }

  // ------------------------------------------------ Workflow 2: Transactions

  private isProviderCollectionSuccess(status: string): boolean {
    return ['PAID', 'OVERPAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(
      status.toUpperCase(),
    );
  }

  private isInternalInboundSuccess(status: string): boolean {
    return ['CREDITED', 'VERIFIED'].includes(status.toUpperCase());
  }

  private isProviderPayoutSuccess(status: string): boolean {
    return ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID'].includes(status.toUpperCase());
  }

  private isProviderPayoutReversed(status: string): boolean {
    return ['REVERSED', 'RETURNED', 'REFUNDED'].includes(status.toUpperCase());
  }

  private isProviderPayoutFailed(status: string): boolean {
    return ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(status.toUpperCase());
  }

  private async evaluateCollectionRow(
    q: SqlQueryable,
    caps: OptionalArena9SchemaCapabilities,
    institutionId: string | null,
    providerKey: string,
    row: NormalizedSettlementReportRow,
  ): Promise<{
    matchStatus: TransactionMatchStatus;
    matchedKeys: string[];
    explanation: string;
    varianceMinor: string;
    feeVarianceMinor: string;
    candidate: InternalInboundCandidate | null;
    ambiguousCandidates: AmbiguousMatchCandidate[];
  }> {
    const found = await findInboundCandidates(q, caps, {
      institutionId,
      providerKey,
      providerTransactionReference: row.providerTransactionReference,
      paymentReference: row.paymentReference,
      platformReference: row.platformReference,
    });

    if (found.candidates.length === 0) {
      return {
        matchStatus: 'MISSING_INTERNAL',
        matchedKeys: [],
        explanation:
          'Provider collection row has no matching internal banking_inbound_payments or bank_to_wallet_exceptions record.',
        varianceMinor: row.grossAmountMinor,
        feeVarianceMinor: '0',
        candidate: null,
        ambiguousCandidates: [],
      };
    }

    if (found.candidates.length > 1) {
      return {
        matchStatus: 'AMBIGUOUS_CANDIDATES',
        matchedKeys: [],
        explanation: `${found.candidates.length} distinct internal records matched candidate references; human selection required.`,
        varianceMinor: '0',
        feeVarianceMinor: '0',
        candidate: null,
        ambiguousCandidates: found.candidates.map((c) =>
          toAmbiguousInboundCandidate(c, found.matchedKeysByCandidateId.get(c.id) ?? []),
        ),
      };
    }

    const cand = found.candidates[0]!;
    const matchedKeys = found.matchedKeysByCandidateId.get(cand.id) ?? [];
    const grossDiff = BigInt(row.grossAmountMinor) - BigInt(cand.grossAmountMinor);
    const feeDiff = BigInt(row.providerFeeMinor) - BigInt(cand.providerFeeMinor);
    const netDiff = BigInt(row.netAmountMinor) - BigInt(cand.merchantSettlementMinor);

    if (row.currency !== cand.currency || grossDiff !== 0n) {
      return {
        matchStatus: 'AMOUNT_MISMATCH',
        matchedKeys,
        explanation:
          row.currency !== cand.currency
            ? `Currency mismatch: provider reported ${row.currency} vs internal ${cand.currency}.`
            : `Collection gross amount mismatch: provider reported ${row.grossAmountMinor} minor vs internal ${cand.grossAmountMinor} minor.`,
        varianceMinor: grossDiff.toString(),
        feeVarianceMinor: feeDiff.toString(),
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    if (feeDiff !== 0n || netDiff !== 0n) {
      return {
        matchStatus: 'FEE_MISMATCH',
        matchedKeys,
        explanation: `Provider deduction / merchant settlement mismatch: provider fee ${row.providerFeeMinor} (net ${row.netAmountMinor}) vs internal provider fee ${cand.providerFeeMinor} (merchant settlement ${cand.merchantSettlementMinor}; MonieNaija charge ${cand.platformFeeMinor} kept separate).`,
        varianceMinor: netDiff.toString(),
        feeVarianceMinor: feeDiff.toString(),
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    const providerOk = this.isProviderCollectionSuccess(row.providerStatus);
    const internalOk = this.isInternalInboundSuccess(cand.internalStatus);
    if (providerOk !== internalOk) {
      return {
        matchStatus: 'STATUS_MISMATCH',
        matchedKeys,
        explanation: `Status conflict: provider status is ${row.providerStatus} while internal record is ${cand.internalStatus}.`,
        varianceMinor: '0',
        feeVarianceMinor: '0',
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    if (row.occurredAt && cand.occurredAt) {
      const deltaMs = Math.abs(Date.parse(row.occurredAt) - Date.parse(cand.occurredAt));
      if (Number.isFinite(deltaMs) && deltaMs > DATE_WINDOW_MS) {
        return {
          matchStatus: 'DATE_WINDOW_MISMATCH',
          matchedKeys,
          explanation: `Amounts and status agree, but timestamps differ by ${Math.round(deltaMs / 3_600_000)}h (>24h cutoff window): provider ${row.occurredAt} vs internal ${cand.occurredAt}.`,
          varianceMinor: '0',
          feeVarianceMinor: '0',
          candidate: cand,
          ambiguousCandidates: [],
        };
      }
    }

    return {
      matchStatus: 'MATCHED',
      matchedKeys,
      explanation:
        'Exact match on reference, currency, gross collection amount, Monnify deduction, merchant settlement amount, status, and value-date window.',
      varianceMinor: '0',
      feeVarianceMinor: '0',
      candidate: cand,
      ambiguousCandidates: [],
    };
  }

  private async evaluatePayoutRow(
    q: SqlQueryable,
    institutionId: string | null,
    providerKey: string,
    row: NormalizedSettlementReportRow,
  ): Promise<{
    matchStatus: TransactionMatchStatus;
    matchedKeys: string[];
    explanation: string;
    varianceMinor: string;
    feeVarianceMinor: string;
    candidate: InternalOutboundCandidate | null;
    ambiguousCandidates: AmbiguousMatchCandidate[];
  }> {
    const found = await findOutboundCandidates(q, {
      institutionId,
      providerKey,
      operationReference: row.platformReference,
      providerTransactionReference: row.providerTransactionReference,
      nipSessionId: row.nipSessionId,
    });

    if (found.candidates.length === 0) {
      return {
        matchStatus: 'MISSING_INTERNAL',
        matchedKeys: [],
        explanation:
          'Provider payout row has no matching internal banking_outbound_operations or NIBSS NIP sessionId record.',
        varianceMinor: row.grossAmountMinor,
        feeVarianceMinor: row.providerFeeMinor,
        candidate: null,
        ambiguousCandidates: [],
      };
    }

    if (found.candidates.length > 1) {
      return {
        matchStatus: 'AMBIGUOUS_CANDIDATES',
        matchedKeys: [],
        explanation: `${found.candidates.length} distinct internal outbound records matched candidate references; human selection required.`,
        varianceMinor: '0',
        feeVarianceMinor: '0',
        candidate: null,
        ambiguousCandidates: found.candidates.map((c) =>
          toAmbiguousOutboundCandidate(c, found.matchedKeysByCandidateId.get(c.id) ?? []),
        ),
      };
    }

    const cand = found.candidates[0]!;
    const matchedKeys = found.matchedKeysByCandidateId.get(cand.id) ?? [];
    const principalDiff = BigInt(row.grossAmountMinor) - BigInt(cand.amountMinor);
    const feeDiff = BigInt(row.providerFeeMinor) - BigInt(cand.providerFeeMinor);

    if (row.currency !== cand.currency || principalDiff !== 0n) {
      return {
        matchStatus: 'AMOUNT_MISMATCH',
        matchedKeys,
        explanation: `Payout principal mismatch: provider reported ${row.grossAmountMinor} ${row.currency} vs internal ${cand.amountMinor} ${cand.currency}.`,
        varianceMinor: principalDiff.toString(),
        feeVarianceMinor: feeDiff.toString(),
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    // Fee mismatch check when internal fee binding recorded a specific provider fee OR provider charged an unrecorded fee > 0 while bound fee differs
    if (BigInt(cand.providerFeeMinor) > 0n && feeDiff !== 0n) {
      return {
        matchStatus: 'FEE_MISMATCH',
        matchedKeys,
        explanation: `Payout provider fee mismatch: provider charged ${row.providerFeeMinor} minor vs bound internal provider fee ${cand.providerFeeMinor} minor.`,
        varianceMinor: '0',
        feeVarianceMinor: feeDiff.toString(),
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    const pSuccess = this.isProviderPayoutSuccess(row.providerStatus);
    const pReversed = this.isProviderPayoutReversed(row.providerStatus);
    const pFailed = this.isProviderPayoutFailed(row.providerStatus);
    const statusCompatible =
      (pSuccess && cand.internalStatus === 'SUCCESSFUL') ||
      (pReversed && cand.internalStatus === 'REVERSED') ||
      (pFailed && ['FAILED', 'CANCELLED'].includes(cand.internalStatus));

    if (!statusCompatible) {
      return {
        matchStatus: 'STATUS_MISMATCH',
        matchedKeys,
        explanation: `Outbound status conflict: provider reported ${row.providerStatus} while internal outbound state is ${cand.internalStatus}.`,
        varianceMinor: '0',
        feeVarianceMinor: feeDiff.toString(),
        candidate: cand,
        ambiguousCandidates: [],
      };
    }

    if (row.occurredAt && cand.occurredAt) {
      const deltaMs = Math.abs(Date.parse(row.occurredAt) - Date.parse(cand.occurredAt));
      if (Number.isFinite(deltaMs) && deltaMs > DATE_WINDOW_MS) {
        return {
          matchStatus: 'DATE_WINDOW_MISMATCH',
          matchedKeys,
          explanation: `Payout amounts and status agree, but timestamps differ by ${Math.round(deltaMs / 3_600_000)}h (>24h cutoff window).`,
          varianceMinor: '0',
          feeVarianceMinor: feeDiff.toString(),
          candidate: cand,
          ambiguousCandidates: [],
        };
      }
    }

    return {
      matchStatus: 'MATCHED',
      matchedKeys,
      explanation:
        'Exact match on outbound reference/NIP sessionId, currency, principal, status, and value-date window.',
      varianceMinor: '0',
      feeVarianceMinor: feeDiff.toString(),
      candidate: cand,
      ambiguousCandidates: [],
    };
  }

  private async reconcileCollectionRows(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    ctx: {
      importId: string;
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      periodStart: string | null;
      periodEnd: string | null;
      persistedRows: Array<{ rowId: string; row: NormalizedSettlementReportRow }>;
    },
  ): Promise<void> {
    const matchedInboundIds = new Set<string>();
    const seenProviderRefs = new Map<string, number>();
    for (const item of ctx.persistedRows) {
      const key = item.row.providerTransactionReference;
      if (key) seenProviderRefs.set(key, (seenProviderRefs.get(key) ?? 0) + 1);
    }

    for (const { rowId, row } of ctx.persistedRows) {
      if (
        row.providerTransactionReference &&
        (seenProviderRefs.get(row.providerTransactionReference) ?? 0) > 1
      ) {
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: 'COLLECTIONS',
          importId: ctx.importId,
          reportRowId: rowId,
          direction: 'INBOUND',
          matchStatus: 'DUPLICATE_PROVIDER_ROW',
          matchedKeys: ['providerTransactionReference'],
          explanation: `Provider report contains multiple rows with transactionReference "${row.providerTransactionReference}".`,
          currency: row.currency,
          providerGrossMinor: row.grossAmountMinor,
          providerFeeMinor: row.providerFeeMinor,
          providerNetMinor: row.netAmountMinor,
          providerStatus: row.providerStatus,
          providerOccurredAt: row.occurredAt,
          internalSourceType: null,
          internalSourceId: null,
          internalBusinessReference: null,
          internalProviderReference: null,
          internalGrossMinor: null,
          internalProviderFeeMinor: null,
          internalNetMinor: null,
          internalPlatformFeeMinor: null,
          internalCustomerCreditMinor: null,
          internalStatus: null,
          internalOccurredAt: null,
          internalTransactionHistoryPath: null,
          internalJournalIds: [],
          varianceMinor: row.grossAmountMinor,
          feeVarianceMinor: '0',
          ambiguousCandidates: [],
        });
        continue;
      }

      const ev = await this.evaluateCollectionRow(
        manager,
        caps,
        ctx.institutionId,
        ctx.providerKey,
        row,
      );
      if (ev.candidate) {
        matchedInboundIds.add(ev.candidate.id);
        // Clear any earlier open MISSING_IN_PROVIDER observation if this provider row just arrived!
        await manager.query(
          `UPDATE settlement_transaction_matches
              SET match_status = 'MATCHED',
                  explanation = 'Resolved automatically when late provider collection report arrived.',
                  updated_at = clock_timestamp()
            WHERE internal_source_type = $1
              AND internal_source_id = $2::uuid
              AND match_status = 'MISSING_IN_PROVIDER'
              AND review_state = 'NONE'`,
          [ev.candidate.sourceType, ev.candidate.id],
        );
      }
      for (const amb of ev.ambiguousCandidates) {
        matchedInboundIds.add(amb.sourceId);
      }

      await this.insertTransactionMatch(manager, {
        scope: ctx.scope,
        institutionId: ctx.institutionId,
        providerKey: ctx.providerKey,
        reportType: 'COLLECTIONS',
        importId: ctx.importId,
        reportRowId: rowId,
        direction: 'INBOUND',
        matchStatus: ev.matchStatus,
        matchedKeys: ev.matchedKeys,
        explanation: ev.explanation,
        currency: row.currency,
        providerGrossMinor: row.grossAmountMinor,
        providerFeeMinor: row.providerFeeMinor,
        providerNetMinor: row.netAmountMinor,
        providerStatus: row.providerStatus,
        providerOccurredAt: row.occurredAt,
        internalSourceType: ev.candidate?.sourceType ?? null,
        internalSourceId: ev.candidate?.id ?? null,
        internalBusinessReference: ev.candidate?.businessReference ?? null,
        internalProviderReference: ev.candidate?.providerTransactionReference ?? null,
        internalGrossMinor: ev.candidate?.grossAmountMinor ?? null,
        internalProviderFeeMinor: ev.candidate?.providerFeeMinor ?? null,
        internalNetMinor: ev.candidate?.merchantSettlementMinor ?? null,
        internalPlatformFeeMinor: ev.candidate?.platformFeeMinor ?? null,
        internalCustomerCreditMinor: ev.candidate?.customerCreditMinor ?? null,
        internalStatus: ev.candidate?.internalStatus ?? null,
        internalOccurredAt: ev.candidate?.occurredAt ?? null,
        internalTransactionHistoryPath: ev.candidate?.transactionHistoryPath ?? null,
        internalJournalIds: ev.candidate?.journalIds ?? [],
        varianceMinor: ev.varianceMinor,
        feeVarianceMinor: ev.feeVarianceMinor,
        ambiguousCandidates: ev.ambiguousCandidates,
      });
    }

    // Detect MISSING_IN_PROVIDER for verified/credited internal inbound payments within [periodStart, periodEnd]
    if (ctx.periodStart && ctx.periodEnd) {
      const businessSelect = caps.hasInboundBusinessColumns
        ? `b.business_reference,
           COALESCE(b.settlement_amount_minor, b.credited_amount_minor)::text AS settlement_amount_minor,
           COALESCE(b.monienaija_fee_minor, 0)::text AS monienaija_fee_minor,
           COALESCE(b.customer_credit_minor, b.credited_amount_minor)::text AS customer_credit_minor,
           b.credit_journal_id::text AS credit_journal_id,
           b.resolution_state`
        : `NULL::text AS business_reference,
           b.credited_amount_minor::text AS settlement_amount_minor,
           '0'::text AS monienaija_fee_minor,
           b.credited_amount_minor::text AS customer_credit_minor,
           NULL::text AS credit_journal_id,
           NULL::text AS resolution_state`;

      const internalWindowRows = await manager.query<
        Array<{
          id: string;
          provider_transaction_reference: string;
          currency: string;
          gross_amount_minor: string;
          provider_fee_minor: string;
          verification_state: string;
          paid_at: Date | null;
          recorded_at: Date;
          ledger_transaction_id: string | null;
          float_journal_id: string | null;
          business_reference: string | null;
          settlement_amount_minor: string;
          monienaija_fee_minor: string;
          customer_credit_minor: string;
          credit_journal_id: string | null;
          resolution_state: string | null;
        }>
      >(
        `SELECT b.id::text AS id,
                b.provider_transaction_reference,
                b.currency,
                b.gross_amount_minor::text AS gross_amount_minor,
                b.provider_fee_minor::text AS provider_fee_minor,
                b.verification_state,
                b.paid_at,
                b.recorded_at,
                b.ledger_transaction_id::text AS ledger_transaction_id,
                r.journal_id::text AS float_journal_id,
                ${businessSelect}
           FROM banking_inbound_payments b
           LEFT JOIN banking_inbound_float_links fl ON fl.payment_id = b.id
           LEFT JOIN agent_float_funding_receipts r ON r.id = fl.float_receipt_id
          WHERE b.provider_key = $1
            AND ($2::uuid IS NULL OR b.institution_id = $2::uuid)
            AND COALESCE(b.paid_at, b.recorded_at) >= $3::timestamptz
            AND COALESCE(b.paid_at, b.recorded_at) <= $4::timestamptz
            AND b.verification_state = 'VERIFIED'
            AND NOT EXISTS (
              SELECT 1
                FROM settlement_transaction_matches m
               WHERE m.internal_source_type = 'BANKING_INBOUND_PAYMENT'
                 AND m.internal_source_id = b.id
            )`,
        [ctx.providerKey, ctx.institutionId, ctx.periodStart, ctx.periodEnd],
      );

      for (const miss of internalWindowRows) {
        if (matchedInboundIds.has(miss.id)) continue;
        const jIds = Array.from(
          new Set(
            [miss.credit_journal_id, miss.float_journal_id, miss.ledger_transaction_id].filter(
              (x): x is string => Boolean(x),
            ),
          ),
        );
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: 'COLLECTIONS',
          importId: ctx.importId,
          reportRowId: null,
          direction: 'INBOUND',
          matchStatus: 'MISSING_IN_PROVIDER',
          matchedKeys: [],
          explanation: `Internal verified inbound payment (${miss.provider_transaction_reference}) in report window [${ctx.periodStart} .. ${ctx.periodEnd}] was absent from the provider collection report.`,
          currency: miss.currency,
          providerGrossMinor: null,
          providerFeeMinor: null,
          providerNetMinor: null,
          providerStatus: null,
          providerOccurredAt: null,
          internalSourceType: 'BANKING_INBOUND_PAYMENT',
          internalSourceId: miss.id,
          internalBusinessReference: miss.business_reference,
          internalProviderReference: miss.provider_transaction_reference,
          internalGrossMinor: miss.gross_amount_minor,
          internalProviderFeeMinor: miss.provider_fee_minor,
          internalNetMinor: miss.settlement_amount_minor,
          internalPlatformFeeMinor: miss.monienaija_fee_minor,
          internalCustomerCreditMinor: miss.customer_credit_minor,
          internalStatus: miss.resolution_state ?? miss.verification_state,
          internalOccurredAt: (miss.paid_at ?? miss.recorded_at).toISOString(),
          internalTransactionHistoryPath: `#transaction-history/BANK_TO_WALLET/${miss.id}`,
          internalJournalIds: jIds,
          varianceMinor: `-${miss.gross_amount_minor}`,
          feeVarianceMinor: '0',
          ambiguousCandidates: [],
        });
      }
    }
  }

  private async reconcilePayoutRows(
    manager: EntityManager,
    ctx: {
      importId: string;
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      periodStart: string | null;
      periodEnd: string | null;
      persistedRows: Array<{ rowId: string; row: NormalizedSettlementReportRow }>;
    },
  ): Promise<void> {
    const matchedOutboundIds = new Set<string>();
    const seenRefs = new Map<string, number>();
    for (const item of ctx.persistedRows) {
      const k = item.row.providerTransactionReference ?? item.row.platformReference;
      if (k) seenRefs.set(k, (seenRefs.get(k) ?? 0) + 1);
    }

    for (const { rowId, row } of ctx.persistedRows) {
      const dupKey = row.providerTransactionReference ?? row.platformReference;
      if (dupKey && (seenRefs.get(dupKey) ?? 0) > 1) {
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: 'PAYOUTS',
          importId: ctx.importId,
          reportRowId: rowId,
          direction: 'OUTBOUND',
          matchStatus: 'DUPLICATE_PROVIDER_ROW',
          matchedKeys: ['reference'],
          explanation: `Provider payout report contains duplicate rows for "${dupKey}".`,
          currency: row.currency,
          providerGrossMinor: row.grossAmountMinor,
          providerFeeMinor: row.providerFeeMinor,
          providerNetMinor: row.netAmountMinor,
          providerStatus: row.providerStatus,
          providerOccurredAt: row.occurredAt,
          internalSourceType: null,
          internalSourceId: null,
          internalBusinessReference: null,
          internalProviderReference: null,
          internalGrossMinor: null,
          internalProviderFeeMinor: null,
          internalNetMinor: null,
          internalPlatformFeeMinor: null,
          internalCustomerCreditMinor: null,
          internalStatus: null,
          internalOccurredAt: null,
          internalTransactionHistoryPath: null,
          internalJournalIds: [],
          varianceMinor: row.grossAmountMinor,
          feeVarianceMinor: row.providerFeeMinor,
          ambiguousCandidates: [],
        });
        continue;
      }

      const ev = await this.evaluatePayoutRow(manager, ctx.institutionId, ctx.providerKey, row);
      if (ev.candidate) {
        matchedOutboundIds.add(ev.candidate.id);
      }
      for (const amb of ev.ambiguousCandidates) {
        matchedOutboundIds.add(amb.sourceId);
      }

      await this.insertTransactionMatch(manager, {
        scope: ctx.scope,
        institutionId: ctx.institutionId,
        providerKey: ctx.providerKey,
        reportType: 'PAYOUTS',
        importId: ctx.importId,
        reportRowId: rowId,
        direction: 'OUTBOUND',
        matchStatus: ev.matchStatus,
        matchedKeys: ev.matchedKeys,
        explanation: ev.explanation,
        currency: row.currency,
        providerGrossMinor: row.grossAmountMinor,
        providerFeeMinor: row.providerFeeMinor,
        providerNetMinor: row.netAmountMinor,
        providerStatus: row.providerStatus,
        providerOccurredAt: row.occurredAt,
        internalSourceType: ev.candidate?.sourceType ?? null,
        internalSourceId: ev.candidate?.id ?? null,
        internalBusinessReference: ev.candidate?.operationReference ?? null,
        internalProviderReference: ev.candidate?.providerTransactionReference ?? null,
        internalGrossMinor: ev.candidate?.amountMinor ?? null,
        internalProviderFeeMinor: ev.candidate?.providerFeeMinor ?? null,
        internalNetMinor: ev.candidate
          ? (BigInt(ev.candidate.amountMinor) + BigInt(ev.candidate.providerFeeMinor)).toString()
          : null,
        internalPlatformFeeMinor: ev.candidate?.platformFeeMinor ?? null,
        internalCustomerCreditMinor: null,
        internalStatus: ev.candidate?.internalStatus ?? null,
        internalOccurredAt: ev.candidate?.occurredAt ?? null,
        internalTransactionHistoryPath: ev.candidate?.transactionHistoryPath ?? null,
        internalJournalIds: ev.candidate?.journalIds ?? [],
        varianceMinor: ev.varianceMinor,
        feeVarianceMinor: ev.feeVarianceMinor,
        ambiguousCandidates: ev.ambiguousCandidates,
      });

      // If provider payout is REVERSED, also correlate in Workflow 4 (Return/Reversal/Dispute)
      if (this.isProviderPayoutReversed(row.providerStatus)) {
        await this.correlateReversedPayoutCase(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportRowId: rowId,
          row,
          candidate: ev.candidate,
        });
      }
    }

    // Detect MISSING_IN_PROVIDER for outbound operations in [periodStart, periodEnd]
    if (ctx.periodStart && ctx.periodEnd) {
      const outboundMissing = await manager.query<
        Array<{
          id: string;
          operation_reference: string;
          provider_transaction_reference: string | null;
          currency: string;
          amount_minor: string;
          state: string;
          occurred_at: Date;
          commitment_id: string | null;
          reservation_journal_id: string | null;
          resolution_journal_id: string | null;
        }>
      >(
        `SELECT bo.id::text AS id,
                bo.operation_reference,
                bo.provider_transaction_reference,
                bo.currency,
                bo.amount_minor::text AS amount_minor,
                bo.state,
                COALESCE(bo.resolved_at, bo.submitted_at, bo.created_at) AS occurred_at,
                fc.id::text AS commitment_id,
                fc.reservation_journal_id::text AS reservation_journal_id,
                fc.resolution_journal_id::text AS resolution_journal_id
           FROM banking_outbound_operations bo
           LEFT JOIN financial_commitments fc ON fc.external_operation_id = bo.external_operation_id
          WHERE bo.provider_key = $1
            AND ($2::uuid IS NULL OR bo.institution_id = $2::uuid)
            AND COALESCE(bo.submitted_at, bo.created_at) >= $3::timestamptz
            AND COALESCE(bo.submitted_at, bo.created_at) <= $4::timestamptz
            AND bo.state IN ('SUCCESSFUL', 'PENDING_PROVIDER', 'PENDING_VERIFICATION', 'UNKNOWN', 'MANUAL_REVIEW')
            AND NOT EXISTS (
              SELECT 1
                FROM settlement_transaction_matches m
               WHERE m.internal_source_type = 'BANKING_OUTBOUND_OPERATION'
                 AND m.internal_source_id = bo.id
            )`,
        [ctx.providerKey, ctx.institutionId, ctx.periodStart, ctx.periodEnd],
      );

      for (const miss of outboundMissing) {
        if (matchedOutboundIds.has(miss.id)) continue;
        const jIds = Array.from(
          new Set(
            [miss.reservation_journal_id, miss.resolution_journal_id].filter((x): x is string =>
              Boolean(x),
            ),
          ),
        );
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: 'PAYOUTS',
          importId: ctx.importId,
          reportRowId: null,
          direction: 'OUTBOUND',
          matchStatus: 'MISSING_IN_PROVIDER',
          matchedKeys: [],
          explanation: `Internal outbound operation ${miss.operation_reference} (${miss.state}) in window [${ctx.periodStart} .. ${ctx.periodEnd}] was absent from the provider payout report.`,
          currency: miss.currency,
          providerGrossMinor: null,
          providerFeeMinor: null,
          providerNetMinor: null,
          providerStatus: null,
          providerOccurredAt: null,
          internalSourceType: 'BANKING_OUTBOUND_OPERATION',
          internalSourceId: miss.id,
          internalBusinessReference: miss.operation_reference,
          internalProviderReference: miss.provider_transaction_reference,
          internalGrossMinor: miss.amount_minor,
          internalProviderFeeMinor: '0',
          internalNetMinor: miss.amount_minor,
          internalPlatformFeeMinor: null,
          internalCustomerCreditMinor: null,
          internalStatus: miss.state,
          internalOccurredAt: miss.occurred_at.toISOString(),
          internalTransactionHistoryPath: miss.commitment_id
            ? `#transaction-history/WALLET_TO_BANK/${miss.commitment_id}`
            : null,
          internalJournalIds: jIds,
          varianceMinor: `-${miss.amount_minor}`,
          feeVarianceMinor: '0',
          ambiguousCandidates: [],
        });
      }
    }
  }

  private async insertTransactionMatch(
    manager: EntityManager,
    input: {
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      reportType: SettlementReportType;
      importId: string;
      reportRowId: string | null;
      direction: string;
      matchStatus: TransactionMatchStatus;
      matchedKeys: string[];
      explanation: string;
      currency: string;
      providerGrossMinor: string | null;
      providerFeeMinor: string | null;
      providerNetMinor: string | null;
      providerStatus: string | null;
      providerOccurredAt: string | null;
      internalSourceType: string | null;
      internalSourceId: string | null;
      internalBusinessReference: string | null;
      internalProviderReference: string | null;
      internalGrossMinor: string | null;
      internalProviderFeeMinor: string | null;
      internalNetMinor: string | null;
      internalPlatformFeeMinor: string | null;
      internalCustomerCreditMinor: string | null;
      internalStatus: string | null;
      internalOccurredAt: string | null;
      internalTransactionHistoryPath: string | null;
      internalJournalIds: string[];
      varianceMinor: string;
      feeVarianceMinor: string;
      ambiguousCandidates: AmbiguousMatchCandidate[];
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO settlement_transaction_matches (
         scope, institution_id, provider_key, report_type, import_id, report_row_id,
         direction, match_status, matched_keys, explanation, currency,
         provider_gross_minor, provider_fee_minor, provider_net_minor, provider_status, provider_occurred_at,
         internal_source_type, internal_source_id, internal_business_reference, internal_provider_reference,
         internal_gross_minor, internal_provider_fee_minor, internal_net_minor,
         internal_platform_fee_minor, internal_customer_credit_minor,
         internal_status, internal_occurred_at, internal_transaction_history_path, internal_journal_ids,
         variance_minor, fee_variance_minor, ambiguous_candidates
       )
       VALUES (
         $1, $2::uuid, $3, $4, $5::uuid, $6::uuid,
         $7, $8, $9::jsonb, $10, $11,
         $12::numeric, $13::numeric, $14::numeric, $15, $16::timestamptz,
         $17, $18::uuid, $19, $20,
         $21::numeric, $22::numeric, $23::numeric,
         $24::numeric, $25::numeric,
         $26, $27::timestamptz, $28, $29::jsonb,
         $30::numeric, $31::numeric, $32::jsonb
       )`,
      [
        input.scope,
        input.institutionId,
        input.providerKey,
        input.reportType,
        input.importId,
        input.reportRowId,
        input.direction,
        input.matchStatus,
        JSON.stringify(input.matchedKeys),
        input.explanation.slice(0, 600),
        input.currency,
        input.providerGrossMinor,
        input.providerFeeMinor,
        input.providerNetMinor,
        input.providerStatus,
        input.providerOccurredAt,
        input.internalSourceType,
        input.internalSourceId,
        input.internalBusinessReference,
        input.internalProviderReference,
        input.internalGrossMinor,
        input.internalProviderFeeMinor,
        input.internalNetMinor,
        input.internalPlatformFeeMinor,
        input.internalCustomerCreditMinor,
        input.internalStatus,
        input.internalOccurredAt,
        input.internalTransactionHistoryPath,
        JSON.stringify(input.internalJournalIds),
        input.varianceMinor,
        input.feeVarianceMinor,
        JSON.stringify(input.ambiguousCandidates),
      ],
    );
  }

  // ------------------------------------------------ Workflow 3: Settlements & Statements

  private async reconcileSettlementBatchRow(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    input: {
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      statementDestination: StatementDestination;
      settlementRowId: string;
      row: NormalizedSettlementReportRow;
    },
  ): Promise<void> {
    const settlementRef = input.row.settlementReference!;
    const reportedNet = BigInt(input.row.netAmountMinor);

    // Gather underlying collection references from embedded transactions[] or previously imported COLLECTIONS rows
    const collectionTxRefs = new Set<string>(
      input.row.underlyingItems.map((u) => u.providerTransactionReference),
    );
    if (input.row.providerTransactionReference) {
      collectionTxRefs.add(input.row.providerTransactionReference);
    }

    const importedCollectionRows = await manager.query<
      Array<{
        provider_transaction_reference: string | null;
        gross_amount_minor: string;
        provider_fee_minor: string;
        net_amount_minor: string;
      }>
    >(
      `SELECT r.provider_transaction_reference,
              r.gross_amount_minor::text AS gross_amount_minor,
              r.provider_fee_minor::text AS provider_fee_minor,
              r.net_amount_minor::text AS net_amount_minor
         FROM settlement_report_rows r
         JOIN settlement_report_imports i ON i.id = r.import_id
        WHERE COALESCE(i.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND i.provider_key = $3
          AND i.report_type = 'COLLECTIONS'
          AND r.settlement_reference = $4`,
      [ZERO_UUID, input.institutionId, input.providerKey, settlementRef],
    );

    for (const c of importedCollectionRows) {
      if (c.provider_transaction_reference) {
        collectionTxRefs.add(c.provider_transaction_reference);
      }
    }

    // Also inspect Arena 9 bank_to_wallet_settlements if present
    if (caps.hasBankToWalletSettlements) {
      const b2wRows = await manager.query<Array<{ provider_transaction_reference: string }>>(
        `SELECT provider_transaction_reference
           FROM bank_to_wallet_settlements
          WHERE provider_key = $1
            AND ($2::uuid IS NULL OR institution_id = $2::uuid)
            AND settlement_reference = $3`,
        [input.providerKey, input.institutionId, settlementRef],
      );
      for (const b of b2wRows) {
        collectionTxRefs.add(b.provider_transaction_reference);
      }
    }

    let grossCollections = 0n;
    let providerFeeTotal = 0n;
    let expectedNetSettlement = 0n;
    let platformFeeTotal = 0n;
    let customerWalletCreditTotal = 0n;
    let matchedCount = 0;
    let missingCount = 0;

    if (collectionTxRefs.size > 0) {
      for (const txRef of collectionTxRefs) {
        const found = await findInboundCandidates(manager, caps, {
          institutionId: input.institutionId,
          providerKey: input.providerKey,
          providerTransactionReference: txRef,
          paymentReference: null,
          platformReference: null,
        });
        if (found.candidates.length === 1) {
          const c = found.candidates[0]!;
          matchedCount += 1;
          grossCollections += BigInt(c.grossAmountMinor);
          providerFeeTotal += BigInt(c.providerFeeMinor);
          expectedNetSettlement += BigInt(c.merchantSettlementMinor);
          platformFeeTotal += BigInt(c.platformFeeMinor);
          customerWalletCreditTotal += BigInt(c.customerCreditMinor);
        } else {
          // Fall back to embedded item figures if internal record is missing, while counting missingCount
          missingCount += 1;
          const embedded = input.row.underlyingItems.find(
            (u) => u.providerTransactionReference === txRef,
          );
          if (embedded) {
            grossCollections += BigInt(embedded.grossAmountMinor);
            providerFeeTotal += BigInt(embedded.providerFeeMinor);
            expectedNetSettlement += BigInt(embedded.netSettlementMinor);
          }
        }
      }
    } else {
      // No underlying item list yet: use batch header figures for gross/fee and flag MISSING_COLLECTION_DETAIL
      grossCollections = BigInt(input.row.grossAmountMinor);
      providerFeeTotal = BigInt(input.row.providerFeeMinor);
      expectedNetSettlement = grossCollections - providerFeeTotal;
    }

    const expectedTxCount =
      typeof input.row.normalizedAttributes.transactionsCount === 'number'
        ? input.row.normalizedAttributes.transactionsCount
        : collectionTxRefs.size;

    // Attempt statement match against imported WALLET_STATEMENT / BANK_STATEMENT credit rows
    const statementCandidates = await manager.query<
      Array<{
        id: string;
        report_type: string;
        masked_statement_account: string | null;
        masked_destination_account: string | null;
        net_amount_minor: string;
        settlement_reference: string | null;
        payout_reference: string | null;
        occurred_at: Date | null;
      }>
    >(
      `SELECT r.id::text AS id,
              i.report_type,
              i.masked_statement_account,
              r.masked_destination_account,
              r.net_amount_minor::text AS net_amount_minor,
              r.settlement_reference,
              r.payout_reference,
              r.occurred_at
         FROM settlement_report_rows r
         JOIN settlement_report_imports i ON i.id = r.import_id
        WHERE COALESCE(i.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND i.report_type IN ('WALLET_STATEMENT', 'BANK_STATEMENT')
          AND r.direction = 'STATEMENT_CREDIT'
          AND r.currency = $3
          AND (
               r.settlement_reference = $4
            OR ($5::text IS NOT NULL AND (r.payout_reference = $5 OR r.provider_transaction_reference = $5))
            OR (
                 r.settlement_reference IS NULL
             AND r.net_amount_minor = $6::numeric
             AND ($7::timestamptz IS NULL OR r.occurred_at IS NULL
                  OR ABS(EXTRACT(EPOCH FROM (r.occurred_at - $7::timestamptz))) <= 172800)
               )
          )
        ORDER BY (r.settlement_reference = $4) DESC, r.occurred_at ASC`,
      [
        ZERO_UUID,
        input.institutionId,
        input.row.currency,
        settlementRef,
        input.row.payoutReference,
        reportedNet.toString(),
        input.row.settledAt,
      ],
    );

    // Prefer exact reference match; if multiple non-reference candidates match only by amount+window, treat as AMBIGUOUS
    const exactRefMatches = statementCandidates.filter(
      (s) =>
        s.settlement_reference === settlementRef ||
        (input.row.payoutReference && s.payout_reference === input.row.payoutReference),
    );
    const chosenList = exactRefMatches.length > 0 ? exactRefMatches : statementCandidates;

    let statementRowId: string | null = null;
    let statementCreditMinor: string | null = null;
    let statementDest: StatementDestination = input.statementDestination;
    let maskedAccount = input.row.maskedDestinationAccount;
    let ambiguousStatement = false;

    if (chosenList.length === 1) {
      const s = chosenList[0]!;
      statementRowId = s.id;
      statementCreditMinor = s.net_amount_minor;
      statementDest = s.report_type === 'WALLET_STATEMENT' ? 'MONNIFY_WALLET' : 'BANK_ACCOUNT';
      maskedAccount = maskedAccount ?? s.masked_destination_account ?? s.masked_statement_account;
    } else if (chosenList.length > 1) {
      ambiguousStatement = true;
    }

    const statusUpper = input.row.providerStatus.toUpperCase();
    const payoutHealthy = ['SUCCESS', 'SUCCESSFUL', 'SETTLED', 'COMPLETED', 'PAID'].includes(
      statusUpper,
    );

    let batchStatus: SettlementBatchStatus;
    let varianceMinor = (reportedNet - expectedNetSettlement).toString();
    let explanation: string;

    if (!payoutHealthy) {
      batchStatus = 'PAYOUT_FAILED_OR_PENDING';
      explanation = `Settlement batch ${settlementRef} has provider status ${input.row.providerStatus}; funds are not yet confirmed settled.`;
    } else if (ambiguousStatement) {
      batchStatus = 'AMBIGUOUS';
      explanation = `${chosenList.length} candidate statement credit rows match settlement ${settlementRef}; human selection required.`;
    } else if (collectionTxRefs.size === 0 || missingCount > 0 || matchedCount < expectedTxCount) {
      batchStatus = 'MISSING_COLLECTION_DETAIL';
      explanation =
        collectionTxRefs.size === 0
          ? `Settlement batch ${settlementRef} (${reportedNet} minor) has no underlying collection rows linked yet.`
          : `Settlement batch ${settlementRef} matched ${matchedCount} internal collection(s), with ${missingCount} missing internal collection(s) (expected count: ${expectedTxCount}).`;
    } else if (expectedNetSettlement !== reportedNet) {
      const batchHeaderFee = BigInt(input.row.providerFeeMinor);
      if (
        providerFeeTotal !== batchHeaderFee &&
        grossCollections - batchHeaderFee === reportedNet
      ) {
        batchStatus = 'FEE_MISMATCH';
        explanation = `Settlement fee variance on ${settlementRef}: summed collection fees (${providerFeeTotal}) differ from settlement fee (${batchHeaderFee}).`;
      } else {
        batchStatus = 'NET_AMOUNT_MISMATCH';
        explanation = `Settlement net variance on ${settlementRef}: expected merchant settlement ${expectedNetSettlement} minor (gross ${grossCollections} − Monnify fee ${providerFeeTotal}; customer wallet credit ${customerWalletCreditTotal} after ${platformFeeTotal} MonieNaija charge) vs reported ${reportedNet} minor.`;
      }
    } else if (!statementRowId || statementCreditMinor === null) {
      batchStatus = 'STATEMENT_UNMATCHED';
      explanation = `Collection math reconciled (${matchedCount} collection(s), merchant settlement ${expectedNetSettlement} minor; customer wallet credits ${customerWalletCreditTotal} minor after ${platformFeeTotal} MonieNaija charge), awaiting matching Monnify Wallet or Bank Statement credit row.`;
    } else if (BigInt(statementCreditMinor) !== reportedNet) {
      batchStatus = 'NET_AMOUNT_MISMATCH';
      varianceMinor = (BigInt(statementCreditMinor) - reportedNet).toString();
      explanation = `Statement credit (${statementCreditMinor} minor) differs from reported settlement amount (${reportedNet} minor) for ${settlementRef}.`;
    } else {
      batchStatus = 'RECONCILED';
      varianceMinor = '0';
      explanation = `Fully reconciled: ${matchedCount} collection(s), gross ${grossCollections}, Monnify fee ${providerFeeTotal}, merchant settlement ${expectedNetSettlement}, statement credit ${statementCreditMinor} (customer wallet credits ${customerWalletCreditTotal} + MonieNaija fee ${platformFeeTotal}).`;
    }

    await manager.query(
      `INSERT INTO settlement_batch_reconciliations (
         scope, institution_id, provider_key, settlement_reference, payout_reference,
         settlement_row_id, statement_row_id, statement_destination, masked_destination_account,
         currency, gross_collections_minor, provider_fee_total_minor, expected_net_settlement_minor,
         platform_fee_total_minor, customer_wallet_credit_total_minor,
         reported_net_settlement_minor, statement_credit_minor, variance_minor,
         matched_collection_count, missing_collection_count,
         settled_at, batch_status, explanation
       )
       VALUES (
         $1, $2::uuid, $3, $4, $5,
         $6::uuid, $7::uuid, $8, $9,
         $10, $11::numeric, $12::numeric, $13::numeric,
         $14::numeric, $15::numeric,
         $16::numeric, $17::numeric, $18::numeric,
         $19, $20,
         $21::timestamptz, $22, $23
       )
       ON CONFLICT ((COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)), provider_key, settlement_reference)
       DO UPDATE SET
         payout_reference = COALESCE(EXCLUDED.payout_reference, settlement_batch_reconciliations.payout_reference),
         settlement_row_id = COALESCE(EXCLUDED.settlement_row_id, settlement_batch_reconciliations.settlement_row_id),
         statement_row_id = COALESCE(EXCLUDED.statement_row_id, settlement_batch_reconciliations.statement_row_id),
         statement_destination = CASE
           WHEN EXCLUDED.statement_destination <> 'UNSPECIFIED' THEN EXCLUDED.statement_destination
           ELSE settlement_batch_reconciliations.statement_destination
         END,
         masked_destination_account = COALESCE(EXCLUDED.masked_destination_account, settlement_batch_reconciliations.masked_destination_account),
         gross_collections_minor = EXCLUDED.gross_collections_minor,
         provider_fee_total_minor = EXCLUDED.provider_fee_total_minor,
         expected_net_settlement_minor = EXCLUDED.expected_net_settlement_minor,
         platform_fee_total_minor = EXCLUDED.platform_fee_total_minor,
         customer_wallet_credit_total_minor = EXCLUDED.customer_wallet_credit_total_minor,
         reported_net_settlement_minor = EXCLUDED.reported_net_settlement_minor,
         statement_credit_minor = COALESCE(EXCLUDED.statement_credit_minor, settlement_batch_reconciliations.statement_credit_minor),
         variance_minor = EXCLUDED.variance_minor,
         matched_collection_count = EXCLUDED.matched_collection_count,
         missing_collection_count = EXCLUDED.missing_collection_count,
         settled_at = COALESCE(EXCLUDED.settled_at, settlement_batch_reconciliations.settled_at),
         batch_status = CASE
           WHEN settlement_batch_reconciliations.review_state = 'APPROVED' THEN settlement_batch_reconciliations.batch_status
           ELSE EXCLUDED.batch_status
         END,
         explanation = CASE
           WHEN settlement_batch_reconciliations.review_state = 'APPROVED' THEN settlement_batch_reconciliations.explanation
           ELSE EXCLUDED.explanation
         END,
         updated_at = clock_timestamp()`,
      [
        input.scope,
        input.institutionId,
        input.providerKey,
        settlementRef,
        input.row.payoutReference,
        input.settlementRowId,
        statementRowId,
        statementDest,
        maskedAccount,
        input.row.currency,
        grossCollections.toString(),
        providerFeeTotal.toString(),
        expectedNetSettlement.toString(),
        platformFeeTotal.toString(),
        customerWalletCreditTotal.toString(),
        reportedNet.toString(),
        statementCreditMinor,
        varianceMinor,
        matchedCount,
        missingCount,
        input.row.settledAt,
        batchStatus,
        explanation.slice(0, 600),
      ],
    );
  }

  private async reevaluateOpenSettlementBatches(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    scope: SettlementReconciliationScope,
    institutionId: string | null,
  ): Promise<void> {
    const openBatches = await manager.query<Array<Record<string, unknown>>>(
      `SELECT b.provider_key,
              b.statement_destination,
              b.settlement_row_id::text AS settlement_row_id,
              r.row_number,
              r.direction,
              r.provider_transaction_reference,
              r.platform_reference,
              r.payment_reference,
              r.settlement_reference,
              r.payout_reference,
              r.nip_session_id,
              r.refund_or_dispute_reference,
              r.currency,
              r.gross_amount_minor::text AS gross_amount_minor,
              r.provider_fee_minor::text AS provider_fee_minor,
              r.net_amount_minor::text AS net_amount_minor,
              r.running_balance_after_minor::text AS running_balance_after_minor,
              r.provider_status,
              r.occurred_at,
              r.settled_at,
              r.masked_counterparty_account,
              r.masked_destination_account,
              r.counterparty_bank_code,
              r.narration,
              r.underlying_items,
              r.normalized_attributes,
              r.row_fingerprint
         FROM settlement_batch_reconciliations b
         JOIN settlement_report_rows r ON r.id = b.settlement_row_id
        WHERE COALESCE(b.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND b.review_state <> 'APPROVED'
          AND b.batch_status IN ('MISSING_COLLECTION_DETAIL', 'STATEMENT_UNMATCHED', 'AMBIGUOUS')`,
      [ZERO_UUID, institutionId],
    );

    for (const raw of openBatches) {
      const normalizedRow: NormalizedSettlementReportRow = {
        rowNumber: Number(raw.row_number),
        direction: 'SETTLEMENT',
        providerTransactionReference: (raw.provider_transaction_reference as string | null) ?? null,
        platformReference: (raw.platform_reference as string | null) ?? null,
        paymentReference: (raw.payment_reference as string | null) ?? null,
        settlementReference: String(raw.settlement_reference),
        payoutReference: (raw.payout_reference as string | null) ?? null,
        nipSessionId: (raw.nip_session_id as string | null) ?? null,
        refundOrDisputeReference: (raw.refund_or_dispute_reference as string | null) ?? null,
        currency: String(raw.currency),
        grossAmountMinor: String(raw.gross_amount_minor),
        providerFeeMinor: String(raw.provider_fee_minor),
        netAmountMinor: String(raw.net_amount_minor),
        runningBalanceAfterMinor: (raw.running_balance_after_minor as string | null) ?? null,
        providerStatus: String(raw.provider_status),
        occurredAt: raw.occurred_at ? (raw.occurred_at as Date).toISOString() : null,
        settledAt: raw.settled_at ? (raw.settled_at as Date).toISOString() : null,
        maskedCounterpartyAccount: (raw.masked_counterparty_account as string | null) ?? null,
        maskedDestinationAccount: (raw.masked_destination_account as string | null) ?? null,
        counterpartyBankCode: (raw.counterparty_bank_code as string | null) ?? null,
        narration: (raw.narration as string | null) ?? null,
        underlyingItems: Array.isArray(raw.underlying_items)
          ? (raw.underlying_items as NormalizedSettlementReportRow['underlyingItems'])
          : [],
        normalizedAttributes:
          (raw.normalized_attributes as Record<string, string | number | boolean | null>) ?? {},
        rowFingerprint: String(raw.row_fingerprint),
      };

      await this.reconcileSettlementBatchRow(manager, caps, {
        scope,
        institutionId,
        providerKey: String(raw.provider_key),
        statementDestination: raw.statement_destination as StatementDestination,
        settlementRowId: String(raw.settlement_row_id),
        row: normalizedRow,
      });
    }
  }

  private async reconcileStatementRows(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    ctx: {
      importId: string;
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      reportType: 'WALLET_STATEMENT' | 'BANK_STATEMENT';
      persistedRows: Array<{ rowId: string; row: NormalizedSettlementReportRow }>;
    },
  ): Promise<void> {
    // First re-evaluate open settlement batches so any matching STATEMENT_CREDIT rows attach cleanly
    await this.reevaluateOpenSettlementBatches(manager, caps, ctx.scope, ctx.institutionId);

    for (const { rowId, row } of ctx.persistedRows) {
      if (row.direction === 'STATEMENT_CREDIT') {
        const linkedBatch = await manager.query<
          Array<{ id: string; settlement_reference: string; net: string }>
        >(
          `SELECT id::text AS id, settlement_reference, reported_net_settlement_minor::text AS net
             FROM settlement_batch_reconciliations
            WHERE statement_row_id = $1::uuid
            LIMIT 1`,
          [rowId],
        );

        if (linkedBatch[0]) {
          await this.insertTransactionMatch(manager, {
            scope: ctx.scope,
            institutionId: ctx.institutionId,
            providerKey: ctx.providerKey,
            reportType: ctx.reportType,
            importId: ctx.importId,
            reportRowId: rowId,
            direction: 'STATEMENT_CREDIT',
            matchStatus: 'MATCHED',
            matchedKeys: ['settlementReference'],
            explanation: `Statement credit matched to settlement batch ${linkedBatch[0].settlement_reference}.`,
            currency: row.currency,
            providerGrossMinor: row.grossAmountMinor,
            providerFeeMinor: '0',
            providerNetMinor: row.netAmountMinor,
            providerStatus: row.providerStatus,
            providerOccurredAt: row.occurredAt,
            internalSourceType: 'SETTLEMENT_BATCH',
            internalSourceId: linkedBatch[0].id,
            internalBusinessReference: linkedBatch[0].settlement_reference,
            internalProviderReference: row.providerTransactionReference,
            internalGrossMinor: linkedBatch[0].net,
            internalProviderFeeMinor: '0',
            internalNetMinor: linkedBatch[0].net,
            internalPlatformFeeMinor: null,
            internalCustomerCreditMinor: null,
            internalStatus: 'RECONCILED',
            internalOccurredAt: row.occurredAt,
            internalTransactionHistoryPath: null,
            internalJournalIds: [],
            varianceMinor: (BigInt(row.netAmountMinor) - BigInt(linkedBatch[0].net)).toString(),
            feeVarianceMinor: '0',
            ambiguousCandidates: [],
          });
        } else {
          await this.insertTransactionMatch(manager, {
            scope: ctx.scope,
            institutionId: ctx.institutionId,
            providerKey: ctx.providerKey,
            reportType: ctx.reportType,
            importId: ctx.importId,
            reportRowId: rowId,
            direction: 'STATEMENT_CREDIT',
            matchStatus: 'MISSING_INTERNAL',
            matchedKeys: [],
            explanation:
              'Unmatched statement credit entry: no settlement batch or internal funding record matched this credit.',
            currency: row.currency,
            providerGrossMinor: row.grossAmountMinor,
            providerFeeMinor: '0',
            providerNetMinor: row.netAmountMinor,
            providerStatus: row.providerStatus,
            providerOccurredAt: row.occurredAt,
            internalSourceType: null,
            internalSourceId: null,
            internalBusinessReference: null,
            internalProviderReference: null,
            internalGrossMinor: null,
            internalProviderFeeMinor: null,
            internalNetMinor: null,
            internalPlatformFeeMinor: null,
            internalCustomerCreditMinor: null,
            internalStatus: null,
            internalOccurredAt: null,
            internalTransactionHistoryPath: null,
            internalJournalIds: [],
            varianceMinor: row.netAmountMinor,
            feeVarianceMinor: '0',
            ambiguousCandidates: [],
          });
        }
        continue;
      }

      // STATEMENT_DEBIT: match against outbound payout OR chargeback/lien/refund case
      const narrUpper = (row.narration ?? '').toUpperCase();
      const looksLikeChargebackOrReturn =
        narrUpper.includes('CHARGEBACK') ||
        narrUpper.includes('LIEN') ||
        narrUpper.includes('RECALL') ||
        narrUpper.includes('REFUND') ||
        narrUpper.includes('REVERSAL');

      const outbound = await findOutboundCandidates(manager, {
        institutionId: ctx.institutionId,
        providerKey: ctx.providerKey === 'COMMERCIAL_BANK_STATEMENT' ? 'MONNIFY' : ctx.providerKey,
        operationReference: row.payoutReference ?? row.platformReference,
        providerTransactionReference: row.providerTransactionReference,
        nipSessionId: row.nipSessionId,
      });

      if (outbound.candidates.length === 1) {
        const c = outbound.candidates[0]!;
        const expectedDebit = BigInt(c.amountMinor) + BigInt(c.providerFeeMinor);
        const diff = BigInt(row.netAmountMinor) - expectedDebit;
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: ctx.reportType,
          importId: ctx.importId,
          reportRowId: rowId,
          direction: 'STATEMENT_DEBIT',
          matchStatus: diff === 0n ? 'MATCHED' : 'AMOUNT_MISMATCH',
          matchedKeys: outbound.matchedKeysByCandidateId.get(c.id) ?? ['reference'],
          explanation:
            diff === 0n
              ? `Statement debit matched outbound operation ${c.operationReference}.`
              : `Statement debit (${row.netAmountMinor}) differs from outbound principal+fee (${expectedDebit}) for ${c.operationReference}.`,
          currency: row.currency,
          providerGrossMinor: row.grossAmountMinor,
          providerFeeMinor: '0',
          providerNetMinor: row.netAmountMinor,
          providerStatus: row.providerStatus,
          providerOccurredAt: row.occurredAt,
          internalSourceType: c.sourceType,
          internalSourceId: c.id,
          internalBusinessReference: c.operationReference,
          internalProviderReference: c.providerTransactionReference,
          internalGrossMinor: c.amountMinor,
          internalProviderFeeMinor: c.providerFeeMinor,
          internalNetMinor: expectedDebit.toString(),
          internalPlatformFeeMinor: c.platformFeeMinor,
          internalCustomerCreditMinor: null,
          internalStatus: c.internalStatus,
          internalOccurredAt: c.occurredAt,
          internalTransactionHistoryPath: c.transactionHistoryPath,
          internalJournalIds: c.journalIds,
          varianceMinor: diff.toString(),
          feeVarianceMinor: '0',
          ambiguousCandidates: [],
        });
      } else {
        await this.insertTransactionMatch(manager, {
          scope: ctx.scope,
          institutionId: ctx.institutionId,
          providerKey: ctx.providerKey,
          reportType: ctx.reportType,
          importId: ctx.importId,
          reportRowId: rowId,
          direction: 'STATEMENT_DEBIT',
          matchStatus: outbound.candidates.length > 1 ? 'AMBIGUOUS_CANDIDATES' : 'MISSING_INTERNAL',
          matchedKeys: [],
          explanation: looksLikeChargebackOrReturn
            ? 'Statement debit indicates a chargeback/lien/refund/reversal debit without a matched outbound operation; escalated to Return & Dispute cases.'
            : 'Unmatched statement debit entry: no internal outbound operation matched this debit.',
          currency: row.currency,
          providerGrossMinor: row.grossAmountMinor,
          providerFeeMinor: '0',
          providerNetMinor: row.netAmountMinor,
          providerStatus: row.providerStatus,
          providerOccurredAt: row.occurredAt,
          internalSourceType: null,
          internalSourceId: null,
          internalBusinessReference: null,
          internalProviderReference: null,
          internalGrossMinor: null,
          internalProviderFeeMinor: null,
          internalNetMinor: null,
          internalPlatformFeeMinor: null,
          internalCustomerCreditMinor: null,
          internalStatus: null,
          internalOccurredAt: null,
          internalTransactionHistoryPath: null,
          internalJournalIds: [],
          varianceMinor: row.netAmountMinor,
          feeVarianceMinor: '0',
          ambiguousCandidates: outbound.candidates.map((c) =>
            toAmbiguousOutboundCandidate(c, outbound.matchedKeysByCandidateId.get(c.id) ?? []),
          ),
        });

        if (looksLikeChargebackOrReturn) {
          await this.correlateReturnDisputeRow(manager, caps, {
            scope: ctx.scope,
            institutionId: ctx.institutionId,
            providerKey: ctx.providerKey,
            reportRowId: rowId,
            row: {
              ...row,
              refundOrDisputeReference: row.providerTransactionReference ?? row.platformReference,
              normalizedAttributes: {
                ...row.normalizedAttributes,
                eventKind: 'CHARGEBACK_OR_LIEN',
              },
            },
            isStatementEntry: true,
          });
        }
      }
    }
  }

  // ------------------------------------------------ Workflow 4: Returns, Reversals & Disputes

  private async syncInternalReturnCandidates(
    q: SqlQueryable,
    principal: AuthorizationPrincipal,
    requestedInstitutionId: string | undefined,
  ): Promise<void> {
    const caps = await detectOptionalSchemaCapabilities(q);
    if (!caps.hasBankToWalletExceptions) return;

    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(q, principal, requestedInstitutionId, 'e', params);
    if (filter.emptyShortCircuit) return;

    const returnExceptions = await q.query<
      Array<{
        id: string;
        institution_id: string | null;
        provider_key: string;
        business_reference: string | null;
        provider_transaction_reference: string;
        currency: string;
        gross_amount_minor: string;
        provider_fee_minor: string;
        settlement_amount_minor: string;
        customer_credit_minor: string;
        state: string;
        decision_at: Date | null;
        created_at: Date;
        resolution_journal_id: string | null;
      }>
    >(
      `SELECT e.id::text AS id,
              e.institution_id::text AS institution_id,
              e.provider_key,
              e.business_reference,
              e.provider_transaction_reference,
              e.currency,
              e.gross_amount_minor::text AS gross_amount_minor,
              e.provider_fee_minor::text AS provider_fee_minor,
              COALESCE(e.settlement_amount_minor, e.gross_amount_minor - e.provider_fee_minor)::text AS settlement_amount_minor,
              e.customer_credit_minor::text AS customer_credit_minor,
              e.state,
              e.decision_at,
              e.created_at,
              e.resolution_journal_id::text AS resolution_journal_id
         FROM bank_to_wallet_exceptions e
        WHERE (${filter.clause})
          AND e.state IN ('APPROVED_FOR_RETURN', 'RETURNED')
        ORDER BY e.created_at DESC
        LIMIT 100`,
      params,
    );

    for (const exc of returnExceptions) {
      const scope: SettlementReconciliationScope = exc.institution_id ? 'INSTITUTION' : 'PLATFORM';
      const caseKey = `${exc.provider_key}:B2W_RETURN:${exc.provider_transaction_reference}`;
      const lifecycle: ReturnDisputeLifecycleStatus =
        exc.state === 'RETURNED' ? 'RECONCILED' : 'AWAITING_PROVIDER_CONFIRMATION';
      const explanation =
        exc.state === 'RETURNED'
          ? `Bank-to-Wallet exception ${exc.business_reference} is marked RETURNED internally.`
          : `Bank-to-Wallet exception ${exc.business_reference} is APPROVED_FOR_RETURN internally and awaits provider refund/return confirmation.`;

      const upserted = await q.query<Array<{ id: string }>>(
        `INSERT INTO settlement_return_dispute_cases (
           case_key, scope, institution_id, provider_key, case_kind,
           original_source_type, original_source_id, original_business_reference, original_provider_reference,
           original_currency, original_gross_minor, original_provider_fee_minor, original_net_minor,
           original_customer_credit_minor, original_internal_status, original_occurred_at, original_journal_ids,
           event_amount_minor, internal_return_status, linked_reversal_journal_id,
           lifecycle_status, explanation
         )
         VALUES (
           $1, $2, $3::uuid, $4, 'APPROVED_RETURN_AWAITING_CONFIRMATION',
           'BANK_TO_WALLET_EXCEPTION', $5::uuid, $6, $7,
           $8, $9::numeric, $10::numeric, $11::numeric,
           $12::numeric, $13, $14::timestamptz, $15::jsonb,
           $9::numeric, $13, $16::uuid,
           $17, $18
         )
         ON CONFLICT ((COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)), case_key)
         DO UPDATE SET
           internal_return_status = EXCLUDED.internal_return_status,
           linked_reversal_journal_id = COALESCE(settlement_return_dispute_cases.linked_reversal_journal_id, EXCLUDED.linked_reversal_journal_id),
           lifecycle_status = CASE
             WHEN settlement_return_dispute_cases.review_state = 'APPROVED' THEN settlement_return_dispute_cases.lifecycle_status
             WHEN settlement_return_dispute_cases.provider_report_row_id IS NOT NULL THEN 'RECONCILED'
             ELSE EXCLUDED.lifecycle_status
           END,
           updated_at = clock_timestamp()
         RETURNING id::text AS id`,
        [
          caseKey,
          scope,
          exc.institution_id,
          exc.provider_key,
          exc.id,
          exc.business_reference,
          exc.provider_transaction_reference,
          exc.currency,
          exc.gross_amount_minor,
          exc.provider_fee_minor,
          exc.settlement_amount_minor,
          exc.customer_credit_minor,
          exc.state,
          exc.created_at.toISOString(),
          JSON.stringify(exc.resolution_journal_id ? [exc.resolution_journal_id] : []),
          exc.resolution_journal_id,
          lifecycle,
          explanation,
        ],
      );

      const caseId = upserted[0]!.id;
      const fp = eventFingerprint(['INTERNAL_RECORD', exc.id, exc.state]);
      await q.query(
        `INSERT INTO settlement_return_dispute_events (
           case_id, event_source, event_type, status_label, amount_minor, fee_minor,
           reference, actor, detail, occurred_at, event_fingerprint
         )
         VALUES ($1::uuid, 'INTERNAL_RECORD', 'B2W_EXCEPTION_RETURN_STATE', $2, $3::numeric, 0, $4, 'SYSTEM', $5, $6::timestamptz, $7)
         ON CONFLICT (case_id, event_fingerprint) DO NOTHING`,
        [
          caseId,
          exc.state,
          exc.gross_amount_minor,
          exc.business_reference,
          explanation,
          (exc.decision_at ?? exc.created_at).toISOString(),
          fp,
        ],
      );
    }
  }

  private async correlateReversedPayoutCase(
    manager: EntityManager,
    input: {
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      reportRowId: string;
      row: NormalizedSettlementReportRow;
      candidate: InternalOutboundCandidate | null;
    },
  ): Promise<void> {
    const refKey =
      input.candidate?.operationReference ??
      input.row.platformReference ??
      input.row.providerTransactionReference ??
      input.reportRowId;
    const caseKey = `${input.providerKey}:OUTBOUND_REVERSAL:${refKey}`;
    const c = input.candidate;

    // Check if any reversal journal exists on the original reservation/resolution journals
    let reversalJournalId: string | null = null;
    if (c && c.journalIds.length > 0) {
      const revRows = await manager.query<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM ledger_journals
          WHERE reversal_of_journal_id = ANY($1::uuid[])
          LIMIT 1`,
        [c.journalIds],
      );
      reversalJournalId = revRows[0]?.id ?? null;
    }

    const internalReversed = c?.internalStatus === 'REVERSED';
    const lifecycle: ReturnDisputeLifecycleStatus =
      c && internalReversed ? 'RECONCILED' : 'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL';
    const explanation =
      c && internalReversed
        ? `Outbound disbursement reversal for ${c.operationReference} aligns with internal REVERSED state; original amount (${c.amountMinor} minor) preserved immutably.`
        : c
          ? `Provider payout report shows REVERSED for ${c.operationReference}, while internal outbound state is ${c.internalStatus}; requires Finance & Operations verification.`
          : `Provider payout report shows REVERSED disbursement (${refKey}) with no matching internal outbound operation.`;

    const upserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO settlement_return_dispute_cases (
         case_key, scope, institution_id, provider_key, case_kind,
         original_source_type, original_source_id, original_business_reference, original_provider_reference,
         original_currency, original_gross_minor, original_provider_fee_minor, original_net_minor,
         original_customer_credit_minor, original_internal_status, original_occurred_at, original_journal_ids,
         return_or_dispute_reference, event_amount_minor, event_fee_minor,
         provider_event_status, internal_return_status, provider_report_row_id,
         linked_reversal_journal_id, lifecycle_status, explanation
       )
       VALUES (
         $1, $2, $3::uuid, $4, 'OUTBOUND_DISBURSEMENT_REVERSAL',
         $5, $6::uuid, $7, $8,
         $9, $10::numeric, $11::numeric, $12::numeric,
         NULL, $13, $14::timestamptz, $15::jsonb,
         $16, $17::numeric, $18::numeric,
         $19, $13, $20::uuid,
         $21::uuid, $22, $23
       )
       ON CONFLICT ((COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)), case_key)
       DO UPDATE SET
         provider_event_status = EXCLUDED.provider_event_status,
         provider_report_row_id = EXCLUDED.provider_report_row_id,
         linked_reversal_journal_id = COALESCE(settlement_return_dispute_cases.linked_reversal_journal_id, EXCLUDED.linked_reversal_journal_id),
         lifecycle_status = CASE
           WHEN settlement_return_dispute_cases.review_state = 'APPROVED' THEN settlement_return_dispute_cases.lifecycle_status
           ELSE EXCLUDED.lifecycle_status
         END,
         explanation = CASE
           WHEN settlement_return_dispute_cases.review_state = 'APPROVED' THEN settlement_return_dispute_cases.explanation
           ELSE EXCLUDED.explanation
         END,
         updated_at = clock_timestamp()
       RETURNING id::text AS id`,
      [
        caseKey,
        input.scope,
        input.institutionId,
        input.providerKey,
        c?.sourceType ?? null,
        c?.id ?? null,
        c?.operationReference ?? input.row.platformReference,
        c?.providerTransactionReference ?? input.row.providerTransactionReference,
        input.row.currency,
        c?.amountMinor ?? null,
        c?.providerFeeMinor ?? null,
        c ? (BigInt(c.amountMinor) + BigInt(c.providerFeeMinor)).toString() : null,
        c?.internalStatus ?? null,
        c?.occurredAt ?? null,
        JSON.stringify(c?.journalIds ?? []),
        input.row.providerTransactionReference ?? input.row.platformReference,
        input.row.grossAmountMinor,
        input.row.providerFeeMinor,
        input.row.providerStatus,
        input.reportRowId,
        reversalJournalId,
        lifecycle,
        explanation.slice(0, 600),
      ],
    );

    const caseId = upserted[0]!.id;
    if (c) {
      const origFp = eventFingerprint(['INTERNAL_ORIGINAL', c.id]);
      await manager.query(
        `INSERT INTO settlement_return_dispute_events (
           case_id, event_source, event_type, status_label, amount_minor, fee_minor,
           reference, actor, detail, occurred_at, event_fingerprint
         )
         VALUES ($1::uuid, 'INTERNAL_RECORD', 'ORIGINAL_OUTBOUND_OPERATION', $2, $3::numeric, $4::numeric, $5, 'SYSTEM', $6, $7::timestamptz, $8)
         ON CONFLICT (case_id, event_fingerprint) DO NOTHING`,
        [
          caseId,
          c.internalStatus,
          c.amountMinor,
          c.providerFeeMinor,
          c.operationReference,
          `Original outbound operation ${c.operationReference} recorded with immutable principal ${c.amountMinor} minor.`,
          c.occurredAt ?? new Date().toISOString(),
          origFp,
        ],
      );
    }

    const provFp = eventFingerprint(['PROVIDER_REVERSAL', input.reportRowId]);
    await manager.query(
      `INSERT INTO settlement_return_dispute_events (
         case_id, event_source, event_type, status_label, amount_minor, fee_minor,
         reference, actor, detail, occurred_at, event_fingerprint
       )
       VALUES ($1::uuid, 'PROVIDER_REPORT', 'DISBURSEMENT_REVERSED', $2, $3::numeric, $4::numeric, $5, 'PROVIDER', $6, $7::timestamptz, $8)
       ON CONFLICT (case_id, event_fingerprint) DO NOTHING`,
      [
        caseId,
        input.row.providerStatus,
        input.row.grossAmountMinor,
        input.row.providerFeeMinor,
        input.row.providerTransactionReference ?? input.row.platformReference,
        `Provider payout report confirmed ${input.row.providerStatus} for ${input.row.grossAmountMinor} minor.`,
        input.row.occurredAt ?? new Date().toISOString(),
        provFp,
      ],
    );
  }

  private async correlateReturnDisputeRow(
    manager: EntityManager,
    caps: OptionalArena9SchemaCapabilities,
    input: {
      scope: SettlementReconciliationScope;
      institutionId: string | null;
      providerKey: string;
      reportRowId: string;
      row: NormalizedSettlementReportRow;
      isStatementEntry?: boolean;
    },
  ): Promise<void> {
    const lookupProviderKey =
      input.providerKey === 'COMMERCIAL_BANK_STATEMENT' ? 'MONNIFY' : input.providerKey;
    let resolvedOrigRef = input.row.providerTransactionReference;
    if (
      caps.hasBankToWalletReturnRefunds &&
      (input.row.refundOrDisputeReference || input.row.platformReference)
    ) {
      const b2wReturnRows = await manager.query<Array<{ original_provider_reference: string }>>(
        `SELECT original_provider_reference
           FROM bank_to_wallet_return_refunds
          WHERE ($1::uuid IS NULL OR institution_id = $1::uuid)
            AND (
                 ($2::text IS NOT NULL AND refund_reference = $2)
              OR ($3::text IS NOT NULL AND return_reference = $3)
            )
          LIMIT 1`,
        [input.institutionId, input.row.refundOrDisputeReference, input.row.platformReference],
      );
      if (!resolvedOrigRef && b2wReturnRows[0]?.original_provider_reference) {
        resolvedOrigRef = b2wReturnRows[0].original_provider_reference;
      }
    }

    const inbound = await findInboundCandidates(manager, caps, {
      institutionId: input.institutionId,
      providerKey: lookupProviderKey,
      providerTransactionReference: resolvedOrigRef,
      paymentReference: input.row.paymentReference,
      platformReference: input.row.platformReference,
    });

    const ambiguous = inbound.candidates.length > 1;
    const orig = inbound.candidates.length === 1 ? inbound.candidates[0]! : null;

    // Look for matching customer dispute
    const candidateRefs = [
      orig?.businessReference,
      orig?.providerTransactionReference,
      input.row.providerTransactionReference,
      input.row.platformReference,
    ].filter((x): x is string => Boolean(x));
    const disputes = await findMatchingInternalDisputes(manager, {
      institutionId: input.institutionId,
      references: candidateRefs,
    });
    const linkedDispute = disputes[0] ?? null;

    // Check if an existing B2W_RETURN case already exists for this original provider tx ref
    const existingB2wKey = orig
      ? `${lookupProviderKey}:B2W_RETURN:${orig.providerTransactionReference}`
      : null;
    const caseKey =
      existingB2wKey &&
      orig?.exceptionState &&
      ['APPROVED_FOR_RETURN', 'RETURNED'].includes(orig.exceptionState)
        ? existingB2wKey
        : `${lookupProviderKey}:RETURN:${input.row.refundOrDisputeReference ?? input.row.providerTransactionReference ?? input.reportRowId}`;

    const rawEventKind = String(input.row.normalizedAttributes.eventKind ?? 'VOLUNTARY_REFUND');
    const caseKind: ReturnDisputeCaseKind =
      existingB2wKey === caseKey
        ? 'APPROVED_RETURN_AWAITING_CONFIRMATION'
        : rawEventKind === 'CHARGEBACK_OR_LIEN'
          ? 'CHARGEBACK_OR_LIEN'
          : rawEventKind === 'REVERSAL_OR_RECALL'
            ? 'INBOUND_COLLECTION_REVERSAL'
            : linkedDispute
              ? 'CUSTOMER_DISPUTE_LINKED'
              : 'VOLUNTARY_REFUND';

    // Check if any reversal journal exists reversing one of original's journals
    let reversalJournalId: string | null = null;
    if (orig && orig.journalIds.length > 0) {
      const revRows = await manager.query<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM ledger_journals
          WHERE reversal_of_journal_id = ANY($1::uuid[])
          LIMIT 1`,
        [orig.journalIds],
      );
      reversalJournalId = revRows[0]?.id ?? null;
    }

    const statusUpper = input.row.providerStatus.toUpperCase();
    const providerCompleted = ['COMPLETED', 'SUCCESS', 'SUCCESSFUL', 'POSTED', 'SETTLED'].includes(
      statusUpper,
    );
    const providerPending = ['PENDING', 'IN_PROGRESS', 'INITIATED', 'PROCESSING'].includes(
      statusUpper,
    );

    const eventAmt = BigInt(input.row.grossAmountMinor);
    const origGross = orig ? BigInt(orig.grossAmountMinor) : null;
    const internalReturnSettled =
      orig?.exceptionState === 'RETURNED' ||
      orig?.exceptionState === 'APPROVED_FOR_RETURN' ||
      Boolean(reversalJournalId) ||
      (linkedDispute?.outcome === 'UPHELD_IN_FULL' &&
        linkedDispute.awardedAmountMinor === input.row.grossAmountMinor);

    let lifecycle: ReturnDisputeLifecycleStatus;
    let varianceMinor = '0';
    let explanation: string;

    if (ambiguous) {
      lifecycle = 'AMBIGUOUS';
      explanation = `${inbound.candidates.length} candidate original inbound records match this return/dispute event; human selection required.`;
    } else if (providerPending) {
      lifecycle = 'AWAITING_PROVIDER_CONFIRMATION';
      explanation = `Provider refund/return (${input.row.refundOrDisputeReference ?? 'pending'}) is in ${input.row.providerStatus} state awaiting completion.`;
    } else if (!orig) {
      lifecycle = 'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL';
      varianceMinor = input.row.grossAmountMinor;
      explanation = `Provider ${caseKind} (${input.row.grossAmountMinor} minor) has no matched original internal inbound payment record.`;
    } else if (!internalReturnSettled) {
      lifecycle = 'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL';
      varianceMinor = input.row.grossAmountMinor;
      explanation = `Provider confirmed ${caseKind} of ${input.row.grossAmountMinor} minor against original transaction ${orig.businessReference ?? orig.providerTransactionReference} (original gross ${orig.grossAmountMinor} preserved), but no internal return resolution or reversal journal is linked yet.`;
    } else if (origGross !== null && eventAmt !== origGross) {
      lifecycle = 'AMOUNT_OR_FEE_VARIANCE';
      varianceMinor = (eventAmt - origGross).toString();
      explanation = `Partial or differing return/refund amount: provider event is ${eventAmt} minor vs frozen original gross ${origGross} minor; requires Finance sign-off.`;
    } else if (providerCompleted && internalReturnSettled) {
      lifecycle = 'RECONCILED';
      varianceMinor = '0';
      explanation = `Return/refund event (${eventAmt} minor) reconciled cleanly against original transaction ${orig.businessReference ?? orig.providerTransactionReference} while keeping original amounts immutable.`;
    } else {
      lifecycle = 'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL';
      explanation = `Provider reported ${input.row.providerStatus} on ${caseKind}; requires Finance review.`;
    }

    const upserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO settlement_return_dispute_cases (
         case_key, scope, institution_id, provider_key, case_kind,
         original_source_type, original_source_id, original_business_reference, original_provider_reference,
         original_currency, original_gross_minor, original_provider_fee_minor, original_net_minor,
         original_customer_credit_minor, original_internal_status, original_occurred_at, original_journal_ids,
         return_or_dispute_reference, event_amount_minor, event_fee_minor,
         provider_event_status, internal_return_status,
         provider_report_row_id, statement_row_id,
         linked_internal_dispute_id, linked_reversal_journal_id,
         lifecycle_status, variance_minor, explanation
       )
       VALUES (
         $1, $2, $3::uuid, $4, $5,
         $6, $7::uuid, $8, $9,
         $10, $11::numeric, $12::numeric, $13::numeric,
         $14::numeric, $15, $16::timestamptz, $17::jsonb,
         $18, $19::numeric, $20::numeric,
         $21, $22,
         $23::uuid, $24::uuid,
         $25::uuid, $26::uuid,
         $27, $28::numeric, $29
       )
       ON CONFLICT ((COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)), case_key)
       DO UPDATE SET
         return_or_dispute_reference = COALESCE(EXCLUDED.return_or_dispute_reference, settlement_return_dispute_cases.return_or_dispute_reference),
         event_amount_minor = EXCLUDED.event_amount_minor,
         event_fee_minor = EXCLUDED.event_fee_minor,
         provider_event_status = EXCLUDED.provider_event_status,
         provider_report_row_id = COALESCE(EXCLUDED.provider_report_row_id, settlement_return_dispute_cases.provider_report_row_id),
         statement_row_id = COALESCE(EXCLUDED.statement_row_id, settlement_return_dispute_cases.statement_row_id),
         linked_internal_dispute_id = COALESCE(settlement_return_dispute_cases.linked_internal_dispute_id, EXCLUDED.linked_internal_dispute_id),
         linked_reversal_journal_id = COALESCE(settlement_return_dispute_cases.linked_reversal_journal_id, EXCLUDED.linked_reversal_journal_id),
         lifecycle_status = CASE
           WHEN settlement_return_dispute_cases.review_state = 'APPROVED' THEN settlement_return_dispute_cases.lifecycle_status
           ELSE EXCLUDED.lifecycle_status
         END,
         variance_minor = EXCLUDED.variance_minor,
         explanation = CASE
           WHEN settlement_return_dispute_cases.review_state = 'APPROVED' THEN settlement_return_dispute_cases.explanation
           ELSE EXCLUDED.explanation
         END,
         updated_at = clock_timestamp()
       RETURNING id::text AS id`,
      [
        caseKey,
        input.scope,
        input.institutionId,
        lookupProviderKey,
        caseKind,
        orig?.sourceType ?? null,
        orig?.id ?? null,
        orig?.businessReference ?? null,
        orig?.providerTransactionReference ?? input.row.providerTransactionReference,
        input.row.currency,
        orig?.grossAmountMinor ?? null,
        orig?.providerFeeMinor ?? null,
        orig?.merchantSettlementMinor ?? null,
        orig?.customerCreditMinor ?? null,
        orig?.internalStatus ?? null,
        orig?.occurredAt ?? null,
        JSON.stringify(orig?.journalIds ?? []),
        input.row.refundOrDisputeReference,
        input.row.grossAmountMinor,
        input.row.providerFeeMinor,
        input.row.providerStatus,
        orig?.exceptionState ?? (reversalJournalId ? 'REVERSAL_JOURNAL_POSTED' : null),
        input.isStatementEntry ? null : input.reportRowId,
        input.isStatementEntry ? input.reportRowId : null,
        linkedDispute?.id ?? null,
        reversalJournalId,
        lifecycle,
        varianceMinor,
        explanation.slice(0, 600),
      ],
    );

    const caseId = upserted[0]!.id;
    if (orig) {
      const origFp = eventFingerprint(['ORIGINAL_INBOUND', orig.id]);
      await manager.query(
        `INSERT INTO settlement_return_dispute_events (
           case_id, event_source, event_type, status_label, amount_minor, fee_minor,
           reference, actor, detail, occurred_at, event_fingerprint
         )
         VALUES ($1::uuid, 'INTERNAL_RECORD', 'ORIGINAL_INBOUND_PAYMENT', $2, $3::numeric, $4::numeric, $5, 'SYSTEM', $6, $7::timestamptz, $8)
         ON CONFLICT (case_id, event_fingerprint) DO NOTHING`,
        [
          caseId,
          orig.internalStatus,
          orig.grossAmountMinor,
          orig.providerFeeMinor,
          orig.businessReference ?? orig.providerTransactionReference,
          `Original inbound payment preserved immutably (gross ${orig.grossAmountMinor}, Monnify fee ${orig.providerFeeMinor}, merchant settlement ${orig.merchantSettlementMinor}, customer credit ${orig.customerCreditMinor}).`,
          orig.occurredAt ?? new Date().toISOString(),
          origFp,
        ],
      );
    }

    const evtSource = input.isStatementEntry ? 'STATEMENT_ENTRY' : 'PROVIDER_REPORT';
    const provFp = eventFingerprint([evtSource, input.reportRowId, input.row.providerStatus]);
    await manager.query(
      `INSERT INTO settlement_return_dispute_events (
         case_id, event_source, event_type, status_label, amount_minor, fee_minor,
         reference, actor, detail, occurred_at, event_fingerprint
       )
       VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6::numeric, $7, 'PROVIDER', $8, $9::timestamptz, $10)
       ON CONFLICT (case_id, event_fingerprint) DO NOTHING`,
      [
        caseId,
        evtSource,
        caseKind,
        input.row.providerStatus,
        input.row.grossAmountMinor,
        input.row.providerFeeMinor,
        input.row.refundOrDisputeReference ?? input.row.providerTransactionReference,
        input.row.narration ??
          `${caseKind} reported (${input.row.grossAmountMinor} minor, status ${input.row.providerStatus}).`,
        input.row.occurredAt ?? new Date().toISOString(),
        provFp,
      ],
    );
  }

  // ------------------------------------------------ Query & Review Endpoints

  private async assertJournalVisibleInScope(
    q: SqlQueryable,
    journalId: string,
    institutionId: string | null,
  ): Promise<{ id: string; reference: string | null; status: string; totalMinor: string }> {
    const rows = await q.query<
      Array<{
        id: string;
        reference: string;
        status: string;
        total_minor: string;
        institution_id: string | null;
      }>
    >(
      `SELECT id::text AS id, reference, status, total_minor::text AS total_minor, institution_id::text AS institution_id
         FROM ledger_journals
        WHERE id = $1::uuid`,
      [journalId],
    );
    const j = rows[0];
    if (!j) {
      throw new NotFoundException('Referenced ledger journal not found');
    }
    if (institutionId && j.institution_id && j.institution_id !== institutionId) {
      throw new NotFoundException('Referenced ledger journal not found');
    }
    return {
      id: j.id,
      reference: j.reference,
      status: j.status,
      totalMinor: j.total_minor,
    };
  }

  async listTransactionMatches(
    principal: AuthorizationPrincipal,
    query: ListSettlementReconciliationQueryDto,
  ) {
    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(
      this.dataSource,
      principal,
      query.institutionId,
      'm',
      params,
    );
    if (filter.emptyShortCircuit) return { items: [] };

    const clauses = [filter.clause];
    if (query.reportType) {
      params.push(query.reportType);
      clauses.push(`m.report_type = $${params.length}`);
    }
    if (query.status) {
      if (query.status === 'EXCEPTIONS_ONLY') {
        clauses.push(`m.match_status <> 'MATCHED'`);
      } else if (query.status === 'PENDING_REVIEW') {
        clauses.push(`m.review_state = 'PROPOSED'`);
      } else {
        params.push(query.status);
        clauses.push(`m.match_status = $${params.length}`);
      }
    }
    if (query.importId) {
      params.push(query.importId);
      clauses.push(`m.import_id = $${params.length}::uuid`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      clauses.push(
        `(
          COALESCE(m.internal_business_reference, '') ILIKE $${params.length}
          OR COALESCE(m.internal_provider_reference, '') ILIKE $${params.length}
          OR COALESCE(r.provider_transaction_reference, '') ILIKE $${params.length}
          OR COALESCE(r.platform_reference, '') ILIKE $${params.length}
          OR COALESCE(r.nip_session_id, '') ILIKE $${params.length}
        )`,
      );
    }

    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT m.id::text AS id,
              m.scope,
              m.institution_id::text AS institution_id,
              fi.code AS institution_code,
              m.provider_key,
              m.report_type,
              m.import_id::text AS import_id,
              m.report_row_id::text AS report_row_id,
              m.direction,
              m.match_status,
              m.matched_keys,
              m.explanation,
              m.currency,
              m.provider_gross_minor::text AS provider_gross_minor,
              m.provider_fee_minor::text AS provider_fee_minor,
              m.provider_net_minor::text AS provider_net_minor,
              m.provider_status,
              m.provider_occurred_at,
              m.internal_source_type,
              m.internal_source_id::text AS internal_source_id,
              m.internal_business_reference,
              m.internal_provider_reference,
              m.internal_gross_minor::text AS internal_gross_minor,
              m.internal_provider_fee_minor::text AS internal_provider_fee_minor,
              m.internal_net_minor::text AS internal_net_minor,
              m.internal_platform_fee_minor::text AS internal_platform_fee_minor,
              m.internal_customer_credit_minor::text AS internal_customer_credit_minor,
              m.internal_status,
              m.internal_occurred_at,
              m.internal_transaction_history_path,
              m.internal_journal_ids,
              m.variance_minor::text AS variance_minor,
              m.fee_variance_minor::text AS fee_variance_minor,
              m.ambiguous_candidates,
              m.review_state,
              m.proposed_decision,
              m.selected_candidate_id::text AS selected_candidate_id,
              m.linked_journal_id::text AS linked_journal_id,
              m.proposed_note,
              m.proposed_by,
              m.proposed_at,
              m.reviewed_by,
              m.reviewed_at,
              m.review_note,
              m.created_at,
              r.provider_transaction_reference AS row_provider_tx_ref,
              r.platform_reference AS row_platform_ref,
              r.payment_reference AS row_payment_ref,
              r.nip_session_id AS row_nip_session_id,
              r.masked_counterparty_account,
              r.masked_destination_account
         FROM settlement_transaction_matches m
         LEFT JOIN settlement_report_rows r ON r.id = m.report_row_id
         LEFT JOIN financial_institutions fi ON fi.id = m.institution_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY (m.match_status <> 'MATCHED') DESC, m.created_at DESC
        LIMIT 300`,
      params,
    );

    return { items: rows.map((r) => this.mapTransactionMatchRow(r)) };
  }

  private mapTransactionMatchRow(r: Record<string, unknown>) {
    return {
      id: String(r.id),
      scope: String(r.scope),
      institutionId: (r.institution_id as string | null) ?? null,
      institutionCode: (r.institution_code as string | null) ?? null,
      providerKey: String(r.provider_key),
      reportType: String(r.report_type),
      importId: String(r.import_id),
      reportRowId: (r.report_row_id as string | null) ?? null,
      direction: String(r.direction),
      matchStatus: String(r.match_status) as TransactionMatchStatus,
      matchedKeys: Array.isArray(r.matched_keys) ? (r.matched_keys as string[]) : [],
      explanation: String(r.explanation),
      currency: String(r.currency),
      providerReference:
        (r.row_provider_tx_ref as string | null) ??
        (r.internal_provider_reference as string | null) ??
        null,
      providerPlatformReference: (r.row_platform_ref as string | null) ?? null,
      providerPaymentReference: (r.row_payment_ref as string | null) ?? null,
      nipSessionId: (r.row_nip_session_id as string | null) ?? null,
      maskedAccount:
        (r.masked_destination_account as string | null) ??
        (r.masked_counterparty_account as string | null) ??
        null,
      providerGrossMinor: (r.provider_gross_minor as string | null) ?? null,
      providerFeeMinor: (r.provider_fee_minor as string | null) ?? null,
      providerNetMinor: (r.provider_net_minor as string | null) ?? null,
      providerStatus: (r.provider_status as string | null) ?? null,
      providerOccurredAt: r.provider_occurred_at
        ? (r.provider_occurred_at as Date).toISOString()
        : null,
      internalSourceType: (r.internal_source_type as string | null) ?? null,
      internalSourceId: (r.internal_source_id as string | null) ?? null,
      internalBusinessReference: (r.internal_business_reference as string | null) ?? null,
      internalProviderReference: (r.internal_provider_reference as string | null) ?? null,
      internalGrossMinor: (r.internal_gross_minor as string | null) ?? null,
      internalProviderFeeMinor: (r.internal_provider_fee_minor as string | null) ?? null,
      internalNetMinor: (r.internal_net_minor as string | null) ?? null,
      internalPlatformFeeMinor: (r.internal_platform_fee_minor as string | null) ?? null,
      internalCustomerCreditMinor: (r.internal_customer_credit_minor as string | null) ?? null,
      internalStatus: (r.internal_status as string | null) ?? null,
      internalOccurredAt: r.internal_occurred_at
        ? (r.internal_occurred_at as Date).toISOString()
        : null,
      internalTransactionHistoryPath:
        (r.internal_transaction_history_path as string | null) ?? null,
      internalJournalIds: Array.isArray(r.internal_journal_ids)
        ? (r.internal_journal_ids as string[])
        : [],
      varianceMinor: String(r.variance_minor),
      feeVarianceMinor: String(r.fee_variance_minor),
      ambiguousCandidates: Array.isArray(r.ambiguous_candidates)
        ? (r.ambiguous_candidates as AmbiguousMatchCandidate[])
        : [],
      reviewState: String(r.review_state) as ReconciliationReviewState,
      proposedDecision: (r.proposed_decision as string | null) ?? null,
      selectedCandidateId: (r.selected_candidate_id as string | null) ?? null,
      linkedJournalId: (r.linked_journal_id as string | null) ?? null,
      proposedNote: (r.proposed_note as string | null) ?? null,
      proposedBy: (r.proposed_by as string | null) ?? null,
      proposedAt: r.proposed_at ? (r.proposed_at as Date).toISOString() : null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: r.reviewed_at ? (r.reviewed_at as Date).toISOString() : null,
      reviewNote: (r.review_note as string | null) ?? null,
    };
  }

  async getTransactionMatchDetail(principal: AuthorizationPrincipal, matchId: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT m.*,
              m.id::text AS id,
              m.institution_id::text AS institution_id,
              m.import_id::text AS import_id,
              m.report_row_id::text AS report_row_id,
              m.internal_source_id::text AS internal_source_id,
              m.selected_candidate_id::text AS selected_candidate_id,
              m.linked_journal_id::text AS linked_journal_id,
              m.provider_gross_minor::text AS provider_gross_minor,
              m.provider_fee_minor::text AS provider_fee_minor,
              m.provider_net_minor::text AS provider_net_minor,
              m.internal_gross_minor::text AS internal_gross_minor,
              m.internal_provider_fee_minor::text AS internal_provider_fee_minor,
              m.internal_net_minor::text AS internal_net_minor,
              m.internal_platform_fee_minor::text AS internal_platform_fee_minor,
              m.internal_customer_credit_minor::text AS internal_customer_credit_minor,
              m.variance_minor::text AS variance_minor,
              m.fee_variance_minor::text AS fee_variance_minor,
              fi.code AS institution_code,
              r.provider_transaction_reference AS row_provider_tx_ref,
              r.platform_reference AS row_platform_ref,
              r.payment_reference AS row_payment_ref,
              r.nip_session_id AS row_nip_session_id,
              r.masked_counterparty_account,
              r.masked_destination_account
         FROM settlement_transaction_matches m
         LEFT JOIN settlement_report_rows r ON r.id = m.report_row_id
         LEFT JOIN financial_institutions fi ON fi.id = m.institution_id
        WHERE m.id = $1::uuid`,
      [matchId],
    );
    const row = rows[0];
    if (
      !row ||
      !(await this.isRecordVisible(principal, (row.institution_id as string | null) ?? null))
    ) {
      throw new NotFoundException('Transaction match not found');
    }
    return this.mapTransactionMatchRow(row);
  }

  async proposeTransactionMatchResolution(
    principal: AuthorizationPrincipal,
    matchId: string,
    dto: ProposeTransactionMatchResolutionDto,
  ) {
    this.requireMaker(principal);
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string | null;
          match_status: string;
          ambiguous_candidates: AmbiguousMatchCandidate[];
          review_state: string;
        }>
      >(
        `SELECT id::text AS id,
                institution_id::text AS institution_id,
                match_status,
                ambiguous_candidates,
                review_state
           FROM settlement_transaction_matches
          WHERE id = $1::uuid
          FOR UPDATE`,
        [matchId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Transaction match not found');
      }
      if (row.match_status === 'MATCHED') {
        throw new ConflictException('Already matched rows do not require exception resolution');
      }
      if (row.review_state === 'APPROVED') {
        throw new ConflictException('Approved reconciliation resolutions are final');
      }

      if (dto.decision === 'SELECT_CANDIDATE') {
        if (!dto.selectedCandidateId) {
          throw new BadRequestException('selectedCandidateId is required for SELECT_CANDIDATE');
        }
        const candidateExists = (row.ambiguous_candidates ?? []).some(
          (c) => c.sourceId === dto.selectedCandidateId,
        );
        if (!candidateExists) {
          throw new BadRequestException(
            'selectedCandidateId must be one of the recorded ambiguous candidates on this row',
          );
        }
      }

      if (dto.linkedJournalId) {
        await this.assertJournalVisibleInScope(manager, dto.linkedJournalId, row.institution_id);
      }

      await manager.query(
        `UPDATE settlement_transaction_matches
            SET review_state = 'PROPOSED',
                proposed_decision = $2,
                selected_candidate_id = $3::uuid,
                linked_journal_id = $4::uuid,
                proposed_note = $5,
                proposed_by = $6,
                proposed_at = clock_timestamp(),
                reviewed_by = NULL,
                reviewed_at = NULL,
                review_note = NULL,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          matchId,
          dto.decision,
          dto.selectedCandidateId ?? null,
          dto.linkedJournalId ?? null,
          dto.note,
          principal.principalId,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_TRANSACTION_MATCH',
        entityId: matchId,
        action: 'SETTLEMENT_TRANSACTION_RESOLUTION_PROPOSED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          selectedCandidateId: dto.selectedCandidateId ?? null,
          linkedJournalId: dto.linkedJournalId ?? null,
          note: dto.note,
        },
      });
    });

    return this.getTransactionMatchDetail(principal, matchId);
  }

  async reviewTransactionMatchResolution(
    principal: AuthorizationPrincipal,
    matchId: string,
    dto: ReviewReconciliationProposalDto,
  ) {
    this.requireChecker(principal);
    const approve = dto.decision === 'APPROVE';

    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string | null;
          review_state: string;
          proposed_by: string | null;
          proposed_decision: string | null;
          selected_candidate_id: string | null;
          ambiguous_candidates: AmbiguousMatchCandidate[];
        }>
      >(
        `SELECT id::text AS id,
                institution_id::text AS institution_id,
                review_state,
                proposed_by,
                proposed_decision,
                selected_candidate_id::text AS selected_candidate_id,
                ambiguous_candidates
           FROM settlement_transaction_matches
          WHERE id = $1::uuid
          FOR UPDATE`,
        [matchId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Transaction match not found');
      }
      if (row.review_state !== 'PROPOSED') {
        throw new ConflictException('Only a PROPOSED resolution can be reviewed');
      }
      if (row.proposed_by === principal.principalId) {
        throw new ForbiddenException(
          'Separation of duties: the checker cannot review their own reconciliation proposal',
        );
      }

      const chosenCand =
        approve && row.proposed_decision === 'SELECT_CANDIDATE' && row.selected_candidate_id
          ? ((row.ambiguous_candidates ?? []).find(
              (c) => c.sourceId === row.selected_candidate_id,
            ) ?? null)
          : null;

      await manager.query(
        `UPDATE settlement_transaction_matches
            SET review_state = $2,
                reviewed_by = $3,
                reviewed_at = clock_timestamp(),
                review_note = $4,
                internal_source_type = COALESCE($5, internal_source_type),
                internal_source_id = COALESCE($6::uuid, internal_source_id),
                internal_business_reference = COALESCE($7, internal_business_reference),
                internal_provider_reference = COALESCE($8, internal_provider_reference),
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          matchId,
          approve ? 'APPROVED' : 'REJECTED',
          principal.principalId,
          dto.note,
          chosenCand?.sourceType ?? null,
          chosenCand?.sourceId ?? null,
          chosenCand?.businessReference ?? null,
          chosenCand?.providerReference ?? null,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_TRANSACTION_MATCH',
        entityId: matchId,
        action: approve
          ? 'SETTLEMENT_TRANSACTION_RESOLUTION_APPROVED'
          : 'SETTLEMENT_TRANSACTION_RESOLUTION_REJECTED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          proposedDecision: row.proposed_decision,
          note: dto.note,
        },
      });
    });

    return this.getTransactionMatchDetail(principal, matchId);
  }

  // ------------------------------------------------ Settlement Batches API

  async listSettlementBatches(
    principal: AuthorizationPrincipal,
    query: ListSettlementReconciliationQueryDto,
  ) {
    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(
      this.dataSource,
      principal,
      query.institutionId,
      'b',
      params,
    );
    if (filter.emptyShortCircuit) return { items: [] };

    const clauses = [filter.clause];
    if (query.status) {
      if (query.status === 'OPEN_BREAKS') {
        clauses.push(`b.batch_status <> 'RECONCILED' AND b.review_state <> 'APPROVED'`);
      } else if (query.status === 'PENDING_REVIEW') {
        clauses.push(`b.review_state = 'PROPOSED'`);
      } else {
        params.push(query.status);
        clauses.push(`b.batch_status = $${params.length}`);
      }
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      clauses.push(
        `(b.settlement_reference ILIKE $${params.length} OR COALESCE(b.payout_reference, '') ILIKE $${params.length})`,
      );
    }

    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT b.*,
              b.id::text AS id,
              b.institution_id::text AS institution_id,
              b.settlement_row_id::text AS settlement_row_id,
              b.statement_row_id::text AS statement_row_id,
              b.linked_journal_id::text AS linked_journal_id,
              b.linked_comparison_id::text AS linked_comparison_id,
              b.gross_collections_minor::text AS gross_collections_minor,
              b.provider_fee_total_minor::text AS provider_fee_total_minor,
              b.expected_net_settlement_minor::text AS expected_net_settlement_minor,
              b.platform_fee_total_minor::text AS platform_fee_total_minor,
              b.customer_wallet_credit_total_minor::text AS customer_wallet_credit_total_minor,
              b.reported_net_settlement_minor::text AS reported_net_settlement_minor,
              b.statement_credit_minor::text AS statement_credit_minor,
              b.variance_minor::text AS variance_minor,
              fi.code AS institution_code
         FROM settlement_batch_reconciliations b
         LEFT JOIN financial_institutions fi ON fi.id = b.institution_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY (b.batch_status <> 'RECONCILED') DESC, COALESCE(b.settled_at, b.created_at) DESC
        LIMIT 200`,
      params,
    );

    return { items: rows.map((r) => this.mapSettlementBatchRow(r)) };
  }

  private mapSettlementBatchRow(r: Record<string, unknown>) {
    return {
      id: String(r.id),
      scope: String(r.scope),
      institutionId: (r.institution_id as string | null) ?? null,
      institutionCode: (r.institution_code as string | null) ?? null,
      providerKey: String(r.provider_key),
      settlementReference: String(r.settlement_reference),
      payoutReference: (r.payout_reference as string | null) ?? null,
      settlementRowId: (r.settlement_row_id as string | null) ?? null,
      statementRowId: (r.statement_row_id as string | null) ?? null,
      statementDestination: String(r.statement_destination) as StatementDestination,
      maskedDestinationAccount: (r.masked_destination_account as string | null) ?? null,
      currency: String(r.currency),
      grossCollectionsMinor: String(r.gross_collections_minor),
      providerFeeTotalMinor: String(r.provider_fee_total_minor),
      expectedNetSettlementMinor: String(r.expected_net_settlement_minor),
      platformFeeTotalMinor: String(r.platform_fee_total_minor),
      customerWalletCreditTotalMinor: String(r.customer_wallet_credit_total_minor),
      reportedNetSettlementMinor: String(r.reported_net_settlement_minor),
      statementCreditMinor: (r.statement_credit_minor as string | null) ?? null,
      varianceMinor: String(r.variance_minor),
      matchedCollectionCount: Number(r.matched_collection_count),
      missingCollectionCount: Number(r.missing_collection_count),
      settledAt: r.settled_at ? (r.settled_at as Date).toISOString() : null,
      batchStatus: String(r.batch_status) as SettlementBatchStatus,
      explanation: String(r.explanation),
      reviewState: String(r.review_state) as ReconciliationReviewState,
      proposedDecision: (r.proposed_decision as string | null) ?? null,
      linkedJournalId: (r.linked_journal_id as string | null) ?? null,
      linkedComparisonId: (r.linked_comparison_id as string | null) ?? null,
      proposedNote: (r.proposed_note as string | null) ?? null,
      proposedBy: (r.proposed_by as string | null) ?? null,
      proposedAt: r.proposed_at ? (r.proposed_at as Date).toISOString() : null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: r.reviewed_at ? (r.reviewed_at as Date).toISOString() : null,
      reviewNote: (r.review_note as string | null) ?? null,
    };
  }

  async getSettlementBatchDetail(principal: AuthorizationPrincipal, batchId: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT b.*,
              b.id::text AS id,
              b.institution_id::text AS institution_id,
              b.settlement_row_id::text AS settlement_row_id,
              b.statement_row_id::text AS statement_row_id,
              b.linked_journal_id::text AS linked_journal_id,
              b.linked_comparison_id::text AS linked_comparison_id,
              b.gross_collections_minor::text AS gross_collections_minor,
              b.provider_fee_total_minor::text AS provider_fee_total_minor,
              b.expected_net_settlement_minor::text AS expected_net_settlement_minor,
              b.platform_fee_total_minor::text AS platform_fee_total_minor,
              b.customer_wallet_credit_total_minor::text AS customer_wallet_credit_total_minor,
              b.reported_net_settlement_minor::text AS reported_net_settlement_minor,
              b.statement_credit_minor::text AS statement_credit_minor,
              b.variance_minor::text AS variance_minor,
              fi.code AS institution_code,
              sr.underlying_items
         FROM settlement_batch_reconciliations b
         LEFT JOIN financial_institutions fi ON fi.id = b.institution_id
         LEFT JOIN settlement_report_rows sr ON sr.id = b.settlement_row_id
        WHERE b.id = $1::uuid`,
      [batchId],
    );
    const row = rows[0];
    if (
      !row ||
      !(await this.isRecordVisible(principal, (row.institution_id as string | null) ?? null))
    ) {
      throw new NotFoundException('Settlement batch reconciliation not found');
    }

    // Load candidate statement credit rows in scope for human selection when STATEMENT_UNMATCHED or AMBIGUOUS
    const candidateStatementCredits = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT r.id::text AS id,
              i.report_type,
              r.provider_transaction_reference,
              r.settlement_reference,
              r.payout_reference,
              r.net_amount_minor::text AS net_amount_minor,
              r.occurred_at,
              r.masked_destination_account,
              r.narration
         FROM settlement_report_rows r
         JOIN settlement_report_imports i ON i.id = r.import_id
        WHERE COALESCE(i.institution_id, $1::uuid) = COALESCE($2::uuid, $1::uuid)
          AND i.report_type IN ('WALLET_STATEMENT', 'BANK_STATEMENT')
          AND r.direction = 'STATEMENT_CREDIT'
          AND r.currency = $3
        ORDER BY r.occurred_at DESC NULLS LAST
        LIMIT 30`,
      [ZERO_UUID, row.institution_id ?? null, row.currency],
    );

    return {
      ...this.mapSettlementBatchRow(row),
      underlyingItems: Array.isArray(row.underlying_items) ? row.underlying_items : [],
      candidateStatementCredits: candidateStatementCredits.map((c) => ({
        id: String(c.id),
        reportType: String(c.report_type),
        reference: (c.provider_transaction_reference as string | null) ?? null,
        settlementReference: (c.settlement_reference as string | null) ?? null,
        payoutReference: (c.payout_reference as string | null) ?? null,
        amountMinor: String(c.net_amount_minor),
        occurredAt: c.occurred_at ? (c.occurred_at as Date).toISOString() : null,
        maskedAccount: (c.masked_destination_account as string | null) ?? null,
        narration: (c.narration as string | null) ?? null,
      })),
    };
  }

  async proposeSettlementBatchResolution(
    principal: AuthorizationPrincipal,
    batchId: string,
    dto: ProposeSettlementMatchResolutionDto,
  ) {
    this.requireMaker(principal);
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string | null;
          review_state: string;
          currency: string;
        }>
      >(
        `SELECT id::text AS id,
                institution_id::text AS institution_id,
                review_state,
                currency
           FROM settlement_batch_reconciliations
          WHERE id = $1::uuid
          FOR UPDATE`,
        [batchId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Settlement batch reconciliation not found');
      }
      if (row.review_state === 'APPROVED') {
        throw new ConflictException('Approved settlement batch resolutions are final');
      }

      if (dto.decision === 'LINK_STATEMENT_ENTRY' && !dto.linkedStatementRowId) {
        throw new BadRequestException('linkedStatementRowId is required for LINK_STATEMENT_ENTRY');
      }
      if (dto.linkedStatementRowId) {
        const stRows = await manager.query<Array<{ id: string }>>(
          `SELECT r.id::text AS id
             FROM settlement_report_rows r
             JOIN settlement_report_imports i ON i.id = r.import_id
            WHERE r.id = $1::uuid
              AND COALESCE(i.institution_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)
              AND r.direction = 'STATEMENT_CREDIT'`,
          [dto.linkedStatementRowId, ZERO_UUID, row.institution_id],
        );
        if (!stRows[0]) {
          throw new NotFoundException('Statement credit row not found in this institution scope');
        }
      }

      if (dto.linkedJournalId) {
        await this.assertJournalVisibleInScope(manager, dto.linkedJournalId, row.institution_id);
      }
      if (dto.linkedComparisonId) {
        const compRows = await manager.query<Array<{ id: string }>>(
          `SELECT id::text AS id
             FROM platform_funds_comparisons
            WHERE id = $1::uuid
              AND COALESCE(institution_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)`,
          [dto.linkedComparisonId, ZERO_UUID, row.institution_id],
        );
        if (!compRows[0]) {
          throw new NotFoundException('Platform Funds comparison not found in this scope');
        }
      }

      await manager.query(
        `UPDATE settlement_batch_reconciliations
            SET review_state = 'PROPOSED',
                proposed_decision = $2,
                statement_row_id = COALESCE($3::uuid, statement_row_id),
                linked_journal_id = $4::uuid,
                linked_comparison_id = $5::uuid,
                proposed_note = $6,
                proposed_by = $7,
                proposed_at = clock_timestamp(),
                reviewed_by = NULL,
                reviewed_at = NULL,
                review_note = NULL,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          batchId,
          dto.decision,
          dto.linkedStatementRowId ?? null,
          dto.linkedJournalId ?? null,
          dto.linkedComparisonId ?? null,
          dto.note,
          principal.principalId,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_BATCH_RECONCILIATION',
        entityId: batchId,
        action: 'SETTLEMENT_BATCH_RESOLUTION_PROPOSED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          linkedStatementRowId: dto.linkedStatementRowId ?? null,
          linkedJournalId: dto.linkedJournalId ?? null,
          linkedComparisonId: dto.linkedComparisonId ?? null,
          note: dto.note,
        },
      });
    });

    return this.getSettlementBatchDetail(principal, batchId);
  }

  async reviewSettlementBatchResolution(
    principal: AuthorizationPrincipal,
    batchId: string,
    dto: ReviewReconciliationProposalDto,
  ) {
    this.requireChecker(principal);
    const approve = dto.decision === 'APPROVE';

    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string | null;
          review_state: string;
          proposed_by: string | null;
          proposed_decision: string | null;
          statement_row_id: string | null;
          reported_net_settlement_minor: string;
          statement_amount_minor: string | null;
        }>
      >(
        `SELECT b.id::text AS id,
                b.institution_id::text AS institution_id,
                b.review_state,
                b.proposed_by,
                b.proposed_decision,
                b.statement_row_id::text AS statement_row_id,
                b.reported_net_settlement_minor::text AS reported_net_settlement_minor,
                sr.net_amount_minor::text AS statement_amount_minor
           FROM settlement_batch_reconciliations b
           LEFT JOIN settlement_report_rows sr ON sr.id = b.statement_row_id
          WHERE b.id = $1::uuid
          FOR UPDATE OF b`,
        [batchId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Settlement batch reconciliation not found');
      }
      if (row.review_state !== 'PROPOSED') {
        throw new ConflictException('Only a PROPOSED settlement batch resolution can be reviewed');
      }
      if (row.proposed_by === principal.principalId) {
        throw new ForbiddenException(
          'Separation of duties: the checker cannot review their own settlement batch proposal',
        );
      }

      const markReconciled =
        approve &&
        ['CONFIRM_RECONCILED', 'LINK_STATEMENT_ENTRY'].includes(row.proposed_decision ?? '');

      await manager.query(
        `UPDATE settlement_batch_reconciliations
            SET review_state = $2,
                reviewed_by = $3,
                reviewed_at = clock_timestamp(),
                review_note = $4,
                statement_credit_minor = COALESCE($5::numeric, statement_credit_minor),
                batch_status = CASE WHEN $6::boolean THEN 'RECONCILED' ELSE batch_status END,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          batchId,
          approve ? 'APPROVED' : 'REJECTED',
          principal.principalId,
          dto.note,
          approve ? row.statement_amount_minor : null,
          markReconciled,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_BATCH_RECONCILIATION',
        entityId: batchId,
        action: approve
          ? 'SETTLEMENT_BATCH_RESOLUTION_APPROVED'
          : 'SETTLEMENT_BATCH_RESOLUTION_REJECTED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          proposedDecision: row.proposed_decision,
          note: dto.note,
        },
      });
    });

    return this.getSettlementBatchDetail(principal, batchId);
  }

  // ------------------------------------------------ Return & Dispute Cases API

  async listReturnDisputeCases(
    principal: AuthorizationPrincipal,
    query: ListSettlementReconciliationQueryDto,
  ) {
    await this.syncInternalReturnCandidates(this.dataSource, principal, query.institutionId);

    const params: unknown[] = [];
    const filter = await this.buildReadFilterSql(
      this.dataSource,
      principal,
      query.institutionId,
      'c',
      params,
    );
    if (filter.emptyShortCircuit) return { items: [] };

    const clauses = [filter.clause];
    if (query.status) {
      if (query.status === 'OPEN_CASES') {
        clauses.push(`c.lifecycle_status <> 'RECONCILED' AND c.review_state <> 'APPROVED'`);
      } else if (query.status === 'PENDING_REVIEW') {
        clauses.push(`c.review_state = 'PROPOSED'`);
      } else {
        params.push(query.status);
        clauses.push(`c.lifecycle_status = $${params.length}`);
      }
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      clauses.push(
        `(
          c.case_key ILIKE $${params.length}
          OR COALESCE(c.original_business_reference, '') ILIKE $${params.length}
          OR COALESCE(c.original_provider_reference, '') ILIKE $${params.length}
          OR COALESCE(c.return_or_dispute_reference, '') ILIKE $${params.length}
        )`,
      );
    }

    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT c.*,
              c.id::text AS id,
              c.institution_id::text AS institution_id,
              c.original_source_id::text AS original_source_id,
              c.provider_report_row_id::text AS provider_report_row_id,
              c.statement_row_id::text AS statement_row_id,
              c.linked_internal_dispute_id::text AS linked_internal_dispute_id,
              c.linked_reversal_journal_id::text AS linked_reversal_journal_id,
              c.original_gross_minor::text AS original_gross_minor,
              c.original_provider_fee_minor::text AS original_provider_fee_minor,
              c.original_net_minor::text AS original_net_minor,
              c.original_customer_credit_minor::text AS original_customer_credit_minor,
              c.event_amount_minor::text AS event_amount_minor,
              c.event_fee_minor::text AS event_fee_minor,
              c.variance_minor::text AS variance_minor,
              fi.code AS institution_code
         FROM settlement_return_dispute_cases c
         LEFT JOIN financial_institutions fi ON fi.id = c.institution_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY (c.lifecycle_status <> 'RECONCILED') DESC, c.updated_at DESC
        LIMIT 200`,
      params,
    );

    return { items: rows.map((r) => this.mapReturnDisputeCaseRow(r)) };
  }

  private mapReturnDisputeCaseRow(r: Record<string, unknown>) {
    return {
      id: String(r.id),
      caseKey: String(r.case_key),
      scope: String(r.scope),
      institutionId: (r.institution_id as string | null) ?? null,
      institutionCode: (r.institution_code as string | null) ?? null,
      providerKey: String(r.provider_key),
      caseKind: String(r.case_kind) as ReturnDisputeCaseKind,
      originalSourceType: (r.original_source_type as string | null) ?? null,
      originalSourceId: (r.original_source_id as string | null) ?? null,
      originalBusinessReference: (r.original_business_reference as string | null) ?? null,
      originalProviderReference: (r.original_provider_reference as string | null) ?? null,
      originalCurrency: String(r.original_currency),
      originalGrossMinor: (r.original_gross_minor as string | null) ?? null,
      originalProviderFeeMinor: (r.original_provider_fee_minor as string | null) ?? null,
      originalNetMinor: (r.original_net_minor as string | null) ?? null,
      originalCustomerCreditMinor: (r.original_customer_credit_minor as string | null) ?? null,
      originalInternalStatus: (r.original_internal_status as string | null) ?? null,
      originalOccurredAt: r.original_occurred_at
        ? (r.original_occurred_at as Date).toISOString()
        : null,
      originalJournalIds: Array.isArray(r.original_journal_ids)
        ? (r.original_journal_ids as string[])
        : [],
      returnOrDisputeReference: (r.return_or_dispute_reference as string | null) ?? null,
      eventAmountMinor: (r.event_amount_minor as string | null) ?? null,
      eventFeeMinor: String(r.event_fee_minor),
      providerEventStatus: (r.provider_event_status as string | null) ?? null,
      internalReturnStatus: (r.internal_return_status as string | null) ?? null,
      providerReportRowId: (r.provider_report_row_id as string | null) ?? null,
      statementRowId: (r.statement_row_id as string | null) ?? null,
      linkedInternalDisputeId: (r.linked_internal_dispute_id as string | null) ?? null,
      linkedReversalJournalId: (r.linked_reversal_journal_id as string | null) ?? null,
      lifecycleStatus: String(r.lifecycle_status) as ReturnDisputeLifecycleStatus,
      varianceMinor: String(r.variance_minor),
      explanation: String(r.explanation),
      reviewState: String(r.review_state) as ReconciliationReviewState,
      proposedDecision: (r.proposed_decision as string | null) ?? null,
      proposedNote: (r.proposed_note as string | null) ?? null,
      proposedBy: (r.proposed_by as string | null) ?? null,
      proposedAt: r.proposed_at ? (r.proposed_at as Date).toISOString() : null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: r.reviewed_at ? (r.reviewed_at as Date).toISOString() : null,
      reviewNote: (r.review_note as string | null) ?? null,
    };
  }

  async getReturnDisputeCaseDetail(principal: AuthorizationPrincipal, caseId: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT c.*,
              c.id::text AS id,
              c.institution_id::text AS institution_id,
              c.original_source_id::text AS original_source_id,
              c.provider_report_row_id::text AS provider_report_row_id,
              c.statement_row_id::text AS statement_row_id,
              c.linked_internal_dispute_id::text AS linked_internal_dispute_id,
              c.linked_reversal_journal_id::text AS linked_reversal_journal_id,
              c.original_gross_minor::text AS original_gross_minor,
              c.original_provider_fee_minor::text AS original_provider_fee_minor,
              c.original_net_minor::text AS original_net_minor,
              c.original_customer_credit_minor::text AS original_customer_credit_minor,
              c.event_amount_minor::text AS event_amount_minor,
              c.event_fee_minor::text AS event_fee_minor,
              c.variance_minor::text AS variance_minor,
              fi.code AS institution_code
         FROM settlement_return_dispute_cases c
         LEFT JOIN financial_institutions fi ON fi.id = c.institution_id
        WHERE c.id = $1::uuid`,
      [caseId],
    );
    const row = rows[0];
    if (
      !row ||
      !(await this.isRecordVisible(principal, (row.institution_id as string | null) ?? null))
    ) {
      throw new NotFoundException('Return/dispute reconciliation case not found');
    }

    const events = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT id::text AS id,
              event_source,
              event_type,
              status_label,
              amount_minor::text AS amount_minor,
              fee_minor::text AS fee_minor,
              reference,
              actor,
              detail,
              occurred_at,
              recorded_at
         FROM settlement_return_dispute_events
        WHERE case_id = $1::uuid
        ORDER BY occurred_at ASC, recorded_at ASC`,
      [caseId],
    );

    return {
      ...this.mapReturnDisputeCaseRow(row),
      events: events.map((e) => ({
        id: String(e.id),
        eventSource: String(e.event_source),
        eventType: String(e.event_type),
        statusLabel: String(e.status_label),
        amountMinor: (e.amount_minor as string | null) ?? null,
        feeMinor: (e.fee_minor as string | null) ?? null,
        reference: (e.reference as string | null) ?? null,
        actor: (e.actor as string | null) ?? null,
        detail: String(e.detail),
        occurredAt: (e.occurred_at as Date).toISOString(),
        recordedAt: (e.recorded_at as Date).toISOString(),
      })),
    };
  }

  async proposeReturnDisputeResolution(
    principal: AuthorizationPrincipal,
    caseId: string,
    dto: ProposeReturnDisputeResolutionDto,
  ) {
    this.requireMaker(principal);
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{ id: string; institution_id: string | null; review_state: string }>
      >(
        `SELECT id::text AS id,
                institution_id::text AS institution_id,
                review_state
           FROM settlement_return_dispute_cases
          WHERE id = $1::uuid
          FOR UPDATE`,
        [caseId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Return/dispute reconciliation case not found');
      }
      if (row.review_state === 'APPROVED') {
        throw new ConflictException('Approved return/dispute resolutions are final');
      }

      if (dto.decision === 'LINK_REVERSAL_JOURNAL' && !dto.linkedJournalId) {
        throw new BadRequestException('linkedJournalId is required for LINK_REVERSAL_JOURNAL');
      }
      if (dto.linkedJournalId) {
        await this.assertJournalVisibleInScope(manager, dto.linkedJournalId, row.institution_id);
      }

      if (dto.decision === 'LINK_INTERNAL_DISPUTE' && !dto.linkedInternalDisputeId) {
        throw new BadRequestException(
          'linkedInternalDisputeId is required for LINK_INTERNAL_DISPUTE',
        );
      }
      if (dto.linkedInternalDisputeId) {
        const disp = await manager.query<Array<{ id: string }>>(
          `SELECT td.id::text AS id
             FROM transaction_disputes td
            WHERE td.id = $1::uuid
              AND (
                $2::uuid IS NULL
                OR EXISTS (
                  SELECT 1 FROM customer_institution_enrolments cie
                   WHERE cie.customer_id = td.customer_id
                     AND cie.institution_id = $2::uuid
                )
              )`,
          [dto.linkedInternalDisputeId, row.institution_id],
        );
        if (!disp[0]) {
          throw new NotFoundException('Customer dispute record not found in this scope');
        }
      }

      await manager.query(
        `UPDATE settlement_return_dispute_cases
            SET review_state = 'PROPOSED',
                proposed_decision = $2,
                linked_reversal_journal_id = COALESCE($3::uuid, linked_reversal_journal_id),
                linked_internal_dispute_id = COALESCE($4::uuid, linked_internal_dispute_id),
                proposed_note = $5,
                proposed_by = $6,
                proposed_at = clock_timestamp(),
                reviewed_by = NULL,
                reviewed_at = NULL,
                review_note = NULL,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          caseId,
          dto.decision,
          dto.linkedJournalId ?? null,
          dto.linkedInternalDisputeId ?? null,
          dto.note,
          principal.principalId,
        ],
      );

      const fp = eventFingerprint([
        'FINANCE_PREPARER',
        principal.principalId,
        dto.decision,
        dto.note,
        String(Date.now()),
      ]);
      await manager.query(
        `INSERT INTO settlement_return_dispute_events (
           case_id, event_source, event_type, status_label, amount_minor, fee_minor,
           reference, actor, detail, event_fingerprint
         )
         VALUES ($1::uuid, 'FINANCE_PREPARER', 'RESOLUTION_PROPOSED', $2, NULL, NULL, $3, $4, $5, $6)`,
        [
          caseId,
          dto.decision,
          dto.linkedJournalId ?? dto.linkedInternalDisputeId ?? null,
          principal.principalId,
          dto.note.slice(0, 600),
          fp,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_RETURN_DISPUTE_CASE',
        entityId: caseId,
        action: 'SETTLEMENT_RETURN_DISPUTE_RESOLUTION_PROPOSED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          linkedJournalId: dto.linkedJournalId ?? null,
          linkedInternalDisputeId: dto.linkedInternalDisputeId ?? null,
          note: dto.note,
        },
      });
    });

    return this.getReturnDisputeCaseDetail(principal, caseId);
  }

  async reviewReturnDisputeResolution(
    principal: AuthorizationPrincipal,
    caseId: string,
    dto: ReviewReconciliationProposalDto,
  ) {
    this.requireChecker(principal);
    const approve = dto.decision === 'APPROVE';

    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          institution_id: string | null;
          review_state: string;
          proposed_by: string | null;
          proposed_decision: string | null;
        }>
      >(
        `SELECT id::text AS id,
                institution_id::text AS institution_id,
                review_state,
                proposed_by,
                proposed_decision
           FROM settlement_return_dispute_cases
          WHERE id = $1::uuid
          FOR UPDATE`,
        [caseId],
      );
      const row = rows[0];
      if (!row || !(await this.isRecordVisible(principal, row.institution_id))) {
        throw new NotFoundException('Return/dispute reconciliation case not found');
      }
      if (row.review_state !== 'PROPOSED') {
        throw new ConflictException('Only a PROPOSED return/dispute resolution can be reviewed');
      }
      if (row.proposed_by === principal.principalId) {
        throw new ForbiddenException(
          'Separation of duties: the checker cannot review their own return/dispute proposal',
        );
      }

      const markReconciled =
        approve &&
        ['CONFIRM_RECONCILED', 'LINK_REVERSAL_JOURNAL'].includes(row.proposed_decision ?? '');

      await manager.query(
        `UPDATE settlement_return_dispute_cases
            SET review_state = $2,
                reviewed_by = $3,
                reviewed_at = clock_timestamp(),
                review_note = $4,
                lifecycle_status = CASE WHEN $5::boolean THEN 'RECONCILED' ELSE lifecycle_status END,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid`,
        [
          caseId,
          approve ? 'APPROVED' : 'REJECTED',
          principal.principalId,
          dto.note,
          markReconciled,
        ],
      );

      const fp = eventFingerprint([
        'FINANCE_CONTROLLER',
        principal.principalId,
        dto.decision,
        dto.note,
        String(Date.now()),
      ]);
      await manager.query(
        `INSERT INTO settlement_return_dispute_events (
           case_id, event_source, event_type, status_label, amount_minor, fee_minor,
           reference, actor, detail, event_fingerprint
         )
         VALUES ($1::uuid, 'FINANCE_CONTROLLER', $2, $3, NULL, NULL, NULL, $4, $5, $6)`,
        [
          caseId,
          approve ? 'RESOLUTION_APPROVED' : 'RESOLUTION_REJECTED',
          approve ? 'APPROVED' : 'REJECTED',
          principal.principalId,
          dto.note.slice(0, 600),
          fp,
        ],
      );

      await this.audit.record(manager, {
        entityType: 'SETTLEMENT_RETURN_DISPUTE_CASE',
        entityId: caseId,
        action: approve
          ? 'SETTLEMENT_RETURN_DISPUTE_RESOLUTION_APPROVED'
          : 'SETTLEMENT_RETURN_DISPUTE_RESOLUTION_REJECTED',
        actor: principal.principalId,
        newValues: {
          decision: dto.decision,
          proposedDecision: row.proposed_decision,
          note: dto.note,
        },
      });
    });

    return this.getReturnDisputeCaseDetail(principal, caseId);
  }
}
