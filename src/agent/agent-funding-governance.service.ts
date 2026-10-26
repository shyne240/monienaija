import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrivilegedActionApproval } from '../authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../authorization/privileged-action-approval.enums';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';

export interface AgentFundingInstruction {
  agentId: string;
  aggregatorId?: string;
  amountMinor: string;
  currency?: string;
  idempotencyKey: string;
  reference?: string;
  correlationId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function fundingFingerprint(
  input: AgentFundingInstruction,
  direction: 'FUND' | 'DEFUND',
): string {
  return governedChangeFingerprint(`AGENT_${direction}`, 'AGENT', input.agentId.trim(), {
    aggregatorId: input.aggregatorId?.trim() || null,
    amountMinor: parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString(),
    currency: normalizeCurrency(input.currency ?? 'NGN'),
    idempotencyKey: input.idempotencyKey.trim(),
    reference: input.reference?.trim() || `${direction}-${input.idempotencyKey.trim()}`,
    correlationId: input.correlationId?.trim() || null,
    description: input.description?.trim() || null,
    metadata: input.metadata ?? {},
  });
}

@Injectable()
export class AgentFundingGovernanceService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly dataSource: DataSource,
  ) {}

  async request(
    input: AgentFundingInstruction,
    direction: 'FUND' | 'DEFUND',
    principal: AuthorizationPrincipal,
    reason: string,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.agentId) ||
      !input.idempotencyKey?.trim() ||
      input.idempotencyKey.length > 255
    ) {
      throw new BadRequestException('Valid agentId and idempotencyKey are required');
    }
    if (normalizeCurrency(input.currency ?? 'NGN') !== 'NGN')
      throw new BadRequestException('currency must be NGN');
    const definition = governedAction(`AGENT_${direction}`)!;
    const fingerprint = fundingFingerprint(input, direction);
    await this.auth.requireFunction(principal, direction === 'FUND' ? 'agent.fund' : 'agent.defund', 'AGENT', ['OPERATOR', 'PRIVILEGED']);
    if (!principal.roles.includes('AGENT_NETWORK_MANAGER') || principal.assuranceLevel !== 'MFA')
      throw new ForbiddenException('Funding initiation requires AGENT_NETWORK_MANAGER with MFA');
    return this.dataSource.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `agent-funding-request:${principal.principalId}:${input.agentId}:${direction}:${input.idempotencyKey.trim()}`,
    ]);
    const repository = manager.getRepository(PrivilegedActionApproval);
    const existing = await repository.createQueryBuilder('approval')
      .where('approval.resourceType = :type AND approval.resourceId = :id AND approval.actionType = :action AND approval.requesterPrincipalId = :principal',
        { type: 'AGENT', id: input.agentId.trim(), action: `AGENT_${direction}`, principal: principal.principalId })
      .andWhere("approval.policy->'requestDetails'->>'idempotencyKey' = :key", { key: input.idempotencyKey.trim() })
      .getOne();
    if (existing) {
      if (existing.actionFingerprint !== fingerprint) throw new BadRequestException('Idempotency key belongs to a different funding instruction');
      return this.approvals.toView(existing);
    }
    const decision = await this.approvals.requestInTransaction(manager, {
      principal,
      policy: {
        resourceType: 'AGENT',
        action: definition.action,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: 'MFA',
        customerAccess: 'NONE',
      },
      resource: { type: 'AGENT', id: input.agentId.trim() },
      actionFingerprint: fingerprint,
      reason,
      requestDetails: {
        direction,
        agentId: input.agentId.trim(),
        aggregatorId: input.aggregatorId?.trim() || null,
        amountMinor: parsePositiveMinorUnits(input.amountMinor, 'amountMinor').toString(),
        currency: normalizeCurrency(input.currency ?? 'NGN'),
        idempotencyKey: input.idempotencyKey.trim(),
        reference: input.reference?.trim() || `${direction}-${input.idempotencyKey.trim()}`,
        correlationId: input.correlationId?.trim() || null,
        description: input.description?.trim() || null,
        metadata: input.metadata ?? {},
      },
      approvalScope: definition.approvalScope,
    });
    if (!decision.approval)
      throw new ForbiddenException(`Funding request denied: ${decision.reason}`);
    return decision.approval;
    });
  }

  async assertExecutor(
    principal: AuthorizationPrincipal,
    direction: 'FUND' | 'DEFUND',
  ): Promise<void> {
    await this.auth.requireFunction(
      principal,
      direction === 'FUND' ? 'agent.fund' : 'agent.defund',
      'AGENT',
      ['OPERATOR', 'PRIVILEGED'],
    );
    if (!principal.roles.includes('FINANCE_CONTROLLER') || principal.assuranceLevel !== 'MFA') {
      throw new ForbiddenException(
        'Funding execution requires the approving FINANCE_CONTROLLER with MFA',
      );
    }
  }

  async list(agentId: string, principal: AuthorizationPrincipal, key?: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId) || (key && key.length > 255))
      throw new BadRequestException('Valid Agent ID and instruction key required');
    if (principal.assuranceLevel !== 'MFA' ||
      !principal.roles.some(role => ['AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER'].includes(role)))
      throw new ForbiddenException('Funding request access requires an entitled maker/checker with MFA');
    const actions: string[] = [];
    for (const direction of ['FUND', 'DEFUND'] as const) {
      const code = direction === 'FUND' ? 'agent.fund' : 'agent.defund';
      if (principal.scopes.includes(code)) {
        await this.auth.requireFunction(principal, code, 'AGENT', ['OPERATOR', 'PRIVILEGED']);
        actions.push(`AGENT_${direction}`);
      }
    }
    if (!actions.length) throw new ForbiddenException('Funding function required');
    const query = this.dataSource.getRepository(PrivilegedActionApproval).createQueryBuilder('approval')
      .where('approval.resourceType = :type AND approval.resourceId = :id', { type: 'AGENT', id: agentId })
      .andWhere('approval.actionType IN (:...actions)', { actions });
    if (principal.roles.includes('FINANCE_CONTROLLER')) {
      query.andWhere('(approval.requesterPrincipalId = :principal OR approval.approvedBy = :principal OR approval.status IN (:...reviewable))', {
        principal: principal.principalId, reviewable: ['REQUESTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
      });
    } else query.andWhere('approval.requesterPrincipalId = :principal', { principal: principal.principalId });
    if (key) query.andWhere("approval.policy->'requestDetails'->>'idempotencyKey' = :key", { key });
    const rows = await query.orderBy('approval.requestedAt', 'DESC').take(50).getMany();
    return rows.map(row => {
      const view = this.approvals.toView(row);
      if ([PrivilegedActionApprovalStatus.REQUESTED, PrivilegedActionApprovalStatus.APPROVED].includes(row.status) && row.expiresAt <= new Date())
        view.status = PrivilegedActionApprovalStatus.EXPIRED;
      return view;
    });
  }

  async consume(
    manager: EntityManager,
    input: AgentFundingInstruction,
    direction: 'FUND' | 'DEFUND',
    principal: AuthorizationPrincipal,
    approvalId?: string,
  ) {
    if (!approvalId)
      throw new ForbiddenException('approvalId is required for Agent funding/defunding');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId)) {
      throw new ForbiddenException('Valid funding approvalId is required');
    }
    const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !approval ||
      !approval.policy.requestDetails ||
      approval.requesterPrincipalId === principal.principalId ||
      approval.approvedBy !== principal.principalId
    ) {
      throw new ForbiddenException('Funding requires a distinct maker and the approving checker');
    }
    const decision = await this.approvals.consumeInTransaction(manager, {
      principal,
      approvalId,
      actionType: `AGENT_${direction}`,
      resource: { type: 'AGENT', id: input.agentId.trim() },
      actionFingerprint: fundingFingerprint(input, direction),
    });
    if (!decision.approved)
      throw new ForbiddenException(`Funding approval denied: ${decision.reason}`);
  }

  async assertReplay(
    manager: EntityManager,
    input: AgentFundingInstruction,
    direction: 'FUND' | 'DEFUND',
    principal: AuthorizationPrincipal,
    approvalId?: string,
  ): Promise<void> {
    if (!approvalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(approvalId))
      throw new ForbiddenException('Valid funding approvalId is required');
    const approval = await manager.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
      lock: { mode: 'pessimistic_read' },
    });
    // A consumed instruction remains recoverable after its original approval deadline,
    // but only by its authenticated checker and with the original instruction.
    if (
      !approval ||
      approval.status !== PrivilegedActionApprovalStatus.CONSUMED ||
      !approval.policy.requestDetails ||
      approval.requesterPrincipalId === principal.principalId ||
      approval.approvedBy !== principal.principalId ||
      approval.actionType !== `AGENT_${direction}` ||
      approval.resourceType !== 'AGENT' ||
      approval.resourceId !== input.agentId.trim() ||
      approval.actionFingerprint !== fundingFingerprint(input, direction)
    )
      throw new ForbiddenException('Funding replay requires the original instruction and checker');
  }
}
