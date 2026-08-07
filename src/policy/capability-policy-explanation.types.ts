import type {
  PolicyDecisionResult,
  PolicyEvidenceSourceReference,
  PolicyLimitOutput,
  PolicyObligation,
} from './capability-policy.types';
import type {
  PolicyExplanationAudience,
  PolicyExplanationReasonSeverity,
} from './capability-policy-explanation.enums';

export interface PolicyExplanationReason {
  readonly code: string;
  readonly messageKey: string;
  readonly severity: PolicyExplanationReasonSeverity;
}

export interface PolicyExplanationObligation {
  readonly code: string;
  readonly required: boolean;
  readonly dueAt?: string;
  readonly expiresAt?: string;
  readonly reference?: string;
}

export interface PolicyExplanationLimit extends PolicyLimitOutput {
  readonly type: string;
}

export interface PolicyExplanationSourceReference {
  readonly sourceClass: PolicyEvidenceSourceReference['sourceClass'];
  readonly sourceType: string;
  readonly sourceId?: string;
  readonly sourceVersion?: string | number;
  readonly observedAt?: string;
  readonly freshnessState: PolicyEvidenceSourceReference['freshnessState'];
  readonly classification?: string;
  readonly reference?: string;
}

export interface PolicyExplanationProvenance {
  readonly decisionReference?: string;
  readonly profileReference?: string;
  readonly profileVersion?: number;
  readonly definitionHash?: string;
  readonly snapshotReference?: string;
  readonly snapshotContractVersion?: number;
  readonly normalizedInputHash?: string;
  readonly resultHash?: string;
  readonly collectionStatus?: string;
  readonly freshnessSummary?: readonly string[];
  readonly sourceReferences: readonly PolicyExplanationSourceReference[];
  readonly authorizationContextReference?: string;
  readonly requestContext?: {
    readonly requestId?: string;
    readonly correlationId?: string;
    readonly traceId?: string;
    readonly causationId?: string;
  };
}

export interface PolicyExplanationResult {
  readonly contractName: 'A4-CAPABILITY-EXPLANATION';
  readonly contractVersion: 1;
  readonly audience: PolicyExplanationAudience;
  readonly readOnly: true;
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly decision: PolicyDecisionResult['decision'];
  readonly policyVersion: string;
  readonly evaluatedAt: string;
  readonly expiresAt: string | null;
  readonly reviewAt: string | null;
  readonly reasons: readonly PolicyExplanationReason[];
  readonly obligations: readonly PolicyExplanationObligation[];
  readonly limits: readonly PolicyExplanationLimit[];
  readonly provenance: PolicyExplanationProvenance;
}

export interface PolicyExplanationRequest {
  readonly decision: Readonly<PolicyDecisionResult>;
  readonly audience: PolicyExplanationAudience;
}

export interface PolicyExplanationAudiencePolicy {
  readonly includeInternalReasonCodes: boolean;
  readonly includeSourceReferences: boolean;
  readonly includeDecisionReferences: boolean;
  readonly includeLimitReferences: boolean;
  readonly includeRequestContext: boolean;
}

export type PolicyObligationSource = PolicyObligation;
