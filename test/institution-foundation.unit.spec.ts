/**
 * ARENA 4 Phase 1 — institutional foundation contract unit tests.
 *
 * These pin the parts of the design that must never silently weaken, independent of PostgreSQL:
 * the fail-closed enforcement policy, the deterministic resolution/affiliation fingerprints, the
 * revalidation contract and the governed-action registration that binds each approval to its
 * resource type.
 */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import {
  DatabaseAgentInstitutionResolver,
  InstitutionEnforcementPolicy,
  NotConfiguredInstitutionResolver,
  institutionResolutionFingerprint,
  revalidateInstitutionResolution,
  type AgentInstitutionResolver,
} from '../src/institution/agent-institution-resolver';
import { institutionAffiliationFingerprint } from '../src/institution/institution-affiliation.service';
import { institutionLifecycleFingerprint } from '../src/institution/financial-institution.service';
import type { InstitutionResolution } from '../src/institution/institution.types';
import {
  FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE_ACTION,
  INSTITUTION_AGENT_AFFILIATION_CHANGE_ACTION,
  governedAction,
  isGovernedAction,
} from '../src/authorization/governed-action.registry';

const AGENT = '11111111-1111-4111-8111-111111111111';
const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const AFFILIATION = '33333333-3333-4333-8333-333333333333';

const resolved = (): InstitutionResolution => {
  const base = {
    outcome: 'RESOLVED' as const,
    agentId: AGENT,
    institutionId: INSTITUTION,
    affiliationId: AFFILIATION,
    institutionStatus: 'APPROVED' as never,
    resolvedAt: '2026-11-13T00:00:00.000Z',
  };
  return { ...base, evidenceFingerprint: institutionResolutionFingerprint(base) };
};

const unresolved = (
  outcome: 'UNRESOLVED' | 'NOT_CONFIGURED' | 'INSTITUTION_INACTIVE',
  reason: 'NO_AFFILIATION' | 'SCHEMA_NOT_CONFIGURED' | 'INSTITUTION_SUSPENDED',
): InstitutionResolution => {
  const base = {
    outcome,
    agentId: AGENT,
    institutionId: null,
    affiliationId: null,
    reason,
    resolvedAt: '2026-11-13T00:00:00.000Z',
  };
  return { ...base, evidenceFingerprint: institutionResolutionFingerprint(base) };
};

describe('Institution enforcement policy (fail-closed)', () => {
  it('permits a RESOLVED context and refuses every other outcome when enforced', () => {
    const policy = new InstitutionEnforcementPolicy('ENFORCED');
    expect(() => policy.assertPermitted(resolved())).not.toThrow();
    for (const outcome of [
      unresolved('UNRESOLVED', 'NO_AFFILIATION'),
      unresolved('INSTITUTION_INACTIVE', 'INSTITUTION_SUSPENDED'),
      unresolved('NOT_CONFIGURED', 'SCHEMA_NOT_CONFIGURED'),
    ]) {
      expect(() => policy.assertPermitted(outcome)).toThrow(ServiceUnavailableException);
    }
  });

  it('is advisory only when explicitly requested, and never in production', () => {
    expect(
      new InstitutionEnforcementPolicy('ADVISORY').assertPermitted(
        unresolved('UNRESOLVED', 'NO_AFFILIATION'),
      ),
    ).toBeUndefined();

    // Unset or unrecognized values resolve to ENFORCED, never to a weaker mode.
    expect(InstitutionEnforcementPolicy.fromEnvironment({}, 'production').mode).toBe('ENFORCED');
    expect(InstitutionEnforcementPolicy.fromEnvironment({}, 'test').mode).toBe('ENFORCED');
    expect(
      InstitutionEnforcementPolicy.fromEnvironment({ INSTITUTION_ENFORCEMENT: 'advisory' }, 'test')
        .mode,
    ).toBe('ADVISORY');

    expect(() =>
      InstitutionEnforcementPolicy.fromEnvironment(
        { INSTITUTION_ENFORCEMENT: 'ADVISORY' },
        'production',
      ),
    ).toThrow(ServiceUnavailableException);
    expect(() =>
      InstitutionEnforcementPolicy.fromEnvironment({ INSTITUTION_ENFORCEMENT: 'relaxed' }, 'test'),
    ).toThrow(ServiceUnavailableException);
  });
});

describe('Institution resolution contract', () => {
  it('fingerprints deterministically and distinguishes outcomes and institutions', () => {
    expect(institutionResolutionFingerprint(resolved() as never)).toBe(
      institutionResolutionFingerprint(resolved() as never),
    );
    expect(institutionResolutionFingerprint(resolved() as never)).toMatch(/^[a-f0-9]{64}$/);

    const other = {
      ...resolved(),
      institutionId: '44444444-4444-4444-8444-444444444444',
    } as InstitutionResolution;
    expect(institutionResolutionFingerprint(other as never)).not.toBe(
      institutionResolutionFingerprint(resolved() as never),
    );
    expect(
      institutionResolutionFingerprint(unresolved('UNRESOLVED', 'NO_AFFILIATION') as never),
    ).not.toBe(institutionResolutionFingerprint(resolved() as never));
  });

  it('revalidates the same context and fails closed when it changed', async () => {
    const current = resolved();
    const stable: AgentInstitutionResolver = { resolve: () => Promise.resolve(current) };
    await expect(revalidateInstitutionResolution(stable, {} as never, current)).resolves.toBe(
      current,
    );

    const changed: AgentInstitutionResolver = {
      resolve: () =>
        Promise.resolve({
          ...resolved(),
          institutionId: '55555555-5555-4555-8555-555555555555',
        }),
    };
    await expect(revalidateInstitutionResolution(changed, {} as never, current)).rejects.toThrow(
      ServiceUnavailableException,
    );

    const downgraded: AgentInstitutionResolver = {
      resolve: () => Promise.resolve(unresolved('UNRESOLVED', 'NO_AFFILIATION')),
    };
    await expect(revalidateInstitutionResolution(downgraded, {} as never, current)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a non-UUID agent id instead of guessing', async () => {
    const resolver = new DatabaseAgentInstitutionResolver();
    await expect(resolver.resolve({} as never, 'not-a-uuid')).rejects.toThrow(BadRequestException);
    await expect(resolver.resolve({} as never, '')).rejects.toThrow(BadRequestException);
  });

  it('never fabricates an institution in the explicit non-configured resolver', async () => {
    const resolver = new NotConfiguredInstitutionResolver();
    const result = await resolver.resolve({} as never, AGENT);
    expect(result.outcome).toBe('NOT_CONFIGURED');
    expect(result.institutionId).toBeNull();
    expect(result.affiliationId).toBeNull();
    expect((result as { reason: string }).reason).toBe('SCHEMA_NOT_CONFIGURED');
  });
});

describe('Governed action registration', () => {
  it('registers both institutional actions with matching approval resource types', () => {
    expect(isGovernedAction('INSTITUTION_AGENT_AFFILIATION_CHANGE')).toBe(true);
    expect(isGovernedAction('FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE')).toBe(true);

    const affiliation = governedAction('INSTITUTION_AGENT_AFFILIATION_CHANGE')!;
    expect(affiliation.resourceType).toBe('AGENT');
    expect(affiliation.minimumAssurance).toBe('MFA');
    expect(affiliation.selfApprovalProhibited).toBe(true);
    expect(affiliation.minimumApprovals).toBe(1);
    expect(affiliation.approvalScope).toBe('privileged:approve');
    expect(affiliation).toBe(INSTITUTION_AGENT_AFFILIATION_CHANGE_ACTION);

    const lifecycle = governedAction('FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE')!;
    expect(lifecycle.resourceType).toBe('FINANCIAL_INSTITUTION');
    expect(lifecycle.mfaRequired).toBe(true);
    expect(lifecycle.selfApprovalProhibited).toBe(true);
    expect(lifecycle).toBe(FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE_ACTION);

    // The maker and checker are always different roles — never the same function/role on both sides.
    expect(lifecycle.initiatingRoles).not.toEqual(lifecycle.approvingRoles);
    expect(affiliation.initiatingRoles).not.toEqual(affiliation.approvingRoles);
  });
});

describe('Governed change fingerprints', () => {
  const base = {
    agentId: AGENT,
    institutionId: INSTITUTION,
    changeKind: 'ASSIGN' as never,
    evidenceType: 'INSTITUTION_APPROVAL_LETTER' as never,
    evidenceReference: 'AFF-1',
    reason: 'Agent appointed under the institution approval letter on file',
  };

  it('binds the request to the affiliation state the checker saw', () => {
    const withoutAffiliation = institutionAffiliationFingerprint({
      ...base,
      currentAffiliationId: null,
      currentInstitutionId: null,
    });
    const withAffiliation = institutionAffiliationFingerprint({
      ...base,
      currentAffiliationId: AFFILIATION,
      currentInstitutionId: INSTITUTION,
    });
    expect(withoutAffiliation).toMatch(/^[a-f0-9]{64}$/);
    expect(withoutAffiliation).not.toBe(withAffiliation);
  });

  it('binds a lifecycle request to the current and target status', () => {
    const approve = institutionLifecycleFingerprint({
      institutionId: INSTITUTION,
      targetStatus: 'APPROVED',
      currentStatus: 'EVIDENCE_SUBMITTED',
      reason: 'evidence verified',
    });
    expect(approve).toMatch(/^[a-f0-9]{64}$/);
    expect(
      institutionLifecycleFingerprint({
        institutionId: INSTITUTION,
        targetStatus: 'SUSPENDED',
        currentStatus: 'EVIDENCE_SUBMITTED',
        reason: 'evidence verified',
      }),
    ).not.toBe(approve);
    expect(
      institutionLifecycleFingerprint({
        institutionId: INSTITUTION,
        targetStatus: 'APPROVED',
        currentStatus: 'REGISTERED',
        reason: 'evidence verified',
      }),
    ).not.toBe(approve);
  });
});
