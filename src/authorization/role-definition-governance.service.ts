import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { AuthorizationFunction } from '../authorization-catalogue/authorization-function.entity';
import { AuthorizationRole } from '../authorization-catalogue/authorization-role.entity';
import { AuthorizationRoleFunction } from '../authorization-catalogue/authorization-role-function.entity';
import type { AuthorizationPrincipal } from './authorization.types';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import {
  RoleDefinitionFunctionGrant,
  RoleDefinitionPriorSnapshot,
  RoleDefinitionProposal,
} from './role-definition-proposal.entity';
import { canonical, sha256 } from './workforce-crypto';

/**
 * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01
 *
 * Hardcoded (not `A2_MAKER_CHECKER_RULES_JSON`-driven) governance identities, mirroring the
 * existing `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` precedent in `finance-role-administration.service.ts`:
 * SUPER_ADMIN may INITIATE a role-definition proposal; FINANCE_CONTROLLER is the sole independent
 * approver. Neither is configurable at runtime — avoids ever inventing a new role, or widening the
 * legacy maker/checker config, to "solve" an approval constraint.
 */
export const ROLE_DEFINITION_INITIATOR_ROLE = 'SUPER_ADMIN';
export const ROLE_DEFINITION_APPROVER_ROLE = 'FINANCE_CONTROLLER';

const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,49}$/;
const VALID_ACCESS_TYPES = new Set(['VIEW', 'EXECUTE', 'INITIATE', 'APPROVE']);
const MAX_FUNCTION_GRANTS = 100;
const SYSTEM_ACTOR = 'system:role-definition-governance';

export interface RoleDefinitionFunctionGrantInput {
  functionCode: string;
  accessType: string;
}

export interface SubmitRoleDefinitionProposalCommand {
  principal: AuthorizationPrincipal;
  proposalType: 'CREATE' | 'MODIFY';
  roleKey: string;
  displayName: string;
  description: string;
  readOnly?: boolean;
  functionGrants: readonly RoleDefinitionFunctionGrantInput[];
  deactivate?: boolean;
  expectedDefinitionVersion?: number;
  reason: string;
  expiresInSeconds?: number;
  correlationId?: string;
  now?: Date;
}

export interface DecideRoleDefinitionProposalCommand {
  principal: AuthorizationPrincipal;
  proposalId: string;
  comment?: string;
  correlationId?: string;
  now?: Date;
}

export interface ApplyRoleDefinitionProposalCommand {
  principal: AuthorizationPrincipal;
  proposalId: string;
  correlationId?: string;
  now?: Date;
}

export interface RoleDefinitionProposalResult {
  success: boolean;
  proposal: RoleDefinitionProposal;
  reason?: string;
}

@Injectable()
export class RoleDefinitionGovernanceService {
  constructor(
    @InjectRepository(RoleDefinitionProposal)
    private readonly proposalRepo: Repository<RoleDefinitionProposal>,
    @InjectRepository(AuthorizationRole)
    private readonly roleRepo: Repository<AuthorizationRole>,
    @InjectRepository(AuthorizationFunction)
    private readonly functionRepo: Repository<AuthorizationFunction>,
    private readonly dataSource: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ submit

  async submit(command: SubmitRoleDefinitionProposalCommand): Promise<RoleDefinitionProposalResult> {
    const principal = command.principal;
    if (!principal.roles.includes(ROLE_DEFINITION_INITIATOR_ROLE)) {
      throw new ForbiddenException(
        `Only ${ROLE_DEFINITION_INITIATOR_ROLE} may initiate a role definition proposal`,
      );
    }
    if (principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException('MFA assurance is required to initiate a role definition proposal');
    }
    if (command.proposalType !== 'CREATE' && command.proposalType !== 'MODIFY') {
      throw new BadRequestException('proposalType must be CREATE or MODIFY');
    }

    const roleKey = this.normalizeRoleKey(command.roleKey);
    const displayName = this.normalizeText(command.displayName, 'displayName', 160);
    const description = this.normalizeText(command.description, 'description', 500);
    const reason = this.normalizeText(command.reason, 'reason', 500);
    const readOnly = command.readOnly === true;
    const grants = this.normalizeFunctionGrants(command.functionGrants);
    await this.validateFunctionGrants(this.functionRepo, grants, readOnly);

    const existing = await this.roleRepo.findOne({ where: { roleKey } });
    let priorSnapshot: RoleDefinitionPriorSnapshot | null = null;
    let expectedDefinitionVersion: number | null = null;

    if (command.proposalType === 'CREATE') {
      if (existing) {
        throw new ConflictException(`Role ${roleKey} already exists`);
      }
      if (command.deactivate === true) {
        throw new BadRequestException('deactivate is only valid for MODIFY proposals');
      }
    } else {
      if (!existing) {
        throw new NotFoundException(`Role ${roleKey} does not exist`);
      }
      if (existing.isSystemSeeded) {
        throw new ForbiddenException(
          `Role ${roleKey} is one of the eleven V1-seeded roles and cannot be modified through this workflow`,
        );
      }
      if (!existing.isActive) {
        throw new ConflictException(`Role ${roleKey} is deactivated and cannot be modified`);
      }
      if (
        command.expectedDefinitionVersion === undefined ||
        !Number.isSafeInteger(command.expectedDefinitionVersion) ||
        command.expectedDefinitionVersion < 1
      ) {
        throw new BadRequestException('expectedDefinitionVersion is required for MODIFY proposals');
      }
      if (command.expectedDefinitionVersion !== existing.definitionVersion) {
        throw new ConflictException(
          `Role ${roleKey} has changed since the submitted expectedDefinitionVersion (current v${existing.definitionVersion})`,
        );
      }
      expectedDefinitionVersion = command.expectedDefinitionVersion;
      const activeGrants = await this.dataSource.getRepository(AuthorizationRoleFunction).find({
        where: { roleId: existing.id, isActive: true } as never,
      });
      priorSnapshot = {
        displayName: existing.displayName,
        description: existing.description,
        readOnly: existing.readOnly,
        isActive: existing.isActive,
        definitionVersion: existing.definitionVersion,
        functionGrants: activeGrants
          .map((g) => ({ functionCode: g.functionCode, accessType: g.accessType as RoleDefinitionFunctionGrant['accessType'] }))
          .sort((a, b) => a.functionCode.localeCompare(b.functionCode)),
      };
    }

    const now = command.now ?? new Date();
    const proposalId = randomUUID();
    const actionType = command.proposalType === 'CREATE' ? 'ROLE_DEFINITION_CREATE' : 'ROLE_DEFINITION_MODIFY';
    const approvalScope = command.proposalType === 'CREATE' ? 'workforce.role.create' : 'workforce.role.modify';
    const deactivate = command.deactivate === true;
    const actionFingerprint = sha256(
      canonical({
        proposalId,
        proposalType: command.proposalType,
        roleKey,
        displayName,
        description,
        readOnly,
        functionGrants: grants,
        deactivate,
        expectedDefinitionVersion,
      }),
    );

    const decision = await this.approvals.request({
      principal,
      policy: {
        resourceType: 'ROLE_DEFINITION_PROPOSAL',
        action: actionType,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: [ROLE_DEFINITION_INITIATOR_ROLE],
        requiredFunctions: [approvalScope],
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      resource: { type: 'ROLE_DEFINITION_PROPOSAL', id: proposalId },
      actionFingerprint,
      reason,
      approvalScope,
      expiresInSeconds: command.expiresInSeconds,
      now,
    });

    if (!decision.approval) {
      // authorizationService.authorize() denied before any approval row was created — nothing to
      // roll back; the privileged-action-approval service never persists anything in this case.
      throw new ForbiddenException(`Role definition proposal request denied: ${decision.reason}`);
    }

    const proposal = this.proposalRepo.create({
      id: proposalId,
      proposalType: command.proposalType,
      targetRoleKey: roleKey,
      proposedDisplayName: displayName,
      proposedDescription: description,
      proposedReadOnly: readOnly,
      proposedFunctionGrants: grants,
      deactivate,
      expectedDefinitionVersion,
      priorSnapshot,
      actionFingerprint,
      approvalId: decision.approval.id,
      appliedRoleId: null,
      proposerPrincipalId: principal.principalId,
      proposerSessionId: principal.sessionId ?? null,
      reason,
      status: 'REQUESTED',
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      appliedBy: null,
      appliedAt: null,
      applyFailureReason: null,
      correlationId: command.correlationId ?? null,
      requestedAt: now,
      expiresAt: decision.approval.expiresAt,
    });

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const result = await manager.getRepository(RoleDefinitionProposal).save(proposal);
        await this.auditRecord(manager, result, 'ROLE_DEFINITION_PROPOSAL_SUBMITTED', principal.principalId, {
          displayName,
          description,
          readOnly,
          functionGrants: grants,
          deactivate,
          expectedDefinitionVersion,
          priorSnapshot,
          approvalId: proposal.approvalId,
        });
        return result;
      });
      return { success: true, proposal: saved };
    } catch (e) {
      // Best-effort cleanup: do not leave an orphan approval nothing will ever consume, and more
      // importantly do not leave the target role key permanently blocked by the in-flight partial
      // unique index below a proposal row that was never actually created.
      await this.approvals.cancel({ approvalId: decision.approval.id, principal, now }).catch(() => undefined);
      if (this.isUniqueViolation(e)) {
        throw new ConflictException(
          `A role definition proposal for ${roleKey} is already in flight (REQUESTED or APPROVED)`,
        );
      }
      throw e;
    }
  }

  // --------------------------------------------------------------- decide

  async approve(command: DecideRoleDefinitionProposalCommand): Promise<RoleDefinitionProposalResult> {
    return this.decide(command, true);
  }

  async reject(command: DecideRoleDefinitionProposalCommand): Promise<RoleDefinitionProposalResult> {
    return this.decide(command, false);
  }

  private async decide(
    command: DecideRoleDefinitionProposalCommand,
    approve: boolean,
  ): Promise<RoleDefinitionProposalResult> {
    const principal = command.principal;
    if (!principal.roles.includes(ROLE_DEFINITION_APPROVER_ROLE)) {
      throw new ForbiddenException(
        `Only ${ROLE_DEFINITION_APPROVER_ROLE} may ${approve ? 'approve' : 'reject'} a role definition proposal`,
      );
    }
    const proposal = await this.proposalRepo.findOne({ where: { id: command.proposalId } });
    if (!proposal) throw new NotFoundException('Role definition proposal not found');

    const now = command.now ?? new Date();
    if (await this.expireIfStale(proposal, now)) {
      return { success: false, proposal, reason: 'EXPIRED' };
    }
    if (proposal.status !== 'REQUESTED') {
      // Covers a benign race: a prior read of this same proposal (e.g. the controller's own
      // getProposal() call immediately before this one, to learn proposalType) may have already
      // lazily transitioned it to EXPIRED. Report that outcome rather than a spurious conflict.
      if (proposal.status === 'EXPIRED') {
        return { success: false, proposal, reason: 'EXPIRED' };
      }
      throw new ConflictException(`Role definition proposal is ${proposal.status}, not pending decision`);
    }
    if (!proposal.approvalId) {
      throw new ConflictException('Role definition proposal has no associated approval record');
    }

    const decision = approve
      ? await this.approvals.approve({ approvalId: proposal.approvalId, principal, comment: command.comment, now })
      : await this.approvals.reject({ approvalId: proposal.approvalId, principal, comment: command.comment, now });

    const successReason = approve ? 'APPROVED' : 'REJECTED';
    if (decision.reason !== successReason) {
      if (decision.reason === 'EXPIRED') {
        const saved = await this.markStatus(proposal, 'EXPIRED', SYSTEM_ACTOR, 'Underlying approval expired', now, command.correlationId);
        return { success: false, proposal: saved, reason: 'EXPIRED' };
      }
      // Covers SELF_APPROVAL_FORBIDDEN, MFA_REQUIRED, APPROVAL_SCOPE_MISSING, and any
      // already-decided/consumed/cancelled status reported by the approval service itself.
      // These are unauthorized/invalid decision attempts and must remain auditable even though
      // nothing about the proposal's own state changes.
      await this.auditDecisionDenied(proposal, principal, decision.reason, command.correlationId, now);
      throw new ForbiddenException(
        `Role definition proposal ${approve ? 'approval' : 'rejection'} denied: ${decision.reason}`,
      );
    }

    const saved = await this.markStatus(
      proposal,
      successReason,
      principal.principalId,
      command.comment ?? null,
      now,
      command.correlationId,
    );
    return { success: true, proposal: saved };
  }

  // ---------------------------------------------------------------- apply

  async apply(command: ApplyRoleDefinitionProposalCommand): Promise<RoleDefinitionProposalResult> {
    const principal = command.principal;
    if (!principal.roles.includes(ROLE_DEFINITION_INITIATOR_ROLE)) {
      throw new ForbiddenException(
        `Only ${ROLE_DEFINITION_INITIATOR_ROLE} may apply an approved role definition proposal`,
      );
    }
    const now = command.now ?? new Date();

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RoleDefinitionProposal);
      const proposal = await repo.findOne({
        where: { id: command.proposalId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!proposal) throw new NotFoundException('Role definition proposal not found');

      if (proposal.status === 'REQUESTED' && proposal.expiresAt.getTime() <= now.getTime()) {
        proposal.status = 'EXPIRED';
        const saved = await repo.save(proposal);
        await this.auditRecord(manager, saved, 'ROLE_DEFINITION_PROPOSAL_EXPIRED', SYSTEM_ACTOR, {});
        return { success: false, proposal: saved, reason: 'EXPIRED' };
      }
      if (proposal.status !== 'APPROVED') {
        // Same benign race as in decide(): a prior read (e.g. the controller's own getProposal()
        // call immediately before this one) may have already lazily expired this proposal.
        if (proposal.status === 'EXPIRED') {
          return { success: false, proposal, reason: 'EXPIRED' };
        }
        // Nothing has been written in this transaction — safe to throw and roll back (no-op).
        throw new ConflictException(`Role definition proposal is ${proposal.status}, not APPROVED`);
      }
      if (!proposal.approvalId) {
        throw new ConflictException('Role definition proposal has no associated approval record');
      }

      const preflightError = await this.preflightValidate(manager, proposal)
        .then(() => null)
        .catch((e: unknown) => e);
      if (preflightError) {
        proposal.status = 'APPLY_FAILED';
        proposal.applyFailureReason = this.describeError(preflightError).slice(0, 500);
        const saved = await repo.save(proposal);
        await this.auditRecord(manager, saved, 'ROLE_DEFINITION_PROPOSAL_APPLY_FAILED', principal.principalId, {
          reason: proposal.applyFailureReason,
        });
        return { success: false, proposal: saved, reason: proposal.applyFailureReason ?? undefined };
      }

      const consumeResult = await this.approvals.consumeInTransaction(manager, {
        principal,
        approvalId: proposal.approvalId,
        actionType: proposal.proposalType === 'CREATE' ? 'ROLE_DEFINITION_CREATE' : 'ROLE_DEFINITION_MODIFY',
        resource: { type: 'ROLE_DEFINITION_PROPOSAL', id: proposal.id },
        actionFingerprint: proposal.actionFingerprint,
        now,
      });
      if (!consumeResult.approved) {
        // The approval could not be consumed (already consumed/expired/replayed/mismatched) for
        // reasons independent of our own mutation. Nothing else has been written yet — durably
        // record the failure and let the transaction COMMIT that record (not roll it back).
        proposal.status = 'APPLY_FAILED';
        proposal.applyFailureReason = `Approval consumption failed: ${consumeResult.reason}`.slice(0, 500);
        const saved = await repo.save(proposal);
        await this.auditRecord(manager, saved, 'ROLE_DEFINITION_PROPOSAL_APPLY_FAILED', principal.principalId, {
          reason: consumeResult.reason,
        });
        return { success: false, proposal: saved, reason: proposal.applyFailureReason ?? undefined };
      }

      // From here on the approval has already been irreversibly marked CONSUMED in this same
      // transaction. Any exception thrown below aborts the WHOLE transaction — including that
      // CONSUMED write — so the approval and proposal both revert to APPROVED, safely retryable.
      // This is deliberate: a genuinely unexpected catalogue-mutation failure must never burn the
      // approval on a change that did not actually take effect.
      const roleId = await this.mutateCatalogue(manager, proposal, principal.principalId, now);

      proposal.status = 'APPLIED';
      proposal.appliedBy = principal.principalId;
      proposal.appliedAt = now;
      proposal.appliedRoleId = roleId;
      const saved = await repo.save(proposal);
      await this.auditRecord(manager, saved, 'ROLE_DEFINITION_PROPOSAL_APPLIED', principal.principalId, {
        roleId,
        proposedFunctionGrants: proposal.proposedFunctionGrants,
        priorSnapshot: proposal.priorSnapshot,
      });
      await this.audit.record(manager, {
        entityType: 'AUTHORIZATION_ROLE',
        entityId: roleId,
        action: proposal.proposalType === 'CREATE' ? 'ROLE_DEFINITION_CREATED' : 'ROLE_DEFINITION_MODIFIED',
        actor: principal.principalId,
        correlationId: command.correlationId ?? undefined,
        previousValues: (proposal.priorSnapshot as unknown as Record<string, unknown>) ?? undefined,
        newValues: {
          roleKey: proposal.targetRoleKey,
          displayName: proposal.proposedDisplayName,
          description: proposal.proposedDescription,
          readOnly: proposal.proposedReadOnly,
          isActive: !proposal.deactivate,
          functionGrants: proposal.proposedFunctionGrants,
        },
      });
      return { success: true, proposal: saved };
    });
  }

  // ----------------------------------------------------------------- read

  async getProposal(id: string): Promise<RoleDefinitionProposal | null> {
    const proposal = await this.proposalRepo.findOne({ where: { id } });
    if (!proposal) return null;
    await this.expireIfStale(proposal, new Date());
    return proposal;
  }

  async listProposals(filter?: { status?: string; roleKey?: string }): Promise<RoleDefinitionProposal[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.roleKey) where.targetRoleKey = filter.roleKey;
    const rows = await this.proposalRepo.find({ where: where as never, order: { createdAt: 'DESC' } });
    const now = new Date();
    for (const row of rows) {
      await this.expireIfStale(row, now);
    }
    return rows;
  }

  // -------------------------------------------------------------- helpers

  private async expireIfStale(proposal: RoleDefinitionProposal, now: Date): Promise<boolean> {
    if (
      (proposal.status === 'REQUESTED' || proposal.status === 'APPROVED') &&
      proposal.expiresAt.getTime() <= now.getTime()
    ) {
      await this.markStatus(proposal, 'EXPIRED', SYSTEM_ACTOR, 'Proposal expired', now, proposal.correlationId ?? undefined);
      return true;
    }
    return false;
  }

  private async markStatus(
    proposal: RoleDefinitionProposal,
    status: RoleDefinitionProposal['status'],
    actor: string,
    decisionReason: string | null,
    now: Date,
    correlationId: string | null | undefined,
  ): Promise<RoleDefinitionProposal> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RoleDefinitionProposal);
      proposal.status = status;
      if (status === 'APPROVED' || status === 'REJECTED') {
        proposal.decidedBy = actor;
        proposal.decidedAt = now;
        proposal.decisionReason = decisionReason;
      }
      const saved = await repo.save(proposal);
      await this.auditRecord(manager, saved, `ROLE_DEFINITION_PROPOSAL_${status}`, actor, {
        decisionReason,
      }, correlationId);
      return saved;
    });
  }

  private async auditDecisionDenied(
    proposal: RoleDefinitionProposal,
    principal: AuthorizationPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        entityType: 'ROLE_DEFINITION_PROPOSAL',
        entityId: proposal.id,
        action: 'ROLE_DEFINITION_PROPOSAL_DECISION_DENIED',
        actor: principal.principalId,
        correlationId: correlationId ?? undefined,
        newValues: {
          reason: reason ?? 'UNKNOWN',
          attemptedAt: now,
          proposalStatus: proposal.status,
        },
      });
    });
  }

  private async auditRecord(
    manager: EntityManager,
    proposal: RoleDefinitionProposal,
    action: string,
    actor: string,
    extra: Record<string, unknown>,
    correlationId?: string | null,
  ): Promise<void> {
    await this.audit.record(manager, {
      entityType: 'ROLE_DEFINITION_PROPOSAL',
      entityId: proposal.id,
      action,
      actor,
      correlationId: correlationId ?? proposal.correlationId ?? undefined,
      newValues: {
        status: proposal.status,
        proposalType: proposal.proposalType,
        targetRoleKey: proposal.targetRoleKey,
        ...extra,
      },
    });
  }

  private async preflightValidate(manager: EntityManager, proposal: RoleDefinitionProposal): Promise<void> {
    const roleRepo = manager.getRepository(AuthorizationRole);
    const functionRepo = manager.getRepository(AuthorizationFunction);
    const existing = await roleRepo.findOne({ where: { roleKey: proposal.targetRoleKey } });

    if (proposal.proposalType === 'CREATE') {
      if (existing) {
        throw new ConflictException(`Role ${proposal.targetRoleKey} already exists`);
      }
    } else {
      if (!existing) {
        throw new NotFoundException(`Role ${proposal.targetRoleKey} no longer exists`);
      }
      if (existing.isSystemSeeded) {
        throw new ForbiddenException(`Role ${proposal.targetRoleKey} is a seeded V1 role and cannot be modified`);
      }
      if (proposal.expectedDefinitionVersion !== existing.definitionVersion) {
        throw new ConflictException(
          `Role ${proposal.targetRoleKey} definition changed since this proposal was submitted (expected v${proposal.expectedDefinitionVersion}, now v${existing.definitionVersion})`,
        );
      }
    }

    await this.validateFunctionGrants(functionRepo, proposal.proposedFunctionGrants, proposal.proposedReadOnly);
  }

  private async validateFunctionGrants(
    functionRepo: Repository<AuthorizationFunction>,
    grants: readonly RoleDefinitionFunctionGrant[],
    readOnly: boolean,
  ): Promise<void> {
    if (grants.length === 0) return;
    const codes = grants.map((g) => g.functionCode);
    const rows = await functionRepo.find({ where: { functionCode: In(codes) } as never });
    const byCode = new Map(rows.map((r) => [r.functionCode, r]));
    for (const grant of grants) {
      const fn = byCode.get(grant.functionCode);
      if (!fn) throw new BadRequestException(`Unknown function code: ${grant.functionCode}`);
      this.assertGrantable(fn, readOnly);
    }
  }

  private assertGrantable(fn: AuthorizationFunction, readOnly: boolean): void {
    if (!fn.assignable) {
      throw new BadRequestException(`Function ${fn.functionCode} is not assignable`);
    }
    if (fn.functionCode.startsWith('workforce.role.')) {
      throw new ForbiddenException(
        `Function ${fn.functionCode} governs role definitions/assignments itself and can never be granted to a role through this workflow`,
      );
    }
    if (fn.financeClassRestricted || fn.sensitivity === 'CRITICAL_FINANCIAL') {
      throw new ForbiddenException(
        `Function ${fn.functionCode} is restricted to the Finance role class and cannot be granted to a configurable role`,
      );
    }
    if (readOnly && fn.sensitivity !== 'READ') {
      throw new BadRequestException(
        `Function ${fn.functionCode} is not READ-sensitivity and cannot be granted to a read-only role`,
      );
    }
  }

  private async mutateCatalogue(
    manager: EntityManager,
    proposal: RoleDefinitionProposal,
    actor: string,
    now: Date,
  ): Promise<string> {
    const roleRepo = manager.getRepository(AuthorizationRole);
    const roleFunctionRepo = manager.getRepository(AuthorizationRoleFunction);

    let roleId: string;
    if (proposal.proposalType === 'CREATE') {
      const role = await roleRepo.save(
        roleRepo.create({
          id: randomUUID(),
          roleKey: proposal.targetRoleKey,
          displayName: proposal.proposedDisplayName,
          description: proposal.proposedDescription,
          isActive: true,
          isSystemSeeded: false,
          financeRoleClass: false,
          administrativeCapability: false,
          readOnly: proposal.proposedReadOnly,
          makerEligible: false,
          checkerEligible: false,
          createdBy: proposal.proposerPrincipalId,
          updatedBy: null,
          definitionVersion: 1,
        }),
      );
      roleId = role.id;
    } else {
      const role = await roleRepo.findOne({
        where: { roleKey: proposal.targetRoleKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (!role) throw new NotFoundException(`Role ${proposal.targetRoleKey} no longer exists`);
      role.displayName = proposal.proposedDisplayName;
      role.description = proposal.proposedDescription;
      role.readOnly = proposal.proposedReadOnly;
      role.isActive = !proposal.deactivate;
      role.updatedBy = actor;
      role.definitionVersion = role.definitionVersion + 1;
      await roleRepo.save(role);
      roleId = role.id;
    }

    const desired = new Map(proposal.proposedFunctionGrants.map((g) => [g.functionCode, g.accessType]));
    const existingRows = await roleFunctionRepo.find({ where: { roleId } as never });
    const existingByCode = new Map(existingRows.map((r) => [r.functionCode, r]));

    for (const [functionCode, accessType] of desired) {
      const row = existingByCode.get(functionCode);
      if (row) {
        row.accessType = accessType;
        row.isActive = true;
        row.assignedBy = actor;
        row.assignedAt = now;
        await roleFunctionRepo.save(row);
      } else {
        await roleFunctionRepo.save(
          roleFunctionRepo.create({
            id: randomUUID(),
            roleId,
            functionCode,
            accessType,
            isActive: true,
            assignedBy: actor,
            assignedAt: now,
          }),
        );
      }
    }
    for (const row of existingRows) {
      if (!desired.has(row.functionCode) && row.isActive) {
        row.isActive = false;
        await roleFunctionRepo.save(row);
      }
    }

    return roleId;
  }

  private normalizeRoleKey(value: string): string {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!ROLE_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'roleKey must be 2-50 characters, uppercase letters/digits/underscores, starting with a letter',
      );
    }
    return key;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private normalizeFunctionGrants(
    input: readonly RoleDefinitionFunctionGrantInput[],
  ): RoleDefinitionFunctionGrant[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestException('At least one function grant is required');
    }
    if (input.length > MAX_FUNCTION_GRANTS) {
      throw new BadRequestException(`A role definition proposal may not include more than ${MAX_FUNCTION_GRANTS} function grants`);
    }
    const seen = new Set<string>();
    const normalized: RoleDefinitionFunctionGrant[] = [];
    for (const g of input) {
      const functionCode = typeof g?.functionCode === 'string' ? g.functionCode.trim() : '';
      const accessType = typeof g?.accessType === 'string' ? g.accessType.trim().toUpperCase() : '';
      if (!functionCode || functionCode.length > 100) {
        throw new BadRequestException('Each function grant requires a valid functionCode');
      }
      if (!VALID_ACCESS_TYPES.has(accessType)) {
        throw new BadRequestException(`Invalid accessType for ${functionCode}: must be one of VIEW, EXECUTE, INITIATE, APPROVE`);
      }
      if (seen.has(functionCode)) {
        throw new BadRequestException(`Duplicate function grant: ${functionCode}`);
      }
      seen.add(functionCode);
      normalized.push({ functionCode, accessType: accessType as RoleDefinitionFunctionGrant['accessType'] });
    }
    return normalized.sort((a, b) => a.functionCode.localeCompare(b.functionCode));
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
  }

  private describeError(e: unknown): string {
    if (e instanceof Error) return e.message;
    return 'Unknown apply failure';
  }
}
