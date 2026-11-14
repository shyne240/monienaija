import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import {
  AGENT_INSTITUTION_RESOLVER,
  type AgentInstitutionResolver,
} from '../institution/agent-institution-resolver';
import type {
  InstitutionResolution,
  ResolveInstitutionOptions,
} from '../institution/institution.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cash-Out's institutional dependency.
 *
 * This is no longer a placeholder: it delegates to the single authoritative
 * {@link AGENT_INSTITUTION_RESOLVER} exported by `InstitutionModule`, so the answer is derived only
 * from the authenticated agent identity and the `institution_agent_affiliations` /
 * `financial_institutions` rows — never from an aggregator, outlet, terminal, caller-supplied
 * identifier, token claim or configuration default (ARENA 4 contract §1–§6).
 *
 * Resolution is bound to the caller's transaction (`manager`) and holds SHARE locks, so an
 * affiliation or lifecycle change cannot commit between authorization and the financial posting.
 *
 * When the resolver is not wired at all (unit construction outside Nest), it fails closed as
 * `NOT_CONFIGURED`; it never invents an institution.
 */
export interface CashOutAgentInstitutionPort {
  resolve(
    manager: EntityManager,
    agentId: string,
    options?: ResolveInstitutionOptions,
  ): Promise<InstitutionResolution>;
}

@Injectable()
export class CashOutInstitutionResolver implements CashOutAgentInstitutionPort {
  constructor(
    @Optional()
    @Inject(AGENT_INSTITUTION_RESOLVER)
    private readonly resolver?: AgentInstitutionResolver,
  ) {}

  async resolve(
    manager: EntityManager,
    agentId: string,
    options?: ResolveInstitutionOptions,
  ): Promise<InstitutionResolution> {
    if (!this.resolver) {
      return {
        outcome: 'NOT_CONFIGURED',
        agentId: agentId.trim().toLowerCase(),
        institutionId: null,
        affiliationId: null,
        reason: 'SCHEMA_NOT_CONFIGURED',
        resolvedAt: new Date().toISOString(),
        evidenceFingerprint: '0'.repeat(64),
      };
    }
    return this.resolver.resolve(manager, agentId, options ?? { lock: 'SHARE' });
  }
}

/**
 * Fail-closed institutional scope for a Cash-Out operation.
 *
 * Returns the resolved institution's UUID. Any outcome other than `RESOLVED` — no affiliation, an
 * inactive institution, an invalid affiliation, an unavailable authority — is a 503, and a
 * malformed identity is rejected rather than coerced. There is no default institution and no
 * `MONIENAIJA` sentinel.
 */
export async function requireCashOutInstitutionScope(
  resolver: CashOutAgentInstitutionPort,
  manager: EntityManager,
  agentId: string,
): Promise<string> {
  let result: InstitutionResolution;
  try {
    result = await resolver.resolve(manager, agentId, { lock: 'SHARE' });
  } catch (error) {
    // An authority that cannot answer is unavailable, not a server fault: keep it a 503 so the
    // caller never proceeds on an unresolved institutional context. The reason is preserved so an
    // operator can tell an inactive institution from a revoked affiliation.
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
    throw new ServiceUnavailableException(`Institution authorization unavailable: ${detail}`);
  }
  if (result.outcome !== 'RESOLVED') {
    throw new ServiceUnavailableException('Institution authorization unavailable');
  }
  if (result.agentId !== agentId || !result.institutionId || !UUID.test(result.institutionId)) {
    throw new ServiceUnavailableException('Institution authorization unavailable');
  }
  return result.institutionId;
}
