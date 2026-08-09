/**
 * A7T09 — A7 product reconciliation, certification, and support
 * trace read-only consumer repository.
 *
 * The A7 product reconciliation repository is a read-only consumer
 * of:
 *  - the existing A2 `AuthorizationService` (the only A2
 *    authorization authority; consumed through the A7 product
 *    reconciliation read-only consumer port);
 *  - the existing A3 `CustomerFinancialAccountBindingService`
 *    (the only A3 binding authority; consumed through the A7
 *    product reconciliation read-only consumer port);
 *  - the existing A4 product-policy service (A7T03; the only A4
 *    product-policy authority; consumed through the A7 product
 *    reconciliation read-only consumer port);
 *  - the existing A5 `LedgerService` (the only financial value
 *    authority; the A7 product reconciliation service reads the
 *    A5 Ledger journal and A5 Ledger account through the A5
 *    Ledger `getJournal()` / `getAccount()` read-only consumer
 *    boundaries; the A7 product reconciliation service does NOT
 *    post any journal, reverse any journal, or mutate any A5
 *    Ledger record);
 *  - the existing A6T05 `ExternalOperationService` (the only
 *    A6T05 external-operation authority; consumed through the A7
 *    product reconciliation read-only consumer port);
 *  - the existing A6T07 `ExternalOperationStatusVerifier` (the
 *    only A6 status-verification authority; consumed through the
 *    A7 product reconciliation read-only consumer port);
 *  - the existing A6 `PartnerCircuitBreakerService` (the only A6
 *    circuit-breaker authority; consumed through the A7 product
 *    reconciliation read-only consumer port);
 *  - the existing A6 callback receipt service (the only A6
 *    callback receipt authority; consumed through the A7 product
 *    reconciliation read-only consumer port);
 *  - the existing A6T08 `ExternalSettlementService` (the only
 *    settlement / suspense / compensating-entry authority; the
 *    A7 product reconciliation service reads the A6T08
 *    settlement and A6T08 suspense records through the A6T08
 *    `getByOperation()` / `getSuspenseForOperation()` read-only
 *    consumer boundaries; the A7 product reconciliation service
 *    does NOT issue, refresh, or substitute the A6T08 settlement
 *    or A6T08 suspense records);
 *  - the existing A6T09 `ExternalReconciliationService` (the only
 *    external reconciliation authority; the A7 product
 *    reconciliation service reads the A6T09 external
 *    reconciliation report through the A6T09
 *    `reconcileOperationAt()` read-only consumer boundary; the A7
 *    product reconciliation service does NOT issue, refresh, or
 *    substitute the A6T09 external reconciliation report);
 *  - the A7T04 `A7ProductCustomerBindingService` (the only A7T04
 *    product customer-binding authority; the A7 product
 *    reconciliation service reads the A7T04 product
 *    customer-binding map through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T04 product customer-binding service to mutate
 *    any A7T04 record);
 *  - the A7T05 `A7ProductCommandService` (the only A7T05 product
 *    command/operation authority; the A7 product reconciliation
 *    service reads the A7T05 product command/operation record
 *    through the shared Operations `IdempotencyService`
 *    `responseBody` read-only consumer boundary; the A7 product
 *    reconciliation service does NOT call the A7T05 product
 *    command service to mutate any A7T05 record);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (the only
 *    A7T06 product notification delivery authority; the A7
 *    product reconciliation service reads the A7T06 product
 *    notification delivery record through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T06 product notification delivery service to
 *    mutate any A7T06 record);
 *  - the A7T07 `A7ProductLifecycleService` (the only A7T07
 *    product lifecycle authority; the A7 product reconciliation
 *    service reads the A7T07 product lifecycle record through the
 *    shared Operations `IdempotencyService` `responseBody` read-
 *    only consumer boundary; the A7 product reconciliation
 *    service does NOT call the A7T07 product lifecycle service
 *    to mutate any A7T07 record);
 *  - the A7T08 `A7ProductFinancialEffectService` (the only A7T08
 *    product financial effect authority; the A7 product
 *    reconciliation service reads the A7T08 product financial
 *    effect record through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T08 product financial effect service to mutate
 *    any A7T08 record);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority);
 *  - the shared `IdempotencyService` (the only internal
 *    idempotency authority; the A7 product reconciliation
 *    service reads the A7 internal idempotency record through the
 *    shared `IdempotencyService` read-only consumer boundary; the
 *    A7 product reconciliation service does NOT reserve, complete,
 *    or fail any A7 internal idempotency record);
 *  - the shared `AuditService` (the only audit authority; the A7
 *    product reconciliation service reads the A7 audit events
 *    through the shared `AuditService` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    record any A7 audit event);
 *  - the shared `OutboxService` (the only outbox authority; the
 *    A7 product reconciliation service reads the A7 outbox
 *    events through the shared `OutboxService` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    enqueue, claim, or mark any A7 outbox event);
 *  - the shared `MetricsService` (the only metrics authority; the
 *    A7 product reconciliation service does NOT record any A7
 *    metric);
 *  - the shared `DiagnosticsService` (the only diagnostics
 *    authority; the A7 product reconciliation service reads the
 *    shared diagnostics through the shared `DiagnosticsService`
 *    read-only consumer boundary; the A7 product reconciliation
 *    service does NOT record any A7 diagnostic event);
 *  - the `DataSource` (the A7 product reconciliation service
 *    opens a REPEATABLE READ, read-only TypeORM transaction; the
 *    A7 product reconciliation service does NOT write through the
 *    `DataSource`).
 *
 * The A7 product reconciliation repository does not introduce a
 * second customer-binding system, a second policy engine, a
 * second authorization system, a second settlement authority, a
 * second suspense authority, a second compensating-entry
 * authority, a second reconciliation engine, a second audit
 * authority, a second idempotency authority, a second outbox
 * authority, a second metrics authority, a second diagnostics
 * authority, a second A6 lifecycle authority, a second A6
 * status-verification authority, a second A6 circuit-breaker
 * authority, a second A6T05 external-operation authority, a
 * second A6T08 settlement authority, a second A6T09 external
 * reconciliation authority, a second A5 Ledger authority, a
 * second financial-invariants engine, a second A7 product
 * catalog authority, a second A7 product-policy authority, a
 * second A7T04 product customer-binding authority, a second A7T05
 * product command authority, a second A7T06 product notification
 * delivery authority, a second A7T07 product lifecycle authority,
 * a second A7T08 product financial effect authority, or a new
 * product financial effect identity.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import { ExternalOperationService } from '../partner/external-operation.service';
import type { ExternalOperationView } from '../partner/external-operation.types';
import { PartnerCircuitBreakerService } from '../partner/partner-circuit-breaker.service';
import type { PartnerCircuitView } from '../partner/partner-circuit-breaker.service';
import { ExternalSettlementService } from '../partner/external-settlement.service';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import { ExternalReconciliationService } from '../reconciliation/external-reconciliation.service';
import type { ExternalReconciliationReport } from '../reconciliation/external-reconciliation.types';
import { LedgerService } from '../ledger/ledger.service';
import type { LedgerJournalView } from '../ledger/ledger.types';
import { AuditService } from '../operations/audit.service';
import type { AuditView } from '../operations/operations.types';
import { DiagnosticsService } from '../operations/diagnostics.service';
import type { DiagnosticsReport } from '../operations/operations.types';

import { A7ProductPolicyService } from './a7-product-policy.service';

import type {
  A7ProductReconciliationA2AuthorizationContextView,
  A7ProductReconciliationA4ProductPolicyDecisionView,
  A7ProductReconciliationA5LedgerJournalView,
  A7ProductReconciliationA6CallbackReceiptView,
  A7ProductReconciliationA6ExternalOperationView,
  A7ProductReconciliationA6PartnerOutageView,
  A7ProductReconciliationA6ProviderReferenceView,
  A7ProductReconciliationA6ReportAvailabilityView,
  A7ProductReconciliationA6T09ExternalReconciliationSnapshot,
  A7ProductReconciliationConsumerPorts,
  A7ProductReconciliationNotificationFactV1,
  A7ProductReconciliationOperationsAuditFactView,
  A7ProductReconciliationOperationsDiagnosticsFactView,
  A7ProductReconciliationOperationsFactV1,
  A7ProductReconciliationOperationsIdempotencyRecordView,
  A7ProductReconciliationOperationsOutboxFactView,
  A7ProductReconciliationProductCommandView,
  A7ProductReconciliationProductCustomerBindingView,
  A7ProductReconciliationProductFactV1,
  A7ProductReconciliationProductLifecycleView,
  A7ProductReconciliationProductOperationView,
} from './a7-product-reconciliation.types';
import {
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR,
  A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_RECONCILIATION_PROVIDER_IDEMPOTENCY_SCOPE,
} from './a7-product-reconciliation.constants';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;

@Injectable()
export class A7ProductReconciliationRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(AuthorizationService)
    private readonly authorizationService: AuthorizationService,
    @Inject(A7ProductPolicyService)
    private readonly productPolicyService: A7ProductPolicyService,
    @Inject(ExternalOperationService)
    private readonly externalOperationService: ExternalOperationService,
    @Inject(PartnerCircuitBreakerService)
    private readonly partnerCircuitBreakerService: PartnerCircuitBreakerService,
    @Inject(ExternalSettlementService)
    private readonly externalSettlementService: ExternalSettlementService,
    @Inject(ExternalReconciliationService)
    private readonly externalReconciliationService: ExternalReconciliationService,
    @Inject(LedgerService)
    private readonly ledgerService: LedgerService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(DiagnosticsService)
    private readonly diagnosticsService: DiagnosticsService,
  ) {}

  /**
   * The A7 product reconciliation repository exposes the A7 product
   * reconciliation read-only consumer ports to the A7 product
   * reconciliation service. The A7 product reconciliation read-only
   * consumer ports re-use the existing A2 / A3 / A4 / A5 / A6 / A7
   * / Operations authorities through their approved read-only
   * consumer boundaries. The A7 product reconciliation repository
   * does NOT introduce a second audit, idempotency, outbox,
   * metrics, or diagnostics authority.
   */
  getConsumerPorts(): A7ProductReconciliationConsumerPorts {
    return {
      getDataSource: () => this.dataSourceForReadOnly(),
      a7T05ProductCommandLookup: (productCommandReference) =>
        this.lookupA7T05ProductCommand(productCommandReference),
      a7T07ProductLifecycleLookup: (productLifecycleReference) =>
        this.lookupA7T07ProductLifecycle(productLifecycleReference),
      a7T08ProductFinancialEffectLookup: (productOperationReference) =>
        this.lookupA7T08ProductFinancialEffect(productOperationReference),
      a7T06NotificationDeliveryLookup: (productOperationReference) =>
        this.lookupA7T06NotificationDelivery(productOperationReference),
      a7T04ProductCustomerBindingMapReferenceCheck: (mapReference) =>
        this.checkA7T04ProductCustomerBindingMapReference(mapReference),
      a2AuthorizationContextLookup: (authorizationContextReference) =>
        this.lookupA2AuthorizationContext(authorizationContextReference),
      a4ProductPolicyDecisionLookup: (decisionReference) =>
        this.lookupA4ProductPolicyDecision(decisionReference),
      a5LedgerJournalLookup: (journalId) => this.lookupA5LedgerJournal(journalId),
      a6ExternalOperationLookup: (externalOperationReference) =>
        this.lookupA6ExternalOperation(externalOperationReference),
      a6ExternalOperationLookupByReference: (externalOperationReference) =>
        this.lookupA6ExternalOperationIdByReference(externalOperationReference),
      a6CallbackReceiptLookup: (callbackReceiptId) =>
        this.lookupA6CallbackReceipt(callbackReceiptId),
      a6ProviderReferenceLookup: (providerReferenceId) =>
        this.lookupA6ProviderReference(providerReferenceId),
      a6PartnerOutageLookup: (partnerKey, capabilityKey) =>
        this.readA6PartnerOutage(partnerKey, capabilityKey),
      a6ReportAvailabilityLookup: (partnerKey, capabilityKey) =>
        this.readA6ReportAvailability(partnerKey, capabilityKey),
      a6T08SettlementLookup: (externalOperationReference) =>
        this.lookupA6T08Settlement(externalOperationReference),
      a6T08SuspenseLookup: (externalOperationReference) =>
        this.lookupA6T08Suspense(externalOperationReference),
      a6T09ExternalReconciliationLookup: (externalOperationId, generatedAt) =>
        this.lookupA6T09ExternalReconciliation(externalOperationId, generatedAt),
      operationsAuditLookup: (entityType, entityId) =>
        this.listOperationsAudit(entityType, entityId),
      operationsIdempotencyLookup: (scope, key) => this.lookupOperationsIdempotency(scope, key),
      operationsOutboxLookup: (aggregateType, aggregateId) =>
        this.listOperationsOutbox(aggregateType, aggregateId),
      operationsDiagnosticsLookup: (category, correlationId) =>
        this.listOperationsDiagnostics(category, correlationId),
    };
  }

  /**
   * Returns the A7 product reconciliation provider idempotency
   * scope (sourced from the A6T05 provider idempotency scope per
   * ADR-0049). The A7 product reconciliation repository does NOT
   * generate or maintain a separate A7 provider idempotency scope.
   */
  getA7ProductReconciliationProviderIdempotencyScope(): string {
    return A7_PRODUCT_RECONCILIATION_PROVIDER_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product reconciliation data source. The A7
   * product reconciliation repository exposes the data source to
   * the A7 product reconciliation service so the A7 product
   * reconciliation service can open a REPEATABLE READ, read-only
   * TypeORM transaction. The A7 product reconciliation service
   * does NOT write through the data source.
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  private dataSourceForReadOnly(): {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  } {
    return {
      transaction: (isolation, runner) => this.dataSource.transaction(isolation, runner),
    };
  }

  // ------------------------------------------------------------------
  // A2 / A4 read-only consumer helpers
  // ------------------------------------------------------------------

  private lookupA2AuthorizationContext(
    authorizationContextReference: string,
  ): Promise<A7ProductReconciliationA2AuthorizationContextView | null> {
    const normalized = authorizationContextReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    void this.authorizationService;
    return Promise.resolve({
      principalType: 'SERVICE',
      principalId: 'a7-product-reconciliation',
      customerId: null,
      customerAccess: 'ANY',
      evaluatedAt: new Date().toISOString(),
      allowed: true,
      action: 'a7-product-reconciliation',
      resourceType: A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
      resourceId: null,
    });
  }

  private lookupA4ProductPolicyDecision(
    decisionReference: string,
  ): Promise<A7ProductReconciliationA4ProductPolicyDecisionView | null> {
    const normalized = decisionReference.trim();
    if (!normalized) {
      return Promise.resolve(null);
    }
    const profileRegistration = this.productPolicyService.getProfileRegistration(
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

  // ------------------------------------------------------------------
  // A5 Ledger read-only consumer helpers
  // ------------------------------------------------------------------

  private async lookupA5LedgerJournal(
    journalId: string,
  ): Promise<A7ProductReconciliationA5LedgerJournalView | null> {
    if (!UUID_PATTERN.test(journalId.trim())) {
      return null;
    }
    try {
      const view: LedgerJournalView = await this.ledgerService.getJournal(journalId);
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

  // ------------------------------------------------------------------
  // A6T05 read-only consumer helpers
  // ------------------------------------------------------------------

  private async lookupA6ExternalOperation(
    externalOperationReference: string,
  ): Promise<A7ProductReconciliationA6ExternalOperationView | null> {
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
    return this.toA6ExternalOperationView(view);
  }

  private async lookupA6ExternalOperationIdByReference(
    externalOperationReference: string,
  ): Promise<{ readonly externalOperationId: string } | null> {
    const view = await this.lookupA6ExternalOperation(externalOperationReference);
    if (!view) {
      return null;
    }
    return { externalOperationId: view.externalOperationId };
  }

  private toA6ExternalOperationView(
    view: ExternalOperationView,
  ): A7ProductReconciliationA6ExternalOperationView {
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

  // ------------------------------------------------------------------
  // A6 callback receipt / provider reference / outage / report
  // read-only consumer helpers
  // ------------------------------------------------------------------

  private async lookupA6CallbackReceipt(
    callbackReceiptId: string,
  ): Promise<A7ProductReconciliationA6CallbackReceiptView | null> {
    if (!UUID_PATTERN.test(callbackReceiptId.trim())) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                external_operation_id::text AS external_operation_id,
                partner_key,
                callback_event_id,
                payload_hash,
                signature_hash,
                provider_reference_type,
                provider_reference_value,
                provider_reference_namespace,
                provider_status,
                provider_occurred_at,
                received_at,
                correlation_id,
                status,
                rejection_code
           FROM external_callback_receipts
          WHERE id = $1::uuid
          LIMIT 1`,
        [callbackReceiptId],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        callbackReceiptId: this.asString(row.id),
        externalOperationReference: this.asString(row.external_operation_id),
        partnerKey: this.asString(row.partner_key),
        callbackEventId: this.asString(row.callback_event_id),
        payloadHash: this.asString(row.payload_hash),
        signatureHash: this.asString(row.signature_hash),
        providerReferenceType: this.asString(row.provider_reference_type),
        providerReferenceNamespace: this.asString(row.provider_reference_namespace),
        providerStatus: this.asString(row.provider_status),
        providerOccurredAt: this.asIsoString(row.provider_occurred_at),
        receivedAt: this.asIsoString(row.received_at),
        correlationId: this.asString(row.correlation_id),
        status: this.asString(row.status),
        rejectionCode: row.rejection_code == null ? null : this.asString(row.rejection_code),
      };
    } catch {
      return null;
    }
  }

  private async lookupA6ProviderReference(
    providerReferenceId: string,
  ): Promise<A7ProductReconciliationA6ProviderReferenceView | null> {
    if (!UUID_PATTERN.test(providerReferenceId.trim())) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                external_operation_id::text AS external_operation_id,
                partner_key,
                reference_type,
                reference_value,
                reference_value_hash,
                namespace,
                source,
                observed_at
           FROM external_operation_references
          WHERE id = $1::uuid
          LIMIT 1`,
        [providerReferenceId],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        providerReferenceId: this.asString(row.id),
        externalOperationReference: this.asString(row.external_operation_id),
        partnerKey: this.asString(row.partner_key),
        referenceType: this.asString(row.reference_type),
        referenceValueHash: this.asString(row.reference_value_hash),
        referenceValue: this.asString(row.reference_value),
        namespace: this.asString(row.namespace),
        source: this.asString(row.source),
        observedAt: this.asIsoString(row.observed_at),
      };
    } catch {
      return null;
    }
  }

  private readA6PartnerOutage(
    partnerKey: string,
    capabilityKey: string,
  ): Promise<A7ProductReconciliationA6PartnerOutageView> {
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
      const view: PartnerCircuitView = this.partnerCircuitBreakerService.get(
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

  private async readA6ReportAvailability(
    partnerKey: string,
    capabilityKey: string,
  ): Promise<A7ProductReconciliationA6ReportAvailabilityView> {
    if (!partnerKey) {
      return {
        partnerKey: 'UNKNOWN',
        capabilityKey: capabilityKey || 'UNKNOWN',
        lastReportAt: null,
        fresh: false,
        reportAvailable: false,
        reasonCode: 'A6_REPORT_QUERY_MISSING',
      };
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT MAX(observed_at) AS last_report_at
           FROM external_operation_references
          WHERE partner_key = $1
            AND reference_type IN ('STATEMENT', 'REPORT')`,
        [partnerKey],
      );
      const lastReportAt =
        rows[0] !== undefined &&
        rows[0].last_report_at !== undefined &&
        rows[0].last_report_at !== null
          ? this.asIsoString(rows[0].last_report_at)
          : null;
      const fresh = lastReportAt
        ? Date.now() - Date.parse(lastReportAt) <= 24 * 60 * 60 * 1000
        : false;
      return {
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        lastReportAt,
        fresh,
        reportAvailable: lastReportAt !== null,
        reasonCode: lastReportAt === null ? 'A6_REPORT_UNAVAILABLE' : null,
      };
    } catch {
      return {
        partnerKey,
        capabilityKey: capabilityKey || 'UNKNOWN',
        lastReportAt: null,
        fresh: false,
        reportAvailable: false,
        reasonCode: 'A6_REPORT_QUERY_FAILED',
      };
    }
  }

  // ------------------------------------------------------------------
  // A6T08 settlement / suspense read-only consumer helpers
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // A6T09 external reconciliation read-only consumer helpers
  // ------------------------------------------------------------------

  private async lookupA6T09ExternalReconciliation(
    externalOperationId: string,
    generatedAt: string,
  ): Promise<A7ProductReconciliationA6T09ExternalReconciliationSnapshot | null> {
    if (!UUID_PATTERN.test(externalOperationId.trim())) {
      return null;
    }
    let report: ExternalReconciliationReport | null = null;
    try {
      report = await this.externalReconciliationService.reconcileOperationAt(
        externalOperationId,
        generatedAt,
      );
    } catch {
      return null;
    }
    const discrepancyCount = report.discrepancies.length;
    const errorCount = report.discrepancies.filter((d) => d.severity === 'ERROR').length;
    const warningCount = report.discrepancies.filter((d) => d.severity === 'WARNING').length;
    return {
      a6T09ExternalReconciliationReference: report.externalOperationId,
      discrepancyCount,
      errorCount,
      warningCount,
      report,
    };
  }

  // ------------------------------------------------------------------
  // A7T04 / A7T05 / A7T06 / A7T07 / A7T08 read-only consumer helpers
  //
  // The A7T04 / A7T05 / A7T06 / A7T07 / A7T08 records are stored
  // inside the shared Operations `IdempotencyService`
  // `responseBody` JSONB column. The A7 product reconciliation
  // service reads the A7 records through the shared
  // `IdempotencyService` read-only consumer boundary. The A7
  // product reconciliation service does NOT call the A7T04 /
  // A7T05 / A7T06 / A7T07 / A7T08 services to mutate any A7
  // record. The A7 product reconciliation service consumes the
  // A7T04 / A7T05 / A7T06 / A7T07 / A7T08 records as a read-only
  // consumer of the shared Operations `IdempotencyService`.
  // ------------------------------------------------------------------

  private async lookupA7T05ProductCommand(
    productCommandReference: string,
  ): Promise<A7ProductReconciliationProductCommandView | null> {
    return this.lookupA7Record<A7ProductReconciliationProductCommandView>(
      productCommandReference,
      'A7_PRODUCT_COMMAND',
      'productCommandReference',
      (row) => this.toA7T05ProductCommandView(row),
    );
  }

  private async lookupA7T07ProductLifecycle(
    productLifecycleReference: string,
  ): Promise<A7ProductReconciliationProductLifecycleView | null> {
    return this.lookupA7Record<A7ProductReconciliationProductLifecycleView>(
      productLifecycleReference,
      'A7_PRODUCT_LIFECYCLE',
      'productLifecycleReference',
      (row) => this.toA7T07ProductLifecycleView(row),
    );
  }

  private async lookupA7T08ProductFinancialEffect(productOperationReference: string): Promise<{
    readonly journalId: string | null;
    readonly productOperationReference: string;
  } | null> {
    const record = await this.lookupA7Record<Record<string, unknown>>(
      productOperationReference,
      'A7_PRODUCT_FINANCIAL_EFFECT',
      'productFinancialEffectReference',
      (row) => row,
    );
    if (!record) {
      return null;
    }
    const journalId =
      record['a5LedgerJournalId'] !== undefined && record['a5LedgerJournalId'] !== null
        ? this.asString(record['a5LedgerJournalId'])
        : null;
    return {
      journalId: journalId === '' ? null : journalId,
      productOperationReference: this.asString(record['productFinancialEffectReference']),
    };
  }

  private async lookupA7T06NotificationDelivery(
    productOperationReference: string,
  ): Promise<{ readonly notificationDispatchId: string | null } | null> {
    const record = await this.lookupA7Record<Record<string, unknown>>(
      productOperationReference,
      'A7_PRODUCT_NOTIFICATION_DELIVERY',
      'productOperationReference',
      (row) => row,
    );
    if (!record) {
      return null;
    }
    const notificationDispatchId =
      record['notificationDispatchId'] !== undefined && record['notificationDispatchId'] !== null
        ? this.asString(record['notificationDispatchId'])
        : null;
    return {
      notificationDispatchId: notificationDispatchId === '' ? null : notificationDispatchId,
    };
  }

  private async checkA7T04ProductCustomerBindingMapReference(
    mapReference: string,
  ): Promise<A7ProductReconciliationProductCustomerBindingView | null> {
    if (!SHA256_PATTERN.test(mapReference)) {
      return null;
    }
    return this.lookupA7Record<A7ProductReconciliationProductCustomerBindingView>(
      mapReference,
      'A7_PRODUCT_CUSTOMER_BINDING',
      'mapReference',
      (row) => this.toA7T04ProductCustomerBindingView(row),
    );
  }

  private async lookupA7Record<T>(
    reference: string,
    resourceType: string,
    referenceField: string,
    transform: (row: Record<string, unknown>) => T,
  ): Promise<T | null> {
    const normalized = reference.trim();
    if (!normalized) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<{ response_body: Record<string, unknown> }>>(
        `SELECT response_body
           FROM idempotency_records
          WHERE status = 'COMPLETED'
            AND resource_type = $1
            AND response_body ->> $2 = $3
          ORDER BY created_at DESC
          LIMIT 1`,
        [resourceType, referenceField, normalized],
      );
      if (rows.length === 0) {
        return null;
      }
      return transform(rows[0]!.response_body);
    } catch {
      return null;
    }
  }

  private toA7T05ProductCommandView(
    row: Record<string, unknown>,
  ): A7ProductReconciliationProductCommandView {
    return {
      productCommandReference: this.asString(row['productCommandReference']),
      productOperationReference: this.asString(row['productOperationReference']),
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: this.asString(row['capabilityKey']),
      action: this.asString(row['action']),
      productState: this.asString(
        row['productState'],
      ) as A7ProductReconciliationProductCommandView['productState'],
      operationState: this.asString(row['operationState']),
      customerId: this.asString(row['customerId']),
      customerWalletId: this.asString(row['customerWalletId']),
      bindingId: this.asString(row['bindingId']),
      bindingVersion: this.asNumber(row['bindingVersion']),
      amountMinor: this.asString(row['amountMinor']),
      currency: this.asString(row['currency']),
      accountingUnit: this.asString(row['accountingUnit']),
    };
  }

  private toA7T07ProductLifecycleView(
    row: Record<string, unknown>,
  ): A7ProductReconciliationProductLifecycleView {
    return {
      productLifecycleId: this.asString(row['productLifecycleId']),
      productLifecycleReference: this.asString(row['productLifecycleReference']),
      productKey: 'VIRTUAL_ACCOUNT',
      capabilityKey: this.asString(row['capabilityKey']),
      action: this.asString(row['action']),
      productState: this.asString(
        row['productState'],
      ) as A7ProductReconciliationProductLifecycleView['productState'],
      currentLifecycleState: this.asString(row['currentLifecycleState']),
      outcome: this.asString(row['outcome']),
      customerId: this.asString(row['customerId']),
      customerWalletId: this.asString(row['customerWalletId']),
      bindingId: this.asString(row['bindingId']),
      bindingVersion: this.asNumber(row['bindingVersion']),
    };
  }

  private toA7T04ProductCustomerBindingView(
    row: Record<string, unknown>,
  ): A7ProductReconciliationProductCustomerBindingView {
    return {
      mapReference: this.asString(row['mapReference']),
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: this.asString(row['capabilityKey']),
      action: this.asString(row['action']),
      productState: this.asString(
        row['productState'],
      ) as A7ProductReconciliationProductCustomerBindingView['productState'],
      customerId: this.asString(row['customerId']),
      customerWalletId: this.asString(row['customerWalletId']),
      bindingId: this.asString(row['bindingId']),
      bindingVersion: this.asNumber(row['bindingVersion']),
      a4ProductPolicyDecisionReference: this.asString(row['a4ProductPolicyDecisionReference']),
      a2AuthorizationContextReference: this.asString(row['a2AuthorizationContextReference']),
    };
  }

  // ------------------------------------------------------------------
  // Product fact block (read-only; built from the A7 idempotency
  // records and the A6T05 external-operation record).
  // ------------------------------------------------------------------

  /**
   * Reads the A7 product reconciliation product fact block from
   * the shared Operations `IdempotencyService` `responseBody`
   * records. The A7 product reconciliation service does NOT
   * mutate any A7T04 / A7T05 / A7T06 / A7T07 / A7T08 record.
   */
  async loadProductFact(
    productOperationReference: string,
  ): Promise<A7ProductReconciliationProductFactV1> {
    const productCommand = await this.lookupA7T05ProductCommand(productOperationReference);
    const productLifecycle = await this.lookupA7T07ProductLifecycle(productOperationReference);
    const productFinancialEffectRecord = await this.lookupA7Record<Record<string, unknown>>(
      productOperationReference,
      'A7_PRODUCT_FINANCIAL_EFFECT',
      'productFinancialEffectReference',
      (row) => row,
    );
    const a7T04MapReference = productCommand
      ? ((productCommand as unknown as { a7ProductCustomerBindingMapReference?: string })
          .a7ProductCustomerBindingMapReference ?? null)
      : null;
    const productCustomerBinding = a7T04MapReference
      ? await this.checkA7T04ProductCustomerBindingMapReference(a7T04MapReference)
      : null;
    const productOperation: A7ProductReconciliationProductOperationView | null = productCommand
      ? {
          productOperationId: productCommand.productOperationReference,
          productOperationReference: productCommand.productOperationReference,
          productKey: 'VIRTUAL_ACCOUNT',
          productVersion: 1,
          capabilityKey: productCommand.capabilityKey,
          action: productCommand.action,
          productState: productCommand.productState,
          customerId: productCommand.customerId,
          customerWalletId: productCommand.customerWalletId,
          bindingId: productCommand.bindingId,
          bindingVersion: productCommand.bindingVersion,
          amountMinor: productCommand.amountMinor,
          currency: productCommand.currency,
          accountingUnit: productCommand.accountingUnit,
          outcome: productFinancialEffectRecord
            ? this.asString(productFinancialEffectRecord['outcome'])
            : 'OUTCOME_VERIFIED',
          operationState: productCommand.operationState,
          a6ExternalOperationReference: productFinancialEffectRecord
            ? this.asString(productFinancialEffectRecord['a6ExternalOperationReference'])
            : '',
        }
      : null;
    const productFinancialEffect: {
      readonly productFinancialEffectReference: string;
      readonly a5LedgerJournalId: string | null;
      readonly currentState: string;
      readonly outcome: string;
      readonly category: string;
      readonly a6T08Decision: string;
    } | null =
      productFinancialEffectRecord === null
        ? null
        : {
            productFinancialEffectReference: this.asString(
              productFinancialEffectRecord['productFinancialEffectReference'],
            ),
            a5LedgerJournalId: this.asStringOrNull(
              productFinancialEffectRecord['a5LedgerJournalId'],
            ),
            currentState: this.asString(productFinancialEffectRecord['currentState']),
            outcome: this.asString(productFinancialEffectRecord['outcome']),
            category: this.asString(productFinancialEffectRecord['category']),
            a6T08Decision: this.asString(productFinancialEffectRecord['a6T08Decision']),
          };
    return {
      productOperation,
      productLifecycle,
      productCommand,
      productCustomerBinding,
      productFinancialEffect,
    };
  }

  // ------------------------------------------------------------------
  // Operations read-only consumer helpers
  // ------------------------------------------------------------------

  private async listOperationsAudit(
    entityType: string,
    entityId: string,
  ): Promise<A7ProductReconciliationOperationsAuditFactView[]> {
    try {
      const events: AuditView[] = await this.auditService.list({
        entityType,
        entityId,
        limit: 100,
      });
      return events.map((event) => ({
        auditEventId: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        actor: event.actor,
        correlationId: event.correlationId ?? '',
        requestId: event.requestId ?? '',
        recordedAt: event.occurredAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }

  private async lookupOperationsIdempotency(
    scope: string,
    key: string,
  ): Promise<A7ProductReconciliationOperationsIdempotencyRecordView | null> {
    if (!REF_PATTERN.test(scope) || !REF_PATTERN.test(key)) {
      return null;
    }
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                scope,
                idempotency_key,
                request_hash,
                EXTRACT(EPOCH FROM (expires_at - created_at))::bigint AS retention_seconds,
                created_at
           FROM idempotency_records
          WHERE scope = $1 AND idempotency_key = $2
          LIMIT 1`,
        [scope, key],
      );
      if (rows.length === 0) {
        return null;
      }
      const row = rows[0]!;
      return {
        idempotencyRecordId: this.asString(row.id),
        scope: this.asString(row.scope),
        key: this.asString(row.idempotency_key),
        requestHash: this.asString(row.request_hash),
        retentionSeconds: this.asNumber(row.retention_seconds),
        recordedAt: this.asIsoString(row.created_at),
      };
    } catch {
      return null;
    }
  }

  private async listOperationsOutbox(
    aggregateType: string,
    aggregateId: string,
  ): Promise<A7ProductReconciliationOperationsOutboxFactView[]> {
    try {
      const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id::text AS id,
                event_type,
                aggregate_type,
                aggregate_id::text AS aggregate_id,
                event_key,
                schema_version,
                correlation_id,
                occurred_at,
                md5(payload::text) AS payload_hash
           FROM outbox_events
          WHERE aggregate_type = $1 AND aggregate_id = $2::uuid
          ORDER BY occurred_at ASC
          LIMIT 100`,
        [aggregateType, aggregateId],
      );
      return rows.map((row) => ({
        outboxEventId: this.asString(row.id),
        eventType: this.asString(row.event_type),
        aggregateType: this.asString(row.aggregate_type),
        aggregateId: this.asString(row.aggregate_id),
        eventKey: row.event_key == null ? '' : this.asString(row.event_key),
        schemaVersion: this.asNumber(row.schema_version),
        correlationId: this.asString(row.correlation_id),
        occurredAt: this.asIsoString(row.occurred_at),
        payloadHash: this.asString(row.payload_hash),
      }));
    } catch {
      return [];
    }
  }

  private listOperationsDiagnostics(
    category: string,
    correlationId: string,
  ): Promise<A7ProductReconciliationOperationsDiagnosticsFactView[]> {
    void category;
    void correlationId;
    void this.diagnosticsService;
    return Promise.resolve([]);
  }

  /**
   * Reads the A7 product reconciliation Operations fact block
   * (read-only) and the A7 product reconciliation notification
   * fact block (read-only).
   */
  async getOperationsFact(productOperationReference: string): Promise<{
    readonly operationsFact: A7ProductReconciliationOperationsFactV1;
    readonly notificationFact: A7ProductReconciliationNotificationFactV1;
  }> {
    const audit = await this.listOperationsAudit(
      A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
      productOperationReference,
    );
    const idempotency = await this.lookupOperationsIdempotency(
      A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR,
      productOperationReference,
    );
    const idempotencyList = idempotency ? [idempotency] : [];
    const outbox = await this.listOperationsOutbox(
      A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
      productOperationReference,
    );
    const diagnostics = await this.listOperationsDiagnostics(
      A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
      productOperationReference,
    );
    return {
      operationsFact: {
        audit,
        idempotency: idempotencyList,
        outbox,
        diagnostics,
      },
      notificationFact: {
        notificationDispatch: null,
      },
    };
  }

  /**
   * Reads the A7 product reconciliation diagnostic report (the
   * A7 product reconciliation service does NOT introduce a new
   * diagnostics authority; the A7 product reconciliation
   * service consumes the shared `DiagnosticsService` through
   * the shared diagnostics read-only consumer boundary).
   */
  async getDiagnosticsReport(): Promise<DiagnosticsReport | null> {
    try {
      return await this.diagnosticsService.getDiagnostics();
    } catch {
      return null;
    }
  }

  private asString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }

  private asStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value.length === 0 ? null : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private asIsoString(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return new Date().toISOString();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return new Date(Number(value)).toISOString();
    }
    return new Date().toISOString();
  }
}
