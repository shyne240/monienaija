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
import { canonical, sha256 } from '../authorization/workforce-crypto';
import { AuditService } from '../operations/audit.service';
import {
  INSTITUTION_AFFILIATION_ACTION,
  INSTITUTION_AFFILIATION_EVIDENCE_TYPES,
  INSTITUTION_AFFILIATION_RESOURCE,
  InstitutionAffiliationChangeKind,
  InstitutionAffiliationEvidenceType,
  InstitutionAffiliationStatus,
  FinancialInstitutionStatus,
} from './institution.enums';
import type {
  ExecuteInstitutionAffiliationCommand,
  InstitutionAffiliationView,
  RequestInstitutionAffiliationCommand,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = INSTITUTION_AFFILIATION_ACTION;
const RESOURCE = INSTITUTION_AFFILIATION_RESOURCE;

interface AffiliationRow {
  id: string;
  institution_id: string;
  agent_id: string;
  status: InstitutionAffiliationStatus;
  effective_from: Date;
  effective_to: Date | null;
  evidence_type: string;
  evidence_reference: string;
  approval_id: string;
}

interface GovernedRow {
  approval_id: string;
  affiliation_id: string;
  agent_id: string;
  institution_id: string;
  previous_institution_id: string | null;
  change_kind: string;
  evidence_type: string;
  evidence_reference: string;
  evidence_digest: string;
  reason: string;
  executed_by: string;
  executed_at: Date;
  affiliation_status: InstitutionAffiliationStatus;
  effective_from: Date;
  effective_to: Date | null;
}

interface NormalizedAffiliationChange {
  agentId: string;
  institutionId: string;
  changeKind: InstitutionAffiliationChangeKind;
  evidenceType: InstitutionAffiliationEvidenceType;
  evidenceReference: string;
  reason: string;
}

/** Deterministic binding of an affiliation request to the exact affiliation state it acts on. */
export function institutionAffiliationFingerprint(
  input: NormalizedAffiliationChange & {
    currentAffiliationId: string | null;
    currentInstitutionId: string | null;
  },
): string {
  return governedChangeFingerprint(ACTION, RESOURCE, input.agentId, {
    institutionId: input.institutionId,
    changeKind: input.changeKind,
    evidenceType: input.evidenceType,
    evidenceReference: input.evidenceReference,
    reason: input.reason,
    currentAffiliationId: input.currentAffiliationId,
    currentInstitutionId: input.currentInstitutionId,
  });
}

/**
 * Governed agent↔institution affiliation.
 *
 * Every write — initial assignment, replacement (transfer), suspension, reactivation and
 * termination — requires an independently approved `INSTITUTION_AGENT_AFFILIATION_CHANGE` request
 * and is applied atomically with its consumption. There is deliberately no ungoverned path:
 * the database trigger refuses an affiliation row whose approval is not CONSUMED for that agent.
 *
 * The service also refuses to reassign an agent that still carries unsettled value (a non-zero
 * agent wallet balance or outstanding unclaimed cash-to-cash obligations), because moving the
 * affiliation would strand that value under an institution the agent no longer belongs to. Nothing
 * is ever moved: wallets, balances, journals and historical transactions are left untouched.
 */
@Injectable()
export class InstitutionAffiliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly auditService: AuditService,
  ) {}

  async requestAffiliation(
    command: RequestInstitutionAffiliationCommand,
  ): Promise<{ approvalId: string; status: string; actionFingerprint: string; expiresAt: string }> {
    const normalized = this.normalize(command);
    const manager = this.dataSource.manager;
    const current = await this.findOpenAffiliation(manager, normalized.agentId);
    await this.assertChangeIsValid(manager, normalized, current);
    await this.assertNoUnsettledObligations(manager, normalized, current);

    const definition = governedAction(ACTION)!;
    const fingerprint = institutionAffiliationFingerprint({
      ...normalized,
      currentAffiliationId: current?.id ?? null,
      currentInstitutionId: current?.institution_id ?? null,
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
      resource: { type: RESOURCE, id: normalized.agentId },
      actionFingerprint: fingerprint,
      reason: normalized.reason,
      approvalScope: definition.approvalScope,
      requestDetails: {
        agentId: normalized.agentId,
        institutionId: normalized.institutionId,
        changeKind: normalized.changeKind,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
        currentAffiliationId: current?.id ?? null,
        currentInstitutionId: current?.institution_id ?? null,
        currentStatus: current?.status ?? null,
      },
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      throw new ForbiddenException(
        `Institution affiliation request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return {
      approvalId: decision.approval.id,
      status: decision.approval.status,
      actionFingerprint: decision.approval.actionFingerprint,
      expiresAt: decision.approval.expiresAt.toISOString(),
    };
  }

  async executeAffiliation(
    command: ExecuteInstitutionAffiliationCommand,
  ): Promise<InstitutionAffiliationView> {
    this.assertExecuteEntitled(command.principal);
    const normalized = this.normalize(command);
    const approvalId = this.uuid(command.approvalId, 'approvalId');
    const evidenceDigest = sha256(
      canonical({
        agentId: normalized.agentId,
        institutionId: normalized.institutionId,
        changeKind: normalized.changeKind,
        evidenceType: normalized.evidenceType,
        evidenceReference: normalized.evidenceReference,
        reason: normalized.reason,
      }),
    );

    return this.dataSource.transaction(async (manager) => {
      const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
        where: { id: approvalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.actionType !== ACTION || approval.resourceType !== RESOURCE) {
        throw new ForbiddenException('Approval does not govern an institution affiliation change');
      }
      if ((approval.resourceId ?? '').toLowerCase() !== normalized.agentId) {
        throw new ForbiddenException('Approval does not govern this agent');
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

      if (approval.status === PrivilegedActionApprovalStatus.CONSUMED) {
        const replay = await this.findGoverned(manager, approvalId);
        if (!replay) throw new ConflictException('Approval has already been consumed');
        return this.toView(replay);
      }

      // Serialises affiliation changes for this agent. Financial authorization takes SHARE locks
      // on the same affiliation row, so neither can commit underneath the other.
      const agents: Array<{ id: string }> = await manager.query(
        `SELECT id FROM agents WHERE id=$1 FOR UPDATE`,
        [normalized.agentId],
      );
      if (agents.length === 0) throw new NotFoundException('Agent not found');

      const current = await this.findOpenAffiliation(manager, normalized.agentId, true);
      await this.assertChangeIsValid(manager, normalized, current);
      await this.assertNoUnsettledObligations(manager, normalized, current);

      const fingerprint = institutionAffiliationFingerprint({
        ...normalized,
        currentAffiliationId: current?.id ?? null,
        currentInstitutionId: current?.institution_id ?? null,
      });
      if (approval.actionFingerprint !== fingerprint) {
        throw governedChangeConsumptionError('FINGERPRINT_MISMATCH');
      }

      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal: command.principal,
        approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE, id: normalized.agentId },
        actionFingerprint: fingerprint,
        now: command.now,
      });
      if (!consumed.approved) {
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);
      }

      const actor = command.principal.principalId;
      const target = await this.applyChange(
        manager,
        normalized,
        current,
        approvalId,
        evidenceDigest,
        actor,
      );

      await manager.query(
        `INSERT INTO governed_institution_affiliations
           (approval_id, affiliation_id, agent_id, institution_id, previous_institution_id,
            change_kind, evidence_type, evidence_reference, evidence_digest, reason, executed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          approvalId,
          target.affiliationId,
          normalized.agentId,
          normalized.institutionId,
          current?.institution_id ?? null,
          normalized.changeKind,
          normalized.evidenceType,
          normalized.evidenceReference,
          evidenceDigest,
          normalized.reason,
          actor,
        ],
      );

      await this.auditService.record(manager, {
        entityType: 'AGENT',
        entityId: normalized.agentId,
        action: 'INSTITUTION_AFFILIATION_CHANGED',
        actor,
        previousValues: current
          ? {
              institutionId: current.institution_id,
              affiliationId: current.id,
              status: current.status,
            }
          : { institutionId: null, affiliationId: null, status: null },
        newValues: {
          institutionId: normalized.institutionId,
          affiliationId: target.affiliationId,
          status: target.status,
          changeKind: normalized.changeKind,
          evidenceType: normalized.evidenceType,
          evidenceReference: normalized.evidenceReference,
          evidenceDigest,
          approvalId,
          reason: normalized.reason,
        },
      });

      const record = await this.findGoverned(manager, approvalId);
      if (!record) throw new ConflictException('Governed affiliation record is missing');
      return this.toView(record);
    });
  }

  async getForAgent(agentId: string): Promise<{
    agentId: string;
    affiliationId: string | null;
    institutionId: string | null;
    status: string | null;
    effectiveFrom: string | null;
  }> {
    const current = await this.findOpenAffiliation(
      this.dataSource.manager,
      this.uuid(agentId, 'agentId'),
    );
    return {
      agentId,
      affiliationId: current?.id ?? null,
      institutionId: current?.institution_id ?? null,
      status: current?.status ?? null,
      effectiveFrom: current?.effective_from?.toISOString() ?? null,
    };
  }

  async listHistoryForAgent(agentId: string): Promise<InstitutionAffiliationView[]> {
    const rows: GovernedRow[] = await this.dataSource.query(
      `SELECT g.*, af.status AS affiliation_status, af.effective_from, af.effective_to
         FROM governed_institution_affiliations g
         JOIN institution_agent_affiliations af ON af.id = g.affiliation_id
        WHERE g.agent_id = $1
        ORDER BY g.executed_at ASC`,
      [this.uuid(agentId, 'agentId')],
    );
    return rows.map((row) => this.toView(row));
  }

  async listForInstitution(institutionId: string): Promise<
    Array<{
      affiliationId: string;
      agentId: string;
      status: string;
      institutionId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    }>
  > {
    const rows: AffiliationRow[] = await this.dataSource.query(
      `SELECT * FROM institution_agent_affiliations
        WHERE institution_id = $1 AND status <> 'TERMINATED'
        ORDER BY effective_from ASC`,
      [this.uuid(institutionId, 'institutionId')],
    );
    return rows.map((row) => ({
      affiliationId: row.id,
      agentId: row.agent_id,
      status: row.status as unknown as string,
      institutionId: row.institution_id,
      effectiveFrom: row.effective_from.toISOString(),
      effectiveTo: row.effective_to?.toISOString() ?? null,
    }));
  }

  // ------------------------------------------------------------------ internals

  private async applyChange(
    manager: EntityManager,
    change: NormalizedAffiliationChange,
    current: AffiliationRow | null,
    approvalId: string,
    evidenceDigest: string,
    actor: string,
  ): Promise<{ affiliationId: string; status: InstitutionAffiliationStatus }> {
    const terminate = async (existing: AffiliationRow, status: 'TERMINATED' | 'SUSPENDED') => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH changed AS (
           UPDATE institution_agent_affiliations
              SET status = $2::varchar,
                  effective_to = CASE WHEN $2::varchar = 'TERMINATED' THEN clock_timestamp() ELSE NULL END,
                  unassigned_by = CASE WHEN $2::varchar = 'TERMINATED' THEN $4::varchar ELSE unassigned_by END,
                  approval_id = $3::uuid
            WHERE id = $1::uuid AND status <> 'TERMINATED'
            RETURNING id
         ) SELECT id FROM changed`,
        [existing.id, status, approvalId, actor],
      );
      if (rows.length !== 1) {
        throw new ConflictException(
          'Institution affiliation changed while the request was pending',
        );
      }
    };

    switch (change.changeKind) {
      case InstitutionAffiliationChangeKind.ASSIGN: {
        const id = await this.insertAffiliation(manager, change, approvalId, evidenceDigest, actor);
        return { affiliationId: id, status: InstitutionAffiliationStatus.ACTIVE };
      }
      case InstitutionAffiliationChangeKind.TRANSFER: {
        await terminate(current!, 'TERMINATED');
        const id = await this.insertAffiliation(manager, change, approvalId, evidenceDigest, actor);
        return { affiliationId: id, status: InstitutionAffiliationStatus.ACTIVE };
      }
      case InstitutionAffiliationChangeKind.SUSPEND: {
        await terminate(current!, 'SUSPENDED');
        return { affiliationId: current!.id, status: InstitutionAffiliationStatus.SUSPENDED };
      }
      case InstitutionAffiliationChangeKind.REACTIVATE: {
        const rows: Array<{ id: string }> = await manager.query(
          `WITH changed AS (
             UPDATE institution_agent_affiliations
                SET status = 'ACTIVE', approval_id = $2
              WHERE id = $1 AND status = 'SUSPENDED'
              RETURNING id
           ) SELECT id FROM changed`,
          [current!.id, approvalId],
        );
        if (rows.length !== 1) {
          throw new ConflictException('Only a suspended affiliation can be reactivated');
        }
        return { affiliationId: current!.id, status: InstitutionAffiliationStatus.ACTIVE };
      }
      case InstitutionAffiliationChangeKind.TERMINATE: {
        await terminate(current!, 'TERMINATED');
        return { affiliationId: current!.id, status: InstitutionAffiliationStatus.TERMINATED };
      }
      default:
        throw new BadRequestException('Unsupported affiliation change');
    }
  }

  private async insertAffiliation(
    manager: EntityManager,
    change: NormalizedAffiliationChange,
    approvalId: string,
    evidenceDigest: string,
    actor: string,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO institution_agent_affiliations
         (institution_id, agent_id, status, effective_from, evidence_type, evidence_reference,
          evidence_digest, approval_id, assigned_by)
       VALUES ($1,$2,'ACTIVE',clock_timestamp(),$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        change.institutionId,
        change.agentId,
        change.evidenceType,
        change.evidenceReference,
        evidenceDigest,
        approvalId,
        actor,
      ],
    );
    return rows[0]!.id;
  }

  private async assertChangeIsValid(
    manager: EntityManager,
    change: NormalizedAffiliationChange,
    current: AffiliationRow | null,
  ): Promise<void> {
    const institution = await this.loadInstitutionStatus(manager, change.institutionId);
    switch (change.changeKind) {
      case InstitutionAffiliationChangeKind.ASSIGN:
        if (current) {
          throw new ConflictException(
            `Agent already has an open institution affiliation (${current.status}); use TRANSFER or TERMINATE`,
          );
        }
        this.assertInstitutionOperational(institution.status);
        return;
      case InstitutionAffiliationChangeKind.TRANSFER:
        if (!current || current.status !== InstitutionAffiliationStatus.ACTIVE) {
          throw new ConflictException('TRANSFER requires an ACTIVE affiliation to replace');
        }
        if (current.institution_id === change.institutionId) {
          throw new BadRequestException('TRANSFER requires a different institution');
        }
        this.assertInstitutionOperational(institution.status);
        return;
      case InstitutionAffiliationChangeKind.SUSPEND:
        if (!current || current.status !== InstitutionAffiliationStatus.ACTIVE) {
          throw new ConflictException('SUSPEND requires an ACTIVE affiliation');
        }
        if (current.institution_id !== change.institutionId) {
          throw new BadRequestException('SUSPEND must name the agent’s current institution');
        }
        return;
      case InstitutionAffiliationChangeKind.REACTIVATE:
        if (!current || current.status !== InstitutionAffiliationStatus.SUSPENDED) {
          throw new ConflictException('REACTIVATE requires a SUSPENDED affiliation');
        }
        if (current.institution_id !== change.institutionId) {
          throw new BadRequestException('REACTIVATE must name the agent’s current institution');
        }
        this.assertInstitutionOperational(institution.status);
        return;
      case InstitutionAffiliationChangeKind.TERMINATE:
        if (!current) throw new ConflictException('Agent has no open institution affiliation');
        if (current.institution_id !== change.institutionId) {
          throw new BadRequestException('TERMINATE must name the agent’s current institution');
        }
        return;
      default:
        throw new BadRequestException('Unsupported affiliation change');
    }
  }

  /**
   * Reassignment/termination is refused while the agent still holds value or an outstanding
   * cash-to-cash obligation: moving the affiliation would strand that value under an institution
   * the agent no longer belongs to. Nothing is transferred, merged or written off here.
   */
  private async assertNoUnsettledObligations(
    manager: EntityManager,
    change: NormalizedAffiliationChange,
    current: AffiliationRow | null,
  ): Promise<void> {
    if (
      !current ||
      (change.changeKind !== InstitutionAffiliationChangeKind.TRANSFER &&
        change.changeKind !== InstitutionAffiliationChangeKind.TERMINATE)
    ) {
      return;
    }
    const balances: Array<{ balance: string }> = await manager.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS balance
         FROM wallet_accounts w
         JOIN ledger_lines l ON l.ledger_account_id = w.ledger_account_id
        WHERE lower(w.customer_id) = $1 AND w.owner_class = 'AGENT'`,
      [change.agentId],
    );
    if (BigInt(balances[0]?.balance ?? '0') !== 0n) {
      throw new ConflictException(
        'Agent still holds wallet value; the affiliation cannot be reassigned until it is settled',
      );
    }
    const openCash: Array<{ count: string }> = await manager.query(
      `SELECT count(*)::text AS count FROM cash_to_cash_transfers
        WHERE agent_id = $1 AND status = 'UNCLAIMED'`,
      [change.agentId],
    );
    if (Number(openCash[0]?.count ?? '0') > 0) {
      throw new ConflictException(
        'Agent has outstanding unclaimed cash-to-cash obligations; the affiliation cannot be reassigned',
      );
    }
  }

  private async loadInstitutionStatus(
    manager: EntityManager,
    institutionId: string,
  ): Promise<{ id: string; status: FinancialInstitutionStatus; deleted_at: Date | null }> {
    const rows: Array<{ id: string; status: FinancialInstitutionStatus; deleted_at: Date | null }> =
      await manager.query(
        `SELECT id, status, deleted_at FROM financial_institutions WHERE id=$1 LIMIT 1`,
        [institutionId],
      );
    if (rows.length === 0) throw new NotFoundException('Institution not found');
    if (rows[0]!.deleted_at !== null) {
      throw new ConflictException('Institution is closed');
    }
    return rows[0]!;
  }

  private assertInstitutionOperational(status: FinancialInstitutionStatus): void {
    if (status !== FinancialInstitutionStatus.APPROVED) {
      throw new ConflictException(
        `Institution is ${status} and is not operationally approved for financial services`,
      );
    }
  }

  private async findOpenAffiliation(
    manager: EntityManager,
    agentId: string,
    lock = false,
  ): Promise<AffiliationRow | null> {
    const rows: AffiliationRow[] = await manager.query(
      `SELECT * FROM institution_agent_affiliations
        WHERE agent_id = $1 AND status <> 'TERMINATED'
        ORDER BY effective_from DESC
        LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [agentId],
    );
    return rows[0] ?? null;
  }

  private async findGoverned(
    manager: EntityManager,
    approvalId: string,
  ): Promise<GovernedRow | null> {
    const rows: GovernedRow[] = await manager.query(
      `SELECT g.*, af.status AS affiliation_status, af.effective_from, af.effective_to
         FROM governed_institution_affiliations g
         JOIN institution_agent_affiliations af ON af.id = g.affiliation_id
        WHERE g.approval_id = $1
        LIMIT 1`,
      [approvalId],
    );
    return rows[0] ?? null;
  }

  private toView(row: GovernedRow): InstitutionAffiliationView {
    return {
      affiliationId: row.affiliation_id,
      agentId: row.agent_id,
      institutionId: row.institution_id,
      status: row.affiliation_status,
      effectiveFrom: row.effective_from.toISOString(),
      effectiveTo: row.effective_to?.toISOString() ?? null,
      evidenceType: row.evidence_type as InstitutionAffiliationEvidenceType,
      evidenceReference: row.evidence_reference,
      approvalId: row.approval_id,
      changeKind: row.change_kind as InstitutionAffiliationChangeKind,
      executedAt: row.executed_at.toISOString(),
    };
  }

  private assertExecuteEntitled(principal: {
    type: string;
    assuranceLevel?: string;
    readOnlyPrincipal?: boolean;
  }): void {
    if (
      !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) ||
      principal.assuranceLevel !== 'MFA' ||
      principal.readOnlyPrincipal === true
    ) {
      throw new ForbiddenException(
        'Institution affiliation execution requires an MFA workforce principal with institutional authority',
      );
    }
  }

  private normalize(
    command: RequestInstitutionAffiliationCommand | ExecuteInstitutionAffiliationCommand,
  ): NormalizedAffiliationChange {
    const agentId = this.uuid(command.agentId, 'agentId');
    const institutionId = this.uuid(command.institutionId, 'institutionId');
    if (!Object.values(InstitutionAffiliationChangeKind).includes(command.changeKind)) {
      throw new BadRequestException('changeKind is not registered');
    }
    if (!INSTITUTION_AFFILIATION_EVIDENCE_TYPES.includes(command.evidenceType)) {
      throw new BadRequestException('evidenceType is not registered for institution affiliation');
    }
    const evidenceReference = this.requiredText(
      command.evidenceReference,
      'evidenceReference',
      160,
    );
    const reason = this.requiredText(command.reason, 'reason', 500);
    return {
      agentId,
      institutionId,
      changeKind: command.changeKind,
      evidenceType: command.evidenceType,
      evidenceReference,
      reason,
    };
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
}
