import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicyRequirementMode,
  PolicySourceClass,
} from './capability-policy.enums';
import {
  calculatePolicyDecisionReference,
  calculatePolicyDecisionResultHash,
  calculatePolicyRequestHash,
  calculateSnapshotInputHash,
  CapabilityPolicyEvaluationService,
} from './capability-policy.service';
import type {
  CapabilityPolicyProfile,
  PolicyAuditPort,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyPort,
  PolicyIdempotencyReservation,
  PolicyProfileRegistry,
} from './capability-policy.types';
import {
  PolicyCurrentnessState,
  PolicyProfileVersionState,
  PolicyRecoveryState,
  PolicyReevaluationState,
  PolicyReevaluationTrigger,
} from './capability-policy-recovery.enums';
import type {
  PolicyCurrentEffectiveDecisionRequest,
  PolicyCurrentEffectiveDecisionResult,
  PolicyCurrentEvidencePort,
  PolicyCurrentEvidenceRequest,
  PolicyDecisionEvaluator,
  PolicyDecisionLifecycleStore,
  PolicyEvidenceFreshnessAssessment,
  PolicyProfileLifecyclePort,
  PolicyRecoveryClock,
  PolicyRecoveryDiagnostic,
  PolicyRecoveryDiagnosticsPort,
  PolicyRecoveryRetryConfiguration,
  PolicyRecoveryServiceOptions,
  PolicyReevaluationRecovery,
  PolicyReevaluationRequest,
  PolicyReevaluationResult,
} from './capability-policy-recovery.types';
import {
  POLICY_REEVALUATION_CONTRACT,
  POLICY_REEVALUATION_CONTRACT_VERSION,
  POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
} from './capability-policy-recovery.types';

const POLICY_DECISION_IDEMPOTENCY_SCOPE = 'policy.capability-decision.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,2}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MILLISECONDS = 25;
const DEFAULT_MAX_DELAY_MILLISECONDS = 250;
const DEFAULT_MAX_CONCURRENT_EVALUATIONS = 8;

const FRESHNESS_ORDER: readonly PolicyEvidenceFreshnessState[] = [
  PolicyEvidenceFreshnessState.CURRENT,
  PolicyEvidenceFreshnessState.STALE,
  PolicyEvidenceFreshnessState.MISSING,
  PolicyEvidenceFreshnessState.DELETED,
  PolicyEvidenceFreshnessState.CONFLICTING,
  PolicyEvidenceFreshnessState.UNAVAILABLE,
  PolicyEvidenceFreshnessState.RESTRICTED,
];

const RETRYABLE_CODES = new Set([
  'A4_EVIDENCE_UNAVAILABLE',
  'A4_SNAPSHOT_UNAVAILABLE',
  'A4_STORAGE_UNAVAILABLE',
  'A4_SERIALIZATION_RETRY',
  'A4_TRANSIENT_FAILURE',
]);

export class PolicyRetryableRecoveryError extends Error {
  readonly retryable = true;
  readonly unknownOutcome: boolean;
  readonly recoveryCode: string;

  constructor(recoveryCode = 'A4_TRANSIENT_FAILURE', unknownOutcome = false) {
    super(recoveryCode);
    this.name = 'PolicyRetryableRecoveryError';
    this.recoveryCode = recoveryCode;
    this.unknownOutcome = unknownOutcome;
  }
}

export class PolicyUnknownRecoveryOutcomeError extends PolicyRetryableRecoveryError {
  override readonly unknownOutcome = true;

  constructor(recoveryCode = 'A4_UNKNOWN_OUTCOME') {
    super(recoveryCode, true);
    this.name = 'PolicyUnknownRecoveryOutcomeError';
  }
}

const SYSTEM_CLOCK: PolicyRecoveryClock = {
  now: () => new Date(),
  sleep: async (milliseconds: number): Promise<void> => {
    if (milliseconds <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  },
};

const DEFAULT_PROFILE_LIFECYCLE: PolicyProfileLifecyclePort = {
  getVersionState: () => Promise.resolve(PolicyProfileVersionState.ACTIVE),
  getCurrentPolicyVersion: () => Promise.resolve(null),
};

export function assessPolicyEvidenceFreshness(
  snapshot: Readonly<PolicyEvidenceSnapshot>,
  profile: CapabilityPolicyProfile,
  request: Pick<PolicyEvaluationCommand, 'evaluationContext'>,
): PolicyEvidenceFreshnessAssessment {
  let integrityValid = false;
  try {
    integrityValid =
      HASH_PATTERN.test(snapshot.evidenceSummary.normalizedInputHash) &&
      calculateSnapshotInputHash(snapshot) === snapshot.evidenceSummary.normalizedInputHash;
  } catch {
    integrityValid = false;
  }

  const degraded = new Map<PolicySourceClass, PolicyEvidenceFreshnessState>();
  const reasonCodes = new Set<string>();
  const setDegraded = (
    sourceClass: PolicySourceClass,
    freshnessState: PolicyEvidenceFreshnessState,
  ): void => {
    const existing = degraded.get(sourceClass);
    if (
      existing === undefined ||
      FRESHNESS_ORDER.indexOf(freshnessState) > FRESHNESS_ORDER.indexOf(existing)
    ) {
      degraded.set(sourceClass, freshnessState);
    }
    reasonCodes.add(`EVIDENCE_${sourceClass}_${freshnessState}`);
  };

  if (!integrityValid) {
    reasonCodes.add('EVIDENCE_SNAPSHOT_INTEGRITY_MISMATCH');
  }
  if (snapshot.collection.status === PolicyCollectionStatus.UNAVAILABLE) {
    reasonCodes.add('EVIDENCE_COLLECTION_UNAVAILABLE');
  } else if (snapshot.collection.status === PolicyCollectionStatus.INCOMPLETE) {
    reasonCodes.add('EVIDENCE_COLLECTION_INCOMPLETE');
  }
  for (const sourceClass of snapshot.collection.conflictSourceClasses) {
    setDegraded(sourceClass, PolicyEvidenceFreshnessState.CONFLICTING);
  }
  for (const sourceClass of snapshot.collection.unavailableSourceClasses) {
    setDegraded(sourceClass, PolicyEvidenceFreshnessState.UNAVAILABLE);
  }
  for (const sourceClass of snapshot.collection.restrictedSourceClasses) {
    setDegraded(sourceClass, PolicyEvidenceFreshnessState.RESTRICTED);
  }
  for (const sourceClass of snapshot.collection.missingSourceClasses) {
    setDegraded(sourceClass, PolicyEvidenceFreshnessState.MISSING);
  }
  const summaryStates = snapshot.evidenceSummary.freshnessStates.filter(
    (state) => state !== PolicyEvidenceFreshnessState.CURRENT,
  );
  for (const state of summaryStates) {
    reasonCodes.add(`EVIDENCE_SNAPSHOT_${state}`);
  }

  for (const sourceClass of Object.values(PolicySourceClass)) {
    if (sourceClass === PolicySourceClass.AUTHORIZATION) continue;
    const requirement = profile.evidenceRequirements[sourceClass];
    if (!requiredForRequest(requirement, request)) continue;
    const items = snapshot.sourceItems.filter((item) => item.sourceClass === sourceClass);
    if (items.length === 0) {
      setDegraded(sourceClass, PolicyEvidenceFreshnessState.MISSING);
      continue;
    }
    for (const item of items) {
      const freshness = item.deleted ? PolicyEvidenceFreshnessState.DELETED : item.freshnessState;
      if (freshness !== PolicyEvidenceFreshnessState.CURRENT) {
        setDegraded(sourceClass, freshness);
      }
    }
  }

  if (!integrityValid) {
    return {
      status: PolicyCurrentnessState.UNKNOWN,
      safeToAllow: false,
      integrityValid: false,
      degradedSourceClasses: [],
      freshnessStates: [],
      reasonCodes: [...reasonCodes].sort(),
      collectionStatus: snapshot.collection.status,
    };
  }

  const degradedSourceClasses = [...degraded.keys()].sort();
  const degradedStates = [...degraded.values(), ...summaryStates];
  const freshnessStates = FRESHNESS_ORDER.filter((state) => degradedStates.includes(state));
  const status = selectCurrentnessState(degradedStates, snapshot.collection.status);
  return {
    status,
    safeToAllow: status === PolicyCurrentnessState.CURRENT,
    integrityValid: true,
    degradedSourceClasses,
    freshnessStates,
    reasonCodes: [...reasonCodes].sort(),
    collectionStatus: snapshot.collection.status,
  };
}

@Injectable()
export class CapabilityPolicyRecoveryService {
  private readonly profileLifecycle: PolicyProfileLifecyclePort;
  private readonly clock: PolicyRecoveryClock;
  private readonly diagnostics?: PolicyRecoveryDiagnosticsPort;
  private readonly retry: PolicyRecoveryRetryConfiguration;
  private readonly maxConcurrentEvaluations: number;
  private readonly activeKeys = new Set<string>();
  private activeEvaluations = 0;

  constructor(
    private readonly evaluator: PolicyDecisionEvaluator | CapabilityPolicyEvaluationService,
    private readonly profileRegistry: PolicyProfileRegistry,
    private readonly decisionStore: PolicyDecisionLifecycleStore,
    private readonly idempotency: PolicyIdempotencyPort,
    private readonly audit: PolicyAuditPort,
    options: PolicyRecoveryServiceOptions = {},
  ) {
    this.profileLifecycle = options.profileLifecycle ?? DEFAULT_PROFILE_LIFECYCLE;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.diagnostics = options.diagnostics;
    this.retry = this.retryConfiguration(options.retry);
    this.maxConcurrentEvaluations = this.positiveBoundedInteger(
      options.maxConcurrentEvaluations ?? DEFAULT_MAX_CONCURRENT_EVALUATIONS,
      DEFAULT_MAX_CONCURRENT_EVALUATIONS,
    );
    this.currentEvidence = options.currentEvidence;
  }

  private readonly currentEvidence?: PolicyCurrentEvidencePort;

  async getCurrentEffectiveDecision(
    request: PolicyCurrentEffectiveDecisionRequest,
  ): Promise<PolicyCurrentEffectiveDecisionResult> {
    const normalized = normalizeCurrentRequest(request);
    const checkedAt = this.clock.now().toISOString();
    let decision: PolicyDecisionResult | null;
    try {
      decision = await this.decisionStore.findCurrentEffectiveDecision({
        customerId: normalized.customerId,
        capability: normalized.capability,
        action: normalized.action,
        asOf: normalized.asOf,
        targetBindingId: normalized.evaluationContext?.targetBindingId,
      });
    } catch {
      return {
        contractName: 'A4-CURRENT-EFFECTIVE-POLICY',
        contractVersion: 1,
        currentness: PolicyCurrentnessState.UNAVAILABLE_EVIDENCE,
        decision: null,
        requiresReevaluation: true,
        recoveryState: PolicyRecoveryState.RETRY_REQUIRED,
        reasonCodes: ['DECISION_STORE_UNAVAILABLE'],
        checkedAt,
      };
    }
    if (!decision) {
      return {
        contractName: 'A4-CURRENT-EFFECTIVE-POLICY',
        contractVersion: 1,
        currentness: PolicyCurrentnessState.NOT_FOUND,
        decision: null,
        requiresReevaluation: false,
        recoveryState: PolicyRecoveryState.NONE,
        reasonCodes: ['DECISION_NOT_FOUND'],
        checkedAt,
      };
    }
    if (!this.decisionIntegrityValid(decision)) {
      return this.currentnessResult(
        PolicyCurrentnessState.UNKNOWN,
        decision,
        ['DECISION_INTEGRITY_MISMATCH'],
        checkedAt,
      );
    }

    let currentProfile: CapabilityPolicyProfile | null;
    try {
      currentProfile = await this.profileRegistry.getProfile(
        normalized.capability,
        normalized.action,
      );
    } catch {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        decision,
        ['POLICY_VERSION_UNAVAILABLE'],
        checkedAt,
      );
    }
    if (!currentProfile) {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        decision,
        ['POLICY_VERSION_UNAVAILABLE'],
        checkedAt,
      );
    }

    let versionState: PolicyProfileVersionState;
    try {
      versionState = await this.profileLifecycle.getVersionState(decision.policyVersion);
    } catch {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        decision,
        ['POLICY_VERSION_UNAVAILABLE'],
        checkedAt,
      );
    }
    if (versionState === PolicyProfileVersionState.RETIRED) {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_RETIRED,
        decision,
        ['POLICY_VERSION_RETIRED'],
        checkedAt,
      );
    }
    if (versionState !== PolicyProfileVersionState.ACTIVE) {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        decision,
        ['POLICY_VERSION_UNAVAILABLE'],
        checkedAt,
      );
    }
    let currentPolicyVersion: string | null;
    try {
      currentPolicyVersion = await this.profileLifecycle.getCurrentPolicyVersion(
        normalized.capability,
        normalized.action,
        normalized.asOf,
      );
    } catch {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        decision,
        ['POLICY_VERSION_UNAVAILABLE'],
        checkedAt,
      );
    }
    if (
      (currentPolicyVersion !== null && currentPolicyVersion !== decision.policyVersion) ||
      currentProfile.policyVersion !== decision.policyVersion
    ) {
      return this.currentnessResult(
        PolicyCurrentnessState.POLICY_VERSION_SUPERSEDED,
        decision,
        ['POLICY_VERSION_SUPERSEDED'],
        checkedAt,
      );
    }

    const timeCurrentness = timeCurrentnessForDecision(decision, this.clock.now());
    if (timeCurrentness !== null) {
      return this.currentnessResult(
        timeCurrentness,
        decision,
        [`DECISION_${timeCurrentness}`],
        checkedAt,
      );
    }

    const snapshot = await this.resolveCurrentSnapshot(normalized, decision);
    if (!snapshot) {
      return this.currentnessResult(
        PolicyCurrentnessState.UNAVAILABLE_EVIDENCE,
        decision,
        ['CURRENT_EVIDENCE_UNAVAILABLE'],
        checkedAt,
      );
    }
    if (!snapshotMatchesCurrentRequest(snapshot, normalized)) {
      return this.currentnessResult(
        PolicyCurrentnessState.UNKNOWN,
        decision,
        ['CURRENT_EVIDENCE_REQUEST_MISMATCH'],
        checkedAt,
      );
    }
    const assessment = assessPolicyEvidenceFreshness(snapshot, currentProfile, {
      evaluationContext: normalized.evaluationContext,
    });
    if (!assessment.integrityValid) {
      return this.currentnessResult(
        PolicyCurrentnessState.UNKNOWN,
        decision,
        assessment.reasonCodes,
        checkedAt,
      );
    }
    if (!assessment.safeToAllow) {
      return this.currentnessResult(assessment.status, decision, assessment.reasonCodes, checkedAt);
    }
    if (
      snapshot.evidenceSummary.normalizedInputHash !== decision.evidenceContext.normalizedInputHash
    ) {
      return this.currentnessResult(
        PolicyCurrentnessState.STALE_EVIDENCE,
        decision,
        ['EVIDENCE_SOURCE_CHANGED'],
        checkedAt,
      );
    }
    return {
      contractName: 'A4-CURRENT-EFFECTIVE-POLICY',
      contractVersion: 1,
      currentness: PolicyCurrentnessState.CURRENT,
      decision,
      requiresReevaluation: false,
      recoveryState: PolicyRecoveryState.NONE,
      reasonCodes: [],
      checkedAt,
    };
  }

  async reevaluate(request: PolicyReevaluationRequest): Promise<PolicyReevaluationResult> {
    const normalizedRequest = normalizeReevaluationRequest(request);
    const evaluation = normalizedRequest.evaluation;
    const evaluationRequestHash = calculatePolicyRequestHash(evaluation);
    const snapshotHash = evaluation.snapshot.evidenceSummary.normalizedInputHash;
    const requestHash = hashCanonical({
      evaluationRequestHash,
      snapshotReference: evaluation.snapshot.snapshotReference,
      normalizedInputHash: snapshotHash,
      trigger: normalizedRequest.trigger,
      previousDecisionReference: normalizedRequest.previousDecisionReference ?? null,
    });
    const reevaluationReference = `a4-reevaluation-${requestHash}`;
    const profile = await this.resolveReevaluationProfile(normalizedRequest);
    const previous = await this.resolvePreviousDecision(normalizedRequest);
    const baseContext: ReevaluationBaseContext = {
      reevaluationReference,
      customerId: evaluation.subject.customerId,
      capability: evaluation.capability,
      action: evaluation.action,
      requestHash,
      evaluationRequestHash,
      normalizedInputHash: snapshotHash,
      trigger: normalizedRequest.trigger,
      previousDecisionReference: normalizedRequest.previousDecisionReference ?? null,
      requestContext: evaluation.requestContext,
    };

    if (!profile) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        'POLICY_VERSION_UNAVAILABLE',
        0,
        this.retry.maxAttempts,
      );
    }
    let profileState: PolicyProfileVersionState;
    let currentPolicyVersion: string | null;
    try {
      profileState = await this.profileLifecycle.getVersionState(profile.policyVersion);
      currentPolicyVersion = await this.profileLifecycle.getCurrentPolicyVersion(
        evaluation.capability,
        evaluation.action,
        evaluation.sourceEvidenceRequest.asOf,
      );
    } catch {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        'POLICY_VERSION_UNAVAILABLE',
        0,
        this.retry.maxAttempts,
      );
    }
    if (profileState === PolicyProfileVersionState.RETIRED) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.POLICY_VERSION_RETIRED,
        'POLICY_VERSION_RETIRED',
        0,
        this.retry.maxAttempts,
      );
    }
    if (profileState !== PolicyProfileVersionState.ACTIVE) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.POLICY_VERSION_UNAVAILABLE,
        'POLICY_VERSION_UNAVAILABLE',
        0,
        this.retry.maxAttempts,
      );
    }
    if (currentPolicyVersion !== null && currentPolicyVersion !== profile.policyVersion) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.POLICY_VERSION_SUPERSEDED,
        'POLICY_VERSION_SUPERSEDED',
        0,
        this.retry.maxAttempts,
      );
    }
    if (
      normalizedRequest.previousDecisionReference !== undefined &&
      (!previous ||
        previous.subject.customerId !== evaluation.subject.customerId ||
        previous.capability !== evaluation.capability ||
        previous.action !== evaluation.action)
    ) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.UNKNOWN,
        'PREVIOUS_DECISION_NOT_FOUND_OR_MISMATCHED',
        0,
        this.retry.maxAttempts,
      );
    }

    const assessment = assessPolicyEvidenceFreshness(evaluation.snapshot, profile, evaluation);
    if (!assessment.integrityValid) {
      return this.blockedResult(
        baseContext,
        PolicyCurrentnessState.UNKNOWN,
        'EVIDENCE_SNAPSHOT_INTEGRITY_MISMATCH',
        0,
        this.retry.maxAttempts,
      );
    }
    if (this.activeKeys.has(normalizedRequest.idempotencyContext.key)) {
      return this.inProgressResult(baseContext, this.retry.maxAttempts);
    }
    if (this.activeEvaluations >= this.maxConcurrentEvaluations) {
      const result = this.baseResult(
        baseContext,
        PolicyReevaluationState.RETRY_SCHEDULED,
        null,
        0,
        this.retry.maxAttempts,
        {
          state: PolicyRecoveryState.RETRY_REQUIRED,
          code: 'A4_REEVALUATION_CONCURRENCY_BOUND',
          currentness: assessment.status,
          retryable: true,
          manualReviewRequired: false,
        },
        false,
      );
      await this.recordRecoveryAudit('REEVALUATION_RETRY_SCHEDULED', result, profile, {
        attempt: 0,
        code: 'A4_REEVALUATION_CONCURRENCY_BOUND',
      });
      await this.recordDiagnostic(
        this.diagnosticFor(result, profile, 0, true, 'A4_REEVALUATION_CONCURRENCY_BOUND'),
      );
      return result;
    }

    this.activeKeys.add(normalizedRequest.idempotencyContext.key);
    this.activeEvaluations += 1;
    try {
      let reservation: PolicyIdempotencyReservation;
      try {
        reservation = await this.idempotency.reserve({
          scope: POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
          key: normalizedRequest.idempotencyContext.key,
          requestHash,
        });
      } catch (error) {
        if (error instanceof ConflictException) {
          await this.recordLooseAudit('REEVALUATION_CONFLICT', baseContext, profile);
        }
        throw error;
      }

      if (reservation.kind === 'IN_PROGRESS') {
        return this.inProgressResult(baseContext, this.retry.maxAttempts);
      }
      if (reservation.kind === 'REPLAY') {
        const replay =
          reservation.result ??
          (reservation.decisionReference
            ? await this.decisionStore.findByDecisionReference(reservation.decisionReference)
            : null);
        if (!replay) {
          const unknown = this.baseResult(
            baseContext,
            PolicyReevaluationState.UNKNOWN_OUTCOME,
            null,
            0,
            this.retry.maxAttempts,
            {
              state: PolicyRecoveryState.UNKNOWN_OUTCOME,
              code: 'A4_REPLAY_RESULT_UNAVAILABLE',
              currentness: assessment.status,
              retryable: true,
              manualReviewRequired: true,
            },
            true,
          );
          await this.recordRecoveryAudit('REEVALUATION_UNKNOWN_OUTCOME', unknown, profile, {
            attempt: 0,
            code: 'A4_REPLAY_RESULT_UNAVAILABLE',
          });
          await this.recordDiagnostic(
            this.diagnosticFor(unknown, profile, 0, true, 'A4_REPLAY_RESULT_UNAVAILABLE'),
          );
          return unknown;
        }
        const replayResult = this.baseResult(
          baseContext,
          PolicyReevaluationState.REPLAYED,
          { ...replay, idempotencyReplay: true },
          1,
          this.retry.maxAttempts,
          {
            state: PolicyRecoveryState.RECOVERED,
            code: 'A4_REEVALUATION_IDEMPOTENT_REPLAY',
            currentness: assessment.status,
            retryable: false,
            manualReviewRequired: false,
          },
          true,
        );
        await this.recordRecoveryAudit('REEVALUATION_REPLAYED', replayResult, profile, {
          attempt: 1,
          code: 'A4_REEVALUATION_IDEMPOTENT_REPLAY',
        });
        return replayResult;
      }

      await this.recordLooseAudit('REEVALUATION_REQUESTED', baseContext, profile);
      return await this.runReevaluationAttempts(
        normalizedRequest,
        profile,
        previous,
        assessment,
        reservation,
        baseContext,
      );
    } finally {
      this.activeKeys.delete(normalizedRequest.idempotencyContext.key);
      this.activeEvaluations -= 1;
    }
  }

  private async runReevaluationAttempts(
    request: PolicyReevaluationRequest,
    profile: CapabilityPolicyProfile,
    previous: PolicyDecisionResult | null,
    assessment: PolicyEvidenceFreshnessAssessment,
    reservation: PolicyIdempotencyReservation,
    baseContext: ReevaluationBaseContext,
  ): Promise<PolicyReevaluationResult> {
    let lastFailure: PolicyRecoveryFailureLike = {
      code: 'A4_UNKNOWN_OUTCOME',
      retryable: true,
      unknownOutcome: true,
    };
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      const durable = await this.findDurableResult(
        baseContext.evaluationRequestHash,
        request.evaluation,
        profile,
      );
      if (durable) {
        const recoveredDecision = this.decorateDecision(durable, previous, assessment);
        if (recoveredDecision.resultHash !== durable.resultHash) {
          await this.decisionStore.save(recoveredDecision);
        }
        await this.tryCompleteIdempotency(reservation, recoveredDecision);
        const recovered = this.baseResult(
          baseContext,
          PolicyReevaluationState.COMPLETED,
          recoveredDecision,
          attempt,
          this.retry.maxAttempts,
          {
            state: PolicyRecoveryState.RECOVERED,
            code: 'A4_DURABLE_RESULT_RECOVERED',
            currentness: assessment.status,
            retryable: false,
            manualReviewRequired: recoveredDecision.decision === PolicyDecisionState.PENDING_REVIEW,
          },
          false,
        );
        await this.recordRecoveryAudit('REEVALUATION_RECOVERED', recovered, profile, {
          attempt,
          code: 'A4_DURABLE_RESULT_RECOVERED',
        });
        await this.recordDiagnostic(
          this.diagnosticFor(recovered, profile, attempt, false, 'A4_DURABLE_RESULT_RECOVERED'),
        );
        return recovered;
      }

      try {
        const evaluated = await this.evaluator.evaluate({
          ...request.evaluation,
          idempotencyContext: {
            scope: POLICY_DECISION_IDEMPOTENCY_SCOPE,
            key: `${baseContext.reevaluationReference}:attempt-${attempt}`,
          },
        });
        const decision = this.decorateDecision(evaluated, previous, assessment);
        if (decision.resultHash !== evaluated.resultHash) {
          await this.decisionStore.save(decision);
        }
        await this.tryCompleteIdempotency(reservation, decision);
        const completed = this.baseResult(
          baseContext,
          PolicyReevaluationState.COMPLETED,
          decision,
          attempt,
          this.retry.maxAttempts,
          this.completedRecovery(assessment, request.trigger, decision),
          false,
        );
        await this.recordRecoveryAudit('DECISION_REEVALUATED', completed, profile, {
          attempt,
          code: completed.recovery.code,
        });
        await this.recordDiagnostic(
          this.diagnosticFor(completed, profile, attempt, false, completed.recovery.code),
        );
        return completed;
      } catch (error) {
        const durableAfterFailure = await this.findDurableResult(
          baseContext.evaluationRequestHash,
          request.evaluation,
          profile,
        );
        if (durableAfterFailure) {
          const recoveredDecision = this.decorateDecision(
            durableAfterFailure,
            previous,
            assessment,
          );
          if (recoveredDecision.resultHash !== durableAfterFailure.resultHash) {
            await this.decisionStore.save(recoveredDecision);
          }
          await this.tryCompleteIdempotency(reservation, recoveredDecision);
          const recovered = this.baseResult(
            baseContext,
            PolicyReevaluationState.COMPLETED,
            recoveredDecision,
            attempt,
            this.retry.maxAttempts,
            {
              state: PolicyRecoveryState.RECOVERED,
              code: 'A4_UNKNOWN_OUTCOME_VERIFIED',
              currentness: assessment.status,
              retryable: false,
              manualReviewRequired:
                recoveredDecision.decision === PolicyDecisionState.PENDING_REVIEW,
            },
            false,
          );
          await this.recordRecoveryAudit('REEVALUATION_RECOVERED', recovered, profile, {
            attempt,
            code: 'A4_UNKNOWN_OUTCOME_VERIFIED',
          });
          await this.recordDiagnostic(
            this.diagnosticFor(recovered, profile, attempt, false, 'A4_UNKNOWN_OUTCOME_VERIFIED'),
          );
          return recovered;
        }

        lastFailure = classifyRecoveryFailure(error);
        if (!lastFailure.retryable || attempt === this.retry.maxAttempts) break;
        await this.recordLooseAudit('REEVALUATION_RETRY', baseContext, profile, {
          attempt,
          code: lastFailure.code,
        });
        await this.recordDiagnostic(
          this.diagnosticFor(
            this.baseResult(
              baseContext,
              PolicyReevaluationState.RETRY_SCHEDULED,
              null,
              attempt,
              this.retry.maxAttempts,
              {
                state: PolicyRecoveryState.RETRY_REQUIRED,
                code: lastFailure.code,
                currentness: assessment.status,
                retryable: true,
                manualReviewRequired: false,
              },
              false,
            ),
            profile,
            attempt,
            true,
            lastFailure.code,
          ),
        );
        await this.clock.sleep(this.retryDelay(attempt));
      }
    }

    const state = lastFailure.unknownOutcome
      ? PolicyReevaluationState.UNKNOWN_OUTCOME
      : lastFailure.retryable
        ? PolicyReevaluationState.RETRY_SCHEDULED
        : PolicyReevaluationState.BLOCKED;
    const recoveryState = lastFailure.unknownOutcome
      ? PolicyRecoveryState.UNKNOWN_OUTCOME
      : lastFailure.retryable
        ? PolicyRecoveryState.RETRY_REQUIRED
        : PolicyRecoveryState.BLOCKED;
    const finalResult = this.baseResult(
      baseContext,
      state,
      null,
      this.retry.maxAttempts,
      this.retry.maxAttempts,
      {
        state: recoveryState,
        code: lastFailure.code,
        currentness: assessment.status,
        retryable: lastFailure.retryable,
        manualReviewRequired: !lastFailure.retryable || lastFailure.unknownOutcome,
      },
      false,
    );
    await this.tryFailIdempotency(reservation, lastFailure.code);
    await this.recordRecoveryAudit(
      state === PolicyReevaluationState.UNKNOWN_OUTCOME
        ? 'REEVALUATION_UNKNOWN_OUTCOME'
        : state === PolicyReevaluationState.RETRY_SCHEDULED
          ? 'REEVALUATION_RETRY_SCHEDULED'
          : 'REEVALUATION_BLOCKED',
      finalResult,
      profile,
      { attempt: this.retry.maxAttempts, code: lastFailure.code },
    );
    await this.recordDiagnostic(
      this.diagnosticFor(
        finalResult,
        profile,
        this.retry.maxAttempts,
        lastFailure.retryable,
        lastFailure.code,
      ),
    );
    return finalResult;
  }

  private decorateDecision(
    decision: PolicyDecisionResult,
    previous: PolicyDecisionResult | null,
    assessment: PolicyEvidenceFreshnessAssessment,
  ): PolicyDecisionResult {
    const unsafe = !assessment.safeToAllow;
    const failClosedDecision =
      unsafe &&
      (decision.decision === PolicyDecisionState.ALLOW ||
        decision.decision === PolicyDecisionState.ALLOW_WITH_LIMITS)
        ? this.failClosedDecision(assessment)
        : decision.decision;
    const addedReasons = unsafe ? assessment.reasonCodes : [];
    const reasonCodes = deduplicateStable([...decision.reasonCodes, ...addedReasons]);
    const obligations = [...decision.obligations];
    if (
      unsafe &&
      !obligations.some((obligation) => obligation.code === 'EVIDENCE_REEVALUATION_REQUIRED')
    ) {
      obligations.push({ code: 'EVIDENCE_REEVALUATION_REQUIRED', required: true });
    }
    const supersedes =
      previous && previous.decisionReference !== decision.decisionReference
        ? previous.decisionReference
        : (decision.supersedesDecisionReference ??
          (unsafe ? decision.decisionReference : undefined));
    const changed =
      failClosedDecision !== decision.decision ||
      reasonCodes.length !== decision.reasonCodes.length ||
      obligations.length !== decision.obligations.length ||
      supersedes !== decision.supersedesDecisionReference;
    if (!changed) return decision;

    const core = {
      ...decision,
      decision: failClosedDecision,
      reasonCodes,
      obligations,
      explanation: {
        ...decision.explanation,
        key: `POLICY_${failClosedDecision}`,
      },
      ...(supersedes ? { supersedesDecisionReference: supersedes } : {}),
    };
    const lineageReference = [
      supersedes ?? '',
      unsafe ? assessment.status : '',
      unsafe ? assessment.reasonCodes.join('|') : '',
    ].join('|');
    return {
      ...core,
      decisionReference: calculatePolicyDecisionReference(
        decision.requestHash,
        decision.policyVersion,
        decision.evidenceContext.normalizedInputHash,
        lineageReference,
      ),
      resultHash: calculatePolicyDecisionResultHash(core),
      idempotencyReplay: false,
    };
  }

  private failClosedDecision(assessment: PolicyEvidenceFreshnessAssessment): PolicyDecisionState {
    if (
      (assessment.status === PolicyCurrentnessState.DELETED_EVIDENCE ||
        assessment.status === PolicyCurrentnessState.MISSING_EVIDENCE) &&
      assessment.degradedSourceClasses.includes(PolicySourceClass.CUSTOMER)
    ) {
      return PolicyDecisionState.DENY;
    }
    return PolicyDecisionState.PENDING_REVIEW;
  }

  private completedRecovery(
    assessment: PolicyEvidenceFreshnessAssessment,
    trigger: PolicyReevaluationTrigger,
    decision: PolicyDecisionResult,
  ): PolicyReevaluationRecovery {
    if (!assessment.safeToAllow) {
      return {
        state:
          decision.decision === PolicyDecisionState.PENDING_REVIEW
            ? PolicyRecoveryState.MANUAL_REVIEW
            : PolicyRecoveryState.REEVALUATION_REQUIRED,
        code: assessment.reasonCodes[0] ?? 'EVIDENCE_REEVALUATION_REQUIRED',
        currentness: assessment.status,
        retryable: assessment.status === PolicyCurrentnessState.UNAVAILABLE_EVIDENCE,
        manualReviewRequired: decision.decision === PolicyDecisionState.PENDING_REVIEW,
      };
    }
    return {
      state:
        trigger === PolicyReevaluationTrigger.MANUAL
          ? PolicyRecoveryState.NONE
          : PolicyRecoveryState.RECOVERED,
      code:
        trigger === PolicyReevaluationTrigger.MANUAL
          ? 'A4_REEVALUATION_COMPLETED'
          : 'A4_CURRENT_EVIDENCE_RESTORED',
      currentness: PolicyCurrentnessState.CURRENT,
      retryable: false,
      manualReviewRequired: decision.decision === PolicyDecisionState.PENDING_REVIEW,
    };
  }

  private async resolveCurrentSnapshot(
    request: PolicyCurrentEffectiveDecisionRequest,
    decision: PolicyDecisionResult,
  ): Promise<Readonly<PolicyEvidenceSnapshot> | null> {
    if (request.currentSnapshot) return request.currentSnapshot;
    if (!this.currentEvidence) return null;
    const currentEvidenceRequest: PolicyCurrentEvidenceRequest = {
      subject: { type: 'CUSTOMER', customerId: request.customerId },
      customerId: request.customerId,
      capability: request.capability,
      action: request.action,
      asOf: request.asOf,
      evidenceProfile: request.evidenceProfile,
      policyVersionHint: decision.policyVersion,
      evaluationContext: request.evaluationContext,
      actorContext: request.actorContext,
      requestContext: request.requestContext,
    };
    try {
      return await this.currentEvidence.getCurrentSnapshot(currentEvidenceRequest);
    } catch {
      return null;
    }
  }

  private decisionIntegrityValid(decision: PolicyDecisionResult): boolean {
    if (
      !HASH_PATTERN.test(decision.resultHash) ||
      !HASH_PATTERN.test(decision.evidenceContext.normalizedInputHash)
    ) {
      return false;
    }
    try {
      return calculatePolicyDecisionResultHash(decision) === decision.resultHash;
    } catch {
      return false;
    }
  }

  private currentnessResult(
    currentness: PolicyCurrentnessState,
    decision: PolicyDecisionResult,
    reasonCodes: readonly string[],
    checkedAt: string,
  ): PolicyCurrentEffectiveDecisionResult {
    const manualReview =
      currentness === PolicyCurrentnessState.CONFLICTING_EVIDENCE ||
      currentness === PolicyCurrentnessState.RESTRICTED_EVIDENCE ||
      currentness === PolicyCurrentnessState.UNKNOWN;
    return {
      contractName: 'A4-CURRENT-EFFECTIVE-POLICY',
      contractVersion: 1,
      currentness,
      decision,
      requiresReevaluation: currentness !== PolicyCurrentnessState.CURRENT,
      recoveryState: manualReview
        ? PolicyRecoveryState.MANUAL_REVIEW
        : PolicyRecoveryState.REEVALUATION_REQUIRED,
      reasonCodes: [...new Set(reasonCodes)].sort(),
      checkedAt,
    };
  }

  private async resolveReevaluationProfile(
    request: PolicyReevaluationRequest,
  ): Promise<CapabilityPolicyProfile | null> {
    try {
      return await this.profileRegistry.getProfile(
        request.evaluation.capability,
        request.evaluation.action,
        request.evaluation.policyVersionHint,
      );
    } catch {
      return null;
    }
  }

  private async resolvePreviousDecision(
    request: PolicyReevaluationRequest,
  ): Promise<PolicyDecisionResult | null> {
    if (!request.previousDecisionReference) return null;
    try {
      return await this.decisionStore.findByDecisionReference(request.previousDecisionReference);
    } catch {
      return null;
    }
  }

  private async findDurableResult(
    requestHash: string,
    evaluation: PolicyEvaluationCommand,
    profile: CapabilityPolicyProfile,
  ): Promise<PolicyDecisionResult | null> {
    const result = await this.decisionStore.findByRequestHash(requestHash);
    if (!result) return null;
    if (
      !this.decisionIntegrityValid(result) ||
      result.subject.customerId !== evaluation.subject.customerId ||
      result.capability !== evaluation.capability ||
      result.action !== evaluation.action ||
      result.policyVersion !== profile.policyVersion ||
      result.evidenceContext.normalizedInputHash !==
        evaluation.snapshot.evidenceSummary.normalizedInputHash
    ) {
      return null;
    }
    return result;
  }

  private async tryCompleteIdempotency(
    reservation: PolicyIdempotencyReservation,
    decision: PolicyDecisionResult,
  ): Promise<void> {
    if (reservation.kind !== 'NEW') return;
    try {
      await this.idempotency.complete(reservation.reservationId, decision);
    } catch {
      // The durable decision is checked before any retry. A failed completion is
      // therefore an unknown idempotency outcome, never permission to duplicate it.
    }
  }

  private async tryFailIdempotency(
    reservation: PolicyIdempotencyReservation,
    reason: string,
  ): Promise<void> {
    if (reservation.kind !== 'NEW') return;
    try {
      await this.idempotency.fail(reservation.reservationId, reason);
    } catch {
      // Operations owns the idempotency record. Recovery diagnostics retain the
      // bounded failure code without treating the control record as a policy source.
    }
  }

  private retryConfiguration(
    configured: Partial<PolicyRecoveryRetryConfiguration> | undefined,
  ): PolicyRecoveryRetryConfiguration {
    return {
      maxAttempts: this.positiveBoundedInteger(
        configured?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        DEFAULT_MAX_ATTEMPTS,
      ),
      baseDelayMilliseconds: this.nonNegativeBoundedInteger(
        configured?.baseDelayMilliseconds ?? DEFAULT_BASE_DELAY_MILLISECONDS,
        DEFAULT_BASE_DELAY_MILLISECONDS,
      ),
      maxDelayMilliseconds: this.nonNegativeBoundedInteger(
        configured?.maxDelayMilliseconds ?? DEFAULT_MAX_DELAY_MILLISECONDS,
        DEFAULT_MAX_DELAY_MILLISECONDS,
      ),
    };
  }

  private retryDelay(attempt: number): number {
    const exponential = this.retry.baseDelayMilliseconds * 2 ** Math.max(attempt - 1, 0);
    return Math.min(exponential, this.retry.maxDelayMilliseconds);
  }

  private positiveBoundedInteger(value: number, fallback: number): number {
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : fallback;
  }

  private nonNegativeBoundedInteger(value: number, fallback: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 60_000) : fallback;
  }

  private baseResult(
    context: ReevaluationBaseContext,
    state: PolicyReevaluationState,
    decision: PolicyDecisionResult | null,
    attempts: number,
    maxAttempts: number,
    recovery: PolicyReevaluationRecovery,
    idempotencyReplay: boolean,
  ): PolicyReevaluationResult {
    return {
      contractName: POLICY_REEVALUATION_CONTRACT,
      contractVersion: POLICY_REEVALUATION_CONTRACT_VERSION,
      reevaluationReference: context.reevaluationReference,
      customerId: context.customerId,
      capability: context.capability,
      action: context.action,
      requestHash: context.requestHash,
      normalizedInputHash: context.normalizedInputHash,
      trigger: context.trigger,
      state,
      decision,
      previousDecisionReference: context.previousDecisionReference,
      attempts,
      maxAttempts,
      recovery,
      idempotencyReplay,
      requestContext: context.requestContext,
    };
  }

  private inProgressResult(
    context: ReevaluationBaseContext,
    maxAttempts: number,
  ): PolicyReevaluationResult {
    return this.baseResult(
      context,
      PolicyReevaluationState.IN_PROGRESS,
      null,
      0,
      maxAttempts,
      {
        state: PolicyRecoveryState.RETRY_REQUIRED,
        code: 'A4_REEVALUATION_IN_PROGRESS',
        currentness: null,
        retryable: true,
        manualReviewRequired: false,
      },
      false,
    );
  }

  private async blockedResult(
    context: ReevaluationBaseContext,
    currentness: PolicyCurrentnessState,
    code: string,
    attempts: number,
    maxAttempts: number,
  ): Promise<PolicyReevaluationResult> {
    const result = this.baseResult(
      context,
      PolicyReevaluationState.BLOCKED,
      null,
      attempts,
      maxAttempts,
      {
        state: PolicyRecoveryState.BLOCKED,
        code,
        currentness,
        retryable: false,
        manualReviewRequired: currentness !== PolicyCurrentnessState.CURRENT,
      },
      false,
    );
    await this.recordLooseAudit('REEVALUATION_BLOCKED', context, null, {
      attempt: attempts,
      code,
      state: result.state,
      recoveryState: result.recovery.state,
    });
    await this.recordDiagnostic(this.diagnosticFor(result, null, attempts, false, code));
    return result;
  }

  private async recordRecoveryAudit(
    action: string,
    result: PolicyReevaluationResult,
    profile: CapabilityPolicyProfile,
    details: { attempt: number; code: string },
  ): Promise<void> {
    await this.recordLooseAudit(
      action,
      {
        reevaluationReference: result.reevaluationReference,
        customerId: result.customerId,
        capability: result.capability,
        action: result.action,
        requestHash: result.requestHash,
        normalizedInputHash: result.normalizedInputHash,
        decisionReference: result.decision?.decisionReference,
        trigger: result.trigger,
        previousDecisionReference: result.previousDecisionReference,
        requestContext: result.requestContext,
      },
      profile,
      {
        attempt: details.attempt,
        code: details.code,
        state: result.state,
        recoveryState: result.recovery.state,
        decisionReference: result.decision?.decisionReference,
      },
    );
  }

  private async recordLooseAudit(
    action: string,
    context: ReevaluationAuditContext,
    profile: CapabilityPolicyProfile | null,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    try {
      await this.audit.record({
        action,
        decisionReference: context.decisionReference ?? context.reevaluationReference,
        customerId: context.customerId,
        capability: context.capability,
        policyVersion: profile?.policyVersion ?? 'UNKNOWN',
        requestHash: context.requestHash,
        normalizedInputHash: context.normalizedInputHash,
        correlationId: context.requestContext.correlationId,
        requestId: context.requestContext.requestId,
        actor: 'policy-recovery',
        metadata: {
          trigger: context.trigger,
          previousDecisionReference: context.previousDecisionReference,
          ...metadata,
        },
      });
    } catch {
      // Audit is a required Operations integration, but an audit transport
      // failure must not turn a durable policy result into a second evaluation.
      await this.recordDiagnostic(
        this.diagnosticForLoose(context, profile, 'A4_RECOVERY_AUDIT_UNAVAILABLE'),
      );
    }
  }

  private async recordDiagnostic(diagnostic: PolicyRecoveryDiagnostic): Promise<void> {
    if (!this.diagnostics) return;
    try {
      await this.diagnostics.record(diagnostic);
    } catch {
      // Diagnostics are observational and cannot become a policy/source writer.
    }
  }

  private diagnosticFor(
    result: PolicyReevaluationResult,
    profile: CapabilityPolicyProfile | null,
    attempt: number,
    retryable: boolean,
    code: string,
  ): PolicyRecoveryDiagnostic {
    return {
      diagnosticType: 'A4_POLICY_RECOVERY',
      reevaluationReference: result.reevaluationReference,
      action: 'REEVALUATE',
      trigger: result.trigger,
      state: result.state,
      recoveryState: result.recovery.state,
      currentness: result.recovery.currentness,
      customerId: result.customerId,
      capability: result.capability,
      policyVersion: profile?.policyVersion ?? 'UNKNOWN',
      ...(result.decision?.decisionReference
        ? { decisionReference: result.decision.decisionReference }
        : {}),
      attempt,
      maxAttempts: result.maxAttempts,
      retryable,
      correlationId: result.requestContext.correlationId,
      requestId: result.requestContext.requestId,
      code,
    };
  }

  private diagnosticForLoose(
    context: ReevaluationAuditContext,
    profile: CapabilityPolicyProfile | null,
    code: string,
  ): PolicyRecoveryDiagnostic {
    return {
      diagnosticType: 'A4_POLICY_RECOVERY',
      reevaluationReference: context.reevaluationReference,
      action: 'REEVALUATE',
      trigger: context.trigger,
      state: PolicyReevaluationState.UNKNOWN_OUTCOME,
      recoveryState: PolicyRecoveryState.UNKNOWN_OUTCOME,
      currentness: null,
      customerId: context.customerId,
      capability: context.capability,
      policyVersion: profile?.policyVersion ?? 'UNKNOWN',
      attempt: 0,
      maxAttempts: this.retry.maxAttempts,
      retryable: true,
      correlationId: context.requestContext.correlationId,
      requestId: context.requestContext.requestId,
      code,
    };
  }
}

interface ReevaluationBaseContext {
  readonly reevaluationReference: string;
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly requestHash: string;
  readonly evaluationRequestHash: string;
  readonly normalizedInputHash: string;
  readonly trigger: PolicyReevaluationTrigger;
  readonly previousDecisionReference: string | null;
  readonly requestContext: PolicyEvaluationCommand['requestContext'];
}

interface ReevaluationAuditContext {
  readonly reevaluationReference: string;
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly requestHash: string;
  readonly normalizedInputHash: string;
  readonly decisionReference?: string;
  readonly trigger: PolicyReevaluationTrigger;
  readonly previousDecisionReference: string | null;
  readonly requestContext: PolicyEvaluationCommand['requestContext'];
}

interface PolicyRecoveryFailureLike {
  readonly code: string;
  readonly retryable: boolean;
  readonly unknownOutcome: boolean;
}

function requiredForRequest(
  requirement: PolicyRequirementMode,
  request: Pick<PolicyEvaluationCommand, 'evaluationContext'>,
): boolean {
  if (
    requirement === PolicyRequirementMode.NOT_USED ||
    requirement === PolicyRequirementMode.OPTIONAL_REFERENCE
  ) {
    return false;
  }
  if (requirement !== PolicyRequirementMode.REQUIRED_IF_CONTEXT) return true;
  return Boolean(
    request.evaluationContext?.targetBindingId ??
      request.evaluationContext?.product ??
      request.evaluationContext?.channel ??
      request.evaluationContext?.currency,
  );
}

function selectCurrentnessState(
  states: Iterable<PolicyEvidenceFreshnessState>,
  collectionStatus: PolicyCollectionStatus,
): PolicyCurrentnessState {
  const values = [...states];
  if (collectionStatus === PolicyCollectionStatus.UNAVAILABLE) {
    return PolicyCurrentnessState.UNAVAILABLE_EVIDENCE;
  }
  for (const state of [
    PolicyEvidenceFreshnessState.UNAVAILABLE,
    PolicyEvidenceFreshnessState.CONFLICTING,
    PolicyEvidenceFreshnessState.DELETED,
    PolicyEvidenceFreshnessState.MISSING,
    PolicyEvidenceFreshnessState.RESTRICTED,
    PolicyEvidenceFreshnessState.STALE,
  ]) {
    if (values.includes(state)) {
      switch (state) {
        case PolicyEvidenceFreshnessState.UNAVAILABLE:
          return PolicyCurrentnessState.UNAVAILABLE_EVIDENCE;
        case PolicyEvidenceFreshnessState.CONFLICTING:
          return PolicyCurrentnessState.CONFLICTING_EVIDENCE;
        case PolicyEvidenceFreshnessState.DELETED:
          return PolicyCurrentnessState.DELETED_EVIDENCE;
        case PolicyEvidenceFreshnessState.MISSING:
          return PolicyCurrentnessState.MISSING_EVIDENCE;
        case PolicyEvidenceFreshnessState.RESTRICTED:
          return PolicyCurrentnessState.RESTRICTED_EVIDENCE;
        case PolicyEvidenceFreshnessState.STALE:
          return PolicyCurrentnessState.STALE_EVIDENCE;
        case PolicyEvidenceFreshnessState.CURRENT:
          break;
      }
    }
  }
  if (collectionStatus === PolicyCollectionStatus.INCOMPLETE) {
    return PolicyCurrentnessState.MISSING_EVIDENCE;
  }
  return PolicyCurrentnessState.CURRENT;
}

function timeCurrentnessForDecision(
  decision: PolicyDecisionResult,
  now: Date,
): PolicyCurrentnessState | null {
  const nowMillis = now.getTime();
  if (Number.isNaN(nowMillis)) return PolicyCurrentnessState.UNKNOWN;
  if (decision.expiresAt !== null) {
    const expiryMillis = Date.parse(decision.expiresAt);
    if (Number.isNaN(expiryMillis)) return PolicyCurrentnessState.UNKNOWN;
    if (expiryMillis <= nowMillis) return PolicyCurrentnessState.EXPIRED;
  }
  if (decision.reviewAt !== null) {
    const reviewMillis = Date.parse(decision.reviewAt);
    if (Number.isNaN(reviewMillis)) return PolicyCurrentnessState.UNKNOWN;
    if (reviewMillis <= nowMillis) return PolicyCurrentnessState.REVIEW_DUE;
  }
  return null;
}

function normalizeReevaluationRequest(
  request: PolicyReevaluationRequest,
): PolicyReevaluationRequest {
  if (
    request.contractName !== POLICY_REEVALUATION_CONTRACT ||
    request.contractVersion !== POLICY_REEVALUATION_CONTRACT_VERSION
  ) {
    throw new BadRequestException('Unsupported A4 policy re-evaluation contract version');
  }
  if (!Object.values(PolicyReevaluationTrigger).includes(request.trigger)) {
    throw new BadRequestException('A4 re-evaluation trigger is invalid');
  }
  if (request.idempotencyContext.scope !== POLICY_REEVALUATION_IDEMPOTENCY_SCOPE) {
    throw new BadRequestException(
      `Idempotency scope must be ${String(POLICY_REEVALUATION_IDEMPOTENCY_SCOPE)}`,
    );
  }
  if (
    request.idempotencyContext.key.trim().length === 0 ||
    request.idempotencyContext.key.length > 255
  ) {
    throw new BadRequestException('A4 re-evaluation idempotency key is invalid');
  }
  const evaluation = normalizeEvaluation(request.evaluation);
  return {
    ...request,
    idempotencyContext: {
      scope: POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
      key: request.idempotencyContext.key.trim(),
    },
    evaluation,
  };
}

function normalizeEvaluation(command: PolicyEvaluationCommand): PolicyEvaluationCommand {
  const customerId = normalizeUuid(command.subject.customerId);
  const capability = normalizePolicyKey(command.capability, 'capability');
  const action = normalizePolicyKey(command.action, 'action');
  const requestedAt = normalizeTimestamp(command.requestedAt);
  const asOf = normalizeTimestamp(command.sourceEvidenceRequest.asOf);
  if (command.sourceEvidenceRequest.evidenceProfile.trim().length === 0) {
    throw new BadRequestException('A4 evidence profile is required');
  }
  if (command.requestContext.requestId.trim().length === 0) {
    throw new BadRequestException('A4 requestId is required');
  }
  if (command.requestContext.correlationId.trim().length === 0) {
    throw new BadRequestException('A4 correlationId is required');
  }
  return {
    ...command,
    subject: { type: 'CUSTOMER', customerId },
    capability,
    action,
    requestedAt,
    sourceEvidenceRequest: {
      ...command.sourceEvidenceRequest,
      asOf,
      requiredSourceClasses: [...new Set(command.sourceEvidenceRequest.requiredSourceClasses)],
    },
    requestContext: {
      ...command.requestContext,
      requestId: command.requestContext.requestId.trim(),
      correlationId: command.requestContext.correlationId.trim(),
    },
  };
}

function normalizeCurrentRequest(
  request: PolicyCurrentEffectiveDecisionRequest,
): PolicyCurrentEffectiveDecisionRequest {
  if (request.evidenceProfile.trim().length === 0) {
    throw new BadRequestException('A4 evidence profile is required');
  }
  return {
    ...request,
    customerId: normalizeUuid(request.customerId),
    capability: normalizePolicyKey(request.capability, 'capability'),
    action: normalizePolicyKey(request.action, 'action'),
    asOf: normalizeTimestamp(request.asOf),
    evidenceProfile: request.evidenceProfile.trim(),
    requestContext: {
      ...request.requestContext,
      requestId: request.requestContext.requestId.trim(),
      correlationId: request.requestContext.correlationId.trim(),
    },
  };
}

function snapshotMatchesCurrentRequest(
  snapshot: Readonly<PolicyEvidenceSnapshot>,
  request: PolicyCurrentEffectiveDecisionRequest,
): boolean {
  try {
    return (
      snapshot.contractName === 'A4-EVIDENCE-SNAPSHOT' &&
      snapshot.contractVersion === 1 &&
      snapshot.subject.type === 'CUSTOMER' &&
      normalizeUuid(snapshot.subject.customerId) === request.customerId &&
      snapshot.policyRequestScope.capability === request.capability &&
      snapshot.policyRequestScope.action === request.action &&
      snapshot.policyRequestScope.evidenceProfile === request.evidenceProfile &&
      normalizeTimestamp(snapshot.policyRequestScope.asOf) === request.asOf
    );
  } catch {
    return false;
  }
}

function classifyRecoveryFailure(error: unknown): PolicyRecoveryFailureLike {
  if (error instanceof PolicyRetryableRecoveryError) {
    return {
      code: error.recoveryCode,
      retryable: true,
      unknownOutcome: error.unknownOutcome,
    };
  }
  if (error instanceof ForbiddenException) {
    return { code: 'A4_AUTHORIZATION_DENIED', retryable: false, unknownOutcome: false };
  }
  if (error instanceof BadRequestException) {
    return { code: 'A4_INVALID_REQUEST', retryable: false, unknownOutcome: false };
  }
  if (error instanceof ConflictException) {
    return { code: 'A4_POLICY_CONFLICT', retryable: false, unknownOutcome: false };
  }
  const candidate = error as {
    readonly code?: unknown;
    readonly recoveryCode?: unknown;
    readonly retryable?: unknown;
    readonly unknownOutcome?: unknown;
  };
  const code =
    typeof candidate.recoveryCode === 'string'
      ? candidate.recoveryCode
      : typeof candidate.code === 'string'
        ? candidate.code
        : 'A4_UNKNOWN_OUTCOME';
  return {
    code: code.length > 80 ? 'A4_UNKNOWN_OUTCOME' : code,
    retryable:
      candidate.retryable === true ||
      candidate.unknownOutcome === true ||
      RETRYABLE_CODES.has(code),
    unknownOutcome: candidate.unknownOutcome === true || candidate.retryable !== false,
  };
}

function deduplicateStable(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeUuid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new BadRequestException('Customer ID must be a UUID');
  return normalized;
}

function normalizePolicyKey(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!POLICY_KEY_PATTERN.test(normalized)) {
    throw new BadRequestException(`${field} is not a canonical A4 policy key`);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('A4 policy timestamp is invalid');
  }
  return parsed.toISOString();
}

function hashCanonical(value: unknown): string {
  const json = canonicalJson(value);
  // The evaluator uses the same canonical JSON/SHA-256 rule. Keeping the
  // recovery reference content-addressed makes retries and replays stable.
  return createSha256(json);
}

function createSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export { CapabilityPolicyRecoveryService as CapabilityPolicyReevaluationService };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
