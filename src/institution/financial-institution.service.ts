import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import {
  FinancialInstitutionStatus,
  FinancialInstitutionType,
  INSTITUTION_LIFECYCLE_ACTION,
  INSTITUTION_LIFECYCLE_RESOURCE,
} from './institution.enums';
import type {
  ExecuteInstitutionLifecycleCommand,
  FinancialInstitutionView,
  RecordRegulatoryEvidenceCommand,
  RegisterInstitutionCommand,
  RequestInstitutionLifecycleCommand,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTION = INSTITUTION_LIFECYCLE_ACTION;
const RESOURCE = INSTITUTION_LIFECYCLE_RESOURCE;

const ALLOWED_TRANSITIONS: Record<string, FinancialInstitutionStatus[]> = {
  REGISTERED: [FinancialInstitutionStatus.EVIDENCE_SUBMITTED, FinancialInstitutionStatus.CLOSED],
  EVIDENCE_SUBMITTED: [FinancialInstitutionStatus.APPROVED, FinancialInstitutionStatus.CLOSED],
  APPROVED: [FinancialInstitutionStatus.SUSPENDED, FinancialInstitutionStatus.CLOSED],
  SUSPENDED: [FinancialInstitutionStatus.APPROVED, FinancialInstitutionStatus.CLOSED],
  CLOSED: [],
};

interface InstitutionRow {
  id: string;
  reference: string;
  code: string;
  legal_name: string;
  display_name: string | null;
  institution_type: string;
  regulator_name: string | null;
  licence_reference: string | null;
  evidence_reference: string | null;
  evidence_digest: string | null;
  status: FinancialInstitutionStatus;
  status_reason: string | null;
  operational_approved_at: Date | null;
  suspended_at: Date | null;
  closed_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Deterministic binding of a lifecycle request to the state the checker will act on. */
export function institutionLifecycleFingerprint(input: {
  institutionId: string;
  targetStatus: string;
  currentStatus: string;
  reason: string;
}): string {
  return governedChangeFingerprint(ACTION, RESOURCE, input.institutionId, {
    targetStatus: input.targetStatus,
    currentStatus: input.currentStatus,
    reason: input.reason,
  });
}

/**
 * Financial institution registration and governed operational lifecycle.
 *
 * Registration is administrative and confers no authority. Regulatory evidence is recorded for
 * verification. `APPROVED` (and therefore any financial authority) can only be reached through a
 * consumed, independently approved `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` request — the database
 * trigger refuses the transition otherwise, so no code path, fixture or direct SQL statement can
 * activate an institution from a licence reference alone.
 */
@Injectable()
export class FinancialInstitutionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auditService: AuditService,
  ) {}

  async register(command: RegisterInstitutionCommand): Promise<FinancialInstitutionView> {
    const reference = this.requiredToken(command.reference, 'reference', 80);
    const code = this.requiredToken(command.code, 'code', 40).toUpperCase();
    const legalName = this.requiredText(command.legalName, 'legalName', 320);
    if (!Object.values(FinancialInstitutionType).includes(command.institutionType)) {
      throw new BadRequestException('institutionType is not registered');
    }
    const displayName = this.optionalText(command.displayName, 'displayName', 160);
    const regulatorName = this.optionalText(command.regulatorName, 'regulatorName', 160);
    const licenceReference = this.optionalText(command.licenceReference, 'licenceReference', 160);

    return this.dataSource.transaction(async (manager) => {
      const existing: Array<{ id: string }> = await manager.query(
        `SELECT id FROM financial_institutions
          WHERE deleted_at IS NULL AND (lower(reference)=lower($1) OR code=$2) LIMIT 1`,
        [reference, code],
      );
      if (existing.length > 0) {
        throw new ConflictException('Institution reference or code already exists');
      }
      const rows: Array<InstitutionRow> = await manager.query(
        `INSERT INTO financial_institutions
           (reference, code, legal_name, display_name, institution_type, regulator_name,
            licence_reference, licence_reference_recorded_at, licence_reference_recorded_by,
            status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 CASE WHEN $7::varchar IS NULL THEN NULL ELSE clock_timestamp() END,
                 CASE WHEN $7::varchar IS NULL THEN NULL ELSE $8 END,
                 'REGISTERED', $8, $8)
         RETURNING *`,
        [
          reference,
          code,
          legalName,
          displayName,
          command.institutionType,
          regulatorName,
          licenceReference,
          command.principal.principalId,
        ],
      );
      const institution = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'FINANCIAL_INSTITUTION',
        entityId: institution.id,
        action: 'FINANCIAL_INSTITUTION_REGISTERED',
        actor: command.principal.principalId,
        newValues: {
          reference,
          code,
          legalName,
          institutionType: command.institutionType,
          status: 'REGISTERED',
          licenceReference,
          regulatorName,
        },
      });
      return this.toView(institution);
    });
  }

  /**
   * Records regulatory evidence for verification. This is administrative and explicitly does NOT
   * grant authority: the institution stays unusable for financial services until an operational
   * approval is consumed.
   */
  async recordRegulatoryEvidence(
    command: RecordRegulatoryEvidenceCommand,
  ): Promise<FinancialInstitutionView> {
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    const evidenceReference = this.requiredText(
      command.evidenceReference,
      'evidenceReference',
      160,
    );
    const digest = command.evidenceDigest
      ? this.hexDigest(command.evidenceDigest, 'evidenceDigest')
      : this.computeEvidenceDigest(institutionId, evidenceReference);
    const regulatorName = this.optionalText(command.regulatorName, 'regulatorName', 160);
    const licenceReference = this.optionalText(command.licenceReference, 'licenceReference', 160);

    return this.dataSource.transaction(async (manager) => {
      const rows: Array<InstitutionRow> = await manager.query(
        `WITH changed AS (
         UPDATE financial_institutions
            SET status = 'EVIDENCE_SUBMITTED',
                evidence_reference = $2,
                evidence_digest = $3,
                evidence_recorded_at = clock_timestamp(),
                evidence_recorded_by = $4,
                regulator_name = COALESCE($5, regulator_name),
                licence_reference = COALESCE($6, licence_reference),
                licence_reference_recorded_at = COALESCE(licence_reference_recorded_at, clock_timestamp()),
                licence_reference_recorded_by = COALESCE(licence_reference_recorded_by, $4),
                updated_by = $4,
                updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'REGISTERED'
          RETURNING *
         ) SELECT * FROM changed`,
        [
          institutionId,
          evidenceReference,
          digest,
          command.principal.principalId,
          regulatorName,
          licenceReference,
        ],
      );
      if (rows.length !== 1) {
        const existing: Array<{ status: FinancialInstitutionStatus }> = await manager.query(
          `SELECT status FROM financial_institutions WHERE id=$1`,
          [institutionId],
        );
        if (existing.length === 0) throw new NotFoundException('Institution not found');
        throw new ConflictException(
          `Regulatory evidence can only be recorded for a REGISTERED institution (current: ${existing[0]!.status})`,
        );
      }
      const institution = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'FINANCIAL_INSTITUTION',
        entityId: institutionId,
        action: 'FINANCIAL_INSTITUTION_EVIDENCE_RECORDED',
        actor: command.principal.principalId,
        previousValues: { status: 'REGISTERED' },
        newValues: {
          status: 'EVIDENCE_SUBMITTED',
          evidenceReference,
          evidenceDigest: digest,
          regulatorName,
          licenceReference,
          authorityGranted: false,
        },
      });
      return this.toView(institution);
    });
  }

  /** Maker side of a governed operational-approval / suspension / closure change. */
  async requestLifecycleChange(
    command: RequestInstitutionLifecycleCommand,
  ): Promise<{ approvalId: string; status: string; actionFingerprint: string; expiresAt: string }> {
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    if (
      ![
        FinancialInstitutionStatus.APPROVED,
        FinancialInstitutionStatus.SUSPENDED,
        FinancialInstitutionStatus.CLOSED,
      ].includes(command.targetStatus)
    ) {
      throw new BadRequestException(
        'targetStatus must be APPROVED, SUSPENDED or CLOSED (registration and evidence are administrative)',
      );
    }
    const reason = this.requiredText(command.reason, 'reason', 500);
    const current = await this.loadInstitution(this.dataSource.manager, institutionId);
    this.assertTransition(current.status, command.targetStatus);

    const definition = governedAction(ACTION)!;
    const fingerprint = institutionLifecycleFingerprint({
      institutionId,
      targetStatus: command.targetStatus,
      currentStatus: current.status,
      reason,
    });
    const decision = await this.approvals.request({
      principal: command.principal,
      policy: {
        resourceType: definition.resourceType,
        action: definition.action,
        allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: definition.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: RESOURCE, id: institutionId },
      actionFingerprint: fingerprint,
      reason,
      approvalScope: definition.approvalScope,
      requestDetails: {
        institutionId,
        institutionReference: current.reference,
        currentStatus: current.status,
        targetStatus: command.targetStatus,
      },
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Institution lifecycle request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionFingerprint: decision.approval.actionFingerprint,
      expiresAt: decision.approval.expiresAt.toISOString(),
    };
  }

  /**
   * Checker side. Consumes the approval and applies the lifecycle transition atomically. The
   * institution row is locked `FOR UPDATE`, and the database trigger re-validates that the consumed
   * approval is the one recorded on the row.
   */
  async executeLifecycleChange(
    command: ExecuteInstitutionLifecycleCommand,
  ): Promise<FinancialInstitutionView> {
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    const approvalId = this.uuid(command.approvalId, 'approvalId');
    const reason = this.requiredText(command.reason, 'reason', 500);

    return this.dataSource.transaction(async (manager) => {
      const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
        where: { id: approvalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.actionType !== ACTION || approval.resourceType !== RESOURCE) {
        throw new ForbiddenException(
          'Approval does not govern a financial institution lifecycle change',
        );
      }
      if ((approval.resourceId ?? '').toLowerCase() !== institutionId) {
        throw new ForbiddenException('Approval does not govern this institution');
      }
      if (approval.customerId !== null) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }
      if (
        approval.requesterPrincipalId === command.principal.principalId ||
        (approval.approvedBy !== command.principal.principalId &&
          !command.principal.scopes.includes('privileged:execute'))
      ) {
        throw governedChangeConsumptionError('APPROVAL_SCOPE_MISSING');
      }

      const institution = await this.loadInstitution(manager, institutionId, true);

      if (approval.status === PrivilegedActionApprovalStatus.CONSUMED) {
        // Idempotent replay: the committed state is returned, never re-applied.
        return this.toView(institution);
      }

      const fingerprint = institutionLifecycleFingerprint({
        institutionId,
        targetStatus: command.targetStatus,
        currentStatus: institution.status,
        reason,
      });
      if (approval.actionFingerprint !== fingerprint) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }
      this.assertTransition(institution.status, command.targetStatus);

      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal: command.principal,
        approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE, id: institutionId },
        actionFingerprint: fingerprint,
        now: command.now,
      });
      if (!consumed.approved) {
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
      }

      const actor = command.principal.principalId;
      const rows: Array<InstitutionRow> = await manager.query(
        `WITH changed AS (
         UPDATE financial_institutions
            SET status = $2::varchar,
                status_reason = $3::varchar,
                lifecycle_approval_id = $4::uuid,
                operational_approved_at = CASE WHEN $2::varchar = 'APPROVED'
                  THEN COALESCE(operational_approved_at, clock_timestamp()) ELSE operational_approved_at END,
                operational_approved_by = CASE WHEN $2::varchar = 'APPROVED'
                  THEN COALESCE(operational_approved_by, $5::varchar) ELSE operational_approved_by END,
                suspended_at = CASE WHEN $2::varchar = 'SUSPENDED' THEN clock_timestamp() ELSE NULL END,
                suspended_by = CASE WHEN $2::varchar = 'SUSPENDED' THEN $5::varchar ELSE NULL END,
                closed_at = CASE WHEN $2::varchar = 'CLOSED' THEN clock_timestamp() ELSE closed_at END,
                closed_by = CASE WHEN $2::varchar = 'CLOSED' THEN $5::varchar ELSE closed_by END,
                updated_by = $5::varchar,
                updated_at = clock_timestamp()
          WHERE id = $1::uuid
          RETURNING *
         ) SELECT * FROM changed`,
        [institutionId, command.targetStatus, reason, approvalId, actor],
      );
      const updated = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'FINANCIAL_INSTITUTION',
        entityId: institutionId,
        action: 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGED',
        actor,
        previousValues: { status: institution.status },
        newValues: {
          status: command.targetStatus,
          statusReason: reason,
          approvalId,
          operationalAuthority: command.targetStatus === FinancialInstitutionStatus.APPROVED,
        },
      });
      return this.toView(updated);
    });
  }

  async getById(institutionId: string): Promise<FinancialInstitutionView> {
    return this.toView(
      await this.loadInstitution(
        this.dataSource.manager,
        this.uuid(institutionId, 'institutionId'),
      ),
    );
  }

  async list(allowedInstitutionIds?: readonly string[]): Promise<FinancialInstitutionView[]> {
    const rows: InstitutionRow[] =
      allowedInstitutionIds && allowedInstitutionIds.length > 0
        ? await this.dataSource.query(
            `SELECT * FROM financial_institutions
              WHERE deleted_at IS NULL AND id = ANY($1::uuid[])
              ORDER BY created_at ASC`,
            [allowedInstitutionIds],
          )
        : allowedInstitutionIds
          ? []
          : await this.dataSource.query(
              `SELECT * FROM financial_institutions WHERE deleted_at IS NULL ORDER BY created_at ASC`,
            );
    return rows.map((row) => this.toView(row));
  }

  /** Organizational link only: an aggregator is never made a financial party by this row. */
  async linkAggregator(input: {
    institutionId: string;
    aggregatorId: string;
    principal: AuthorizationPrincipal;
  }): Promise<{ id: string; institutionId: string; aggregatorId: string; status: string }> {
    const institutionId = this.uuid(input.institutionId, 'institutionId');
    const aggregatorId = this.uuid(input.aggregatorId, 'aggregatorId');
    const actor = input.principal.principalId;
    return this.dataSource.transaction(async (manager) => {
      const institutions: Array<{ status: FinancialInstitutionStatus }> = await manager.query(
        `SELECT status FROM financial_institutions WHERE id=$1`,
        [institutionId],
      );
      if (institutions.length === 0) throw new NotFoundException('Institution not found');
      if (institutions[0]!.status !== FinancialInstitutionStatus.APPROVED) {
        throw new ConflictException(
          'Aggregator relationships may only be linked to an operationally approved institution',
        );
      }
      const aggregators: Array<{ id: string }> = await manager.query(
        `SELECT id FROM aggregators WHERE id=$1 AND deleted_at IS NULL`,
        [aggregatorId],
      );
      if (aggregators.length === 0) throw new NotFoundException('Aggregator not found');
      const existing: Array<{ id: string }> = await manager.query(
        `SELECT id FROM aggregator_institution_relationships
          WHERE aggregator_id=$1 AND institution_id=$2 AND status <> 'TERMINATED' LIMIT 1`,
        [aggregatorId, institutionId],
      );
      if (existing.length > 0) {
        throw new ConflictException('An open relationship already exists');
      }
      const rows: Array<{
        id: string;
        institution_id: string;
        aggregator_id: string;
        status: string;
      }> = await manager.query(
        `INSERT INTO aggregator_institution_relationships
             (aggregator_id, institution_id, status, assigned_by)
           VALUES ($1,$2,'ACTIVE',$3)
           RETURNING id, institution_id, aggregator_id, status`,
        [aggregatorId, institutionId, actor],
      );
      const row = rows[0]!;
      await this.auditService.record(manager, {
        entityType: 'AGGREGATOR_INSTITUTION_RELATIONSHIP',
        entityId: row.id,
        action: 'AGGREGATOR_INSTITUTION_LINKED',
        actor,
        newValues: { aggregatorId, institutionId, status: 'ACTIVE' },
      });
      return {
        id: row.id,
        institutionId: row.institution_id,
        aggregatorId: row.aggregator_id,
        status: row.status,
      };
    });
  }

  async unlinkAggregator(input: {
    institutionId: string;
    aggregatorId: string;
    principal: AuthorizationPrincipal;
  }): Promise<{ id: string; status: string }> {
    const institutionId = this.uuid(input.institutionId, 'institutionId');
    const aggregatorId = this.uuid(input.aggregatorId, 'aggregatorId');
    const actor = input.principal.principalId;
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH changed AS (
           UPDATE aggregator_institution_relationships
              SET status = 'TERMINATED', effective_to = clock_timestamp(),
                  unassigned_by = $3, updated_at = clock_timestamp(), version = version + 1
            WHERE aggregator_id = $1 AND institution_id = $2 AND status = 'ACTIVE'
            RETURNING id
         ) SELECT id FROM changed`,
        [aggregatorId, institutionId, actor],
      );
      if (rows.length !== 1) {
        throw new ConflictException('No ACTIVE aggregator-institution relationship to terminate');
      }
      await this.auditService.record(manager, {
        entityType: 'AGGREGATOR_INSTITUTION_RELATIONSHIP',
        entityId: rows[0]!.id,
        action: 'AGGREGATOR_INSTITUTION_UNLINKED',
        actor,
        newValues: { aggregatorId, institutionId, status: 'TERMINATED' },
      });
      return { id: rows[0]!.id, status: 'TERMINATED' };
    });
  }

  // ------------------------------------------------------------------ helpers

  private async loadInstitution(
    manager: EntityManager,
    institutionId: string,
    lock = false,
  ): Promise<InstitutionRow> {
    const rows: InstitutionRow[] = await manager.query(
      `SELECT * FROM financial_institutions WHERE id=$1 LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [institutionId],
    );
    if (rows.length === 0) throw new NotFoundException('Institution not found');
    return rows[0]!;
  }

  private assertTransition(
    current: FinancialInstitutionStatus,
    target: FinancialInstitutionStatus,
  ) {
    if (!ALLOWED_TRANSITIONS[current]?.includes(target)) {
      throw new ConflictException(`Institution transition ${current} -> ${target} is not allowed`);
    }
  }

  private toView(row: InstitutionRow): FinancialInstitutionView {
    return {
      id: row.id,
      reference: row.reference,
      code: row.code,
      legalName: row.legal_name,
      displayName: row.display_name,
      institutionType: row.institution_type as FinancialInstitutionType,
      regulatorName: row.regulator_name,
      licenceReference: row.licence_reference,
      evidenceReference: row.evidence_reference,
      evidenceDigest: row.evidence_digest,
      status: row.status,
      statusReason: row.status_reason,
      operationalAuthority: row.status === FinancialInstitutionStatus.APPROVED,
      operationalApprovedAt: row.operational_approved_at?.toISOString() ?? null,
      suspendedAt: row.suspended_at?.toISOString() ?? null,
      closedAt: row.closed_at?.toISOString() ?? null,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private computeEvidenceDigest(institutionId: string, evidenceReference: string): string {
    return governedChangeFingerprint(ACTION, RESOURCE, institutionId, {
      evidenceReference,
      kind: 'REGULATORY_EVIDENCE',
    });
  }

  private uuid(value: string, field: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private requiredText(value: string | undefined | null, field: string, max: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || trimmed.length > max) {
      throw new BadRequestException(`${field} is required and must be at most ${max} characters`);
    }
    return trimmed;
  }

  private requiredToken(value: string | undefined | null, field: string, max: number): string {
    const trimmed = this.requiredText(value, field, max);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
      throw new BadRequestException(`${field} must be alphanumeric with . _ - separators`);
    }
    return trimmed;
  }

  private optionalText(
    value: string | undefined | null,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > max) {
      throw new BadRequestException(`${field} must be at most ${max} characters`);
    }
    return trimmed;
  }

  private hexDigest(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      throw new BadRequestException(`${field} must be a 64-character hex digest`);
    }
    return normalized;
  }
}
