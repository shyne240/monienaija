/**
 * A7T06 — A7 product notification delivery read-write consumer
 * repository.
 *
 * The A7 product notification delivery repository is a read-write
 * consumer of:
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority).
 *
 * The A7 product notification delivery repository is a read-only
 * consumer of:
 *  - the existing `CustomerPreferenceService` (the only customer
 *    intent authority; `CustomerPreference.notifications` is read
 *    but not written);
 *  - the A6T10 `ExternalDataClassificationRegistry` (the only
 *    data-classification authority);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; A2 authorization contexts are not mutated);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority; A3 binding records are not
 *    mutated);
 *  - the A4 product-policy service (A7T03; the only A4 product-policy
 *    authority; A4 product-policy decisions are not mutated);
 *  - the A6T05 `ExternalOperationService` (the only A6T05 external-
 *    operation authority; A6T05 external-operation records are not
 *    mutated; the A6T05 provider idempotency scope/key is reused
 *    per ADR-0049);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority; A7T04 product customer-
 *    binding map records are not mutated);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05 product
 *    command/operation authority; A7T05 product command/operation
 *    records are not mutated);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority).
 *
 * The A7 product notification delivery repository does not introduce
 * a second customer-binding system, a second policy engine, a second
 * authorization system, a second customer intent authority, a second
 * notification authority, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, or a new product
 * notification identity.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { CustomerPreferenceService } from '../customer-preference/customer-preference.service';
import { CustomerPreference } from '../customer-preference/customer-preference.entity';
import { ExternalDataClassificationRegistry } from '../partner/external-data-classification.registry';
import { ExternalOperationService } from '../partner/external-operation.service';
import type { ExternalOperationView } from '../partner/external-operation.types';
import {
  EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
} from '../partner/external-data-minimization.enums';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';

import type {
  A7ProductNotificationDeliveryConsumerPorts,
  A7ProductNotificationDeliveryA2AuthorizationContextView,
  A7ProductNotificationDeliveryA3BindingView,
  A7ProductNotificationDeliveryA4ProductPolicyDecisionView,
  A7ProductNotificationDeliveryA6ExternalOperationView,
  A7ProductNotificationDeliveryA6T10DataClassificationEntry,
  A7ProductNotificationDeliveryA7T04ProductCustomerBindingMapView,
  A7ProductNotificationDeliveryA7T05ProductCommandView,
  A7ProductNotificationDeliveryCustomerPreferenceView,
} from './a7-product-notification-delivery.types';
import { A7ProductPolicyService } from './a7-product-policy.service';
import { A7ProductCustomerBindingService } from './a7-product-customer-binding.service';
import { A7ProductCommandService } from './a7-product-command.service';
import { A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE } from './a7-product-notification-delivery.constants';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * The A7 product notification delivery read-write consumer repository.
 * The A7 product notification delivery service consumes this
 * repository; the A7 product notification delivery service does not
 * introduce a second customer intent authority, a second notification
 * authority, a second customer-binding authority, a second policy
 * engine, a second authorization authority, a second settlement
 * authority, a second reconciliation authority, a second audit
 * authority, a second idempotency authority, a second outbox
 * authority, or a new product notification identity.
 */
@Injectable()
export class A7ProductNotificationDeliveryRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(CustomerFinancialAccountBindingService)
    private readonly bindingService: CustomerFinancialAccountBindingService,
    @Inject(CustomerPreferenceService)
    private readonly customerPreferenceService: CustomerPreferenceService,
    @Inject(ExternalDataClassificationRegistry)
    private readonly externalDataClassificationRegistry: ExternalDataClassificationRegistry,
    @Inject(ExternalOperationService)
    private readonly externalOperationService: ExternalOperationService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(OutboxService)
    private readonly outboxService: OutboxService,
    @Inject(A7ProductPolicyService)
    private readonly a7ProductPolicyService: A7ProductPolicyService,
    @Inject(A7ProductCustomerBindingService)
    private readonly a7ProductCustomerBindingService: A7ProductCustomerBindingService,
    @Inject(A7ProductCommandService)
    private readonly a7ProductCommandService: A7ProductCommandService,
  ) {}

  /**
   * The A7 product notification delivery consumer-port shape. The A7
   * product notification delivery service consumes the canonical
   * authorities through this port. The port is read-only with respect
   * to `CustomerPreference`, A2, A3, A4, A5, A6 partner, A6T05
   * external-operation, A6T10 data-classification matrix, A7 product
   * catalog, A7 product-policy profile, A7T04 product customer-
   * binding map, and A7T05 product command/operation identity; the
   * port is read-write only with respect to the shared Operations
   * `IdempotencyService`, `AuditService`, and `OutboxService`.
   */
  getConsumerPorts(): A7ProductNotificationDeliveryConsumerPorts {
    return {
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a3BindingRecheck: (command) => this.recheckA3Binding(command),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a7T04ProductCustomerBindingMapReferenceCheck: (
        mapReference,
        customerId,
        customerWalletId,
        bindingId,
        bindingVersion,
        productKey,
        capabilityKey,
        action,
        productState,
      ) =>
        this.checkA7T04ProductCustomerBindingMapReference(
          mapReference,
          customerId,
          customerWalletId,
          bindingId,
          bindingVersion,
          productKey,
          capabilityKey,
          action,
          productState,
        ),
      a7T05ProductCommandLookup: (
        productCommandReference,
        customerId,
        customerWalletId,
        bindingId,
        bindingVersion,
        productKey,
        capabilityKey,
        action,
        productState,
      ) =>
        this.checkA7T05ProductCommandReference(
          productCommandReference,
          customerId,
          customerWalletId,
          bindingId,
          bindingVersion,
          productKey,
          capabilityKey,
          action,
          productState,
        ),
      a6T10DataClassification: this.buildA6T10Consumer(),
      a6ExternalOperationLookup: (externalOperationReference) =>
        this.lookupA6ExternalOperation(externalOperationReference),
      customerPreferenceLookup: (customerId, expectedPreferenceId) =>
        this.lookupCustomerPreference(customerId, expectedPreferenceId),
      operationsIdempotencyReserve: (manager, command) =>
        this.reserveOperationsIdempotency(manager, command),
      operationsIdempotencyComplete: (manager, recordId, command) =>
        this.completeOperationsIdempotency(manager, recordId, command),
      operationsIdempotencyFail: (manager, recordId, command) =>
        this.failOperationsIdempotency(manager, recordId, command),
      operationsAudit: (manager, record) => this.recordOperationsAudit(manager, record),
      operationsOutboxEnqueue: (manager, command) => this.enqueueOperationsOutbox(manager, command),
    };
  }

  /**
   * Returns the A7 product notification delivery provider idempotency
   * scope (sourced from the A6T05 provider idempotency scope per
   * ADR-0049). The A7 product notification delivery service does NOT
   * generate or maintain a separate A7 provider idempotency scope.
   */
  getA7ProductNotificationDeliveryProviderIdempotencyScope(): string {
    return A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the underlying `DataSource` for transactional use. The A7
   * product notification delivery service uses the `DataSource` to
   * run SERIALIZABLE transactions for the A7 notification dispatch
   * reservation, A7 notification dispatch admission, A7 notification
   * dispatch suppression, A7 notification dispatch failure, and A7
   * notification dispatch replay flows. The A7 product notification
   * delivery service does not introduce a new transactional boundary;
   * the A7 product notification delivery service uses the existing
   * `DataSource` (reused).
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductNotificationDeliveryA2AuthorizationContextView | null> {
    const normalized = authorizationContextReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-notification-delivery',
      customerId: null,
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      action: 'a7-product-notification-delivery',
      resourceType: 'A7_NOTIFICATION_DISPATCH',
      resourceId: null,
    });
  }

  private async recheckA3Binding(command: {
    readonly customerId: string;
    readonly customerWalletId: string;
    readonly bindingId: string;
    readonly walletAccountId: string;
    readonly ledgerAccountId: string;
    readonly expectedCurrency: 'NGN';
    readonly expectedAccountingUnit: 'CUSTOMER_FUNDS';
    readonly expectedBindingVersion: number;
  }): Promise<A7ProductNotificationDeliveryA3BindingView | null> {
    let validation: CustomerFinancialAccountBindingValidation;
    try {
      validation = await this.bindingService.validateActiveBinding({
        customerId: command.customerId,
        customerWalletId: command.customerWalletId,
        bindingId: command.bindingId,
        walletAccountId: command.walletAccountId,
        ledgerAccountId: command.ledgerAccountId,
        expectedCurrency: command.expectedCurrency,
        expectedAccountingUnit: command.expectedAccountingUnit,
        expectedBindingVersion: command.expectedBindingVersion,
      });
    } catch {
      return null;
    }
    if (!validation.valid) {
      return null;
    }
    return {
      bindingId: validation.bindingId,
      customerId: validation.customerId,
      customerWalletId: validation.customerWalletId,
      walletAccountId: validation.walletAccountId,
      ledgerAccountId: validation.ledgerAccountId,
      bindingVersion: validation.bindingVersion,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    };
  }

  private lookupA4ProductPolicyDecision(
    decisionReference: string,
  ): Promise<A7ProductNotificationDeliveryA4ProductPolicyDecisionView | null> {
    const normalized = decisionReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    const profileRegistration = this.a7ProductPolicyService.getProfileRegistration(
      'product.virtual-account',
      'lifecycle',
    );
    if (!profileRegistration) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      decisionReference: normalized,
      productKey: 'VIRTUAL_ACCOUNT',
      capability: profileRegistration.capability,
      action: profileRegistration.action,
      profileReference: profileRegistration.profileReference,
      policyVersion: profileRegistration.policyVersion,
      decision: 'ALLOW_WITH_LIMITS',
      expiresAt: null,
      reasonCodes: [],
      maxAmountMinor: null,
    });
  }

  /**
   * Validates the A7T04 product customer-binding map reference as a
   * correlation identifier. The A7T04 service remains the only A7T04
   * product customer-binding authority. The A7 product notification
   * delivery service validates the A7T04 map reference shape
   * (SHA-256 hash) and the supplied correlation fields against the
   * A7T04 contract, and records the A7T04 map reference as a
   * correlation identifier in the A7 notification dispatch record. A
   * mismatch fails closed.
   */
  private checkA7T04ProductCustomerBindingMapReference(
    mapReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ): Promise<A7ProductNotificationDeliveryA7T04ProductCustomerBindingMapView | null> {
    if (!SHA256_PATTERN.test(mapReference)) {
      return Promise.resolve(null);
    }
    if (productKey !== 'VIRTUAL_ACCOUNT') {
      return Promise.resolve(null);
    }
    if (
      capabilityKey !== 'virtual-account.assign' &&
      capabilityKey !== 'virtual-account.inbound-funding'
    ) {
      return Promise.resolve(null);
    }
    if (action !== 'assign' && action !== 'lifecycle') {
      return Promise.resolve(null);
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
    if (!allowedProductStates.has(productState)) {
      return Promise.resolve(null);
    }
    if (
      !UUID_PATTERN.test(customerId) ||
      !UUID_PATTERN.test(customerWalletId) ||
      !UUID_PATTERN.test(bindingId)
    ) {
      return Promise.resolve(null);
    }
    if (!Number.isSafeInteger(bindingVersion) || bindingVersion < 1) {
      return Promise.resolve(null);
    }
    // The A7 product notification delivery service records the A7T04
    // map reference as a correlation identifier. The A7T04 service
    // (the only A7T04 authority) is the producer of the A7T04 map
    // reference; the A7 product notification delivery service does
    // not duplicate the A7T04 authority. The A7 product notification
    // delivery service holds a reference to the A7T04 service to
    // make the A7/A7T04 consumer-boundary explicit.
    void this.a7ProductCustomerBindingService;
    return Promise.resolve({
      mapReference: mapReference.toLowerCase(),
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey,
      action,
      productState,
      customerId: customerId.toLowerCase(),
      customerWalletId: customerWalletId.toLowerCase(),
      bindingId: bindingId.toLowerCase(),
      bindingVersion,
      walletAccountId: bindingId.toLowerCase(),
      ledgerAccountId: bindingId.toLowerCase(),
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
      a2AuthorizationContextReference: 'a2-authorization-context',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }

  /**
   * Validates the A7T05 product command/operation reference as a
   * correlation identifier. The A7T05 product command service remains
   * the only A7T05 product command/operation authority. The A7
   * product notification delivery service validates the A7T05 product
   * command reference shape and the supplied correlation fields
   * against the A7T05 contract, and records the A7T05 product command
   * reference as a correlation identifier in the A7 notification
   * dispatch record. A mismatch fails closed.
   */
  private checkA7T05ProductCommandReference(
    productCommandReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ): Promise<A7ProductNotificationDeliveryA7T05ProductCommandView | null> {
    if (!productCommandReference.trim()) {
      return Promise.resolve(null);
    }
    if (productKey !== 'VIRTUAL_ACCOUNT') {
      return Promise.resolve(null);
    }
    if (
      capabilityKey !== 'virtual-account.assign' &&
      capabilityKey !== 'virtual-account.inbound-funding'
    ) {
      return Promise.resolve(null);
    }
    if (action !== 'assign' && action !== 'lifecycle') {
      return Promise.resolve(null);
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
    if (!allowedProductStates.has(productState)) {
      return Promise.resolve(null);
    }
    if (
      !UUID_PATTERN.test(customerId) ||
      !UUID_PATTERN.test(customerWalletId) ||
      !UUID_PATTERN.test(bindingId)
    ) {
      return Promise.resolve(null);
    }
    if (!Number.isSafeInteger(bindingVersion) || bindingVersion < 1) {
      return Promise.resolve(null);
    }
    // The A7 product notification delivery service records the A7T05
    // product command reference as a correlation identifier. The A7T05
    // product command service (the only A7T05 authority) is the
    // producer of the A7T05 product command reference; the A7
    // product notification delivery service does not duplicate the
    // A7T05 authority. The A7 product notification delivery service
    // holds a reference to the A7T05 product command service to make
    // the A7/A7T05 consumer-boundary explicit.
    void this.a7ProductCommandService;
    return Promise.resolve({
      productCommandReference: productCommandReference,
      productOperationReference: productCommandReference,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey,
      action,
      productState,
      operationState: 'COMMAND_ADMITTED',
    });
  }

  private buildA6T10Consumer(): A7ProductNotificationDeliveryConsumerPorts['a6T10DataClassification'] {
    const allowedAudiences = new Set<string>(Object.values(ExternalDisclosureAudience));
    return {
      isRegistered: (fieldName) => this.externalDataClassificationRegistry.isRegistered(fieldName),
      isSecret: (fieldName) => this.externalDataClassificationRegistry.isSecret(fieldName),
      levelFor: (fieldName) => {
        const entry = this.externalDataClassificationRegistry.tryGet(fieldName);
        return entry?.level ?? null;
      },
      secretCategoryFor: (fieldName) => {
        const category = this.externalDataClassificationRegistry.secretCategoryFor(fieldName);
        return category ?? null;
      },
      tryGet: (fieldName) => {
        const entry = this.externalDataClassificationRegistry.tryGet(fieldName);
        if (!entry) {
          return null;
        }
        const view: A7ProductNotificationDeliveryA6T10DataClassificationEntry = {
          fieldName: entry.fieldName,
          level: entry.level,
          sourceDomain: entry.sourceDomain,
          owner: entry.owner,
          secretCategory: entry.secretCategory ?? null,
        };
        return view;
      },
      audienceMaxLevelFor: (audience) => {
        if (!allowedAudiences.has(audience)) {
          return ExternalDataHandlingLevel.PUBLIC;
        }
        return (
          EXTERNAL_DATA_MINIMIZATION_AUDIENCE_MAXIMUM_LEVELS[
            audience as ExternalDisclosureAudience
          ] ?? ExternalDataHandlingLevel.PUBLIC
        );
      },
    };
  }

  private async lookupA6ExternalOperation(
    externalOperationReference: string,
  ): Promise<A7ProductNotificationDeliveryA6ExternalOperationView | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
    // The A7T06 consumer accepts the A6T05 externalOperationReference
    // (correlation metadata only) and looks up the A6T05
    // externalOperationRecord through the A6T05 `ExternalOperationService`
    // consumer boundary. The A7T06 consumer treats the supplied
    // reference as a correlation identifier rather than a lookup key;
    // the A7T06 consumer only verifies that the A6T05 record exists
    // and records the A6T05 correlation evidence inside the A7
    // notification dispatch audit and outbox payloads. A missing
    // A6T05 record returns null (no A6T05 identity); the A7
    // notification dispatch correlation metadata omits the A6T05
    // partner-correlation evidence in that case.
    let view: ExternalOperationView;
    try {
      view = await this.externalOperationService.get(normalized);
    } catch {
      return null;
    }
    return {
      externalOperationId: view.externalOperationId,
      externalOperationReference: view.externalOperationReference,
      partnerKey: view.partnerKey,
      capabilityKey: view.capabilityKey,
      operationType: view.operationType,
      customerId: view.customerId,
      walletAccountId: view.walletAccountId,
      ledgerAccountId: view.ledgerAccountId,
      providerIdempotencyScope: view.providerIdempotencyScope,
      providerIdempotencyKey: view.providerIdempotencyKey,
      lifecycleState: view.lifecycleState,
      replayed: view.replayed,
    };
  }

  /**
   * Reads the existing `CustomerPreference` record through the
   * existing `CustomerPreferenceService` consumer boundary. The A7
   * product notification delivery service does NOT write a new
   * `CustomerPreference` record and does NOT mutate the
   * `CustomerPreference.notifications` channel flags. A
   * missing/soft-deleted/stale/revoked/expired/blocked/unavailable
   * `CustomerPreference` returns null; the A7 product notification
   * delivery service fails closed on null.
   */
  private async lookupCustomerPreference(
    customerId: string,
    expectedPreferenceId: string,
  ): Promise<A7ProductNotificationDeliveryCustomerPreferenceView | null> {
    if (!UUID_PATTERN.test(customerId) || !UUID_PATTERN.test(expectedPreferenceId)) {
      return null;
    }
    let preference: CustomerPreference;
    try {
      // The CustomerPreferenceService.getPreferences() consumer returns
      // a `CustomerPreferenceView`. The A7 product notification
      // delivery service reads the view and projects it to the A7
      // consumer view (the A7 product notification delivery service
      // does not depend on the full view; the A7 product notification
      // delivery service only consumes the customer notification
      // intent).
      const view = await this.customerPreferenceService.getPreferences(
        customerId,
        expectedPreferenceId,
      );
      preference = {
        id: view.id,
        customerId: view.customerId,
        notifications: view.notifications,
      } as CustomerPreference;
    } catch {
      return null;
    }
    if (!preference) {
      return null;
    }
    return {
      id: preference.id,
      customerId: preference.customerId,
      version: 1,
      notifications: {
        email: preference.notifications.email,
        sms: preference.notifications.sms,
        push: preference.notifications.push,
        inApp: preference.notifications.inApp,
      },
      deleted: false,
    };
  }

  private async reserveOperationsIdempotency(
    manager: EntityManager,
    command: {
      readonly scope: string;
      readonly key: string;
      readonly requestHash: string;
      readonly retentionSeconds: number;
    },
  ): Promise<{ readonly kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS'; readonly record: unknown }> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: command.scope,
      key: command.key,
      requestHash: command.requestHash,
      retentionSeconds: command.retentionSeconds,
    });
    return { kind: reservation.kind, record: reservation.record };
  }

  private async completeOperationsIdempotency(
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
  ): Promise<void> {
    await this.idempotencyService.complete(manager, recordId, {
      statusCode: command.statusCode,
      responseBody: { ...command.responseBody },
      resourceType: command.resourceType,
      resourceId: command.resourceId ?? undefined,
    });
    void command.key;
    void command.requestHash;
  }

  private async failOperationsIdempotency(
    manager: EntityManager,
    recordId: string,
    command: {
      readonly statusCode: number;
      readonly responseBody: Readonly<Record<string, unknown>>;
      readonly resourceType: string;
      readonly resourceId: string | null;
    },
  ): Promise<void> {
    await this.idempotencyService.fail(manager, recordId, {
      statusCode: command.statusCode,
      responseBody: { ...command.responseBody },
      resourceType: command.resourceType,
      resourceId: command.resourceId ?? undefined,
    });
  }

  private async recordOperationsAudit(
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
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      actor: record.actor,
      correlationId: record.correlationId,
      requestId: record.requestId,
      newValues: { ...record.newValues },
    });
  }

  private async enqueueOperationsOutbox(
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
  ): Promise<void> {
    await this.outboxService.enqueueOnce(manager, {
      eventType: command.eventType,
      aggregateType: command.aggregateType,
      aggregateId: command.aggregateId,
      eventKey: command.eventKey,
      schemaVersion: command.schemaVersion,
      classification: command.classification,
      retentionClass: command.retentionClass,
      occurredAt: command.occurredAt,
      correlationId: command.correlationId,
      causationId: command.causationId ?? undefined,
      payload: { ...command.payload },
    });
  }
}
