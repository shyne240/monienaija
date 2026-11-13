import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  CashOutInstitutionResolver,
  requireTransitionalCashOutScope,
  type CashOutAgentInstitutionPort,
} from '../src/agent/cash-out-institution.resolver';

describe('Cash-out institution boundary', () => {
  const manager = {} as EntityManager;
  const agentId = randomUUID();
  const evidence = {
    agentId,
    institutionId: null,
    affiliationId: null,
    resolvedAt: '2026-01-01T00:00:00.000Z',
    evidenceFingerprint: 'fixture',
  };
  test('unconfigured resolver never supplies an institution', async () => {
    const resolver = new CashOutInstitutionResolver();
    expect(await resolver.resolve(manager, agentId, { lock: 'SHARE' })).toMatchObject({
      outcome: 'NOT_CONFIGURED',
      institutionId: null,
      affiliationId: null,
      reason: 'SCHEMA_NOT_CONFIGURED',
    });
    await expect(requireTransitionalCashOutScope(resolver, manager, agentId)).rejects.toThrow();
  });
  test.each([
    'UNRESOLVED',
    'NOT_CONFIGURED',
    'INSTITUTION_INACTIVE',
    'INVALID_AFFILIATION',
  ] as const)('%s fails closed with a shared transaction lock request', async (outcome) => {
    const resolve = jest.fn().mockResolvedValue({ ...evidence, outcome, reason: 'fixture' });
    const port: CashOutAgentInstitutionPort = { resolve };
    await expect(requireTransitionalCashOutScope(port, manager, agentId)).rejects.toThrow();
    expect(resolve).toHaveBeenCalledWith(manager, agentId, { lock: 'SHARE' });
  });
  test('a real resolved affiliation alone cannot enable cash-out', async () => {
    const port: CashOutAgentInstitutionPort = {
      resolve: () =>
        Promise.resolve({
          ...evidence,
          outcome: 'RESOLVED',
          institutionId: randomUUID(),
          affiliationId: randomUUID(),
          institutionStatus: 'APPROVED',
        }),
    };
    await expect(requireTransitionalCashOutScope(port, manager, agentId)).rejects.toThrow();
  });
});
