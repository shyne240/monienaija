/**
 * B2T03 — B2 customer activation-readiness types.
 *
 * The B2 customer activation-readiness is a deterministic, replay-safe
 * attestation that verifies KYC, A3 binding, A4 policy eligibility, A7
 * product compatibility, B1 tier/entitlement compatibility, and
 * CustomerConsent for the bounded first activation cohort
 * `b2.activation.cohort.inbound-funding` v1. The attestation is never an
 * activation, never a public API, never a credential, never a webhook, and
 * never a notification. It exposes only read-only consumer ports to later
 * B2 tasks (B2T05 activation workflows).
 */

import type { RequestContext } from '../production/request-context';

export type B2CustomerActivationReadinessContractName = 'B2-CUSTOMER-ACTIVATION-READINESS';
export type B2CustomerActivationReadinessContractVersion = 1;

export type B2CustomerActivationReadinessVerificationState =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'SUSPENDED'
  | 'BLOCKED';

export type B2CustomerActivationReadinessEligibility =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'REQUIRES_CONSENT';

export type B2CustomerActivationReadinessOutcome =
  | 'ATTESTED_READY'
  | 'ATTESTED_NOT_READY'
  | 'ATTESTED_REQUIRES_CONSENT'
  | 'REJECTED';

export type B2CustomerActivationReadinessRuleKind =
  | 'A3_BINDING_RECHECK'
  | 'A4_POLICY_ELIGIBILITY'
  | 'A4_POLICY_CURRENTNESS'
  | 'A7_PRODUCT_COMPATIBILITY'
  | 'B1_TIER_COMPATIBILITY'
  | 'B1_ENTITLEMENT_COMPATIBILITY'
  | 'CUSTOMER_CONSENT'
  | 'KYC_VERIFICATION'
  | 'CUSTOMER_IDENTITY';

export type B2CustomerActivationReadinessRuleOutcome = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

export type B2CustomerActivationReadinessFailureCode =
  | 'B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_QUERY_UNAVAILABLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_PROHIBITED'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_CUSTOMER_NOT_FOUND'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_KYC_NOT_VERIFIED'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_A3_BINDING_INVALID'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_A4_NOT_ELIGIBLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_A7_INCOMPATIBLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_B1_TIER_INELIGIBLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_B1_ENTITLEMENT_INELIGIBLE'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_CONSENT_NOT_GRANTED'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_EXPIRED'
  | 'B2_CUSTOMER_ACTIVATION_READINESS_IN_PROGRESS';

export interface B2CustomerActivationReadinessRequestV1 {
  readonly customerId: string;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly a7ProductKey: 'VIRTUAL_ACCOUNT';
  readonly a7ProductVersion: 1;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
  readonly consentPurpose: 'B2_ACTIVATION';
  readonly kycVerificationState: B2CustomerActivationReadinessVerificationState;
  readonly a3BindingState: 'VERIFIED' | 'INVALID' | 'NOT_FOUND';
  readonly a4EligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly a4CurrentnessState: 'CURRENT' | 'EXPIRED';
  readonly a7CompatibilityState: 'COMPATIBLE' | 'INCOMPATIBLE';
  readonly b1TierState: 'COMPATIBLE' | 'INELIGIBLE';
  readonly b1EntitlementState: 'COMPATIBLE' | 'INELIGIBLE';
  readonly customerConsentState: 'GRANTED' | 'NOT_GRANTED' | 'REVOKED';
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2CustomerActivationReadinessDecisionV1 {
  readonly attestationReference: string;
  readonly attestationVersion: 1;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly customerId: string;
  readonly verificationState: B2CustomerActivationReadinessVerificationState;
  readonly activationEligibility: B2CustomerActivationReadinessEligibility;
  readonly activationReady: boolean;
  readonly activationReadyAt: string | null;
  readonly outcome: B2CustomerActivationReadinessOutcome;
  readonly ruleTrace: readonly B2CustomerActivationReadinessRuleTraceStepV1[];
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.customer-activation-readiness.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly contractName: 'B2-CUSTOMER-ACTIVATION-READINESS';
  readonly contractVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
}

export interface B2CustomerActivationReadinessRuleTraceStepV1 {
  readonly kind: B2CustomerActivationReadinessRuleKind;
  readonly outcome: B2CustomerActivationReadinessRuleOutcome;
  readonly code: B2CustomerActivationReadinessFailureCode | null;
  readonly detail: string | null;
}

export interface B2CustomerActivationReadinessFailureV1 {
  readonly code: B2CustomerActivationReadinessFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2CustomerActivationReadinessReplaySafeResultV1 {
  readonly decision: B2CustomerActivationReadinessDecisionV1 | null;
  readonly failure: B2CustomerActivationReadinessFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2CustomerActivationReadinessCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2CustomerActivationReadinessFailureV1 | null;
}

export interface B2CustomerActivationReadinessConsumerPortsV1 {
  readonly contractName: B2CustomerActivationReadinessContractName;
  readonly contractVersion: B2CustomerActivationReadinessContractVersion;
  readonly idempotencyScope: 'b2.customer-activation-readiness.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}

export interface B2CustomerActivationReadinessPersistenceRecordV1 {
  readonly attestationReference: string;
  readonly attestationVersion: 1;
  readonly customerId: string;
  readonly cohortKey: string;
  readonly cohortVersion: number;
  readonly verificationState: B2CustomerActivationReadinessVerificationState;
  readonly activationEligibility: B2CustomerActivationReadinessEligibility;
  readonly activationReady: boolean;
  readonly outcome: B2CustomerActivationReadinessOutcome;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly record: B2CustomerActivationReadinessDecisionV1;
}
