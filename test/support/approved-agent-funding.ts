import type { INestApplicationContext } from '@nestjs/common';
import type { AuthorizationPrincipal } from '../../src/authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../../src/authorization/privileged-action-approval.service';
import { AgentFundingGovernanceService } from '../../src/agent/agent-funding-governance.service';
import { AgentFundingService, type FundingInput } from '../../src/agent/agent-funding.service';

/** Real approvals for legacy financial-service fixtures; no posting/approval service is mocked.
 * HTTP entitlement and session provenance are independently tested by phase1-agent-security.
 * Only the suite's explicit trusted fixture gets approvals; negative principals pass through.
 */
export function approvedAgentFunding(
  app: INestApplicationContext,
  trusted: AuthorizationPrincipal,
) {
  const service = app.get(AgentFundingService);
  const governance = app.get(AgentFundingGovernanceService);
  const approvals = app.get(PrivilegedActionApprovalService);
  const pending = new Map<string, Promise<string>>();
  const checker: AuthorizationPrincipal = {
    ...trusted,
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
  async function execute(input: FundingInput, direction: 'FUND' | 'DEFUND') {
    const method = direction === 'FUND' ? 'fund' : 'defund';
    if (input.aggregatorId || input.principal !== trusted) return service[method](input);
    const key = `${direction}:${input.agentId}:${input.idempotencyKey}`;
    let approval = pending.get(key);
    if (!approval) {
      approval = (async () => {
        const requested = await governance.request(
          input,
          direction,
          maker,
          'Synthetic integration-test instruction',
        );
        const approved = await approvals.approve({ approvalId: requested.id, principal: checker });
        if (!approved.approved) throw new Error(`Test approval rejected: ${approved.reason}`);
        return requested.id;
      })();
      pending.set(key, approval);
    }
    return service[method]({ ...input, principal: checker, approvalId: await approval });
  }
  return {
    fund: (input: FundingInput) => execute(input, 'FUND'),
    defund: (input: FundingInput) => execute(input, 'DEFUND'),
  };
}
