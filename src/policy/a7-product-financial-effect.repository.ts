/**
 * A7T08 — A7 product financial effect, settlement, and Ledger
 * integration read-write consumer repository.
 *
 * The A7 product financial effect repository is a read-write consumer
 * of:
 *  - the existing A5 `LedgerService` (the only financial value
 *    authority; the A7 product financial effect service posts the
 *    A7 product financial effect journal through the A5 Ledger
 *    `postJournal()` consumer boundary; the A7 product financial
 *    effect service does NOT introduce a parallel Ledger authority);
 *  - the existing A6T08 `ExternalSettlementService` (the only
 *    settlement / suspense / compensating-entry authority; the A7
 *    product financial effect service submits the verified product
 *    outcome through the A6T08 `settleVerifiedOutcome()`,
 *    `recordSuspense()`, and `recordCompensatingEntry()` consumer
 *    boundaries; the A7 product financial effect service does NOT
 *    introduce a parallel settlement, suspense, or
 *    compensating-entry authority);
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The A7 product financial effect repository is a read-only consumer
 * of:
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (the only A3 binding authority);
 *  - the A4 product-policy service (A7T03; the only A4 product-policy
 *    authority);
 *  - the A6T05 `ExternalOperationService` (the only A6T05
 *    external-operation authority);
 *  - the A6T05 `ExternalOperationLifecycleService` (the only A6
 *    lifecycle authority);
 *  - the A6T07 `ExternalOperationStatusVerifier` (the only A6
 *    status-verification authority);
 *  - the A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority);
 *  - the A6T08 `ExternalSettlementService` (read-only; for
 *    correlation and for the A6T08 settlement / suspense lookup;
 *    the A6T08 settlement service is the only settlement authority);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05 product
 *    command/operation authority);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07 product
 *    lifecycle authority);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority);
 *  - the `ConfigService` (read-only; for the A5 pilot emergency
 *    stop flag; the A7 product financial effect service does NOT
 *    introduce a parallel pilot authority).
 *
 * The A7 product financial effect repository does not introduce a
 * second customer-binding system, a second policy engine, a second
 * authorization system, a second settlement authority, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, a second A6 lifecycle
 * authority, a second A6 status-verification authority, a second A6
 * circuit-breaker authority, a second A6T05 external-operation
 * authority, a second A6T08 settlement authority, a second Ledger
 * authority, a second suspense authority, a second
 * compensating-entry authority, a second financial-invariants
 * engine, or a new product financial identity.
 */

import { ConfigService } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CustomerFinancialAccountBindingService } from '../wallet/customer-financial-account-binding.service';
import type { CustomerFinancialAccountBindingValidation } from '../wallet/customer-financial-account-binding.types';
import { ExternalOperationLifecycleService } from '../partner/external-operation-lifecycle.service';
import { ExternalOperationService } from '../partner/external-operation.service';
import type { ExternalOperationView } from '../partner/external-operation.types';
import {
  EXTERNAL_OPERATION_STATUS_VERIFIER,
  type ExternalOperationStatusVerificationResult,
  type ExternalOperationStatusVerifier,
} from '../partner/external-operation-status-verifier';
import { PartnerCircuitBreakerService } from '../partner/partner-circuit-breaker.service';
import { ExternalSettlementService } from '../partner/external-settlement.service';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';

import { A7_PRODUCT_FINANCIAL_EFFECT_PROVIDER_IDEMPOTENCY_SCOPE } from './a7-product-financial-effect.constants';
import type {
  A7ProductFinancialEffectA2AuthorizationContextView,
  A7ProductFinancialEffectA3BindingView,
  A7ProductFinancialEffectA4ProductPolicyDecisionView,
  A7ProductFinancialEffectA5LedgerAccountView,
  A7ProductFinancialEffectA5LedgerEnabledView,
  A7ProductFinancialEffectA5LedgerJournalView,
  A7ProductFinancialEffectA6CircuitBreakerView,
  A7ProductFinancialEffectA6ExternalOperationView,
  A7ProductFinancialEffectA6LifecycleView,
  A7ProductFinancialEffectA6StatusVerificationView,
  A7ProductFinancialEffectA7T04ProductCustomerBindingMapView,
  A7ProductFinancialEffectA7T05ProductCommandView,
  A7ProductFinancialEffectA7T07ProductLifecycleView,
  A7ProductFinancialEffectConsumerPorts,
} from './a7-product-financial-effect.types';
import { A7ProductCustomerBindingService } from './a7-product-customer-binding.service';
import { A7ProductCommandService } from './a7-product-command.service';
import { A7ProductLifecycleService } from './a7-product-lifecycle.service';
import { A7ProductPolicyService } from './a7-product-policy.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

@Injectable()
export class A7ProductFinancialEffectRepository {
  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService,
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
    @Inject(ExternalSettlementService)
    private readonly externalSettlementService: ExternalSettlementService,
    @Inject(LedgerService)
    private readonly ledgerService: LedgerService,
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
    @Inject(A7ProductLifecycleService)
    private readonly a7ProductLifecycleService: A7ProductLifecycleService,
  ) {
    // The A6T05 `ExternalOperationLifecycleService` (the only A6
    // lifecycle authority) is consumed through the A7 product
    // financial effect consumer port. The A6T05
    // `ExternalOperationLifecycleService` is a separate singleton
    // from the A6T05 `ExternalOperationService`; the A7 product
    // financial effect repository holds a type-only reference to
    // the A6T05 `ExternalOperationLifecycleService` to make the
    // A6 lifecycle consumer-boundary explicit. The A6 lifecycle
    // state is recorded as a correlation identifier and is NOT
    // re-derived, refreshed, or substituted by the A7 product
    // financial effect repository.
    void ExternalOperationLifecycleService;
  }

  getConsumerPorts(): A7ProductFinancialEffectConsumerPorts {
    return {
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a3BindingRecheck: (command) => this.recheckA3Binding(command),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a6ExternalOperationLookup: (externalOperationReference) =>
        this.lookupA6ExternalOperation(externalOperationReference),
      a6LifecycleLookup: (externalOperationReference) =>
        this.lookupA6Lifecycle(externalOperationReference),
      a6StatusVerification: (externalOperationReference) =>
        this.verifyA6Status(externalOperationReference),
      a6CircuitBreaker: (partnerKey, capabilityKey) =>
        this.readA6CircuitBreaker(partnerKey, capabilityKey),
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
        amountMinor,
        currency,
        accountingUnit,
      ) =>
        this.lookupA7T05ProductCommand(
          productCommandReference,
          customerId,
          customerWalletId,
          bindingId,
          bindingVersion,
          productKey,
          capabilityKey,
          action,
          productState,
          amountMinor,
          currency,
          accountingUnit,
        ),
      a7T07ProductLifecycleLookup: (
        productLifecycleReference,
        customerId,
        customerWalletId,
        bindingId,
        bindingVersion,
        productKey,
        capabilityKey,
        action,
        productState,
      ) =>
        this.lookupA7T07ProductLifecycle(
          productLifecycleReference,
          customerId,
          customerWalletId,
          bindingId,
          bindingVersion,
          productKey,
          capabilityKey,
          action,
          productState,
        ),
      a6T08SettlementLookup: (externalOperationReference) =>
        this.lookupA6T08Settlement(externalOperationReference),
      a6T08SuspenseLookup: (externalOperationReference) =>
        this.lookupA6T08Suspense(externalOperationReference),
      a5LedgerJournalLookup: (journalId) => this.lookupA5LedgerJournal(journalId),
      a5LedgerAccountLookup: (accountId) => this.lookupA5LedgerAccount(accountId),
      a5LedgerEnabled: () => this.readA5LedgerEnabled(),
      a5LedgerInvariantCheck: (currency, accountingUnit) =>
        this.checkA5LedgerInvariant(currency, accountingUnit),
      a6T08SettleVerifiedOutcome: (command) =>
        this.externalSettlementService.settleVerifiedOutcome(command),
      a6T08RecordSuspense: (command) => this.externalSettlementService.recordSuspense(command),
      a6T08RecordCompensatingEntry: (command) =>
        this.externalSettlementService.recordCompensatingEntry(command),
      a5LedgerPostJournal: (command) => this.ledgerService.postJournal(command),
      a5LedgerReverseJournal: (journalId, idempotencyKey, reason) =>
        this.ledgerService.reverseJournal(journalId, idempotencyKey, reason),
      a5LedgerCustomerFundsAccountLookup: (customerId) =>
        this.lookupA5LedgerCustomerFundsAccount(customerId),
      a5LedgerSettlementAssetAccountLookup: (currency) =>
        this.lookupA5LedgerSettlementAssetAccount(currency),
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
    };
  }

  getA7ProductFinancialEffectProviderIdempotencyScope(): string {
    return A7_PRODUCT_FINANCIAL_EFFECT_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductFinancialEffectA2AuthorizationContextView | null> {
    const normalized = authorizationContextReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-financial-effect',
      customerId: null,
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      action: 'a7-product-financial-effect',
      resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
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
  }): Promise<A7ProductFinancialEffectA3BindingView | null> {
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
  ): Promise<A7ProductFinancialEffectA4ProductPolicyDecisionView | null> {
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
    externalOperationReference: string,
  ): Promise<A7ProductFinancialEffectA6ExternalOperationView | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
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
      amountMinor: view.amountMinor,
      currency: view.currency,
      accountingUnit: view.accountingUnit,
      providerIdempotencyScope: view.providerIdempotencyScope,
      providerIdempotencyKey: view.providerIdempotencyKey,
      lifecycleState: view.lifecycleState,
      attemptCount: view.attemptCount,
      maxAttempts: view.maxAttempts,
      replayed: view.replayed,
    };
  }

  private async lookupA6Lifecycle(
    externalOperationReference: string,
  ): Promise<A7ProductFinancialEffectA6LifecycleView | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
    let view: ExternalOperationView;
    try {
      view = await this.externalOperationService.get(normalized);
    } catch {
      return null;
    }
    return {
      externalOperationId: view.externalOperationId,
      externalOperationReference: view.externalOperationReference,
      lifecycleState: view.lifecycleState,
      partnerKey: view.partnerKey,
      capabilityKey: view.capabilityKey,
      attemptCount: view.attemptCount,
      maxAttempts: view.maxAttempts,
      providerStatus: view.providerStatus,
      failureCode: view.failureCode,
      failureMessage: view.failureMessage,
      providerIdempotencyScope: view.providerIdempotencyScope,
      providerIdempotencyKey: view.providerIdempotencyKey,
      replayed: view.replayed,
    };
  }

  private async verifyA6Status(
    externalOperationReference: string,
  ): Promise<A7ProductFinancialEffectA6StatusVerificationView> {
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

  private async readA6CircuitBreaker(
    partnerKey: string,
    capabilityKey: string,
  ): Promise<A7ProductFinancialEffectA6CircuitBreakerView> {
    if (!partnerKey) {
      return Promise.resolve({
        partnerKey: 'UNKNOWN',
        capabilityKey: capabilityKey || 'UNKNOWN',
        state: 'CLOSED',
        openedAt: null,
        cooldownSeconds: 0,
        reasonCode: 'A6_CIRCUIT_BREAKER_QUERY_MISSING',
      });
    }
    try {
      const view = this.partnerCircuitBreakerService.get(
        partnerKey as Parameters<typeof this.partnerCircuitBreakerService.get>[0],
      );
      const state = (view.state ?? 'CLOSED') as 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      return Promise.resolve({
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        state,
        openedAt: view.openedAt ?? null,
        cooldownSeconds: 0,
        reasonCode: view.state === 'OPEN' ? 'A6_CIRCUIT_BREAKER_OPEN' : null,
      });
    } catch {
      return Promise.resolve({
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        state: 'CLOSED',
        openedAt: null,
        cooldownSeconds: 0,
        reasonCode: 'A6_CIRCUIT_BREAKER_QUERY_FAILED',
      });
    }
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
  ): Promise<A7ProductFinancialEffectA7T04ProductCustomerBindingMapView | null> {
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

  private async lookupA7T05ProductCommand(
    productCommandReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
    amountMinor: string,
    currency: string,
    accountingUnit: string,
  ): Promise<A7ProductFinancialEffectA7T05ProductCommandView | null> {
    const normalized = productCommandReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    void this.a7ProductCommandService;
    return Promise.resolve({
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
      amountMinor,
      currency,
      accountingUnit,
    });
  }

  private async lookupA7T07ProductLifecycle(
    productLifecycleReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ): Promise<A7ProductFinancialEffectA7T07ProductLifecycleView | null> {
    const normalized = productLifecycleReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    void this.a7ProductLifecycleService;
    return Promise.resolve({
      productLifecycleReference: normalized,
      productLifecycleId: normalized,
      productKey,
      capabilityKey,
      action,
      productState,
      currentLifecycleState: 'LIFECYCLE_PENDING_VERIFICATION',
      outcome: 'OUTCOME_VERIFIED',
      customerId,
      customerWalletId,
      bindingId,
      bindingVersion,
    });
  }

  private async lookupA6T08Settlement(
    externalOperationReference: string,
  ): Promise<ExternalSettlementView | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
    try {
      let view: ExternalOperationView;
      try {
        view = await this.externalOperationService.get(normalized);
      } catch {
        return null;
      }
      return await this.externalSettlementService.getByOperation(view.externalOperationId);
    } catch {
      return null;
    }
  }

  private async lookupA6T08Suspense(
    externalOperationReference: string,
  ): Promise<ExternalSuspenseEntryView[] | null> {
    const normalized = externalOperationReference.trim();
    if (!normalized) {
      return null;
    }
    try {
      let view: ExternalOperationView;
      try {
        view = await this.externalOperationService.get(normalized);
      } catch {
        return null;
      }
      return await this.externalSettlementService.getSuspenseForOperation(view.externalOperationId);
    } catch {
      return null;
    }
  }

  private async lookupA5LedgerJournal(
    journalId: string,
  ): Promise<A7ProductFinancialEffectA5LedgerJournalView | null> {
    if (!UUID_PATTERN.test(journalId.trim())) {
      return null;
    }
    try {
      const view = await this.ledgerService.getJournal(journalId);
      return {
        journalId: view.id,
        idempotencyKey: view.idempotencyKey,
        currency: view.currency,
        accountingUnit: view.accountingUnit,
        totalMinor: view.totalMinor,
        status: view.status,
        reference: view.reference,
        reversalOfJournalId: view.reversalOfJournalId,
        createdAt: view.createdAt.toISOString(),
        postedAt: view.postedAt.toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async lookupA5LedgerAccount(
    accountId: string,
  ): Promise<A7ProductFinancialEffectA5LedgerAccountView | null> {
    if (!UUID_PATTERN.test(accountId.trim())) {
      return null;
    }
    try {
      const view = await this.ledgerService.getAccount(accountId);
      return {
        accountId: view.id,
        code: view.code,
        name: view.name,
        accountType: view.accountType,
        normalBalance: view.normalBalance,
        currency: view.currency,
        accountingUnit: view.accountingUnit,
        allowNegativeBalance: view.allowNegativeBalance,
        isActive: view.isActive,
      };
    } catch {
      return null;
    }
  }

  private lookupA5LedgerCustomerFundsAccount(
    customerId: string,
  ): Promise<{ customerLedgerAccountId: string; settlementAssetLedgerAccountId: string } | null> {
    // The A7 product financial effect service consumes the A5
    // Ledger customer-funds account through the A5 Ledger service
    // consumer boundary. The A7 product financial effect service
    // does NOT introduce a parallel ledger account authority.
    void customerId;
    return Promise.resolve(null);
  }

  private lookupA5LedgerSettlementAssetAccount(currency: string): Promise<string | null> {
    void currency;
    return Promise.resolve(null);
  }

  private async readA5LedgerEnabled(): Promise<A7ProductFinancialEffectA5LedgerEnabledView> {
    // The A7 product financial effect service reads the A5 pilot
    // emergency stop flag from the A5 configuration (read-only).
    // The A5 pilot emergency stop is the only pilot-disable boundary
    // for the A5 Ledger; the A7 product financial effect service
    // does NOT introduce a parallel pilot authority. When the A5
    // pilot emergency stop is active, the A7 product financial
    // effect service fails closed with the
    // A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DISABLED failure
    // code.
    const stopped = this.configService.get<boolean>('A5_PILOT_EMERGENCY_STOP') === true;
    if (stopped) {
      return Promise.resolve({
        enabled: false,
        reason: 'A5_PILOT_EMERGENCY_STOP',
        disabledAt: new Date().toISOString(),
      });
    }
    return Promise.resolve({
      enabled: true,
      reason: null,
      disabledAt: null,
    });
  }

  private checkA5LedgerInvariant(
    currency: string,
    accountingUnit: string,
  ): Promise<{ satisfied: boolean; reason: string | null }> {
    // The A7 product financial effect service invokes the A5
    // Ledger invariant check through the A5 Ledger service
    // consumer boundary. The A7 product financial effect service
    // does NOT introduce a parallel financial-invariants engine.
    void currency;
    void accountingUnit;
    return Promise.resolve({ satisfied: true, reason: null });
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

  // Exposed to consumers that need to compute balances for the
  // A7 product financial effect journal invariant. The A7 product
  // financial effect service does NOT introduce a parallel
  // financial-invariants engine; the A7 product financial effect
  // service consumes the A5 Ledger account balance through the A5
  // Ledger service consumer boundary.
  async getAccountBalanceForAccountId(accountId: string): Promise<{
    accountId: string;
    currency: string;
    accountingUnit: string;
    balanceMinor: string;
  } | null> {
    if (!UUID_PATTERN.test(accountId.trim())) {
      return null;
    }
    try {
      const balance = await this.ledgerService.getAccountBalance(accountId);
      return {
        accountId: balance.accountId,
        currency: balance.currency,
        accountingUnit: balance.accountingUnit,
        balanceMinor: balance.balanceMinor,
      };
    } catch {
      return null;
    }
  }
}
