import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from './capability-policy.enums';
import type {
  CapabilityPolicyProfile,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyIdempotencyPort,
  PolicyProfileRegistry,
  PolicyDecisionStore,
} from './capability-policy.types';
import type {
  PolicyCurrentnessState,
  PolicyProfileVersionState,
  PolicyRecoveryState,
  PolicyReevaluationState,
  PolicyReevaluationTrigger,
} from './capability-policy-recovery.enums';

export const POLICY_REEVALUATION_CONTRACT = 'A4-POLICY-REEVALUATION' as const;
export const POLICY_REEVALUATION_CONTRACT_VERSION = 1 as const;
// Re-evaluation remains inside the A4T02/A4T07 Operations scope. Its
// request hash contains the snapshot/trigger/lineage fields needed to keep
// re-evaluation payloads distinct without inventing a second authority.
export const POLICY_REEVALUATION_IDEMPOTENCY_SCOPE = 'policy.capability-decision.v1' as const;

export interface PolicyEvidenceFreshnessAssessment {
  readonly status: PolicyCurrentnessState;
  readonly safeToAllow: boolean;
  readonly integrityValid: boolean;
  readonly degradedSourceClasses: readonly PolicySourceClass[];
  readonly freshnessStates: readonly PolicyEvidenceFreshnessState[];
  readonly reasonCodes: readonly string[];
  readonly collectionStatus: PolicyCollectionStatus;
}

export interface PolicyReevaluationRequest {
  readonly contractName: typeof POLICY_REEVALUATION_CONTRACT;
  readonly contractVersion: typeof POLICY_REEVALUATION_CONTRACT_VERSION;
  readonly trigger: PolicyReevaluationTrigger;
  readonly evaluation: PolicyEvaluationCommand;
  readonly previousDecisionReference?: string;
  readonly idempotencyContext: {
    readonly scope: typeof POLICY_REEVALUATION_IDEMPOTENCY_SCOPE;
    readonly key: string;
  };
}

export interface PolicyCurrentEffectiveDecisionRequest {
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly asOf: string;
  readonly evidenceProfile: string;
  readonly evaluationContext?: PolicyEvaluationCommand['evaluationContext'];
  readonly actorContext: PolicyEvaluationCommand['actorContext'];
  readonly requestContext: PolicyEvaluationCommand['requestContext'];
  /** A caller may supply an already captured immutable current snapshot. */
  readonly currentSnapshot?: Readonly<PolicyEvaluationCommand['snapshot']>;
}

export interface PolicyCurrentEffectiveDecisionQuery {
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly asOf: string;
  readonly targetBindingId?: string;
}

export interface PolicyCurrentEffectiveDecisionResult {
  readonly contractName: 'A4-CURRENT-EFFECTIVE-POLICY';
  readonly contractVersion: 1;
  readonly currentness: PolicyCurrentnessState;
  readonly decision: PolicyDecisionResult | null;
  readonly requiresReevaluation: boolean;
  readonly recoveryState: PolicyRecoveryState;
  readonly reasonCodes: readonly string[];
  readonly checkedAt: string;
}

export interface PolicyCurrentEvidenceRequest {
  readonly subject: {
    readonly type: 'CUSTOMER';
    readonly customerId: string;
  };
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly asOf: string;
  readonly evidenceProfile: string;
  readonly policyVersionHint?: string;
  readonly evaluationContext?: PolicyEvaluationCommand['evaluationContext'];
  readonly actorContext: PolicyEvaluationCommand['actorContext'];
  readonly requestContext: PolicyEvaluationCommand['requestContext'];
}

export interface PolicyCurrentEvidencePort {
  getCurrentSnapshot(
    request: PolicyCurrentEvidenceRequest,
  ): Promise<Readonly<PolicyEvaluationCommand['snapshot']>>;
}

export interface PolicyProfileLifecyclePort {
  getVersionState(policyVersion: string): Promise<PolicyProfileVersionState>;
  getCurrentPolicyVersion(capability: string, action: string, asOf: string): Promise<string | null>;
}

export interface PolicyDecisionLifecycleStore extends PolicyDecisionStore {
  findCurrentEffectiveDecision(
    query: PolicyCurrentEffectiveDecisionQuery,
  ): Promise<PolicyDecisionResult | null>;
}

export interface PolicyDecisionEvaluator {
  evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult>;
}

export interface PolicyRecoveryDiagnostic {
  readonly diagnosticType: 'A4_POLICY_RECOVERY';
  readonly reevaluationReference: string;
  readonly action: string;
  readonly trigger: PolicyReevaluationTrigger;
  readonly state: PolicyReevaluationState;
  readonly recoveryState: PolicyRecoveryState;
  readonly currentness: PolicyCurrentnessState | null;
  readonly customerId: string;
  readonly capability: string;
  readonly policyVersion: string;
  readonly decisionReference?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly requestId: string;
  readonly code: string;
}

export interface PolicyRecoveryDiagnosticsPort {
  record(diagnostic: PolicyRecoveryDiagnostic): Promise<void>;
}

export interface PolicyRecoveryClock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface PolicyRecoveryRetryConfiguration {
  readonly maxAttempts: number;
  readonly baseDelayMilliseconds: number;
  readonly maxDelayMilliseconds: number;
}

export interface PolicyRecoveryServiceOptions {
  readonly currentEvidence?: PolicyCurrentEvidencePort;
  readonly profileLifecycle?: PolicyProfileLifecyclePort;
  readonly diagnostics?: PolicyRecoveryDiagnosticsPort;
  readonly clock?: PolicyRecoveryClock;
  readonly retry?: Partial<PolicyRecoveryRetryConfiguration>;
  readonly maxConcurrentEvaluations?: number;
}

export interface PolicyReevaluationRecovery {
  readonly state: PolicyRecoveryState;
  readonly code: string;
  readonly currentness: PolicyCurrentnessState | null;
  readonly retryable: boolean;
  readonly manualReviewRequired: boolean;
}

export interface PolicyReevaluationResult {
  readonly contractName: typeof POLICY_REEVALUATION_CONTRACT;
  readonly contractVersion: typeof POLICY_REEVALUATION_CONTRACT_VERSION;
  readonly reevaluationReference: string;
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly requestHash: string;
  readonly normalizedInputHash: string;
  readonly trigger: PolicyReevaluationTrigger;
  readonly state: PolicyReevaluationState;
  readonly decision: PolicyDecisionResult | null;
  readonly previousDecisionReference: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly recovery: PolicyReevaluationRecovery;
  readonly idempotencyReplay: boolean;
  readonly requestContext: PolicyEvaluationCommand['requestContext'];
}

export interface PolicyRecoveryFailure {
  readonly code: string;
  readonly retryable: boolean;
  readonly unknownOutcome: boolean;
}

export type PolicyRecoveryPolicyProfile = CapabilityPolicyProfile;
export type PolicyRecoveryPrincipal = AuthorizationPrincipal;
export type PolicyRecoveryRequest = PolicyDecisionRequest;
export type PolicyRecoveryIdempotencyPort = PolicyIdempotencyPort;
export type PolicyRecoveryProfileRegistry = PolicyProfileRegistry;
export type PolicyRecoveryDecisionState = PolicyDecisionState;
