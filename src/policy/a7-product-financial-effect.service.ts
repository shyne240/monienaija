/**
 * A7T08 — A7 product financial effect, settlement, and Ledger
 * integration service.
 *
 * The A7 product financial effect service is the single A7-side
 * entry point for the A7 first product's runtime financial
 * integration and control. The A7 product financial effect service
 * composes the existing A2 / A3 / A4 / A5 / A6 / A7 / Operations
 * authorities (reused as-is, without modification) under the A7
 * product financial effect envelope:
 *
 *  - the A2 `AuthorizationService` (reused for the A2 authorization
 *    context reference);
 *  - the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 *    (reused for the A3 binding recheck);
 *  - the A4 product-policy service (A7T03; reused for the A4
 *    product-policy decision reference);
 *  - the A6T05 `ExternalOperationService` (reused for the A6T05
 *    external-operation correlation; the A6T05 provider idempotency
 *    scope/key is sourced from the A6T05 record per ADR-0049);
 *  - the A6T05 `ExternalOperationLifecycleService` (reused for the
 *    A6 lifecycle state correlation);
 *  - the A6T07 `ExternalOperationStatusVerifier` (reused for the A6
 *    status-verification correlation);
 *  - the A6 `PartnerCircuitBreakerService` (reused for the A6
 *    circuit-breaker state correlation);
 *  - the A6T08 `ExternalSettlementService` (reused for the A6T08
 *    settlement / suspense / compensating-entry boundary; the A6T08
 *    service is the only settlement / suspense / compensating
 *    authority);
 *  - the A5 `LedgerService` (reused for the A5 Ledger journal and
 *    reversal boundary; the A5 Ledger service is the only financial
 *    value authority);
 *  - the A7T04 `A7ProductCustomerBindingService` (reused for the A7
 *    product customer-binding map reference);
 *  - the A7T05 `A7ProductCommandService` (reused for the A7 product
 *    command/operation identity correlation);
 *  - the A7T07 `A7ProductLifecycleService` (reused for the A7 product
 *    lifecycle handoff correlation; the A7 product lifecycle service
 *    is the only product lifecycle authority);
 *  - the shared `IdempotencyService` (reused for the A7 internal
 *    idempotency scope/key reservation, completion, and failure);
 *  - the shared `AuditService` (reused for the A7 product financial
 *    effect audit facts);
 *  - the shared `OutboxService` (reused for the A7 product financial
 *    effect outbox facts);
 *  - the shared `MetricsService` (reused for the A7 product
 *    financial effect metric observations);
 *  - the shared `DataSource` (reused for the A7 product financial
 *    effect SERIALIZABLE transactions);
 *  - the `ConfigService` (read-only; the A5 pilot emergency stop
 *    flag is the only pilot-disable boundary; the A7 product
 *    financial effect service does NOT introduce a parallel pilot
 *    authority).
 *
 * No new policy evaluator, no new authorization service, no new
 * customer-binding service, no new settlement authority, no new
 * reconciliation engine, no new audit authority, no new idempotency
 * authority, no new outbox authority, no new metrics authority, no
 * new diagnostics authority, no new A6 lifecycle authority, no new
 * A6 status-verification authority, no new A6 circuit-breaker
 * authority, no new A6T05 external-operation authority, no new
 * A6T05 retry/recovery authority, no new A6T08 settlement /
 * suspense / compensating-entry authority, no new A6T09
 * reconciliation authority, no new A6T10 data-classification
 * authority, no new A6T11 integration authority, no new A7 product
 * catalog authority, no new A7 product-policy authority, no new A7T04
 * product customer-binding authority, no new A7T05 product
 * command/operation authority, no new A7T06 product notification
 * delivery authority, no new A7T07 product lifecycle authority, no
 * new A5 Ledger authority, no new Wallet, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, Reconciliation, or
 * `CustomerPreference` authority is introduced. The existing A5
 * `LedgerService` is the only financial value authority. The existing
 * A6T08 `ExternalSettlementService` is the only settlement / suspense
 * / compensating authority. The existing A6T05
 * `ExternalOperationLifecycleService` is the only A6 lifecycle
 * authority.
 *
 * No ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, and no external financial correction outside
 * Ledger/Finance ownership is introduced by A7T08.
 */

import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';

import { parsePositiveMinorUnits } from '../common/money';
import type { RequestContext } from '../production/request-context';

import {
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_RESERVED,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SETTLEMENT_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SUSPENSE_RECORDED,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR,
  A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORIES,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_REVERSAL,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SETTLEMENT,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SUSPENSE,
  A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
  A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_DENIED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_STALE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_NOT_ACTIVE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_STALE_BINDING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_EXPIRED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_COMPENSATING_REJECTED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SETTLEMENT_REJECTED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SUSPENSE_REJECTED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_CIRCUIT_OPEN,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_NOT_VERIFIED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_STALE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_TERMINAL,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_RETRY_EXHAUSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_IDEMPOTENCY_IN_PROGRESS,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_ACCOUNTING_UNIT_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_AMOUNT_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_CURRENCY_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DISABLED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_INVARIANT_VIOLATION,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTBOX_PUBLICATION_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_NOT_VERIFIED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_STATE_INVALID,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISMATCH,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISSING,
  A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
  A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_SCOPE,
  A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_VALIDITY_SECONDS,
  A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS,
  A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_FINANCIAL_EFFECT_JOURNAL_BALANCE_INVARIANT,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_ADMITTED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_CANCELLED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_COMPENSATING_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_DISABLED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REVERSAL_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SETTLEMENT_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SUSPENSE_RECORDED,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_CLASSIFICATION,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_RETENTION_CLASS,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_TYPE,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOMES,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED,
  A7_PRODUCT_FINANCIAL_EFFECT_REFERENCE_PREFIX,
  A7_PRODUCT_FINANCIAL_EFFECT_REVERSAL_REFERENCE_PREFIX,
  A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_REFERENCE_PREFIX,
  A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REFERENCE_PREFIX,
  A7_PRODUCT_FINANCIAL_EFFECT_COMPENSATING_REFERENCE_PREFIX,
  A7_PRODUCT_FINANCIAL_EFFECT_STATES,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_REVERSAL_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_SETTLEMENT_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_SUSPENSE_RECORDED,
  A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REASONS,
  A7_PRODUCT_FINANCIAL_EFFECT_TERMINAL_STATES,
  A7_PRODUCT_FINANCIAL_EFFECT_TO_A6_DECISION,
} from './a7-product-financial-effect.constants';
import { A7ProductFinancialEffectRepository } from './a7-product-financial-effect.repository';
import type {
  A7ProductFinancialEffectConsumerPorts,
  A7ProductFinancialEffectFailureV1,
  A7ProductFinancialEffectHandoffV1,
  A7ProductFinancialEffectProductState,
  A7ProductFinancialEffectRecordV1,
  A7ProductFinancialEffectRequestHashInputV1,
  A7ProductFinancialEffectReservationKind,
  A7ProductFinancialEffectResultV1,
  A7ProductFinancialEffectState,
  A7ProductFinancialEffectV1,
  A7ProductFinancialEffectOutcome,
  A7ProductFinancialEffectCategory,
  A7ProductFinancialEffectA6T08Decision,
} from './a7-product-financial-effect.types';
import type {
  ExternalSettlementEvidence,
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import { ExternalSettlementDecision } from '../partner/external-settlement.enums';
import type { ExternalSettlementRejectionCode } from '../partner/external-settlement.enums';
import { ExternalOperationReferenceSource } from '../partner/external-operation.enums';
import type { A7ProductFinancialEffectA5LedgerJournalView } from './a7-product-financial-effect.types';

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
const CURRENCY = 'NGN' as const;
const ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;
const A6_LIFECYCLE_VERIFIED_STATE = 'PENDING_VERIFICATION' as const;
const A6_LIFECYCLE_TERMINAL_STATES: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED']);
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
const A7_FINANCIAL_EFFECT_SETTLEMENT_KEY_PATTERN =
  /^a7-product-financial-effect-settlement:[a-f0-9]{64}$/;
const A7_FINANCIAL_EFFECT_SUSPENSE_KEY_PATTERN =
  /^a7-product-financial-effect-suspense:[a-f0-9]{64}$/;
const A7_FINANCIAL_EFFECT_COMPENSATING_KEY_PATTERN =
  /^a7-product-financial-effect-compensating:[a-f0-9]{64}$/;
const A7_FINANCIAL_EFFECT_RECOVERY_REFERENCE_PATTERN =
  /^a7-product-financial-effect-recovery:[a-f0-9]{64}$/;

type AllChecks = A7ProductFinancialEffectFailureV1['checks'];
const ALL_CHECKS_OK: AllChecks = Object.freeze({
  a2AuthorizationContext: 'OK',
  a3Binding: 'OK',
  a4ProductPolicyDecision: 'OK',
  a6ExternalOperation: 'OK',
  a6Lifecycle: 'OK',
  a6StatusVerification: 'OK',
  a6CircuitBreaker: 'OK',
  a6Retry: 'OK',
  a7T04ProductCustomerBinding: 'OK',
  a7T05ProductCommand: 'OK',
  a7T07ProductLifecycle: 'OK',
  a6T08Settlement: 'OK',
  a5LedgerInvariant: 'OK',
  a5LedgerEnabled: 'OK',
  a5LedgerAmount: 'OK',
  a5LedgerCurrency: 'OK',
  a5LedgerAccountingUnit: 'OK',
  a5LedgerDuplicate: 'OK',
  a6T08Compensating: 'OK',
  recoveryReference: 'OK',
  outcomeMapping: 'OK',
  outcomeVerified: 'OK',
  productState: 'OK',
  requestHash: 'OK',
  idempotency: 'OK',
});

const ALL_CHECKS_NOT_VERIFIED: AllChecks = Object.freeze({
  a2AuthorizationContext: 'NOT_VERIFIED',
  a3Binding: 'NOT_VERIFIED',
  a4ProductPolicyDecision: 'NOT_VERIFIED',
  a6ExternalOperation: 'NOT_VERIFIED',
  a6Lifecycle: 'NOT_VERIFIED',
  a6StatusVerification: 'NOT_VERIFIED',
  a6CircuitBreaker: 'NOT_VERIFIED',
  a6Retry: 'NOT_VERIFIED',
  a7T04ProductCustomerBinding: 'NOT_VERIFIED',
  a7T05ProductCommand: 'NOT_VERIFIED',
  a7T07ProductLifecycle: 'NOT_VERIFIED',
  a6T08Settlement: 'NOT_VERIFIED',
  a5LedgerInvariant: 'NOT_VERIFIED',
  a5LedgerEnabled: 'NOT_VERIFIED',
  a5LedgerAmount: 'NOT_VERIFIED',
  a5LedgerCurrency: 'OK',
  a5LedgerAccountingUnit: 'NOT_VERIFIED',
  a5LedgerDuplicate: 'NOT_VERIFIED',
  a6T08Compensating: 'NOT_VERIFIED',
  recoveryReference: 'NOT_VERIFIED',
  outcomeMapping: 'NOT_VERIFIED',
  outcomeVerified: 'NOT_VERIFIED',
  productState: 'NOT_VERIFIED',
  requestHash: 'NOT_VERIFIED',
  idempotency: 'NOT_VERIFIED',
});

interface NormalizedA7ProductFinancialEffectV1 {
  readonly contractName: typeof A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME;
  readonly contractVersion: typeof A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION;
  readonly productKey: typeof PRODUCT_KEY;
  readonly productVersion: typeof PRODUCT_VERSION;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductFinancialEffectProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: typeof CURRENCY;
  readonly accountingUnit: typeof ACCOUNTING_UNIT;
  readonly outcome: A7ProductFinancialEffectOutcome;
  readonly a7ProductLifecycleReference: string;
  readonly a7ProductCommandReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a6T08SettlementReference: string | null;
  readonly a6T08SuspenseReference: string | null;
  readonly a6T08CompensatingReference: string | null;
  readonly recoveryReference: string | null;
  readonly reversalReason: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly providerStatus: string | null;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

@Injectable()
export class A7ProductFinancialEffectService {
  constructor(
    @Inject(A7ProductFinancialEffectRepository)
    private readonly repository: A7ProductFinancialEffectRepository,
  ) {}

  /**
   * Posts the A7 product financial effect. The A7 product financial
   * effect service verifies the A7 product financial effect
   * envelope, verifies the upstream authorities (A2 / A3 / A4 /
   * A7T04 / A7T05 / A7T07 / A6T05 / A6T07 / A6T08), and posts the
   * A5 Ledger journal through the A5 `LedgerService.postJournal()`
   * consumer boundary OR submits the verified product outcome to the
   * A6T08 `ExternalSettlementService` (reused as-is) for settlement /
   * suspense / compensating-entry processing.
   *
   * The A7 product financial effect service does NOT call a partner,
   * dispatch a notification, post a journal directly, mutate a
   * balance, repair a binding, or change a source record through
   * this method. The A7 product financial effect service does NOT
   * introduce a parallel Ledger authority, a parallel settlement
   * authority, a parallel suspense authority, or a parallel
   * compensating-entry authority. The A5 `LedgerService` is the only
   * financial value authority. The A6T08 `ExternalSettlementService`
   * is the only settlement / suspense / compensating authority.
   */
  async postProductFinancialEffect(
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    return this.runWithinTransaction((manager) => this.postWithinTransaction(manager, command));
  }

  /**
   * Records a product financial effect reversal. The A7 product
   * financial effect service records a product financial effect
   * reversal through the A5 `LedgerService.reverseJournal()` and
   * the A6T08 `ExternalSettlementService.recordCompensatingEntry()`
   * consumer boundaries (reused as-is, without modification). The
   * A7 product financial effect service does NOT mutate the A5
   * Ledger journal; the A5 Ledger service creates a new
   * compensating Ledger journal for the reversal. The A7 product
   * financial effect service does NOT mutate the A6T08 settlement
   * record; the A6T08 settlement service creates a new
   * compensating-entry suspense record for the reversal.
   */
  async postProductFinancialEffectReversal(
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    return this.runWithinTransaction((manager) =>
      this.postReversalWithinTransaction(manager, command),
    );
  }

  /**
   * Fails the A7 product financial effect. The A7 product financial
   * effect service records the A7 product financial effect failure
   * audit fact, fails the A7 internal idempotency record, publishes
   * the A7 product financial effect failure outbox fact, and
   * increments the failure metric. The A7 product financial effect
   * service transitions the A7 product financial effect to
   * `FINANCIAL_EFFECT_FAILED` (terminal) and records the
   * `A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_FAILED` audit fact.
   */
  async failProductFinancialEffect(
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    return this.runWithinTransaction((manager) => this.failWithinTransaction(manager, command));
  }

  /**
   * Returns the A7 product financial effect contract name and
   * contract version.
   */
  getContractNames(): {
    readonly a2: string;
    readonly a3: string;
    readonly a4: string;
    readonly a5: string;
    readonly a6: string;
    readonly a6T08: string;
    readonly a6CircuitBreaker: string;
    readonly a6T07: string;
    readonly a7T04: string;
    readonly a7T05: string;
    readonly a7T07: string;
    readonly a7: string;
  } {
    return Object.freeze({
      a2: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a3: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a4: 'A4-CAPABILITY-POLICY',
      a5: 'A5-LEDGER',
      a6: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6T07: 'A6-EXTERNAL-LIFECYCLE',
      a6T08: 'A6-EXTERNAL-SETTLEMENT',
      a6CircuitBreaker: 'A6-PARTNER-CIRCUIT-BREAKER',
      a7T04: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T05: 'A7-PRODUCT-COMMAND',
      a7T07: 'A7-PRODUCT-LIFECYCLE',
      a7: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
    });
  }

  /**
   * Returns the A7 product financial effect contract version.
   */
  getContractVersions(): {
    readonly a2: number;
    readonly a3: number;
    readonly a4: number;
    readonly a5: number;
    readonly a6: number;
    readonly a6T07: number;
    readonly a6T08: number;
    readonly a6CircuitBreaker: number;
    readonly a7T04: number;
    readonly a7T05: number;
    readonly a7T07: number;
    readonly a7: number;
  } {
    return Object.freeze({
      a2: 1,
      a3: 1,
      a4: 1,
      a5: 1,
      a6: 1,
      a6T07: 1,
      a6T08: 1,
      a6CircuitBreaker: 1,
      a7T04: 1,
      a7T05: 1,
      a7T07: 1,
      a7: 1,
    });
  }

  /**
   * Returns the A7 product financial effect internal idempotency
   * scope.
   */
  getInternalIdempotencyScope(): string {
    return A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A7 product financial effect provider idempotency
   * scope (sourced from the A6T05 provider idempotency scope per
   * ADR-0049).
   */
  getProviderIdempotencyScope(): string {
    return this.repository.getA7ProductFinancialEffectProviderIdempotencyScope();
  }

  /**
   * Returns the A7 product financial effect idempotency retention
   * interval.
   */
  getIdempotencyRetentionSeconds(): number {
    return A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS;
  }

  /**
   * Returns the A7 product financial effect audit entity type.
   */
  getAuditEntityType(): string {
    return A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ENTITY_TYPE;
  }

  /**
   * Returns the A7 product financial effect audit actor.
   */
  getAuditActor(): string {
    return A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR;
  }

  /**
   * Returns the A7 product financial effect state vocabulary.
   */
  listFinancialEffectStates(): readonly string[] {
    return A7_PRODUCT_FINANCIAL_EFFECT_STATES;
  }

  /**
   * Returns the A7 product financial effect terminal state vocabulary.
   */
  listTerminalStates(): readonly string[] {
    return A7_PRODUCT_FINANCIAL_EFFECT_TERMINAL_STATES;
  }

  /**
   * Returns the A7 product financial effect outcome vocabulary.
   */
  listOutcomes(): readonly string[] {
    return A7_PRODUCT_FINANCIAL_EFFECT_OUTCOMES;
  }

  /**
   * Returns the A7 product financial effect category vocabulary.
   */
  listCategories(): readonly string[] {
    return A7_PRODUCT_FINANCIAL_EFFECT_CATEGORIES;
  }

  /**
   * Returns the A7 product financial effect A6T08 decision mapping.
   */
  getA6T08DecisionMapping(): Readonly<Record<string, string>> {
    return A7_PRODUCT_FINANCIAL_EFFECT_TO_A6_DECISION;
  }

  /**
   * Returns the A7 product financial effect A6T08 suspense reason
   * mapping.
   */
  getA6T08SuspenseReasonMapping(): Readonly<Record<string, string>> {
    return A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REASONS;
  }

  /**
   * Asserts that the A7 product financial effect outcome is one of
   * the A7 product financial effect outcome vocabulary. The A7
   * product financial effect service fails closed on an unknown
   * outcome.
   */
  assertOutcome(
    outcome: A7ProductFinancialEffectOutcome,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (!A7_PRODUCT_FINANCIAL_EFFECT_OUTCOMES.includes(outcome)) {
      return { ok: false, reason: 'The A7 product financial effect outcome is not registered' };
    }
    return { ok: true };
  }

  /**
   * Asserts that the A6T08 decision for the A7 product financial
   * effect outcome is one of the A6T08 decisions.
   */
  assertA6T08Decision(
    outcome: A7ProductFinancialEffectOutcome,
  ):
    | { readonly ok: true; readonly decision: A7ProductFinancialEffectA6T08Decision }
    | { readonly ok: false; readonly reason: string } {
    const decision = A7_PRODUCT_FINANCIAL_EFFECT_TO_A6_DECISION[outcome];
    if (!decision) {
      return {
        ok: false,
        reason: 'The A7 product financial effect outcome has no A6T08 decision mapping',
      };
    }
    if (decision !== 'SETTLE' && decision !== 'REVERSE' && decision !== 'SUSPENSE') {
      return { ok: false, reason: 'The A6T08 decision is not registered' };
    }
    return { ok: true, decision };
  }

  /**
   * Asserts the A5 ledger journal balance invariant. The A7 product
   * financial effect journal is a double-entry journal: the sum of
   * debits must equal the sum of credits in minor units for every
   * A7 product financial effect journal.
   */
  assertLedgerJournalBalanceInvariant(
    lines: ReadonlyArray<{ readonly direction: 'DEBIT' | 'CREDIT'; readonly amountMinor: string }>,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    let totalDebitMinor = 0n;
    let totalCreditMinor = 0n;
    for (const line of lines) {
      const amountBig = BigInt(line.amountMinor);
      if (amountBig < 0n) {
        return {
          ok: false,
          reason: 'The A7 product financial effect journal line amount is negative',
        };
      }
      if (line.direction === 'DEBIT') {
        totalDebitMinor += amountBig;
      } else if (line.direction === 'CREDIT') {
        totalCreditMinor += amountBig;
      } else {
        return {
          ok: false,
          reason: 'The A7 product financial effect journal line direction is not registered',
        };
      }
    }
    if (totalDebitMinor !== totalCreditMinor) {
      return {
        ok: false,
        reason: 'The A7 product financial effect journal is not balanced',
      };
    }
    if (totalDebitMinor === 0n) {
      return { ok: false, reason: 'The A7 product financial effect journal has zero total' };
    }
    return { ok: true };
  }

  /**
   * Derives the canonical A7 product financial effect request hash
   * from the A7 product financial effect semantic material.
   */
  deriveRequestHash(input: A7ProductFinancialEffectRequestHashInputV1): string {
    return this.sha256(this.canonicalJson(input));
  }

  /**
   * Computes a settlement reference for the A7 product financial
   * effect.
   */
  computeSettlementReference(productFinancialEffectId: string): string {
    const hash = this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT-SETTLEMENT:${productFinancialEffectId}:${randomUUID()}`,
    );
    return `${A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_REFERENCE_PREFIX}:${hash}`;
  }

  /**
   * Computes a suspense reference for the A7 product financial
   * effect.
   */
  computeSuspenseReference(productFinancialEffectId: string): string {
    const hash = this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT-SUSPENSE:${productFinancialEffectId}:${randomUUID()}`,
    );
    return `${A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REFERENCE_PREFIX}:${hash}`;
  }

  /**
   * Computes a compensating reference for the A7 product financial
   * effect.
   */
  computeCompensatingReference(productFinancialEffectId: string): string {
    const hash = this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT-COMPENSATING:${productFinancialEffectId}:${randomUUID()}`,
    );
    return `${A7_PRODUCT_FINANCIAL_EFFECT_COMPENSATING_REFERENCE_PREFIX}:${hash}`;
  }

  /**
   * Computes a reversal reference for the A7 product financial
   * effect.
   */
  computeReversalReference(productFinancialEffectId: string): string {
    const hash = this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT-REVERSAL:${productFinancialEffectId}:${randomUUID()}`,
    );
    return `${A7_PRODUCT_FINANCIAL_EFFECT_REVERSAL_REFERENCE_PREFIX}:${hash}`;
  }

  /**
   * Computes a recovery reference for the A7 product financial
   * effect.
   */
  computeRecoveryReference(productFinancialEffectId: string): string {
    const hash = this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT-RECOVERY:${productFinancialEffectId}:${randomUUID()}`,
    );
    return `${A7_PRODUCT_FINANCIAL_EFFECT_REFERENCE_PREFIX}-recovery:${hash}`;
  }

  /**
   * Returns the A7 product financial effect metric names.
   */
  listMetricNames(): readonly string[] {
    return Object.freeze([
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_ADMITTED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SETTLEMENT_POSTED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SUSPENSE_RECORDED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_COMPENSATING_POSTED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REVERSAL_POSTED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_FAILED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_CANCELLED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED,
      A7_PRODUCT_FINANCIAL_EFFECT_METRIC_DISABLED,
    ]);
  }

  /**
   * Returns the A7 product financial effect journal balance
   * invariant name.
   */
  getLedgerJournalBalanceInvariant(): string {
    return A7_PRODUCT_FINANCIAL_EFFECT_JOURNAL_BALANCE_INVARIANT;
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
      : new Error('The A7 product financial effect transaction could not complete');
  }

  private async postWithinTransaction(
    manager: EntityManager,
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
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
    return this.reserveAndPost(manager, ports, normalized);
  }

  private async postReversalWithinTransaction(
    manager: EntityManager,
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
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
    if (!normalized.reversalReason) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISSING,
        'The A7 product financial effect reversal reason is required',
        checkWithFailed('recoveryReference', 'FAIL'),
      );
    }
    const ports = this.repository.getConsumerPorts();
    const authorityFailure = await this.validateAuthorities(ports, normalized, {
      checkExistingSettlement: false,
    });
    if (authorityFailure) {
      return this.failure(
        command,
        authorityFailure.code,
        authorityFailure.message,
        authorityFailure.checks,
      );
    }
    return this.reserveAndPostReversal(manager, ports, normalized);
  }

  private failWithinTransaction(
    manager: EntityManager,
    command: A7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    void manager;
    return Promise.resolve(
      this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_FAILED,
        'The A7 product financial effect failure is reserved for failProductFinancialEffect use',
        checkWithFailed('a5LedgerInvariant', 'FAIL'),
      ),
    );
  }

  private async validateAuthorities(
    ports: A7ProductFinancialEffectConsumerPorts,
    command: NormalizedA7ProductFinancialEffectV1,
    options: { readonly checkExistingSettlement: boolean } = { checkExistingSettlement: true },
  ): Promise<{ code: string; message: string; checks: AllChecks } | null> {
    // 0. A5 ledger enabled (pilot-disable boundary, read-only)
    const ledgerEnabled = await ports.a5LedgerEnabled();
    if (!ledgerEnabled.enabled) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DISABLED,
        message: `The A5 Ledger is disabled: ${ledgerEnabled.reason ?? 'unknown'}`,
        checks: checkWithFailed('a5LedgerEnabled', 'FAIL'),
      };
    }

    // 1. A2 authorization context (read-only correlation)
    const a2 = await ports.a2AuthorizationContextLookup(command.a2AuthorizationContextReference);
    if (!a2) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The A2 authorization context reference could not be read',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (a2.evaluatedAt && Date.parse(a2.evaluatedAt) <= 0) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_STALE,
        message: 'The A2 authorization context is stale',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }
    if (!a2.allowed) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_DENIED,
        message: 'The A2 authorization context is denied',
        checks: checkWithFailed('a2AuthorizationContext', 'FAIL'),
      };
    }

    // 2. A3 binding recheck (read-only correlation)
    const a3 = await ports.a3BindingRecheck({
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      walletAccountId: command.bindingId,
      ledgerAccountId: command.bindingId,
      expectedCurrency: CURRENCY,
      expectedAccountingUnit: ACCOUNTING_UNIT,
      expectedBindingVersion: command.bindingVersion,
    });
    if (!a3) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_NOT_ACTIVE,
        message: 'The A3 internal account binding could not be validated',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }
    if (a3.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_STALE_BINDING,
        message: 'The A3 binding version is stale',
        checks: checkWithFailed('a3Binding', 'FAIL'),
      };
    }

    // 3. A4 product-policy decision (read-only correlation)
    const a4 = await ports.a4ProductPolicyDecisionLookup(command.a4ProductPolicyDecisionReference);
    if (!a4) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The A4 product-policy decision reference could not be read',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (!EXECUTABLE_A4_DECISIONS.has(a4.decision)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE,
        message:
          'The A4 product-policy decision is not executable for the A7 product financial effect',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }
    if (a4.expiresAt && Date.parse(a4.expiresAt) <= Date.now()) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_EXPIRED,
        message: 'The A4 product-policy decision is expired',
        checks: checkWithFailed('a4ProductPolicyDecision', 'FAIL'),
      };
    }

    // 4. A6T05 external-operation (read-only correlation)
    const a6 = await ports.a6ExternalOperationLookup(command.a6ExternalOperationReference);
    if (!a6) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
        message: 'The A6T05 external-operation record could not be read',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.partnerKey !== 'NIBSS_NIP') {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 partner key is not NIBSS_NIP',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.capabilityKey !== 'external.wallet.withdrawal.settlement') {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 capability key is not external.wallet.withdrawal.settlement',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.providerIdempotencyScope !== command.a6ProviderIdempotencyScope) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message:
          'The A6T05 provider idempotency scope does not match the A7 product financial effect',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.providerIdempotencyKey !== command.a6ProviderIdempotencyKey) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message:
          'The A6T05 provider idempotency key does not match the A7 product financial effect',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.customerId !== command.customerId) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 customerId does not match the A7 product financial effect',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.currency !== CURRENCY) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 currency is not NGN',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.accountingUnit !== ACCOUNTING_UNIT) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 accounting unit is not CUSTOMER_FUNDS',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }
    if (a6.amountMinor !== command.amountMinor) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The A6T05 amount does not match the A7 product financial effect',
        checks: checkWithFailed('a6ExternalOperation', 'FAIL'),
      };
    }

    // 5. A6 lifecycle state (read-only correlation)
    const a6Lifecycle = await ports.a6LifecycleLookup(command.a6ExternalOperationReference);
    if (!a6Lifecycle) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6T05 external-operation lifecycle state could not be read',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (!A6_LIFECYCLE_ALLOWED_STATES.has(a6Lifecycle.lifecycleState)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING,
        message: `The A6T05 external-operation lifecycle state ${a6Lifecycle.lifecycleState} is not registered`,
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (A6_LIFECYCLE_TERMINAL_STATES.has(a6Lifecycle.lifecycleState)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_TERMINAL,
        message: `The A6T05 external-operation lifecycle state is terminal (${a6Lifecycle.lifecycleState})`,
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.lifecycleState !== command.a6LifecycleState) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_STALE,
        message: 'The A6T05 external-operation lifecycle state is stale',
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.lifecycleState !== A6_LIFECYCLE_VERIFIED_STATE) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_NOT_VERIFIED,
        message: `The A6T05 external-operation lifecycle state is not PENDING_VERIFICATION (${a6Lifecycle.lifecycleState})`,
        checks: checkWithFailed('a6Lifecycle', 'FAIL'),
      };
    }
    if (a6Lifecycle.attemptCount > a6Lifecycle.maxAttempts) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_RETRY_EXHAUSTED,
        message: 'The A6T05 external-operation retry attempts are exhausted',
        checks: checkWithFailed('a6Retry', 'FAIL'),
      };
    }

    // 6. A6 status verification (read-only correlation)
    const a6Status = await ports.a6StatusVerification(command.a6ExternalOperationReference);
    if (a6Status.state === 'UNAVAILABLE') {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE,
        message: 'The A6T07 status verification is unavailable',
        checks: checkWithFailed('a6StatusVerification', 'FAIL'),
      };
    }

    // 7. A6 circuit-breaker (read-only correlation)
    const a6Circuit = await ports.a6CircuitBreaker(a6.partnerKey, a6.capabilityKey);
    if (a6Circuit.state === 'OPEN') {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_CIRCUIT_OPEN,
        message: 'The A6 partner circuit-breaker is OPEN',
        checks: checkWithFailed('a6CircuitBreaker', 'FAIL'),
      };
    }

    // 8. A7T04 product customer-binding map (read-only correlation)
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
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The A7T04 product customer-binding map could not be read',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }
    if (a7T04.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED,
        message: 'The A7T04 product customer-binding map product key does not match',
        checks: checkWithFailed('a7T04ProductCustomerBinding', 'FAIL'),
      };
    }

    // 9. A7T05 product command/operation (read-only correlation)
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
      command.amountMinor,
      CURRENCY,
      ACCOUNTING_UNIT,
    );
    if (!a7T05) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
        message: 'The A7T05 product command/operation reference could not be read',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation product key does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.capabilityKey !== command.capabilityKey) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation capability key does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.action !== command.action) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation action does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.productState !== command.productState) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation product state does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.customerId !== command.customerId) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation customerId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.customerWalletId !== command.customerWalletId) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation customerWalletId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.bindingId !== command.bindingId) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation bindingId does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.bindingVersion !== command.bindingVersion) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation bindingVersion does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.amountMinor !== command.amountMinor) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation amountMinor does not match',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.currency !== CURRENCY) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation currency is not NGN',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }
    if (a7T05.accountingUnit !== ACCOUNTING_UNIT) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH,
        message: 'The A7T05 product command/operation accounting unit is not CUSTOMER_FUNDS',
        checks: checkWithFailed('a7T05ProductCommand', 'FAIL'),
      };
    }

    // 10. A7T07 product lifecycle (read-only correlation)
    const a7T07 = await ports.a7T07ProductLifecycleLookup(
      command.a7ProductLifecycleReference,
      command.customerId,
      command.customerWalletId,
      command.bindingId,
      command.bindingVersion,
      command.productKey,
      command.capabilityKey,
      command.action,
      command.productState,
    );
    if (!a7T07) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISSING,
        message: 'The A7T07 product lifecycle handoff could not be read',
        checks: checkWithFailed('a7T07ProductLifecycle', 'FAIL'),
      };
    }
    if (a7T07.productKey !== command.productKey) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISMATCH,
        message: 'The A7T07 product lifecycle handoff product key does not match',
        checks: checkWithFailed('a7T07ProductLifecycle', 'FAIL'),
      };
    }
    if (a7T07.currentLifecycleState !== A6_LIFECYCLE_VERIFIED_STATE) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED,
        message: `The A7T07 product lifecycle handoff is not in PENDING_VERIFICATION (${a7T07.currentLifecycleState})`,
        checks: checkWithFailed('a7T07ProductLifecycle', 'FAIL'),
      };
    }
    if (a7T07.outcome !== A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED,
        message: `The A7T07 product lifecycle handoff outcome is not OUTCOME_VERIFIED (${a7T07.outcome})`,
        checks: checkWithFailed('a7T07ProductLifecycle', 'FAIL'),
      };
    }

    // 11. A5 ledger invariant check (read-only)
    const invariant = await ports.a5LedgerInvariantCheck(CURRENCY, ACCOUNTING_UNIT);
    if (!invariant.satisfied) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_INVARIANT_VIOLATION,
        message: `The A5 Ledger invariant is not satisfied: ${invariant.reason ?? 'unknown'}`,
        checks: checkWithFailed('a5LedgerInvariant', 'FAIL'),
      };
    }

    // 12. A6T08 settlement lookup (read-only; for duplicate detection)
    // Only applies to the post path; the reversal path expects an
    // existing settlement.
    if (options.checkExistingSettlement) {
      const existingSettlement = await ports.a6T08SettlementLookup(
        command.a6ExternalOperationReference,
      );
      if (existingSettlement) {
        return {
          code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT,
          message: 'The A6T08 settlement already exists for the A6T05 external-operation reference',
          checks: checkWithFailed('a5LedgerDuplicate', 'FAIL'),
        };
      }
    }

    // 13. Outcome → A6T08 decision mapping
    const decisionValidation = this.assertA6T08Decision(command.outcome);
    if (!decisionValidation.ok) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING,
        message: decisionValidation.reason,
        checks: checkWithFailed('outcomeMapping', 'FAIL'),
      };
    }

    // 14. Verified outcome required for SETTLE
    if (
      decisionValidation.decision === 'SETTLE' &&
      command.outcome !== A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_NOT_VERIFIED,
        message: 'The A7 product financial effect SETTLE decision requires OUTCOME_VERIFIED',
        checks: checkWithFailed('outcomeVerified', 'FAIL'),
      };
    }

    return null;
  }

  private async reserveAndPost(
    manager: EntityManager,
    ports: A7ProductFinancialEffectConsumerPorts,
    command: NormalizedA7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    const canonicalHash = this.deriveRequestHash(this.toHashInput(command));
    if (canonicalHash !== command.requestHash) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
        'The caller-supplied A7 product financial effect request hash does not match the canonical hash',
        checkWithFailed('requestHash', 'FAIL'),
      );
    }
    let reservation: {
      readonly kind: A7ProductFinancialEffectReservationKind;
      readonly record: { id: string; responseBody: Record<string, unknown> | null } | null;
    };
    try {
      const r = await ports.operationsIdempotencyReserve(manager, {
        scope: A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
        retentionSeconds: A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS,
      });
      reservation = {
        kind: r.kind as A7ProductFinancialEffectReservationKind,
        record: r.record as { id: string; responseBody: Record<string, unknown> | null } | null,
      };
    } catch (error) {
      if (this.isHashConflict(error)) {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
          'The A7 internal idempotency scope/key was already used for another request hash',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      throw error;
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_IDEMPOTENCY_IN_PROGRESS,
        'The A7 product financial effect is already in progress',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    const productFinancialEffectId = this.generateProductFinancialEffectId();
    if (reservation.kind === 'REPLAY') {
      const replayed = this.replayedRecordFromReservation(
        productFinancialEffectId,
        command,
        reservation,
      );
      // Mark the replayed record as a replay; this overrides the
      // stored `replayed: false` from the original creation.
      const replayedRecord: A7ProductFinancialEffectRecordV1 = {
        ...replayed,
        replayed: true,
        updatedAt: new Date().toISOString(),
        version: replayed.version + 1,
      };
      try {
        await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
          statusCode: 200,
          responseBody: replayedRecord as unknown as Record<string, unknown>,
          resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
          resourceId: productFinancialEffectId,
          key: command.idempotencyKey,
          requestHash: canonicalHash,
        });
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product financial effect replay idempotency could not be completed',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsAudit(
          manager,
          this.buildAuditRecord(
            A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED,
            productFinancialEffectId,
            command,
            replayedRecord,
          ),
        );
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product financial effect replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsMetricsIncrement(
          manager,
          A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED,
        );
      } catch {
        // Observability must not make a financial transaction fail.
      }
      return {
        valid: true,
        reservation: { kind: 'REPLAY', record: replayedRecord, conflictReason: null },
        record: replayedRecord,
        handoff: this.buildHandoff(replayedRecord),
      };
    }

    // Reserve and post the financial effect. The A7 product
    // financial effect envelope may dispatch to one of three A6T08
    // outcomes: SETTLE, SUSPENSE, or REVERSE. The A7 product
    // financial effect service does NOT introduce a parallel
    // settlement authority; the A6T08 settlement / suspense /
    // compensating service is the only settlement / suspense /
    // compensating authority. The A7 product financial effect
    // service does NOT introduce a parallel Ledger authority; the
    // A5 Ledger service is the only financial value authority. The
    // A7 product financial effect service does NOT post a journal
    // directly; the A7 product financial effect service submits the
    // verified product outcome through the A6T08 settlement
    // service, and the A6T08 settlement service posts the A5
    // Ledger journal on the A7 product financial effect service's
    // behalf.
    const a6T08Decision = A7_PRODUCT_FINANCIAL_EFFECT_TO_A6_DECISION[command.outcome] as
      | A7ProductFinancialEffectA6T08Decision
      | undefined;
    if (!a6T08Decision) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING,
        'The A7 product financial effect outcome has no A6T08 decision mapping',
        checkWithFailed('outcomeMapping', 'FAIL'),
      );
    }
    if (a6T08Decision === 'REVERSE') {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING,
        'The A7 product financial effect REVERSE decision is reserved for reversal use',
        checkWithFailed('outcomeMapping', 'FAIL'),
      );
    }

    const productFinancialEffectReference =
      this.productFinancialEffectReference(productFinancialEffectId);
    const createdAt = new Date().toISOString();

    let category: A7ProductFinancialEffectCategory;
    let currentState: A7ProductFinancialEffectState;
    let auditAction: string;
    let metricName: string;
    let a6T08SettlementView: ExternalSettlementView | null = null;
    let a6T08SuspenseView: ExternalSuspenseEntryView | null = null;
    let a5LedgerJournal: A7ProductFinancialEffectA5LedgerJournalView | null = null;
    let a6T08Category: 'SETTLEMENT' | 'SUSPENSE' | 'COMPENSATING' | 'REVERSAL';
    if (a6T08Decision === 'SETTLE') {
      a6T08Category = 'SETTLEMENT' as const;
      category = A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SETTLEMENT;
      currentState = A7_PRODUCT_FINANCIAL_EFFECT_STATE_SETTLEMENT_POSTED;
      auditAction = A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SETTLEMENT_POSTED;
      metricName = A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SETTLEMENT_POSTED;
    } else {
      a6T08Category = 'SUSPENSE' as const;
      category = A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SUSPENSE;
      currentState = A7_PRODUCT_FINANCIAL_EFFECT_STATE_SUSPENSE_RECORDED;
      auditAction = A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SUSPENSE_RECORDED;
      metricName = A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SUSPENSE_RECORDED;
    }
    void a6T08Category;

    // Build the A6T08 evidence envelope from the A6T05 record.
    const evidence: ExternalSettlementEvidence = {
      referenceType: 'OPERATION',
      referenceValue: command.a6ExternalOperationReference,
      namespace: A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_REFERENCE_PREFIX,
      source: ExternalOperationReferenceSource.CALLBACK,
      observedAt: new Date(),
    };

    // Submit the verified product outcome to the A6T08 settlement
    // service. The A6T08 settlement service is the only settlement
    // / suspense authority; the A6T08 settlement service may post
    // the A5 Ledger journal on the A7 product financial effect
    // service's behalf (for the SETTLE decision) or record a new
    // A6T08 suspense entry (for the SUSPENSE decision).
    try {
      if (a6T08Decision === 'SETTLE') {
        // Look up the A6T05 external-operation record to extract
        // the operationId (the A6T08 settlement command requires
        // the A6T05 externalOperationId, not the
        // externalOperationReference). The A7 product financial
        // effect service reads the A6T05 record through the A6T05
        // service consumer boundary (reused as-is, without
        // modification).
        const a6View = await ports.a6ExternalOperationLookup(command.a6ExternalOperationReference);
        if (!a6View) {
          return this.failure(
            command,
            A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
            'The A6T05 external-operation record could not be read for A6T08 settlement',
            checkWithFailed('a6ExternalOperation', 'FAIL'),
          );
        }
        const settleResult = await ports.a6T08SettleVerifiedOutcome({
          externalOperationId: a6View.externalOperationId,
          decision: ExternalSettlementDecision.SETTLE,
          expectedVersion: 1,
          evidence,
          requestContext: command.requestContext,
          ownerPrincipal: A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR,
        });
        a6T08SettlementView = settleResult.settlement;
        a6T08SuspenseView = settleResult.suspense;
        a5LedgerJournal = settleResult.settlement.journalId
          ? await ports.a5LedgerJournalLookup(settleResult.settlement.journalId)
          : null;
      } else {
        // SUSPENSE
        const a6View = await ports.a6ExternalOperationLookup(command.a6ExternalOperationReference);
        if (!a6View) {
          return this.failure(
            command,
            A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
            'The A6T05 external-operation record could not be read for A6T08 suspense',
            checkWithFailed('a6ExternalOperation', 'FAIL'),
          );
        }
        const suspenseReason = (
          A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REASONS as Record<string, string>
        )[command.outcome];
        if (!suspenseReason) {
          return this.failure(
            command,
            A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING,
            'The A7 product financial effect outcome has no A6T08 suspense reason mapping',
            checkWithFailed('outcomeMapping', 'FAIL'),
          );
        }
        a6T08SuspenseView = await ports.a6T08RecordSuspense({
          externalOperationId: a6View.externalOperationId,
          reason: suspenseReason as
            | 'PROVIDER_REJECTION'
            | 'PROVIDER_SUSPENSE'
            | 'PROVIDER_UNKNOWN'
            | 'MANUAL_REVIEW'
            | 'PROVIDER_FAILURE',
          rejectionCode: 'SUSPENSE_REASON_INVALID' as ExternalSettlementRejectionCode,
          expectedVersion: 1,
          evidence,
          requestContext: command.requestContext,
          owner: A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR,
          ownerPrincipal: A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR,
        });
      }
    } catch (error) {
      if (this.isA6T08SettlementRejection(error)) {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SETTLEMENT_REJECTED,
          `The A6T08 settlement was rejected: ${(error as Error).message}`,
          checkWithFailed('a6T08Settlement', 'FAIL'),
        );
      }
      if (this.isA6T08SuspenseRejection(error)) {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SUSPENSE_REJECTED,
          `The A6T08 suspense was rejected: ${(error as Error).message}`,
          checkWithFailed('a6T08Settlement', 'FAIL'),
        );
      }
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        `The A6T08 settlement / suspense submit failed: ${(error as Error).message}`,
        checkWithFailed('a6T08Settlement', 'FAIL'),
      );
    }

    // Build the A7 product financial effect record.
    const record: A7ProductFinancialEffectRecordV1 = {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      productFinancialEffectId,
      productFinancialEffectReference,
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
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      outcome: command.outcome,
      category,
      currentState,
      a6T08Decision,
      a6T08Settlement: a6T08SettlementView,
      a6T08Suspense: a6T08SuspenseView,
      a6T08Compensating: null,
      a5LedgerJournal,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      recoveryReference: command.recoveryReference,
      reversalReason: null,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyScope: A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
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
        resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
        resourceId: productFinancialEffectId,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 internal idempotency record could not be completed',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(auditAction, productFinancialEffectId, command, record),
      );
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_RESERVED,
          productFinancialEffectId,
          command,
          record,
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product financial effect audit could not be recorded',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsOutboxEnqueue(manager, {
        eventType: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_TYPE,
        aggregateType: 'A7_PRODUCT_FINANCIAL_EFFECT',
        aggregateId: productFinancialEffectId,
        eventKey: `a7-product-financial-effect:${productFinancialEffectId}`,
        schemaVersion: 1,
        classification: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_CLASSIFICATION,
        retentionClass: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_RETENTION_CLASS,
        occurredAt: new Date(createdAt),
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: this.buildOutboxPayload(record, command, auditAction),
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTBOX_PUBLICATION_FAILED,
        'The A7 product financial effect outbox fact could not be published',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_FINANCIAL_EFFECT_METRIC_ADMITTED);
      await ports.operationsMetricsIncrement(manager, metricName);
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

  private async reserveAndPostReversal(
    manager: EntityManager,
    ports: A7ProductFinancialEffectConsumerPorts,
    command: NormalizedA7ProductFinancialEffectV1,
  ): Promise<A7ProductFinancialEffectResultV1> {
    const canonicalHash = this.deriveRequestHash(this.toHashInput(command));
    if (canonicalHash !== command.requestHash) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
        'The caller-supplied A7 product financial effect reversal request hash does not match the canonical hash',
        checkWithFailed('requestHash', 'FAIL'),
      );
    }
    if (!command.reversalReason) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISSING,
        'The A7 product financial effect reversal reason is required',
        checkWithFailed('recoveryReference', 'FAIL'),
      );
    }
    let reservation: {
      readonly kind: A7ProductFinancialEffectReservationKind;
      readonly record: { id: string; responseBody: Record<string, unknown> | null } | null;
    };
    try {
      const r = await ports.operationsIdempotencyReserve(manager, {
        scope: A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
        retentionSeconds: A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS,
      });
      reservation = {
        kind: r.kind as A7ProductFinancialEffectReservationKind,
        record: r.record as { id: string; responseBody: Record<string, unknown> | null } | null,
      };
    } catch (error) {
      if (this.isHashConflict(error)) {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
          'The A7 internal idempotency scope/key was already used for another request hash',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      throw error;
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_IDEMPOTENCY_IN_PROGRESS,
        'The A7 product financial effect reversal is already in progress',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    const productFinancialEffectId = this.generateProductFinancialEffectId();
    if (reservation.kind === 'REPLAY') {
      const replayed = this.replayedRecordFromReservation(
        productFinancialEffectId,
        command,
        reservation,
      );
      const replayedRecord: A7ProductFinancialEffectRecordV1 = {
        ...replayed,
        replayed: true,
        updatedAt: new Date().toISOString(),
        version: replayed.version + 1,
      };
      try {
        await ports.operationsIdempotencyComplete(manager, reservation.record!.id, {
          statusCode: 200,
          responseBody: replayedRecord as unknown as Record<string, unknown>,
          resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
          resourceId: productFinancialEffectId,
          key: command.idempotencyKey,
          requestHash: canonicalHash,
        });
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product financial effect reversal replay idempotency could not be completed',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsAudit(
          manager,
          this.buildAuditRecord(
            A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED,
            productFinancialEffectId,
            command,
            replayedRecord,
          ),
        );
      } catch {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
          'The A7 product financial effect reversal replay audit could not be recorded',
          checkWithFailed('idempotency', 'FAIL'),
        );
      }
      try {
        await ports.operationsMetricsIncrement(
          manager,
          A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED,
        );
      } catch {
        // Observability must not make a financial transaction fail.
      }
      return {
        valid: true,
        reservation: { kind: 'REPLAY', record: replayedRecord, conflictReason: null },
        record: replayedRecord,
        handoff: this.buildHandoff(replayedRecord),
      };
    }

    // Find the A6T05 external-operation record and the existing A6T08
    // settlement and suspense records. The A7 product financial
    // effect reversal uses the A6T08 compensating-entry and A5
    // Ledger reversal consumer boundaries. The A7 product financial
    // effect service does NOT introduce a parallel reversal
    // authority; the A6T08 compensating-entry and the A5 Ledger
    // reversal are the only reversal authorities.
    const a6View = await ports.a6ExternalOperationLookup(command.a6ExternalOperationReference);
    if (!a6View) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND,
        'The A6T05 external-operation record could not be read for the A7 product financial effect reversal',
        checkWithFailed('a6ExternalOperation', 'FAIL'),
      );
    }
    const existingSettlement = await ports.a6T08SettlementLookup(
      command.a6ExternalOperationReference,
    );
    if (!existingSettlement) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT,
        'The A6T08 settlement is missing for the A7 product financial effect reversal',
        checkWithFailed('a5LedgerDuplicate', 'FAIL'),
      );
    }
    const existingSuspense = await ports.a6T08SuspenseLookup(command.a6ExternalOperationReference);
    const firstSuspense = existingSuspense?.[0] ?? null;
    if (!firstSuspense) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT,
        'The A6T08 suspense is missing for the A7 product financial effect reversal',
        checkWithFailed('a5LedgerDuplicate', 'FAIL'),
      );
    }
    if (existingSettlement.reversalJournalId) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT,
        'The A6T08 settlement has already been reversed',
        checkWithFailed('a5LedgerDuplicate', 'FAIL'),
      );
    }

    // Post the A5 Ledger reversal journal (new compensating journal
    // that reverses the original settlement journal) and record the
    // A6T08 compensating entry (new suspense entry that represents
    // the compensating effect).
    const reversalIdempotencyKey = this.computeReversalReference(productFinancialEffectId);
    const compensatingReference = this.computeCompensatingReference(productFinancialEffectId);
    void compensatingReference;
    let a5ReversalJournal: A7ProductFinancialEffectA5LedgerJournalView | null = null;
    let a6T08Compensating: ExternalSuspenseEntryView | null = null;
    try {
      // The A5 Ledger reversal is performed through the A5
      // `LedgerService.reverseJournal()` consumer boundary. The A5
      // Ledger service creates a NEW compensating journal that
      // reverses the original settlement journal. The A7 product
      // financial effect service does NOT mutate the original
      // settlement journal.
      const a5ReversalJournalRaw = await ports.a5LedgerReverseJournal(
        existingSettlement.journalId ?? '',
        reversalIdempotencyKey,
        command.reversalReason ?? 'A7 product financial effect reversal',
      );
      a5ReversalJournal = {
        journalId: a5ReversalJournalRaw.id,
        idempotencyKey: a5ReversalJournalRaw.idempotencyKey,
        currency: a5ReversalJournalRaw.currency,
        accountingUnit: a5ReversalJournalRaw.accountingUnit,
        totalMinor: a5ReversalJournalRaw.totalMinor,
        status: a5ReversalJournalRaw.status,
        reference: a5ReversalJournalRaw.reference,
        reversalOfJournalId: a5ReversalJournalRaw.reversalOfJournalId,
        createdAt: a5ReversalJournalRaw.createdAt.toISOString(),
        postedAt: a5ReversalJournalRaw.postedAt.toISOString(),
      };
    } catch (error) {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        `The A5 Ledger reversal could not be posted: ${(error as Error).message}`,
        checkWithFailed('a5LedgerInvariant', 'FAIL'),
      );
    }
    try {
      a6T08Compensating = (
        await ports.a6T08RecordCompensatingEntry({
          externalOperationId: a6View.externalOperationId,
          settlementId: existingSettlement.settlementId,
          suspenseEntryId: firstSuspense.suspenseId,
          expectedVersion: 1,
          requestContext: command.requestContext,
          reason: command.reversalReason ?? 'A7 product financial effect reversal',
        })
      ).suspense;
    } catch (error) {
      if (this.isA6T08CompensatingRejection(error)) {
        return this.failure(
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_COMPENSATING_REJECTED,
          `The A6T08 compensating entry was rejected: ${(error as Error).message}`,
          checkWithFailed('a6T08Compensating', 'FAIL'),
        );
      }
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        `The A6T08 compensating entry could not be recorded: ${(error as Error).message}`,
        checkWithFailed('a6T08Compensating', 'FAIL'),
      );
    }
    const createdAt = new Date().toISOString();
    const productFinancialEffectReference =
      this.productFinancialEffectReference(productFinancialEffectId);
    const record: A7ProductFinancialEffectRecordV1 = {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      productFinancialEffectId,
      productFinancialEffectReference,
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
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      outcome: command.outcome,
      category: A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_REVERSAL,
      currentState: A7_PRODUCT_FINANCIAL_EFFECT_STATE_REVERSAL_POSTED,
      a6T08Decision: 'REVERSE',
      a6T08Settlement: existingSettlement,
      a6T08Suspense: firstSuspense,
      a6T08Compensating,
      a5LedgerJournal: a5ReversalJournal,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      recoveryReference: command.recoveryReference,
      reversalReason: command.reversalReason,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyScope: A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
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
        resourceType: 'A7_PRODUCT_FINANCIAL_EFFECT',
        resourceId: productFinancialEffectId,
        key: command.idempotencyKey,
        requestHash: canonicalHash,
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 internal idempotency record could not be completed',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED,
          productFinancialEffectId,
          command,
          record,
        ),
      );
      await ports.operationsAudit(
        manager,
        this.buildAuditRecord(
          A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_RESERVED,
          productFinancialEffectId,
          command,
          record,
        ),
      );
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        'The A7 product financial effect reversal audit could not be recorded',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsOutboxEnqueue(manager, {
        eventType: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_TYPE,
        aggregateType: 'A7_PRODUCT_FINANCIAL_EFFECT',
        aggregateId: productFinancialEffectId,
        eventKey: `a7-product-financial-effect:${productFinancialEffectId}`,
        schemaVersion: 1,
        classification: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_CLASSIFICATION,
        retentionClass: A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_RETENTION_CLASS,
        occurredAt: new Date(createdAt),
        correlationId: command.requestContext.correlationId,
        causationId: command.causationId,
        payload: this.buildOutboxPayload(
          record,
          command,
          A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED,
        ),
      });
    } catch {
      return this.failure(
        command,
        A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTBOX_PUBLICATION_FAILED,
        'The A7 product financial effect reversal outbox fact could not be published',
        checkWithFailed('idempotency', 'FAIL'),
      );
    }
    try {
      await ports.operationsMetricsIncrement(manager, A7_PRODUCT_FINANCIAL_EFFECT_METRIC_ADMITTED);
      await ports.operationsMetricsIncrement(
        manager,
        A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REVERSAL_POSTED,
      );
      await ports.operationsMetricsIncrement(
        manager,
        A7_PRODUCT_FINANCIAL_EFFECT_METRIC_COMPENSATING_POSTED,
      );
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

  private replayedRecordFromReservation(
    productFinancialEffectId: string,
    command: NormalizedA7ProductFinancialEffectV1,
    reservation: {
      readonly record: { id: string; responseBody: Record<string, unknown> | null } | null;
    },
  ): A7ProductFinancialEffectRecordV1 {
    if (!reservation.record) {
      throw new Error(
        'The A7 product financial effect replay reservation is missing the idempotency record',
      );
    }
    const stored = reservation.record.responseBody;
    if (stored && typeof stored === 'object' && 'productFinancialEffectId' in stored) {
      return stored as unknown as A7ProductFinancialEffectRecordV1;
    }
    const createdAt = new Date().toISOString();
    return {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      productFinancialEffectId,
      productFinancialEffectReference:
        this.productFinancialEffectReference(productFinancialEffectId),
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
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      outcome: command.outcome,
      category: A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SETTLEMENT,
      currentState: A7_PRODUCT_FINANCIAL_EFFECT_STATE_SETTLEMENT_POSTED,
      a6T08Decision: 'SETTLE',
      a6T08Settlement: null,
      a6T08Suspense: null,
      a6T08Compensating: null,
      a5LedgerJournal: null,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      recoveryReference: command.recoveryReference,
      reversalReason: command.reversalReason,
      failureCode: command.failureCode,
      failureMessage: command.failureMessage,
      providerStatus: command.providerStatus,
      idempotencyScope: A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE,
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

  private buildHandoff(
    record: A7ProductFinancialEffectRecordV1,
  ): A7ProductFinancialEffectHandoffV1 {
    const issuedAt = record.createdAt;
    const expiresAt = new Date(
      Date.parse(issuedAt) + A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_VALIDITY_SECONDS * 1000,
    ).toISOString();
    return {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      handoffScope: A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_SCOPE,
      productFinancialEffectId: record.productFinancialEffectId,
      productFinancialEffectReference: record.productFinancialEffectReference,
      productKey: record.productKey,
      capabilityKey: record.capabilityKey,
      action: record.action,
      productState: record.productState,
      currentState: record.currentState,
      outcome: record.outcome,
      category: record.category,
      a7ProductLifecycleReference: record.a7ProductLifecycleReference,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: record.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a6T08SettlementId: record.a6T08Settlement?.settlementId ?? null,
      a6T08SuspenseId: record.a6T08Suspense?.suspenseId ?? null,
      a6T08CompensatingId: record.a6T08Compensating?.suspenseId ?? null,
      a5LedgerJournalId: record.a5LedgerJournal?.journalId ?? null,
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
    productFinancialEffectId: string,
    command: NormalizedA7ProductFinancialEffectV1,
    record: A7ProductFinancialEffectRecordV1,
  ): {
    entityType: string;
    entityId: string;
    action: string;
    actor: string;
    correlationId: string;
    requestId: string;
    newValues: Readonly<Record<string, unknown>>;
  } {
    return {
      entityType: A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ENTITY_TYPE,
      entityId: productFinancialEffectId,
      action,
      actor: A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: this.buildAuditValues(action, record, command),
    };
  }

  private buildAuditValues(
    action: string,
    record: A7ProductFinancialEffectRecordV1,
    command: NormalizedA7ProductFinancialEffectV1,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7AuditContractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      a7AuditContractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      a2AuditContractName: 'A2-PROTECTED-ROUTE-AUTHORIZATION',
      a2AuditContractVersion: 1,
      a3AuditContractName: 'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
      a3AuditContractVersion: 1,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
      a5AuditContractName: 'A5-LEDGER',
      a5AuditContractVersion: 1,
      a6AuditContractName: 'A6-EXTERNAL-PARTNER-ADAPTER',
      a6AuditContractVersion: 1,
      a6T07AuditContractName: 'A6-EXTERNAL-LIFECYCLE',
      a6T07AuditContractVersion: 1,
      a6T08AuditContractName: 'A6-EXTERNAL-SETTLEMENT',
      a6T08AuditContractVersion: 1,
      a7T04AuditContractName: 'A7-PRODUCT-CUSTOMER-BINDING',
      a7T04AuditContractVersion: 1,
      a7T05AuditContractName: 'A7-PRODUCT-COMMAND',
      a7T05AuditContractVersion: 1,
      a7T07AuditContractName: 'A7-PRODUCT-LIFECYCLE',
      a7T07AuditContractVersion: 1,
      action,
      productFinancialEffectId: record.productFinancialEffectId,
      productFinancialEffectReference: record.productFinancialEffectReference,
      productKey: record.productKey,
      productVersion: record.productVersion,
      capabilityKey: record.capabilityKey,
      action_key: record.action,
      productState: record.productState,
      currentState: record.currentState,
      outcome: record.outcome,
      category: record.category,
      a6T08Decision: record.a6T08Decision,
      customerId: record.customerId,
      customerWalletId: record.customerWalletId,
      bindingId: record.bindingId,
      bindingVersion: record.bindingVersion,
      walletAccountId: record.walletAccountId,
      ledgerAccountId: record.ledgerAccountId,
      amountMinor: record.amountMinor,
      currency: record.currency,
      accountingUnit: record.accountingUnit,
      a7ProductLifecycleReference: record.a7ProductLifecycleReference,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(record.a6ProviderIdempotencyKey),
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a6T08SettlementId: record.a6T08Settlement?.settlementId ?? null,
      a6T08SuspenseId: record.a6T08Suspense?.suspenseId ?? null,
      a6T08CompensatingId: record.a6T08Compensating?.suspenseId ?? null,
      a5LedgerJournalId: record.a5LedgerJournal?.journalId ?? null,
      recoveryReference: record.recoveryReference,
      reversalReason: record.reversalReason,
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
    record: A7ProductFinancialEffectRecordV1,
    command: NormalizedA7ProductFinancialEffectV1,
    action: string,
  ): Readonly<Record<string, unknown>> {
    return Object.freeze({
      a7OutboxContractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      a7OutboxContractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      action,
      productFinancialEffectId: record.productFinancialEffectId,
      productFinancialEffectReference: record.productFinancialEffectReference,
      productKey: record.productKey,
      productVersion: record.productVersion,
      capabilityKey: record.capabilityKey,
      action_key: record.action,
      productState: record.productState,
      currentState: record.currentState,
      outcome: record.outcome,
      category: record.category,
      a6T08Decision: record.a6T08Decision,
      customerId: record.customerId,
      customerWalletId: record.customerWalletId,
      bindingId: record.bindingId,
      bindingVersion: record.bindingVersion,
      walletAccountId: record.walletAccountId,
      ledgerAccountId: record.ledgerAccountId,
      amountMinor: record.amountMinor,
      currency: record.currency,
      accountingUnit: record.accountingUnit,
      a7ProductLifecycleReference: record.a7ProductLifecycleReference,
      a7ProductCommandReference: record.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: record.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: record.a6ExternalOperationReference,
      a6LifecycleState: record.a6LifecycleState,
      a6ProviderIdempotencyScope: record.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: this.redactProviderIdempotencyKey(record.a6ProviderIdempotencyKey),
      a2AuthorizationContextReference: record.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: record.a4ProductPolicyDecisionReference,
      a6T08SettlementId: record.a6T08Settlement?.settlementId ?? null,
      a6T08SuspenseId: record.a6T08Suspense?.suspenseId ?? null,
      a6T08CompensatingId: record.a6T08Compensating?.suspenseId ?? null,
      a5LedgerJournalId: record.a5LedgerJournal?.journalId ?? null,
      recoveryReference: record.recoveryReference,
      reversalReason: record.reversalReason,
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
    command: NormalizedA7ProductFinancialEffectV1,
  ): A7ProductFinancialEffectRequestHashInputV1 {
    return {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId,
      customerWalletId: command.customerWalletId,
      bindingId: command.bindingId,
      bindingVersion: command.bindingVersion,
      amountMinor: command.amountMinor,
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      outcome: command.outcome,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      recoveryReference: command.recoveryReference,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    };
  }

  private validateCommandShape(
    command: A7ProductFinancialEffectV1,
  ): { code: string; message: string } | null {
    if (!command || command.contractName !== A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product financial effect contract name is invalid',
      };
    }
    if (command.contractVersion !== A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product financial effect contract version is invalid',
      };
    }
    if (command.productKey !== PRODUCT_KEY || command.productVersion !== PRODUCT_VERSION) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product financial effect product registration is invalid',
      };
    }
    if (
      command.capabilityKey !== CAPABILITY_ASSIGN &&
      command.capabilityKey !== CAPABILITY_INBOUND_FUNDING
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product financial effect capability key is not registered',
      };
    }
    if (command.action !== ACTION_ASSIGN && command.action !== ACTION_LIFECYCLE) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED,
        message: 'The A7 product financial effect action is not registered',
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
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_STATE_INVALID,
        message: 'The A7 product financial effect product state is not registered',
      };
    }
    if (!UUID_PATTERN.test(command.customerId)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING,
        message: 'The customerId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.customerWalletId)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING,
        message: 'The customerWalletId must be a UUID',
      };
    }
    if (!UUID_PATTERN.test(command.bindingId)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING,
        message: 'The bindingId must be a UUID',
      };
    }
    if (!Number.isSafeInteger(command.bindingVersion) || command.bindingVersion < 1) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_STALE_BINDING,
        message: 'The bindingVersion must be a positive integer',
      };
    }
    if (command.currency !== CURRENCY) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_CURRENCY_MISMATCH,
        message: 'The A7 product financial effect currency is not NGN',
      };
    }
    if (command.accountingUnit !== ACCOUNTING_UNIT) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_ACCOUNTING_UNIT_MISMATCH,
        message: 'The A7 product financial effect accounting unit is not CUSTOMER_FUNDS',
      };
    }
    if (!A7_PRODUCT_FINANCIAL_EFFECT_OUTCOMES.includes(command.outcome)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_NOT_VERIFIED,
        message: 'The A7 product financial effect outcome is not registered',
      };
    }
    if (!A6_LIFECYCLE_ALLOWED_STATES.has(command.a6LifecycleState)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING,
        message: 'The A6 lifecycle state is not registered',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a7ProductCommandReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND,
        message: 'The a7ProductCommandReference is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.a7ProductLifecycleReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISSING,
        message: 'The a7ProductLifecycleReference is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.a7T04ProductCustomerBindingMapReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING,
        message: 'The a7T04ProductCustomerBindingMapReference is invalid',
      };
    }
    if (!REFERENCE_PATTERN.test(command.a6ExternalOperationReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_MISSING,
        message: 'The a6ExternalOperationReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyScope)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The a6ProviderIdempotencyScope is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a6ProviderIdempotencyKey)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH,
        message: 'The a6ProviderIdempotencyKey is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a2AuthorizationContextReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_MISSING,
        message: 'The a2AuthorizationContextReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.a4ProductPolicyDecisionReference)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_MISSING,
        message: 'The a4ProductPolicyDecisionReference is invalid',
      };
    }
    if (
      command.a6T08SettlementReference !== null &&
      !A7_FINANCIAL_EFFECT_SETTLEMENT_KEY_PATTERN.test(command.a6T08SettlementReference)
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SETTLEMENT_REJECTED,
        message: 'The a6T08SettlementReference is invalid',
      };
    }
    if (
      command.a6T08SuspenseReference !== null &&
      !A7_FINANCIAL_EFFECT_SUSPENSE_KEY_PATTERN.test(command.a6T08SuspenseReference)
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SUSPENSE_REJECTED,
        message: 'The a6T08SuspenseReference is invalid',
      };
    }
    if (
      command.a6T08CompensatingReference !== null &&
      !A7_FINANCIAL_EFFECT_COMPENSATING_KEY_PATTERN.test(command.a6T08CompensatingReference)
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_COMPENSATING_REJECTED,
        message: 'The a6T08CompensatingReference is invalid',
      };
    }
    if (
      command.recoveryReference !== null &&
      !A7_FINANCIAL_EFFECT_RECOVERY_REFERENCE_PATTERN.test(command.recoveryReference)
    ) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISMATCH,
        message: 'The recoveryReference is invalid',
      };
    }
    if (!SAFE_TEXT_PATTERN.test(command.idempotencyKey)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE,
        message: 'The idempotencyKey is invalid',
      };
    }
    if (!SHA256_PATTERN.test(command.requestHash)) {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT,
        message: 'The requestHash must be a SHA-256 hash',
      };
    }
    try {
      parsePositiveMinorUnits(command.amountMinor);
    } catch {
      return {
        code: A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_AMOUNT_MISMATCH,
        message: 'The amountMinor is not a valid positive minor-units integer',
      };
    }
    return null;
  }

  private normalizeCommand(
    command: A7ProductFinancialEffectV1,
  ): NormalizedA7ProductFinancialEffectV1 {
    return {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      productKey: PRODUCT_KEY,
      productVersion: PRODUCT_VERSION,
      capabilityKey: command.capabilityKey,
      action: command.action,
      productState: command.productState,
      customerId: command.customerId.toLowerCase(),
      customerWalletId: command.customerWalletId.toLowerCase(),
      bindingId: command.bindingId.toLowerCase(),
      bindingVersion: command.bindingVersion,
      amountMinor: parsePositiveMinorUnits(command.amountMinor).toString(),
      currency: CURRENCY,
      accountingUnit: ACCOUNTING_UNIT,
      outcome: command.outcome,
      a7ProductLifecycleReference: command.a7ProductLifecycleReference,
      a7ProductCommandReference: command.a7ProductCommandReference,
      a7T04ProductCustomerBindingMapReference: command.a7T04ProductCustomerBindingMapReference,
      a6ExternalOperationReference: command.a6ExternalOperationReference,
      a6LifecycleState: command.a6LifecycleState,
      a6ProviderIdempotencyScope: command.a6ProviderIdempotencyScope,
      a6ProviderIdempotencyKey: command.a6ProviderIdempotencyKey,
      a2AuthorizationContextReference: command.a2AuthorizationContextReference,
      a4ProductPolicyDecisionReference: command.a4ProductPolicyDecisionReference,
      a6T08SettlementReference: command.a6T08SettlementReference,
      a6T08SuspenseReference: command.a6T08SuspenseReference,
      a6T08CompensatingReference: command.a6T08CompensatingReference,
      recoveryReference: command.recoveryReference,
      reversalReason: command.reversalReason,
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
    command: A7ProductFinancialEffectV1,
    code: string,
    message: string,
    checks: AllChecks,
  ): A7ProductFinancialEffectResultV1 {
    const failure: A7ProductFinancialEffectFailureV1 = {
      contractName: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME,
      contractVersion: A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION,
      code,
      message,
      checks,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
    return { valid: false, failure };
  }

  private generateProductFinancialEffectId(): string {
    return randomUUID();
  }

  private productFinancialEffectReference(productFinancialEffectId: string): string {
    return `${A7_PRODUCT_FINANCIAL_EFFECT_REFERENCE_PREFIX}:v${A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION}:${this.sha256(
      `A7-PRODUCT-FINANCIAL-EFFECT:${productFinancialEffectId}`,
    )}`;
  }

  private isA6T08SettlementRejection(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') {
        // Exclude suspense and compensating codes (they are checked
        // by their dedicated detectors).
        if (code.includes('SUSPENSE') || code.includes('COMPENSATING')) {
          return false;
        }
        return (
          code.includes('SETTLEMENT') ||
          code.includes('REJECT') ||
          code.includes('CURRENCY_MISMATCH') ||
          code.includes('AMOUNT_MISMATCH') ||
          code.includes('LOCK') ||
          code.includes('INVARIANT')
        );
      }
    }
    if (typeof response === 'string') {
      return /SETTLEMENT|REJECT|INVARIANT/i.test(response);
    }
    return false;
  }

  private isA6T08SuspenseRejection(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') {
        if (!code.includes('SUSPENSE')) {
          return false;
        }
        return code.includes('SUSPENSE') || code.includes('REJECT');
      }
    }
    if (typeof response === 'string') {
      return /SUSPENSE|REJECT/i.test(response);
    }
    return false;
  }

  private isA6T08CompensatingRejection(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') {
        if (!code.includes('COMPENSATING')) {
          return false;
        }
        return code.includes('COMPENSATING') || code.includes('REJECT');
      }
    }
    if (typeof response === 'string') {
      return /COMPENSATING|REJECT/i.test(response);
    }
    return false;
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
