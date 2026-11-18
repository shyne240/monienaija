/**
 * ARENA 3D Group 13 — disaster recovery and business continuity.
 *
 * ## The question this answers
 *
 * After a restore, which in-flight work is safe to resume?
 *
 * Every other part of recovery is about bringing data back. This part is about the opposite risk: a
 * restored system that cheerfully continues where it left off will **re-send** any external operation
 * whose outcome was never established. The database said "SUBMITTING". The provider may have received
 * it, executed it, and replied to a process that no longer exists. Resubmitting produces a second
 * transfer.
 *
 * So the rule this module enforces is: **an operation whose external outcome is unknown is never
 * resubmitted by recovery.** It is routed to verification or manual review, where a human or a
 * reconciliation run establishes what actually happened at the provider. Recovery restores *state*; it
 * does not replay *intent*.
 *
 * ## Objectives are configuration, not constants
 *
 * RPO and RTO are business decisions that differ per environment and per institution, and hard-coding
 * them would mean the readiness report states a target nobody agreed to. They are read from
 * configuration; when they are absent the report says the objective is **not configured** rather than
 * substituting a plausible-looking default. A guessed RPO is worse than no RPO, because it reads like a
 * commitment.
 */
import { Injectable, Optional } from '@nestjs/common';

import { ExternalOperationLifecycleState } from '../partner/external-operation-lifecycle.enums';

/**
 * The subset of states in which resuming work is unconditionally safe.
 *
 * Anything not listed here is treated as unsafe. This is a deliberate allowlist: a new lifecycle state
 * added later is unsafe until someone decides otherwise, rather than safe because nobody remembered to
 * exclude it.
 */
const SAFE_TO_RESUME: ReadonlySet<ExternalOperationLifecycleState> = new Set([
  // Never left the building, so there is nothing at the provider to duplicate.
  ExternalOperationLifecycleState.CREATED,
  // Terminal states are complete; "resuming" one means nothing.
  ExternalOperationLifecycleState.FAILED,
  ExternalOperationLifecycleState.CANCELLED,
]);

/**
 * States that must never be resumed without external verification.
 *
 * Named explicitly, and asserted against `SAFE_TO_RESUME` in tests, so the two lists cannot drift into
 * overlap.
 */
const REQUIRES_VERIFICATION_BEFORE_RESUME: readonly ExternalOperationLifecycleState[] = [
  // The request was written; whether it was sent is unknown.
  ExternalOperationLifecycleState.SUBMITTING,
  // Sent, acknowledged, awaiting the provider's asynchronous outcome.
  ExternalOperationLifecycleState.PENDING_PROVIDER,
  // Sent; the response never arrived. This is the dangerous one.
  ExternalOperationLifecycleState.PENDING_VERIFICATION,
  // Explicitly unknown outcome — a timeout after send.
  ExternalOperationLifecycleState.UNKNOWN,
  // Escalated to a human precisely because the outcome could not be established.
  ExternalOperationLifecycleState.MANUAL_REVIEW,
];

export interface RecoveryObjective {
  /** Recovery point objective in seconds. The maximum acceptable data loss. */
  rpoSeconds: number | null;
  /** Recovery time objective in seconds. The maximum acceptable outage. */
  rtoSeconds: number | null;
  /** Where the value came from, so the report can be audited. */
  source: 'configured' | 'not-configured';
}

export interface RecoveryObjectives {
  database: RecoveryObjective;
  /** Time to rebuild the application tier. */
  application: RecoveryObjective;
  /** Time to re-establish provider connectivity and drain verification. */
  providerConnectivity: RecoveryObjective;
}

export interface RecoveryReadinessReport {
  status: 'ready' | 'objectives-not-configured' | 'not-ready';
  objectives: RecoveryObjectives;
  /** Categories with a configured objective, out of the total that need one. */
  configuredObjectives: number;
  totalObjectives: number;
  /** Named gaps. Each is a statement of what is missing, not a suggestion. */
  gaps: string[];
  /** The resume policy, stated so an operator can read it without opening the source. */
  resumePolicy: {
    safeStates: string[];
    requiresVerificationStates: string[];
    statement: string;
  };
}

export interface RecoveryObjectiveConfiguration {
  RECOVERY_RPO_SECONDS?: string;
  RECOVERY_RTO_SECONDS?: string;
  RECOVERY_APPLICATION_RTO_SECONDS?: string;
  RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS?: string;
}

function objectiveFrom(raw: string | undefined): RecoveryObjective {
  if (raw === undefined || raw.trim() === '') {
    return { rpoSeconds: null, rtoSeconds: null, source: 'not-configured' };
  }
  const parsed = Number(raw);
  // A non-numeric or negative objective is a configuration error, not an objective of zero. Treating it
  // as zero would claim instant recovery.
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { rpoSeconds: null, rtoSeconds: null, source: 'not-configured' };
  }
  return { rpoSeconds: null, rtoSeconds: parsed, source: 'configured' };
}

function rpoFrom(raw: string | undefined): RecoveryObjective {
  if (raw === undefined || raw.trim() === '') {
    return { rpoSeconds: null, rtoSeconds: null, source: 'not-configured' };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { rpoSeconds: null, rtoSeconds: null, source: 'not-configured' };
  }
  return { rpoSeconds: parsed, rtoSeconds: null, source: 'configured' };
}

export function recoveryObjectivesFrom(
  environment: RecoveryObjectiveConfiguration,
): RecoveryObjectives {
  const databaseRpo = rpoFrom(environment.RECOVERY_RPO_SECONDS);
  const databaseRto = objectiveFrom(environment.RECOVERY_RTO_SECONDS);
  return {
    database: {
      rpoSeconds: databaseRpo.rpoSeconds,
      rtoSeconds: databaseRto.rtoSeconds,
      source:
        databaseRpo.source === 'configured' && databaseRto.source === 'configured'
          ? 'configured'
          : 'not-configured',
    },
    application: objectiveFrom(environment.RECOVERY_APPLICATION_RTO_SECONDS),
    providerConnectivity: objectiveFrom(environment.RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS),
  };
}

@Injectable()
export class DisasterRecoveryService {
  constructor(
    @Optional()
    private readonly environment?: RecoveryObjectiveConfiguration,
  ) {}

  /** Falls back to the process environment, read lazily so importing this module has no side effects. */
  private configuration(): RecoveryObjectiveConfiguration {
    return this.environment ?? (process.env as RecoveryObjectiveConfiguration);
  }

  objectives(): RecoveryObjectives {
    return recoveryObjectivesFrom(this.configuration());
  }

  /**
   * Whether a single operation may be resumed by recovery.
   *
   * Returns a reason either way, because an operator asking "why is this stuck?" needs the answer to be
   * in the output rather than in the source.
   */
  resumeDecision(state: ExternalOperationLifecycleState): {
    resumable: boolean;
    reason: string;
    action: 'resume' | 'verify-with-provider' | 'manual-review';
  } {
    if (SAFE_TO_RESUME.has(state)) {
      return {
        resumable: true,
        reason: `state ${state} never established a provider-side effect`,
        action: 'resume',
      };
    }
    if (state === ExternalOperationLifecycleState.MANUAL_REVIEW) {
      return {
        resumable: false,
        reason: 'operation is already escalated; a human must establish the outcome',
        action: 'manual-review',
      };
    }
    return {
      resumable: false,
      reason:
        `state ${state} may have reached the provider. Resubmitting risks a duplicate external ` +
        'effect; the outcome must be established before any further submission.',
      action: 'verify-with-provider',
    };
  }

  /**
   * The readiness report.
   *
   * `status` is deliberately three-valued. `objectives-not-configured` is not the same as `not-ready`:
   * the system may be perfectly capable of recovering, while nobody has agreed what "recovered" means in
   * time terms. Collapsing the two would either overstate readiness or imply a technical fault where the
   * gap is a decision.
   */
  readiness(): RecoveryReadinessReport {
    const objectives = this.objectives();
    const gaps: string[] = [];

    let configured = 0;
    if (objectives.database.rpoSeconds === null) {
      gaps.push('database recovery point objective (RECOVERY_RPO_SECONDS) is not configured');
    } else {
      configured += 1;
    }
    if (objectives.database.rtoSeconds === null) {
      gaps.push('database recovery time objective (RECOVERY_RTO_SECONDS) is not configured');
    } else {
      configured += 1;
    }
    if (objectives.application.rtoSeconds === null) {
      gaps.push(
        'application recovery time objective (RECOVERY_APPLICATION_RTO_SECONDS) is not configured',
      );
    } else {
      configured += 1;
    }
    if (objectives.providerConnectivity.rtoSeconds === null) {
      gaps.push(
        'provider connectivity recovery time objective ' +
          '(RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS) is not configured',
      );
    } else {
      configured += 1;
    }

    const total = 4;
    const status =
      configured === 0 ? 'objectives-not-configured' : configured < total ? 'not-ready' : 'ready';

    return {
      status,
      objectives,
      configuredObjectives: configured,
      totalObjectives: total,
      gaps,
      resumePolicy: {
        safeStates: [...SAFE_TO_RESUME],
        requiresVerificationStates: [...REQUIRES_VERIFICATION_BEFORE_RESUME],
        statement:
          'An external operation whose provider-side outcome is not established is never resubmitted ' +
          'by recovery. It is verified with the provider or escalated to manual review. Recovery ' +
          'restores state; it does not replay intent.',
      },
    };
  }
}

/** Exposed for tests so the two lists can be proven disjoint and exhaustive. */
export const RECOVERY_RESUME_STATE_SETS = {
  safe: SAFE_TO_RESUME,
  requiresVerification: REQUIRES_VERIFICATION_BEFORE_RESUME,
} as const;
