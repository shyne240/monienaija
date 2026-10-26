import type { INestApplicationContext } from '@nestjs/common';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../../src/authorization/privileged-action-approval.service';
import {
  AgentFundingService,
  type AgentFundingRequestView,
  type FundingInput,
  type FundingResult,
} from '../../src/agent/agent-funding.service';

/** Real approvals for financial-service fixtures; no posting/approval service is mocked.
 * HTTP entitlement and session provenance are independently tested by phase1-agent-security.
 * Only the suite's explicit trusted fixture gets approvals; negative principals pass through.
 */
export function approvedAgentFunding(
  app: INestApplicationContext,
  trusted: AuthorizationPrincipal,
) {
  const service = app.get(AgentFundingService);
  const approvals = app.get(PrivilegedActionApprovalService);
  const pending = new Map<string, Promise<string>>();
  const checker: AuthorizationPrincipal = {
    ...trusted,
    principalId: `checker:${trusted.principalId}`,
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['agent.fund', 'agent.defund'],
    assuranceLevel: 'MFA',
  };
  const maker: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: `maker:${trusted.principalId}`,
    roles: ['AGENT_NETWORK_MANAGER'],
    scopes: ['agent.fund', 'agent.defund'],
    customerAccess: 'NONE',
    assuranceLevel: 'MFA',
  };

  async function execute(input: FundingInput, direction: 'FUND' | 'DEFUND'): Promise<FundingResult> {
    const method = direction === 'FUND' ? 'fund' : 'defund';
    if (input.principal !== trusted) {
      return service[method](input).then(() => {
        throw new Error('Untrusted Agent funding fixture unexpectedly succeeded');
      });
    }
    const key = `${direction}:${input.agentId}:${input.idempotencyKey}`;
    let requestFlight = pending.get(key);
    if (!requestFlight) {
      requestFlight = (async () => {
        const request: AgentFundingRequestView = await service.requestFunding(
          { ...input, principal: maker, actor: maker.principalId },
          direction,
          'Synthetic integration-test instruction',
        );
        const approval = await approvals.approve({
          approvalId: request.approvalId,
          principal: checker,
          comment: 'Independent Finance Controller integration-test approval',
        });
        if (!approval.approved) {
          throw new Error(`Test approval rejected: ${approval.reason}`);
        }
        return request.id;
      })();
      pending.set(key, requestFlight);
    }
    const requestId = await requestFlight;
    return service.executeApprovedRequest(requestId, checker);
  }

  return {
    fund: (input: FundingInput) => execute(input, 'FUND'),
    defund: (input: FundingInput) => execute(input, 'DEFUND'),
  };
}
