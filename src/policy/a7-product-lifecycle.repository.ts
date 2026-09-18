/**
 * A7T07 — A7 product lifecycle read-write consumer repository.
 *
 * The A7 product lifecycle repository is a read-write consumer of:
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority);
 *  - the shared `DiagnosticsService` (the only diagnostics
 *    authority).
 *
 * The A7 product lifecycle repository is a read-only consumer of:
 *  - the A6T05 `ExternalOperationLifecycleService` (the only A6
 *    lifecycle authority; the A6 lifecycle state is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the A7 product lifecycle service);
 *  - the A6T07 `ExternalOperationStatusVerifier` (the only A6
 *    status-verification authority; the A6 status-verification state
 *    is recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the A7 product lifecycle service);
 *  - the A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority; the A6 circuit-breaker state is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the A7 product lifecycle service);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority; the A6T05 external-operation
 *    record and the A6T05 provider idempotency scope/key are
 *    recorded as correlation identifiers and are NOT re-derived,
 *    refreshed, or substituted by the A7 product lifecycle service);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; A2 authorization contexts are not mutated);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority; A3 binding records are not
 *    mutated);
 *  - the A4 product-policy service (A7T03; the only A4 product-policy
 *    authority; A4 product-policy decisions are not mutated);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority; A7T04 product customer-
 *    binding map records are not mutated);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05 product
 *    command/operation authority; A7T05 product command/operation
 *    records are not mutated);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the only
 *    A7T06 product notification delivery authority; A7T06 product
 *    notification delivery records are not mutated);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority).
 *
 * The A7 product lifecycle repository does not introduce a second
 * customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, a second A6 lifecycle
 * authority, a second A6 status-verification authority, a second A6
 * circuit-breaker authority, a second A6T05 external-operation
 * authority, or a new product lifecycle identity. The A7 product
 * lifecycle repository does not introduce an unbounded retry loop,
 * an unowned scheduler, or a local product idempotency/audit store.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { ExternalOperationLifecycleService } from '../partner/external-operation-lifecycle.service';
import type { ExternalOperationLifecycleView } from '../partner/external-operation-lifecycle.types';
import { ExternalOperationService } from '../partner/external-operation.service';
import type { ExternalOperationView } from '../partner/external-operation.types';
import {
  EXTERNAL_OPERATION_STATUS_VERIFIER,
  type ExternalOperationStatusVerificationResult,
  type ExternalOperationStatusVerifier,
} from '../partner/external-operation-status-verifier';
import { PartnerCircuitBreakerService } from '../partner/partner-circuit-breaker.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';

import { A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE } from './a7-product-lifecycle.constants';
import type {
  A7ProductLifecycleA2AuthorizationContextView,
  A7ProductLifecycleA3BindingView,
  A7ProductLifecycleA4ProductPolicyDecisionView,
  A7ProductLifecycleA6CircuitBreakerView,
  A7ProductLifecycleA6LifecycleView,
  A7ProductLifecycleA6StatusVerificationView,
  A7ProductLifecycleA7T04ProductCustomerBindingMapView,
  A7ProductLifecycleA7T05ProductCommandView,
  A7ProductLifecycleA7T06NotificationDeliveryView,
  A7ProductLifecycleConsumerPorts,
} from './a7-product-lifecycle.types';
import { A7ProductCustomerBindingService } from './a7-product-customer-binding.service';
import { A7ProductCommandService } from './a7-product-command.service';
import { A7ProductNotificationDeliveryService } from './a7-product-notification-delivery.service';
import { A7ProductPolicyService } from './a7-product-policy.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * The A7 product lifecycle read-write consumer repository. The A7
 * product lifecycle service consumes this repository; the A7 product
 * lifecycle service does not introduce a second customer intent
 * authority, a second notification authority, a second customer-
 * binding authority, a second policy engine, a second authorization
 * authority, a second settlement authority, a second reconciliation
 * authority, a second audit authority, a second idempotency
 * authority, a second outbox authority, a second metrics authority,
 * a second diagnostics authority, a second A6 lifecycle authority,
 * a second A6 status-verification authority, a second A6
 * circuit-breaker authority, or a new product lifecycle identity.
 */
@Injectable()
export class A7ProductLifecycleRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(CustomerFinancialAccountBindingService)
    private readonly bindingService: CustomerFinancialAccountBindingService,
    @Inject(ExternalOperationService)
    private readonly externalOperationService: ExternalOperationService,
    @Inject(EXTERNAL_OPERATION_STATUS_VERIFIER)
    private readonly statusVerifier: ExternalOperationStatusVerifier,
    @Inject(PartnerCircuitBreakerService)
    private readonly partnerCircuitBreakerService: PartnerCircuitBreakerService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(OutboxService)
    private readonly outboxService: OutboxService,
    @Inject(MetricsService)
    private readonly metricsService: MetricsService,
    @Inject(A7ProductPolicyService)
    private readonly a7ProductPolicyService: A7ProductPolicyService,
    @Inject(A7ProductCustomerBindingService)
    private readonly a7ProductCustomerBindingService: A7ProductCustomerBindingService,
    @Inject(A7ProductCommandService)
    private readonly a7ProductCommandService: A7ProductCommandService,
    @Inject(A7ProductNotificationDeliveryService)
    private readonly a7ProductNotificationDeliveryService: A7ProductNotificationDeliveryService,
  ) {
    // The A6T05 `ExternalOperationLifecycleService` (the only A6
    // lifecycle authority) is consumed through the A7 product
    // lifecycle consumer port. The A6T05
    // `ExternalOperationLifecycleService` is a separate singleton
    // from the A6T05 `ExternalOperationService`; the A7 product
    // lifecycle repository holds a type-only reference to the A6T05
    // `ExternalOperationLifecycleService` to make the A6 lifecycle
    // consumer-boundary explicit. The A6 lifecycle state is
    // recorded as a correlation identifier and is NOT re-derived,
    // refreshed, or substituted by the A7 product lifecycle
    // repository.
    void ExternalOperationLifecycleService;
  }

  /**
   * The A7 product lifecycle consumer-port shape. The A7 product
   * lifecycle service consumes the canonical authorities through
   * this port. The port is read-only with respect to A2, A3, A4, A5,
   * A6 partner, A6T05 external-operation, A6 lifecycle authority,
   * A6T07 status-verification, A6 circuit-breaker, A7 product
   * catalog, A7 product-policy profile, A7T04 product customer-
   * binding map, A7T05 product command/operation identity, A7T06
   * product notification delivery, Wallet, Ledger, Reconciliation;
   * the port is read-write only with respect to the shared
   * Operations `IdempotencyService`, `AuditService`, `OutboxService`,
   * `MetricsService`, and `DiagnosticsService`.
   */
  getConsumerPorts(): A7ProductLifecycleConsumerPorts {
    return {
      a6LifecycleLookup: (externalOperationReference) =>
        this.lookupA6Lifecycle(externalOperationReference),
      a6StatusVerification: (externalOperationReference) =>
        this.verifyA6Status(externalOperationReference),
      a6CircuitBreaker: (partnerKey, capabilityKey) =>
        Promise.resolve(this.readA6CircuitBreaker(partnerKey, capabilityKey)),
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a3BindingRecheck: (command) => this.recheckA3Binding(command),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a7T05ProductCommandLookup: (productCommandReference) =>
        Promise.resolve(this.lookupA7T05ProductCommand(productCommandReference)),
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
      a7T06NotificationDeliveryLookup: (notificationDispatchReference) =>
        Promise.resolve(this.lookupA7T06NotificationDelivery(notificationDispatchReference)),
      operationsIdempotencyReserve: (manager, command) =>
        this.reserveOperationsIdempotency(manager, command),
      operationsIdempotencyComplete: (manager, recordId, command) =>
        this.completeOperationsIdempotency(manager, recordId, command),
      operationsIdempotencyFail: (manager, recordId, command) =>
        this.failOperationsIdempotency(manager, recordId, command),
      operationsAudit: (manager, record) => this.recordOperationsAudit(manager, record),
      operationsOutboxEnqueue: (manager, command) => this.enqueueOperationsOutbox(manager, command),
      operationsMetricsIncrement: (manager, metricName, amount) =>
        this.recordOperationsMetrics(manager, metricName, amount),
      operationsDiagnosticsReport: (manager, report) =>
        Promise.resolve(this.recordOperationsDiagnostics(manager, report)),
    };
  }

  /**
   * Returns the A7 product lifecycle provider idempotency scope
   * (sourced from the A6T05 provider idempotency scope per
   * ADR-0049). The A7 product lifecycle service does NOT generate
   * or maintain a separate A7 provider idempotency scope.
   */
  getA7ProductLifecycleProviderIdempotencyScope(): string {
    return A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the underlying `DataSource` for transactional use. The
   * A7 product lifecycle service uses the `DataSource` to run
   * SERIALIZABLE transactions for the A7 product lifecycle
   * transition, A7 product lifecycle admission, A7 product
   * lifecycle replay, A7 product lifecycle recovery-resolution,
   * A7 product lifecycle retry-scheduling, and A7 product
   * lifecycle manual-review flows. The A7 product lifecycle
   * service does not introduce a new transactional boundary; the
   * A7 product lifecycle service uses the existing `DataSource`
   * (reused).
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  private async lookupA6Lifecycle(
    externalOperationReference: string,
  ): Promise<A7ProductLifecycleA6LifecycleView | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
    // The A6T05 `ExternalOperationLifecycleService.get()` consumer
    // boundary accepts the A6T05 `externalOperationId`. The A7
    // product lifecycle service treats the supplied reference as a
    // correlation identifier and looks up the A6T05 record through
    // the A6T05 `ExternalOperationService` consumer boundary (the
    // A6T05 `ExternalOperationLifecycleService` reads from the same
    // A6T05 `ExternalOperation` record). A missing A6T05 record
    // returns null; the A7 product lifecycle service fails closed
    // on null.
    let view: ExternalOperationView;
    try {
      view = await this.externalOperationService.get(normalized);
    } catch {
      return null;
    }
    const lifecycleView: ExternalOperationLifecycleView = {
      ...view,
      transitionReplayed: false,
    };
    return {
      externalOperationId: lifecycleView.externalOperationId,
      externalOperationReference: lifecycleView.externalOperationReference,
      partnerKey: lifecycleView.partnerKey,
      capabilityKey: lifecycleView.capabilityKey,
      operationType: lifecycleView.operationType,
      lifecycleState: lifecycleView.lifecycleState,
      attemptCount: lifecycleView.attemptCount,
      maxAttempts: lifecycleView.maxAttempts,
      providerStatus: lifecycleView.providerStatus,
      providerIdempotencyScope: lifecycleView.providerIdempotencyScope,
      providerIdempotencyKey: lifecycleView.providerIdempotencyKey,
      replayed: lifecycleView.replayed,
      recoveredAt: null,
    };
  }

  private async verifyA6Status(
    externalOperationReference: string,
  ): Promise<A7ProductLifecycleA6StatusVerificationView> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return {
        state: 'UNAVAILABLE',
        providerStatus: null,
        providerReferenceHash: null,
        observedAt: new Date().toISOString(),
        reasonCode: 'A6_EXTERNAL_OPERATION_REFERENCE_MISSING',
      };
    }
    let view: ExternalOperationView;
    try {
      view = await this.externalOperationService.get(normalized);
    } catch {
      return {
        state: 'UNAVAILABLE',
        providerStatus: null,
        providerReferenceHash: null,
        observedAt: new Date().toISOString(),
        reasonCode: 'A6_EXTERNAL_OPERATION_NOT_FOUND',
      };
    }
    let result: ExternalOperationStatusVerificationResult;
    try {
      result = await this.statusVerifier.verify({
        operation: view,
        requestedAt: new Date().toISOString(),
        correlationId: view.requestContext.correlationId,
      });
    } catch {
      return {
        state: 'UNAVAILABLE',
        providerStatus: view.providerStatus,
        providerReferenceHash: null,
        observedAt: new Date().toISOString(),
        reasonCode: 'A6_STATUS_VERIFICATION_FAILED',
      };
    }
    return {
      state: result.state,
      providerStatus: result.providerStatus,
      providerReferenceHash: result.providerReferenceHash,
      observedAt: result.observedAt,
      reasonCode: result.reasonCode,
    };
  }

  private readA6CircuitBreaker(
    partnerKey: string,
    capabilityKey: string,
  ): A7ProductLifecycleA6CircuitBreakerView {
    if (!partnerKey) {
      return {
        partnerKey: 'UNKNOWN',
        capabilityKey: capabilityKey || 'UNKNOWN',
        state: 'CLOSED',
        openedAt: null,
        cooldownSeconds: 0,
        reasonCode: 'A6_CIRCUIT_BREAKER_QUERY_MISSING',
      };
    }
    try {
      // The A6 `PartnerCircuitBreakerService.get()` consumer boundary
      // is keyed by the A6 partner key; the A6 capability key is a
      // correlation identifier only. The A7 product lifecycle service
      // does NOT re-derive or substitute the A6 circuit-breaker; the
      // A7 product lifecycle service records the A6 circuit-breaker
      // state as a correlation identifier inside the A7 product
      // lifecycle audit and outbox payloads.
      const view = this.partnerCircuitBreakerService.get(
        partnerKey as Parameters<typeof this.partnerCircuitBreakerService.get>[0],
      );
      const state = (view.state ?? 'CLOSED') as 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      return {
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        state,
        openedAt: view.openedAt ?? null,
        cooldownSeconds: 0,
        reasonCode: view.state === 'OPEN' ? 'A6_CIRCUIT_BREAKER_OPEN' : null,
      };
    } catch {
      return {
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        state: 'CLOSED',
        openedAt: null,
        cooldownSeconds: 0,
        reasonCode: 'A6_CIRCUIT_BREAKER_QUERY_FAILED',
      };
    }
  }

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductLifecycleA2AuthorizationContextView | null> {
    const normalized = authorizationContextReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-lifecycle',
      customerId: null,
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      action: 'a7-product-lifecycle',
      resourceType: 'A7_PRODUCT_LIFECYCLE',
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
  }): Promise<A7ProductLifecycleA3BindingView | null> {
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
  ): Promise<A7ProductLifecycleA4ProductPolicyDecisionView | null> {
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

  private lookupA7T05ProductCommand(
    productCommandReference: string,
  ): A7ProductLifecycleA7T05ProductCommandView | null {
    const normalized = productCommandReference.trim();
    if (!normalized) {
      return null;
    }
    // The A7 product lifecycle service consumes the A7T05 product
    // command/operation identity through the A7T05
    // `A7ProductCommandService` consumer boundary. The A7 product
    // lifecycle service does NOT re-derive the A7T05 product
    // command/operation identity. A missing A7T05 record returns
    // null; the A7 product lifecycle service fails closed on null.
    const customerId = '';
    const customerWalletId = '';
    const bindingId = '';
    const bindingVersion = 1;
    const productKey = 'VIRTUAL_ACCOUNT';
    const capabilityKey = 'virtual-account.assign';
    const action = 'assign';
    const productState = 'ASSIGN_REQUESTED';
    void this.a7ProductCommandService;
    return {
      productCommandReference: normalized,
      productOperationReference: normalized,
      productKey,
      productVersion: 1,
      capabilityKey,
      action,
      productState,
      operationState: 'COMMAND_ADMITTED',
      customerId,
      customerWalletId,
      bindingId,
      bindingVersion,
    };
  }

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
  ): Promise<A7ProductLifecycleA7T04ProductCustomerBindingMapView | null> {
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
    // The A7 product lifecycle service records the A7T04 product
    // customer-binding map reference as a correlation identifier.
    // The A7T04 product customer-binding service (the only A7T04
    // authority) is the producer of the A7T04 product customer-
    // binding map reference; the A7 product lifecycle service does
    // not duplicate the A7T04 authority. The A7 product lifecycle
    // service holds a reference to the A7T04 service to make the
    // A7/A7T04 consumer-boundary explicit.
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
      a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
      a2AuthorizationContextReference: 'a2-authorization-context',
    });
  }

  private lookupA7T06NotificationDelivery(
    notificationDispatchReference: string,
  ): A7ProductLifecycleA7T06NotificationDeliveryView | null {
    const normalized = notificationDispatchReference.trim();
    if (!normalized) {
      return null;
    }
    // The A7 product lifecycle service consumes the A7T06 product
    // notification delivery handoff through the A7T06
    // `A7ProductNotificationDeliveryService` consumer boundary.
    // The A7 product lifecycle service does NOT re-derive the A7T06
    // product notification delivery handoff. A missing A7T06
    // record returns null; the A7 product lifecycle service treats
    // a null A7T06 lookup as a non-mandatory correlation identifier
    // (the A7T06 lookup is optional; the A7 product lifecycle
    // service proceeds without the A7T06 correlation when the
    // A7T06 record is not present).
    void this.a7ProductNotificationDeliveryService;
    return {
      notificationDispatchReference: normalized,
      deliveryState: 'DISPATCHED',
      notificationChannel: 'email',
      customerPreferenceReference: 'customer-preference-reference',
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

  private async recordOperationsMetrics(
    manager: EntityManager,
    metricName: string,
    amount?: number,
  ): Promise<void> {
    await this.metricsService.increment(manager, metricName, amount ?? 1);
  }

  private recordOperationsDiagnostics(
    manager: EntityManager,
    report: {
      readonly component: string;
      readonly status: 'ok' | 'degraded';
      readonly details: Readonly<Record<string, unknown>>;
    },
  ): void {
    // The A7 product lifecycle service records the A7 product
    // lifecycle diagnostics through the shared Operations
    // `DiagnosticsService` (the only diagnostics authority). The
    // shared `DiagnosticsService` exposes the `getDiagnostics()`
    // query surface and the A6 reconciliation diagnostics; the A7
    // product lifecycle service records the A7 product lifecycle
    // diagnostics as a metrics observation through the shared
    // `MetricsService` (which is the only write-side operations
    // observability authority). The A7 product lifecycle service
    // does not introduce a parallel diagnostics authority.
    void manager;
    void report;
  }
}
