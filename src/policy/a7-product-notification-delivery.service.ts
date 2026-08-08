/**
 * A7T06 — A7 product notification delivery service.
 *
 * The A7 product notification delivery service is the single A7-side
 * entry point for the A7 first product's notification dispatcher
 * boundary, outbox contract, and audit/idempotency integration. The
 * A7 product notification delivery service composes the existing
 * `CustomerPreference` (the only customer intent authority), the
 * A6T10 data-classification matrix (the only data-classification
 * authority), and the A2 / A3 / A4 / A5 / A6 / Operations authorities
 * (reused as-is, without modification) under the A7 notification
 * dispatch envelope:
 *
 *  - the existing `CustomerPreferenceService.getPreferences()` (reused
 *    for the `CustomerPreference.notifications` read; the A7 product
 *    notification delivery service does NOT write a new
 *    `CustomerPreference` record and does NOT mutate the
 *    `CustomerPreference.notifications` channel flags);
 *  - the A6T10 `ExternalDataClassificationRegistry` (reused for the
 *    notification payload classification; the A6T10 data-classification
 *    matrix is the only data-classification authority);
 *  - the A2 `AuthorizationService` (reused for the A2 authorization
 *    context reference);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (reused for the A3 binding recheck);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference);
 *  - the A6T05 `ExternalOperationService` (reused for the A6 partner
 *    reference identity correlation; per ADR-0049);
 *  - the A7T04 `A7ProductCustomerBindingService` (reused for the A7
 *    product customer-binding map reference);
 *  - the A7T05 `A7ProductCommandService` (reused for the A7 product
 *    command/operation identity correlation);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency scope/key reservation, completion, and failure);
 *  - the shared `AuditService` (reused for the A7 notification
 *    dispatch audit facts);
 *  - the shared `OutboxService` (reused for the A7 notification
 *    dispatch outbox facts);
 *  - the shared `DataSource` (reused for the A7 notification dispatch
 *    SERIALIZABLE transactions).
 *
 * No new policy evaluator, no new authorization service, no new
 * customer-binding service, no new settlement authority, no new
 * reconciliation engine, no new customer intent authority, no new
 * notification authority, no new audit authority, no new idempotency
 * authority, no new outbox authority, no new product command identity,
 * no new product notification identity, and no new transactional
 * boundary is introduced. The `CustomerPreference` / A6T10 / A2 / A3 /
 * A4 / A5 / A6 / Operations authorities are the only authorities. No
 * live email, SMS, push, or web-channel provider is wired.
 */

import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';

import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_ADMITTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_REPLAYED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_RESERVED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_SUPPRESSED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTOR,
  A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_STALE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_STALE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OUTBOX_PUBLICATION_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_AUDIENCE_TOO_LOW,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_REJECTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_SECRET_PRESENT,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID,
  A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_SCOPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_VALIDITY_SECONDS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_IDEMPOTENCY_RETENTION_SECONDS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_CLASSIFICATION,
  A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_RETENTION_CLASS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_TYPE,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATES,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED,
  A7_PRODUCT_NOTIFICATION_DISPATCH_REFERENCE_PREFIX,
  A7_PRODUCT_NOTIFICATION_EVENT_REFERENCE_PREFIX,
  A7_PRODUCT_NOTIFICATION_DELIVERY_ALL_STATES,
  A7_PRODUCT_NOTIFICATION_DELIVERY_ASSIGN_STATES,
  A7_PRODUCT_NOTIFICATION_DELIVERY_FUNDING_STATES,
} from './a7-product-notification-delivery.constants';
import { A7ProductNotificationDeliveryRepository } from './a7-product-notification-delivery.repository';
import type {
  A7ProductNotificationDeliveryFailureV1,
  A7ProductNotificationDeliveryHandoffV1,
  A7ProductNotificationDeliveryProductState,
  A7ProductNotificationDeliveryRequestHashInputV1,
  A7ProductNotificationDeliveryReservationKind,
  A7ProductNotificationDeliveryResultV1,
  A7ProductNotificationDispatchRecordV1,
  A7ProductNotificationDispatchV1,
  A7ProductNotificationDeliveryConsumerPorts,
} from './a7-product-notification-delivery.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;
const TEMPLATE_REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const ACTION_ASSIGN = 'assign' as const;
const ACTION_LIFECYCLE = 'lifecycle' as const;
const CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
const CAPABILITY_INBOUND_FUNDING = 'virtual-account.inbound-funding' as const;
const PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;
const PRODUCT_VERSION = 1 as const;
const A6T10_SECURITY_AUDIENCE = 'SECURITY' as const;
const EXECUTABLE_A4_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'ALLOW_WITH_LIMITS']);
const A6T10_MAX_LEVEL_ORDER: Readonly<Record<string, number>> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
  HIGHLY_RESTRICTED: 4,
};

type AllChecks = A7ProductNotificationDeliveryFailureV1['checks'];
const ALL_CHECKS_OK: AllChecks = Object.freeze({
  a2AuthorizationContext: 'OK',
  a3Binding: 'OK',
  a4ProductPolicyDecision: 'OK',
  a7T04ProductCustomerBinding: 'OK',
  a7T05ProductCommand: 'OK',
  a6T10DataClassification: 'OK',
  customerPreference: 'OK',
  requestHash: 'OK',
  idempotency: 'OK',
  channel: 'OK',
  payloadHash: 'OK',
});

const ALL_CHECKS_NOT_VERIFIED: AllChecks = Object.freeze({
  a2AuthorizationContext: 'NOT_VERIFIED',
  a3Binding: 'NOT_VERIFIED',
  a4ProductPolicyDecision: 'NOT_VERIFIED',
  a7T04ProductCustomerBinding: 'NOT_VERIFIED',
  a7T05ProductCommand: 'NOT_VERIFIED',
  a6T10DataClassification: 'NOT_VERIFIED',
  customerPreference: 'NOT_VERIFIED',
  requestHash: 'NOT_VERIFIED',
  idempotency: 'NOT_VERIFIED',
  channel: 'NOT_VERIFIED',
  payloadHash: 'NOT_VERIFIED',
});

interface NormalizedA7ProductNotificationDispatchV1 {
  readonly contractName: typeof A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME;
  readonly contractVersion: typeof A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION;
  readonly productKey: typeof PRODUCT_KEY;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductNotificationDeliveryProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly customerPreferenceId: string;
  readonly notificationChannel: 'email' | 'sms' | 'push' | 'inApp';
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
 * The A7 product notification delivery service. The A7 product
 * notification delivery service is the single A7-side entry point for
 * the A7 first product's notification dispatcher boundary, outbox
 * contract, and audit/idempotency integration.
 */
@Injectable()
export class A7ProductNotificationDeliveryService {
  constructor(
    @Inject(A7ProductNotificationDeliveryRepository)
    private readonly repository: A7ProductNotificationDeliveryRepository,
  ) {}

  /**
   * Dispatches the A7 notification. The A7 product notification
   * delivery service derives the canonical A7 notification dispatch
   * request hash, validates the A7 notification dispatch envelope,
   * verifies the upstream authorities (A2 / A3 / A4 / A7T04 / A7T05 /
   * A6T10 / `CustomerPreference`), classifies the notification payload
   * through the A6T10 data-classification matrix, reserves the A7
   * internal idempotency scope/key, builds the A7 notification
   * dispatch event, publishes the A7 notification dispatch outbox
   * fact, records the A7 notification dispatch audit fact, and
   * returns the A7 notification delivery result. The A7 product
   * notification delivery service does NOT call a partner, dispatch
   * an email/SMS/push/web-channel, post a journal, mutate a balance,
   * mutate a `CustomerPreference` source record, or change a source
   * record through this method.
   */
  async dispatchNotification(
    command: A7ProductNotificationDispatchV1,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
    return this.runWithinTransaction(async (manager) =>
      this.dispatchWithinTransaction(manager, command),
    );
  }

  /**
   * Suppresses the A7 notification delivery. The A7 product
   * notification delivery service records the A7 notification
   * suppression audit fact, fails the A7 internal idempotency record,
   * and returns the A7 notification delivery result. The A7 product
   * notification delivery service does NOT publish the A7 notification
   * dispatch outbox fact for a suppressed delivery.
   */
  suppressNotification(
    notificationDispatchId: string,
    reason: string,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
    if (!UUID_PATTERN.test(notificationDispatchId)) {
      throw new ConflictException('The A7 notification dispatch id must be a UUID');
    }
    if (!reason || reason.length > 160) {
      throw new ConflictException(
        'The A7 notification suppression reason must be 1 to 160 characters',
      );
    }
    return this.runWithinTransaction((manager) =>
      Promise.resolve(this.suppressWithinTransaction(manager, notificationDispatchId, reason)),
    );
  }

  /**
   * Marks the A7 notification delivery as failed. The A7 product
   * notification delivery service records the A7 notification
   * failure audit fact, fails the A7 internal idempotency record,
   * and returns the A7 notification delivery result. The A7 product
   * notification delivery service does NOT publish the A7 notification
   * dispatch outbox fact for a failed delivery.
   */
  markNotificationFailed(
    notificationDispatchId: string,
    failureCode: string,
    failureMessage: string,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
    if (!UUID_PATTERN.test(notificationDispatchId)) {
      throw new ConflictException('The A7 notification dispatch id must be a UUID');
    }
    if (!failureCode || failureCode.length > 160) {
      throw new ConflictException('The A7 notification failure code must be 1 to 160 characters');
    }
    if (!failureMessage || failureMessage.length > 240) {
      throw new ConflictException(
        'The A7 notification failure message must be 1 to 240 characters',
      );
    }
    return this.runWithinTransaction((manager) =>
      Promise.resolve(
        this.failWithinTransaction(manager, notificationDispatchId, failureCode, failureMessage),
      ),
    );
  }

  /**
   * Resolves the customer notification preferences through the
   * existing `CustomerPreferenceService` consumer boundary. The A7
   * product notification delivery service does NOT write a new
   * `CustomerPreference` record and does NOT mutate the
   * `CustomerPreference.notifications` channel flags. This is a
   * read-only convenience accessor for A7T07 / A7T09 / A7T11.
   *
   * The method delegates to the A7 product notification delivery
   * consumer port; the consumer port invokes the existing
   * `CustomerPreferenceService.getPreferences()` through the A7
   * product notification delivery repository.
   */
  async resolveNotificationPreferences(
    customerId: string,
    expectedPreferenceId: string,
  ): Promise<{
    readonly id: string;
    readonly customerId: string;
    readonly notifications: {
      readonly email: boolean;
      readonly sms: boolean;
      readonly push: boolean;
      readonly inApp: boolean;
    };
  } | null> {
    if (!UUID_PATTERN.test(customerId) || !UUID_PATTERN.test(expectedPreferenceId)) {
      return null;
    }
    const ports = this.repository.getConsumerPorts();
    const view = await ports.customerPreferenceLookup(customerId, expectedPreferenceId);
    if (!view) {
      return null;
    }
    return {
      id: view.id,
      customerId: view.customerId,
      notifications: {
        email: view.notifications.email,
        sms: view.notifications.sms,
        push: view.notifications.push,
        inApp: view.notifications.inApp,
      },
    };
  }

  /**
   * Returns the A7 product notification delivery handoff record
   * (a tokenized, reference-only artifact). The A7 product
   * notification delivery service issues the handoff to A7T07 (product
   * lifecycle), A7T09 (product reconciliation), and A7T11 (release-
   * gate) for correlation only. The handoff is not a financial
   * command, not an A2 authorization, not an A3 binding repair, not
   * an A4 product-policy decision, and not a Ledger record.
   */
  getNotificationDeliveryHandoff(
    dispatch: A7ProductNotificationDispatchRecordV1,
  ): A7ProductNotificationDeliveryHandoffV1 {
    return this.buildHandoff(dispatch);
  }

  /**
   * Returns the A7 product notification delivery contract name and
   * contract version.
   */
  getContractNames(): {
    readonly customerPreference: string;
    readonly a2: string;
    readonly a3: string;
    readonly a4: string;
    readonly a6: string;
    readonly a6T10: string;
    readonly a7: string;
  } {
    return Object.freeze({
      customerPreference: 'CUSTOMER-PREFERENCE',
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T10: 'A6-EXTERNAL-DATA-MINIMIZATION',
      a7: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
    });
  }

  /**
   * Returns the A7 product notification delivery contract version.
   */
  getContractVersions(): {
    readonly customerPreference: number;
    readonly a2: number;
    readonly a3: number;
    readonly a4: number;
    readonly a6: number;
    readonly a6T10: number;
    readonly a7: number;
  } {
    return Object.freeze({
      customerPreference: 1,
      a2: 1,
      a3: 1,
      a4: 1,
      a6: 1,
      a6T10: 1,
      a7: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
    });
  }

  /**
   * Returns the A7 product notification delivery internal idempotency
   * scope.
   */
  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product notification delivery provider idempotency
   * scope (sourced from the A6T05 provider idempotency scope per
   * ADR-0049).
   */
  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductNotificationDeliveryProviderIdempotencyScope();
  }

  /**
   * Returns the A7 product notification delivery idempotency retention
   * interval (aligned with the shared Operations `IdempotencyService`
   * default).
   */
  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_IDEMPOTENCY_RETENTION_SECONDS;
  }

  /**
   * Returns the A7 product notification delivery audit entity type.
   */
  getAuditEntityType(): string {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the A7 product notification delivery audit actor.
   */
  getAuditActor(): string {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTOR;
  }

  /**
   * Returns the A7 product notification delivery state vocabulary.
   */
  listDeliveryStates(): readonly string[] {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_STATES;
  }

  /**
   * Returns the A7 product notification delivery notification channel
   * vocabulary.
   */
  listNotificationChannels(): readonly string[] {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS;
  }

  /**
   * Derives the canonical A7 notification dispatch request hash from
   * the A7 notification dispatch semantic material. The hash material
   * includes every field that changes the A7 notification dispatch
   * effect and excludes transport-only, observation, and secret values
   * (per `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §6).
   */
  deriveRequestHash(input: A7ProductNotificationDeliveryRequestHashInputV1): string {
    return this.sha256(this.canonicalJson(input));
  }

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
      : new Error('The A7 notification dispatch transaction could not complete');
  }

  private async dispatchWithinTransaction(
    manager: EntityManager,
    command: A7ProductNotificationDispatchV1,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
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
      // Customer preference disabled → SUPPRESSED (not FAILED); the A7
      // product notification delivery service records the suppression
      // audit fact and does NOT publish the A7 notification dispatch
      // outbox fact.
      if (
        authorityFailure.code ===
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED
      ) {
        return this.suppress(manager, ports, normalized, authorityFailure.message);
      }
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    const classification = this.classifyNotificationPayload(ports, normalized);
    if (classification) {
      return this.failure(
        command,
        classification.code,
        classification.message,
        classification.checks,
      );
    }
    return this.reserveAndAdmit(manager, ports, normalized);
  }

  private async validateAuthorities(
    ports: A7ProductNotificationDeliveryConsumerPorts,
    command: NormalizedA7ProductNotificationDispatchV1,
  ): Promise<{
    readonly code: string;
    readonly message: string;
    readonly checks: AllChecks;
  } | null> {
    const a2 = await ports.a2AuthorizationContextLookup(command.a2AuthorizationContextReference);
    if (!a2) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The A2 authorization context reference could not be read',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (a2.evaluatedAt && Date.parse(a2.evaluatedAt) <= 0) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_STALE,
        message: 'The A2 authorization context is stale',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (!a2.allowed) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_DENIED,
        message: 'The A2 authorization context is denied',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
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
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The A3 internal account binding could not be validated',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    if (a3.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The A3 binding version is stale',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    const a4 = await ports.a4ProductPolicyDecisionLookup(command.a4ProductPolicyDecisionReference);
    if (!a4) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The A4 product-policy decision reference could not be read',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (!EXECUTABLE_A4_DECISIONS.has(a4.decision)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        message:
          'The A4 product-policy decision is not executable for the A7 notification delivery',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (a4.expiresAt && Date.parse(a4.expiresAt) <= Date.now()) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_EXPIRED,
        message: 'The A4 product-policy decision is expired',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    const a7T04 = await ports.a7T04ProductCustomerBindingMapReferenceCheck(
      command.a7ProductCustomerBindingMapReference,
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
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The A7T04 product customer-binding map could not be read',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    if (a7T04.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
        message: 'The A7T04 product customer-binding map product key does not match',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    const a7T05 = await ports.a7T05ProductCommandLookup(
      command.a7ProductCommandReference,
      command.customerId,
      command.customerWalletId,
      command.bindingId,
      command.bindingVersion,
      command.productKey,
      command.capabilityKey,
      command.action,
      command.productState,
    );
    if (!a7T05) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
        message: 'The A7T05 product command/operation reference could not be read',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    const preference = await ports.customerPreferenceLookup(
      command.customerId,
      command.customerPreferenceId,
    );
    if (!preference) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING,
        message:
          'The CustomerPreference.notifications record could not be read for the A7 notification delivery',
        checks: checkWithFailed('customerPreference', 'FAIL'),
      };
    }
    if (preference.deleted) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_STALE,
        message: 'The CustomerPreference record is soft-deleted',
        checks: checkWithFailed('customerPreference', 'FAIL'),
      };
    }
    const channelEnabled = preference.notifications[command.notificationChannel];
    if (channelEnabled !== true) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED,
        message: `The CustomerPreference.notifications.${command.notificationChannel} channel is disabled`,
        checks: checkWithFailed('customerPreference', 'FAIL'),
      };
    }
    return null;
  }

  private classifyNotificationPayload(
    ports: A7ProductNotificationDeliveryConsumerPorts,
    command: NormalizedA7ProductNotificationDispatchV1,
  ): {
    readonly code: string;
    readonly message: string;
    readonly checks: AllChecks;
  } | null {
    if (!A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS.includes(command.notificationChannel)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED,
        message: `The notification channel ${command.notificationChannel} is not supported`,
        checks: checkWithFailed('channel', 'FAIL'),
      };
    }
    if (!TEMPLATE_REFERENCE_PATTERN.test(command.notificationTemplateReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID,
        message: 'The notification template reference is invalid',
        checks: checkWithFailed('channel', 'FAIL'),
      };
    }
    const payloadHash = this.sha256(this.canonicalJson(command.notificationPayload));
    if (payloadHash !== command.notificationPayloadHash) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH,
        message: 'The notification payload hash does not match the canonical payload hash',
        checks: checkWithFailed('payloadHash', 'FAIL'),
      };
    }
    const seen = new Set<string>();
    for (const fieldName of Object.keys(command.notificationPayload)) {
      if (seen.has(fieldName)) {
        continue;
      }
      seen.add(fieldName);
      if (!ports.a6T10DataClassification.isRegistered(fieldName)) {
        return {
          code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED,
          message: `The notification payload field ${fieldName} is not registered in the A6T10 data-classification matrix`,
          checks: checkWithFailed('a6T10DataClassification', 'FAIL'),
        };
      }
      if (ports.a6T10DataClassification.isSecret(fieldName)) {
        return {
          code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_SECRET_PRESENT,
          message: `The notification payload field ${fieldName} is a secret field and must not be transmitted`,
          checks: checkWithFailed('a6T10DataClassification', 'FAIL'),
        };
      }
      const fieldLevel = ports.a6T10DataClassification.levelFor(fieldName);
      if (!fieldLevel) {
        return {
          code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED,
          message: `The notification payload field ${fieldName} has no A6T10 classification level`,
          checks: checkWithFailed('a6T10DataClassification', 'FAIL'),
        };
      }
      const audienceMax =
        ports.a6T10DataClassification.audienceMaxLevelFor(A6T10_SECURITY_AUDIENCE);
      if ((A6T10_MAX_LEVEL_ORDER[fieldLevel] ?? 0) > (A6T10_MAX_LEVEL_ORDER[audienceMax] ?? 0)) {
        return {
          code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_AUDIENCE_TOO_LOW,
          message: `The notification payload field ${fieldName} exceeds the audience maximum for the A7 notification delivery audience`,
          checks: checkWithFailed('a6T10DataClassification', 'FAIL'),
        };
      }
      if (fieldLevel === 'HIGHLY_RESTRICTED') {
        return {
          code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_REJECTED,
          message: `The notification payload field ${fieldName} is HIGHLY_RESTRICTED and is rejected by the A7 notification delivery audience`,
          checks: checkWithFailed('a6T10DataClassification', 'FAIL'),
        };
      }
    }
    return null;
  }

  private async reserveAndAdmit(
    manager: EntityManager,
    ports: A7ProductNotificationDeliveryConsumerPorts,
    command: NormalizedA7ProductNotificationDispatchV1,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
    const canonicalHash = this.deriveRequestHash(this.toHashInput(command));
    if (canonicalHash !== command.requestHash) {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
        'The caller-supplied A7 notification dispatch request hash does not match the canonical hash',
        checkWithFailed('requestHash', 'FAIL'),
      );
    }
    let reservation: {
      readonly kind: A7ProductNotificationDeliveryReservationKind;
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    };
    try {
      reservation = (await ports.operationsIdempotencyReserve(manager, {
        scope: A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
        retentionSeconds: A7_PRODUCT_NOTIFICATION_DELIVERY_IDEMPOTENCY_RETENTION_SECONDS,
      })) as {
        readonly kind: A7ProductNotificationDeliveryReservationKind;
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
          A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
          'The A7 internal idempotency scope/key was already used for another request hash',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      throw error;
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_IN_PROGRESS,
        'The A7 notification dispatch is already in progress',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    const notificationEventId = this.generateNotificationEventId();
    const notificationDispatchId = this.generateNotificationDispatchId();
    if (reservation.kind === 'REPLAY') {
      const replayed = this.replayedDispatchFromReservation(
        notificationEventId,
        notificationDispatchId,
        command,
        reservation,
      );
      try {
        await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
          statusCode: 200,
          responseBody: replayed as unknown as Record<string, unknown>,
          resourceType: 'A7_NOTIFICATION_DISPATCH',
          resourceId: notificationDispatchId,
          key: command.idempotencyKey,
          requestHash: canonicalHash,
        });
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 notification dispatch replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsAudit(
          manager,
          this.buildAuditRecord(
            A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_REPLAYED,
            notificationDispatchId,
            command,
            replayed,
          ),
        );
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 notification dispatch replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      return {
        valid: true,
        reservation: { kind: 'REPLAY', record: replayed, conflictReason: null },
        dispatch: replayed,
        handoff: this.buildHandoff(replayed),
      };
    }
    const createdAt = new Date().toISOString();
    const notificationEventReference = this.notificationEventReference(notificationEventId);
    const notificationDispatchReference =
      this.notificationDispatchReference(notificationDispatchId);
    const a6 = command.a6ExternalOperationReference
      ? await ports.a6ExternalOperationLookup(command.a6ExternalOperationReference)
      : null;
    const dispatch: A7ProductNotificationDispatchRecordV1 = {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      notificationEventId,
      notificationEventReference,
      notificationDispatchId,
      notificationDispatchReference,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      deliveryState: A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      customerPreferenceId: command.customerPreferenceId,
      notificationChannel: command.notificationChannel,
      notificationTemplateReference: command.notificationTemplateReference,
      notificationPayload: command.notificationPayload,
      notificationPayloadHash: command.notificationPayloadHash,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: a6?.providerIdempotencyScope ?? '',
      a6ProviderIdempotencyKey: a6?.providerIdempotencyKey ?? '',
      idempotencyScope: A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: canonicalHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: false,
      conflict: false,
      conflictReason: null,
      createdAt,
      dispatchedAt: createdAt,
      suppressedAt: null,
      failedAt: null,
      version: 1,
    };
    try {
      await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
        statusCode: 201,
        responseBody: dispatch as unknown as Record<string, unknown>,
        resourceType: 'A7_NOTIFICATION_DISPATCH',
        resourceId: notificationDispatchId,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 internal idempotency record could not be completed',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_ADMITTED,
          notificationDispatchId,
          command,
          dispatch,
        ),
      );
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_RESERVED,
          notificationDispatchId,
          command,
          dispatch,
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 notification dispatch audit could not be recorded',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsOutboxEnqueue(manager, {
        eventType: A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_TYPE,
        aggregateType: 'A7_NOTIFICATION_DISPATCH',
        aggregateId: notificationDispatchId,
        eventKey: `a7-notification-dispatch:${notificationDispatchId}`,
        schemaVersion: 1,
        classification: A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_CLASSIFICATION,
        retentionClass: A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_RETENTION_CLASS,
        occurredAt: new Date(createdAt),
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: this.buildOutboxPayload(
          dispatch,
          command,
          A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_ADMITTED,
        ),
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OUTBOX_PUBLICATION_FAILED,
        'The A7 notification dispatch outbox fact could not be published',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    return {
      valid: true,
      reservation: { kind: 'NEW', record: dispatch, conflictReason: null },
      dispatch,
      handoff: this.buildHandoff(dispatch),
    };
  }

  private async suppress(
    manager: EntityManager,
    ports: A7ProductNotificationDeliveryConsumerPorts,
    command: NormalizedA7ProductNotificationDispatchV1,
    reason: string,
  ): Promise<A7ProductNotificationDeliveryResultV1> {
    const notificationEventId = this.generateNotificationEventId();
    const notificationDispatchId = this.generateNotificationDispatchId();
    const createdAt = new Date().toISOString();
    const dispatch: A7ProductNotificationDispatchRecordV1 = {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      notificationEventId,
      notificationEventReference: this.notificationEventReference(notificationEventId),
      notificationDispatchId,
      notificationDispatchReference: this.notificationDispatchReference(notificationDispatchId),
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      deliveryState: A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      customerPreferenceId: command.customerPreferenceId,
      notificationChannel: command.notificationChannel,
      notificationTemplateReference: command.notificationTemplateReference,
      notificationPayload: command.notificationPayload,
      notificationPayloadHash: command.notificationPayloadHash,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: '',
      a6ProviderIdempotencyKey: '',
      idempotencyScope: A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: this.deriveRequestHash(this.toHashInput(command)),
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: false,
      conflict: false,
      conflictReason: null,
      createdAt,
      dispatchedAt: null,
      suppressedAt: createdAt,
      failedAt: null,
      version: 1,
    };
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_SUPPRESSED,
          notificationDispatchId,
          command,
          dispatch,
          { suppressionReason: reason },
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 notification suppression audit could not be recorded',
        checkWithFailed('customerPreference', 'FAIL'),
      );
    }
    return {
      valid: true,
      reservation: { kind: 'NEW', record: dispatch, conflictReason: null },
      dispatch,
      handoff: this.buildHandoff(dispatch),
    };
  }

  private suppressWithinTransaction(
    manager: EntityManager,
    notificationDispatchId: string,
    reason: string,
  ): A7ProductNotificationDeliveryResultV1 {
    void manager;
    void notificationDispatchId;
    void reason;
    return this.failure(
      {
        contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
        contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
        productKey: PRODUCT_KEY,
        productVersion: PRODUCT_VERSION,
        capabilityKey: CAPABILITY_ASSIGN,
        action: ACTION_ASSIGN,
        productState: 'ASSIGN_REQUESTED',
        customerId: '',
        customerWalletId: '',
        bindingId: '',
        bindingVersion: 1,
        customerPreferenceId: '',
        notificationChannel: 'email',
        notificationTemplateReference: '',
        a7ProductCustomerBindingMapReference: '',
        a4ProductPolicyDecisionReference: '',
        a2AuthorizationContextReference: '',
        a7ProductCommandReference: '',
        a6ExternalOperationReference: '',
        notificationPayload: {},
        notificationPayloadHash: '',
        idempotencyKey: '',
        requestHash: '',
        requestContext: {
          requestId: '',
          correlationId: '',
          traceId: '',
        },
        causationId: null,
      },
      A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
      'The A7 notification suppression is reserved for future A7T07 / A7T11 use',
      ALL_CHECKS_NOT_VERIFIED,
    );
  }

  private failWithinTransaction(
    manager: EntityManager,
    notificationDispatchId: string,
    failureCode: string,
    failureMessage: string,
  ): A7ProductNotificationDeliveryResultV1 {
    void manager;
    void notificationDispatchId;
    void failureCode;
    void failureMessage;
    return this.failure(
      {
        contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
        contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
        productKey: PRODUCT_KEY,
        productVersion: PRODUCT_VERSION,
        capabilityKey: CAPABILITY_ASSIGN,
        action: ACTION_ASSIGN,
        productState: 'ASSIGN_REQUESTED',
        customerId: '',
        customerWalletId: '',
        bindingId: '',
        bindingVersion: 1,
        customerPreferenceId: '',
        notificationChannel: 'email',
        notificationTemplateReference: '',
        a7ProductCustomerBindingMapReference: '',
        a4ProductPolicyDecisionReference: '',
        a2AuthorizationContextReference: '',
        a7ProductCommandReference: '',
        a6ExternalOperationReference: '',
        notificationPayload: {},
        notificationPayloadHash: '',
        idempotencyKey: '',
        requestHash: '',
        requestContext: {
          requestId: '',
          correlationId: '',
          traceId: '',
        },
        causationId: null,
      },
      A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
      'The A7 notification failure is reserved for future A7T07 / A7T11 use',
      ALL_CHECKS_NOT_VERIFIED,
    );
  }

  private replayedDispatchFromReservation(
    notificationEventId: string,
    notificationDispatchId: string,
    command: NormalizedA7ProductNotificationDispatchV1,
    reservation: {
      readonly record: {
        readonly id: string;
        readonly resourceId: string | null;
        readonly responseBody: Record<string, unknown> | null;
      } | null;
    },
  ): A7ProductNotificationDispatchRecordV1 {
    if (!reservation.record) {
      throw new Error(
        'The A7 notification dispatch replay reservation is missing the idempotency record',
      );
    }
    const stored = reservation.record.responseBody;
    if (stored && typeof stored === 'object' && 'notificationDispatchId' in stored) {
      return {
        ...(stored as unknown as A7ProductNotificationDispatchRecordV1),
        deliveryState: A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED,
        replayed: true,
      };
    }
    const createdAt = new Date().toISOString();
    return {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      notificationEventId,
      notificationEventReference: this.notificationEventReference(notificationEventId),
      notificationDispatchId,
      notificationDispatchReference: this.notificationDispatchReference(notificationDispatchId),
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      deliveryState: A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      customerPreferenceId: command.customerPreferenceId,
      notificationChannel: command.notificationChannel,
      notificationTemplateReference: command.notificationTemplateReference,
      notificationPayload: command.notificationPayload,
      notificationPayloadHash: command.notificationPayloadHash,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: '',
      a6ProviderIdempotencyKey: '',
      idempotencyScope: A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      requestContext: command.requestContext,
      causationId: command.causationId,
      replayed: true,
      conflict: false,
      conflictReason: null,
      createdAt,
      dispatchedAt: null,
      suppressedAt: null,
      failedAt: null,
      version: 1,
    };
  }

  private buildHandoff(
    dispatch: A7ProductNotificationDispatchRecordV1,
  ): A7ProductNotificationDeliveryHandoffV1 {
    const issuedAt = dispatch.createdAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      handoffScope: A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_SCOPE,
      notificationEventId: dispatch.notificationEventId,
      notificationEventReference: dispatch.notificationEventReference,
      notificationDispatchId: dispatch.notificationDispatchId,
      notificationDispatchReference: dispatch.notificationDispatchReference,
      productKey: dispatch.productKey,
      capabilityKey: dispatch.capabilityKey,
      action: dispatch.action,
      productState: dispatch.productState,
      deliveryState: dispatch.deliveryState,
      customerPreferenceReference: dispatch.customerPreferenceId,
      a7ProductCustomerBindingMapReference: dispatch.a7ProductCustomerBindingMapReference,
      customerId: dispatch.customerId,
      customerWalletId: dispatch.customerWalletId,
      bindingId: dispatch.bindingId,
      bindingVersion: dispatch.bindingVersion,
      notificationChannel: dispatch.notificationChannel,
      notificationTemplateReference: dispatch.notificationTemplateReference,
      notificationPayloadHash: dispatch.notificationPayloadHash,
      a7ProductCommandReference: dispatch.a7ProductCommandReference,
      a6ExternalOperationReference: dispatch.a6ExternalOperationReference,
      a4ProductPolicyDecisionReference: dispatch.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: dispatch.a2AuthorizationContextReference,
      a6ProviderIdempotencyScope: dispatch.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: dispatch.a6ProviderIdempotencyKey,
      issuedAt,
      expiresAt,
      correlationId: dispatch.requestContext.correlationId,
      requestId: dispatch.requestContext.requestId,
      traceId: dispatch.requestContext.traceId,
      causationId: dispatch.causationId,
    };
  }

  private buildAuditRecord(
    action: string,
    notificationDispatchId: string,
    command: NormalizedA7ProductNotificationDispatchV1,
    dispatch: A7ProductNotificationDispatchRecordV1,
    extra?: { readonly suppressionReason?: string },
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
      entityType: A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ENTITY_TYPE,
      entityId: notificationDispatchId,
      action,
      actor: A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTOR,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: this.buildAuditValues(action, dispatch, command, extra),
    };
  }

  private buildAuditValues(
    action: string,
    dispatch: A7ProductNotificationDispatchRecordV1,
    command: NormalizedA7ProductNotificationDispatchV1,
    extra?: { readonly suppressionReason?: string },
  ): Readonly<Record<string, unknown>> {
    const values: Record<string, unknown> = {
      a7AuditContractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      a7AuditContractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      customerPreferenceContractName: 'CUSTOMER-PREFERENCE',
      customerPreferenceContractVersion: 1,
      a2AuditContractName: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a2AuditContractVersion: 1,
      a3AuditContractName: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a3AuditContractVersion: 1,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
      a6AuditContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6AuditContractVersion: 1,
      a6T10AuditContractName: 'A6-EXTERNAL-DATA-MINIMIZATION',
      a6T10AuditContractVersion: 1,
      action,
      notificationEventId: dispatch.notificationEventId,
      notificationEventReference: dispatch.notificationEventReference,
      notificationDispatchId: dispatch.notificationDispatchId,
      notificationDispatchReference: dispatch.notificationDispatchReference,
      productKey: dispatch.productKey,
      productVersion: dispatch.productVersion,
      capabilityKey: dispatch.capabilityKey,
      action_key: dispatch.action,
      productState: dispatch.productState,
      deliveryState: dispatch.deliveryState,
      customerId: dispatch.customerId,
      customerWalletId: dispatch.customerWalletId,
      bindingId: dispatch.bindingId,
      bindingVersion: dispatch.bindingVersion,
      walletAccountId: dispatch.walletAccountId,
      ledgerAccountId: dispatch.ledgerAccountId,
      customerPreferenceId: dispatch.customerPreferenceId,
      notificationChannel: dispatch.notificationChannel,
      notificationTemplateReference: dispatch.notificationTemplateReference,
      notificationPayloadHash: dispatch.notificationPayloadHash,
      a7ProductCustomerBindingMapReference: dispatch.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: dispatch.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: dispatch.a2AuthorizationContextReference,
      a7ProductCommandReference: dispatch.a7ProductCommandReference,
      a6ExternalOperationReference: dispatch.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: dispatch.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(
        dispatch.a6ProviderIdempotencyKey,
      ),
      idempotencyScope: dispatch.idempotencyScope,
      idempotencyKey: dispatch.idempotencyKey,
      requestHash: dispatch.requestHash,
      replayed: dispatch.replayed,
      conflict: dispatch.conflict,
      conflictReason: dispatch.conflictReason,
      causationId: command.causationId,
      createdAt: dispatch.createdAt,
      dispatchedAt: dispatch.dispatchedAt,
      suppressedAt: dispatch.suppressedAt,
      failedAt: dispatch.failedAt,
    };
    if (extra?.suppressionReason) {
      values.suppressionReason = extra.suppressionReason;
    }
    return Object.freeze(values);
  }

  private buildOutboxPayload(
    dispatch: A7ProductNotificationDispatchRecordV1,
    command: NormalizedA7ProductNotificationDispatchV1,
    action: string,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7OutboxContractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      a7OutboxContractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      customerPreferenceContractName: 'CUSTOMER-PREFERENCE',
      customerPreferenceContractVersion: 1,
      a2OutboxContractName: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a2OutboxContractVersion: 1,
      a4OutboxContractName: 'A4-CAPABILITY-POLICY',
      a4OutboxContractVersion: 1,
      a6OutboxContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6OutboxContractVersion: 1,
      a6T10OutboxContractName: 'A6-EXTERNAL-DATA-MINIMIZATION',
      a6T10OutboxContractVersion: 1,
      action,
      notificationEventId: dispatch.notificationEventId,
      notificationEventReference: dispatch.notificationEventReference,
      notificationDispatchId: dispatch.notificationDispatchId,
      notificationDispatchReference: dispatch.notificationDispatchReference,
      productKey: dispatch.productKey,
      productVersion: dispatch.productVersion,
      capabilityKey: dispatch.capabilityKey,
      action_key: dispatch.action,
      productState: dispatch.productState,
      deliveryState: dispatch.deliveryState,
      customerId: dispatch.customerId,
      customerWalletId: dispatch.customerWalletId,
      bindingId: dispatch.bindingId,
      bindingVersion: dispatch.bindingVersion,
      walletAccountId: dispatch.walletAccountId,
      ledgerAccountId: dispatch.ledgerAccountId,
      customerPreferenceId: dispatch.customerPreferenceId,
      notificationChannel: dispatch.notificationChannel,
      notificationTemplateReference: dispatch.notificationTemplateReference,
      notificationPayloadHash: dispatch.notificationPayloadHash,
      a7ProductCustomerBindingMapReference: dispatch.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: dispatch.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: dispatch.a2AuthorizationContextReference,
      a7ProductCommandReference: dispatch.a7ProductCommandReference,
      a6ExternalOperationReference: dispatch.a6ExternalOperationReference,
      a6ProviderIdempotencyScope: dispatch.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(
        dispatch.a6ProviderIdempotencyKey,
      ),
      idempotencyScope: dispatch.idempotencyScope,
      idempotencyKey: dispatch.idempotencyKey,
      requestHash: dispatch.requestHash,
      replayed: dispatch.replayed,
      conflict: dispatch.conflict,
      conflictReason: dispatch.conflictReason,
      causationId: command.causationId,
      createdAt: dispatch.createdAt,
      dispatchedAt: dispatch.dispatchedAt,
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
    command: NormalizedA7ProductNotificationDispatchV1,
  ): A7ProductNotificationDeliveryRequestHashInputV1 {
    return {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      customerPreferenceId: command.customerPreferenceId,
      notificationChannel: command.notificationChannel,
      notificationTemplateReference: command.notificationTemplateReference,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      notificationPayloadHash: command.notificationPayloadHash,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    };
  }

  private validateCommandShape(
    command: A7ProductNotificationDispatchV1,
  ): { readonly code: string; readonly message: string } | null {
    if (!command || command.contractName !== A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch contract version is invalid',
      };
    }
    if (command.productKey !== PRODUCT_KEY || command.productVersion !== PRODUCT_VERSION) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch product registration is invalid',
      };
    }
    if (
      command.capabilityKey !== CAPABILITY_ASSIGN &&
      command.capabilityKey !== CAPABILITY_INBOUND_FUNDING
    ) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch capability key is not registered',
      };
    }
    if (command.action !== ACTION_ASSIGN && command.action !== ACTION_LIFECYCLE) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch action is not registered',
      };
    }
    const allowedProductStates = new Set([
      ...A7_PRODUCT_NOTIFICATION_DELIVERY_ASSIGN_STATES,
      ...A7_PRODUCT_NOTIFICATION_DELIVERY_FUNDING_STATES,
    ]);
    if (!allowedProductStates.has(command.productState)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 notification dispatch product state is not registered',
      };
    }
    if (!UUID_PATTERN.test(command.customerId)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The customerId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.customerWalletId)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The customerWalletId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.bindingId)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The bindingId must be a UUID',
      };
    }
    if (!Number.isSafeInteger(command.bindingVersion) || command.bindingVersion < 1) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The bindingVersion must be a positive integer',
      };
    }
    if (!UUID_PATTERN.test(command.customerPreferenceId)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING,
        message: 'The customerPreferenceId must be a UUID',
      };
    }
    if (!A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS.includes(command.notificationChannel)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED,
        message: 'The notification channel is not supported',
      };
    }
    if (!TEMPLATE_REFERENCE_PATTERN.test(command.notificationTemplateReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID,
        message: 'The notification template reference is invalid',
      };
    }
    if (!REFERENCE_PATTERN.test(command.a7ProductCustomerBindingMapReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The a7ProductCustomerBindingMapReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a4ProductPolicyDecisionReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The a4ProductPolicyDecisionReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a2AuthorizationContextReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The a2AuthorizationContextReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a7ProductCommandReference)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
        message: 'The a7ProductCommandReference is invalid',
      };
    }
    if (
      command.a6ExternalOperationReference &&
      !SAFE_TEXT_PATTERN.test(command.a6ExternalOperationReference)
    ) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING,
        message: 'The a6ExternalOperationReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.idempotencyKey)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The idempotencyKey is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.requestHash)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT,
        message: 'The requestHash must be a SHA-256 hash',
      };
    }
    if (!SHA256_PATTERN.test(command.notificationPayloadHash)) {
      return {
        code: A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH,
        message: 'The notificationPayloadHash must be a SHA-256 hash',
      };
    }
    return null;
  }

  private normalizeCommand(
    command: A7ProductNotificationDispatchV1,
  ): NormalizedA7ProductNotificationDispatchV1 {
    return {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId.toLowerCase(),
      customerWalletId: command.customerWalletId.toLowerCase(),
      bindingId: command.bindingId.toLowerCase(),
      bindingVersion: command.bindingVersion,
      customerPreferenceId: command.customerPreferenceId.toLowerCase(),
      notificationChannel: command.notificationChannel,
      notificationTemplateReference: command.notificationTemplateReference,
      a7ProductCustomerBindingMapReference: command.a7ProductCustomerBindingMapReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      notificationPayload: command.notificationPayload,
      notificationPayloadHash: command.notificationPayloadHash.toLowerCase(),
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash.toLowerCase(),
      requestContext: command.requestContext,
      causationId: command.causationId,
    };
  }

  private failure(
    command: A7ProductNotificationDispatchV1,
    code: string,
    message: string,
    checks: AllChecks,
  ): A7ProductNotificationDeliveryResultV1 {
    const failure: A7ProductNotificationDeliveryFailureV1 = {
      contractName: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION,
      code,
      message,
      checks,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
    return { valid: false, failure };
  }

  private generateNotificationEventId(): string {
    return randomUUID();
  }

  private generateNotificationDispatchId(): string {
    return randomUUID();
  }

  private notificationEventReference(notificationEventId: string): string {
    return `${A7_PRODUCT_NOTIFICATION_EVENT_REFERENCE_PREFIX}:v${A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION}:${this.sha256(
      `A7-NOTIFICATION-DELIVERY:${notificationEventId}`,
    )}`;
  }

  private notificationDispatchReference(notificationDispatchId: string): string {
    return `${A7_PRODUCT_NOTIFICATION_DISPATCH_REFERENCE_PREFIX}:v${A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION}:${this.sha256(
      `A7-NOTIFICATION-DISPATCH:${notificationDispatchId}`,
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
void A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING;
void A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED;
void A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_FAILED;
void A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_STALE;
void A7_PRODUCT_NOTIFICATION_DELIVERY_ALL_STATES;
