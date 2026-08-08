/**
 * A7T07 — A7 product lifecycle, bounded retry, manual review, unknown
 * outcomes, and recovery types.
 *
 * The A7 product lifecycle contract is the runtime resilience and
 * lifecycle implementation for the A7 first product (`VIRTUAL_ACCOUNT`
 * v1). The A7 product lifecycle contract extends the A6 lifecycle
 * vocabulary (per `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07) without
 * replacing or duplicating the A6 lifecycle authority.
 *
 * The A7 product lifecycle contract consumes the A2 authorization
 * context, the A3 customer-to-financial-account binding, the A4
 * product-policy decision, the A6 lifecycle authority (A6T07
 * transitions, partner circuit-breaker, status verification, retry,
 * unknown-outcome recovery), the A6T05 external-operation identity
 * and provider idempotency (per ADR-0049), the A6 partner-adapter
 * boundary, the A7 product catalog (A7T02), the A7 product-policy
 * profile (A7T03), the A7 product customer-binding map (A7T04), the
 * A7 product command/operation identity (A7T05), and the A7 product
 * notification delivery (A7T06).
 *
 * No new A3 binding, A4 product-policy, A2 authorization, A6T05
 * external-operation, A6 partner, A6 lifecycle, A5 transfer command,
 * A7 product catalog, A7 product-policy profile, A7 product
 * customer-binding map, A7 product command/operation, A7 product
 * notification, Wallet, Ledger, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, or `CustomerPreference`
 * authority is introduced.
 */

import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';

/**
 * The A7 product-catalog product key for the first product. The A7
 * product lifecycle contract binds the A7 product lifecycle
 * identity to the A7 product catalog registration.
 */
export type A7ProductLifecycleProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A7 product lifecycle state vocabulary.
 */
export type A7ProductLifecycleState =
  | 'LIFECYCLE_PENDING'
  | 'LIFECYCLE_ADMITTED'
  | 'LIFECYCLE_PENDING_PARTNER'
  | 'LIFECYCLE_PENDING_VERIFICATION'
  | 'LIFECYCLE_UNKNOWN'
  | 'LIFECYCLE_MANUAL_REVIEW'
  | 'LIFECYCLE_RETRY_SCHEDULED'
  | 'LIFECYCLE_RECOVERY_ISSUED'
  | 'LIFECYCLE_FAILED'
  | 'LIFECYCLE_CANCELLED';

/**
 * The A7 product lifecycle product-state vocabulary (reused from the
 * A7T02 product catalog).
 */
export type A7ProductLifecycleProductState =
  | 'ASSIGN_REQUESTED'
  | 'ASSIGN_PENDING'
  | 'ASSIGN_ACTIVE'
  | 'ASSIGN_SUSPENDED'
  | 'ASSIGN_FAILED'
  | 'ASSIGN_CLOSED'
  | 'FUNDING_REQUESTED'
  | 'FUNDING_PENDING_VERIFICATION'
  | 'FUNDING_SETTLED'
  | 'FUNDING_UNKNOWN'
  | 'FUNDING_SUSPENDED'
  | 'FUNDING_FAILED'
  | 'FUNDING_CLOSED';

/**
 * The A7 product lifecycle retry class vocabulary.
 */
export type A7ProductLifecycleRetryClass =
  | 'SAFE_TRANSPORT'
  | 'PARTNER_REJECTION'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'STATUS_QUERY'
  | 'AMBIGUOUS_COMMIT'
  | 'NONE';

/**
 * The A7 product lifecycle outcome class vocabulary.
 */
export type A7ProductLifecycleOutcome =
  | 'OUTCOME_PENDING'
  | 'OUTCOME_VERIFIED'
  | 'OUTCOME_REJECTED'
  | 'OUTCOME_UNKNOWN'
  | 'OUTCOME_MANUAL_REVIEW'
  | 'OUTCOME_FAILED';

/**
 * The A7 product lifecycle reservation kind. The A7 product
 * lifecycle service returns one of:
 *  - 'NEW': the A7 internal idempotency scope/key is new; the A7
 *    product lifecycle service has reserved the scope/key and is
 *    creating a new A7 product lifecycle record;
 *  - 'REPLAY': the A7 internal idempotency scope/key matches an
 *    existing A7 product lifecycle record with the same canonical
 *    request hash; the A7 product lifecycle service returns the
 *    durable original A7 product lifecycle record with
 *    `replayed: true`;
 *  - 'IN_PROGRESS': the A7 internal idempotency scope/key matches an
 *    existing in-progress A7 product lifecycle reservation; the A7
 *    product lifecycle service returns a deterministic conflict;
 *  - 'CONFLICT': the A7 internal idempotency scope/key matches an
 *    existing A7 product lifecycle record with a different canonical
 *    request hash; the A7 product lifecycle service returns a
 *    deterministic conflict.
 */
export type A7ProductLifecycleReservationKind = 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';

/**
 * The A7 product lifecycle transition command. The A7 product
 * lifecycle service accepts the transition command, validates the A7
 * product lifecycle transition envelope, and returns the A7 product
 * lifecycle transition result. The A7 product lifecycle service
 * drives the A7 product lifecycle state transition alongside the A6
 * lifecycle state transition (the A6 lifecycle service records the
 * A6 lifecycle state transition through the A6T05
 * `ExternalOperationLifecycleService`; the A7 product lifecycle
 * service records the A7 product lifecycle state transition through
 * the shared Operations `AuditService` and `OutboxService`).
 */
export interface A7ProductLifecycleTransitionV1 {
  readonly contractName: 'A7-PRODUCT-LIFECYCLE';
  readonly contractVersion: 1;

  readonly productKey: A7ProductLifecycleProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductLifecycleProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;

  readonly currentLifecycleState: A7ProductLifecycleState;
  readonly nextLifecycleState: A7ProductLifecycleState;
  readonly outcome: A7ProductLifecycleOutcome;
  readonly retryClass: A7ProductLifecycleRetryClass;
  readonly attempt: number;

  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a7T06NotificationDeliveryReference: string | null;

  readonly recoveryReference: string | null;
  readonly manualReviewReason: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly providerStatus: string | null;

  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The A7 product lifecycle reservation result.
 */
export interface A7ProductLifecycleReservationV1 {
  readonly kind: A7ProductLifecycleReservationKind;
  readonly record: A7ProductLifecycleRecordV1 | null;
  readonly conflictReason: string | null;
}

/**
 * The A7 product lifecycle record. The A7 product lifecycle service
 * produces the A7 product lifecycle record from the A7 product
 * lifecycle transition envelope, the A7T05 product command/operation
 * identity, the A6T05 external-operation record, the A6 lifecycle
 * state, the A4 product-policy decision, the A2 authorization
 * context, the A3 customer-binding tuple (via A7T04), the A7 product
 * customer-binding map (A7T04), and the A7 product notification
 * delivery handoff (A7T06; optional).
 */
export interface A7ProductLifecycleRecordV1 {
  readonly contractName: 'A7-PRODUCT-LIFECYCLE';
  readonly contractVersion: 1;
  readonly productLifecycleId: string;
  readonly productLifecycleReference: string;

  readonly productKey: A7ProductLifecycleProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductLifecycleProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;

  readonly currentLifecycleState: A7ProductLifecycleState;
  readonly outcome: A7ProductLifecycleOutcome;
  readonly retryClass: A7ProductLifecycleRetryClass;
  readonly attempt: number;
  readonly maxAttempts: number;

  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a7T06NotificationDeliveryReference: string | null;

  readonly recoveryReference: string | null;
  readonly manualReviewReason: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly providerStatus: string | null;

  readonly idempotencyScope: 'a7.product-lifecycle.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The A7 product lifecycle handoff envelope. The A7 product
 * lifecycle service issues the A7 product lifecycle handoff to
 * A7T08 (product financial effect), A7T09 (independent product
 * reconciliation), and A7T11 (release-gate) for correlation only.
 * The handoff carries only the safe cross-domain references and
 * never raw credentials, signatures, private keys, or unrestricted
 * customer data. The handoff is not a financial command, not an A2
 * authorization, not an A3 binding repair, not an A4 product-policy
 * decision, not a Ledger record, and not a duplicate A6 lifecycle
 * record.
 */
export interface A7ProductLifecycleHandoffV1 {
  readonly contractName: 'A7-PRODUCT-LIFECYCLE';
  readonly contractVersion: 1;
  readonly handoffScope: 'a7-product-lifecycle-handoff.v1';
  readonly productLifecycleId: string;
  readonly productLifecycleReference: string;
  readonly productKey: A7ProductLifecycleProductKey;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductLifecycleProductState;
  readonly currentLifecycleState: A7ProductLifecycleState;
  readonly outcome: A7ProductLifecycleOutcome;
  readonly retryClass: A7ProductLifecycleRetryClass;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a7T06NotificationDeliveryReference: string | null;
  readonly recoveryReference: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string | null;
  readonly causationId: string | null;
}

/**
 * The A7 product lifecycle failure record. The A7 product
 * lifecycle service returns a deterministic A7 product lifecycle
 * failure record for any missing, stale, denied, or unsupported
 * input. The A7 product lifecycle failure record is a
 * non-terminal, support-traceable artifact.
 */
export interface A7ProductLifecycleFailureV1 {
  readonly contractName: 'A7-PRODUCT-LIFECYCLE';
  readonly contractVersion: 1;
  readonly code: string;
  readonly message: string;
  readonly checks: {
    readonly a6Lifecycle: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6StatusVerification: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6CircuitBreaker: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a2AuthorizationContext: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a3Binding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a4ProductPolicyDecision: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T05ProductCommand: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T04ProductCustomerBinding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T06NotificationDelivery: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly recoveryReference: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly retryClass: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly requestHash: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly idempotency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly transitionGuard: 'OK' | 'FAIL' | 'NOT_VERIFIED';
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * The A7 product lifecycle transition result. The A7 product
 * lifecycle service returns a discriminated union of the A7 product
 * lifecycle record (on admission, transition, or replay) or the A7
 * product lifecycle failure record (on transition denial,
 * conflict, retry-exhaustion, recovery-mismatch, or
 * manual-review-required).
 */
export type A7ProductLifecycleResultV1 =
  | {
      readonly valid: true;
      readonly reservation: A7ProductLifecycleReservationV1;
      readonly record: A7ProductLifecycleRecordV1;
      readonly handoff: A7ProductLifecycleHandoffV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductLifecycleFailureV1;
    };

/**
 * The A6 lifecycle view shape (the read-only A6 consumer
 * boundary). The A7 product lifecycle service consumes the A6
 * lifecycle authority through the A6T05
 * `ExternalOperationLifecycleService` consumer boundary. The A7
 * product lifecycle service does NOT issue, refresh, or substitute
 * the A6 lifecycle authority; the A7 product lifecycle service
 * records the A6 lifecycle state as a correlation identifier
 * inside the A7 product lifecycle audit and outbox payloads.
 */
export interface A7ProductLifecycleA6LifecycleView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly lifecycleState: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly providerStatus: string | null;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly replayed: boolean;
  readonly recoveredAt: string | null;
}

/**
 * The A6 status verification view shape (the read-only A6
 * consumer boundary). The A7 product lifecycle service consumes
 * the A6 status verification through the A6T07 status verifier
 * consumer boundary. The A7 product lifecycle service does NOT
 * issue, refresh, or substitute the A6 status verification; the
 * A7 product lifecycle service records the A6 status verification
 * state as a correlation identifier inside the A7 product
 * lifecycle audit and outbox payloads.
 */
export interface A7ProductLifecycleA6StatusVerificationView {
  readonly state:
    | 'VERIFIED_PENDING'
    | 'VERIFIED_REJECTED'
    | 'VERIFIED_ACCEPTED_NOT_SETTLED'
    | 'UNKNOWN'
    | 'UNAVAILABLE';
  readonly providerStatus: string | null;
  readonly providerReferenceHash: string | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
}

/**
 * The A6 circuit-breaker view shape (the read-only A6 consumer
 * boundary). The A7 product lifecycle service consumes the A6
 * circuit-breaker state through the A6 `PartnerCircuitBreakerService`
 * consumer boundary. The A7 product lifecycle service does NOT
 * issue, refresh, or substitute the A6 circuit-breaker; the A7
 * product lifecycle service records the A6 circuit-breaker state
 * as a correlation identifier inside the A7 product lifecycle
 * audit and outbox payloads.
 */
export interface A7ProductLifecycleA6CircuitBreakerView {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  readonly openedAt: string | null;
  readonly cooldownSeconds: number;
  readonly reasonCode: string | null;
}

/**
 * The A2 authorization context view shape (the read-only A2
 * consumer boundary). The A7 product lifecycle service consumes
 * the A2 authorization context through the A2 `AuthorizationService`
 * consumer boundary. The A7 product lifecycle service does NOT
 * issue, refresh, or substitute the A2 authorization context.
 */
export interface A7ProductLifecycleA2AuthorizationContextView {
  readonly principalType: 'CUSTOMER' | 'SUPPORT' | 'OPERATOR' | 'SERVICE' | 'PRIVILEGED';
  readonly principalId: string;
  readonly customerId: string | null;
  readonly customerAccess: 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
  readonly evaluatedAt: string;
  readonly allowed: boolean;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
}

/**
 * The A3 binding view shape (the read-only A3 consumer boundary).
 * The A7 product lifecycle service consumes the A3 binding
 * through the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 * consumer boundary. The A7 product lifecycle service does NOT
 * repair, reassign, activate, or close the A3 binding.
 */
export interface A7ProductLifecycleA3BindingView {
  readonly bindingId: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly bindingVersion: number;
  readonly currency: string;
  readonly accountingUnit: string;
}

/**
 * The A4 product-policy decision view shape (the read-only A4
 * consumer boundary). The A7 product lifecycle service consumes
 * the A4 product-policy decision through the A7T03 A4
 * product-policy service consumer boundary. The A7 product
 * lifecycle service does NOT evaluate, mutate, or refresh the A4
 * product-policy decision.
 */
export interface A7ProductLifecycleA4ProductPolicyDecisionView {
  readonly decisionReference: string;
  readonly productKey: string;
  readonly capability: string;
  readonly action: string;
  readonly profileReference: string;
  readonly policyVersion: string;
  readonly decision: 'ALLOW' | 'ALLOW_WITH_LIMITS' | 'PENDING_REVIEW' | 'DENY' | 'SUSPEND';
  readonly expiresAt: string | null;
  readonly reasonCodes: readonly string[];
  readonly maxAmountMinor: string | null;
}

/**
 * The A7T05 product command/operation reference view shape (the
 * read-only A7T05 consumer boundary). The A7 product lifecycle
 * service consumes the A7T05 product command/operation identity
 * through the A7T05 `A7ProductCommandService` consumer boundary.
 * The A7 product lifecycle service does NOT re-derive the A7T05
 * product command/operation identity.
 */
export interface A7ProductLifecycleA7T05ProductCommandView {
  readonly productCommandReference: string;
  readonly productOperationReference: string;
  readonly productKey: string;
  readonly productVersion: number;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: string;
  readonly operationState: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
}

/**
 * The A7T04 product customer-binding map view shape (the
 * read-only A7T04 consumer boundary). The A7 product lifecycle
 * service consumes the A7T04 product customer-binding map through
 * the A7T04 `A7ProductCustomerBindingService` consumer boundary.
 * The A7 product lifecycle service does NOT re-derive the A7T04
 * product customer-binding map.
 */
export interface A7ProductLifecycleA7T04ProductCustomerBindingMapView {
  readonly mapReference: string;
  readonly productKey: string;
  readonly productVersion: number;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
}

/**
 * The A7T06 product notification delivery handoff view shape
 * (the read-only A7T06 consumer boundary). The A7 product
 * lifecycle service consumes the A7T06 product notification
 * delivery handoff through the A7T06
 * `A7ProductNotificationDeliveryService` consumer boundary. The
 * A7 product lifecycle service does NOT re-derive the A7T06
 * product notification delivery handoff.
 */
export interface A7ProductLifecycleA7T06NotificationDeliveryView {
  readonly notificationDispatchReference: string;
  readonly deliveryState: string;
  readonly notificationChannel: string;
  readonly customerPreferenceReference: string;
}

/**
 * The A7 product lifecycle consumer ports. The A7 product
 * lifecycle service consumes the canonical authorities through
 * this port. The port is read-only with respect to A2, A3, A4,
 * A5, A6 partner, A6T05 external-operation, A6 lifecycle
 * authority, A6 circuit-breaker, A6 status verifier, A7 product
 * catalog, A7 product-policy profile, A7T04 product
 * customer-binding map, A7T05 product command/operation identity,
 * A7T06 product notification delivery, Wallet, Ledger,
 * Reconciliation; the port is read-write only with respect to the
 * shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, `MetricsService`, and `DiagnosticsService`.
 */
export interface A7ProductLifecycleConsumerPorts {
  /**
   * A6 lifecycle authority consumer. The A6 lifecycle authority
   * (A6T05 `ExternalOperationLifecycleService`) is the only A6
   * lifecycle authority. The A7 product lifecycle service
   * consumes the A6 lifecycle authority through the A6T05
   * `ExternalOperationLifecycleService` consumer boundary. The A7
   * product lifecycle service does NOT issue, refresh, or
   * substitute the A6 lifecycle authority.
   */
  readonly a6LifecycleLookup: (
    externalOperationReference: string,
  ) => Promise<A7ProductLifecycleA6LifecycleView | null>;

  /**
   * A6 status verifier consumer. The A6 status verifier (A6T07
   * `ExternalOperationStatusVerifier`) is the only A6 status
   * verifier authority. The A7 product lifecycle service consumes
   * the A6 status verifier through the A6T07
   * `ExternalOperationStatusVerifier` consumer boundary. The A7
   * product lifecycle service does NOT issue, refresh, or
   * substitute the A6 status verifier.
   */
  readonly a6StatusVerification: (
    externalOperationReference: string,
  ) => Promise<A7ProductLifecycleA6StatusVerificationView>;

  /**
   * A6 circuit-breaker consumer. The A6 circuit-breaker
   * (`PartnerCircuitBreakerService`) is the only A6
   * circuit-breaker authority. The A7 product lifecycle service
   * consumes the A6 circuit-breaker through the A6
   * `PartnerCircuitBreakerService` consumer boundary. The A7
   * product lifecycle service does NOT issue, refresh, or
   * substitute the A6 circuit-breaker.
   */
  readonly a6CircuitBreaker: (
    partnerKey: string,
    capabilityKey: string,
  ) => Promise<A7ProductLifecycleA6CircuitBreakerView>;

  /**
   * A2 authorization context consumer.
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductLifecycleA2AuthorizationContextView | null>;

  /**
   * A3 binding recheck consumer.
   */
  readonly a3BindingRecheck: (command: {
    readonly customerId: string;
    readonly customerWalletId: string;
    readonly bindingId: string;
    readonly walletAccountId: string;
    readonly ledgerAccountId: string;
    readonly expectedCurrency: 'NGN';
    readonly expectedAccountingUnit: 'CUSTOMER_FUNDS';
    readonly expectedBindingVersion: number;
  }) => Promise<A7ProductLifecycleA3BindingView | null>;

  /**
   * A4 product-policy decision consumer.
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductLifecycleA4ProductPolicyDecisionView | null>;

  /**
   * A7T05 product command/operation consumer. The A7T05 product
   * command service remains the only A7T05 product command
   * authority. The A7 product lifecycle service consumes the
   * A7T05 product command/operation identity through the A7T05
   * `A7ProductCommandService` consumer boundary.
   */
  readonly a7T05ProductCommandLookup: (
    productCommandReference: string,
  ) => Promise<A7ProductLifecycleA7T05ProductCommandView | null>;

  /**
   * A7T04 product customer-binding map consumer. The A7T04
   * product customer-binding service remains the only A7T04
   * product customer-binding authority. The A7 product lifecycle
   * service consumes the A7T04 product customer-binding map
   * through the A7T04 `A7ProductCustomerBindingService` consumer
   * boundary.
   */
  readonly a7T04ProductCustomerBindingMapReferenceCheck: (
    mapReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ) => Promise<A7ProductLifecycleA7T04ProductCustomerBindingMapView | null>;

  /**
   * A7T06 product notification delivery handoff consumer. The
   * A7T06 product notification delivery service remains the only
   * A7T06 product notification delivery authority. The A7
   * product lifecycle service consumes the A7T06 product
   * notification delivery handoff through the A7T06
   * `A7ProductNotificationDeliveryService` consumer boundary.
   */
  readonly a7T06NotificationDeliveryLookup: (
    notificationDispatchReference: string,
  ) => Promise<A7ProductLifecycleA7T06NotificationDeliveryView | null>;

  /**
   * Operations idempotency consumer. The shared
   * `IdempotencyService` remains the only internal idempotency
   * authority.
   */
  readonly operationsIdempotencyReserve: (
    manager: EntityManager,
    command: {
      readonly scope: string;
      readonly key: string;
      readonly requestHash: string;
      readonly retentionSeconds: number;
    },
  ) => Promise<{ readonly kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS'; readonly record: unknown }>;

  readonly operationsIdempotencyComplete: (
    manager: EntityManager,
    recordId: string,
    command: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
      readonly resourceType: string;
      readonly resourceId: string;
      readonly key?: string;
      readonly requestHash?: string;
    },
  ) => Promise<void>;

  readonly operationsIdempotencyFail: (
    manager: EntityManager,
    recordId: string,
    command: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
      readonly resourceType: string;
      readonly resourceId: string | null;
    },
  ) => Promise<void>;

  /**
   * Operations audit consumer. The shared `AuditService` remains
   * the only audit authority.
   */
  readonly operationsAudit: (
    manager: EntityManager,
    record: {
      readonly entityType: string;
      readonly entityId: string;
      readonly action: string;
      readonly actor: string;
      readonly correlationId: string;
      readonly requestId: string;
      readonly newValues: Readonly<Record<string, unknown>>;
    },
  ) => Promise<void>;

  /**
   * Operations outbox consumer. The shared `OutboxService`
   * remains the only outbox authority.
   */
  readonly operationsOutboxEnqueue: (
    manager: EntityManager,
    command: {
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly eventKey: string;
      readonly schemaVersion: number;
      readonly classification: string;
      readonly retentionClass: string;
      readonly occurredAt: Date;
      readonly correlationId: string;
      readonly causationId: string | null;
      readonly payload: Readonly<Record<string, unknown>>;
    },
  ) => Promise<void>;

  /**
   * Operations metrics consumer. The shared `MetricsService`
   * remains the only metrics authority.
   */
  readonly operationsMetricsIncrement: (
    manager: EntityManager,
    metricName: string,
    amount?: number,
  ) => Promise<void>;

  /**
   * Operations diagnostics consumer. The shared
   * `DiagnosticsService` remains the only diagnostics authority.
   */
  readonly operationsDiagnosticsReport: (
    manager: EntityManager,
    report: {
      readonly component: string;
      readonly status: 'ok' | 'degraded';
      readonly details: Readonly<Record<string, unknown>>;
    },
  ) => Promise<void>;
}

/**
 * The A7 product lifecycle request hash input. The A7 product
 * lifecycle service derives the canonical A7 product lifecycle
 * request hash from this input (serialized as canonical JSON and
 * hashed with SHA-256).
 */
export interface A7ProductLifecycleRequestHashInputV1 {
  readonly contractName: 'A7-PRODUCT-LIFECYCLE';
  readonly contractVersion: 1;
  readonly productKey: A7ProductLifecycleProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductLifecycleProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly currentLifecycleState: A7ProductLifecycleState;
  readonly nextLifecycleState: A7ProductLifecycleState;
  readonly outcome: A7ProductLifecycleOutcome;
  readonly retryClass: A7ProductLifecycleRetryClass;
  readonly attempt: number;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly recoveryReference: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
}
