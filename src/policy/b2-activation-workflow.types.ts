/**
 * B2T05 — B2 activation workflow types.
 *
 * The B2 activation workflow consumes B2T03 customer readiness and B2T04
 * merchant/agent readiness through their consumer ports only and never
 * recalculates readiness. Activation is allowed only when the readiness
 * outcome is ATTESTED_READY. The workflow is deterministic, replay-safe,
 * and supports the state machine PENDING -> ACTIVE -> SUSPENDED ->
 * REVOKED with a dedicated idempotency scope. It exposes only read-only
 * consumer ports to later B2 tasks.
 */

import type { RequestContext } from '../production/request-context';

export type B2ActivationWorkflowContractName = 'B2-ACTIVATION-WORKFLOW';
export type B2ActivationWorkflowContractVersion = 1;

export type B2ActivationState = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type B2ActivationOutcome = 'PENDING' | 'ACTIVATED' | 'SUSPENDED' | 'REVOKED' | 'REJECTED';

export type B2ActivationPrincipalKind = 'CUSTOMER' | 'MERCHANT' | 'AGENT';

export type B2ActivationWorkflowRuleKind =
  | 'READINESS_CONSUMPTION'
  | 'COHORT_COMPATIBILITY'
  | 'B1_SCOPE_COMPATIBILITY'
  | 'ACTIVATION_STATE_MACHINE';

export type B2ActivationWorkflowRuleOutcome = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

export type B2ActivationWorkflowFailureCode =
  | 'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND'
  | 'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE'
  | 'B2_ACTIVATION_WORKFLOW_QUERY_UNAVAILABLE'
  | 'B2_ACTIVATION_WORKFLOW_PROHIBITED'
  | 'B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY'
  | 'B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT'
  | 'B2_ACTIVATION_WORKFLOW_REPLAY_EXPIRED'
  | 'B2_ACTIVATION_WORKFLOW_IN_PROGRESS'
  | 'B2_ACTIVATION_WORKFLOW_NOT_FOUND'
  | 'B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION';

export interface B2ActivationWorkflowRequestV1 {
  readonly kind: B2ActivationPrincipalKind;
  readonly principalId: string;
  readonly beneficialOwnerCustomerId?: string;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
  readonly readinessOutcome: 'ATTESTED_READY';
  readonly readinessReference: string;
  readonly readinessKind: 'CUSTOMER' | 'MERCHANT' | 'AGENT';
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2ActivationWorkflowDecisionV1 {
  readonly activationReference: string;
  readonly activationVersion: 1;
  readonly kind: B2ActivationPrincipalKind;
  readonly principalId: string;
  readonly beneficialOwnerCustomerId: string | null;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly region: 'NG';
  readonly state: B2ActivationState;
  readonly outcome: B2ActivationOutcome;
  readonly readinessReference: string;
  readonly readinessOutcome: 'ATTESTED_READY';
  readonly ruleTrace: readonly B2ActivationWorkflowRuleTraceStepV1[];
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.activation-workflow.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-ACTIVATION-WORKFLOW';
  readonly contractVersion: 1;
}

export interface B2ActivationWorkflowRuleTraceStepV1 {
  readonly kind: B2ActivationWorkflowRuleKind;
  readonly outcome: B2ActivationWorkflowRuleOutcome;
  readonly code: B2ActivationWorkflowFailureCode | null;
  readonly detail: string | null;
}

export interface B2ActivationWorkflowFailureV1 {
  readonly code: B2ActivationWorkflowFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2ActivationWorkflowReplaySafeResultV1 {
  readonly decision: B2ActivationWorkflowDecisionV1 | null;
  readonly failure: B2ActivationWorkflowFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2ActivationWorkflowCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2ActivationWorkflowFailureV1 | null;
}

export interface B2ActivationWorkflowConsumerPortsV1 {
  readonly contractName: B2ActivationWorkflowContractName;
  readonly contractVersion: B2ActivationWorkflowContractVersion;
  readonly idempotencyScope: 'b2.activation-workflow.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}

export interface B2ActivationWorkflowTransitionRequestV1 {
  readonly activationReference: string;
  readonly targetState: B2ActivationState;
  readonly causationId: string;
  readonly requestContext: RequestContext;
}

export interface B2ActivationWorkflowPersistenceRecordV1 {
  readonly activationReference: string;
  readonly activationVersion: 1;
  readonly kind: B2ActivationPrincipalKind;
  readonly principalId: string;
  readonly state: B2ActivationState;
  readonly outcome: B2ActivationOutcome;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly record: B2ActivationWorkflowDecisionV1;
}
