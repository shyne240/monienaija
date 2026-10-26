import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import type { AuthorizationPrincipal } from './authorization.types';
import { governedAction, governedChangeFingerprint } from './governed-action.registry';
import { PrivilegedActionApprovalService } from './privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from './privileged-action-approval.enums';
import type { PrivilegedActionApprovalView } from './privileged-action-approval.types';

/**
 * Commercial-rule change governance (P0-A).
 *
 * Enforces the maker/checker separation that `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01`
 * Decision 2 requires for fee, commission, reward and product rule changes: a FINANCE_PREPARER
 * initiates a governed change, a FINANCE_CONTROLLER independently approves it, and the live rule
 * is written only when a matching approved approval is consumed by the execution call. There is
 * deliberately no direct-write path: registry controllers route every create/modify through
 * {@link requestChange} (no approvalId) or {@link executeChange} (with approvalId).
 *
 * Mechanics follow the two established maker-checker implementations in this codebase exactly:
 * the server computes the deterministic action fingerprint with the shared
 * `workforce-crypto` canonicalization (`sha256(canonical(...))`, the same rule
 * `RoleDefinitionGovernanceService` and `A2FinanceRoleAdministrationService.fingerprint` use),
 * `PrivilegedActionApprovalService` owns the approval lifecycle (REQUESTED / APPROVED /
 * REJECTED / CONSUMED — each transition already audited there), and execution binds to the
 * approved request via `consume()`, which rejects replays (CONSUMED), tampering
 * (FINGERPRINT_MISMATCH / RESOURCE_MISMATCH) and unentitled executors
 * (APPROVAL_SCOPE_MISSING) under the established separation-of-duties controls.
 *
 * No approval policy is invented here: maker / checker roles, self-approval prohibition,
 * minimum-approval count and MFA come from the governed-action registry (copied verbatim from
 * the approved decisions).
 */
export interface CommercialChangeRequestCommand {
  principal: AuthorizationPrincipal;
  /** Governed action key from the registry, e.g. `FEE_RULE_CREATE`. */
  action: string;
  /** Resource id for MODIFY calls (existing rule id); omitted for CREATE calls. */
  resourceId?: string | null;
  /** Normalized change payload — the exact fields the write would persist. */
  payload: Readonly<Record<string, unknown>>;
  reason: string;
  expiresInSeconds?: number;
  correlationId?: string;
  now?: Date;
}

export interface CommercialChangeExecuteCommand<T> {
  principal: AuthorizationPrincipal;
  approvalId: string;
  action: string;
  payload: Readonly<Record<string, unknown>>;
  /**
   * Performs the registry write. Runs only after the approval has been consumed successfully.
   * Receives the fingerprint-bound resourceId taken from the approved request (null for
   * creates) — the caller never re-supplies it.
   */
  write: (resourceId: string | null) => Promise<T>;
  correlationId?: string;
  now?: Date;
}

export interface GovernedChangeRequestView {
  approvalId: string;
  status: PrivilegedActionApprovalStatus;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  actionFingerprint: string;
  requestedAt: Date;
  expiresAt: Date;
}

/**
 * Maps a `PrivilegedActionApprovalService.consume()` refusal onto the HTTP error semantics the
 * governed-change execution endpoints use. Shared by the commercial-rule and ledger-reversal
 * governance services so both surfaces reject identical situations identically.
 */
export function governedChangeConsumptionError(
  reason: string | undefined,
  status?: PrivilegedActionApprovalStatus | string,
): Error {
  switch (reason) {
    case 'NOT_FOUND':
      return new NotFoundException('Approval not found');
    case 'FINGERPRINT_MISMATCH':
    case 'RESOURCE_MISMATCH':
    case 'ACTION_MISMATCH':
      return new ForbiddenException(
        `Governed change rejected: executed payload does not match the approved request (${reason})`,
      );
    case 'APPROVAL_SCOPE_MISSING':
      return new ForbiddenException(
        'Governed change rejected: only the approving FINANCE_CONTROLLER or a privileged:execute principal may execute an approved change',
      );
    case 'CONSUMED':
      return new ConflictException('Approval has already been consumed');
    case 'EXPIRED':
      return new ConflictException('Approval has expired');
    default:
      return new ConflictException(`Approval is not consumable: ${reason ?? status ?? 'UNKNOWN'}`);
  }
}

@Injectable()
export class CommercialRuleGovernanceService {
  constructor(
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async requestChange(command: CommercialChangeRequestCommand): Promise<GovernedChangeRequestView> {
    const definition = this.definition(command.action);
    const resourceId = command.resourceId ?? null;
    const actionFingerprint = governedChangeFingerprint(
      definition.action,
      definition.resourceType,
      resourceId,
      command.payload,
    );
    const decision = await this.approvals.request({
      principal: command.principal,
      policy: {
        resourceType: definition.resourceType,
        action: definition.action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: definition.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: definition.resourceType, ...(resourceId ? { id: resourceId } : {}) },
      actionFingerprint,
      reason: command.reason,
      approvalScope: definition.approvalScope,
      expiresInSeconds: command.expiresInSeconds,
      now: command.now,
    });
    if (!decision.approval) {
      // AuthorizationService.authorize() denied before any approval row was created — nothing to
      // roll back; PrivilegedActionApprovalService never persists anything in this case.
      throw new ForbiddenException(
        `Governed change request denied: ${decision.reason ?? 'UNAUTHORIZED'}`,
      );
    }
    return this.toRequestView(decision.approval);
  }

  async executeChange<T>(command: CommercialChangeExecuteCommand<T>): Promise<T> {
    const definition = this.definition(command.action);
    const approval = await this.approvals.getApproval(command.approvalId);
    if (!approval) {
      throw new NotFoundException('Approval not found');
    }
    if (approval.actionType !== definition.action || approval.resourceType !== definition.resourceType) {
      throw new ForbiddenException('Approval does not govern this change');
    }
    const resourceId = approval.resourceId;
    // Recompute the fingerprint from the ACTUAL payload being executed (never from client input):
    // an approved request is only consumable for the exact change that was fingerprinted at
    // request time. Tampering surfaces as FINGERPRINT_MISMATCH below.
    const actionFingerprint = governedChangeFingerprint(
      definition.action,
      definition.resourceType,
      resourceId,
      command.payload,
    );
    const consumed = await this.approvals.consume({
      principal: command.principal,
      approvalId: command.approvalId,
      actionType: definition.action,
      resource: { type: definition.resourceType, ...(resourceId ? { id: resourceId } : {}) },
      actionFingerprint,
      now: command.now,
    });
    if (!consumed.approved) {
      throw this.consumptionException(consumed.reason, consumed.approval);
    }
    try {
      return await command.write(resourceId);
    } catch (error) {
      // The approval is already irreversibly CONSUMED but the write did not take effect
      // (e.g. a duplicate-identity conflict inside the registry service). The same tradeoff the
      // finance-role administration flow makes (consume approvals, then persist): no live rule
      // was written, and the failure is durably auditable so the maker can re-request.
      await this.audit.record(this.dataSource.manager, {
        entityType: 'COMMERCIAL_RULE_CHANGE',
        entityId: command.approvalId,
        action: 'GOVERNED_CHANGE_EXECUTION_FAILED',
        actor: command.principal.principalId,
        correlationId: command.correlationId,
        newValues: {
          actionType: definition.action,
          resourceId,
          error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        },
      });
      throw error;
    }
  }

  private definition(action: string) {
    const definition = governedAction(action);
    if (!definition) {
      throw new BadRequestException(`Unknown governed action: ${action}`);
    }
    return definition;
  }

  private consumptionException(
    reason: string | undefined,
    approval: PrivilegedActionApprovalView | undefined,
  ) {
    return governedChangeConsumptionError(reason, approval?.status);
  }

  private toRequestView(approval: PrivilegedActionApprovalView): GovernedChangeRequestView {
    return {
      approvalId: approval.id,
      status: approval.status,
      actionType: approval.actionType,
      resourceType: approval.resourceType,
      resourceId: approval.resourceId,
      actionFingerprint: approval.actionFingerprint,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
    };
  }
}
