import { ConflictException } from '@nestjs/common';

import type { AgentFundingService } from '../../src/agent/agent-funding.service';
import type { FundingInput, FundingResult } from '../../src/agent/agent-funding.service';
import type { PrivilegedActionApprovalService } from '../../src/authorization/privileged-action-approval.service';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { PrivilegedActionApprovalStatus } from '../../src/authorization/privileged-action-approval.enums';

/**
 * Real-PostgreSQL test adapter for legacy domain suites that exercise funding accounting.
 * It does not mock the decision: it submits a pending request, asks the real approval service
 * to record an independent Finance Controller decision, then consumes that approval through the
 * same AgentFundingService execution path used by the HTTP surface.
 */
export class AgentFundingGovernanceTestFacade {
  private readonly approvalFlights = new Map<string, Promise<void>>();

  constructor(
    private readonly service: AgentFundingService,
    private readonly approvals: PrivilegedActionApprovalService,
  ) {}

  fund(input: FundingInput): Promise<FundingResult> {
    return this.run(input, 'FUND');
  }

  defund(input: FundingInput): Promise<FundingResult> {
    return this.run(input, 'DEFUND');
  }

  private async run(input: FundingInput, direction: 'FUND' | 'DEFUND'): Promise<FundingResult> {
    const request = direction === 'FUND'
      ? await this.service.fund(input)
      : await this.service.defund(input);

    if (request.status === 'EXECUTED' && request.journalId) {
      return {
        status: 'REPLAYED',
        journalId: request.journalId,
        agentId: request.agentId,
        aggregatorId: request.aggregatorId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        idempotencyKey: request.idempotencyKey,
        requestHash: request.requestHash,
        replayed: true,
        createdAt: request.executedAt ?? request.createdAt,
        reference: request.reference,
        correlationId: request.correlationId,
      };
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException(`Agent funding request is ${request.status.toLowerCase()}`);
    }

    const checker = financeControllerPrincipal();
    await this.approveOnce(request.approvalId, checker);
    const executionInput: FundingInput = {
      ...input,
      principal: checker,
      actor: checker.principalId,
    };
    try {
      return await this.service.executeApprovedRequest(request.id, checker, executionInput);
    } catch (error) {
      // Concurrent idempotent tests may race at the one-time consume boundary. The production
      // endpoint correctly rejects the second execution; the accounting adapter reports the
      // existing committed journal as a replay so the historic accounting assertions remain
      // about idempotency, not about allowing another execution.
      const latest = await this.service.getFundingRequest(request.id);
      if (latest.status === 'EXECUTED' && latest.journalId) {
        return {
          status: 'REPLAYED',
          journalId: latest.journalId,
          agentId: latest.agentId,
          aggregatorId: latest.aggregatorId,
          amountMinor: latest.amountMinor,
          currency: latest.currency,
          idempotencyKey: latest.idempotencyKey,
          requestHash: latest.requestHash,
          replayed: true,
          createdAt: latest.executedAt ?? latest.createdAt,
          reference: latest.reference,
          correlationId: latest.correlationId,
        };
      }
      throw error;
    }
  }

  private async approveOnce(approvalId: string, checker: AuthorizationPrincipal): Promise<void> {
    let inFlight = this.approvalFlights.get(approvalId);
    if (!inFlight) {
      inFlight = this.approve(approvalId, checker);
      this.approvalFlights.set(approvalId, inFlight);
    }
    await inFlight;
  }

  private async approve(approvalId: string, checker: AuthorizationPrincipal): Promise<void> {
    const existing = await this.approvals.getApproval(approvalId);
    if (
      existing?.status === PrivilegedActionApprovalStatus.APPROVED &&
      existing.approvedBy === checker.principalId
    ) {
      return;
    }
    const result = await this.approvals.approve({
      approvalId,
      principal: checker,
      comment: 'Independent Finance Controller test approval',
    });
    if (result.reason !== 'APPROVED') {
      const after = await this.approvals.getApproval(approvalId);
      if (
        after?.status === PrivilegedActionApprovalStatus.APPROVED &&
        after.approvedBy === checker.principalId
      ) {
        return;
      }
      throw new ConflictException(`Test Finance Controller approval failed: ${result.reason ?? 'UNKNOWN'}`);
    }
  }
}

export function agentNetworkManagerPrincipal(principalId = 'test-agent-network-manager'): AuthorizationPrincipal {
  return {
    type: 'OPERATOR',
    principalId,
    roles: ['AGENT_NETWORK_MANAGER'],
    scopes: ['agent.fund', 'agent.defund'],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
}

export function financeControllerPrincipal(principalId = 'test-finance-controller'): AuthorizationPrincipal {
  return {
    type: 'OPERATOR',
    principalId,
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['agent.fund', 'agent.defund'],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
    assuranceLevel: 'MFA',
  };
}
