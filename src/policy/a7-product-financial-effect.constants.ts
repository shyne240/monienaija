/**
 * A7T08 — A7 product financial effect, settlement, and Ledger
 * integration frozen constants for the A7 first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and
 * `docs/A7-PRODUCT-CATALOG-CONTRACT.md`). The A7 product financial
 * effect contract is the runtime financial integration and control
 * implementation for the A7 first product; the A7 product financial
 * effect contract posts only verified product financial outcomes
 * through the existing Ledger boundary (the only financial
 * authority) and represents unmatched, delayed, disputed, or
 * ambiguous product value through the approved A6T08 suspense,
 * compensating-entry, and exception controls (the only suspense,
 * compensating, and exception authorities).
 *
 * The A7 product financial effect contract reuses the A2
 * authorization context, the A3 customer-to-financial-account binding
 * (via the A3 binding tuple and the A7T04 product customer-binding
 * map), the A4 product-policy decision, the A5 Ledger / journal /
 * correction contract, the A6T05 external-operation identity and
 * provider idempotency (per ADR-0049), the A6T07 lifecycle, the A6T08
 * settlement / suspense / compensating-entry contract, the A7
 * product catalog (A7T02), the A7 product-policy profile (A7T03), the
 * A7T04 product customer-binding map, the A7T05 product
 * command/operation identity, the A7T07 product lifecycle, the
 * A7T06 product notification delivery, and the A6T09 external
 * reconciliation.
 *
 * The A7 product financial effect contract is a read-write contract
 * against the shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, and `MetricsService` and a read-write financial
 * contract against the existing `LedgerService` and the existing
 * A6T08 `ExternalSettlementService` (reused as-is, without
 * modification). The A7 product financial effect contract does NOT
 * introduce a second Ledger authority, a second settlement
 * authority, a second suspense authority, a second compensating-entry
 * authority, a second financial-invariants engine, a second
 * reconciliation engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second metrics
 * authority, a second diagnostics authority, a second
 * customer-binding authority, a second policy authority, a second
 * authorization authority, a second notification authority, a new
 * product financial identity, or a new product financial
 * transactional boundary. The existing Ledger authority remains the
 * only financial value authority. The existing A6T08 settlement /
 * suspense / compensating-entry authority remains the only product
 * financial control authority.
 *
 * No ledger redesign, no unauthorized chart expansion, no FX, no
 * fees/commissions, no savings interest, no lending, no customer
 * credit beyond approved product limits, no automatic suspense
 * clearing, and no external financial correction outside
 * Ledger/Finance ownership is introduced by A7T08.
 */

import { NIBSS_NIP_PARTNER_KEY } from '../partner/partner-adapter.types';

/**
 * A7 product financial effect contract name (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_NAME = 'A7-PRODUCT-FINANCIAL-EFFECT' as const;

/**
 * A7 product financial effect contract version (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_CONTRACT_VERSION = 1 as const;

/**
 * A7 product financial effect identity namespace.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_IDENTITY_NAMESPACE =
  'A7-PRODUCT-FINANCIAL-EFFECT' as const;

/**
 * A7 product financial effect internal idempotency scope (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §6.1).
 *
 * The A7 product financial effect internal idempotency scope is a
 * separate namespace from the A7T05 internal idempotency scope
 * (`A7-PRODUCT-IDEMPOTENCY.v1`), the A7T06 internal idempotency
 * scope (`a7.notification-dispatch.idempotency.v1`), the A7T07
 * internal idempotency scope (`a7.product-lifecycle.idempotency.v1`),
 * and the A6T05 internal idempotency scope
 * (`external.partner.operation.v1`). The A7 product financial effect
 * contract does NOT generate or maintain a separate A7 provider
 * idempotency scope; the A7 product financial effect contract reads
 * the A6T05 provider idempotency scope/key from the A6T05
 * `ExternalOperation` record and references it inside the A7 product
 * financial effect outbox payload as correlation metadata per
 * ADR-0049.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_INTERNAL_IDEMPOTENCY_SCOPE =
  'a7.product-financial-effect.idempotency.v1' as const;

/**
 * A7 product financial effect provider idempotency scope (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §6.2).
 *
 * The A7 product financial effect provider idempotency scope is
 * sourced from the A6T05 provider idempotency scope per ADR-0049.
 * The A7 product financial effect contract does NOT generate or
 * maintain a separate A7 provider idempotency scope.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_PROVIDER_IDEMPOTENCY_SCOPE =
  'nibss.nip.external-operation.v1' as const;

/**
 * A7 product financial effect retention interval (24 hours; aligned
 * with the shared Operations `IdempotencyService` default and the
 * A6T05 `ExternalSettlementService` default).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * A7 product financial effect audit entity type (reused by the
 * shared Operations `AuditService`; the A7 product financial effect
 * audit fact is recorded against the `A7_PRODUCT_FINANCIAL_EFFECT`
 * entity type).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ENTITY_TYPE = 'A7_PRODUCT_FINANCIAL_EFFECT' as const;

/**
 * A7 product financial effect audit actor (reused by the shared
 * Operations `AuditService`).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTOR = 'a7-product-financial-effect' as const;

/**
 * A7 product financial effect audit action codes. The A7 product
 * financial effect audit facts are recorded through the shared
 * Operations `AuditService`; the `action` is one of the A7 product
 * financial effect audit action codes.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_RESERVED =
  'A7_PRODUCT_FINANCIAL_EFFECT_RESERVED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_ADMITTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_ADMITTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SETTLEMENT_POSTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_SUSPENSE_RECORDED =
  'A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_RECORDED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_COMPENSATING_POSTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_COMPENSATING_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REVERSAL_POSTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_REVERSAL_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_FAILED =
  'A7_PRODUCT_FINANCIAL_EFFECT_FAILED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_CANCELLED =
  'A7_PRODUCT_FINANCIAL_EFFECT_CANCELLED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_REPLAYED =
  'A7_PRODUCT_FINANCIAL_EFFECT_REPLAYED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_AUDIT_ACTION_DISABLED =
  'A7_PRODUCT_FINANCIAL_EFFECT_DISABLED' as const;

/**
 * A7 product financial effect outbox event type (reused by the
 * shared Operations `OutboxService`).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_TYPE =
  'A7ProductFinancialEffectPosted' as const;

/**
 * A7 product financial effect outbox event classification (reused by
 * the shared Operations `OutboxService`).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_CLASSIFICATION =
  'INTERNAL_OPERATIONS' as const;

/**
 * A7 product financial effect outbox event retention class (reused
 * by the shared Operations `OutboxService`).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_EVENT_RETENTION_CLASS =
  'OPERATIONS_DEFAULT' as const;

/**
 * A7 product financial effect state vocabulary (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4).
 *
 * The A7 product financial effect state vocabulary is a
 * product-financial-effect vocabulary that extends, but does NOT
 * replace, the A6T05 external-operation lifecycle vocabulary, the
 * A6T08 settlement / suspense / compensating vocabulary, or the
 * A5 Ledger journal / line vocabulary. The existing Ledger
 * authority, the A6T05 lifecycle authority, and the A6T08
 * settlement / suspense / compensating authority remain the only
 * financial authorities. The A7 product financial effect states
 * are a product-side correlation vocabulary that the A7 product
 * financial effect service records alongside the A6T05 lifecycle
 * states, the A6T08 settlement states, and the A5 Ledger journal
 * states inside the A7 product financial effect audit and outbox
 * payloads.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_PENDING = 'FINANCIAL_EFFECT_PENDING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_ADMITTED = 'FINANCIAL_EFFECT_ADMITTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_SETTLEMENT_POSTED =
  'FINANCIAL_EFFECT_SETTLEMENT_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_SUSPENSE_RECORDED =
  'FINANCIAL_EFFECT_SUSPENSE_RECORDED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_COMPENSATING_POSTED =
  'FINANCIAL_EFFECT_COMPENSATING_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_REVERSAL_POSTED =
  'FINANCIAL_EFFECT_REVERSAL_POSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_FAILED = 'FINANCIAL_EFFECT_FAILED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_STATE_CANCELLED = 'FINANCIAL_EFFECT_CANCELLED' as const;

/**
 * A7 product financial effect state vocabulary (frozen array of all
 * allowed states).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_PENDING,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_ADMITTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_SETTLEMENT_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_SUSPENSE_RECORDED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_COMPENSATING_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_REVERSAL_POSTED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_CANCELLED,
]);

/**
 * A7 product financial effect terminal state vocabulary (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4). Terminal
 * states are the only states from which the A7 product financial
 * effect service does NOT admit a transition.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_TERMINAL_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_FAILED,
  A7_PRODUCT_FINANCIAL_EFFECT_STATE_CANCELLED,
]);

/**
 * A7 product financial effect outcome vocabulary (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4). The A7 product
 * financial effect outcome vocabulary is a product-financial-effect
 * outcome vocabulary that classifies the A6T05 external-operation
 * verified outcome into A6T08 settlement / suspense / compensating
 * outcomes.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED = 'OUTCOME_VERIFIED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_REJECTED = 'OUTCOME_REJECTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_SUSPENSE = 'OUTCOME_SUSPENSE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MANUAL_REVIEW = 'OUTCOME_MANUAL_REVIEW' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED = 'OUTCOME_FAILED' as const;

/**
 * A7 product financial effect outcome vocabulary (frozen array of all
 * allowed outcome classes).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_OUTCOMES: readonly string[] = Object.freeze([
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_REJECTED,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_SUSPENSE,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_UNKNOWN,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MANUAL_REVIEW,
  A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED,
]);

/**
 * A7 product financial effect category vocabulary (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SETTLEMENT = 'CATEGORY_SETTLEMENT' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SUSPENSE = 'CATEGORY_SUSPENSE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_COMPENSATING = 'CATEGORY_COMPENSATING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_REVERSAL = 'CATEGORY_REVERSAL' as const;

/**
 * A7 product financial effect category vocabulary (frozen array of
 * all allowed categories).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_CATEGORIES: readonly string[] = Object.freeze([
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SETTLEMENT,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_SUSPENSE,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_COMPENSATING,
  A7_PRODUCT_FINANCIAL_EFFECT_CATEGORY_REVERSAL,
]);

/**
 * A7 product financial effect A6T08 outcome mapping (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4). The mapping
 * translates the A7 product financial effect outcome to the
 * corresponding A6T08 settlement / suspense / compensating
 * decision.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_TO_A6_DECISION: Readonly<Record<string, string>> =
  Object.freeze({
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_VERIFIED]: 'SETTLE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_REJECTED]: 'REVERSE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_SUSPENSE]: 'SUSPENSE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_UNKNOWN]: 'SUSPENSE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MANUAL_REVIEW]: 'SUSPENSE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED]: 'SUSPENSE',
  });

/**
 * A7 product financial effect A6T08 suspense reason mapping (frozen
 * by `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4). The
 * mapping translates the A7 product financial effect outcome to the
 * corresponding A6T08 suspense reason.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REASONS: Readonly<Record<string, string>> =
  Object.freeze({
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_REJECTED]: 'PROVIDER_REJECTION',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_SUSPENSE]: 'PROVIDER_SUSPENSE',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_UNKNOWN]: 'PROVIDER_UNKNOWN',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MANUAL_REVIEW]: 'MANUAL_REVIEW',
    [A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED]: 'PROVIDER_FAILURE',
  });

/**
 * A7 product financial effect product state vocabulary (reused from
 * the A7T02 product catalog; the A7 product financial effect
 * contract does not introduce a new A7 product state).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_ASSIGN_STATES: readonly string[] = Object.freeze([
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
]);

export const A7_PRODUCT_FINANCIAL_EFFECT_FUNDING_STATES: readonly string[] = Object.freeze([
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
]);

export const A7_PRODUCT_FINANCIAL_EFFECT_ALL_STATES: readonly string[] = Object.freeze([
  ...A7_PRODUCT_FINANCIAL_EFFECT_ASSIGN_STATES,
  ...A7_PRODUCT_FINANCIAL_EFFECT_FUNDING_STATES,
]);

/**
 * A7 product financial effect capability and action keys (frozen by
 * the A7T02 product catalog registration).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_CAPABILITY_INBOUND_FUNDING =
  'virtual-account.inbound-funding' as const;

export const A7_PRODUCT_FINANCIAL_EFFECT_ACTION_ASSIGN = 'assign' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_ACTION_LIFECYCLE = 'lifecycle' as const;

/**
 * A6 partner identity (reused from the A6T05 partner-adapter
 * boundary).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_PARTNER_KEY = NIBSS_NIP_PARTNER_KEY;
export const A7_PRODUCT_FINANCIAL_EFFECT_PARTNER_CAPABILITY =
  'external.wallet.withdrawal.settlement' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_PARTNER_OPERATION = 'OUTBOUND_BANK_SETTLEMENT' as const;

/**
 * A7 product financial effect failure codes (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_STALE =
  'A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_STALE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A2_AUTHORIZATION_DENIED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A2_AUTHORIZATION_DENIED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A3_BINDING_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_BINDING_NOT_ACTIVE =
  'A7_PRODUCT_FINANCIAL_EFFECT_A3_BINDING_NOT_ACTIVE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A3_STALE_BINDING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A3_STALE_BINDING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_EXPIRED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_EXPIRED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE =
  'A7_PRODUCT_FINANCIAL_EFFECT_A4_POLICY_DECISION_NOT_EXECUTABLE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_NOT_FOUND' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_TERMINAL =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_TERMINAL' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_STALE =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_STALE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_LIFECYCLE_NOT_VERIFIED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_LIFECYCLE_NOT_VERIFIED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_STATUS_VERIFICATION_UNAVAILABLE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_CIRCUIT_OPEN =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_CIRCUIT_OPEN' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6_RETRY_EXHAUSTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6_RETRY_EXHAUSTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_NOT_FOUND' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_NOT_VERIFIED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A7T07_PRODUCT_LIFECYCLE_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_A7T07_PRODUCT_LIFECYCLE_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_INVARIANT_VIOLATION =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_INVARIANT_VIOLATION' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DISABLED =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DISABLED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_AMOUNT_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_AMOUNT_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_CURRENCY_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_CURRENCY_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_ACCOUNTING_UNIT_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_ACCOUNTING_UNIT_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_LEDGER_DUPLICATE_SETTLEMENT =
  'A7_PRODUCT_FINANCIAL_EFFECT_LEDGER_DUPLICATE_SETTLEMENT' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SETTLEMENT_REJECTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6T08_SETTLEMENT_REJECTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_SUSPENSE_REJECTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6T08_SUSPENSE_REJECTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_A6T08_COMPENSATING_REJECTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_A6T08_COMPENSATING_REJECTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_RECOVERY_REFERENCE_MISMATCH =
  'A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_MISMATCH' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_MAPPING_MISSING =
  'A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_MAPPING_MISSING' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_FAILED =
  'A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_FAILED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTCOME_NOT_VERIFIED =
  'A7_PRODUCT_FINANCIAL_EFFECT_OUTCOME_NOT_VERIFIED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_REQUEST_HASH_CONFLICT =
  'A7_PRODUCT_FINANCIAL_EFFECT_REQUEST_HASH_CONFLICT' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_IDEMPOTENCY_IN_PROGRESS =
  'A7_PRODUCT_FINANCIAL_EFFECT_IDEMPOTENCY_IN_PROGRESS' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE =
  'A7_PRODUCT_FINANCIAL_EFFECT_OPERATIONS_EVIDENCE_UNAVAILABLE' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_OUTBOX_PUBLICATION_FAILED =
  'A7_PRODUCT_FINANCIAL_EFFECT_OUTBOX_PUBLICATION_FAILED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_CATALOG_REJECTED =
  'A7_PRODUCT_FINANCIAL_EFFECT_PRODUCT_CATALOG_REJECTED' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_FAILURE_PRODUCT_STATE_INVALID =
  'A7_PRODUCT_FINANCIAL_EFFECT_PRODUCT_STATE_INVALID' as const;

/**
 * A7 product financial effect metric names (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §4). The A7
 * product financial effect metrics are recorded through the shared
 * Operations `MetricsService` (the only metrics authority).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_ADMITTED =
  'a7.product-financial-effect.admitted' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SETTLEMENT_POSTED =
  'a7.product-financial-effect.settlement-posted' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_SUSPENSE_RECORDED =
  'a7.product-financial-effect.suspense-recorded' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_COMPENSATING_POSTED =
  'a7.product-financial-effect.compensating-posted' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REVERSAL_POSTED =
  'a7.product-financial-effect.reversal-posted' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_FAILED =
  'a7.product-financial-effect.failed' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_CANCELLED =
  'a7.product-financial-effect.cancelled' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_REPLAYED =
  'a7.product-financial-effect.replayed' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_METRIC_DISABLED =
  'a7.product-financial-effect.disabled' as const;

/**
 * A7 product financial effect handoff scope (single-use,
 * support-traceable, A2-protected internal control surface).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_SCOPE =
  'a7-product-financial-effect-handoff.v1' as const;

/**
 * A7 product financial effect handoff validity interval.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_HANDOFF_VALIDITY_SECONDS = 15 * 60;

/**
 * A7 product financial effect reference prefixes (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §2.1).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_REFERENCE_PREFIX = 'a7-product-financial-effect' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_SETTLEMENT_REFERENCE_PREFIX =
  'a7-product-financial-effect-settlement' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_SUSPENSE_REFERENCE_PREFIX =
  'a7-product-financial-effect-suspense' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_COMPENSATING_REFERENCE_PREFIX =
  'a7-product-financial-effect-compensating' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_REVERSAL_REFERENCE_PREFIX =
  'a7-product-financial-effect-reversal' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_RECOVERY_REFERENCE_PREFIX =
  'a7-product-financial-effect-recovery' as const;

/**
 * A7 product financial effect journal direction vocabulary (frozen
 * by `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §5).
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_DEBIT = 'DEBIT' as const;
export const A7_PRODUCT_FINANCIAL_EFFECT_CREDIT = 'CREDIT' as const;

/**
 * A7 product financial effect journal balance invariant (frozen by
 * `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md` §5). The A7 product
 * financial effect journal is a double-entry journal: the sum of
 * debits must equal the sum of credits in minor units for every
 * A7 product financial effect journal, and every A7 product
 * financial effect journal must be balanced against the existing A5
 * Ledger balance invariant.
 */
export const A7_PRODUCT_FINANCIAL_EFFECT_JOURNAL_BALANCE_INVARIANT =
  'A7_PRODUCT_FINANCIAL_EFFECT_BALANCED' as const;
