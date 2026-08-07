import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationPrincipal,
} from '../authorization/authorization.types';
import type {
  PolicyAccountBindingRequirement,
  PolicyCollectionStatus,
  PolicyComplianceRequirement,
  PolicyDecisionState,
  PolicyEnrollmentRequirement,
  PolicyEvidenceFreshnessState,
  PolicyLimitDimension,
  PolicyLimitEvaluationStatus,
  PolicyLimitRequirement,
  PolicyPermissionRequirement,
  PolicyRequirementMode,
  PolicyRiskRequirement,
  PolicySourceClass,
} from './capability-policy.enums';

export type PolicyJsonValue =
  | string
  | number
  | boolean
  | null
  | PolicyJsonValue[]
  | { readonly [key: string]: PolicyJsonValue };

export interface PolicyEvidenceSourceReference {
  readonly sourceClass: PolicySourceClass;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly customerId: string;
  readonly sourceVersion?: string | number | null;
  readonly observedAt: string;
  readonly freshnessState: PolicyEvidenceFreshnessState;
  readonly classification?: string;
  readonly reference?: string | null;
}

export interface PolicyEvidenceItem {
  readonly sourceClass: PolicySourceClass;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly customerId: string;
  readonly sourceVersion?: string | number | null;
  readonly sourceUpdatedAt?: string | null;
  readonly observedAt: string;
  readonly deleted: boolean;
  readonly freshnessState: PolicyEvidenceFreshnessState;
  readonly freshnessReasonCode?: string;
  readonly classification: string;
  readonly normalizedValue: Readonly<Record<string, unknown>>;
  readonly sourceReference?: string | null;
}

export interface PolicyEvidenceSnapshot {
  readonly contractName: 'A4-EVIDENCE-SNAPSHOT';
  readonly contractVersion: 1;
  readonly snapshotReference: string;
  readonly subject: {
    readonly type: 'CUSTOMER';
    readonly customerId: string;
  };
  readonly policyRequestScope: {
    readonly capability: string;
    readonly action: string;
    readonly requestedAt: string;
    readonly asOf: string;
    readonly evidenceProfile: string;
    readonly policyVersionHint?: string;
    readonly evaluationContext?: Readonly<Record<string, unknown>>;
    readonly targetBindingId?: string;
  };
  readonly collection: {
    readonly status: PolicyCollectionStatus;
    readonly startedAt?: string;
    readonly collectedAt: string;
    readonly requiredSourceClasses: readonly PolicySourceClass[];
    readonly collectedSourceClasses: readonly PolicySourceClass[];
    readonly missingSourceClasses: readonly PolicySourceClass[];
    readonly unavailableSourceClasses: readonly PolicySourceClass[];
    readonly restrictedSourceClasses: readonly PolicySourceClass[];
    readonly conflictSourceClasses: readonly PolicySourceClass[];
  };
  readonly sourceItems: readonly PolicyEvidenceItem[];
  readonly evidenceSummary: {
    readonly freshnessStates: readonly PolicyEvidenceFreshnessState[];
    readonly sourceCount: number;
    readonly normalizedInputHash: string;
  };
  readonly integrity: {
    readonly canonicalizationVersion: number;
    readonly arrayOrderingRule: string;
    readonly hashAlgorithm: 'SHA-256';
  };
}

export interface PolicySourceRequirements {
  readonly [PolicySourceClass.CUSTOMER]: PolicyRequirementMode;
  readonly [PolicySourceClass.ONBOARDING]: PolicyRequirementMode;
  readonly [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode;
  readonly [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode;
  readonly [PolicySourceClass.LIMITS]: PolicyRequirementMode;
  readonly [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode;
  readonly [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode;
  readonly [PolicySourceClass.RISK]: PolicyRequirementMode;
  readonly [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode;
  readonly [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode;
  readonly [PolicySourceClass.AUTHORIZATION]: PolicyRequirementMode;
}

export interface PolicyProductEligibilityRequirements {
  readonly customerLifecycle: 'ACTIVE_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED';
  readonly onboarding: 'COMPLETED_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED';
  readonly eligibility: 'ELIGIBLE_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED';
  readonly restrictions: 'NO_BLOCKING_RESTRICTION' | 'PROFILE_CONTROLLED' | 'NOT_REQUIRED';
  readonly risk: PolicyRiskRequirement;
  readonly compliance: PolicyComplianceRequirement;
  readonly accountState: 'ACTIVE_REQUIRED' | 'PROFILE_CONTROLLED' | 'NOT_REQUIRED';
}

export interface PolicyEnrollmentRequirements {
  readonly mode: PolicyEnrollmentRequirement;
  readonly productKey?: string;
}

export interface PolicyPermissionRequirements {
  readonly mode: PolicyPermissionRequirement;
  readonly permissionType?: string;
}

export interface PolicyRiskRequirements {
  readonly mode: PolicyRiskRequirement;
}

export interface PolicyComplianceRequirements {
  readonly mode: PolicyComplianceRequirement;
}

export interface PolicyAccountBindingRequirements {
  readonly mode: PolicyAccountBindingRequirement;
}

export interface PolicyLimitRequirements {
  readonly mode: PolicyLimitRequirement;
  readonly dimensions: readonly PolicyLimitDimension[];
  readonly returnsLimits: boolean;
}

export interface PolicyObligationTemplate {
  readonly code: string;
  readonly required: boolean;
  readonly dueAtField?: string;
  readonly reference?: string;
}

export interface PolicyDecisionValidity {
  /** A bounded, immutable validity interval for a decision produced by this profile. */
  readonly expiresInSeconds: number;
}

export interface CapabilityPolicyProfile {
  readonly profileReference: string;
  readonly profileKey: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly definitionHash: string;
  readonly decisionValidity?: PolicyDecisionValidity;
  readonly capability: string;
  readonly actions: readonly string[];
  readonly subjectType: 'CUSTOMER';
  readonly contractName: 'A4-CAPABILITY-POLICY';
  readonly contractVersion: 1;
  readonly profileContractVersion: 1;
  readonly evidenceRequirements: PolicySourceRequirements;
  readonly productEligibility: PolicyProductEligibilityRequirements;
  readonly enrollmentRequirement: PolicyEnrollmentRequirements;
  readonly permissionRequirement: PolicyPermissionRequirements;
  readonly riskRequirement: PolicyRiskRequirements;
  readonly complianceRequirement: PolicyComplianceRequirements;
  readonly accountBindingRequirement: PolicyAccountBindingRequirements;
  readonly limitRequirement: PolicyLimitRequirements;
  readonly allowedDecisions: readonly PolicyDecisionState[];
  readonly obligations: readonly PolicyObligationTemplate[];
}

export interface PolicyLimitUsageContext {
  readonly amountMinor?: string;
  readonly currency?: string;
  readonly dailyUsedCount?: number;
  readonly dailyUsedAmountMinor?: string;
  readonly monthlyUsedAmountMinor?: string;
  readonly projectedWalletBalanceMinor?: string;
  readonly usageAsOf?: string;
  readonly usageSourceReference?: string;
}

export interface PolicyEvaluationContext {
  readonly currency?: string;
  readonly channel?: string;
  readonly product?: string;
  readonly targetBindingId?: string;
  readonly declaredContext?: Readonly<Record<string, unknown>>;
  readonly limitUsage?: PolicyLimitUsageContext;
}

export interface PolicyDecisionRequest {
  readonly contractName: 'A4-CAPABILITY-POLICY';
  readonly contractVersion: 1;
  readonly subject: {
    readonly type: 'CUSTOMER';
    readonly customerId: string;
  };
  readonly capability: string;
  readonly action: string;
  readonly requestedAt: string;
  readonly evaluationContext?: PolicyEvaluationContext;
  readonly actorContext: {
    readonly principal: AuthorizationPrincipal;
    readonly authorizationDecision?: AuthorizationDecision;
  };
  readonly sourceEvidenceRequest: {
    readonly evidenceProfile: string;
    readonly asOf: string;
    readonly requiredSourceClasses: readonly PolicySourceClass[];
  };
  readonly policyVersionHint?: string;
  readonly requestContext: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly traceId?: string;
    readonly causationId?: string;
  };
  readonly idempotencyContext?: {
    readonly scope: string;
    readonly key: string;
  };
}

export interface PolicyLimitCheck {
  readonly dimension: PolicyLimitDimension;
  readonly configuredValue: string | number | null;
  readonly observedValue: string | number | null;
  readonly proposedValue: string | number | null;
  readonly remainingValue: string | number | null;
  readonly passed: boolean;
  readonly reasonCode?: string;
}

export interface PolicyLimitEvaluation {
  readonly status: PolicyLimitEvaluationStatus;
  readonly capability: string;
  readonly action: string;
  readonly profileVersion: number;
  readonly currency: string | null;
  readonly checks: readonly PolicyLimitCheck[];
  readonly effectiveLimits: readonly PolicyLimitOutput[];
  readonly usageAsOf: string | null;
  readonly evaluatedAt: string;
  readonly limitReference: string | null;
}

export interface PolicyLimitOutput {
  readonly type: string;
  readonly currency?: string;
  readonly amountMinor?: string;
  readonly count?: number;
  readonly period?: string;
  readonly remainingMinor?: string;
  readonly remainingCount?: number;
  readonly limitReference?: string;
}

export interface PolicyObligation {
  readonly code: string;
  readonly required: boolean;
  readonly dueAt?: string;
  readonly expiresAt?: string;
  readonly reference?: string;
}

export interface PolicyDecisionResult {
  readonly contractName: 'A4-CAPABILITY-POLICY';
  readonly contractVersion: 1;
  readonly decisionReference: string;
  readonly subject: {
    readonly type: 'CUSTOMER';
    readonly customerId: string;
  };
  readonly capability: string;
  readonly action: string;
  readonly profileReference: string;
  readonly profileKey: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly definitionHash: string;
  readonly decision: PolicyDecisionState;
  /** Immutable append-only lineage; the referenced result is never mutated. */
  readonly supersedesDecisionReference?: string;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string | null;
  readonly reviewAt: string | null;
  readonly reasonCodes: readonly string[];
  readonly explanation: {
    readonly key: string;
    readonly audience: 'INTERNAL';
  };
  readonly obligations: readonly PolicyObligation[];
  readonly limits: readonly PolicyLimitOutput[];
  readonly sourceReferences: readonly PolicyEvidenceSourceReference[];
  readonly evidenceContext: {
    readonly snapshotReference: string;
    readonly snapshotContractVersion: number;
    readonly normalizedInputHash: string;
    readonly freshnessSummary: readonly PolicyEvidenceFreshnessState[];
    readonly collectionStatus: PolicyCollectionStatus;
  };
  readonly authorizationContextReference: string;
  readonly requestHash: string;
  readonly resultHash: string;
  readonly idempotencyReplay: boolean;
  readonly requestContext: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly traceId?: string;
    readonly causationId?: string;
  };
}

export interface PolicyEvaluationCommand extends PolicyDecisionRequest {
  readonly snapshot: Readonly<PolicyEvidenceSnapshot>;
}

export interface PolicyProfileRegistry {
  getProfile(
    capability: string,
    action: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null>;
}

export interface PolicyDecisionStore {
  findByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null>;
  save(result: PolicyDecisionResult): Promise<void>;
  findByDecisionReference(decisionReference: string): Promise<PolicyDecisionResult | null>;
}

export interface PolicyIdempotencyCommand {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
}

export interface PolicyIdempotencyReservation {
  readonly kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS';
  readonly reservationId: string;
  readonly result?: PolicyDecisionResult;
  readonly decisionReference?: string;
}

export interface PolicyIdempotencyPort {
  reserve(command: PolicyIdempotencyCommand): Promise<PolicyIdempotencyReservation>;
  complete(reservationId: string, result: PolicyDecisionResult): Promise<void>;
  fail(reservationId: string, reason: string): Promise<void>;
}

export interface PolicyAuditFact {
  readonly action: string;
  readonly decisionReference: string;
  readonly customerId: string;
  readonly capability: string;
  readonly policyVersion: string;
  readonly decision?: PolicyDecisionState;
  readonly requestHash: string;
  readonly normalizedInputHash: string;
  readonly correlationId: string;
  readonly requestId?: string;
  readonly actor: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PolicyAuditPort {
  record(fact: PolicyAuditFact): Promise<void>;
}

export interface PolicyAuthorizationPort {
  authorize(
    principal: AuthorizationPrincipal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: {
      readonly type: string;
      readonly id?: string;
      readonly customerId?: string;
    },
  ): Promise<AuthorizationDecision>;
}
