/**
 * B2T04 — B2 merchant and agent activation-readiness types.
 *
 * The B2 merchant and agent activation-readiness is a deterministic,
 * replay-safe attestation that verifies business identity,
 * beneficial-owner linkage, settlement eligibility, commercial
 * eligibility, A4 policy eligibility, and required consents for the
 * bounded first cohort `b2.activation.cohort.inbound-funding` v1. At
 * B2T04 the merchant and agent cohorts are `DRAFT`→`PENDING_*
 * →`VERIFIED`→`SUSPENDED`→`REVOKED` through privileged approval and
 * never infer A3 bindings or CustomerPreference. The attestation
 * exposes only read-only consumer ports to later B2 tasks (B2T05).
 */

import type { RequestContext } from '../production/request-context';

export type B2MerchantAgentActivationReadinessContractName =
  'B2-MERCHANT-AGENT-ACTIVATION-READINESS';
export type B2MerchantAgentActivationReadinessContractVersion = 1;

export type B2MerchantAgentActivationReadinessKind = 'MERCHANT' | 'AGENT';

export type B2MerchantAgentVerificationState =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'SUSPENDED'
  | 'REVOKED';

export type B2MerchantAgentActivationReadinessEligibility =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'REQUIRES_CONSENT';

export type B2MerchantAgentActivationReadinessOutcome =
  | 'ATTESTED_READY'
  | 'ATTESTED_NOT_READY'
  | 'ATTESTED_REQUIRES_CONSENT'
  | 'REJECTED';

export type B2MerchantAgentActivationReadinessRuleKind =
  | 'BUSINESS_IDENTITY_VERIFICATION'
  | 'BENEFICIAL_OWNER_LINKAGE'
  | 'SETTLEMENT_ELIGIBILITY'
  | 'COMMERCIAL_ELIGIBILITY'
  | 'A4_POLICY_ELIGIBILITY'
  | 'CUSTOMER_CONSENT'
  | 'MERCHANT_IDENTITY'
  | 'AGENT_IDENTITY';

export type B2MerchantAgentActivationReadinessRuleOutcome =
  | 'PASS'
  | 'FAIL'
  | 'SKIP'
  | 'NOT_APPLICABLE';

export type B2MerchantAgentActivationReadinessFailureCode =
  | 'B2_MERCHANT_AGENT_READINESS_INVALID_COMMAND'
  | 'B2_MERCHANT_AGENT_READINESS_INCOMPATIBLE'
  | 'B2_MERCHANT_AGENT_READINESS_QUERY_UNAVAILABLE'
  | 'B2_MERCHANT_AGENT_READINESS_PROHIBITED'
  | 'B2_MERCHANT_AGENT_READINESS_MERCHANT_NOT_FOUND'
  | 'B2_MERCHANT_AGENT_READINESS_AGENT_NOT_FOUND'
  | 'B2_MERCHANT_AGENT_READINESS_BENEFICIAL_OWNER_NOT_VERIFIED'
  | 'B2_MERCHANT_AGENT_READINESS_BUSINESS_IDENTITY_NOT_VERIFIED'
  | 'B2_MERCHANT_AGENT_READINESS_SETTLEMENT_NOT_ELIGIBLE'
  | 'B2_MERCHANT_AGENT_READINESS_COMMERCIAL_NOT_ELIGIBLE'
  | 'B2_MERCHANT_AGENT_READINESS_A4_NOT_ELIGIBLE'
  | 'B2_MERCHANT_AGENT_READINESS_CONSENT_NOT_GRANTED'
  | 'B2_MERCHANT_AGENT_READINESS_REPLAY_CONFLICT'
  | 'B2_MERCHANT_AGENT_READINESS_REPLAY_EXPIRED'
  | 'B2_MERCHANT_AGENT_READINESS_IN_PROGRESS';

export interface B2MerchantActivationReadinessRequestV1 {
  readonly kind: 'MERCHANT';
  readonly merchantId: string;
  readonly beneficialOwnerCustomerId: string;
  readonly businessType: string;
  readonly registrationReference: string;
  readonly taxIdentifierReference: string;
  readonly settlementAccountReference: string;
  readonly businessIdentityState: 'VERIFIED' | 'PENDING' | 'UNVERIFIED';
  readonly beneficialOwnerState: 'VERIFIED' | 'UNVERIFIED';
  readonly settlementEligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly commercialEligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly a4EligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly consentState: 'GRANTED' | 'NOT_GRANTED' | 'REVOKED';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2AgentActivationReadinessRequestV1 {
  readonly kind: 'AGENT';
  readonly agentId: string;
  readonly supervisingMerchantId: string;
  readonly supervisingCustomerId: string;
  readonly agentNetwork: string;
  readonly terminalReference: string;
  readonly collectionModeReference: string;
  readonly businessIdentityState: 'VERIFIED' | 'PENDING' | 'UNVERIFIED';
  readonly beneficialOwnerState: 'VERIFIED' | 'UNVERIFIED';
  readonly settlementEligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly commercialEligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly a4EligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly consentState: 'GRANTED' | 'NOT_GRANTED' | 'REVOKED';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export type B2MerchantAgentActivationReadinessRequestV1 =
  | B2MerchantActivationReadinessRequestV1
  | B2AgentActivationReadinessRequestV1;

export interface B2MerchantAgentActivationReadinessDecisionV1 {
  readonly attestationReference: string;
  readonly attestationVersion: 1;
  readonly kind: B2MerchantAgentActivationReadinessKind;
  readonly principalId: string;
  readonly beneficialOwnerCustomerId: string;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly verificationState: B2MerchantAgentVerificationState;
  readonly activationEligibility: B2MerchantAgentActivationReadinessEligibility;
  readonly activationReady: boolean;
  readonly activationReadyAt: string | null;
  readonly outcome: B2MerchantAgentActivationReadinessOutcome;
  readonly ruleTrace: readonly B2MerchantAgentActivationReadinessRuleTraceStepV1[];
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly contractName: 'B2-MERCHANT-AGENT-ACTIVATION-READINESS';
  readonly contractVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
}

export interface B2MerchantAgentActivationReadinessRuleTraceStepV1 {
  readonly kind: B2MerchantAgentActivationReadinessRuleKind;
  readonly outcome: B2MerchantAgentActivationReadinessRuleOutcome;
  readonly code: B2MerchantAgentActivationReadinessFailureCode | null;
  readonly detail: string | null;
}

export interface B2MerchantAgentActivationReadinessFailureV1 {
  readonly code: B2MerchantAgentActivationReadinessFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2MerchantAgentActivationReadinessReplaySafeResultV1 {
  readonly decision: B2MerchantAgentActivationReadinessDecisionV1 | null;
  readonly failure: B2MerchantAgentActivationReadinessFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2MerchantAgentActivationReadinessCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2MerchantAgentActivationReadinessFailureV1 | null;
}

export interface B2MerchantAgentActivationReadinessConsumerPortsV1 {
  readonly contractName: B2MerchantAgentActivationReadinessContractName;
  readonly contractVersion: B2MerchantAgentActivationReadinessContractVersion;
  readonly idempotencyScopeMerchant: string;
  readonly idempotencyScopeAgent: string;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}
