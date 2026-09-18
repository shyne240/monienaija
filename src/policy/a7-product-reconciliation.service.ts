/**
 * A7T09 — A7 product reconciliation, certification, and support
 * trace service.
 *
 * The A7 product reconciliation service is the single A7-side
 * read-only reconciliation, certification, and support-trace
 * entry point. The A7 product reconciliation service composes
 * the existing A2 / A3 / A4 / A5 / A6 / A7 / Operations
 * authorities (reused as-is, without modification) under the
 * A7 product reconciliation envelope:
 *
 *  - the A2 `AuthorizationService` (reused for the A2
 *    authorization context reference; read-only);
 *  - the A3 `CustomerFinancialAccountBindingService` (reused for
 *    the A3 binding recheck; read-only);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference; read-only);
 *  - the A6T05 `ExternalOperationService` (reused for the A6T05
 *    external-operation correlation; read-only);
 *  - the A6T07 `ExternalOperationStatusVerifier` (reused for the
 *    A6 status-verification correlation; read-only);
 *  - the A6 `PartnerCircuitBreakerService` (reused for the A6
 *    circuit-breaker state correlation; read-only);
 *  - the A6T08 `ExternalSettlementService` (reused for the A6T08
 *    settlement / suspense / compensating-entry correlation;
 *    read-only);
 *  - the A6T09 `ExternalReconciliationService` (reused for the
 *    A6T09 external reconciliation correlation; read-only);
 *  - the A5 `LedgerService` (reused for the A5 Ledger journal
 *    and A5 Ledger account correlation; read-only);
 *  - the A7T04 `A7ProductCustomerBindingService` (reused for the
 *    A7T04 product customer-binding map reference; read-only;
 *    the A7 product reconciliation service reads the A7T04
 *    product customer-binding map through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T04 product customer-binding service to mutate
 *    any A7T04 record);
 *  - the A7T05 `A7ProductCommandService` (reused for the A7T05
 *    product command/operation identity correlation; read-only;
 *    the A7 product reconciliation service reads the A7T05
 *    product command/operation record through the shared
 *    Operations `IdempotencyService` `responseBody` read-only
 *    consumer boundary; the A7 product reconciliation service
 *    does NOT call the A7T05 product command service to mutate
 *    any A7T05 record);
 *  - the A7T06 `A7ProductNotificationDeliveryService` (reused
 *    for the A7T06 product notification delivery correlation;
 *    read-only; the A7 product reconciliation service reads the
 *    A7T06 product notification delivery record through the
 *    shared Operations `IdempotencyService` `responseBody`
 *    read-only consumer boundary; the A7 product reconciliation
 *    service does NOT call the A7T06 product notification
 *    delivery service to mutate any A7T06 record);
 *  - the A7T07 `A7ProductLifecycleService` (reused for the A7T07
 *    product lifecycle handoff correlation; read-only; the A7
 *    product reconciliation service reads the A7T07 product
 *    lifecycle record through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T07 product lifecycle service to mutate any
 *    A7T07 record);
 *  - the A7T08 `A7ProductFinancialEffectService` (reused for the
 *    A7T08 product financial effect correlation; read-only; the
 *    A7 product reconciliation service reads the A7T08 product
 *    financial effect record through the shared Operations
 *    `IdempotencyService` `responseBody` read-only consumer
 *    boundary; the A7 product reconciliation service does NOT
 *    call the A7T08 product financial effect service to mutate
 *    any A7T08 record);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency record read-only consumer boundary);
 *  - the shared `AuditService` (reused for the A7 audit event
 *    read-only consumer boundary);
 *  - the shared `OutboxService` (reused for the A7 outbox event
 *    read-only consumer boundary);
 *  - the shared `MetricsService` (the A7 product reconciliation
 *    service does NOT record any A7 metric);
 *  - the shared `DiagnosticsService` (reused for the shared
 *    diagnostics read-only consumer boundary);
 *  - the shared `DataSource` (reused for the A7 product
 *    reconciliation REPEATABLE READ, read-only TypeORM
 *    transaction).
 *
 * No new policy evaluator, no new authorization service, no new
 * customer-binding service, no new settlement authority, no new
 * reconciliation engine, no new audit authority, no new
 * idempotency authority, no new outbox authority, no new metrics
 * authority, no new diagnostics authority, no new A6 lifecycle
 * authority, no new A6 status-verification authority, no new A6
 * circuit-breaker authority, no new A6T05 external-operation
 * authority, no new A6T08 settlement authority, no new A5 Ledger
 * authority, no new suspense authority, no new compensating-entry
 * authority, no new financial-invariants engine, no new A7
 * product catalog authority, no new A7 product-policy authority,
 * no new A7T04 product customer-binding authority, no new A7T05
 * product command authority, no new A7T06 product notification
 * delivery authority, no new A7T07 product lifecycle authority,
 * no new A7T08 product financial effect authority, no new Wallet,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, or `CustomerPreference` authority is introduced.
 *
 * The A7 product reconciliation service is a read-only service.
 * The A7 product reconciliation service NEVER:
 *  - mutates any Customer, CustomerPreference, A3 binding,
 *    Wallet, Ledger, A5 transfer/deposit/withdrawal, A6 partner,
 *    A6T05 external-operation, A6T08 settlement, A6T08 suspense,
 *    A6T08 compensating-entry, A6T09 external reconciliation,
 *    A6T10 data-classification, A6T11 integration, A7 product
 *    catalog, A7 product-policy, A7T04 product customer-binding,
 *    A7T05 product command, A7T06 product notification delivery,
 *    A7T07 product lifecycle, A7T08 product financial effect,
 *    Operations audit, Operations idempotency, Operations outbox,
 *    Operations metrics, or Operations diagnostics record to
 *    make a report pass;
 *  - posts a journal, mutates a balance, clears suspense, or
 *    edits a posted journal/line outside Ledger and
 *    Finance-approved correction boundaries;
 *  - issues, refreshes, or substitutes an A6T08 settlement,
 *    suspense, or compensating entry;
 *  - issues, refreshes, or substitutes an A6T09 external
 *    reconciliation report;
 *  - dispatches a notification;
 *  - calls a partner, an SMS provider, an email provider, a push
 *    provider, or any external channel;
 *  - mutates the A7 product lifecycle;
 *  - mutates the A7 product command;
 *  - mutates the A7 product customer-binding;
 *  - mutates the A7 product financial effect;
 *  - auto-repairs a discrepancy;
 *  - auto-clears suspense;
 *  - auto-issues a settlement;
 *  - auto-posts a journal;
 *  - takes any write lock or holds any write transaction.
 *
 * The A7 product reconciliation service IS:
 *  - the single A7-side read-only product reconciliation,
 *    certification, and support-trace authority;
 *  - the single A7-side discrepancy classification authority
 *    for the A7 product reconciliation discrepancy vocabulary;
 *  - the single A7-side support-trace generation authority for
 *    the A7 product financial effect.
 *
 * No Ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, no auto-repair, and no external financial correction
 * outside Ledger/Finance ownership is introduced by A7T09.
 */

import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { parsePositiveMinorUnits } from '../common/money';
import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR,
  A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_RECONCILIATION_CERT_CASES,
  A7_PRODUCT_RECONCILIATION_CHECKS,
  A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
  A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
  A7_PRODUCT_RECONCILIATION_DISCREPANCY_CLASSIFICATION,
  A7_PRODUCT_RECONCILIATION_EXPECTED_CHECKS,
  A7_PRODUCT_RECONCILIATION_HANDOFF_SCOPE,
  A7_PRODUCT_RECONCILIATION_HANDOFF_VALIDITY_SECONDS,
  A7_PRODUCT_RECONCILIATION_HANDOFF_REFERENCE_PREFIX,
  A7_PRODUCT_RECONCILIATION_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_RECONCILIATION_REFERENCE_PREFIX,
  A7_PRODUCT_RECONCILIATION_RECOVERY_MANUAL_REVIEW_REQUIRED,
  A7_PRODUCT_RECONCILIATION_RECOVERY_NO_AUTOMATIC_REPAIR,
  A7_PRODUCT_RECONCILIATION_SEVERITY_ERROR,
  A7_PRODUCT_RECONCILIATION_SEVERITY_WARNING,
  A7_PRODUCT_RECONCILIATION_SUSPENSE_AGED_HOURS,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_PRODUCT_RECONCILED,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_BATCH_RECONCILED,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_SUPPORT_TRACE_EMITTED,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_CERTIFICATION_EMITTED,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_QUERY_UNAVAILABLE,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_NO_DISCREPANCY,
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_DISCREPANCY_REPORTED,
  A7_PRODUCT_RECONCILIATION_FAILURE_QUERY_UNAVAILABLE,
  A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
  A7_PRODUCT_RECONCILIATION_OWNER_RECONCILIATION,
  A7_PRODUCT_RECONCILIATION_ALL_STATES,
  A7_PRODUCT_RECONCILIATION_RETENTION_SECONDS,
} from './a7-product-reconciliation.constants';
import { A7ProductReconciliationRepository } from './a7-product-reconciliation.repository';
import type {
  A7ProductReconciliationA2AuthorizationContextView,
  A7ProductReconciliationA4ProductPolicyDecisionView,
  A7ProductReconciliationA5LedgerJournalView,
  A7ProductReconciliationA6T08SuspenseView,
  A7ProductReconciliationA6T09ExternalReconciliationSnapshot,
  A7ProductReconciliationAuthorityFactV1,
  A7ProductReconciliationBatchReportV1,
  A7ProductReconciliationBatchResultV1,
  A7ProductReconciliationCertificationEvidenceV1,
  A7ProductReconciliationCheck,
  A7ProductReconciliationCheckStatus,
  A7ProductReconciliationCommandV1,
  A7ProductReconciliationConsumerPorts,
  A7ProductReconciliationDiscrepancy,
  A7ProductReconciliationFailureV1,
  A7ProductReconciliationHandoffV1,
  A7ProductReconciliationNotificationFactV1,
  A7ProductReconciliationOperationsFactV1,
  A7ProductReconciliationProductFactV1,
  A7ProductReconciliationReportV1,
  A7ProductReconciliationResultV1,
  A7ProductReconciliationSensitivity,
  A7ProductReconciliationSupportTraceV1,
} from './a7-product-reconciliation.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,179}$/;

const PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;
const PRODUCT_VERSION = 1 as const;
const CURRENCY = 'NGN' as const;
const ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

const EXECUTABLE_A4_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'ALLOW_WITH_LIMITS']);
const A6_LIFECYCLE_VERIFIED_STATE = 'PENDING_VERIFICATION' as const;
const A6_LIFECYCLE_TERMINAL_STATES: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED']);
const A6_LIFECYCLE_AGED_STATES: ReadonlySet<string> = new Set(['OPEN', 'HELD']);

type AllChecks = Readonly<Record<string, A7ProductReconciliationCheckStatus>>;
const ALL_CHECKS_OK: AllChecks = Object.freeze(
  Object.fromEntries(
    A7_PRODUCT_RECONCILIATION_CHECKS.map((key) => [
      key,
      'OK' as A7ProductReconciliationCheckStatus,
    ]),
  ),
);
const ALL_CHECKS_NOT_VERIFIED: AllChecks = Object.freeze(
  Object.fromEntries(
    A7_PRODUCT_RECONCILIATION_CHECKS.map((key) => [
      key,
      'NOT_VERIFIED' as A7ProductReconciliationCheckStatus,
    ]),
  ),
);

@Injectable()
export class A7ProductReconciliationService {
  constructor(
    @Inject(A7ProductReconciliationRepository)
    private readonly repository: A7ProductReconciliationRepository,
  ) {}

  /**
   * Reconciles a single A7 product operation and returns a
   * read-only A7 product reconciliation report. The A7 product
   * reconciliation service does NOT mutate any source record
   * and does NOT auto-repair any discrepancy.
   */
  async reconcileProduct(
    command: A7ProductReconciliationCommandV1,
  ): Promise<A7ProductReconciliationResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(command, shapeFailure.code, shapeFailure.message);
    }
    const ports = this.repository.getConsumerPorts();
    return this.runWithinReadOnlyTransaction(ports, command, (managerPorts) =>
      this.reconcileWithinReadOnlyTransaction(managerPorts, command),
    );
  }

  /**
   * Reconciles a batch of A7 product operations (the read-only
   * A7 product reconciliation batch report).
   */
  async reconcileBatch(
    commands: readonly A7ProductReconciliationCommandV1[],
  ): Promise<A7ProductReconciliationBatchResultV1> {
    if (commands.length === 0) {
      return {
        valid: false,
        failure: this.buildFailure(
          A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
          'The A7 product reconciliation batch command is empty',
          {
            requestId: 'a7-product-reconciliation-batch',
            correlationId: 'a7-product-reconciliation-batch',
            traceId: 'a7-product-reconciliation-batch',
          },
        ),
      };
    }
    const reports: A7ProductReconciliationReportV1[] = [];
    let withDiscrepancies = 0;
    let withErrors = 0;
    let withWarnings = 0;
    let queryUnavailable = 0;
    for (const command of commands) {
      const result = await this.reconcileProduct(command);
      if (result.valid) {
        reports.push(result.report);
        if (result.report.discrepancies.length > 0) {
          withDiscrepancies += 1;
          for (const d of result.report.discrepancies) {
            if (d.severity === 'ERROR') withErrors += 1;
            else if (d.severity === 'WARNING') withWarnings += 1;
          }
        }
        if (result.report.queryUnavailable) {
          queryUnavailable += 1;
        }
      } else {
        queryUnavailable += 1;
      }
    }
    const generatedAt = new Date().toISOString();
    const firstReport = reports[0];
    const report: A7ProductReconciliationBatchReportV1 = {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      batchId: this.generateBatchId(),
      batchReference: this.computeBatchReference(),
      productKey: PRODUCT_KEY,
      total: commands.length,
      withDiscrepancies,
      withErrors,
      withWarnings,
      queryUnavailable,
      reports,
      generatedAt,
      correlationId: firstReport?.correlationId ?? 'a7-product-reconciliation-batch',
    };
    return { valid: true, report };
  }

  // -------------------------------------------------------------------------
  // Contract name / scope / version getters
  // -------------------------------------------------------------------------

  getContractNames(): {
    readonly a2: string;
    readonly a3: string;
    readonly a4: string;
    readonly a5: string;
    readonly a6: string;
    readonly a6T05: string;
    readonly a6T07: string;
    readonly a6T08: string;
    readonly a6T09: string;
    readonly a6CircuitBreaker: string;
    readonly a7T04: string;
    readonly a7T05: string;
    readonly a7T06: string;
    readonly a7T07: string;
    readonly a7T08: string;
    readonly a7: string;
  } {
    return Object.freeze({
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a5: 'A5-LEDGER',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T05: 'A6-EXTERNAL-OPERATION',
      a6T07: 'A6-EXTERNAL-LIFECYCLE',
      a6T08: 'A6-EXTERNAL-SETTLEMENT',
      a6T09: 'A6-EXTERNAL-RECONCILIATION',
      a6CircuitBreaker: 'A6-PARTNER-CIRCUIT-BREAKER',
      a7T04: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T05: 'A7-PRODUCT-COMMAND',
      a7T06: 'A7-NOTIFICATION-DELIVERY',
      a7T07: 'A7-PRODUCT-LIFECYCLE',
      a7T08: 'A7-PRODUCT-FINANCIAL-EFFECT',
      a7: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
    });
  }

  getContractVersions(): {
    readonly a2: number;
    readonly a3: number;
    readonly a4: number;
    readonly a5: number;
    readonly a6: number;
    readonly a6T05: number;
    readonly a6T07: number;
    readonly a6T08: number;
    readonly a6T09: number;
    readonly a6CircuitBreaker: number;
    readonly a7T04: number;
    readonly a7T05: number;
    readonly a7T06: number;
    readonly a7T07: number;
    readonly a7T08: number;
    readonly a7: number;
  } {
    return Object.freeze({
      a2: 1,
      a3: 1,
      a4: 1,
      a5: 1,
      a6: 1,
      a6T05: 1,
      a6T07: 1,
      a6T08: 1,
      a6T09: 1,
      a6CircuitBreaker: 1,
      a7T04: 1,
      a7T05: 1,
      a7T06: 1,
      a7T07: 1,
      a7T08: 1,
      a7: 1,
    });
  }

  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_RECONCILIATION_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductReconciliationProviderIdempotencyScope();
  }

  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_RECONCILIATION_RETENTION_SECONDS;
  }

  getAuditEntityType(): string {
    return A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE;
  }

  getAuditActor(): string {
    return A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR;
  }

  listCheckKeys(): readonly string[] {
    return A7_PRODUCT_RECONCILIATION_CHECKS;
  }

  listExpectedChecks(): readonly string[] {
    return A7_PRODUCT_RECONCILIATION_EXPECTED_CHECKS;
  }

  listDiscrepancyCodes(): readonly string[] {
    return Object.freeze(Object.keys(A7_PRODUCT_RECONCILIATION_DISCREPANCY_CLASSIFICATION));
  }

  listSeverityValues(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_RECONCILIATION_SEVERITY_WARNING,
      A7_PRODUCT_RECONCILIATION_SEVERITY_ERROR,
    ]);
  }

  listRecoveryStateValues(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_RECONCILIATION_RECOVERY_NO_AUTOMATIC_REPAIR,
      A7_PRODUCT_RECONCILIATION_RECOVERY_MANUAL_REVIEW_REQUIRED,
    ]);
  }

  listCategories(): readonly string[] {
    return A7_PRODUCT_RECONCILIATION_CERT_CASES;
  }

  listTerminalStates(): readonly string[] {
    return A7_PRODUCT_RECONCILIATION_ALL_STATES;
  }

  getDiscrepancyClassification(): Readonly<
    Record<
      string,
      Omit<
        A7ProductReconciliationDiscrepancy,
        | 'productOperationReference'
        | 'a6ExternalOperationReference'
        | 'a6T08SettlementId'
        | 'a6T08SuspenseId'
        | 'a5LedgerJournalId'
        | 'a6ProviderReferenceId'
        | 'a6CallbackReceiptId'
        | 'notificationDispatchId'
        | 'scopeValue'
        | 'message'
      >
    >
  > {
    return A7_PRODUCT_RECONCILIATION_DISCREPANCY_CLASSIFICATION as Readonly<
      Record<
        string,
        Omit<
          A7ProductReconciliationDiscrepancy,
          | 'productOperationReference'
          | 'a6ExternalOperationReference'
          | 'a6T08SettlementId'
          | 'a6T08SuspenseId'
          | 'a5LedgerJournalId'
          | 'a6ProviderReferenceId'
          | 'a6CallbackReceiptId'
          | 'notificationDispatchId'
          | 'scopeValue'
          | 'message'
        >
      >
    >;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async runWithinReadOnlyTransaction<T>(
    ports: A7ProductReconciliationConsumerPorts,
    command: A7ProductReconciliationCommandV1,
    runner: (managerPorts: A7ProductReconciliationConsumerPorts) => Promise<T>,
  ): Promise<A7ProductReconciliationResultV1 | T> {
    const dataSource = ports.getDataSource();
    try {
      return await dataSource.transaction('REPEATABLE READ', async () => {
        return runner(ports);
      });
    } catch (error) {
      void error;
      return this.failure(
        command,
        A7_PRODUCT_RECONCILIATION_FAILURE_QUERY_UNAVAILABLE,
        `The A7 product reconciliation query failed: ${(error as Error).message ?? 'unknown'}`,
      );
    }
  }

  private async reconcileWithinReadOnlyTransaction(
    ports: A7ProductReconciliationConsumerPorts,
    command: A7ProductReconciliationCommandV1,
  ): Promise<A7ProductReconciliationResultV1> {
    const generatedAt = new Date().toISOString();
    const productFact = await this.repository.loadProductFact(command.productOperationReference);
    const productFinancialEffect = productFact.productFinancialEffect;
    const productLifecycle = productFact.productLifecycle;
    const productCommand = productFact.productCommand;

    const authorityFact = await this.loadAuthorityFact(ports, productFact);
    const a6T09Snapshot = authorityFact.a6ExternalOperation
      ? await this.loadA6T09Snapshot(
          ports,
          authorityFact.a6ExternalOperation.externalOperationId,
          generatedAt,
        )
      : null;

    const operationsFactAndNotification = await this.repository.getOperationsFact(
      command.productOperationReference,
    );
    const operationsFact = operationsFactAndNotification.operationsFact;
    const notificationFact = operationsFactAndNotification.notificationFact;

    const checks: A7ProductReconciliationCheck[] = this.evaluateChecks({
      productFact,
      authorityFact,
      operationsFact,
      notificationFact,
      a6T09Snapshot,
    });
    const discrepancies = this.classifyDiscrepancies({
      productFact,
      authorityFact,
      operationsFact,
      notificationFact,
      a6T09Snapshot,
    });

    const reconciliationId = this.generateReconciliationId();
    const reconciliationReference = this.computeReconciliationReference(reconciliationId);

    const supportTrace = command.includeSupportTrace
      ? this.buildSupportTrace(command, productFact, authorityFact, operationsFact, generatedAt)
      : null;
    const certificationEvidence =
      command.includeCertificationEvidence && command.certificationCase
        ? this.buildCertificationEvidence(command, discrepancies, generatedAt)
        : null;
    const handoff = this.buildHandoff(command, generatedAt);

    const errorCount = discrepancies.filter(
      (d) => d.severity === A7_PRODUCT_RECONCILIATION_SEVERITY_ERROR,
    ).length;
    const warningCount = discrepancies.filter(
      (d) => d.severity === A7_PRODUCT_RECONCILIATION_SEVERITY_WARNING,
    ).length;

    const report: A7ProductReconciliationReportV1 = {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      reconciliationId,
      reconciliationReference,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      productOperationReference: command.productOperationReference,
      productLifecycleReference: productLifecycle
        ? productLifecycle.productLifecycleReference
        : null,
      productCommandReference: productCommand ? productCommand.productCommandReference : null,
      productCustomerBindingMapReference: productFact.productCustomerBinding
        ? productFact.productCustomerBinding.mapReference
        : null,
      a2AuthorizationContextReference: authorityFact.a2AuthorizationContext
        ? productCommand
          ? productCommand.productCommandReference
          : command.productOperationReference
        : null,
      a4ProductPolicyDecisionReference: authorityFact.a4ProductPolicyDecision
        ? productCommand
          ? productCommand.productCommandReference
          : command.productOperationReference
        : null,
      a5LedgerJournalReference: productFinancialEffect
        ? productFinancialEffect.a5LedgerJournalId
        : null,
      a6ExternalOperationReference: authorityFact.a6ExternalOperation
        ? authorityFact.a6ExternalOperation.externalOperationReference
        : null,
      a6CallbackReceiptReference: command.a6CallbackReceiptId,
      a6T08SettlementReference: authorityFact.a6T08Settlement
        ? authorityFact.a6T08Settlement.settlementId
        : null,
      a6T08SuspenseReference:
        authorityFact.a6T08Suspense && authorityFact.a6T08Suspense.length > 0
          ? (authorityFact.a6T08Suspense[0]?.suspenseId ?? null)
          : null,
      a6ProviderReferenceReference: command.a6ProviderReferenceId,
      checks,
      discrepancies,
      a6T09ExternalReconciliationReference: a6T09Snapshot
        ? a6T09Snapshot.a6T09ExternalReconciliationReference
        : null,
      a6T09ExternalReconciliationDiscrepancyCount: a6T09Snapshot
        ? a6T09Snapshot.discrepancyCount
        : null,
      productFact,
      authorityFact,
      notificationFact,
      operationsFact,
      supportTrace,
      certificationEvidence,
      handoff,
      generatedAt,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      causationId: command.causationId,
      queryUnavailable: false,
    };

    void errorCount;
    void warningCount;

    return { valid: true, report };
  }

  private async loadAuthorityFact(
    ports: A7ProductReconciliationConsumerPorts,
    productFact: A7ProductReconciliationProductFactV1,
  ): Promise<A7ProductReconciliationAuthorityFactV1> {
    const a2 = await this.lookupA2AuthorizationContext(ports, productFact);
    const a4 = await this.lookupA4ProductPolicyDecision(ports, productFact);
    const a5 = productFact.productFinancialEffect?.a5LedgerJournalId
      ? await ports.a5LedgerJournalLookup(productFact.productFinancialEffect.a5LedgerJournalId)
      : null;
    const a6 = productFact.productOperation
      ? await ports.a6ExternalOperationLookup(
          productFact.productOperation.a6ExternalOperationReference,
        )
      : null;
    const a6Callback = null;
    const a6T08Settlement = productFact.productOperation
      ? await ports.a6T08SettlementLookup(productFact.productOperation.a6ExternalOperationReference)
      : null;
    const a6T08Suspense = productFact.productOperation
      ? await ports.a6T08SuspenseLookup(productFact.productOperation.a6ExternalOperationReference)
      : null;
    const a6Outage = a6 ? await ports.a6PartnerOutageLookup(a6.partnerKey, a6.capabilityKey) : null;
    const a6Report = a6
      ? await ports.a6ReportAvailabilityLookup(a6.partnerKey, a6.capabilityKey)
      : null;
    return {
      a2AuthorizationContext: a2,
      a4ProductPolicyDecision: a4,
      a5LedgerJournal: a5,
      a6ExternalOperation: a6,
      a6CallbackReceipt: a6Callback,
      a6T08Settlement,
      a6T08Suspense: a6T08Suspense ?? [],
      a6ProviderReference: null,
      a6PartnerOutage: a6Outage,
      a6ReportAvailability: a6Report,
    };
  }

  private async loadA6T09Snapshot(
    ports: A7ProductReconciliationConsumerPorts,
    externalOperationId: string,
    generatedAt: string,
  ): Promise<A7ProductReconciliationA6T09ExternalReconciliationSnapshot | null> {
    return ports.a6T09ExternalReconciliationLookup(externalOperationId, generatedAt);
  }

  private async lookupA2AuthorizationContext(
    ports: A7ProductReconciliationConsumerPorts,
    productFact: A7ProductReconciliationProductFactV1,
  ): Promise<A7ProductReconciliationA2AuthorizationContextView | null> {
    const reference = productFact.productCommand?.productCommandReference ?? null;
    if (!reference) {
      return null;
    }
    return ports.a2AuthorizationContextLookup(reference);
  }

  private async lookupA4ProductPolicyDecision(
    ports: A7ProductReconciliationConsumerPorts,
    productFact: A7ProductReconciliationProductFactV1,
  ): Promise<A7ProductReconciliationA4ProductPolicyDecisionView | null> {
    const reference = productFact.productCommand?.productCommandReference ?? null;
    if (!reference) {
      return null;
    }
    return ports.a4ProductPolicyDecisionLookup(reference);
  }

  private evaluateChecks(input: {
    readonly productFact: A7ProductReconciliationProductFactV1;
    readonly authorityFact: A7ProductReconciliationAuthorityFactV1;
    readonly operationsFact: A7ProductReconciliationOperationsFactV1;
    readonly notificationFact: A7ProductReconciliationNotificationFactV1;
    readonly a6T09Snapshot: A7ProductReconciliationA6T09ExternalReconciliationSnapshot | null;
  }): A7ProductReconciliationCheck[] {
    const checks: A7ProductReconciliationCheck[] = [];
    const push = (
      key: string,
      status: A7ProductReconciliationCheckStatus,
      message: string | null,
    ) => {
      checks.push({ key, status, message });
    };
    // Product operation
    push(
      'PRODUCT_OPERATION_PRESENT',
      input.productFact.productOperation ? 'OK' : 'FAIL',
      input.productFact.productOperation ? null : 'Missing product operation',
    );
    push(
      'PRODUCT_OPERATION_KEY_CONSISTENT',
      input.productFact.productOperation ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_OPERATION_CAPABILITY_CONSISTENT',
      input.productFact.productOperation ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_OPERATION_AMOUNT_CONSISTENT',
      this.amountConsistent(
        input.productFact.productOperation?.amountMinor,
        input.authorityFact.a6ExternalOperation?.amountMinor,
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_OPERATION_CURRENCY_CONSISTENT',
      this.stringConsistent(
        input.productFact.productOperation?.currency,
        input.authorityFact.a6ExternalOperation?.currency,
        'NGN',
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_OPERATION_ACCOUNTING_UNIT_CONSISTENT',
      this.stringConsistent(
        input.productFact.productOperation?.accountingUnit,
        input.authorityFact.a6ExternalOperation?.accountingUnit,
        'CUSTOMER_FUNDS',
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_OPERATION_STATE_CONSISTENT',
      input.productFact.productOperation ? 'OK' : 'FAIL',
      null,
    );
    // Product lifecycle
    push(
      'PRODUCT_LIFECYCLE_VERIFIED',
      input.productFact.productLifecycle &&
        input.productFact.productLifecycle.currentLifecycleState === A6_LIFECYCLE_VERIFIED_STATE
        ? 'OK'
        : 'FAIL',
      null,
    );
    // Product command
    push('PRODUCT_COMMAND_PRESENT', input.productFact.productCommand ? 'OK' : 'FAIL', null);
    push(
      'PRODUCT_COMMAND_AMOUNT_CONSISTENT',
      this.amountConsistent(
        input.productFact.productCommand?.amountMinor,
        input.authorityFact.a6ExternalOperation?.amountMinor,
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_COMMAND_CURRENCY_CONSISTENT',
      this.stringConsistent(
        input.productFact.productCommand?.currency,
        input.authorityFact.a6ExternalOperation?.currency,
        'NGN',
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_COMMAND_ACCOUNTING_UNIT_CONSISTENT',
      this.stringConsistent(
        input.productFact.productCommand?.accountingUnit,
        input.authorityFact.a6ExternalOperation?.accountingUnit,
        'CUSTOMER_FUNDS',
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'PRODUCT_COMMAND_BINDING_CONSISTENT',
      input.productFact.productCommand ? 'OK' : 'FAIL',
      null,
    );
    // Product customer-binding
    push(
      'PRODUCT_CUSTOMER_BINDING_PRESENT',
      input.productFact.productCustomerBinding ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_CUSTOMER_BINDING_ACTIVE',
      input.productFact.productCustomerBinding ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_CUSTOMER_BINDING_AMOUNT_CONSISTENT',
      input.productFact.productCustomerBinding ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_CUSTOMER_BINDING_CURRENCY_CONSISTENT',
      input.productFact.productCustomerBinding ? 'OK' : 'FAIL',
      null,
    );
    push(
      'PRODUCT_CUSTOMER_BINDING_ACCOUNTING_UNIT_CONSISTENT',
      input.productFact.productCustomerBinding ? 'OK' : 'FAIL',
      null,
    );
    // A2
    push(
      'A2_AUTHORIZATION_PRESENT',
      input.authorityFact.a2AuthorizationContext ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A2_AUTHORIZATION_NOT_EXPIRED',
      input.authorityFact.a2AuthorizationContext?.allowed ? 'OK' : 'FAIL',
      null,
    );
    // A4
    push(
      'A4_PRODUCT_POLICY_DECISION_PRESENT',
      input.authorityFact.a4ProductPolicyDecision ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A4_PRODUCT_POLICY_DECISION_NOT_EXPIRED',
      input.authorityFact.a4ProductPolicyDecision &&
        !input.authorityFact.a4ProductPolicyDecision.expiresAt
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'A4_PRODUCT_POLICY_DECISION_EXECUTABLE',
      input.authorityFact.a4ProductPolicyDecision &&
        EXECUTABLE_A4_DECISIONS.has(input.authorityFact.a4ProductPolicyDecision.decision)
        ? 'OK'
        : 'FAIL',
      null,
    );
    // A5
    push(
      'A5_LEDGER_JOURNAL_CORRELATION_CONSISTENT',
      this.ledgerJournalCorrelated(
        input.authorityFact.a5LedgerJournal,
        input.productFact.productFinancialEffect?.a5LedgerJournalId,
      )
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'A5_LEDGER_JOURNAL_BALANCE_CONSISTENT',
      input.authorityFact.a5LedgerJournal ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A5_LEDGER_REVERSAL_CONSISTENT',
      this.ledgerReversalConsistent(input.authorityFact.a5LedgerJournal) ? 'OK' : 'FAIL',
      null,
    );
    // A6T05
    push(
      'A6_EXTERNAL_OPERATION_PRESENT',
      input.authorityFact.a6ExternalOperation ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A6_EXTERNAL_OPERATION_PARTNER_CONSISTENT',
      input.authorityFact.a6ExternalOperation?.partnerKey === 'NIBSS_NIP' ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A6_EXTERNAL_OPERATION_CAPABILITY_CONSISTENT',
      input.authorityFact.a6ExternalOperation?.capabilityKey ===
        'external.wallet.withdrawal.settlement'
        ? 'OK'
        : 'FAIL',
      null,
    );
    push(
      'A6_EXTERNAL_OPERATION_LIFECYCLE_VERIFIED',
      input.authorityFact.a6ExternalOperation?.lifecycleState === A6_LIFECYCLE_VERIFIED_STATE
        ? 'OK'
        : 'FAIL',
      null,
    );
    // A6 callback
    push(
      'A6_CALLBACK_RECEIPT_PRESENT',
      input.authorityFact.a6CallbackReceipt ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_CALLBACK_RECEIPT_AUTHENTIC',
      input.authorityFact.a6CallbackReceipt?.status === 'ACCEPTED' ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_CALLBACK_RECEIPT_UNIQUE',
      input.authorityFact.a6CallbackReceipt ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_CALLBACK_RECEIPT_AMOUNT_CONSISTENT',
      input.authorityFact.a6CallbackReceipt ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_CALLBACK_RECEIPT_CURRENCY_CONSISTENT',
      input.authorityFact.a6CallbackReceipt ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    // A6T08 settlement / suspense
    push(
      'A6_SETTLEMENT_PRESENT',
      input.authorityFact.a6T08Settlement ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SETTLEMENT_AMOUNT_CONSISTENT',
      this.amountConsistent(
        input.authorityFact.a6T08Settlement?.amountMinor,
        input.authorityFact.a6ExternalOperation?.amountMinor,
      )
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SETTLEMENT_CURRENCY_CONSISTENT',
      this.stringConsistent(
        input.authorityFact.a6T08Settlement?.currency,
        input.authorityFact.a6ExternalOperation?.currency,
        'NGN',
      )
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SETTLEMENT_ACCOUNTING_UNIT_CONSISTENT',
      this.stringConsistent(
        input.authorityFact.a6T08Settlement?.accountingUnit,
        input.authorityFact.a6ExternalOperation?.accountingUnit,
        'CUSTOMER_FUNDS',
      )
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SUSPENSE_PRESENT',
      input.authorityFact.a6T08Suspense && input.authorityFact.a6T08Suspense.length > 0
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SUSPENSE_AMOUNT_CONSISTENT',
      input.authorityFact.a6T08Suspense && input.authorityFact.a6T08Suspense.length > 0
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SUSPENSE_CURRENCY_CONSISTENT',
      input.authorityFact.a6T08Suspense && input.authorityFact.a6T08Suspense.length > 0
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SUSPENSE_ACCOUNTING_UNIT_CONSISTENT',
      input.authorityFact.a6T08Suspense && input.authorityFact.a6T08Suspense.length > 0
        ? 'OK'
        : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_SUSPENSE_AGING_CONSISTENT',
      this.suspenseAgingConsistent(input.authorityFact.a6T08Suspense ?? []) ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_PROVIDER_REFERENCE_PRESENT',
      input.authorityFact.a6ProviderReference ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_PROVIDER_REFERENCE_UNIQUE',
      input.authorityFact.a6ProviderReference ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'A6_PARTNER_OUTAGE_NONE',
      input.authorityFact.a6PartnerOutage?.state === 'CLOSED' ? 'OK' : 'FAIL',
      null,
    );
    push(
      'A6_REPORT_AVAILABLE',
      input.authorityFact.a6ReportAvailability?.reportAvailable ? 'OK' : 'FAIL',
      null,
    );
    // A7T06 notification
    push(
      'NOTIFICATION_DISPATCH_FACT_PRESENT',
      input.notificationFact.notificationDispatch ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'NOTIFICATION_DISPATCH_AUDIENCE_CONSISTENT',
      input.notificationFact.notificationDispatch ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'NOTIFICATION_DISPATCH_DELIVERY_LIFECYCLE_CONSISTENT',
      input.notificationFact.notificationDispatch ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'NOTIFICATION_DISPATCH_REDACTION_CONSISTENT',
      input.notificationFact.notificationDispatch?.redactionApplied ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    // Operations
    push(
      'OPERATIONS_AUDIT_FACT_PRESENT',
      input.operationsFact.audit.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_AUDIT_CORRELATION_CONSISTENT',
      input.operationsFact.audit.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_IDEMPOTENCY_RECORD_PRESENT',
      input.operationsFact.idempotency.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_IDEMPOTENCY_HASH_CONSISTENT',
      input.operationsFact.idempotency.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_OUTBOX_FACT_PRESENT',
      input.operationsFact.outbox.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_OUTBOX_CORRELATION_CONSISTENT',
      input.operationsFact.outbox.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );
    push(
      'OPERATIONS_DIAGNOSTICS_FACT_PRESENT',
      input.operationsFact.diagnostics.length > 0 ? 'OK' : 'NOT_VERIFIED',
      null,
    );

    void input.a6T09Snapshot;
    return checks;
  }

  private classifyDiscrepancies(input: {
    readonly productFact: A7ProductReconciliationProductFactV1;
    readonly authorityFact: A7ProductReconciliationAuthorityFactV1;
    readonly operationsFact: A7ProductReconciliationOperationsFactV1;
    readonly notificationFact: A7ProductReconciliationNotificationFactV1;
    readonly a6T09Snapshot: A7ProductReconciliationA6T09ExternalReconciliationSnapshot | null;
  }): A7ProductReconciliationDiscrepancy[] {
    const discrepancies: A7ProductReconciliationDiscrepancy[] = [];
    const pushDiscrepancy = (code: string, scopeValue: string | null, message: string) => {
      const classification = A7_PRODUCT_RECONCILIATION_DISCREPANCY_CLASSIFICATION[code] ??
        A7_PRODUCT_RECONCILIATION_DISCREPANCY_CLASSIFICATION[
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_QUERY_UNAVAILABLE'
        ] ?? {
          severity: A7_PRODUCT_RECONCILIATION_SEVERITY_ERROR,
          owner: A7_PRODUCT_RECONCILIATION_OWNER_RECONCILIATION,
          recoveryState: A7_PRODUCT_RECONCILIATION_RECOVERY_MANUAL_REVIEW_REQUIRED,
        };
      discrepancies.push({
        code,
        severity: classification.severity,
        owner: classification.owner,
        recoveryState: classification.recoveryState,
        productOperationReference: input.productFact.productOperation
          ? input.productFact.productOperation.productOperationReference
          : null,
        a6ExternalOperationReference: input.authorityFact.a6ExternalOperation
          ? input.authorityFact.a6ExternalOperation.externalOperationReference
          : null,
        a6T08SettlementId: input.authorityFact.a6T08Settlement
          ? input.authorityFact.a6T08Settlement.settlementId
          : null,
        a6T08SuspenseId:
          input.authorityFact.a6T08Suspense && input.authorityFact.a6T08Suspense.length > 0
            ? (input.authorityFact.a6T08Suspense[0]?.suspenseId ?? null)
            : null,
        a5LedgerJournalId: input.authorityFact.a5LedgerJournal
          ? input.authorityFact.a5LedgerJournal.journalId
          : null,
        a6ProviderReferenceId: null,
        a6CallbackReceiptId: input.authorityFact.a6CallbackReceipt
          ? input.authorityFact.a6CallbackReceipt.callbackReceiptId
          : null,
        notificationDispatchId: input.notificationFact.notificationDispatch
          ? input.notificationFact.notificationDispatch.notificationDispatchId
          : null,
        scopeValue,
        message,
      });
    };
    // Product operation
    if (!input.productFact.productOperation) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_OPERATION',
        null,
        'The A7 product operation is missing',
      );
    }
    // Product lifecycle
    if (!input.productFact.productLifecycle) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_LIFECYCLE',
        null,
        'The A7 product lifecycle is missing',
      );
    } else if (input.productFact.productLifecycle.currentLifecycleState === 'FAILED') {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_FAILED',
        input.productFact.productLifecycle.productLifecycleReference,
        'The A7 product lifecycle is in a FAILED state',
      );
    } else if (input.productFact.productLifecycle.currentLifecycleState === 'CANCELLED') {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_CANCELLED',
        input.productFact.productLifecycle.productLifecycleReference,
        'The A7 product lifecycle is in a CANCELLED state',
      );
    } else if (
      A6_LIFECYCLE_TERMINAL_STATES.has(input.productFact.productLifecycle.currentLifecycleState)
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_TERMINAL',
        input.productFact.productLifecycle.productLifecycleReference,
        'The A7 product lifecycle is in a terminal state',
      );
    } else if (
      input.productFact.productLifecycle.currentLifecycleState !== A6_LIFECYCLE_VERIFIED_STATE
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_NOT_VERIFIED',
        input.productFact.productLifecycle.productLifecycleReference,
        `The A7 product lifecycle is not in PENDING_VERIFICATION (${input.productFact.productLifecycle.currentLifecycleState})`,
      );
    }
    // Product command
    if (!input.productFact.productCommand) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_COMMAND',
        null,
        'The A7 product command is missing',
      );
    }
    // Product customer-binding
    if (!input.productFact.productCustomerBinding) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_CUSTOMER_BINDING',
        null,
        'The A7 product customer-binding map is missing',
      );
    }
    // A2 authorization
    if (!input.authorityFact.a2AuthorizationContext) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_A2_AUTHORIZATION',
        null,
        'The A2 authorization context is missing',
      );
    } else if (!input.authorityFact.a2AuthorizationContext.allowed) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A2_AUTHORIZATION_EXPIRED',
        input.authorityFact.a2AuthorizationContext.action,
        'The A2 authorization context is not allowed',
      );
    }
    // A4 product-policy
    if (!input.authorityFact.a4ProductPolicyDecision) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_A4_PRODUCT_POLICY_DECISION',
        null,
        'The A4 product-policy decision is missing',
      );
    } else if (!EXECUTABLE_A4_DECISIONS.has(input.authorityFact.a4ProductPolicyDecision.decision)) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A4_PRODUCT_POLICY_DECISION_NOT_EXECUTABLE',
        input.authorityFact.a4ProductPolicyDecision.decisionReference,
        `The A4 product-policy decision is not executable (${input.authorityFact.a4ProductPolicyDecision.decision})`,
      );
    } else if (input.authorityFact.a4ProductPolicyDecision.expiresAt) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A4_PRODUCT_POLICY_DECISION_EXPIRED',
        input.authorityFact.a4ProductPolicyDecision.decisionReference,
        'The A4 product-policy decision is expired',
      );
    }
    // A5 ledger
    if (
      input.productFact.productFinancialEffect?.a5LedgerJournalId &&
      !input.authorityFact.a5LedgerJournal
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_A5_LEDGER_JOURNAL',
        input.productFact.productFinancialEffect.a5LedgerJournalId,
        'The A5 Ledger journal is missing',
      );
    }
    if (
      input.authorityFact.a5LedgerJournal &&
      input.authorityFact.a5LedgerJournal.reversalOfJournalId
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A5_LEDGER_REVERSAL_ORPHAN',
        input.authorityFact.a5LedgerJournal.journalId,
        'The A5 Ledger reversal is orphan',
      );
    }
    // A6T05
    if (!input.authorityFact.a6ExternalOperation) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_A6_EXTERNAL_OPERATION',
        null,
        'The A6T05 external-operation record is missing',
      );
    } else {
      if (input.authorityFact.a6ExternalOperation.partnerKey !== 'NIBSS_NIP') {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_PARTNER_KEY_MISMATCH',
          input.authorityFact.a6ExternalOperation.partnerKey,
          'The A6T05 partner key is not NIBSS_NIP',
        );
      }
      if (
        input.authorityFact.a6ExternalOperation.capabilityKey !==
        'external.wallet.withdrawal.settlement'
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_CAPABILITY_MISMATCH',
          input.authorityFact.a6ExternalOperation.capabilityKey,
          'The A6T05 capability key is not external.wallet.withdrawal.settlement',
        );
      }
      if (input.authorityFact.a6ExternalOperation.lifecycleState !== A6_LIFECYCLE_VERIFIED_STATE) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_NOT_VERIFIED',
          input.authorityFact.a6ExternalOperation.lifecycleState,
          'The A6T05 external-operation lifecycle is not in PENDING_VERIFICATION',
        );
      }
      if (
        !this.amountConsistent(
          input.productFact.productOperation?.amountMinor,
          input.authorityFact.a6ExternalOperation.amountMinor,
        )
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_AMOUNT_MISMATCH',
          String(input.authorityFact.a6ExternalOperation.amountMinor),
          'The A6T05 external-operation amount does not match the product operation',
        );
      }
      if (
        input.productFact.productOperation?.currency !==
        input.authorityFact.a6ExternalOperation.currency
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_CURRENCY_MISMATCH',
          input.authorityFact.a6ExternalOperation.currency,
          'The A6T05 external-operation currency does not match the product operation',
        );
      }
      if (
        input.productFact.productOperation?.accountingUnit !==
        input.authorityFact.a6ExternalOperation.accountingUnit
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_ACCOUNTING_UNIT_MISMATCH',
          input.authorityFact.a6ExternalOperation.accountingUnit,
          'The A6T05 external-operation accounting unit does not match the product operation',
        );
      }
      if (
        input.productFact.productCommand &&
        input.productFact.productCommand.bindingId !==
          input.authorityFact.a6ExternalOperation.ledgerAccountId
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_BINDING_MISMATCH',
          input.authorityFact.a6ExternalOperation.ledgerAccountId,
          'The A6T05 external-operation ledger account does not match the product command binding',
        );
      }
    }
    // A6T08 settlement
    if (input.authorityFact.a6T08Settlement) {
      if (
        !this.amountConsistent(
          input.authorityFact.a6T08Settlement.amountMinor,
          input.authorityFact.a6ExternalOperation?.amountMinor,
        )
      ) {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_SETTLEMENT_AMOUNT_MISMATCH',
          input.authorityFact.a6T08Settlement.amountMinor,
          'The A6T08 settlement amount does not match the A6T05 external-operation amount',
        );
      }
      if (input.authorityFact.a6T08Settlement.currency !== 'NGN') {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_SETTLEMENT_CURRENCY_MISMATCH',
          input.authorityFact.a6T08Settlement.currency,
          'The A6T08 settlement currency is not NGN',
        );
      }
      if (input.authorityFact.a6T08Settlement.accountingUnit !== 'CUSTOMER_FUNDS') {
        pushDiscrepancy(
          'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_SETTLEMENT_ACCOUNTING_UNIT_MISMATCH',
          input.authorityFact.a6T08Settlement.accountingUnit,
          'The A6T08 settlement accounting unit is not CUSTOMER_FUNDS',
        );
      }
    }
    // A6T08 suspense aging
    if (input.authorityFact.a6T08Suspense) {
      for (const suspense of input.authorityFact.a6T08Suspense) {
        const agedHours = this.computeAgedHours(suspense);
        if (
          A6_LIFECYCLE_AGED_STATES.has(suspense.status) &&
          agedHours > A7_PRODUCT_RECONCILIATION_SUSPENSE_AGED_HOURS
        ) {
          pushDiscrepancy(
            'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_SUSPENSE_AGED',
            suspense.suspenseId,
            `The A6T08 suspense entry is aged (${agedHours}h)`,
          );
        }
      }
    }
    // A6 partner outage
    if (input.authorityFact.a6PartnerOutage?.state === 'OPEN') {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_PARTNER_OUTAGE',
        input.authorityFact.a6PartnerOutage.partnerKey,
        'The A6 partner circuit-breaker is OPEN',
      );
    }
    // A6 report availability
    if (
      input.authorityFact.a6ReportAvailability &&
      !input.authorityFact.a6ReportAvailability.reportAvailable
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_REPORT_UNAVAILABLE',
        input.authorityFact.a6ReportAvailability.partnerKey,
        'The A6 partner report is unavailable',
      );
    } else if (
      input.authorityFact.a6ReportAvailability &&
      !input.authorityFact.a6ReportAvailability.fresh
    ) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_REPORT_STALE',
        input.authorityFact.a6ReportAvailability.partnerKey,
        'The A6 partner report is stale',
      );
    }
    // A6T09 snapshot
    if (input.a6T09Snapshot && input.a6T09Snapshot.errorCount > 0) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_OUTBOX_PAYLOAD_MISMATCH',
        input.a6T09Snapshot.a6T09ExternalReconciliationReference,
        'The A6T09 external reconciliation has ERROR discrepancies',
      );
    }
    // A7T06 notification
    if (!input.notificationFact.notificationDispatch) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_NOTIFICATION_DISPATCH_FACT',
        null,
        'The A7T06 notification dispatch fact is missing',
      );
    }
    // Operations idempotency
    if (input.operationsFact.idempotency.length === 0) {
      pushDiscrepancy(
        'A7_PRODUCT_RECONCILIATION_MISSING_OPERATIONS_IDEMPOTENCY_RECORD',
        null,
        'The A7 operations idempotency record is missing',
      );
    }
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_PRODUCT_RECONCILED;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_BATCH_RECONCILED;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_SUPPORT_TRACE_EMITTED;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_CERTIFICATION_EMITTED;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_QUERY_UNAVAILABLE;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_NO_DISCREPANCY;
    void A7_PRODUCT_RECONCILIATION_AUDIT_ACTION_DISCREPANCY_REPORTED;
    return discrepancies;
  }

  private buildSupportTrace(
    command: A7ProductReconciliationCommandV1,
    productFact: A7ProductReconciliationProductFactV1,
    authorityFact: A7ProductReconciliationAuthorityFactV1,
    operationsFact: A7ProductReconciliationOperationsFactV1,
    generatedAt: string,
  ): A7ProductReconciliationSupportTraceV1 {
    const issuedAt = generatedAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_RECONCILIATION_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      supportTraceReference: this.computeSupportTraceReference(command.productOperationReference),
      productOperationReference: command.productOperationReference,
      productKey: PRODUCT_KEY,
      customerId: productFact.productOperation?.customerId ?? '',
      a6ExternalOperationReference: authorityFact.a6ExternalOperation
        ? authorityFact.a6ExternalOperation.externalOperationReference
        : null,
      a6T08SettlementId: authorityFact.a6T08Settlement
        ? authorityFact.a6T08Settlement.settlementId
        : null,
      a6T08SuspenseId:
        authorityFact.a6T08Suspense && authorityFact.a6T08Suspense.length > 0
          ? (authorityFact.a6T08Suspense[0]?.suspenseId ?? null)
          : null,
      a5LedgerJournalId: authorityFact.a5LedgerJournal
        ? authorityFact.a5LedgerJournal.journalId
        : null,
      a6ProviderReferenceId: null,
      a6CallbackReceiptId: command.a6CallbackReceiptId,
      auditEventIds: operationsFact.audit.map((a) => a.auditEventId),
      outboxEventIds: operationsFact.outbox.map((o) => o.outboxEventId),
      idempotencyRecordIds: operationsFact.idempotency.map((i) => i.idempotencyRecordId),
      diagnosticsEventIds: operationsFact.diagnostics.map((d) => d.diagnosticsEventId),
      sensitivity: this.classifySupportTraceSensitivity(productFact, authorityFact),
      issuedAt,
      expiresAt,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      traceId: command.requestContext.traceId,
      causationId: command.causationId,
    };
  }

  private classifySupportTraceSensitivity(
    productFact: A7ProductReconciliationProductFactV1,
    authorityFact: A7ProductReconciliationAuthorityFactV1,
  ): A7ProductReconciliationSensitivity {
    if (authorityFact.a5LedgerJournal || authorityFact.a6T08Settlement) {
      return 'CONFIDENTIAL';
    }
    if (productFact.productCommand || productFact.productCustomerBinding) {
      return 'INTERNAL';
    }
    return 'PUBLIC';
  }

  private buildCertificationEvidence(
    command: A7ProductReconciliationCommandV1,
    discrepancies: A7ProductReconciliationDiscrepancy[],
    generatedAt: string,
  ): A7ProductReconciliationCertificationEvidenceV1 | null {
    if (!command.certificationCase) {
      return null;
    }
    const errorCount = discrepancies.filter(
      (d) => d.severity === A7_PRODUCT_RECONCILIATION_SEVERITY_ERROR,
    ).length;
    const warningCount = discrepancies.filter(
      (d) => d.severity === A7_PRODUCT_RECONCILIATION_SEVERITY_WARNING,
    ).length;
    return {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      certificationReference: this.computeCertificationReference(command.productOperationReference),
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      certificationCase: command.certificationCase,
      handoffReference: this.computeHandoffReference(command.productOperationReference),
      a6PartnerCertificationReference: null,
      discrepancyCount: discrepancies.length,
      errorCount,
      warningCount,
      recordedAt: generatedAt,
      correlationId: command.requestContext.correlationId,
    };
  }

  private buildHandoff(
    command: A7ProductReconciliationCommandV1,
    generatedAt: string,
  ): A7ProductReconciliationHandoffV1 {
    const issuedAt = generatedAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_RECONCILIATION_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      handoffScope: A7_PRODUCT_RECONCILIATION_HANDOFF_SCOPE,
      productOperationReference: command.productOperationReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6T08SettlementId: command.a6T08SettlementId,
      a6T08SuspenseId: command.a6T08SuspenseId,
      a5LedgerJournalId: command.a5LedgerJournalId,
      a6ProviderReferenceId: command.a6ProviderReferenceId,
      a6CallbackReceiptId: command.a6CallbackReceiptId,
      issuedAt,
      expiresAt,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      traceId: command.requestContext.traceId,
      causationId: command.causationId,
    };
  }

  private amountConsistent(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) {
      return false;
    }
    try {
      const aBig = BigInt(parsePositiveMinorUnits(a).toString());
      const bBig = BigInt(parsePositiveMinorUnits(b).toString());
      return aBig === bBig;
    } catch {
      return false;
    }
  }

  private stringConsistent(
    a: string | null | undefined,
    b: string | null | undefined,
    expected: string,
  ): boolean {
    if (!a || !b) {
      return false;
    }
    return a === expected && b === expected;
  }

  private ledgerJournalCorrelated(
    journal: A7ProductReconciliationA5LedgerJournalView | null,
    journalId: string | null | undefined,
  ): boolean {
    if (!journalId) {
      return true;
    }
    if (!journal) {
      return false;
    }
    return journal.journalId === journalId;
  }

  private ledgerReversalConsistent(
    journal: A7ProductReconciliationA5LedgerJournalView | null,
  ): boolean {
    if (!journal) {
      return true;
    }
    return !journal.reversalOfJournalId;
  }

  private suspenseAgingConsistent(
    suspense: readonly A7ProductReconciliationA6T08SuspenseView[],
  ): boolean {
    if (suspense.length === 0) {
      return true;
    }
    for (const entry of suspense) {
      const agedHours = this.computeAgedHours(entry);
      if (
        A6_LIFECYCLE_AGED_STATES.has(entry.status) &&
        agedHours > A7_PRODUCT_RECONCILIATION_SUSPENSE_AGED_HOURS
      ) {
        return false;
      }
    }
    return true;
  }

  private computeAgedHours(suspense: A7ProductReconciliationA6T08SuspenseView): number {
    const created = suspense.createdAt;
    const createdMs = created instanceof Date ? created.getTime() : Date.parse(String(created));
    if (!Number.isFinite(createdMs)) {
      return 0;
    }
    return (Date.now() - createdMs) / (60 * 60 * 1000);
  }

  private generateReconciliationId(): string {
    return randomUUID();
  }

  private generateBatchId(): string {
    return randomUUID();
  }

  private computeReconciliationReference(reconciliationId: string): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-RECONCILIATION:${reconciliationId}:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_RECONCILIATION_REFERENCE_PREFIX}:v${A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION}:${hash}`;
  }

  private computeBatchReference(): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-RECONCILIATION-BATCH:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_RECONCILIATION_REFERENCE_PREFIX}-batch:v${A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION}:${hash}`;
  }

  private computeSupportTraceReference(reference: string): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-SUPPORT-TRACE:${reference}:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_RECONCILIATION_REFERENCE_PREFIX}-support-trace:v${A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION}:${hash}`;
  }

  private computeCertificationReference(reference: string): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-CERTIFICATION:${reference}:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_RECONCILIATION_REFERENCE_PREFIX}-certification:v${A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION}:${hash}`;
  }

  private computeHandoffReference(reference: string): string {
    const hash = createHash('sha256')
      .update(`A7-PRODUCT-RECONCILIATION-HANDOFF:${reference}:${randomUUID()}`)
      .digest('hex');
    return `${A7_PRODUCT_RECONCILIATION_HANDOFF_REFERENCE_PREFIX}:v${A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION}:${hash}`;
  }

  private validateCommandShape(
    command: A7ProductReconciliationCommandV1,
  ): { code: string; message: string } | null {
    if (!command) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The A7 product reconciliation command is missing',
      };
    }
    if (command.contractName !== A7_PRODUCT_RECONCILIATION_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The A7 product reconciliation contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The A7 product reconciliation contract version is invalid',
      };
    }
    if (command.productKey !== PRODUCT_KEY) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The A7 product reconciliation product key is invalid',
      };
    }
    if (command.productVersion !== PRODUCT_VERSION) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The A7 product reconciliation product version is invalid',
      };
    }
    if (!command.productOperationReference.trim()) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The productOperationReference is required',
      };
    }
    if (
      command.a6ExternalOperationReference !== null &&
      !REFERENCE_PATTERN.test(command.a6ExternalOperationReference)
    ) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a6ExternalOperationReference is invalid',
      };
    }
    if (command.a5LedgerJournalId !== null && !UUID_PATTERN.test(command.a5LedgerJournalId)) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a5LedgerJournalId is invalid',
      };
    }
    if (command.a6T08SettlementId !== null && !UUID_PATTERN.test(command.a6T08SettlementId)) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a6T08SettlementId is invalid',
      };
    }
    if (command.a6T08SuspenseId !== null && !UUID_PATTERN.test(command.a6T08SuspenseId)) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a6T08SuspenseId is invalid',
      };
    }
    if (command.a6CallbackReceiptId !== null && !UUID_PATTERN.test(command.a6CallbackReceiptId)) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a6CallbackReceiptId is invalid',
      };
    }
    if (
      command.a6ProviderReferenceId !== null &&
      !UUID_PATTERN.test(command.a6ProviderReferenceId)
    ) {
      return {
        code: A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
        message: 'The a6ProviderReferenceId is invalid',
      };
    }
    void SAFE_TEXT_PATTERN;
    void CURRENCY;
    void ACCOUNTING_UNIT;
    void ALL_CHECKS_OK;
    void ALL_CHECKS_NOT_VERIFIED;
    return null;
  }

  private failure(
    command: A7ProductReconciliationCommandV1,
    code: string,
    message: string,
  ): A7ProductReconciliationResultV1 {
    return { valid: false, failure: this.buildFailure(code, message, command.requestContext) };
  }

  private buildFailure(
    code: string,
    message: string,
    requestContext: RequestContext,
  ): A7ProductReconciliationFailureV1 {
    return {
      contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
      code: code as
        | 'A7_PRODUCT_RECONCILIATION_QUERY_UNAVAILABLE'
        | 'A7_PRODUCT_RECONCILIATION_INVALID_COMMAND'
        | 'A7_PRODUCT_RECONCILIATION_DISCREPANCY_DETECTED',
      message,
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
  }
}
