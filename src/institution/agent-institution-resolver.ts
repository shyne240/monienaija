import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { canonical, sha256 } from '../authorization/workforce-crypto';
import { FinancialInstitutionStatus, InstitutionAffiliationStatus } from './institution.enums';
import type {
  InstitutionEnforcementMode,
  InstitutionResolution,
  InstitutionResolutionOutcome,
  InstitutionUnresolvedReason,
  ResolveInstitutionOptions,
} from './institution.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DI token: consumers depend on this interface, never on a concrete class or on SQL. */
export const AGENT_INSTITUTION_RESOLVER = Symbol('AGENT_INSTITUTION_RESOLVER');

/**
 * The single authoritative institutional-resolution boundary.
 *
 * Contract (consumed by Arena 2's transaction-bound Cash-Out authorization and by Arena 1's
 * financial-commitment work):
 *
 *  1. Resolution is server-side and derived ONLY from the authenticated agent identity plus the
 *     `institution_agent_affiliations` / `financial_institutions` rows. Never from an aggregator,
 *     outlet, terminal, caller-supplied identifier, token claim, configuration default or name.
 *  2. `manager` is mandatory: resolution participates in the caller's transaction, so the answer
 *     belongs to the same snapshot/isolation level as the financial posting.
 *  3. `lock: 'SHARE'` (default) holds row-share locks on the current affiliation and its
 *     institution until the caller's transaction ends. Affiliation and lifecycle changes take
 *     `FOR UPDATE` on the same rows, so a change cannot commit between authorization and posting.
 *  4. The result is a discriminated union. `null`/`undefined` is never returned; absence is
 *     `UNRESOLVED` and non-configuration is `NOT_CONFIGURED`.
 *  5. `evidenceFingerprint` is deterministic over (agent, outcome, institution, affiliation,
 *     reason) and is safe to bind into an idempotency/authorization fingerprint.
 *  6. A caller that re-reads the context later must call {@link revalidate} rather than re-resolve
 *     and treat a different answer as the same operation: a changed context is a new authorization.
 */
export interface AgentInstitutionResolver {
  resolve(
    manager: EntityManager,
    agentId: string,
    options?: ResolveInstitutionOptions,
  ): Promise<InstitutionResolution>;
}

interface ResolutionFingerprintInput {
  readonly agentId: string;
  readonly outcome: InstitutionResolutionOutcome;
  readonly institutionId: string | null;
  readonly affiliationId: string | null;
  readonly reason?: InstitutionUnresolvedReason | null;
}

/** Deterministic digest of one resolution outcome, for evidence/idempotency binding. */
export function institutionResolutionFingerprint(resolution: ResolutionFingerprintInput): string {
  return sha256(
    canonical({
      agentId: resolution.agentId,
      outcome: resolution.outcome,
      institutionId: resolution.institutionId,
      affiliationId: resolution.affiliationId,
      reason: resolution.outcome === 'RESOLVED' ? null : resolution.reason,
    }),
  );
}

function unresolved(
  agentId: string,
  outcome: Exclude<InstitutionResolution['outcome'], 'RESOLVED'>,
  reason: InstitutionUnresolvedReason,
  institutionId: string | null = null,
  affiliationId: string | null = null,
): InstitutionResolution {
  const resolution = {
    outcome,
    agentId,
    institutionId,
    affiliationId,
    reason,
    resolvedAt: new Date().toISOString(),
  } as const;
  return { ...resolution, evidenceFingerprint: institutionResolutionFingerprint(resolution) };
}

interface AffiliationRow {
  id: string;
  institution_id: string;
  status: InstitutionAffiliationStatus;
}

interface InstitutionRow {
  id: string;
  status: FinancialInstitutionStatus;
  deleted_at: string | null;
}

/**
 * Production resolver. Reads the authoritative tables, distinguishes every failure mode and never
 * substitutes a default institution.
 */
@Injectable()
export class DatabaseAgentInstitutionResolver implements AgentInstitutionResolver {
  async resolve(
    manager: EntityManager,
    agentId: string,
    options: ResolveInstitutionOptions = {},
  ): Promise<InstitutionResolution> {
    const normalizedAgentId = agentId?.trim().toLowerCase();
    if (!normalizedAgentId || !UUID_PATTERN.test(normalizedAgentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }

    // A deployment that has not applied the institution foundation cannot resolve authority. This
    // is reported honestly instead of pretending an institution exists.
    const schema: Array<{ present: boolean }> = await manager.query(
      `SELECT to_regclass('public.institution_agent_affiliations') IS NOT NULL AS present`,
    );
    if (!schema[0]?.present) {
      return unresolved(normalizedAgentId, 'NOT_CONFIGURED', 'SCHEMA_NOT_CONFIGURED');
    }

    const lock = options.lock !== 'NONE';
    const affiliations: AffiliationRow[] = await manager.query(
      `SELECT af.id, af.institution_id, af.status
         FROM institution_agent_affiliations af
        WHERE af.agent_id = $1
          AND af.status <> 'TERMINATED'
        ORDER BY af.effective_from DESC
        LIMIT 2${lock ? ' FOR SHARE' : ''}`,
      [normalizedAgentId],
    );

    if (affiliations.length === 0) {
      return unresolved(normalizedAgentId, 'UNRESOLVED', 'NO_AFFILIATION');
    }
    if (affiliations.length > 1) {
      // Structurally impossible under `uq_institution_affiliation_active`; never pick one.
      return unresolved(normalizedAgentId, 'INVALID_AFFILIATION', 'CONFLICTING_AFFILIATION');
    }

    const affiliation = affiliations[0]!;
    if (affiliation.status !== InstitutionAffiliationStatus.ACTIVE) {
      return unresolved(
        normalizedAgentId,
        'UNRESOLVED',
        'AFFILIATION_SUSPENDED',
        affiliation.institution_id,
        affiliation.id,
      );
    }

    const institutions: InstitutionRow[] = await manager.query(
      `SELECT id, status, deleted_at
         FROM financial_institutions
        WHERE id = $1
        LIMIT 1${lock ? ' FOR SHARE' : ''}`,
      [affiliation.institution_id],
    );
    const institution = institutions[0];
    if (!institution) {
      return unresolved(
        normalizedAgentId,
        'INVALID_AFFILIATION',
        'INSTITUTION_MISSING',
        affiliation.institution_id,
        affiliation.id,
      );
    }

    if (
      institution.deleted_at !== null ||
      institution.status === FinancialInstitutionStatus.CLOSED
    ) {
      return unresolved(
        normalizedAgentId,
        'INSTITUTION_INACTIVE',
        'INSTITUTION_CLOSED',
        institution.id,
        affiliation.id,
      );
    }
    if (institution.status === FinancialInstitutionStatus.SUSPENDED) {
      return unresolved(
        normalizedAgentId,
        'INSTITUTION_INACTIVE',
        'INSTITUTION_SUSPENDED',
        institution.id,
        affiliation.id,
      );
    }
    if (institution.status === FinancialInstitutionStatus.REGISTERED) {
      return unresolved(
        normalizedAgentId,
        'INSTITUTION_INACTIVE',
        'INSTITUTION_REGISTERED',
        institution.id,
        affiliation.id,
      );
    }
    if (institution.status === FinancialInstitutionStatus.EVIDENCE_SUBMITTED) {
      return unresolved(
        normalizedAgentId,
        'INSTITUTION_INACTIVE',
        'INSTITUTION_EVIDENCE_SUBMITTED',
        institution.id,
        affiliation.id,
      );
    }
    if (institution.status !== FinancialInstitutionStatus.APPROVED) {
      return unresolved(
        normalizedAgentId,
        'INSTITUTION_INACTIVE',
        'INSTITUTION_SUSPENDED',
        institution.id,
        affiliation.id,
      );
    }

    const resolved = {
      outcome: 'RESOLVED' as const,
      agentId: normalizedAgentId,
      institutionId: institution.id,
      affiliationId: affiliation.id,
      institutionStatus: FinancialInstitutionStatus.APPROVED,
      resolvedAt: new Date().toISOString(),
    };
    return { ...resolved, evidenceFingerprint: institutionResolutionFingerprint(resolved) };
  }
}

/**
 * Explicit non-configured resolver for tests and dry runs ONLY.
 *
 * It never fabricates an institution. It exists so acceptance tests can prove the `NOT_CONFIGURED`
 * branch without dropping tables, and so a deployment can refuse financial execution explicitly
 * rather than silently resolving to a default. Production wiring uses
 * {@link DatabaseAgentInstitutionResolver}; see {@link InstitutionEnforcementPolicy}.
 */
@Injectable()
export class NotConfiguredInstitutionResolver implements AgentInstitutionResolver {
  resolve(_manager: EntityManager, agentId: string): Promise<InstitutionResolution> {
    const normalizedAgentId = agentId?.trim().toLowerCase() ?? '';
    return Promise.resolve(
      unresolved(normalizedAgentId, 'NOT_CONFIGURED', 'SCHEMA_NOT_CONFIGURED'),
    );
  }
}

/**
 * Fail-closed enforcement decision.
 *
 * `ADVISORY` records the outcome without blocking (migration runway only). `ENFORCED` permits a
 * financial operation only for `RESOLVED`. There is no mode that substitutes a default institution
 * or the platform for an unresolved agent.
 */
export class InstitutionEnforcementPolicy {
  constructor(readonly mode: InstitutionEnforcementMode) {}

  /**
   * Reads the deployment mode. Anything other than an explicit `ADVISORY` is treated as
   * `ENFORCED`, so a typo or an unset production value can never weaken the gate.
   */
  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    nodeEnv: string | undefined = process.env.NODE_ENV,
  ): InstitutionEnforcementPolicy {
    const raw = (environment.INSTITUTION_ENFORCEMENT ?? '').trim().toUpperCase();
    if (raw === 'ADVISORY') {
      if (nodeEnv === 'production') {
        throw new ServiceUnavailableException(
          'Institution enforcement may not be advisory in production',
        );
      }
      return new InstitutionEnforcementPolicy('ADVISORY');
    }
    if (raw !== '' && raw !== 'ENFORCED') {
      throw new ServiceUnavailableException(`Unknown INSTITUTION_ENFORCEMENT value: ${raw}`);
    }
    return new InstitutionEnforcementPolicy('ENFORCED');
  }

  assertPermitted(resolution: InstitutionResolution): void {
    if (resolution.outcome === 'RESOLVED') return;
    if (this.mode === 'ENFORCED') {
      throw new ServiceUnavailableException(
        `Institutional authority unavailable: ${resolution.outcome}/${resolution.reason}`,
      );
    }
  }
}

/**
 * Re-reads the institutional context and fails closed if it differs from the context an operation
 * was authorized under. Financial paths call this after taking their locks and before posting.
 */
export async function revalidateInstitutionResolution(
  resolver: AgentInstitutionResolver,
  manager: EntityManager,
  previous: InstitutionResolution,
): Promise<InstitutionResolution> {
  const current = await resolver.resolve(manager, previous.agentId);
  if (
    current.outcome !== previous.outcome ||
    current.institutionId !== previous.institutionId ||
    current.affiliationId !== previous.affiliationId
  ) {
    throw new ServiceUnavailableException(
      'Institutional context changed; the operation must be re-authorized',
    );
  }
  return current;
}
