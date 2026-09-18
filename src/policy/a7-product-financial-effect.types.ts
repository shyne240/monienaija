/**
 * A7T08 — A7 product financial effect, settlement, and Ledger
 * integration types.
 *
 * The A7 product financial effect contract is the runtime financial
 * integration and control implementation for the A7 first product
 * (`VIRTUAL_ACCOUNT` v1). The A7 product financial effect contract
 * posts only verified product financial outcomes through the
 * existing Ledger boundary (the only financial authority) and
 * represents unmatched, delayed, disputed, or ambiguous product value
 * through the approved A6T08 suspense, compensating-entry, and
 * exception controls (the only suspense, compensating, and exception
 * authorities).
 *
 * The A7 product financial effect contract consumes the A2
 * authorization context, the A3 customer-to-financial-account binding
 * (via the A3 binding tuple and the A7T04 product customer-binding
 * map), the A4 product-policy decision, the A5 Ledger / journal /
 * correction contract, the A6T05 external-operation identity and
 * provider idempotency (per ADR-0049), the A6T07 lifecycle, the
 * A6T08 settlement / suspense / compensating-entry contract, the
 * A7 product catalog (A7T02), the A7 product-policy profile (A7T03),
 * the A7T04 product customer-binding map, the A7T05 product
 * command/operation identity, the A7T07 product lifecycle, the
 * A7T06 product notification delivery, and the A6T09 external
 * reconciliation.
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
 * data-classification authority, no new A6T11 integration authority,
 * no new A7 product catalog authority, no new A7 product-policy
 * authority, no new A7T04 product customer-binding authority, no
 * new A7T05 product command/operation authority, no new A7T06
 * product notification delivery authority, no new A7T07 product
 * lifecycle authority, no new Wallet, Ledger, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, Reconciliation, or
 * `CustomerPreference` authority is introduced.
 */

import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import type { LedgerJournalView } from '../ledger/ledger.types';
import type {
  SettleVerifiedOutcomeCommand,
  SuspenseVerifiedOutcomeCommand,
  RecordCompensatingEntryCommand,
  ExternalSettlementResult,
  ExternalSettlementCompensatingResult,
} from '../partner/external-settlement.types';
import type { PostJournalCommand } from '../ledger/ledger.types';

/**
 * The A7 product-catalog product key for the first product. The A7
 * product financial effect contract binds the A7 product financial
 * effect identity to the A7 product catalog registration.
 */
export type A7ProductFinancialEffectProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A7 product financial effect state vocabulary.
 */
export type A7ProductFinancialEffectState =
  | 'FINANCIAL_EFFECT_PENDING'
  | 'FINANCIAL_EFFECT_ADMITTED'
  | 'FINANCIAL_EFFECT_SETTLEMENT_POSTED'
  | 'FINANCIAL_EFFECT_SUSPENSE_RECORDED'
  | 'FINANCIAL_EFFECT_COMPENSATING_POSTED'
  | 'FINANCIAL_EFFECT_REVERSAL_POSTED'
  | 'FINANCIAL_EFFECT_FAILED'
  | 'FINANCIAL_EFFECT_CANCELLED';

/**
 * The A7 product financial effect outcome vocabulary.
 */
export type A7ProductFinancialEffectOutcome =
  | 'OUTCOME_VERIFIED'
  | 'OUTCOME_REJECTED'
  | 'OUTCOME_SUSPENSE'
  | 'OUTCOME_UNKNOWN'
  | 'OUTCOME_MANUAL_REVIEW'
  | 'OUTCOME_FAILED';

/**
 * The A7 product financial effect category vocabulary.
 */
export type A7ProductFinancialEffectCategory =
  | 'CATEGORY_SETTLEMENT'
  | 'CATEGORY_SUSPENSE'
  | 'CATEGORY_COMPENSATING'
  | 'CATEGORY_REVERSAL';

/**
 * The A7 product financial effect A6T08 decision vocabulary.
 */
export type A7ProductFinancialEffectA6T08Decision = 'SETTLE' | 'REVERSE' | 'SUSPENSE';

/**
 * The A7 product financial effect reservation kind. The A7 product
 * financial effect service returns one of:
 *  - 'NEW': the A7 internal idempotency scope/key is new; the A7
 *    product financial effect service has reserved the scope/key
 *    and is creating a new A7 product financial effect record;
 *  - 'REPLAY': the A7 internal idempotency scope/key matches an
 *    existing A7 product financial effect record with the same
 *    canonical request hash; the A7 product financial effect service
 *    returns the durable original A7 product financial effect record
 *    with `replayed: true`;
 *  - 'IN_PROGRESS': the A7 internal idempotency scope/key matches
 *    an existing in-progress A7 product financial effect
 *    reservation; the A7 product financial effect service returns a
 *    deterministic conflict;
 *  - 'CONFLICT': the A7 internal idempotency scope/key matches an
 *    existing A7 product financial effect record with a different
 *    canonical request hash; the A7 product financial effect service
 *    returns a deterministic conflict.
 */
export type A7ProductFinancialEffectReservationKind = 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT';

/**
 * The A7 product financial effect envelope (the durable A7 product
 * financial effect input). The envelope is versioned,
 * schema-validated, and idempotency-keyed. The A7 product financial
 * effect service does not trust a caller-supplied request hash; the
 * A7 product financial effect service derives the canonical A7
 * product financial effect request hash from the envelope semantic
 * material.
 */
export interface A7ProductFinancialEffectV1 {
  readonly contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  readonly contractVersion: 1;

  readonly productKey: A7ProductFinancialEffectProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductFinancialEffectProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;

  readonly amountMinor: string | number | bigint;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';

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

/**
 * The A7 product financial effect product-state vocabulary (reused
 * from the A7T02 product catalog).
 */
export type A7ProductFinancialEffectProductState =
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
 * The A7 product financial effect reservation result.
 */
export interface A7ProductFinancialEffectReservationV1 {
  readonly kind: A7ProductFinancialEffectReservationKind;
  readonly record: A7ProductFinancialEffectRecordV1 | null;
  readonly conflictReason: string | null;
}

/**
 * The A7 product financial effect record. The A7 product financial
 * effect service produces the A7 product financial effect record
 * from the A7 product financial effect envelope, the A7T05 product
 * command/operation identity, the A7T07 product lifecycle, the
 * A6T05 external-operation record, the A6T08 settlement / suspense /
 * compensating record, the A5 Ledger journal, the A4 product-policy
 * decision, the A2 authorization context, the A3 customer-binding
 * tuple (via A7T04), and the A7 product customer-binding map
 * (A7T04).
 */
export interface A7ProductFinancialEffectRecordV1 {
  readonly contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  readonly contractVersion: 1;
  readonly productFinancialEffectId: string;
  readonly productFinancialEffectReference: string;

  readonly productKey: A7ProductFinancialEffectProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductFinancialEffectProductState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;

  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;

  readonly outcome: A7ProductFinancialEffectOutcome;
  readonly category: A7ProductFinancialEffectCategory;
  readonly currentState: A7ProductFinancialEffectState;

  readonly a6T08Decision: A7ProductFinancialEffectA6T08Decision;
  readonly a6T08Settlement: ExternalSettlementView | null;
  readonly a6T08Suspense: ExternalSuspenseEntryView | null;
  readonly a6T08Compensating: ExternalSuspenseEntryView | null;
  readonly a5LedgerJournal: A7ProductFinancialEffectA5LedgerJournalView | null;

  readonly a7ProductLifecycleReference: string;
  readonly a7ProductCommandReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;

  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;

  readonly recoveryReference: string | null;
  readonly reversalReason: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly providerStatus: string | null;

  readonly idempotencyScope: 'a7.product-financial-effect.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;

  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The A7 product financial effect handoff envelope. The A7 product
 * financial effect service issues the A7 product financial effect
 * handoff to A7T09 (independent product reconciliation) and A7T11
 * (release-gate) for correlation only. The handoff carries only the
 * safe cross-domain references and never raw credentials, signatures,
 * private keys, or unrestricted customer data. The handoff is not a
 * Ledger record, not an A2 authorization, not an A3 binding repair,
 * not an A4 product-policy decision, not a settlement record, and
 * not a duplicate A6T05 lifecycle record.
 */
export interface A7ProductFinancialEffectHandoffV1 {
  readonly contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  readonly contractVersion: 1;
  readonly handoffScope: 'a7-product-financial-effect-handoff.v1';
  readonly productFinancialEffectId: string;
  readonly productFinancialEffectReference: string;
  readonly productKey: A7ProductFinancialEffectProductKey;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductFinancialEffectProductState;
  readonly currentState: A7ProductFinancialEffectState;
  readonly outcome: A7ProductFinancialEffectOutcome;
  readonly category: A7ProductFinancialEffectCategory;
  readonly a7ProductLifecycleReference: string;
  readonly a7ProductCommandReference: string;
  readonly a7T04ProductCustomerBindingMapReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly a6ProviderIdempotencyScope: string;
  readonly a6ProviderIdempotencyKey: string;
  readonly a2AuthorizationContextReference: string;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a6T08SettlementId: string | null;
  readonly a6T08SuspenseId: string | null;
  readonly a6T08CompensatingId: string | null;
  readonly a5LedgerJournalId: string | null;
  readonly recoveryReference: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string | null;
  readonly causationId: string | null;
}

/**
 * The A7 product financial effect failure record. The A7 product
 * financial effect service returns a deterministic A7 product
 * financial effect failure record for any missing, stale, denied,
 * or unsupported input. The A7 product financial effect failure
 * record is a non-terminal, support-traceable artifact.
 */
export interface A7ProductFinancialEffectFailureV1 {
  readonly contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  readonly contractVersion: 1;
  readonly code: string;
  readonly message: string;
  readonly checks: {
    readonly a2AuthorizationContext: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a3Binding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a4ProductPolicyDecision: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6ExternalOperation: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6Lifecycle: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6StatusVerification: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6CircuitBreaker: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6Retry: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T04ProductCustomerBinding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T05ProductCommand: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a7T07ProductLifecycle: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6T08Settlement: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerInvariant: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerEnabled: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerAmount: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerCurrency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerAccountingUnit: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a5LedgerDuplicate: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6T08Compensating: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly recoveryReference: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly outcomeMapping: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly outcomeVerified: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly productState: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly requestHash: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly idempotency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * The A7 product financial effect result. The A7 product financial
 * effect service returns a discriminated union of the A7 product
 * financial effect record (on admission or replay) or the A7 product
 * financial effect failure record (on denial, missing authority,
 * ledger invariant violation, A6T08 settlement rejection, suspense
 * rejection, compensating rejection, or conflict).
 */
export type A7ProductFinancialEffectResultV1 =
  | {
      readonly valid: true;
      readonly reservation: A7ProductFinancialEffectReservationV1;
      readonly record: A7ProductFinancialEffectRecordV1;
      readonly handoff: A7ProductFinancialEffectHandoffV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductFinancialEffectFailureV1;
    };

/**
 * The A2 authorization context view shape (the read-only A2 consumer
 * boundary). The A7 product financial effect service consumes the A2
 * authorization context through the A2 `AuthorizationService` consumer
 * boundary. The A7 product financial effect service does NOT issue,
 * refresh, or substitute the A2 authorization context.
 */
export interface A7ProductFinancialEffectA2AuthorizationContextView {
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
 * The A3 binding view shape (the read-only A3 consumer boundary).
 * The A7 product financial effect service consumes the A3 binding
 * through the A3 `CustomerFinancialAccountBindingService.validateActiveBinding()`
 * consumer boundary. The A7 product financial effect service does
 * NOT repair, reassign, activate, or close the A3 binding.
 */
export interface A7ProductFinancialEffectA3BindingView {
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
 * The A4 product-policy decision view shape (the read-only A4
 * consumer boundary). The A7 product financial effect service
 * consumes the A4 product-policy decision through the A7T03 A4
 * product-policy service consumer boundary. The A7 product
 * financial effect service does NOT evaluate, mutate, or refresh
 * the A4 product-policy decision.
 */
export interface A7ProductFinancialEffectA4ProductPolicyDecisionView {
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
 * The A6T05 external-operation view shape (the read-only A6T05
 * consumer boundary). The A7 product financial effect service
 * consumes the A6T05 external-operation record through the A6T05
 * `ExternalOperationService` consumer boundary. The A7 product
 * financial effect service does NOT issue, refresh, or substitute the
 * A6T05 external-operation record; the A7 product financial effect
 * service reads the A6T05 record and the A6T05 provider idempotency
 * scope/key as correlation identifiers inside the A7 product
 * financial effect audit and outbox payloads.
 */
export interface A7ProductFinancialEffectA6ExternalOperationView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly customerId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly lifecycleState: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly replayed: boolean;
}

/**
 * The A6 lifecycle view shape (the read-only A6 consumer boundary).
 * The A7 product financial effect service consumes the A6 lifecycle
 * state through the A6T05 `ExternalOperationService` consumer
 * boundary. The A7 product financial effect service does NOT issue,
 * refresh, or substitute the A6 lifecycle state.
 */
export interface A7ProductFinancialEffectA6LifecycleView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly lifecycleState: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly providerStatus: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly replayed: boolean;
}

/**
 * The A6 status verification view shape (the read-only A6 consumer
 * boundary). The A7 product financial effect service consumes the A6
 * status verification through the A6T07 `ExternalOperationStatusVerifier`
 * consumer boundary. The A7 product financial effect service does
 * NOT issue, refresh, or substitute the A6 status verification; the
 * A7 product financial effect service records the A6 status
 * verification state as a correlation identifier inside the A7
 * product financial effect audit and outbox payloads.
 */
export interface A7ProductFinancialEffectA6StatusVerificationView {
  readonly state:
    | 'VERIFIED_PENDING'
    | 'VERIFIED_REJECTED'
    | 'VERIFIED_ACCEPTED_NOT_SETTLED'
    | 'UNKNOWN'
    | 'UNAVAILABLE';
  readonly providerStatus: string | null;
  readonly providerReferenceHash: string | null;
  readonly observedAt: string;
  readonly reasonCode: string | null;
}

/**
 * The A6 circuit-breaker view shape (the read-only A6 consumer
 * boundary). The A7 product financial effect service consumes the A6
 * circuit-breaker state through the A6 `PartnerCircuitBreakerService`
 * consumer boundary. The A7 product financial effect service does
 * NOT issue, refresh, or substitute the A6 circuit-breaker; the A7
 * product financial effect service records the A6 circuit-breaker
 * state as a correlation identifier inside the A7 product financial
 * effect audit and outbox payloads.
 */
export interface A7ProductFinancialEffectA6CircuitBreakerView {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  readonly openedAt: string | null;
  readonly cooldownSeconds: number;
  readonly reasonCode: string | null;
}

/**
 * The A7T04 product customer-binding map view shape (the read-only
 * A7T04 consumer boundary). The A7 product financial effect service
 * consumes the A7T04 product customer-binding map through the A7T04
 * `A7ProductCustomerBindingService` consumer boundary. The A7
 * product financial effect service does NOT re-derive the A7T04
 * product customer-binding map inside the A7 product financial
 * effect.
 */
export interface A7ProductFinancialEffectA7T04ProductCustomerBindingMapView {
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
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
}

/**
 * The A7T05 product command/operation reference view shape (the
 * read-only A7T05 consumer boundary). The A7 product financial
 * effect service consumes the A7T05 product command/operation
 * identity through the A7T05 `A7ProductCommandService` consumer
 * boundary. The A7 product financial effect service does NOT
 * re-derive the A7T05 product command/operation identity.
 */
export interface A7ProductFinancialEffectA7T05ProductCommandView {
  readonly productCommandReference: string;
  readonly productOperationReference: string;
  readonly productKey: string;
  readonly productVersion: number;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: string;
  readonly operationState: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
}

/**
 * The A7T07 product lifecycle reference view shape (the read-only
 * A7T07 consumer boundary). The A7 product financial effect service
 * consumes the A7T07 product lifecycle handoff through the A7T07
 * `A7ProductLifecycleService` consumer boundary. The A7 product
 * financial effect service does NOT re-derive the A7T07 product
 * lifecycle handoff inside the A7 product financial effect.
 */
export interface A7ProductFinancialEffectA7T07ProductLifecycleView {
  readonly productLifecycleReference: string;
  readonly productLifecycleId: string;
  readonly productKey: string;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: string;
  readonly currentLifecycleState: string;
  readonly outcome: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
}

/**
 * The A5 Ledger journal view shape (the read-only A5 consumer
 * boundary). The A7 product financial effect service consumes the
 * A5 Ledger journal through the A5 `LedgerService` consumer
 * boundary. The A7 product financial effect service does NOT mutate
 * the A5 Ledger journal; the A7 product financial effect service
 * reads the A5 Ledger journal as a correlation identifier inside
 * the A7 product financial effect audit and outbox payloads.
 */
export interface A7ProductFinancialEffectA5LedgerJournalView {
  readonly journalId: string;
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly totalMinor: string;
  readonly status: string;
  readonly reference: string | null;
  readonly reversalOfJournalId: string | null;
  readonly createdAt: string;
  readonly postedAt: string;
}

/**
 * The A5 Ledger account view shape (the read-only A5 consumer
 * boundary). The A7 product financial effect service consumes the
 * A5 Ledger account through the A5 `LedgerService` consumer
 * boundary. The A7 product financial effect service does NOT
 * create, mutate, or close A5 Ledger accounts; the A7 product
 * financial effect service reads the A5 Ledger account as a
 * correlation identifier inside the A7 product financial effect
 * audit and outbox payloads.
 */
export interface A7ProductFinancialEffectA5LedgerAccountView {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly accountType: string;
  readonly normalBalance: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly allowNegativeBalance: boolean;
  readonly isActive: boolean;
}

/**
 * The A5 Ledger enabled view shape (the read-only A5 consumer
 * boundary). The A7 product financial effect service consumes the
 * A5 Ledger enabled state through the A5 `LedgerService` consumer
 * boundary. The A7 product financial effect service does NOT
 * mutate the A5 Ledger enabled state; the A7 product financial
 * effect service fails closed when the A5 Ledger is disabled (the
 * pilot-disable boundary).
 */
export interface A7ProductFinancialEffectA5LedgerEnabledView {
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly disabledAt: string | null;
}

/**
 * The A7 product financial effect consumer ports. The A7 product
 * financial effect service consumes the canonical authorities
 * through this port. The port is read-only with respect to A2, A3,
 * A4, A5 Ledger (read), A6T05, A6T07, A6 circuit-breaker, A7
 * product catalog, A7 product-policy profile, A7T04, A7T05, A7T06,
 * A7T07, A6T08 (read), Wallet, Reconciliation, and
 * `CustomerPreference`; the port is read-write only with respect to
 * the shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, `MetricsService`, and the existing A5
 * `LedgerService` and the existing A6T08 `ExternalSettlementService`
 * (reused as-is, without modification).
 */
export interface A7ProductFinancialEffectConsumerPorts {
  /**
   * A2 authorization context consumer.
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductFinancialEffectA2AuthorizationContextView | null>;

  /**
   * A3 binding recheck consumer.
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
  }) => Promise<A7ProductFinancialEffectA3BindingView | null>;

  /**
   * A4 product-policy decision consumer.
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductFinancialEffectA4ProductPolicyDecisionView | null>;

  /**
   * A6T05 external-operation consumer.
   */
  readonly a6ExternalOperationLookup: (
    externalOperationReference: string,
  ) => Promise<A7ProductFinancialEffectA6ExternalOperationView | null>;

  /**
   * A6 lifecycle authority consumer.
   */
  readonly a6LifecycleLookup: (
    externalOperationReference: string,
  ) => Promise<A7ProductFinancialEffectA6LifecycleView | null>;

  /**
   * A6 status verifier consumer.
   */
  readonly a6StatusVerification: (
    externalOperationReference: string,
  ) => Promise<A7ProductFinancialEffectA6StatusVerificationView>;

  /**
   * A6 circuit-breaker consumer.
   */
  readonly a6CircuitBreaker: (
    partnerKey: string,
    capabilityKey: string,
  ) => Promise<A7ProductFinancialEffectA6CircuitBreakerView>;

  /**
   * A7T04 product customer-binding map consumer.
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
  ) => Promise<A7ProductFinancialEffectA7T04ProductCustomerBindingMapView | null>;

  /**
   * A7T05 product command/operation consumer.
   */
  readonly a7T05ProductCommandLookup: (
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
  ) => Promise<A7ProductFinancialEffectA7T05ProductCommandView | null>;

  /**
   * A7T07 product lifecycle consumer.
   */
  readonly a7T07ProductLifecycleLookup: (
    productLifecycleReference: string,
    customerId: string,
    customerWalletId: string,
    bindingId: string,
    bindingVersion: number,
    productKey: string,
    capabilityKey: string,
    action: string,
    productState: string,
  ) => Promise<A7ProductFinancialEffectA7T07ProductLifecycleView | null>;

  /**
   * A6T08 settlement consumer (read-only; the A6T08 settlement
   * service is the only settlement / suspense / compensating
   * authority). The A7 product financial effect service consumes
   * the A6T08 settlement record through the A6T08
   * `ExternalSettlementService` consumer boundary. The A7 product
   * financial effect service does NOT issue, refresh, or substitute
   * the A6T08 settlement record.
   */
  readonly a6T08SettlementLookup: (
    externalOperationReference: string,
  ) => Promise<ExternalSettlementView | null>;

  /**
   * A6T08 suspense consumer.
   */
  readonly a6T08SuspenseLookup: (
    externalOperationReference: string,
  ) => Promise<ExternalSuspenseEntryView[] | null>;

  /**
   * A5 Ledger journal consumer (read-only).
   */
  readonly a5LedgerJournalLookup: (
    journalId: string,
  ) => Promise<A7ProductFinancialEffectA5LedgerJournalView | null>;

  /**
   * A5 Ledger account consumer (read-only).
   */
  readonly a5LedgerAccountLookup: (
    accountId: string,
  ) => Promise<A7ProductFinancialEffectA5LedgerAccountView | null>;

  /**
   * A5 Ledger enabled consumer (read-only). The A7 product financial
   * effect service fails closed when the A5 Ledger is disabled.
   */
  readonly a5LedgerEnabled: () => Promise<A7ProductFinancialEffectA5LedgerEnabledView>;

  /**
   * A5 Ledger invariant check consumer. The A7 product financial
   * effect service invokes the A5 Ledger invariant check through
   * the A5 `LedgerService` consumer boundary. The A7 product
   * financial effect service does NOT introduce a parallel
   * financial-invariants engine.
   */
  readonly a5LedgerInvariantCheck: (
    currency: string,
    accountingUnit: string,
  ) => Promise<{ readonly satisfied: boolean; readonly reason: string | null }>;

  /**
   * A6T08 settlement submit consumer (read-write; the A6T08
   * settlement service is the only settlement / suspense /
   * compensating authority). The A7 product financial effect
   * service submits the verified product outcome through the
   * A6T08 `ExternalSettlementService.settleVerifiedOutcome()`
   * consumer boundary. The A7 product financial effect service
   * does NOT issue, refresh, or substitute the A6T08 settlement
   * service.
   */
  readonly a6T08SettleVerifiedOutcome: (
    command: SettleVerifiedOutcomeCommand,
  ) => Promise<ExternalSettlementResult>;

  /**
   * A6T08 suspense submit consumer (read-write).
   */
  readonly a6T08RecordSuspense: (
    command: SuspenseVerifiedOutcomeCommand,
  ) => Promise<ExternalSuspenseEntryView>;

  /**
   * A6T08 compensating submit consumer (read-write).
   */
  readonly a6T08RecordCompensatingEntry: (
    command: RecordCompensatingEntryCommand,
  ) => Promise<ExternalSettlementCompensatingResult>;

  /**
   * A5 Ledger journal post consumer (read-write; the A5 Ledger
   * service is the only financial value authority). The A7 product
   * financial effect service posts the A7 product financial
   * effect journal through the A5 `LedgerService.postJournal()`
   * consumer boundary. The A7 product financial effect service
   * does NOT introduce a parallel Ledger authority.
   */
  readonly a5LedgerPostJournal: (command: PostJournalCommand) => Promise<LedgerJournalView>;

  /**
   * A5 Ledger reversal consumer.
   */
  readonly a5LedgerReverseJournal: (
    journalId: string,
    idempotencyKey: string,
    reason: string,
  ) => Promise<LedgerJournalView>;

  /**
   * A5 Ledger customer funds account consumer.
   */
  readonly a5LedgerCustomerFundsAccountLookup: (customerId: string) => Promise<{
    readonly customerLedgerAccountId: string;
    readonly settlementAssetLedgerAccountId: string;
  } | null>;

  /**
   * A5 Ledger settlement-asset account consumer.
   */
  readonly a5LedgerSettlementAssetAccountLookup: (currency: string) => Promise<string | null>;

  /**
   * Operations idempotency consumer.
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
   * Operations audit consumer.
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
   * Operations outbox consumer.
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

  /**
   * Operations metrics consumer.
   */
  readonly operationsMetricsIncrement: (
    manager: EntityManager,
    metricName: string,
    amount?: number,
  ) => Promise<void>;
}

/**
 * The A7 product financial effect request hash input. The A7 product
 * financial effect service derives the canonical A7 product
 * financial effect request hash from this input (serialized as
 * canonical JSON and hashed with SHA-256).
 */
export interface A7ProductFinancialEffectRequestHashInputV1 {
  readonly contractName: 'A7-PRODUCT-FINANCIAL-EFFECT';
  readonly contractVersion: 1;
  readonly productKey: A7ProductFinancialEffectProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductFinancialEffectProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly outcome: A7ProductFinancialEffectOutcome;
  readonly a7ProductLifecycleReference: string;
  readonly a7ProductCommandReference: string;
  readonly a6ExternalOperationReference: string;
  readonly a6LifecycleState: string;
  readonly recoveryReference: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
}
