/**
 * A7T05 — A7 product command identity, lifecycle, and idempotency types.
 *
 * The A7 product command and idempotency contract is a read-write
 * contract against the shared Operations `IdempotencyService`,
 * `AuditService`, and `OutboxService` and a read-only consumer of the
 * A2 authorization context, the A3 customer-to-financial-account
 * binding, the A4 product-policy decision, the A6T05 external-operation
 * identity and provider idempotency (per ADR-0049), the A6 partner-
 * adapter boundary, the A7 product catalog (A7T02), the A7 product-
 * policy profile (A7T03), and the A7 product customer-binding map
 * (A7T04).
 *
 * No new A3 binding, A4 product-policy, A2 authorization, A6T05
 * external-operation, A6 partner, A5 transfer command, A7 product
 * catalog, A7 product-policy profile, A7 product customer-binding map,
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced.
 */

import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';

/**
 * The A7 product-catalog product key for the first product. The A7
 * product command and idempotency contract binds the A7 product
 * command identity to the A7 product catalog registration.
 */
export type A7ProductCommandProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A7 product command operation state vocabulary (reused from
 * `a7-product-command.constants.ts`).
 */
export type A7ProductCommandOperationState =
  | 'COMMAND_RESERVED'
  | 'COMMAND_ADMITTED'
  | 'COMMAND_COMPLETED'
  | 'COMMAND_FAILED'
  | 'COMMAND_REPLAYED'
  | 'COMMAND_CONFLICTED';

/**
 * The A7 product command product-state vocabulary (reused from the
 * A7T02 product catalog).
 */
export type A7ProductCommandProductState =
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
 * The A7 product command reservation kind. The A7 product command
 * service returns one of:
 *  - 'NEW': the A7 internal idempotency scope/key is new; the A7 product
 *    command service has reserved the scope/key and is creating a new A7
 *    product operation record;
 *  - 'REPLAY': the A7 internal idempotency scope/key matches an existing
 *    A7 product operation record with the same canonical request hash;
 *    the A7 product command service returns the durable original A7
 *    product operation record with `replayed: true`;
 *  - 'IN_PROGRESS': the A7 internal idempotency scope/key matches an
 *    existing in-progress A7 product command reservation; the A7
 *    product command service returns a deterministic conflict;
 *  - 'CONFLICT': the A7 internal idempotency scope/key matches an
 *    existing A7 product operation record with a different canonical
 *    request hash; the A7 product command service returns a
 *    deterministic conflict.
 */
export type A7ProductCommandReservationKind = 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';

/**
 * The A7 product command envelope (the durable A7 product command
 * input). The envelope is versioned, schema-validated, and idempotency-
 * keyed. The A7 product command service does not trust a caller-
 * supplied request hash; the A7 product command service derives the
 * canonical A7 product request hash from the envelope semantic material.
 */
export interface A7ProductCommandCreateV1 {
  readonly contractName: 'A7-PRODUCT-COMMAND';
  readonly contractVersion: 1;

  readonly productKey: A7ProductCommandProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCommandProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;

  readonly amountMinor: string | number | bigint;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';

  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a6ExternalOperationId: string;
  readonly a6ExternalOperationReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The A7 product command reservation result. The A7 product command
 * service returns the reservation result alongside the A7 product
 * command operation record (if any) and the reservation metadata.
 */
export interface A7ProductCommandReservationV1 {
  readonly kind: A7ProductCommandReservationKind;
  readonly record: A7ProductCommandOperationV1 | null;
  readonly conflictReason: string | null;
}

/**
 * The A7 product command completion result. The A7 product command
 * service completes the A7 product operation record through the shared
 * Operations `IdempotencyService.complete()`.
 */
export interface A7ProductCommandCompleteV1 {
  readonly operationState: 'COMMAND_COMPLETED';
  readonly resourceId: string;
  readonly responseBody: Readonly<Record<string, unknown>>;
}

/**
 * The A7 product command failure result. The A7 product command service
 * fails the A7 product operation record through the shared Operations
 * `IdempotencyService.fail()`.
 */
export interface A7ProductCommandFailV1 {
  readonly operationState: 'COMMAND_FAILED';
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly failureStatusCode: number;
  readonly resourceId: string | null;
}

/**
 * The A7 product command operation record. The A7 product command
 * service produces the A7 product command operation record from the
 * A7 product command envelope, the A7T04 product customer-binding map,
 * the A4 product-policy decision, the A2 authorization context, and
 * the A6T05 external-operation record.
 */
export interface A7ProductCommandOperationV1 {
  readonly contractName: 'A7-PRODUCT-COMMAND';
  readonly contractVersion: 1;
  readonly productCommandId: string;
  readonly productCommandReference: string;
  readonly productOperationId: string;
  readonly productOperationReference: string;
  readonly productKey: A7ProductCommandProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCommandProductState;
  readonly operationState: A7ProductCommandOperationState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';

  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a6ExternalOperationId: string;
  readonly a6ExternalOperationReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly idempotencyScope: 'A7-PRODUCT-IDEMPOTENCY.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly version: number;
}

/**
 * The A7 product command handoff envelope. The A7 product command
 * service issues the A7 product command handoff to A7T07 (product
 * lifecycle) and A7T08 (product financial effect) after the A7 product
 * command is admitted. The handoff carries only the safe cross-domain
 * references and never raw credentials, signatures, private keys, or
 * unrestricted customer data.
 */
export interface A7ProductCommandHandoffV1 {
  readonly contractName: 'A7-PRODUCT-COMMAND';
  readonly contractVersion: 1;
  readonly handoffScope: 'a7-product-command-handoff.v1';
  readonly productCommandId: string;
  readonly productCommandReference: string;
  readonly productOperationId: string;
  readonly productOperationReference: string;
  readonly productKey: A7ProductCommandProductKey;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCommandProductState;
  readonly operationState: A7ProductCommandOperationState;
  readonly mapReference: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly a6ExternalOperationId: string;
  readonly a6ExternalOperationReference: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a7ProductCustomerBindingMapReference: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string | null;
  readonly causationId: string | null;
}

/**
 * The A7 product command failure record. The A7 product command
 * service returns a deterministic A7 product command failure record
 * for any missing, stale, denied, or unsupported input. The A7 product
 * command failure record is a non-terminal, support-traceable artifact.
 */
export interface A7ProductCommandFailureV1 {
  readonly contractName: 'A7-PRODUCT-COMMAND';
  readonly contractVersion: 1;
  readonly code: string;
  readonly message: string;
  readonly checks: {
    readonly a2AuthorizationContext: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a3Binding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a4ProductPolicyDecision: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T04ProductCustomerBinding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6ExternalOperation: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly requestHash: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly idempotency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly currency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly amount: 'OK' | 'FAIL' | 'NOT_VERIFIED';
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * The A7 product command result. The A7 product command service
 * returns a discriminated union of the A7 product command operation
 * record (on admission or replay) or the A7 product command failure
 * record (on denial, pending, manual review, or conflict).
 */
export type A7ProductCommandResultV1 =
  | {
      readonly valid: true;
      readonly reservation: A7ProductCommandReservationV1;
      readonly operation: A7ProductCommandOperationV1;
      readonly handoff: A7ProductCommandHandoffV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductCommandFailureV1;
    };

/**
 * The A6T05 external-operation view shape (the read-only A6T05
 * consumer boundary). The A7 product command service consumes the
 * A6T05 external-operation record through the A6T05
 * `ExternalOperationService` consumer boundary. The A7 product command
 * service does NOT introduce a parallel external-operation identity.
 */
export interface A7ProductCommandA6ExternalOperationView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly internalCommandId: string;
  readonly customerId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly internalIdempotencyScope: string;
  readonly internalIdempotencyKey: string;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly causationId: string | null;
  readonly lifecycleState: string;
  readonly replayed: boolean;
}

/**
 * The A2 authorization context view shape (the read-only A2 consumer
 * boundary). The A7 product command service consumes the A2
 * authorization context through the A2 `AuthorizationService` consumer
 * boundary. The A7 product command service does NOT issue, refresh, or
 * substitute the A2 authorization context.
 */
export interface A7ProductCommandA2AuthorizationContextView {
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
 * consumer boundary). The A7 product command service consumes the A4
 * product-policy decision through the A4 product-policy service
 * consumer boundary. The A7 product command service does NOT evaluate,
 * mutate, or refresh the A4 product-policy decision.
 */
export interface A7ProductCommandA4ProductPolicyDecisionView {
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
 * The A3 binding view shape (the read-only A3 consumer boundary). The
 * A7 product command service consumes the A3 binding through the A3
 * `CustomerFinancialAccountBindingService` consumer boundary. The A7
 * product command service does NOT repair, reassign, activate, or
 * close the A3 binding.
 */
export interface A7ProductCommandA3BindingView {
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
 * A7T04 consumer boundary). The A7 product command service consumes
 * the A7T04 product customer-binding map through the A7T04
 * `A7ProductCustomerBindingService` consumer boundary. The A7 product
 * command service does NOT re-derive the A7T04 product customer-
 * binding map inside the A7 product command.
 */
export interface A7ProductCommandA7T04ProductCustomerBindingMapView {
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
  readonly a6PartnerIdentity: Readonly<Record<string, unknown>>;
  readonly a6PartnerCorrelation: Readonly<Record<string, unknown>>;
  readonly a6PartnerReference: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * The A7 product command consumer ports. The A7 product command
 * service consumes the canonical authorities through this port. The
 * port is read-only with respect to A2, A3, A4, A5, A6 partner, A6T05
 * external-operation, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding map, Wallet, Ledger, Reconciliation,
 * and `CustomerPreference`; the port is read-write only with respect
 * to the shared Operations `IdempotencyService`, `AuditService`, and
 * `OutboxService`.
 */
export interface A7ProductCommandConsumerPorts {
  /**
   * A2 authorization context consumer. The A2 authorization service
   * remains the only A2 authorization authority. The A7 product
   * command service consumes the A2 authorization context through
   * the A2 `AuthorizationService` consumer boundary. The A7 product
   * command service does not write any A2 authorization context.
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductCommandA2AuthorizationContextView | null>;

  /**
   * A3 binding recheck consumer. The A3 binding service remains the
   * only A3 binding authority. The A7 product command service
   * consumes the A3 binding tuple through the A3
   * `CustomerFinancialAccountBindingService.validateActiveBinding()`
   * consumer boundary. The A7 product command service does not write
   * any A3 binding record.
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
  }) => Promise<A7ProductCommandA3BindingView | null>;

  /**
   * A4 product-policy decision consumer. The A4 product-policy
   * service (A7T03) remains the only A4 product-policy authority.
   * The A7 product command service consumes the A4 product-policy
   * decision through the A7T03 A4 product-policy service consumer
   * boundary. The A7 product command service does not write any A4
   * product-policy decision.
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductCommandA4ProductPolicyDecisionView | null>;

  /**
   * A6T05 external-operation consumer. The A6T05 external-operation
   * service remains the only A6T05 external-operation authority. The
   * A7 product command service consumes the A6T05 external-operation
   * record through the A6T05 `ExternalOperationService` consumer
   * boundary. The A7 product command service does not write any A6T05
   * external-operation record.
   */
  readonly a6ExternalOperationLookup: (
    externalOperationId: string,
  ) => Promise<A7ProductCommandA6ExternalOperationView | null>;

  /**
   * A7T04 product customer-binding map consumer. The A7T04 product
   * customer-binding service remains the only A7T04 product customer-
   * binding authority. The A7 product command service consumes the
   * A7T04 product customer-binding map through the A7T04
   * `A7ProductCustomerBindingService` consumer boundary. The A7
   * product command service does not write any A7T04 product
   * customer-binding map.
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
  ) => Promise<A7ProductCommandA7T04ProductCustomerBindingMapView | null>;

  /**
   * Operations idempotency consumer. The shared
   * `IdempotencyService` remains the only internal idempotency
   * authority. The A7 product command service reserves, completes,
   * and fails the A7 internal idempotency record through the shared
   * `IdempotencyService` consumer boundary. The A7 product command
   * service does not introduce a parallel module-local idempotency
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
   * Operations audit consumer. The shared `AuditService` remains the
   * only audit authority. The A7 product command service records the
   * A7 product command audit fact through the shared `AuditService`
   * consumer boundary. The A7 product command service does not
   * introduce a parallel module-local audit authority.
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
   * the only outbox authority. The A7 product command service
   * publishes the A7 product command outbox fact through the shared
   * `OutboxService` consumer boundary. The A7 product command service
   * does not introduce a parallel module-local outbox authority.
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
 * The A7 product command hash input. The A7 product command service
 * derives the canonical A7 product request hash from this input
 * (serialized as canonical JSON and hashed with SHA-256). The hash
 * input includes every semantic field that changes the A7 product
 * effect and excludes transport-only, observation, and secret values.
 */
export interface A7ProductCommandRequestHashInputV1 {
  readonly contractName: 'A7-PRODUCT-COMMAND';
  readonly contractVersion: 1;
  readonly productKey: A7ProductCommandProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCommandProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly a7ProductCustomerBindingMapReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly a6ExternalOperationId: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}
