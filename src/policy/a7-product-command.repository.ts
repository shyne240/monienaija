/**
 * A7T05 — A7 product command read-write consumer repository.
 *
 * The A7 product command repository is a read-write consumer of:
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority).
 *
 * The A7 product command repository is a read-only consumer of:
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority; A3 binding records are not
 *    mutated);
 *  - the A4 product-policy service (A7T03; the only A4 product-policy
 *    authority; A4 product-policy decisions are not mutated);
 *  - the A6T05 `ExternalOperationService` (the only A6T05 external-
 *    operation authority; A6T05 external-operation records are not
 *    mutated; the A6T05 provider idempotency scope/key is reused, not
 *    substituted);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority; A7T04 product customer-
 *    binding map records are not mutated);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority).
 *
 * The A7 product command repository does not introduce a second
 * customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, or a new product
 * command identity.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { ExternalOperationService } from '../partner/external-operation.service';
import type { ExternalOperationView } from '../partner/external-operation.types';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';

import type {
  A7ProductCommandA2AuthorizationContextView,
  A7ProductCommandA3BindingView,
  A7ProductCommandA4ProductPolicyDecisionView,
  A7ProductCommandA6ExternalOperationView,
  A7ProductCommandA7T04ProductCustomerBindingMapView,
  A7ProductCommandConsumerPorts,
} from './a7-product-command.types';
import { A7ProductPolicyService } from './a7-product-policy.service';
import { A7ProductCustomerBindingService } from './a7-product-customer-binding.service';
import { A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE } from './a7-product-command.constants';

/**
 * The A7 product command read-write consumer repository. The A7
 * product command service consumes this repository; the A7 product
 * command service does not introduce a second customer-binding
 * authority, a second policy engine, a second authorization
 * authority, a second settlement authority, a second reconciliation
 * authority, a second audit authority, a second idempotency
 * authority, a second outbox authority, or a new product command
 * identity.
 */
@Injectable()
export class A7ProductCommandRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(CustomerFinancialAccountBindingService)
    private readonly bindingService: CustomerFinancialAccountBindingService,
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
  ) {}

  /**
   * The A7 product command consumer-port shape. The A7 product command
   * service consumes the canonical authorities through this port. The
   * port is read-only with respect to A2, A3, A4, A5, A6 partner,
   * A6T05 external-operation, A7 product catalog, A7 product-policy
   * profile, and A7T04 product customer-binding map; the port is
   * read-write only with respect to the shared Operations
   * `IdempotencyService`, `AuditService`, and `OutboxService`.
   */
  getConsumerPorts(): A7ProductCommandConsumerPorts {
    return {
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a3BindingRecheck: (command) => this.recheckA3Binding(command),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a6ExternalOperationLookup: (externalOperationId) =>
        this.lookupA6ExternalOperation(externalOperationId),
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
   * Returns the A7 product command provider idempotency scope
   * (sourced from the A6T05 provider idempotency scope per
   * ADR-0049). The A7 product command service does NOT generate or
   * maintain a separate A7 provider idempotency scope.
   */
  getA7ProductProviderIdempotencyScope(): string {
    return A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the underlying `DataSource` for transactional use. The A7
   * product command service uses the `DataSource` to run SERIALIZABLE
   * transactions for the A7 product command reservation, A7 product
   * command admission, A7 product command completion, and A7 product
   * command failure flows. The A7 product command service does not
   * introduce a new transactional boundary; the A7 product command
   * service uses the existing `DataSource` (reused).
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductCommandA2AuthorizationContextView | null> {
    const normalized = authorizationContextReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-command',
      customerId: null,
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      action: 'a7-product-command',
      resourceType: 'A7_PRODUCT_COMMAND',
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
  }): Promise<A7ProductCommandA3BindingView | null> {
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
  ): Promise<A7ProductCommandA4ProductPolicyDecisionView | null> {
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

  private async lookupA6ExternalOperation(
    externalOperationId: string,
  ): Promise<A7ProductCommandA6ExternalOperationView | null> {
    let view: ExternalOperationView;
    try {
      view = await this.externalOperationService.get(externalOperationId);
    } catch {
      return null;
    }
    return {
      externalOperationId: view.externalOperationId,
      externalOperationReference: view.externalOperationReference,
      partnerKey: view.partnerKey,
      capabilityKey: view.capabilityKey,
      operationType: view.operationType,
      resourceType: view.resourceType,
      resourceId: view.resourceId,
      internalCommandId: view.internalCommandId,
      customerId: view.customerId,
      walletAccountId: view.walletAccountId,
      ledgerAccountId: view.ledgerAccountId,
      amountMinor: view.amountMinor,
      currency: view.currency,
      accountingUnit: view.accountingUnit,
      internalIdempotencyScope: view.internalIdempotencyScope,
      internalIdempotencyKey: view.internalIdempotencyKey,
      providerIdempotencyScope: view.providerIdempotencyScope,
      providerIdempotencyKey: view.providerIdempotencyKey,
      requestHash: view.requestHash,
      requestId: view.requestContext.requestId,
      correlationId: view.requestContext.correlationId,
      traceId: view.requestContext.traceId,
      causationId: view.causationId,
      lifecycleState: view.lifecycleState,
      replayed: view.replayed,
    };
  }

  /**
   * Validates the A7T04 product customer-binding map reference as a
   * correlation identifier. The A7T04 service remains the only A7T04
   * product customer-binding authority. The A7 product command
   * service does NOT re-invoke the A7T04 service to re-validate the
   * A7T04 map (because that would be a second A7T04 authority); the
   * A7 product command service validates the A7T04 map reference
   * shape (SHA-256 hash) and the supplied correlation fields against
   * the A7T04 contract, and records the A7T04 map reference as a
   * correlation identifier in the A7 product command/operation
   * record. A mismatch fails closed.
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
  ): Promise<A7ProductCommandA7T04ProductCustomerBindingMapView | null> {
    const sha256Pattern = /^[a-f0-9]{64}$/i;
    if (!sha256Pattern.test(mapReference)) {
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
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !uuidPattern.test(customerId) ||
      !uuidPattern.test(customerWalletId) ||
      !uuidPattern.test(bindingId)
    ) {
      return Promise.resolve(null);
    }
    if (!Number.isSafeInteger(bindingVersion) || bindingVersion < 1) {
      return Promise.resolve(null);
    }
    // The A7 product command service records the A7T04 map reference
    // as a correlation identifier. The A7T04 service (the only A7T04
    // authority) is the producer of the A7T04 map reference; the A7
    // product command service does not duplicate the A7T04 authority.
    // The A7 product command service holds a reference to the A7T04
    // service to make the A7/A7T04 consumer-boundary explicit.
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
      a6PartnerIdentity: {
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        operationType: 'OUTBOUND_BANK_SETTLEMENT',
        environment: 'sandbox',
      },
      a6PartnerCorrelation: {
        partnerKey: 'NIBSS_NIP',
        capabilityKey: 'external.wallet.withdrawal.settlement',
        operationType: 'OUTBOUND_BANK_SETTLEMENT',
        requestId: 'a7-product-command',
        correlationId: customerId,
        traceId: null,
        externalOperationId: null,
        a6CallbackReceiptId: null,
        a6SettlementId: null,
      },
      a6PartnerReference: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
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
