import type { ForbiddenException } from '@nestjs/common';

import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';

/**
 * Cash-to-Cash precondition machine codes.
 *
 * These paths used to fail with a bare `ForbiddenException`, so a mobile client saw the same shape for
 * every one of them. "The agent is suspended", "this agent class may not perform Cash-to-Cash" and "the
 * customer's KYC has expired" are three different situations with three different remedies; the client
 * needs to tell them apart, and a test asserting only the status code cannot notice if it stops being
 * able to.
 *
 * The assertion below is deliberately about the *code*, and separately about the codes being distinct
 * from one another — a single generic code would satisfy a naive test while recreating the ambiguity.
 */
describe('Cash-to-Cash precondition machine codes', () => {
  /** Minimal queryable that answers the two lookups the assertion makes. */
  function manager(agent: unknown, agentClass: unknown) {
    return {
      query: (sql: string) => {
        if (sql.includes('FROM agents')) return Promise.resolve(agent ? [agent] : []);
        if (sql.includes('FROM agent_classes'))
          return Promise.resolve(agentClass ? [agentClass] : []);
        return Promise.resolve([]);
      },
    };
  }

  const service = Object.create(
    AgentCashToCashClaimService.prototype,
  ) as AgentCashToCashClaimService;
  const assert = (
    managerLike: unknown,
    agentId = '00000000-0000-0000-0000-000000000001',
  ): Promise<string> =>
    (
      service as unknown as {
        assertAgentCashCapabilityWithManager: (m: unknown, id: string) => Promise<string>;
      }
    ).assertAgentCashCapabilityWithManager(managerLike, agentId);

  async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
    try {
      await promise;
      throw new Error('expected a refusal, but the assertion resolved');
    } catch (error) {
      const exception = error as ForbiddenException & {
        code?: string;
        getResponse?: () => unknown;
      };
      const response = exception.getResponse?.() as { error?: string; code?: string } | undefined;
      return {
        status: (exception as unknown as { getStatus?: () => number }).getStatus?.() ?? 0,
        code: exception.code ?? response?.code ?? response?.error ?? '',
      };
    }
  }

  const activeAgent = {
    status: 'ACTIVE',
    deleted_at: null,
    agent_class_id: 'class-1',
  };
  const activeClass = {
    id: 'class-1',
    is_active: true,
    deleted_at: null,
    applicable_services: ['CASH_TO_CASH'],
  };

  it('permits an active agent whose class allows Cash-to-Cash', async () => {
    await expect(assert(manager(activeAgent, activeClass))).resolves.toBe('class-1');
  });

  it('reports a missing agent distinctly from a suspended one', async () => {
    const missing = await codeOf(assert(manager(null, activeClass)));
    const suspended = await codeOf(
      assert(manager({ ...activeAgent, status: 'SUSPENDED' }, activeClass)),
    );
    const deleted = await codeOf(
      assert(manager({ ...activeAgent, deleted_at: '2026-01-01T00:00:00Z' }, activeClass)),
    );
    expect(missing.code).toBe('AGENT_NOT_ACTIVE');
    expect(deleted.code).toBe('AGENT_NOT_ACTIVE');
    expect(suspended.code).toBe('AGENT_SUSPENDED');
    // Both are 403, but the client can tell them apart.
    expect(missing.status).toBe(403);
    expect(suspended.status).toBe(403);
    expect(suspended.code).not.toBe(missing.code);
  });

  it('reports an unconfigured class distinctly from an inactive one', async () => {
    const unconfigured = await codeOf(
      assert(manager({ ...activeAgent, agent_class_id: null }, null)),
    );
    const inactive = await codeOf(
      assert(manager(activeAgent, { ...activeClass, is_active: false })),
    );
    expect(unconfigured.code).toBe('AGENT_CLASS_NOT_CONFIGURED');
    expect(inactive.code).toBe('AGENT_CLASS_INACTIVE');
    expect(unconfigured.code).not.toBe(inactive.code);
  });

  it('reports a disallowed service distinctly from a malformed class configuration', async () => {
    const notPermitted = await codeOf(
      assert(manager(activeAgent, { ...activeClass, applicable_services: ['CASH_IN'] })),
    );
    const malformed = await codeOf(
      assert(manager(activeAgent, { ...activeClass, applicable_services: [42] })),
    );
    expect(notPermitted.code).toBe('AGENT_CLASS_SERVICE_NOT_PERMITTED');
    expect(malformed.code).toBe('AGENT_CLASS_CONFIGURATION_INVALID');
    expect(notPermitted.code).not.toBe(malformed.code);
  });

  it('exposes every precondition code as both .code and body.error', async () => {
    const exception = await assert(manager(null, activeClass)).catch((error) => error as never);
    const typed = exception as unknown as { code?: string; getResponse: () => { error?: string } };
    // Both shapes, because clients in this codebase read either one.
    expect(typed.code).toBe('AGENT_NOT_ACTIVE');
    expect(typed.getResponse().error).toBe('AGENT_NOT_ACTIVE');
  });
});
