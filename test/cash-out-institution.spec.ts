import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  CashOutInstitutionResolver,
  requireCashOutInstitutionScope,
  type CashOutAgentInstitutionPort,
} from '../src/agent/cash-out-institution.resolver';
import { FinancialInstitutionStatus } from '../src/institution/institution.enums';
import type { InstitutionResolution } from '../src/institution/institution.types';

describe('Cash-out institution boundary (authoritative resolver)', () => {
  const manager = {} as EntityManager;
  const agentId = randomUUID();
  const institutionId = randomUUID();
  const evidence = {
    agentId,
    institutionId: null,
    affiliationId: null,
    resolvedAt: '2026-01-01T00:00:00.000Z',
    evidenceFingerprint: 'a'.repeat(64),
  };
  const resolved = (): InstitutionResolution => ({
    ...evidence,
    outcome: 'RESOLVED',
    institutionId,
    affiliationId: randomUUID(),
    institutionStatus: FinancialInstitutionStatus.APPROVED,
  });

  test('without a wired authority the resolver never supplies an institution', async () => {
    const resolver = new CashOutInstitutionResolver();
    expect(await resolver.resolve(manager, agentId, { lock: 'SHARE' })).toMatchObject({
      outcome: 'NOT_CONFIGURED',
      institutionId: null,
      affiliationId: null,
      reason: 'SCHEMA_NOT_CONFIGURED',
    });
    await expect(requireCashOutInstitutionScope(resolver, manager, agentId)).rejects.toThrow(
      'Institution authorization unavailable',
    );
  });

  test('delegates to the authoritative resolver under a shared transaction lock', async () => {
    const resolve = jest.fn().mockResolvedValue(resolved());
    const port: CashOutAgentInstitutionPort = { resolve };
    await expect(requireCashOutInstitutionScope(port, manager, agentId)).resolves.toBe(
      institutionId,
    );
    expect(resolve).toHaveBeenCalledWith(manager, agentId, { lock: 'SHARE' });
  });

  test.each([
    'UNRESOLVED',
    'NOT_CONFIGURED',
    'INSTITUTION_INACTIVE',
    'INVALID_AFFILIATION',
  ] as const)('%s fails closed', async (outcome) => {
    const resolve = jest.fn().mockResolvedValue({ ...evidence, outcome, reason: 'fixture' });
    const port: CashOutAgentInstitutionPort = { resolve };
    await expect(requireCashOutInstitutionScope(port, manager, agentId)).rejects.toThrow(
      'Institution authorization unavailable',
    );
    expect(resolve).toHaveBeenCalledWith(manager, agentId, { lock: 'SHARE' });
  });

  test('a resolved affiliation alone is enough to scope cash-out, and yields the real institution', async () => {
    const port: CashOutAgentInstitutionPort = { resolve: () => Promise.resolve(resolved()) };
    await expect(requireCashOutInstitutionScope(port, manager, agentId)).resolves.toBe(
      institutionId,
    );
  });

  test.each([
    ['a non-UUID institution', { institutionId: 'MONIENAIJA' }],
    ['a missing institution', { institutionId: null }],
    ['another agent identity', { agentId: randomUUID() }],
  ] as const)('rejects %s rather than coercing it', async (_label, override) => {
    const port: CashOutAgentInstitutionPort = {
      resolve: () => Promise.resolve({ ...resolved(), ...override } as InstitutionResolution),
    };
    await expect(requireCashOutInstitutionScope(port, manager, agentId)).rejects.toThrow(
      'Institution authorization unavailable',
    );
  });
});
