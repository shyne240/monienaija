/**
 * A7T06 — A7 product notification delivery types.
 *
 * The A7 product notification delivery contract is a read-write
 * contract against the shared Operations `IdempotencyService`,
 * `AuditService`, and `OutboxService` and a read-only consumer of
 * the existing `CustomerPreference.notifications` (the only customer
 * intent authority), the A6T10 data-classification matrix (the only
 * data-classification authority), the A2 authorization context, the
 * A3 customer-to-financial-account binding (via A7T04), the A4
 * product-policy decision (via A7T03), the A6T05 external-operation
 * identity (for provider idempotency scope/key correlation per
 * ADR-0049), the A7 product catalog (A7T02), the A7 product-policy
 * profile (A7T03), the A7 product customer-binding map (A7T04), and
 * the A7 product command/operation identity (A7T05).
 *
 * No new `CustomerPreference`, A2 authorization, A3 binding, A4
 * product-policy, A6T05 external-operation, A6 partner, A5 transfer
 * command, A7 product catalog, A7 product-policy profile, A7 product
 * customer-binding map, A7 product command/operation, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics, Reconciliation,
 * or notification authority is introduced.
 */

import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';

/**
 * The A7 product-catalog product key for the first product. The A7
 * product notification delivery contract binds the A7 notification
 * dispatch identity to the A7 product catalog registration.
 */
export type A7ProductNotificationDeliveryProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A7 product notification delivery state vocabulary (frozen).
 */
export type A7ProductNotificationDeliveryState =
  | 'PENDING'
  | 'DISPATCHED'
  | 'SUPPRESSED'
  | 'FAILED'
  | 'REPLAYED';

/**
 * The A7 product notification delivery notification channel vocabulary.
 */
export type A7ProductNotificationDeliveryChannel = 'email' | 'sms' | 'push' | 'inApp';

/**
 * The A7 product notification delivery product-state vocabulary
 * (reused from the A7T02 product catalog).
 */
export type A7ProductNotificationDeliveryProductState =
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
 * The A7 product notification delivery reservation kind. The A7
 * product notification delivery service returns one of:
 *  - 'NEW': the A7 internal idempotency scope/key is new; the A7
 *    product notification delivery service has reserved the scope/key
 *    and is creating a new A7 notification dispatch event;
 *  - 'REPLAY': the A7 internal idempotency scope/key matches an
 *    existing A7 notification dispatch record with the same canonical
 *    request hash; the A7 product notification delivery service
 *    returns the durable original A7 notification dispatch record
 *    with `replayed: true`;
 *  - 'IN_PROGRESS': the A7 internal idempotency scope/key matches an
 *    existing in-progress A7 product notification delivery
 *    reservation; the A7 product notification delivery service
 *    returns a deterministic conflict;
 *  - 'CONFLICT': the A7 internal idempotency scope/key matches an
 *    existing A7 notification dispatch record with a different
 *    canonical request hash; the A7 product notification delivery
 *    service returns a deterministic conflict.
 */
export type A7ProductNotificationDeliveryReservationKind =
  | 'NEW'
  | 'REPLAY'
  | 'IN_PROGRESS'
  | 'CONFLICT';

/**
 * The A7 product notification delivery envelope (the durable A7
 * notification dispatch input). The envelope is versioned,
 * schema-validated, and idempotency-keyed. The A7 product notification
 * delivery service does not trust a caller-supplied request hash;
 * the A7 product notification delivery service derives the canonical
 * A7 notification dispatch request hash from the envelope semantic
 * material.
 */
export interface A7ProductNotificationDispatchV1 {
  readonly contractName: 'A7-NOTIFICATION-DELIVERY';
  readonly contractVersion: 1;

  readonly productKey: A7ProductNotificationDeliveryProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductNotificationDeliveryProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;

  readonly customerPreferenceId: string;
  readonly notificationChannel: A7ProductNotificationDeliveryChannel;
  readonly notificationTemplateReference: string;

  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;

  readonly notificationPayload: Readonly<Record<string, unknown>>;
  readonly notificationPayloadHash: string;

  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The A7 product notification delivery reservation result. The A7
 * product notification delivery service returns the reservation result
 * alongside the A7 notification dispatch record (if any) and the
 * reservation metadata.
 */
export interface A7ProductNotificationDeliveryReservationV1 {
  readonly kind: A7ProductNotificationDeliveryReservationKind;
  readonly record: A7ProductNotificationDispatchRecordV1 | null;
  readonly conflictReason: string | null;
}

/**
 * The A7 product notification delivery dispatch record. The A7
 * product notification delivery service produces the A7 notification
 * dispatch record from the A7 notification dispatch envelope, the
 * A7T04 product customer-binding map, the A4 product-policy decision,
 * the A2 authorization context, the A7T05 product command/operation
 * identity, the A6T05 external-operation identity (for partner-
 * correlation metadata), the A6T10 data-classification matrix, and
 * the `CustomerPreference.notifications` (the existing
 * `customer-preference` module).
 */
export interface A7ProductNotificationDispatchRecordV1 {
  readonly contractName: 'A7-NOTIFICATION-DELIVERY';
  readonly contractVersion: 1;
  readonly notificationEventId: string;
  readonly notificationEventReference: string;
  readonly notificationDispatchId: string;
  readonly notificationDispatchReference: string;
  readonly productKey: A7ProductNotificationDeliveryProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductNotificationDeliveryProductState;
  readonly deliveryState: A7ProductNotificationDeliveryState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;

  readonly customerPreferenceId: string;
  readonly notificationChannel: A7ProductNotificationDeliveryChannel;
  readonly notificationTemplateReference: string;
  readonly notificationPayload: Readonly<Record<string, unknown>>;
  readonly notificationPayloadHash: string;

  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly idempotencyScope: 'a7.notification-dispatch.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly createdAt: string;
  readonly dispatchedAt: string | null;
  readonly suppressedAt: string | null;
  readonly failedAt: string | null;
  readonly version: number;
}

/**
 * The A7 product notification delivery handoff envelope. The A7
 * product notification delivery service issues the A7 notification
 * delivery handoff to A7T07 (product lifecycle), A7T09 (product
 * reconciliation), and A7T11 (release-gate) after the A7 notification
 * dispatch is admitted. The handoff carries only the safe cross-
 * domain references and never raw credentials, signatures, private
 * keys, or unrestricted customer data.
 */
export interface A7ProductNotificationDeliveryHandoffV1 {
  readonly contractName: 'A7-NOTIFICATION-DELIVERY';
  readonly contractVersion: 1;
  readonly handoffScope: 'a7-notification-dispatch-handoff.v1';
  readonly notificationEventId: string;
  readonly notificationEventReference: string;
  readonly notificationDispatchId: string;
  readonly notificationDispatchReference: string;
  readonly productKey: A7ProductNotificationDeliveryProductKey;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductNotificationDeliveryProductState;
  readonly deliveryState: A7ProductNotificationDeliveryState;
  readonly customerPreferenceReference: string;
  readonly a7ProductCustomerBindingMapReference: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly notificationChannel: A7ProductNotificationDeliveryChannel;
  readonly notificationTemplateReference: string;
  readonly notificationPayloadHash: string;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string | null;
  readonly causationId: string | null;
}

/**
 * The A7 product notification delivery failure record. The A7 product
 * notification delivery service returns a deterministic A7 notification
 * dispatch failure record for any missing, stale, denied, or
 * unsupported input. The A7 product notification delivery failure
 * record is a non-terminal, support-traceable artifact.
 */
export interface A7ProductNotificationDeliveryFailureV1 {
  readonly contractName: 'A7-NOTIFICATION-DELIVERY';
  readonly contractVersion: 1;
  readonly code: string;
  readonly message: string;
  readonly checks: {
    readonly a2AuthorizationContext: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a3Binding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a4ProductPolicyDecision: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T04ProductCustomerBinding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T05ProductCommand: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6T10DataClassification: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly customerPreference: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly requestHash: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly idempotency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly channel: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly payloadHash: 'OK' | 'FAIL' | 'NOT_VERIFIED';
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * The A7 product notification delivery result. The A7 product
 * notification delivery service returns a discriminated union of the
 * A7 notification dispatch record (on admission or replay) or the A7
 * product notification delivery failure record (on suppression,
 * denial, conflict, or manual review).
 */
export type A7ProductNotificationDeliveryResultV1 =
  | {
      readonly valid: true;
      readonly reservation: A7ProductNotificationDeliveryReservationV1;
      readonly dispatch: A7ProductNotificationDispatchRecordV1;
      readonly handoff: A7ProductNotificationDeliveryHandoffV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductNotificationDeliveryFailureV1;
    };

/**
 * The A2 authorization context view shape (the read-only A2 consumer
 * boundary). The A7 product notification delivery service consumes
 * the A2 authorization context through the A2 `AuthorizationService`
 * consumer boundary. The A7 product notification delivery service
 * does NOT issue, refresh, or substitute the A2 authorization
 * context.
 */
export interface A7ProductNotificationDeliveryA2AuthorizationContextView {
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
 * The A4 product-policy decision view shape (the read-only A4
 * consumer boundary). The A7 product notification delivery service
 * consumes the A4 product-policy decision through the A4
 * product-policy service (A7T03) consumer boundary. The A7 product
 * notification delivery service does NOT evaluate, mutate, or refresh
 * the A4 product-policy decision.
 */
export interface A7ProductNotificationDeliveryA4ProductPolicyDecisionView {
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
 * The A3 binding view shape (the read-only A3 consumer boundary).
 * The A7 product notification delivery service consumes the A3 binding
 * through the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 * consumer boundary. The A7 product notification delivery service
 * does NOT repair, reassign, activate, or close the A3 binding.
 */
export interface A7ProductNotificationDeliveryA3BindingView {
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
 * The A7T04 product customer-binding map view shape (the read-only
 * A7T04 consumer boundary). The A7 product notification delivery
 * service consumes the A7T04 product customer-binding map through
 * the A7T04 `A7ProductCustomerBindingService` consumer boundary. The
 * A7 product notification delivery service does NOT re-derive the
 * A7T04 product customer-binding map inside the A7 product
 * notification delivery.
 */
export interface A7ProductNotificationDeliveryA7T04ProductCustomerBindingMapView {
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
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The A7T05 product command/operation reference view shape (the
 * read-only A7T05 consumer boundary). The A7 product notification
 * delivery service consumes the A7T05 product command/operation
 * identity through the A7T05 `A7ProductCommandService` consumer
 * boundary. The A7 product notification delivery service does NOT
 * re-derive the A7T05 product command/operation identity.
 */
export interface A7ProductNotificationDeliveryA7T05ProductCommandView {
  readonly productCommandReference: string;
  readonly productOperationReference: string;
  readonly productKey: string;
  readonly productVersion: number;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: string;
  readonly operationState: string;
}

/**
 * The A6T10 data-classification entry (the read-only A6T10 consumer
 * boundary). The A7 product notification delivery service classifies
 * every notification payload field through the A6T10
 * `ExternalDataClassificationRegistry` consumer boundary. The A7
 * product notification delivery service does NOT bypass the A6T10
 * data-classification matrix.
 */
export interface A7ProductNotificationDeliveryA6T10DataClassificationEntry {
  readonly fieldName: string;
  readonly level: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED';
  readonly sourceDomain: string;
  readonly owner: string;
  readonly secretCategory: string | null;
}

/**
 * The A6T05 external-operation view shape (the read-only A6T05
 * consumer boundary). The A7 product notification delivery service
 * consumes the A6T05 external-operation identity through the A6T05
 * `ExternalOperationService` consumer boundary. The A7 product
 * notification delivery service does NOT issue, refresh, or
 * substitute the A6T05 external-operation identity; the A7 product
 * notification delivery service references the A6T05 provider
 * idempotency scope/key inside the A7 notification dispatch outbox
 * payload as correlation metadata per ADR-0049.
 */
export interface A7ProductNotificationDeliveryA6ExternalOperationView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly customerId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly lifecycleState: string;
  readonly replayed: boolean;
}

/**
 * The CustomerPreference view shape (the read-only consumer boundary
 * for the existing `customer-preference` module). The A7 product
 * notification delivery service consumes the
 * `CustomerPreference.notifications` through the existing
 * `CustomerPreferenceService.getPreferences()` consumer boundary. The
 * A7 product notification delivery service does NOT write any new
 * `CustomerPreference` record and does NOT mutate the
 * `CustomerPreference.notifications` channel flags.
 */
export interface A7ProductNotificationDeliveryCustomerPreferenceView {
  readonly id: string;
  readonly customerId: string;
  readonly version: number;
  readonly notifications: {
    readonly email: boolean;
    readonly sms: boolean;
    readonly push: boolean;
    readonly inApp: boolean;
  };
  readonly deleted: boolean;
}

/**
 * The A7 product notification delivery consumer ports. The A7
 * product notification delivery service consumes the canonical
 * authorities through this port. The port is read-only with respect
 * to A2, A3, A4, A5, A6 partner, A6T05 external-operation, A6T10
 * data-classification matrix, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding map, A7T05 product
 * command/operation identity, `CustomerPreference`, Wallet, Ledger,
 * Reconciliation; the port is read-write only with respect to the
 * shared Operations `IdempotencyService`, `AuditService`, and
 * `OutboxService`.
 */
export interface A7ProductNotificationDeliveryConsumerPorts {
  /**
   * A2 authorization context consumer. The A2 authorization service
   * remains the only A2 authorization authority. The A7 product
   * notification delivery service consumes the A2 authorization
   * context through the A2 `AuthorizationService` consumer
   * boundary. The A7 product notification delivery service does
   * not write any A2 authorization context.
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductNotificationDeliveryA2AuthorizationContextView | null>;

  /**
   * A3 binding recheck consumer. The A3 binding service remains the
   * only A3 binding authority. The A7 product notification delivery
   * service consumes the A3 binding tuple through the A3
   * `CustomerFinancialAccountBindingService.validateActiveBinding()`
   * consumer boundary. The A7 product notification delivery service
   * does not write any A3 binding record.
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
  }) => Promise<A7ProductNotificationDeliveryA3BindingView | null>;

  /**
   * A4 product-policy decision consumer. The A4 product-policy
   * service (A7T03) remains the only A4 product-policy authority.
   * The A7 product notification delivery service consumes the A4
   * product-policy decision through the A7T03 A4 product-policy
   * service consumer boundary. The A7 product notification delivery
   * service does not write any A4 product-policy decision.
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductNotificationDeliveryA4ProductPolicyDecisionView | null>;

  /**
   * A7T04 product customer-binding map consumer. The A7T04 product
   * customer-binding service remains the only A7T04 product
   * customer-binding authority. The A7 product notification delivery
   * service consumes the A7T04 product customer-binding map through
   * the A7T04 `A7ProductCustomerBindingService` consumer boundary.
   * The A7 product notification delivery service does not write any
   * A7T04 product customer-binding map.
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
  ) => Promise<A7ProductNotificationDeliveryA7T04ProductCustomerBindingMapView | null>;

  /**
   * A7T05 product command/operation consumer. The A7T05 product
   * command service remains the only A7T05 product command
   * authority. The A7 product notification delivery service
   * consumes the A7T05 product command/operation identity through
   * the A7T05 `A7ProductCommandService` consumer boundary. The A7
   * product notification delivery service does not write any A7T05
   * product command/operation record.
   */
  readonly a7T05ProductCommandLookup: (
    productCommandReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ) => Promise<A7ProductNotificationDeliveryA7T05ProductCommandView | null>;

  /**
   * A6T10 data-classification consumer. The A6T10 data-classification
   * matrix (the existing `ExternalDataClassificationRegistry`)
   * remains the only A6T10 data-classification authority. The A7
   * product notification delivery service classifies every
   * notification payload field through the A6T10 data-classification
   * matrix consumer boundary. The A7 product notification delivery
   * service does not write any A6T10 data-classification entry.
   */
  readonly a6T10DataClassification: {
    readonly isRegistered: (fieldName: string) => boolean;
    readonly isSecret: (fieldName: string) => boolean;
    readonly levelFor: (
      fieldName: string,
    ) => 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED' | null;
    readonly secretCategoryFor: (fieldName: string) => string | null;
    readonly tryGet: (
      fieldName: string,
    ) => A7ProductNotificationDeliveryA6T10DataClassificationEntry | null;
    readonly audienceMaxLevelFor: (
      audience: string,
    ) => 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED';
  };

  /**
   * A6T05 external-operation consumer. The A6T05 external-operation
   * service remains the only A6T05 external-operation authority.
   * The A7 product notification delivery service consumes the A6T05
   * external-operation record through the A6T05
   * `ExternalOperationService` consumer boundary. The A7 product
   * notification delivery service does not write any A6T05
   * external-operation record.
   */
  readonly a6ExternalOperationLookup: (
    externalOperationReference: string,
  ) => Promise<A7ProductNotificationDeliveryA6ExternalOperationView | null>;

  /**
   * CustomerPreference.notifications consumer. The existing
   * `CustomerPreferenceService` remains the only customer intent
   * authority. The A7 product notification delivery service
   * consumes the `CustomerPreference.notifications` through the
   * existing `CustomerPreferenceService.getPreferences()` consumer
   * boundary. The A7 product notification delivery service does
   * NOT write any new `CustomerPreference` record and does NOT
   * mutate the `CustomerPreference.notifications` channel flags.
   */
  readonly customerPreferenceLookup: (
    customerId: string,
    expectedPreferenceId: string,
  ) => Promise<A7ProductNotificationDeliveryCustomerPreferenceView | null>;

  /**
   * Operations idempotency consumer. The shared
   * `IdempotencyService` remains the only internal idempotency
   * authority. The A7 product notification delivery service
   * reserves, completes, and fails the A7 internal idempotency
   * record through the shared `IdempotencyService` consumer
   * boundary. The A7 product notification delivery service does
   * not introduce a parallel module-local idempotency authority.
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
   * the only audit authority. The A7 product notification delivery
   * service records the A7 notification dispatch audit fact
   * through the shared `AuditService` consumer boundary. The A7
   * product notification delivery service does not introduce a
   * parallel module-local audit authority.
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
   * Operations outbox consumer. The shared `OutboxService` remains
   * the only outbox authority. The A7 product notification delivery
   * service publishes the A7 notification dispatch outbox fact
   * through the shared `OutboxService` consumer boundary. The A7
   * product notification delivery service does not introduce a
   * parallel module-local outbox authority.
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
}

/**
 * The A7 product notification delivery hash input. The A7 product
 * notification delivery service derives the canonical A7 notification
 * dispatch request hash from this input (serialized as canonical JSON
 * and hashed with SHA-256). The hash input includes every semantic
 * field that changes the A7 notification dispatch effect and excludes
 * transport-only, observation, and secret values.
 */
export interface A7ProductNotificationDeliveryRequestHashInputV1 {
  readonly contractName: 'A7-NOTIFICATION-DELIVERY';
  readonly contractVersion: 1;
  readonly productKey: A7ProductNotificationDeliveryProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductNotificationDeliveryProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly customerPreferenceId: string;
  readonly notificationChannel: A7ProductNotificationDeliveryChannel;
  readonly notificationTemplateReference: string;
  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly notificationPayloadHash: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}
