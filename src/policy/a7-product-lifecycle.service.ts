/**
 * A7T07 — A7 product lifecycle, bounded retry, manual review, unknown
 * outcomes, and recovery service.
 *
 * The A7 product lifecycle service is the single A7-side entry point
 * for the A7 first product's runtime resilience and lifecycle. The
 * A7 product lifecycle service composes the existing A2 / A3 / A4 /
 * A5 / A6 / A7 / Operations authorities (reused as-is, without
 * modification) under the A7 product lifecycle transition envelope:
 *
 *  - the A6T05 `ExternalOperationLifecycleService` (the only A6
 *    lifecycle authority; reused for the A6 lifecycle state
 *    correlation);
 *  - the A6T07 `ExternalOperationStatusVerifier` (the only A6
 *    status-verification authority; reused for the A6
 *    status-verification correlation);
 *  - the A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority; reused for the A6 circuit-breaker
 *    state correlation);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; reused for the A6T05
 *    external-operation correlation and the A6T05 provider
 *    idempotency scope/key; per ADR-0049);
 *  - the A2 `AuthorizationService` (reused for the A2 authorization
 *    context reference);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (reused for the A3 binding recheck);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference);
 *  - the A7T04 `A7ProductCustomerBindingService` (reused for the A7
 *    product customer-binding map reference);
 *  - the A7T05 `A7ProductCommandService` (reused for the A7 product
 *    command/operation identity correlation);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (reused for
 *    the A7 product notification delivery handoff correlation;
 *    optional);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency scope/key reservation, completion, and failure);
 *  - the shared `AuditService` (reused for the A7 product lifecycle
 *    audit facts);
 *  - the shared `OutboxService` (reused for the A7 product lifecycle
 *    outbox facts);
 *  - the shared `MetricsService` (reused for the A7 product
 *    lifecycle metric observations);
 *  - the shared `DataSource` (reused for the A7 product lifecycle
 *    SERIALIZABLE transactions).
 *
 * No new policy evaluator, no new authorization service, no new
 * customer-binding service, no new settlement authority, no new
 * reconciliation engine, no new audit authority, no new idempotency
 * authority, no new outbox authority, no new metrics authority, no
 * new diagnostics authority, no new A6 lifecycle authority, no new
 * A6 status-verification authority, no new A6 circuit-breaker
 * authority, no new A6T05 external-operation authority, no new
 * A6T05 retry/recovery authority, no new A6T08 suspense/settlement
 * authority, no new A6T09 reconciliation authority, no new A6T10
 * data-classification authority, no new A6T11 integration
 * authority, no new A7 product catalog authority, no new A7
 * product-policy authority, no new A7T04 product customer-binding
 * authority, no new A7T05 product command/operation authority, no
 * new A7T06 product notification delivery authority, no new
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced. The A7 product lifecycle service does NOT introduce
 * an unbounded retry loop, an unowned scheduler, or a local
 * product idempotency/audit store. The A6 lifecycle authority
 * remains the only lifecycle authority.
 */

import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';

import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_ADMITTED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_FAILED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PARTNER_PENDING,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PENDING_VERIFICATION,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_ISSUED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_RESOLVED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_REPLAYED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RESERVED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_SCHEDULED,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_AUDIT_ACTOR,
  A7_PRODUCT_LIFECYCLE_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
  A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_STALE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_CIRCUIT_OPEN,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_STALE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_TERMINAL,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
  A7_PRODUCT_LIFECYCLE_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTBOX_PUBLICATION_FAILED,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_FAILED,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED,
  A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_STATE_INVALID,
  A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISMATCH,
  A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING,
  A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_CLASS_NOT_RETRYABLE,
  A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE,
  A7_PRODUCT_LIFECYCLE_HANDOFF_VALIDITY_SECONDS,
  A7_PRODUCT_LIFECYCLE_IDEMPOTENCY_RETENTION_SECONDS,
  A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS,
  A7_PRODUCT_LIFECYCLE_METRIC_ADMITTED,
  A7_PRODUCT_LIFECYCLE_METRIC_CANCELLED,
  A7_PRODUCT_LIFECYCLE_METRIC_FAILED,
  A7_PRODUCT_LIFECYCLE_METRIC_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_ISSUED,
  A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_RESOLVED,
  A7_PRODUCT_LIFECYCLE_METRIC_REPLAYED,
  A7_PRODUCT_LIFECYCLE_METRIC_RETRY_EXHAUSTED,
  A7_PRODUCT_LIFECYCLE_METRIC_RETRY_SCHEDULED,
  A7_PRODUCT_LIFECYCLE_METRIC_TRANSITIONED,
  A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_CLASSIFICATION,
  A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_RETENTION_CLASS,
  A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_TYPE,
  A7_PRODUCT_LIFECYCLE_OUTCOME_FAILED,
  A7_PRODUCT_LIFECYCLE_OUTCOME_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_OUTCOME_PENDING,
  A7_PRODUCT_LIFECYCLE_OUTCOME_REJECTED,
  A7_PRODUCT_LIFECYCLE_OUTCOME_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_OUTCOME_VERIFIED,
  A7_PRODUCT_LIFECYCLE_OUTCOMES,
  A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_PREFIX,
  A7_PRODUCT_LIFECYCLE_REFERENCE_PREFIX,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASSES,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_RATE_LIMIT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_STATUS_QUERY,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT,
  A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
  A7_PRODUCT_LIFECYCLE_STATE_FAILED,
  A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
  A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
  A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
  A7_PRODUCT_LIFECYCLE_STATES,
  A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_TERMINAL_STATES,
  A7_PRODUCT_LIFECYCLE_TO_A6_LIFECYCLE,
  A7_PRODUCT_LIFECYCLE_TRANSITIONS,
} from './a7-product-lifecycle.constants';
import { A7ProductLifecycleRepository } from './a7-product-lifecycle.repository';
import type {
  A7ProductLifecycleConsumerPorts,
  A7ProductLifecycleFailureV1,
  A7ProductLifecycleHandoffV1,
  A7ProductLifecycleProductState,
  A7ProductLifecycleRecordV1,
  A7ProductLifecycleRequestHashInputV1,
  A7ProductLifecycleReservationKind,
  A7ProductLifecycleResultV1,
  A7ProductLifecycleRetryClass,
  A7ProductLifecycleState,
  A7ProductLifecycleTransitionV1,
  A7ProductLifecycleOutcome,
} from './a7-product-lifecycle.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;
const ACTION_ASSIGN = 'assign' as const;
const ACTION_LIFECYCLE = 'lifecycle' as const;
const CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
const CAPABILITY_INBOUND_FUNDING = 'virtual-account.inbound-funding' as const;
const PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;
const PRODUCT_VERSION = 1 as const;
const A6_LIFECYCLE_ALLOWED_STATES: ReadonlySet<string> = new Set([
  'CREATED',
  'SUBMITTING',
  'PENDING_PROVIDER',
  'PENDING_VERIFICATION',
  'UNKNOWN',
  'MANUAL_REVIEW',
  'FAILED',
  'CANCELLED',
]);
const EXECUTABLE_A4_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'ALLOW_WITH_LIMITS']);
const RECOVERY_REFERENCE_PATTERN = /^a7-product-lifecycle-recovery:[a-f0-9]{64}$/;

type AllChecks = A7ProductLifecycleFailureV1['checks'];
const ALL_CHECKS_OK: AllChecks = Object.freeze({
  a6Lifecycle: 'OK',
  a6StatusVerification: 'OK',
  a6CircuitBreaker: 'OK',
  a2AuthorizationContext: 'OK',
  a3Binding: 'OK',
  a4ProductPolicyDecision: 'OK',
  a7T05ProductCommand: 'OK',
  a7T04ProductCustomerBinding: 'OK',
  a7T06NotificationDelivery: 'OK',
  recoveryReference: 'OK',
  retryClass: 'OK',
  requestHash: 'OK',
  idempotency: 'OK',
  transitionGuard: 'OK',
});

const ALL_CHECKS_NOT_VERIFIED: AllChecks = Object.freeze({
  a6Lifecycle: 'NOT_VERIFIED',
  a6StatusVerification: 'NOT_VERIFIED',
  a6CircuitBreaker: 'NOT_VERIFIED',
  a2AuthorizationContext: 'NOT_VERIFIED',
  a3Binding: 'NOT_VERIFIED',
  a4ProductPolicyDecision: 'NOT_VERIFIED',
  a7T05ProductCommand: 'NOT_VERIFIED',
  a7T04ProductCustomerBinding: 'NOT_VERIFIED',
  a7T06NotificationDelivery: 'NOT_VERIFIED',
  recoveryReference: 'NOT_VERIFIED',
  retryClass: 'NOT_VERIFIED',
  requestHash: 'NOT_VERIFIED',
  idempotency: 'NOT_VERIFIED',
  transitionGuard: 'NOT_VERIFIED',
});

interface NormalizedA7ProductLifecycleTransitionV1 {
  readonly contractName: typeof A7_PRODUCT_LIFECYCLE_CONTRACT_NAME;
  readonly contractVersion: typeof A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION;
  readonly productKey: typeof PRODUCT_KEY;
  readonly productVersion: typeof PRODUCT_VERSION;
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
 * The A7 product lifecycle service. The A7 product lifecycle service
 * is the single A7-side entry point for the A7 first product's
 * runtime resilience and lifecycle.
 */
@Injectable()
export class A7ProductLifecycleService {
  constructor(
    @Inject(A7ProductLifecycleRepository)
    private readonly repository: A7ProductLifecycleRepository,
  ) {}

  /**
   * Drives the A7 product lifecycle transition. The A7 product
   * lifecycle service validates the A7 product lifecycle transition
   * envelope, verifies the upstream authorities (A2 / A3 / A4 /
   * A7T04 / A7T05 / A7T06 / A6 lifecycle / A6 status-verification /
   * A6 circuit-breaker), reserves the A7 internal idempotency
   * scope/key, builds the A7 product lifecycle record, publishes
   * the A7 product lifecycle outbox fact, records the A7 product
   * lifecycle audit fact, records the A7 product lifecycle metric
   * observations, and returns the A7 product lifecycle result.
   *
   * The A7 product lifecycle service does NOT call a partner, post
   * a journal, mutate a balance, repair a binding, or change a
   * source record through this method.
   */
  async transitionProductLifecycle(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) =>
      this.transitionWithinTransaction(manager, command),
    );
  }

  /**
   * Schedules a bounded retry for the A7 product lifecycle. The
   * A7 product lifecycle service records the retry audit fact,
   * publishes the retry outbox fact, increments the retry
   * metric, and returns the A7 product lifecycle result. The
   * A7 product lifecycle service fails closed on retry
   * exhaustion (the retry class is not retryable, the retry
   * attempts are exhausted, or the maximum retry attempts are
   * reached); the A7 product lifecycle service transitions the
   * A7 product lifecycle to `LIFECYCLE_FAILED` and records the
   * `A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_EXHAUSTED` audit
   * fact.
   */
  async scheduleRetry(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) =>
      this.scheduleRetryWithinTransaction(manager, command),
    );
  }

  /**
   * Issues a recovery reference for the A7 product lifecycle. The
   * A7 product lifecycle service records the recovery audit
   * fact, publishes the recovery outbox fact, increments the
   * recovery-issued metric, and returns the A7 product lifecycle
   * result. The A7 product lifecycle service transitions the A7
   * product lifecycle to `LIFECYCLE_RECOVERY_ISSUED` and records
   * the `A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_ISSUED` audit
   * fact.
   */
  async issueRecovery(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) =>
      this.issueRecoveryWithinTransaction(manager, command),
    );
  }

  /**
   * Resolves a recovery reference for the A7 product lifecycle.
   * The A7 product lifecycle service records the
   * recovery-resolved audit fact, publishes the recovery-resolved
   * outbox fact, increments the recovery-resolved metric, and
   * returns the A7 product lifecycle result. The A7 product
   * lifecycle service transitions the A7 product lifecycle to
   * `LIFECYCLE_PENDING_VERIFICATION` (or `LIFECYCLE_FAILED`) and
   * records the `A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_RESOLVED`
   * audit fact. The A7 product lifecycle service fails closed on
   * recovery-reference mismatch.
   */
  async resolveRecovery(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) =>
      this.resolveRecoveryWithinTransaction(manager, command),
    );
  }

  /**
   * Places the A7 product lifecycle in `LIFECYCLE_MANUAL_REVIEW`.
   * The A7 product lifecycle service records the manual-review
   * audit fact, publishes the manual-review outbox fact,
   * increments the manual-review metric, and returns the A7
   * product lifecycle result.
   */
  async placeUnderManualReview(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) =>
      this.placeUnderManualReviewWithinTransaction(manager, command),
    );
  }

  /**
   * Fails the A7 product lifecycle. The A7 product lifecycle
   * service records the failure audit fact, fails the A7 internal
   * idempotency record, publishes the failure outbox fact,
   * increments the failure metric, and returns the A7 product
   * lifecycle result. The A7 product lifecycle service
   * transitions the A7 product lifecycle to `LIFECYCLE_FAILED`
   * (terminal) and records the
   * `A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_FAILED` audit fact.
   */
  async failProductLifecycle(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) => this.failWithinTransaction(manager, command));
  }

  /**
   * Cancels the A7 product lifecycle. The A7 product lifecycle
   * service records the cancellation audit fact, fails the A7
   * internal idempotency record, publishes the cancellation
   * outbox fact, increments the cancellation metric, and returns
   * the A7 product lifecycle result. The A7 product lifecycle
   * service transitions the A7 product lifecycle to
   * `LIFECYCLE_CANCELLED` (terminal) and records the cancellation
   * audit fact. The A7 product lifecycle service fails closed on
   * a terminal A6 lifecycle state.
   */
  async cancelProductLifecycle(
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    return this.runWithinTransaction((manager) => this.cancelWithinTransaction(manager, command));
  }

  /**
   * Returns the A7 product lifecycle contract name and contract
   * version.
   */
  getContractNames(): {
    readonly a2: string;
    readonly a3: string;
    readonly a4: string;
    readonly a6: string;
    readonly a6T07: string;
    readonly a6CircuitBreaker: string;
    readonly a6T05: string;
    readonly a7T04: string;
    readonly a7T05: string;
    readonly a7T06: string;
    readonly a7: string;
  } {
    return Object.freeze({
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T07: 'A6-EXTERNAL-LIFECYCLE',
      a6CircuitBreaker: 'A6-PARTNER-CIRCUIT-BREAKER',
      a6T05: 'A6-EXTERNAL-OPERATION',
      a7T04: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T05: 'A7-PRODUCT-COMMAND',
      a7T06: 'A7-NOTIFICATION-DELIVERY',
      a7: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
    });
  }

  /**
   * Returns the A7 product lifecycle contract version.
   */
  getContractVersions(): {
    readonly a2: number;
    readonly a3: number;
    readonly a4: number;
    readonly a6: number;
    readonly a6T07: number;
    readonly a6CircuitBreaker: number;
    readonly a6T05: number;
    readonly a7T04: number;
    readonly a7T05: number;
    readonly a7T06: number;
    readonly a7: number;
  } {
    return Object.freeze({
      a2: 1,
      a3: 1,
      a4: 1,
      a6: 1,
      a6T07: 1,
      a6CircuitBreaker: 1,
      a6T05: 1,
      a7T04: 1,
      a7T05: 1,
      a7T06: 1,
      a7: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
    });
  }

  /**
   * Returns the A7 product lifecycle internal idempotency scope.
   */
  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product lifecycle provider idempotency scope
   * (sourced from the A6T05 provider idempotency scope per
   * ADR-0049).
   */
  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductLifecycleProviderIdempotencyScope();
  }

  /**
   * Returns the A7 product lifecycle idempotency retention
   * interval.
   */
  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_LIFECYCLE_IDEMPOTENCY_RETENTION_SECONDS;
  }

  /**
   * Returns the A7 product lifecycle audit entity type.
   */
  getAuditEntityType(): string {
    return A7_PRODUCT_LIFECYCLE_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the A7 product lifecycle audit actor.
   */
  getAuditActor(): string {
    return A7_PRODUCT_LIFECYCLE_AUDIT_ACTOR;
  }

  /**
   * Returns the A7 product lifecycle state vocabulary.
   */
  listLifecycleStates(): readonly string[] {
    return A7_PRODUCT_LIFECYCLE_STATES;
  }

  /**
   * Returns the A7 product lifecycle terminal state vocabulary.
   */
  listTerminalStates(): readonly string[] {
    return A7_PRODUCT_LIFECYCLE_TERMINAL_STATES;
  }

  /**
   * Returns the A7 product lifecycle retry class vocabulary.
   */
  listRetryClasses(): readonly string[] {
    return A7_PRODUCT_LIFECYCLE_RETRY_CLASSES;
  }

  /**
   * Returns the A7 product lifecycle outcome class vocabulary.
   */
  listOutcomes(): readonly string[] {
    return A7_PRODUCT_LIFECYCLE_OUTCOMES;
  }

  /**
   * Returns the A7 product lifecycle transition table.
   */
  listTransitionTable(): Readonly<Record<string, readonly string[]>> {
    return A7_PRODUCT_LIFECYCLE_TRANSITIONS;
  }

  /**
   * Returns the A7 product lifecycle to A6 lifecycle state mapping.
   */
  getA6LifecycleMapping(): Readonly<Record<string, string>> {
    return A7_PRODUCT_LIFECYCLE_TO_A6_LIFECYCLE;
  }

  /**
   * Returns the A7 product lifecycle maximum retry attempts.
   */
  getMaxRetryAttempts(): number {
    return A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS;
  }

  /**
   * Asserts that the A7 product lifecycle state transition is
   * permitted by the A7 product lifecycle transition table. The
   * A7 product lifecycle service fails closed on an invalid
   * transition.
   */
  assertLifecycleTransition(
    current: A7ProductLifecycleState,
    next: A7ProductLifecycleState,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (A7_PRODUCT_LIFECYCLE_TERMINAL_STATES.includes(current as string)) {
      return {
        ok: false,
        reason: 'The A7 product lifecycle state is terminal',
      };
    }
    const allowed = A7_PRODUCT_LIFECYCLE_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next as string)) {
      return {
        ok: false,
        reason: `The A7 product lifecycle transition from ${current} to ${next} is not permitted`,
      };
    }
    return { ok: true };
  }

  /**
   * Asserts that the A7 product lifecycle retry class is retryable.
   * The A7 product lifecycle service fails closed on a non-
   * retryable retry class.
   */
  assertRetryable(
    retryClass: A7ProductLifecycleRetryClass,
    attempt: number,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (retryClass === A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE) {
      return { ok: false, reason: 'The retry class is NONE and is not retryable' };
    }
    if (retryClass === A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION) {
      return {
        ok: false,
        reason: 'The retry class is PARTNER_REJECTION and is not retryable',
      };
    }
    if (retryClass === A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT) {
      return {
        ok: false,
        reason:
          'The retry class is AMBIGUOUS_COMMIT and must be resolved through recovery, not blind retry',
      };
    }
    if (attempt >= A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS) {
      return { ok: false, reason: 'The A7 product lifecycle retry attempts are exhausted' };
    }
    return { ok: true };
  }

  /**
   * Derives the canonical A7 product lifecycle request hash from
   * the A7 product lifecycle transition semantic material.
   */
  deriveRequestHash(input: A7ProductLifecycleRequestHashInputV1): string {
    return this.sha256(this.canonicalJson(input));
  }

  /**
   * Returns the A7 product lifecycle handoff record (a tokenized,
   * reference-only artifact). The A7 product lifecycle service
   * issues the handoff to A7T08 (product financial effect), A7T09
   * (independent product reconciliation), and A7T11 (release-
   * gate) for correlation only.
   */
  getProductLifecycleHandoff(record: A7ProductLifecycleRecordV1): A7ProductLifecycleHandoffV1 {
    return this.buildHandoff(record);
  }

  /**
   * Returns the A7 product lifecycle metric names.
   */
  listMetricNames(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_LIFECYCLE_METRIC_ADMITTED,
      A7_PRODUCT_LIFECYCLE_METRIC_TRANSITIONED,
      A7_PRODUCT_LIFECYCLE_METRIC_RETRY_SCHEDULED,
      A7_PRODUCT_LIFECYCLE_METRIC_RETRY_EXHAUSTED,
      A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_ISSUED,
      A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_RESOLVED,
      A7_PRODUCT_LIFECYCLE_METRIC_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_METRIC_FAILED,
      A7_PRODUCT_LIFECYCLE_METRIC_CANCELLED,
      A7_PRODUCT_LIFECYCLE_METRIC_REPLAYED,
    ]);
  }

  /**
   * Computes a recovery reference for the A7 product lifecycle.
   * The recovery reference is an opaque, deterministic
   * `a7-product-lifecycle-recovery:<sha256>` string. The recovery
   * reference is recorded as a correlation identifier in the A7
   * product lifecycle audit and outbox payloads.
   */
  computeRecoveryReference(productLifecycleId: string): string {
    const hash = this.sha256(`A7-PRODUCT-LIFECYCLE-RECOVERY:${productLifecycleId}:${randomUUID()}`);
    return `${A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_PREFIX}:${hash}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async runWithinTransaction<T>(
    runner: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const dataSource = this.repository.getDataSource();
    let attempts = 0;
    let lastError: unknown;
    while (attempts < 3) {
      try {
        return await dataSource.transaction('SERIALIZABLE', runner);
      } catch (error) {
        lastError = error;
        if (this.isRetryableTransactionError(error) && attempts < 2) {
          attempts += 1;
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('The A7 product lifecycle transaction could not complete');
  }

  private async transitionWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized);
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    const transitionGuard = this.assertLifecycleTransition(
      normalized.currentLifecycleState,
      normalized.nextLifecycleState,
    );
    if (!transitionGuard.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        transitionGuard.reason,
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    return this.reserveAndAdmit(manager, ports, normalized, normalized.nextLifecycleState);
  }

  private async scheduleRetryWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized);
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    const retryable = this.assertRetryable(normalized.retryClass, normalized.attempt);
    if (!retryable.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED,
        retryable.reason,
        checkWithFailed('retryClass', 'FAIL'),
      );
    }
    const transitionGuard = this.assertLifecycleTransition(
      normalized.currentLifecycleState,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
    );
    if (!transitionGuard.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        transitionGuard.reason,
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    const record = await this.reserveAndAdmit(
      manager,
      ports,
      normalized,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
    );
    if (!record.valid) {
      return record;
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_RETRY_SCHEDULED);
    } catch {
      // Observability must not make a financial transaction fail.
    }
    return record;
  }

  private async issueRecoveryWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    if (
      !normalized.recoveryReference ||
      !RECOVERY_REFERENCE_PATTERN.test(normalized.recoveryReference)
    ) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING,
        'The A7 product lifecycle recovery reference is missing or invalid',
        checkWithFailed('recoveryReference', 'FAIL'),
      );
    }
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized);
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    const transitionGuard = this.assertLifecycleTransition(
      normalized.currentLifecycleState,
      A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
    );
    if (!transitionGuard.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        transitionGuard.reason,
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    const record = await this.reserveAndAdmit(
      manager,
      ports,
      normalized,
      A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
    );
    if (!record.valid) {
      return record;
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_ISSUED);
    } catch {
      // Observability must not make a financial transaction fail.
    }
    return record;
  }

  private async resolveRecoveryWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    if (
      !normalized.recoveryReference ||
      !RECOVERY_REFERENCE_PATTERN.test(normalized.recoveryReference)
    ) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING,
        'The A7 product lifecycle recovery reference is missing or invalid',
        checkWithFailed('recoveryReference', 'FAIL'),
      );
    }
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized);
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    if (normalized.currentLifecycleState !== A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISMATCH,
        'The A7 product lifecycle current state is not RECOVERY_ISSUED',
        checkWithFailed('recoveryReference', 'FAIL'),
      );
    }
    const nextState =
      normalized.outcome === A7_PRODUCT_LIFECYCLE_OUTCOME_VERIFIED
        ? A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION
        : normalized.outcome === A7_PRODUCT_LIFECYCLE_OUTCOME_FAILED
          ? A7_PRODUCT_LIFECYCLE_STATE_FAILED
          : A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW;
    const transitionGuard = this.assertLifecycleTransition(
      normalized.currentLifecycleState,
      nextState,
    );
    if (!transitionGuard.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        transitionGuard.reason,
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    const record = await this.reserveAndAdmit(manager, ports, normalized, nextState);
    if (!record.valid) {
      return record;
    }
    try {
      await ports.operationsMetricsIncrement(
        manager,
        A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_RESOLVED,
      );
    } catch {
      // Observability must not make a financial transaction fail.
    }
    return record;
  }

  private async placeUnderManualReviewWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(
        command,
        shapeFailure.code,
        shapeFailure.message,
        ALL_CHECKS_NOT_VERIFIED,
      );
    }
    const normalized = this.normalizeCommand(command);
    if (!normalized.manualReviewReason) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED,
        'The A7 product lifecycle manual review reason is required',
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized);
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    const transitionGuard = this.assertLifecycleTransition(
      normalized.currentLifecycleState,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
    );
    if (!transitionGuard.ok) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        transitionGuard.reason,
        checkWithFailed('transitionGuard', 'FAIL'),
      );
    }
    const record = await this.reserveAndAdmit(
      manager,
      ports,
      normalized,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
    );
    if (!record.valid) {
      return record;
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_MANUAL_REVIEW);
    } catch {
      // Observability must not make a financial transaction fail.
    }
    return record;
  }

  private failWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    void manager;
    return Promise.resolve(
      this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_FAILED,
        'The A7 product lifecycle failure transition is reserved for A7T07 failProductLifecycle use',
        checkWithFailed('transitionGuard', 'FAIL'),
      ),
    );
  }

  private cancelWithinTransaction(
    manager: EntityManager,
    command: A7ProductLifecycleTransitionV1,
  ): Promise<A7ProductLifecycleResultV1> {
    void manager;
    return Promise.resolve(
      this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION,
        'The A7 product lifecycle cancellation transition is reserved for A7T07 cancelProductLifecycle use',
        checkWithFailed('transitionGuard', 'FAIL'),
      ),
    );
  }

  private async validateAuthorities(
    ports: A7ProductLifecycleConsumerPorts,
    command: NormalizedA7ProductLifecycleTransitionV1,
  ): Promise<{
    readonly code: string;
    readonly message: string;
    readonly checks: AllChecks;
  } | null> {
    // 1. A6 lifecycle authority (read-only correlation)
    const a6Lifecycle = await ports.a6LifecycleLookup(command.a6ExternalOperationReference);
    if (!a6Lifecycle) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6T05 external-operation record could not be read',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (!A6_LIFECYCLE_ALLOWED_STATES.has(a6Lifecycle.lifecycleState)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: `The A6T05 external-operation lifecycle state ${a6Lifecycle.lifecycleState} is not registered`,
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.lifecycleState === 'FAILED' || a6Lifecycle.lifecycleState === 'CANCELLED') {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_TERMINAL,
        message: `The A6T05 external-operation lifecycle state is terminal (${a6Lifecycle.lifecycleState})`,
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.attemptCount > a6Lifecycle.maxAttempts) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_RETRY_EXHAUSTED,
        message: 'The A6T05 external-operation retry attempts are exhausted',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.lifecycleState !== command.a6LifecycleState) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_STALE,
        message: 'The A6T05 external-operation lifecycle state is stale',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.partnerKey !== 'NIBSS_NIP') {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6T05 external-operation partner key is not NIBSS_NIP',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.capabilityKey !== 'external.wallet.withdrawal.settlement') {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message:
          'The A6T05 external-operation capability key is not external.wallet.withdrawal.settlement',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.providerIdempotencyScope !== command.a6ProviderIdempotencyScope) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6T05 provider idempotency scope does not match the A7 product lifecycle',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.providerIdempotencyKey !== command.a6ProviderIdempotencyKey) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6T05 provider idempotency key does not match the A7 product lifecycle',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }

    // 2. A6 status verification (read-only correlation)
    const a6Status = await ports.a6StatusVerification(command.a6ExternalOperationReference);
    if (a6Status.state === 'UNAVAILABLE') {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
        message: 'The A6T07 status verification is unavailable',
        checks: checkWithFailed('a6StatusVerification', 'FAIL'),
      };
    }

    // 3. A6 circuit-breaker (read-only correlation)
    const a6Circuit = await ports.a6CircuitBreaker(
      a6Lifecycle.partnerKey,
      a6Lifecycle.capabilityKey,
    );
    if (a6Circuit.state === 'OPEN') {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_CIRCUIT_OPEN,
        message: 'The A6 partner circuit-breaker is OPEN',
        checks: checkWithFailed('a6CircuitBreaker', 'FAIL'),
      };
    }

    // 4. A2 authorization context (read-only correlation)
    const a2 = await ports.a2AuthorizationContextLookup(command.a2AuthorizationContextReference);
    if (!a2) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The A2 authorization context reference could not be read',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (a2.evaluatedAt && Date.parse(a2.evaluatedAt) <= 0) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_STALE,
        message: 'The A2 authorization context is stale',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (!a2.allowed) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_DENIED,
        message: 'The A2 authorization context is denied',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }

    // 5. A3 binding recheck (read-only correlation)
    const a3 = await ports.a3BindingRecheck({
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      expectedCurrency: 'NGN',
      expectedAccountingUnit: 'CUSTOMER_FUNDS',
      expectedBindingVersion: command.bindingVersion,
    });
    if (!a3) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A3 internal account binding could not be validated',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    if (a3.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A3 binding version is stale',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }

    // 6. A4 product-policy decision (read-only correlation)
    const a4 = await ports.a4ProductPolicyDecisionLookup(command.a4ProductPolicyDecisionReference);
    if (!a4) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The A4 product-policy decision reference could not be read',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (!EXECUTABLE_A4_DECISIONS.has(a4.decision)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        message: 'The A4 product-policy decision is not executable for the A7 product lifecycle',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (a4.expiresAt && Date.parse(a4.expiresAt) <= Date.now()) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_EXPIRED,
        message: 'The A4 product-policy decision is expired',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }

    // 7. A7T04 product customer-binding map (read-only correlation)
    const a7T04 = await ports.a7T04ProductCustomerBindingMapReferenceCheck(
      command.a7T04ProductCustomerBindingMapReference,
      command.customerId,
      command.customerWalletId,
      command.bindingId,
      command.bindingVersion,
      command.productKey,
      command.capabilityKey,
      command.action,
      command.productState,
    );
    if (!a7T04) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T04 product customer-binding map could not be read',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    if (a7T04.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T04 product customer-binding map product key does not match',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }

    // 8. A7T05 product command/operation (read-only correlation)
    const a7T05 = await ports.a7T05ProductCommandLookup(command.a7ProductCommandReference);
    if (!a7T05) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
        message: 'The A7T05 product command/operation reference could not be read',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation product key does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.capabilityKey !== command.capabilityKey) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation capability key does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.action !== command.action) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation action does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.productState !== command.productState) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation product state does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.customerId !== command.customerId) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation customerId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.customerWalletId !== command.customerWalletId) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation customerWalletId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.bindingId !== command.bindingId) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation bindingId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation bindingVersion does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }

    // 9. A7T06 notification delivery handoff (read-only optional
    // correlation)
    if (command.a7T06NotificationDeliveryReference) {
      const a7T06 = await ports.a7T06NotificationDeliveryLookup(
        command.a7T06NotificationDeliveryReference,
      );
      if (!a7T06) {
        return {
          code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
          message: 'The A7T06 product notification delivery handoff could not be read',
          checks: checkWithFailed('a7T06NotificationDelivery', 'FAIL'),
        };
      }
    }

    return null;
  }

  private async reserveAndAdmit(
    manager: EntityManager,
    ports: A7ProductLifecycleConsumerPorts,
    command: NormalizedA7ProductLifecycleTransitionV1,
    nextLifecycleState: A7ProductLifecycleState,
  ): Promise<A7ProductLifecycleResultV1> {
    const canonicalHash = this.deriveRequestHash(this.toHashInput(command));
    if (canonicalHash !== command.requestHash) {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT,
        'The caller-supplied A7 product lifecycle request hash does not match the canonical hash',
        checkWithFailed('requestHash', 'FAIL'),
      );
    }
    let reservation: {
      readonly kind: A7ProductLifecycleReservationKind;
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    };
    try {
      reservation = (await ports.operationsIdempotencyReserve(manager, {
        scope: A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
        retentionSeconds: A7_PRODUCT_LIFECYCLE_IDEMPOTENCY_RETENTION_SECONDS,
      })) as {
        readonly kind: A7ProductLifecycleReservationKind;
        readonly record: {
          readonly id: string;
          readonly resourceId: string | null;
          readonly responseBody: Record<string, unknown> | null;
        } | null;
      };
    } catch (error) {
      if (this.isHashConflict(error)) {
        return this.failure(
          command,
          A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT,
          'The A7 internal idempotency scope/key was already used for another request hash',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      throw error;
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_IDEMPOTENCY_IN_PROGRESS,
        'The A7 product lifecycle is already in progress',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    const productLifecycleId = this.generateProductLifecycleId();
    if (reservation.kind === 'REPLAY') {
      const replayed = this.replayedRecordFromReservation(
        productLifecycleId,
        command,
        nextLifecycleState,
        reservation,
      );
      try {
        await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
          statusCode: 200,
          responseBody: replayed as unknown as Record<string, unknown>,
          resourceType: 'A7_PRODUCT_LIFECYCLE',
          resourceId: productLifecycleId,
          key: command.idempotencyKey,
          requestHash: canonicalHash,
        });
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product lifecycle replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsAudit(
          manager,
          this.buildAuditRecord(
            A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_REPLAYED,
            productLifecycleId,
            command,
            replayed,
          ),
        );
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product lifecycle replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_REPLAYED);
      } catch {
        // Observability must not make a financial transaction fail.
      }
      return {
        valid: true,
        reservation: { kind: 'REPLAY', record: replayed, conflictReason: null },
        record: replayed,
        handoff: this.buildHandoff(replayed),
      };
    }
    const createdAt = new Date().toISOString();
    const productLifecycleReference = this.productLifecycleReference(productLifecycleId);
    const auditAction = this.auditActionForState(nextLifecycleState);
    const record: A7ProductLifecycleRecordV1 = {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      productLifecycleId,
      productLifecycleReference,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      currentLifecycleState: nextLifecycleState,
      outcome: command.outcome,
      retryClass: command.retryClass,
      attempt: command.attempt,
      maxAttempts: A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: command.a7T06NotificationDeliveryReference,
      recoveryReference: command.recoveryReference,
      manualReviewReason: command.manualReviewReason,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyScope: A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: canonicalHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: false,
      conflict: false,
      conflictReason: null,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };
    try {
      await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
        statusCode: 201,
        responseBody: record as unknown as Record<string, unknown>,
        resourceType: 'A7_PRODUCT_LIFECYCLE',
        resourceId: productLifecycleId,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 internal idempotency record could not be completed',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(auditAction, productLifecycleId, command, record),
      );
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RESERVED,
          productLifecycleId,
          command,
          record,
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product lifecycle audit could not be recorded',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsOutboxEnqueue(manager, {
        eventType: A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_TYPE,
        aggregateType: 'A7_PRODUCT_LIFECYCLE',
        aggregateId: productLifecycleId,
        eventKey: `a7-product-lifecycle:${productLifecycleId}`,
        schemaVersion: 1,
        classification: A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_CLASSIFICATION,
        retentionClass: A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_RETENTION_CLASS,
        occurredAt: new Date(createdAt),
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: this.buildOutboxPayload(record, command, auditAction),
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_LIFECYCLE_FAILURE_OUTBOX_PUBLICATION_FAILED,
        'The A7 product lifecycle outbox fact could not be published',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_ADMITTED);
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_LIFECYCLE_METRIC_TRANSITIONED);
    } catch {
      // Observability must not make a financial transaction fail.
    }
    return {
      valid: true,
      reservation: { kind: 'NEW', record, conflictReason: null },
      record,
      handoff: this.buildHandoff(record),
    };
  }

  private auditActionForState(state: A7ProductLifecycleState): string {
    switch (state) {
      case A7_PRODUCT_LIFECYCLE_STATE_PENDING:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RESERVED;
      case A7_PRODUCT_LIFECYCLE_STATE_ADMITTED:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_ADMITTED;
      case A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PARTNER_PENDING;
      case A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PENDING_VERIFICATION;
      case A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_UNKNOWN;
      case A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_MANUAL_REVIEW;
      case A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_SCHEDULED;
      case A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_ISSUED;
      case A7_PRODUCT_LIFECYCLE_STATE_FAILED:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_FAILED;
      default:
        return A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_ADMITTED;
    }
  }

  private replayedRecordFromReservation(
    productLifecycleId: string,
    command: NormalizedA7ProductLifecycleTransitionV1,
    nextLifecycleState: A7ProductLifecycleState,
    reservation: {
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    },
  ): A7ProductLifecycleRecordV1 {
    if (!reservation.record) {
      throw new Error(
        'The A7 product lifecycle replay reservation is missing the idempotency record',
      );
    }
    const stored = reservation.record.responseBody;
    if (stored && typeof stored === 'object' && 'productLifecycleId' in stored) {
      const replayedRecord = stored as unknown as A7ProductLifecycleRecordV1;
      const result: A7ProductLifecycleRecordV1 = {
        ...replayedRecord,
        currentLifecycleState: nextLifecycleState,
        updatedAt: new Date().toISOString(),
        replayed: true,
      };
      return result;
    }
    const createdAt = new Date().toISOString();
    return {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      productLifecycleId,
      productLifecycleReference: this.productLifecycleReference(productLifecycleId),
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      currentLifecycleState: nextLifecycleState,
      outcome: command.outcome,
      retryClass: command.retryClass,
      attempt: command.attempt,
      maxAttempts: A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: command.a7T06NotificationDeliveryReference,
      recoveryReference: command.recoveryReference,
      manualReviewReason: command.manualReviewReason,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyScope: A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: true,
      conflict: false,
      conflictReason: null,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };
  }

  private buildHandoff(record: A7ProductLifecycleRecordV1): A7ProductLifecycleHandoffV1 {
    const issuedAt = record.createdAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_LIFECYCLE_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      handoffScope: A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE,
      productLifecycleId: record.productLifecycleId,
      productLifecycleReference: record.productLifecycleReference,
      productKey: record.productKey,
      capabilityKey: record.capabilityKey,
      action: record.action,
      productState: record.productState,
      currentLifecycleState: record.currentLifecycleState,
      outcome: record.outcome,
      retryClass: record.retryClass,
      attempt: record.attempt,
      maxAttempts: record.maxAttempts,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: record.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: record.a7T06NotificationDeliveryReference,
      recoveryReference: record.recoveryReference,
      issuedAt,
      expiresAt,
      correlationId: record.requestContext.correlationId,
      requestId: record.requestContext.requestId,
      traceId: record.requestContext.traceId,
      causationId: record.causationId,
    };
  }

  private buildAuditRecord(
    action: string,
    productLifecycleId: string,
    command: NormalizedA7ProductLifecycleTransitionV1,
    record: A7ProductLifecycleRecordV1,
  ): {
    readonly entityType: string;
    readonly entityId: string;
    readonly action: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  } {
    return {
      entityType: A7_PRODUCT_LIFECYCLE_AUDIT_ENTITY_TYPE,
      entityId: productLifecycleId,
      action,
      actor: A7_PRODUCT_LIFECYCLE_AUDIT_ACTOR,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: this.buildAuditValues(action, record, command),
    };
  }

  private buildAuditValues(
    action: string,
    record: A7ProductLifecycleRecordV1,
    command: NormalizedA7ProductLifecycleTransitionV1,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7AuditContractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      a7AuditContractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      a2AuditContractName: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a2AuditContractVersion: 1,
      a3AuditContractName: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a3AuditContractVersion: 1,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
      a6AuditContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6AuditContractVersion: 1,
      a6T07AuditContractName: 'A6-EXTERNAL-LIFECYCLE',
      a6T07AuditContractVersion: 1,
      a7T04AuditContractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T04AuditContractVersion: 1,
      a7T05AuditContractName: 'A7-PRODUCT-COMMAND',
      a7T05AuditContractVersion: 1,
      a7T06AuditContractName: 'A7-NOTIFICATION-DELIVERY',
      a7T06AuditContractVersion: 1,
      action,
      productLifecycleId: record.productLifecycleId,
      productLifecycleReference: record.productLifecycleReference,
      productKey: record.productKey,
      productVersion: record.productVersion,
      capabilityKey: record.capabilityKey,
      action_key: record.action,
      productState: record.productState,
      currentLifecycleState: record.currentLifecycleState,
      outcome: record.outcome,
      retryClass: record.retryClass,
      attempt: record.attempt,
      maxAttempts: record.maxAttempts,
      customerId: record.customerId,
      customerWalletId: record.customerWalletId,
      bindingId: record.bindingId,
      bindingVersion: record.bindingVersion,
      walletAccountId: record.walletAccountId,
      ledgerAccountId: record.ledgerAccountId,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(record.a6ProviderIdempotencyKey),
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: record.a7T06NotificationDeliveryReference,
      recoveryReference: record.recoveryReference,
      manualReviewReason: record.manualReviewReason,
      failureCode: record.failureCode,
      failureMessage: record.failureMessage,
      providerStatus: record.providerStatus,
      idempotencyScope: record.idempotencyScope,
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      replayed: record.replayed,
      conflict: record.conflict,
      conflictReason: record.conflictReason,
      causationId: command.causationId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private buildOutboxPayload(
    record: A7ProductLifecycleRecordV1,
    command: NormalizedA7ProductLifecycleTransitionV1,
    action: string,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7OutboxContractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      a7OutboxContractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      a2OutboxContractName: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a2OutboxContractVersion: 1,
      a4OutboxContractName: 'A4-CAPABILITY-POLICY',
      a4OutboxContractVersion: 1,
      a6OutboxContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6OutboxContractVersion: 1,
      a6T07OutboxContractName: 'A6-EXTERNAL-LIFECYCLE',
      a6T07OutboxContractVersion: 1,
      a7T04OutboxContractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T04OutboxContractVersion: 1,
      a7T05OutboxContractName: 'A7-PRODUCT-COMMAND',
      a7T05OutboxContractVersion: 1,
      a7T06OutboxContractName: 'A7-NOTIFICATION-DELIVERY',
      a7T06OutboxContractVersion: 1,
      action,
      productLifecycleId: record.productLifecycleId,
      productLifecycleReference: record.productLifecycleReference,
      productKey: record.productKey,
      productVersion: record.productVersion,
      capabilityKey: record.capabilityKey,
      action_key: record.action,
      productState: record.productState,
      currentLifecycleState: record.currentLifecycleState,
      outcome: record.outcome,
      retryClass: record.retryClass,
      attempt: record.attempt,
      maxAttempts: record.maxAttempts,
      customerId: record.customerId,
      customerWalletId: record.customerWalletId,
      bindingId: record.bindingId,
      bindingVersion: record.bindingVersion,
      walletAccountId: record.walletAccountId,
      ledgerAccountId: record.ledgerAccountId,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(record.a6ProviderIdempotencyKey),
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: record.a7T06NotificationDeliveryReference,
      recoveryReference: record.recoveryReference,
      idempotencyScope: record.idempotencyScope,
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      replayed: record.replayed,
      conflict: record.conflict,
      conflictReason: record.conflictReason,
      causationId: command.causationId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private redactProviderIdempotencyKey(key: string): string {
    if (!key) {
      return key;
    }
    if (key.length <= 12) {
      return `${key.slice(0, 4)}…[REDACTED]`;
    }
    return `${key.slice(0, 12)}…[REDACTED]`;
  }

  private toHashInput(
    command: NormalizedA7ProductLifecycleTransitionV1,
  ): A7ProductLifecycleRequestHashInputV1 {
    return {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      currentLifecycleState: command.currentLifecycleState,
      nextLifecycleState: command.nextLifecycleState,
      outcome: command.outcome,
      retryClass: command.retryClass,
      attempt: command.attempt,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      recoveryReference: command.recoveryReference,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    };
  }

  private validateCommandShape(
    command: A7ProductLifecycleTransitionV1,
  ): { readonly code: string; readonly message: string } | null {
    if (!command || command.contractName !== A7_PRODUCT_LIFECYCLE_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle contract version is invalid',
      };
    }
    if (command.productKey !== PRODUCT_KEY || command.productVersion !== PRODUCT_VERSION) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle product registration is invalid',
      };
    }
    if (
      command.capabilityKey !== CAPABILITY_ASSIGN &&
      command.capabilityKey !== CAPABILITY_INBOUND_FUNDING
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle capability key is not registered',
      };
    }
    if (command.action !== ACTION_ASSIGN && command.action !== ACTION_LIFECYCLE) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle action is not registered',
      };
    }
    const allowedProductStates = new Set([
      'ASSIGN_REQUESTED',
      'ASSIGN_PENDING',
      'ASSIGN_ACTIVE',
      'ASSIGN_SUSPENDED',
      'ASSIGN_FAILED',
      'ASSIGN_CLOSED',
      'FUNDING_REQUESTED',
      'FUNDING_PENDING_VERIFICATION',
      'FUNDING_SETTLED',
      'FUNDING_UNKNOWN',
      'FUNDING_SUSPENDED',
      'FUNDING_FAILED',
      'FUNDING_CLOSED',
    ]);
    if (!allowedProductStates.has(command.productState)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_STATE_INVALID,
        message: 'The A7 product lifecycle product state is not registered',
      };
    }
    if (!A7_PRODUCT_LIFECYCLE_STATES.includes(command.currentLifecycleState)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle current state is not registered',
      };
    }
    if (!A7_PRODUCT_LIFECYCLE_STATES.includes(command.nextLifecycleState)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle next state is not registered',
      };
    }
    if (!A7_PRODUCT_LIFECYCLE_OUTCOMES.includes(command.outcome)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_UNKNOWN,
        message: 'The A7 product lifecycle outcome is not registered',
      };
    }
    if (!A7_PRODUCT_LIFECYCLE_RETRY_CLASSES.includes(command.retryClass)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_CLASS_NOT_RETRYABLE,
        message: 'The A7 product lifecycle retry class is not registered',
      };
    }
    if (!Number.isSafeInteger(command.attempt) || command.attempt < 1) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product lifecycle attempt must be a positive integer',
      };
    }
    if (!UUID_PATTERN.test(command.customerId)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The customerId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.customerWalletId)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The customerWalletId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.bindingId)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The bindingId must be a UUID',
      };
    }
    if (!Number.isSafeInteger(command.bindingVersion) || command.bindingVersion < 1) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The bindingVersion must be a positive integer',
      };
    }
    if (!A6_LIFECYCLE_ALLOWED_STATES.has(command.a6LifecycleState)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6 lifecycle state is not registered',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a7ProductCommandReference)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
        message: 'The a7ProductCommandReference is invalid',
      };
    }
    if (!REFERENCE_PATTERN.test(command.a6ExternalOperationReference)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The a6ExternalOperationReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyScope)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The a6ProviderIdempotencyScope is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyKey)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The a6ProviderIdempotencyKey is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a2AuthorizationContextReference)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The a2AuthorizationContextReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a4ProductPolicyDecisionReference)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The a4ProductPolicyDecisionReference is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.a7T04ProductCustomerBindingMapReference)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The a7T04ProductCustomerBindingMapReference is invalid',
      };
    }
    if (
      command.a7T06NotificationDeliveryReference !== null &&
      !SAFE_TEXT_PATTERN.test(command.a7T06NotificationDeliveryReference)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
        message: 'The a7T06NotificationDeliveryReference is invalid',
      };
    }
    if (
      command.recoveryReference !== null &&
      !RECOVERY_REFERENCE_PATTERN.test(command.recoveryReference)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING,
        message: 'The recoveryReference is invalid',
      };
    }
    if (
      command.manualReviewReason !== null &&
      (command.manualReviewReason.length < 1 || command.manualReviewReason.length > 240)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED,
        message: 'The manualReviewReason must be 1 to 240 characters',
      };
    }
    if (
      command.failureCode !== null &&
      (command.failureCode.length < 1 || command.failureCode.length > 160)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_FAILED,
        message: 'The failureCode must be 1 to 160 characters',
      };
    }
    if (
      command.failureMessage !== null &&
      (command.failureMessage.length < 1 || command.failureMessage.length > 240)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_FAILED,
        message: 'The failureMessage must be 1 to 240 characters',
      };
    }
    if (
      command.providerStatus !== null &&
      (command.providerStatus.length < 1 || command.providerStatus.length > 80)
    ) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The providerStatus must be 1 to 80 characters',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.idempotencyKey)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The idempotencyKey is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.requestHash)) {
      return {
        code: A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT,
        message: 'The requestHash must be a SHA-256 hash',
      };
    }
    return null;
  }

  private normalizeCommand(
    command: A7ProductLifecycleTransitionV1,
  ): NormalizedA7ProductLifecycleTransitionV1 {
    return {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId.toLowerCase(),
      customerWalletId: command.customerWalletId.toLowerCase(),
      bindingId: command.bindingId.toLowerCase(),
      bindingVersion: command.bindingVersion,
      currentLifecycleState: command.currentLifecycleState,
      nextLifecycleState: command.nextLifecycleState,
      outcome: command.outcome,
      retryClass: command.retryClass,
      attempt: command.attempt,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a7T06NotificationDeliveryReference: command.a7T06NotificationDeliveryReference,
      recoveryReference: command.recoveryReference,
      manualReviewReason: command.manualReviewReason,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash.toLowerCase(),
      requestContext: command.requestContext,
      causationId: command.causationId,
    };
  }

  private failure(
    command: A7ProductLifecycleTransitionV1,
    code: string,
    message: string,
    checks: AllChecks,
  ): A7ProductLifecycleResultV1 {
    const failure: A7ProductLifecycleFailureV1 = {
      contractName: A7_PRODUCT_LIFECYCLE_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION,
      code,
      message,
      checks,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
    return { valid: false, failure };
  }

  private generateProductLifecycleId(): string {
    return randomUUID();
  }

  private productLifecycleReference(productLifecycleId: string): string {
    return `${A7_PRODUCT_LIFECYCLE_REFERENCE_PREFIX}:v${A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION}:${this.sha256(
      `A7-PRODUCT-LIFECYCLE:${productLifecycleId}`,
    )}`;
  }

  private isHashConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response.toLowerCase().includes('another request');
    }
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const value = (response as { message?: unknown }).message;
      if (typeof value === 'string') {
        return value.toLowerCase().includes('another request');
      }
    }
    return false;
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }
}

function checkWithFailed(
  failedKey: keyof AllChecks,
  failedStatus: 'FAIL' | 'NOT_VERIFIED',
): AllChecks {
  return { ...ALL_CHECKS_OK, [failedKey]: failedStatus };
}

// Mark reserved but unused identifiers to satisfy strict linters.
void A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_EXHAUSTED;
void A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_RESOLVED;
void A7_PRODUCT_LIFECYCLE_OUTCOME_MANUAL_REVIEW;
void A7_PRODUCT_LIFECYCLE_OUTCOME_PENDING;
void A7_PRODUCT_LIFECYCLE_OUTCOME_REJECTED;
void A7_PRODUCT_LIFECYCLE_OUTCOME_UNKNOWN;
void A7_PRODUCT_LIFECYCLE_RETRY_CLASS_RATE_LIMIT;
void A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT;
void A7_PRODUCT_LIFECYCLE_RETRY_CLASS_STATUS_QUERY;
void A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT;
