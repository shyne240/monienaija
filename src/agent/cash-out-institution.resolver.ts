import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { canonical, sha256 } from '../authorization/workforce-crypto';

/** Structural subset of Arena 4's published AgentInstitutionResolver contract.
 * Integration must replace this placeholder with InstitutionModule's exported token;
 * the actual foundation owns the authoritative types and implementation. */
export interface CashOutAgentInstitutionPort {
  resolve(
    manager: EntityManager,
    agentId: string,
    options?: { readonly lock?: 'SHARE' | 'NONE' },
  ): Promise<{
    readonly outcome:
      | 'RESOLVED'
      | 'UNRESOLVED'
      | 'NOT_CONFIGURED'
      | 'INSTITUTION_INACTIVE'
      | 'INVALID_AFFILIATION';
    readonly agentId: string;
    readonly institutionId: string | null;
    readonly affiliationId: string | null;
    readonly resolvedAt: string;
    readonly evidenceFingerprint: string;
    readonly reason?: string;
    readonly institutionStatus?: string;
  }>;
}

/** Missing foundation never invents an institution. */
@Injectable()
export class CashOutInstitutionResolver implements CashOutAgentInstitutionPort {
  resolve(
    _manager: EntityManager,
    agentId: string,
    _options?: { readonly lock?: 'SHARE' | 'NONE' },
  ): ReturnType<CashOutAgentInstitutionPort['resolve']> {
    void _options;
    const normalized = agentId.trim().toLowerCase();
    const evidence = {
      agentId: normalized,
      outcome: 'NOT_CONFIGURED' as const,
      institutionId: null,
      affiliationId: null,
      reason: 'SCHEMA_NOT_CONFIGURED',
    };
    return Promise.resolve({
      ...evidence,
      resolvedAt: new Date().toISOString(),
      evidenceFingerprint: sha256(canonical(evidence)),
    });
  }
}

/** Current database schema is a test-only sentinel, not an institutional identity.
 * Even RESOLVED real affiliations must fail closed until wallet isolation is integrated. */
export async function requireTransitionalCashOutScope(
  resolver: CashOutAgentInstitutionPort,
  manager: EntityManager,
  agentId: string,
): Promise<string> {
  const result = await resolver.resolve(manager, agentId, { lock: 'SHARE' });
  if (
    result.outcome !== 'RESOLVED' ||
    result.agentId !== agentId ||
    result.institutionId !== 'MONIENAIJA'
  )
    throw new ServiceUnavailableException('Institution authorization unavailable');
  return 'MONIENAIJA';
}
