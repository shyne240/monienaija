import { createHash, randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { redactRecord } from '../common/sensitive-data-redaction';
import { AuditService } from '../operations/audit.service';
import { SecurityEventHistory } from '../customer-authentication/security-event-history.entity';
import { SecurityEventType } from '../customer-authentication/customer-authentication.enums';
import { AuthorizationService } from './authorization.service';
import { AGENT_FUNDING_ACTIONS, governedAction } from './governed-action.registry';
import type { AuthorizationPrincipal } from './authorization.types';
import { PrivilegedActionApproval } from './privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from './privileged-action-approval.enums';
import type {
  ConsumePrivilegedActionCommand,
  DecidePrivilegedActionCommand,
  EmergencyAccessCommand,
  PrivilegedActionApprovalView,
  PrivilegedActionDecision,
  RequestPrivilegedActionCommand,
} from './privileged-action-approval.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/i;
const MIN_APPROVAL_TTL_SECONDS = 60;
const MAX_APPROVAL_TTL_SECONDS = 86_400;
const MIN_EMERGENCY_TTL_SECONDS = 60;
const MAX_EMERGENCY_TTL_SECONDS = 900;

@Injectable()
export class PrivilegedActionApprovalService {
  constructor(
    @InjectRepository(PrivilegedActionApproval)
    private readonly approvalRepository: Repository<PrivilegedActionApproval>,
    @InjectRepository(SecurityEventHistory)
    private readonly securityEventRepository: Repository<SecurityEventHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async getApproval(approvalId: string): Promise<PrivilegedActionApprovalView | null> {
    const approval = await this.findApproval(approvalId);
    return approval ? this.toView(approval) : null;
  }

  async request(command: RequestPrivilegedActionCommand): Promise<PrivilegedActionDecision> {
    return this.dataSource.transaction((manager) => this.requestInTransaction(manager, command));
  }

  /** Create an approval inside a domain transaction that also persists its request record. */
  async requestInTransaction(
    manager: EntityManager,
    command: RequestPrivilegedActionCommand,
  ): Promise<PrivilegedActionDecision> {
    const actionFingerprint = this.normalizeFingerprint(command.actionFingerprint);
    const reason = this.normalizeText(command.reason, 'reason', 500);
    const approvalId = command.id?.trim() || randomUUID();
    if (!UUID_PATTERN.test(approvalId)) {
      throw new BadRequestException('approval id must be a UUID');
    }
    const registeredAction = governedAction(command.policy.action);
    const approvalScope = this.normalizeText(
      registeredAction?.approvalScope ?? command.approvalScope ?? 'privileged:approve',
      'approvalScope',
      160,
    );
    if (registeredAction && command.resource.type !== registeredAction.resourceType) {
      return { approved: false, reason: 'RESOURCE_TYPE_MISMATCH' };
    }
    const policy = registeredAction
      ? {
          ...command.policy,
          resourceType: registeredAction.resourceType,
          action: registeredAction.action,
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'] as const,
          requiredRoles: registeredAction.initiatingRoles,
          requiredFunctions: registeredAction.initiatingFunctionCodes,
          minimumAssurance: registeredAction.minimumAssurance,
        }
      : command.policy;
    const safeRequestDetails = command.requestDetails
      ? redactRecord(command.requestDetails)
      : undefined;
    const recordedPolicy = safeRequestDetails
      ? { ...policy, requestDetails: safeRequestDetails }
      : policy;
    const authorization = await this.authorizationService.authorize(
      command.principal,
      recordedPolicy,
      command.resource,
    );
    if (!authorization.allowed) {
      return { approved: false, authorization, reason: authorization.reason };
    }

    const now = command.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.normalizeTtl(command.expiresInSeconds) * 1000);
    const repository = manager.getRepository(PrivilegedActionApproval);
    const approval = await repository.save(
      repository.create({
        id: approvalId,
        actionType: command.policy.action,
        resourceType: command.resource.type,
        resourceId: command.resource.id ?? null,
        customerId: command.resource.customerId ?? command.principal.customerId ?? null,
        actionFingerprint,
        policy: recordedPolicy as unknown as Record<string, unknown>,
        approvalScope,
        requiredAssurance: policy.minimumAssurance ?? 'MFA',
        requesterPrincipalId: command.principal.principalId,
        requesterSessionId: command.principal.sessionId ?? null,
        approvedBy: null,
        approverSessionId: null,
        reason,
        status: PrivilegedActionApprovalStatus.REQUESTED,
        isEmergency: false,
        requestedAt: now,
        expiresAt,
        approvedAt: null,
        rejectedAt: null,
        cancelledAt: null,
        consumedAt: null,
        version: 1,
      }),
    );
    await this.audit(
      manager,
      approval,
      'PRIVILEGED_ACTION_REQUESTED',
      command.principal.principalId,
      {
        actionType: approval.actionType,
        resourceType: approval.resourceType,
        resourceId: approval.resourceId,
        customerId: approval.customerId,
        approvalScope: approval.approvalScope,
        requiredAssurance: approval.requiredAssurance,
        expiresAt: approval.expiresAt,
      },
    );
    await this.securityEvent(
      manager,
      approval,
      SecurityEventType.PRIVILEGED_ACTION_REQUESTED,
      command.principal.principalId,
      {
        actionType: approval.actionType,
        resourceType: approval.resourceType,
      },
    );
    return { approved: false, approval: this.toView(approval), authorization, reason: 'REQUESTED' };
  }

  async approve(command: DecidePrivilegedActionCommand): Promise<PrivilegedActionDecision> {
    return this.decide(command, true);
  }

  async reject(command: DecidePrivilegedActionCommand): Promise<PrivilegedActionDecision> {
    return this.decide(command, false);
  }

  async cancel(command: DecidePrivilegedActionCommand): Promise<PrivilegedActionDecision> {
    return this.dataSource.transaction<PrivilegedActionDecision>(async (manager) => {
      // Read the current lifecycle state only after acquiring the same row lock used by approve,
      // reject, and consume. Saving a pre-transaction entity can overwrite a decision that
      // committed while this cancellation was waiting for the lock.
      const approval = await this.findApprovalIn(manager, command.approvalId, true);
      if (!approval) return { approved: false, reason: 'NOT_FOUND' };
      if (approval.requesterPrincipalId !== command.principal.principalId) {
        return {
          approved: false,
          approval: this.toView(approval),
          reason: 'APPROVAL_SCOPE_MISSING',
        };
      }
      if (approval.status !== PrivilegedActionApprovalStatus.REQUESTED) {
        return {
          approved: false,
          approval: this.toView(approval),
          reason: this.statusReason(approval.status),
        };
      }

      const now = command.now ?? new Date();
      if (await this.expireIfNeededIn(manager, approval, now)) {
        return { approved: false, approval: this.toView(approval), reason: 'EXPIRED' };
      }
      approval.status = PrivilegedActionApprovalStatus.CANCELLED;
      approval.cancelledAt = now;
      const saved = await manager.getRepository(PrivilegedActionApproval).save(approval);
      await this.audit(
        manager,
        saved,
        'PRIVILEGED_ACTION_CANCELLED',
        command.principal.principalId,
        { comment: command.comment ?? null },
      );
      await this.securityEvent(
        manager,
        saved,
        SecurityEventType.PRIVILEGED_ACTION_CANCELLED,
        command.principal.principalId,
        { comment: command.comment ?? null },
      );
      return { approved: false, approval: this.toView(saved), reason: 'CANCELLED' };
    });
  }

  async consume(command: ConsumePrivilegedActionCommand): Promise<PrivilegedActionDecision> {
    return this.dataSource.transaction((manager) => this.consumeInTransaction(manager, command));
  }

  /**
   * Transaction-aware variant of {@link consume}.
   *
   * Callers that already own a transaction — notably the SERIALIZABLE Finance (B2F) and
   * B1T12 boundaries — must use this method. Calling {@link consume} from inside such a
   * boundary opens a nested transaction on a second pooled connection, which cannot observe
   * the caller's uncommitted writes and yields PostgreSQL serialization/atomicity failures.
   *
   * Approval enforcement, maker-checker semantics and A2 involvement are identical to
   * {@link consume}; only the transaction boundary differs.
   */
  async consumeInTransaction(
    manager: EntityManager,
    command: ConsumePrivilegedActionCommand,
  ): Promise<PrivilegedActionDecision> {
    const approval = await this.findApprovalIn(manager, command.approvalId, true);
    if (!approval) return { approved: false, reason: 'NOT_FOUND' };
    const now = command.now ?? new Date();
    const expired = await this.expireIfNeededIn(manager, approval, now);
    if (expired) return { approved: false, approval: this.toView(approval), reason: 'EXPIRED' };
    if (approval.status !== PrivilegedActionApprovalStatus.APPROVED) {
      return {
        approved: false,
        approval: this.toView(approval),
        reason: this.statusReason(approval.status),
      };
    }
    const registeredAction = governedAction(command.actionType);
    if (registeredAction && !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(command.principal.type)) {
      return { approved: false, approval: this.toView(approval), reason: 'PRINCIPAL_TYPE_DENIED' };
    }
    if (registeredAction && this.isAgentFundingAction(command.actionType)) {
      // Agent funding is stricter than the established privileged:execute consume rule: only
      // the independent FINANCE_CONTROLLER who approved the request may execute it. In
      // particular, SUPER_ADMIN can never substitute for the checker.
      if (command.principal.roles.includes('SUPER_ADMIN')) {
        return { approved: false, approval: this.toView(approval), reason: 'SUPER_ADMIN_NOT_ALLOWED' };
      }
      if (!registeredAction.approvingRoles.some((role) => command.principal.roles.includes(role))) {
        return { approved: false, approval: this.toView(approval), reason: 'ROLE_MISSING' };
      }
      if (
        !registeredAction.approvingFunctionCodes.every((functionCode) =>
          command.principal.scopes.includes(functionCode),
        )
      ) {
        return { approved: false, approval: this.toView(approval), reason: 'FUNCTION_MISSING' };
      }
      if (approval.approvedBy !== command.principal.principalId) {
        return { approved: false, approval: this.toView(approval), reason: 'APPROVAL_SCOPE_MISSING' };
      }
    } else if (
      approval.approvedBy !== command.principal.principalId &&
      !command.principal.scopes.includes('privileged:execute')
    ) {
      // Preserve the established consume contract for other privileged actions: the
      // recorded checker may execute directly, or a separately authorized privileged:execute
      // principal may consume the already-approved change.
      return { approved: false, approval: this.toView(approval), reason: 'APPROVAL_SCOPE_MISSING' };
    }
    if (
      approval.actionType !== command.actionType ||
      approval.resourceType !== command.resource.type ||
      approval.resourceId !== (command.resource.id ?? null) ||
      approval.customerId !== (command.resource.customerId ?? null)
    ) {
      return { approved: false, approval: this.toView(approval), reason: 'RESOURCE_MISMATCH' };
    }
    if (approval.actionFingerprint !== this.normalizeFingerprint(command.actionFingerprint)) {
      return { approved: false, approval: this.toView(approval), reason: 'FINGERPRINT_MISMATCH' };
    }

    approval.status = PrivilegedActionApprovalStatus.CONSUMED;
    approval.consumedAt = now;
    const saved = await manager.getRepository(PrivilegedActionApproval).save(approval);
    await this.audit(manager, saved, 'PRIVILEGED_ACTION_CONSUMED', command.principal.principalId, {
      actionType: saved.actionType,
      resourceType: saved.resourceType,
      resourceId: saved.resourceId,
      customerId: saved.customerId,
      consumedAt: saved.consumedAt,
    });
    await this.securityEvent(
      manager,
      saved,
      SecurityEventType.PRIVILEGED_ACTION_CONSUMED,
      command.principal.principalId,
      {
        actionType: saved.actionType,
        resourceType: saved.resourceType,
      },
    );
    return { approved: true, approval: this.toView(saved), reason: 'CONSUMED' };
  }

  async activateEmergencyAccess(
    command: EmergencyAccessCommand,
  ): Promise<PrivilegedActionDecision> {
    if (
      command.principal.type !== 'PRIVILEGED' ||
      command.principal.assuranceLevel !== 'MFA' ||
      !command.principal.scopes.includes('privileged:break-glass')
    ) {
      return { approved: false, reason: 'INVALID_EMERGENCY_ACCESS' };
    }
    const reason = this.normalizeText(command.reason, 'reason', 500);
    const now = command.now ?? new Date();
    const expiresAt = new Date(
      now.getTime() + this.normalizeEmergencyTtl(command.expiresInSeconds) * 1000,
    );
    const saved = await this.dataSource.transaction(async (manager) => {
      const approval = await manager.getRepository(PrivilegedActionApproval).save(
        manager.getRepository(PrivilegedActionApproval).create({
          id: randomUUID(),
          actionType: 'EMERGENCY_ACCESS',
          resourceType: command.resourceType,
          resourceId: command.resourceId ?? null,
          customerId: command.principal.customerId ?? null,
          actionFingerprint: this.fingerprint({
            action: 'EMERGENCY_ACCESS',
            resourceType: command.resourceType,
            resourceId: command.resourceId ?? null,
          }),
          policy: { action: 'EMERGENCY_ACCESS', resourceType: command.resourceType },
          approvalScope: 'privileged:break-glass',
          requiredAssurance: 'MFA',
          requesterPrincipalId: command.principal.principalId,
          requesterSessionId: command.principal.sessionId ?? null,
          approvedBy: command.principal.principalId,
          approverSessionId: command.principal.sessionId ?? null,
          reason,
          status: PrivilegedActionApprovalStatus.EMERGENCY_ACTIVE,
          isEmergency: true,
          requestedAt: now,
          expiresAt,
          approvedAt: now,
          rejectedAt: null,
          cancelledAt: null,
          consumedAt: null,
          version: 1,
        }),
      );
      await this.audit(
        manager,
        approval,
        'EMERGENCY_ACCESS_ACTIVATED',
        command.principal.principalId,
        {
          resourceType: approval.resourceType,
          resourceId: approval.resourceId,
          reason: approval.reason,
          expiresAt: approval.expiresAt,
        },
      );
      await this.securityEvent(
        manager,
        approval,
        SecurityEventType.EMERGENCY_ACCESS_ACTIVATED,
        command.principal.principalId,
        {
          resourceType: approval.resourceType,
          resourceId: approval.resourceId,
          expiresAt: approval.expiresAt,
        },
      );
      return approval;
    });
    return { approved: true, approval: this.toView(saved), reason: 'APPROVED' };
  }

  async revokeEmergencyAccess(
    approvalId: string,
    principal: AuthorizationPrincipal,
    now = new Date(),
  ): Promise<PrivilegedActionDecision> {
    const approval = await this.findApproval(approvalId);
    if (!approval || !approval.isEmergency) return { approved: false, reason: 'NOT_FOUND' };
    if (
      approval.requesterPrincipalId !== principal.principalId &&
      !principal.scopes.includes('privileged:break-glass')
    ) {
      return { approved: false, approval: this.toView(approval), reason: 'APPROVAL_SCOPE_MISSING' };
    }
    if (approval.status !== PrivilegedActionApprovalStatus.EMERGENCY_ACTIVE) {
      return {
        approved: false,
        approval: this.toView(approval),
        reason: this.statusReason(approval.status),
      };
    }
    approval.status = PrivilegedActionApprovalStatus.EMERGENCY_REVOKED;
    approval.cancelledAt = now;
    const saved = await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(PrivilegedActionApproval).save(approval);
      await this.audit(manager, result, 'EMERGENCY_ACCESS_REVOKED', principal.principalId, {
        resourceType: result.resourceType,
        resourceId: result.resourceId,
      });
      await this.securityEvent(
        manager,
        result,
        SecurityEventType.EMERGENCY_ACCESS_REVOKED,
        principal.principalId,
        {
          resourceType: result.resourceType,
          resourceId: result.resourceId,
        },
      );
      return result;
    });
    return { approved: false, approval: this.toView(saved), reason: 'CANCELLED' };
  }

  private async decide(
    command: DecidePrivilegedActionCommand,
    approve: boolean,
  ): Promise<PrivilegedActionDecision> {
    return this.dataSource.transaction((manager) =>
      this.decideInTransaction(manager, command, approve),
    );
  }

  /**
   * Transaction-aware decision path used by dedicated workflows that must commit the approval
   * decision together with their own state transition (for example agent funding rejection).
   */
  async rejectInTransaction(
    manager: EntityManager,
    command: DecidePrivilegedActionCommand,
  ): Promise<PrivilegedActionDecision> {
    return this.decideInTransaction(manager, command, false);
  }

  private async decideInTransaction(
    manager: EntityManager,
    command: DecidePrivilegedActionCommand,
    approve: boolean,
  ): Promise<PrivilegedActionDecision> {
    const approval = await this.findApprovalIn(manager, command.approvalId, true);
    if (!approval) return { approved: false, reason: 'NOT_FOUND' };
    const now = command.now ?? new Date();
    if (await this.expireIfNeededIn(manager, approval, now)) {
      return { approved: false, approval: this.toView(approval), reason: 'EXPIRED' };
    }
    if (approval.status !== PrivilegedActionApprovalStatus.REQUESTED) {
      return {
        approved: false,
        approval: this.toView(approval),
        reason: this.statusReason(approval.status),
      };
    }
    if (approval.requesterPrincipalId === command.principal.principalId) {
      return {
        approved: false,
        approval: this.toView(approval),
        reason: 'SELF_APPROVAL_FORBIDDEN',
      };
    }
    const registeredAction = governedAction(approval.actionType);
    if (registeredAction) {
      if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(command.principal.type)) {
        return { approved: false, approval: this.toView(approval), reason: 'PRINCIPAL_TYPE_DENIED' };
      }
      if (
        this.isAgentFundingAction(approval.actionType) &&
        command.principal.roles.includes('SUPER_ADMIN')
      ) {
        return { approved: false, approval: this.toView(approval), reason: 'SUPER_ADMIN_NOT_ALLOWED' };
      }
      if (!registeredAction.approvingRoles.some((role) => command.principal.roles.includes(role))) {
        return { approved: false, approval: this.toView(approval), reason: 'ROLE_MISSING' };
      }
      if (
        !registeredAction.approvingFunctionCodes.every((functionCode) =>
          command.principal.scopes.includes(functionCode),
        )
      ) {
        return { approved: false, approval: this.toView(approval), reason: 'FUNCTION_MISSING' };
      }
      if (approval.resourceType !== registeredAction.resourceType) {
        return { approved: false, approval: this.toView(approval), reason: 'RESOURCE_TYPE_MISMATCH' };
      }
    }
    if (!command.principal.scopes.includes(approval.approvalScope)) {
      return { approved: false, approval: this.toView(approval), reason: 'APPROVAL_SCOPE_MISSING' };
    }
    if (approval.requiredAssurance === 'MFA' && command.principal.assuranceLevel !== 'MFA') {
      return { approved: false, approval: this.toView(approval), reason: 'MFA_REQUIRED' };
    }

    approval.status = approve
      ? PrivilegedActionApprovalStatus.APPROVED
      : PrivilegedActionApprovalStatus.REJECTED;
    approval.approvedBy = approve ? command.principal.principalId : null;
    approval.approverSessionId = approve ? (command.principal.sessionId ?? null) : null;
    approval.approvedAt = approve ? now : null;
    approval.rejectedAt = approve ? null : now;
    const result = await manager.getRepository(PrivilegedActionApproval).save(approval);
    await this.audit(
      manager,
      result,
      approve ? 'PRIVILEGED_ACTION_APPROVED' : 'PRIVILEGED_ACTION_REJECTED',
      command.principal.principalId,
      { comment: command.comment ?? null, status: result.status },
    );
    await this.securityEvent(
      manager,
      result,
      approve
        ? SecurityEventType.PRIVILEGED_ACTION_APPROVED
        : SecurityEventType.PRIVILEGED_ACTION_REJECTED,
      command.principal.principalId,
      { status: result.status },
    );
    return {
      approved: approve,
      approval: this.toView(result),
      reason: approve ? 'APPROVED' : 'REJECTED',
    };
  }

  private isAgentFundingAction(actionType: string): boolean {
    return Object.values(AGENT_FUNDING_ACTIONS).some((action) => action.action === actionType);
  }

  private async findApproval(approvalId: string): Promise<PrivilegedActionApproval | null> {
    if (!UUID_PATTERN.test(approvalId)) return null;
    return this.approvalRepository.findOne({ where: { id: approvalId } });
  }

  /** Transaction-aware variant of {@link findApproval}. */
  private async findApprovalIn(
    manager: EntityManager,
    approvalId: string,
    lockForUpdate = false,
  ): Promise<PrivilegedActionApproval | null> {
    if (!UUID_PATTERN.test(approvalId)) return null;
    const query = manager
      .getRepository(PrivilegedActionApproval)
      .createQueryBuilder('approval')
      .where('approval.id = :approvalId', { approvalId });
    if (lockForUpdate) query.setLock('pessimistic_write');
    return query.getOne();
  }

  private requiresExpiry(approval: PrivilegedActionApproval, now: Date): boolean {
    return (
      approval.expiresAt.getTime() <= now.getTime() &&
      [
        PrivilegedActionApprovalStatus.REQUESTED,
        PrivilegedActionApprovalStatus.APPROVED,
        PrivilegedActionApprovalStatus.EMERGENCY_ACTIVE,
      ].includes(approval.status)
    );
  }

  private async applyExpiry(
    manager: EntityManager,
    approval: PrivilegedActionApproval,
    now: Date,
  ): Promise<void> {
    approval.status = PrivilegedActionApprovalStatus.EXPIRED;
    const saved = await manager.getRepository(PrivilegedActionApproval).save(approval);
    await this.audit(manager, saved, 'PRIVILEGED_ACTION_EXPIRED', 'approval-lifecycle', {
      actionType: saved.actionType,
      resourceType: saved.resourceType,
      resourceId: saved.resourceId,
      isEmergency: saved.isEmergency,
      expiredAt: now,
    });
    await this.securityEvent(
      manager,
      saved,
      SecurityEventType.PRIVILEGED_ACTION_EXPIRED,
      'approval-lifecycle',
      {
        actionType: saved.actionType,
        resourceType: saved.resourceType,
        isEmergency: saved.isEmergency,
      },
    );
  }

  /** Transaction-aware variant of {@link expireIfNeeded}. */
  private async expireIfNeededIn(
    manager: EntityManager,
    approval: PrivilegedActionApproval,
    now: Date,
  ): Promise<boolean> {
    if (!this.requiresExpiry(approval, now)) {
      return false;
    }
    await this.applyExpiry(manager, approval, now);
    return true;
  }

  private statusReason(status: PrivilegedActionApprovalStatus): PrivilegedActionDecision['reason'] {
    switch (status) {
      case PrivilegedActionApprovalStatus.APPROVED:
        return 'APPROVED';
      case PrivilegedActionApprovalStatus.REJECTED:
        return 'REJECTED';
      case PrivilegedActionApprovalStatus.CANCELLED:
      case PrivilegedActionApprovalStatus.EMERGENCY_REVOKED:
        return 'CANCELLED';
      case PrivilegedActionApprovalStatus.CONSUMED:
        return 'CONSUMED';
      case PrivilegedActionApprovalStatus.EXPIRED:
        return 'EXPIRED';
      default:
        return 'REQUESTED';
    }
  }

  toView(approval: PrivilegedActionApproval): PrivilegedActionApprovalView {
    return {
      id: approval.id,
      actionType: approval.actionType,
      resourceType: approval.resourceType,
      resourceId: approval.resourceId,
      customerId: approval.customerId,
      actionFingerprint: approval.actionFingerprint,
      requesterPrincipalId: approval.requesterPrincipalId,
      approvedBy: approval.approvedBy,
      approvalScope: approval.approvalScope,
      requiredAssurance: approval.requiredAssurance,
      policy: approval.policy,
      status: approval.status,
      isEmergency: approval.isEmergency,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      approvedAt: approval.approvedAt,
      rejectedAt: approval.rejectedAt,
      cancelledAt: approval.cancelledAt,
      consumedAt: approval.consumedAt,
      version: approval.version,
    };
  }

  private async audit(
    manager: EntityManager,
    approval: PrivilegedActionApproval,
    action: string,
    actor: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'PRIVILEGED_ACTION_APPROVAL',
      entityId: approval.id,
      action,
      actor,
      newValues: values,
    });
  }

  private async securityEvent(
    manager: EntityManager,
    approval: PrivilegedActionApproval,
    eventType: SecurityEventType,
    actor: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!approval.customerId) {
      return;
    }
    const event = await manager.getRepository(SecurityEventHistory).save(
      manager.getRepository(SecurityEventHistory).create({
        id: randomUUID(),
        customerId: approval.customerId ?? SYSTEM_CUSTOMER_ID,
        credentialId: null,
        eventType,
        actor,
        metadata: redactRecord({ approvalId: approval.id, ...metadata }),
        occurredAt: new Date(),
        deletedAt: null,
      }),
    );
    await this.audit(manager, approval, 'SECURITY_EVENT_RECORDED', actor, {
      securityEventId: event.id,
      eventType,
    });
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private normalizeFingerprint(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!FINGERPRINT_PATTERN.test(normalized)) {
      throw new BadRequestException('actionFingerprint must be a SHA-256 hex value');
    }
    return normalized;
  }

  private normalizeTtl(value: number | undefined): number {
    const ttl = value ?? 900;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_APPROVAL_TTL_SECONDS ||
      ttl > MAX_APPROVAL_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `expiresInSeconds must be between ${MIN_APPROVAL_TTL_SECONDS} and ${MAX_APPROVAL_TTL_SECONDS}`,
      );
    }
    return ttl;
  }

  private normalizeEmergencyTtl(value: number | undefined): number {
    const ttl = value ?? 300;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_EMERGENCY_TTL_SECONDS ||
      ttl > MAX_EMERGENCY_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `expiresInSeconds must be between ${MIN_EMERGENCY_TTL_SECONDS} and ${MAX_EMERGENCY_TTL_SECONDS}`,
      );
    }
    return ttl;
  }

  private fingerprint(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  }
}

const SYSTEM_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';
