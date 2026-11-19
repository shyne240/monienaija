import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { assertWalletOwnership, walletOwnershipBinding } from '../src/wallet/wallet-ownership';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';

const agent: AuthorizationPrincipal = {
  type: 'AGENT',
  principalId: 'agent-a',
  agentId: '11111111-1111-4111-8111-111111111111',
  roles: [],
  scopes: [],
  customerAccess: 'NONE',
  agentAccess: 'SELF',
};

describe('agent-self wallet ownership', () => {
  it('derives the binding from the authenticated agent, never an internal authority', () => {
    expect(walletOwnershipBinding(agent)).toEqual({ kind: 'AGENT_SELF', agentId: agent.agentId });
    expect(() => walletOwnershipBinding({ ...agent, agentId: undefined })).toThrow(
      ForbiddenException,
    );
  });

  it('does not let a customer binding impersonate an agent with the same identifier', () => {
    const binding = { kind: 'CUSTOMER_SELF' as const, customerId: agent.agentId! };
    expect(() => assertWalletOwnership(binding, agent.agentId, 'AGENT')).toThrow(NotFoundException);
    expect(() => assertWalletOwnership(binding, agent.agentId, 'CUSTOMER')).not.toThrow();
  });

  it('requires both the agent owner reference and AGENT classification', () => {
    const binding = walletOwnershipBinding(agent);
    expect(() => assertWalletOwnership(binding, agent.agentId, 'AGENT')).not.toThrow();
    expect(() =>
      assertWalletOwnership(binding, '22222222-2222-4222-8222-222222222222', 'AGENT'),
    ).toThrow(NotFoundException);
    expect(() => assertWalletOwnership(binding, agent.agentId, 'CUSTOMER')).toThrow(
      NotFoundException,
    );
    expect(() => assertWalletOwnership(binding, agent.agentId)).toThrow(NotFoundException);
  });
});
