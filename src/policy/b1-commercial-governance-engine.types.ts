/**
 * B1T10 — B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface types.
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface is the runtime B1 commercial-governance
 * decision engine for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1 commercial-
 * governance engine consumes the A1 canonical identity, the A2
 * authorization, the A3 customer-binding, the A4 product-policy, the
 * A6T10 data-classification, the B1T03 commercial catalog, the B1T04
 * commercial decision, the B1T05 billing document, the B1T06
 * commercial-incentive decision, the B1T07 commercial-rewards decision,
 * the B1T08 commercial-financial-recognition decision, the B1T09
 * commercial-analytics decision, the `CustomerPreference`, and the
 * shared Operations `AuditService`, `IdempotencyService`, `OutboxService`,
 * and `MetricsService` through approved read-only consumer boundaries.
 *
 * The B1 commercial-governance engine is the only B1 commercial-governance
 * engine for commercial data-classification, commercial idempotency,
 * commercial audit, commercial approvals, and commercial feature-flag
 * surface. The B1 commercial-governance engine is a read-only contract
 * against the existing A1 canonical identity, A2 authorization, A3
 * binding, A4 product-policy, A6 partner-adapter, A6T05 external-
 * operation, A6T08 settlement / suspense / compensating, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention /
 * legal-hold / secret / disclosure / support-trace / partner-payload
 * validation, A7 product catalog, A7 product-policy profile, A7T04
 * product customer-binding, A7T05 product command, A7T06 product
 * notification, A7T07 product lifecycle, A7T08 product financial
 * effect, A7T09 product reconciliation, A7T10 product data
 * minimization, B1T03 commercial catalog, B1T04 commercial decision,
 * B1T05 billing document, B1T06 commercial-incentive decision, B1T07
 * commercial-rewards decision, B1T08 commercial-financial-recognition
 * decision, B1T09 commercial-analytics decision, `CustomerPreference`,
 * Wallet, Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, and `CustomerPreference` authorities. The B1
 * commercial-governance engine is a read-write contract against the
 * shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, and `MetricsService` (idempotency reservation,
 * metrics increment, audit recording, and outbox event publishing only).
 *
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface NEVER:
 *  - executes a financial effect, posts a journal, mutates a balance,
 *    executes a settlement, executes a cashback, executes a reward,
 *    executes a payout, redeems a cashback, awards a loyalty balance,
 *    redeems a loyalty balance, executes a referral reward, creates
 *    a financial effect, repairs a binding, changes A4 policy / source
 *    records, executes an approval, enables a feature, dispatches a
 *    notification, modifies a classification, or communicates with an
 *    external partner;
 *  - calculates prices, fees, commissions, revenue sharing, invoices,
 *    statements, billing, promotions, cashback, loyalty, tax, cost-
 *    accounting, profitability, or financial effects outside the B1
 *    first commercial scope;
 *  - rewrites source records or rewrites history;
 *  - mutates invoices, statements, commercial decisions, pricing
 *    catalogs, product state, policy, customer bindings, customer
 *    preferences, classifications, retentions, secrets, or
 *    disclosures;
 *  - dispatches notifications, executes settlements, performs payouts,
 *    performs reconciliation, performs approval, performs feature
 *    enablement, or communicates with external partners.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4 policy
 * decision, A5 transfer / deposit / withdrawal, A6 partner-adapter,
 * A6T05 external-operation, A6T06 callback, A6T08 settlement /
 * suspense / compensating-entry, A6T09 external reconciliation,
 * A6T10 data classification / consent / retention / legal-hold /
 * secret / disclosure / support-trace / partner-payload validation,
 * A7 product catalog, A7 product-policy profile, A7T04 product
 * customer-binding, A7T05 product command/operation, A7T06 product
 * notification delivery, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, A7T10 product
 * data minimization, Wallet, Ledger, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, or `CustomerPreference`
 * authority is introduced by B1T10.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineContractName = 'B1-COMMERCIAL-GOVERNANCE-ENGINE';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineContractVersion = 1;

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface decision kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineDecisionKind =
  | 'COMMERCIAL_DATA_CLASSIFICATION'
  | 'COMMERCIAL_IDEMPOTENCY'
  | 'COMMERCIAL_AUDIT'
  | 'COMMERCIAL_APPROVAL'
  | 'COMMERCIAL_FEATURE_FLAG';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface decision outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineDecisionOutcome =
  | 'AVAILABLE'
  | 'CLASSIFIED'
  | 'AUDITED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ROLLED_OUT'
  | 'DISCREPANCY'
  | 'REPLAYED';

/**
 * The B1 commercial-governance engine commercial data-classification
 * state vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T10).
 */
export type B1CommercialDataClassificationState =
  | 'DRAFT'
  | 'CLASSIFIED'
  | 'MINIMIZED'
  | 'DISCLOSED'
  | 'RETIRED'
  | 'ARCHIVED';

/**
 * The B1 commercial-governance engine commercial idempotency state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialIdempotencyState =
  | 'DRAFT'
  | 'RESERVED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CONFLICTED'
  | 'RETIRED';

/**
 * The B1 commercial-governance engine commercial audit state vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialAuditState =
  | 'DRAFT'
  | 'RECORDED'
  | 'CORRELATED'
  | 'SEALED'
  | 'RETIRED'
  | 'ARCHIVED';

/**
 * The B1 commercial-governance engine commercial approval state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialApprovalState =
  | 'DRAFT'
  | 'PENDING'
  | 'REQUIRED'
  | 'GRANTED'
  | 'DENIED'
  | 'EXPIRED'
  | 'RETIRED';

/**
 * The B1 commercial-governance engine commercial feature-flag state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialFeatureFlagState =
  | 'DRAFT'
  | 'REGISTERED'
  | 'ROLLED_OUT'
  | 'ENABLED'
  | 'DISABLED'
  | 'RETIRED';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineDocumentKind =
  | 'COMMERCIAL_DATA_CLASSIFICATION'
  | 'COMMERCIAL_DISCLOSURE_LEVEL'
  | 'COMMERCIAL_SENSITIVITY'
  | 'COMMERCIAL_RETENTION_CLASS'
  | 'COMMERCIAL_EXPORT_RULES'
  | 'COMMERCIAL_IDEMPOTENCY_CONTRACT'
  | 'COMMERCIAL_REPLAY_POLICY'
  | 'COMMERCIAL_REPLAY_ELIGIBILITY'
  | 'COMMERCIAL_IDEMPOTENCY_VALIDATION'
  | 'COMMERCIAL_REQUEST_REPLAY_EVIDENCE'
  | 'COMMERCIAL_AUDIT_EVIDENCE'
  | 'COMMERCIAL_AUDIT_CORRELATION'
  | 'COMMERCIAL_AUDIT_ACTOR_MAPPING'
  | 'COMMERCIAL_AUDIT_ENTITY_MAPPING'
  | 'COMMERCIAL_AUDIT_EVENT'
  | 'COMMERCIAL_APPROVAL_REQUIREMENTS'
  | 'COMMERCIAL_APPROVAL_POLICY'
  | 'COMMERCIAL_APPROVAL_EVIDENCE'
  | 'COMMERCIAL_APPROVAL_TRACE'
  | 'COMMERCIAL_APPROVAL_DECISION'
  | 'COMMERCIAL_FEATURE_REGISTRATION'
  | 'COMMERCIAL_ROLLOUT_STATE'
  | 'COMMERCIAL_ENABLEMENT_RULES'
  | 'COMMERCIAL_DEPENDENCY_RULES'
  | 'COMMERCIAL_ACTIVATION_READINESS'
  | 'COMMERCIAL_ROLLOUT_EVIDENCE';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineDocumentVersion = 1;

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineScopeVersion = 1;

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineCurrency = 'NGN';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEnginePeriodKey =
  'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1';

/**
 * The B1 commercial-governance engine, commercial data-classification,
 * commercial idempotency, commercial audit, commercial approvals, and
 * commercial feature-flag surface period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEnginePeriodVersion = 1;

/**
 * The B1 commercial-governance engine commercial classification level
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialClassificationLevel =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED'
  | 'HIGHLY_RESTRICTED';

/**
 * The B1 commercial-governance engine commercial sensitivity vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialSensitivity =
  | 'COMMERCIAL_PII'
  | 'COMMERCIAL_BILLING'
  | 'COMMERCIAL_FINANCIAL'
  | 'COMMERCIAL_TAX'
  | 'COMMERCIAL_COST'
  | 'COMMERCIAL_PARTNER'
  | 'COMMERCIAL_INTERNAL'
  | 'COMMERCIAL_PUBLIC';

/**
 * The B1 commercial-governance engine commercial disclosure level
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialDisclosureLevel =
  | 'COMMERCIAL_DISCLOSURE_NONE'
  | 'COMMERCIAL_DISCLOSURE_INTERNAL'
  | 'COMMERCIAL_DISCLOSURE_RESTRICTED'
  | 'COMMERCIAL_DISCLOSURE_AUDIT'
  | 'COMMERCIAL_DISCLOSURE_SUPPORT';

/**
 * The B1 commercial-governance engine commercial retention class
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialRetentionClass =
  | 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT'
  | 'COMMERCIAL_RETENTION_AUDIT'
  | 'COMMERCIAL_RETENTION_REGULATORY'
  | 'COMMERCIAL_RETENTION_TAX'
  | 'COMMERCIAL_RETENTION_SUPPORT'
  | 'COMMERCIAL_RETENTION_LEGAL_HOLD';

/**
 * The B1 commercial-governance engine commercial export rule vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialExportRule =
  | 'COMMERCIAL_EXPORT_PROHIBITED'
  | 'COMMERCIAL_EXPORT_INTERNAL_ONLY'
  | 'COMMERCIAL_EXPORT_AUDIT_ONLY'
  | 'COMMERCIAL_EXPORT_REDACTED'
  | 'COMMERCIAL_EXPORT_MINIMIZED'
  | 'COMMERCIAL_EXPORT_APPROVED';

/**
 * The B1 commercial-governance engine commercial replay policy
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialReplayPolicy =
  | 'COMMERCIAL_REPLAY_DENY'
  | 'COMMERCIAL_REPLAY_ALLOW'
  | 'COMMERCIAL_REPLAY_REQUIRE'
  | 'COMMERCIAL_REPLAY_EXPIRE'
  | 'COMMERCIAL_REPLAY_FORCE'
  | 'COMMERCIAL_REPLAY_INHERIT';

/**
 * The B1 commercial-governance engine commercial replay eligibility
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialReplayEligibility =
  | 'COMMERCIAL_REPLAY_ELIGIBLE'
  | 'COMMERCIAL_REPLAY_INELIGIBLE'
  | 'COMMERCIAL_REPLAY_CONFLICTED'
  | 'COMMERCIAL_REPLAY_EXPIRED'
  | 'COMMERCIAL_REPLAY_IN_PROGRESS'
  | 'COMMERCIAL_REPLAY_FORCED';

/**
 * The B1 commercial-governance engine commercial audit event vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialAuditEvent =
  | 'COMMERCIAL_AUDIT_DECISION_RECORDED'
  | 'COMMERCIAL_AUDIT_FINANCIAL_EFFECT_RECORDED'
  | 'COMMERCIAL_AUDIT_BILLING_RECORDED'
  | 'COMMERCIAL_AUDIT_INVOICE_RECORDED'
  | 'COMMERCIAL_AUDIT_STATEMENT_RECORDED'
  | 'COMMERCIAL_AUDIT_CAMPAIGN_RECORDED'
  | 'COMMERCIAL_AUDIT_PROMOTION_RECORDED'
  | 'COMMERCIAL_AUDIT_COUPON_RECORDED'
  | 'COMMERCIAL_AUDIT_REFERRAL_RECORDED'
  | 'COMMERCIAL_AUDIT_CASHBACK_RECORDED'
  | 'COMMERCIAL_AUDIT_LOYALTY_RECORDED'
  | 'COMMERCIAL_AUDIT_REVENUE_RECOGNITION_RECORDED'
  | 'COMMERCIAL_AUDIT_TAX_RECORDED'
  | 'COMMERCIAL_AUDIT_COST_ACCOUNTING_RECORDED'
  | 'COMMERCIAL_AUDIT_PROFITABILITY_RECORDED'
  | 'COMMERCIAL_AUDIT_ANALYTICS_RECORDED'
  | 'COMMERCIAL_AUDIT_RECONCILIATION_RECORDED'
  | 'COMMERCIAL_AUDIT_CLASSIFICATION_RECORDED'
  | 'COMMERCIAL_AUDIT_IDEMPOTENCY_RECORDED'
  | 'COMMERCIAL_AUDIT_APPROVAL_RECORDED'
  | 'COMMERCIAL_AUDIT_FEATURE_FLAG_RECORDED'
  | 'COMMERCIAL_AUDIT_REPLAY_RECORDED'
  | 'COMMERCIAL_AUDIT_CONFLICT_RECORDED';

/**
 * The B1 commercial-governance engine commercial approval requirement
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialApprovalRequirement =
  | 'COMMERCIAL_APPROVAL_NOT_REQUIRED'
  | 'COMMERCIAL_APPROVAL_PRINCIPAL'
  | 'COMMERCIAL_APPROVAL_PRIVILEGED'
  | 'COMMERCIAL_APPROVAL_STEP_UP'
  | 'COMMERCIAL_APPROVAL_DUAL_CONTROL'
  | 'COMMERCIAL_APPROVAL_INHERIT';

/**
 * The B1 commercial-governance engine commercial approval policy
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialApprovalPolicy =
  | 'COMMERCIAL_APPROVAL_POLICY_ALLOW'
  | 'COMMERCIAL_APPROVAL_POLICY_DENY'
  | 'COMMERCIAL_APPROVAL_POLICY_REVIEW'
  | 'COMMERCIAL_APPROVAL_POLICY_ESCALATE'
  | 'COMMERCIAL_APPROVAL_POLICY_INHERIT';

/**
 * The B1 commercial-governance engine commercial feature-flag rollout
 * state vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T10).
 */
export type B1CommercialFeatureFlagRolloutState =
  | 'COMMERCIAL_FEATURE_FLAG_DRAFT'
  | 'COMMERCIAL_FEATURE_FLAG_REGISTERED'
  | 'COMMERCIAL_FEATURE_FLAG_CANARY'
  | 'COMMERCIAL_FEATURE_FLAG_ROLLED_OUT'
  | 'COMMERCIAL_FEATURE_FLAG_ENABLED'
  | 'COMMERCIAL_FEATURE_FLAG_DISABLED'
  | 'COMMERCIAL_FEATURE_FLAG_RETIRED';

/**
 * The B1 commercial-governance engine commercial activation readiness
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialActivationReadiness =
  | 'COMMERCIAL_ACTIVATION_NOT_READY'
  | 'COMMERCIAL_ACTIVATION_PENDING'
  | 'COMMERCIAL_ACTIVATION_READY'
  | 'COMMERCIAL_ACTIVATION_BLOCKED'
  | 'COMMERCIAL_ACTIVATION_INHERIT';

/**
 * The B1 commercial-governance engine commercial failure code vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineFailureCodeV1 =
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_INVALID_COMMAND'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_NOT_FOUND'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_CATALOG_MISSING'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_PROHIBITED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_NOT_FOUND'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_NOT_FOUND'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_A4_POLICY_DENIED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_A3_BINDING_INVALID'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_CONFLICT'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_EXPIRED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_IN_PROGRESS'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_CONFLICT'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_EXPIRED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NOT_APPLICABLE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_INSUFFICIENT_DATA'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_THRESHOLD_EXCEEDED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_FEATURE_FLAG_NOT_READY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_APPROVAL_REQUIRED'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_AUTO_REPAIR_ATTEMPTED';

/**
 * The B1 commercial-governance engine rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineRuleKindV1 =
  | 'A4_POLICY_LIMIT'
  | 'A4_POLICY_OBLIGATION'
  | 'A4_POLICY_CURRENTNESS'
  | 'A4_POLICY_REEVALUATION'
  | 'A3_BINDING_RECHECK'
  | 'A5_LEDGER_ACCOUNT_STATE'
  | 'A5_LEDGER_POSTING_BOUNDARY'
  | 'A5_FINANCIAL_INVARIANTS'
  | 'A6_PARTNER_STATE'
  | 'A6_PARTNER_CAPABILITY_VERSION'
  | 'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING'
  | 'A6T09_EXTERNAL_RECONCILIATION'
  | 'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT'
  | 'A6T10_DATA_CLASSIFICATION'
  | 'A6T10_CONSENT'
  | 'A6T10_RETENTION'
  | 'A6T10_LEGAL_HOLD'
  | 'A6T10_SECRET'
  | 'A6T10_DISCLOSURE'
  | 'A6T10_SUPPORT_TRACE'
  | 'A6T10_PARTNER_PAYLOAD_VALIDATION'
  | 'A6T10_DATA_MINIMIZATION'
  | 'A7_PRODUCT_CATALOG'
  | 'A7_PRODUCT_BOUNDARY'
  | 'A7T04_PRODUCT_CUSTOMER_BINDING'
  | 'A7T05_PRODUCT_COMMAND_OPERATION'
  | 'A7T06_PRODUCT_NOTIFICATION'
  | 'A7T07_PRODUCT_LIFECYCLE'
  | 'A7T08_PRODUCT_FINANCIAL_EFFECT'
  | 'A7T09_PRODUCT_RECONCILIATION'
  | 'A7T10_PRODUCT_DATA_MINIMIZATION'
  | 'B1_COMMERCIAL_CATALOG_LOOKUP'
  | 'B1_COMMERCIAL_CATALOG_COMPATIBILITY'
  | 'B1_COMMERCIAL_DECISION_LOOKUP'
  | 'B1_COMMERCIAL_DECISION_COMPATIBILITY'
  | 'B1_BILLING_ENGINE_DOCUMENT_LOOKUP'
  | 'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY'
  | 'B1_CAMPAIGN_DECISION_LOOKUP'
  | 'B1_CAMPAIGN_DECISION_COMPATIBILITY'
  | 'B1_REFERRAL_DECISION_LOOKUP'
  | 'B1_REFERRAL_DECISION_COMPATIBILITY'
  | 'B1_REVENUE_RECOGNITION_DECISION_LOOKUP'
  | 'B1_REVENUE_RECOGNITION_DECISION_COMPATIBILITY'
  | 'B1_COMMERCIAL_ANALYTICS_DECISION_LOOKUP'
  | 'B1_COMMERCIAL_ANALYTICS_DECISION_COMPATIBILITY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_CLASSIFICATION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DISCLOSURE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_SENSITIVITY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_RETENTION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_EXPORT_RULES'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_CONTRACT'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_POLICY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REPLAY_ELIGIBILITY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_IDEMPOTENCY_VALIDATION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_REQUEST_REPLAY_EVIDENCE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVIDENCE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_CORRELATION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ACTOR_MAPPING'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_ENTITY_MAPPING'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_AUDIT_EVENT'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_REQUIREMENTS'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_POLICY'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_EVIDENCE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_TRACE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_APPROVAL_DECISION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_FEATURE_REGISTRATION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_STATE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ENABLEMENT_RULES'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DEPENDENCY_RULES'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ACTIVATION_READINESS'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_ROLLOUT_EVIDENCE'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_DOCUMENT_VERSION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_READ_ONLY_TRANSACTION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_AUTO_REPAIR'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_APPROVAL_EXECUTION'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_FEATURE_ENABLEMENT'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_NOTIFICATION_DISPATCH'
  | 'B1_COMMERCIAL_GOVERNANCE_ENGINE_NO_CLASSIFICATION_MUTATION';

/**
 * The B1 commercial-governance engine rule outcome vocabulary (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 commercial-governance engine decision eligibility vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineEligibility =
  | 'CLASSIFICATION_AVAILABLE'
  | 'DISCLOSURE_AVAILABLE'
  | 'SENSITIVITY_AVAILABLE'
  | 'RETENTION_AVAILABLE'
  | 'EXPORT_AVAILABLE'
  | 'IDEMPOTENCY_AVAILABLE'
  | 'AUDIT_AVAILABLE'
  | 'APPROVAL_AVAILABLE'
  | 'FEATURE_FLAG_AVAILABLE'
  | 'REPLAY_AVAILABLE';

/**
 * The B1 commercial-governance engine commercial data-classification
 * decision (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialDataClassificationDecisionV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialDataClassificationDecisionId: string;
  readonly commercialDataClassificationDecisionReference: string;
  readonly commercialDataClassificationDecisionVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly commercialDataClassificationDecisionState: B1CommercialDataClassificationState;
  readonly commercialDataClassificationDecisionOutcome: B1CommercialGovernanceEngineDecisionOutcome;
  readonly commercialDataClassificationDecisionHash: string;
  readonly commercialDataClassificationDecisionReplayHash: string;
  readonly commercialDataClassificationRequestHash: string;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly commercialClassificationLevel: B1CommercialClassificationLevel;
  readonly commercialSensitivity: B1CommercialSensitivity;
  readonly commercialDisclosureLevel: B1CommercialDisclosureLevel;
  readonly commercialRetentionClass: B1CommercialRetentionClass;
  readonly commercialExportRule: B1CommercialExportRule;
  readonly commercialDataClassificationEligible: boolean;
  readonly commercialDataClassificationApplicable: boolean;
  readonly commercialDataClassificationSummary: readonly string[];
  readonly commercialDisclosureSummary: readonly string[];
  readonly commercialSensitivitySummary: readonly string[];
  readonly commercialRetentionSummary: readonly string[];
  readonly commercialExportRuleSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly commercialDataClassificationStartAt: string;
  readonly commercialDataClassificationEndAt: string;
  readonly commercialDataClassificationEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialGovernanceEngineEligibility[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1;
  readonly ruleTrace: B1CommercialGovernanceEngineRuleTraceV1;
  readonly analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-data-classification.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialGovernanceEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial idempotency decision
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialIdempotencyDecisionV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialIdempotencyDecisionId: string;
  readonly commercialIdempotencyDecisionReference: string;
  readonly commercialIdempotencyDecisionVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly commercialIdempotencyDecisionState: B1CommercialIdempotencyState;
  readonly commercialIdempotencyDecisionOutcome: B1CommercialGovernanceEngineDecisionOutcome;
  readonly commercialIdempotencyDecisionHash: string;
  readonly commercialIdempotencyDecisionReplayHash: string;
  readonly commercialIdempotencyRequestHash: string;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly commercialIdempotencyScope: string;
  readonly commercialIdempotencyKey: string;
  readonly commercialReplayPolicy: B1CommercialReplayPolicy;
  readonly commercialReplayEligibility: B1CommercialReplayEligibility;
  readonly commercialReplayWindowSeconds: number;
  readonly commercialIdempotencyEligible: boolean;
  readonly commercialIdempotencyApplicable: boolean;
  readonly commercialIdempotencyContractSummary: readonly string[];
  readonly commercialReplayPolicySummary: readonly string[];
  readonly commercialReplayEligibilitySummary: readonly string[];
  readonly commercialIdempotencyValidationSummary: readonly string[];
  readonly commercialRequestReplayEvidenceSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly commercialIdempotencyStartAt: string;
  readonly commercialIdempotencyEndAt: string;
  readonly commercialIdempotencyEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialGovernanceEngineEligibility[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1;
  readonly ruleTrace: B1CommercialGovernanceEngineRuleTraceV1;
  readonly analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1;
  readonly idempotencyScopeRef: 'b1.commercial-governance-engine.commercial-idempotency.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialGovernanceEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial audit decision (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialAuditDecisionV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialAuditDecisionId: string;
  readonly commercialAuditDecisionReference: string;
  readonly commercialAuditDecisionVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly commercialAuditDecisionState: B1CommercialAuditState;
  readonly commercialAuditDecisionOutcome: B1CommercialGovernanceEngineDecisionOutcome;
  readonly commercialAuditDecisionHash: string;
  readonly commercialAuditDecisionReplayHash: string;
  readonly commercialAuditRequestHash: string;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly commercialAuditEvent: B1CommercialAuditEvent;
  readonly commercialAuditActor: string;
  readonly commercialAuditEntityType: string;
  readonly commercialAuditCorrelationId: string;
  readonly commercialAuditEntityId: string;
  readonly commercialAuditEligible: boolean;
  readonly commercialAuditApplicable: boolean;
  readonly commercialAuditEvidenceSummary: readonly string[];
  readonly commercialAuditCorrelationSummary: readonly string[];
  readonly commercialAuditActorMappingSummary: readonly string[];
  readonly commercialAuditEntityMappingSummary: readonly string[];
  readonly commercialAuditEventSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly commercialAuditStartAt: string;
  readonly commercialAuditEndAt: string;
  readonly commercialAuditEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialGovernanceEngineEligibility[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1;
  readonly ruleTrace: B1CommercialGovernanceEngineRuleTraceV1;
  readonly analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-audit.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialGovernanceEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial approval decision
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialApprovalDecisionV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialApprovalDecisionId: string;
  readonly commercialApprovalDecisionReference: string;
  readonly commercialApprovalDecisionVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly commercialApprovalDecisionState: B1CommercialApprovalState;
  readonly commercialApprovalDecisionOutcome: B1CommercialGovernanceEngineDecisionOutcome;
  readonly commercialApprovalDecisionHash: string;
  readonly commercialApprovalDecisionReplayHash: string;
  readonly commercialApprovalRequestHash: string;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly commercialApprovalRequirement: B1CommercialApprovalRequirement;
  readonly commercialApprovalPolicy: B1CommercialApprovalPolicy;
  readonly commercialApprovalEligible: boolean;
  readonly commercialApprovalApplicable: boolean;
  readonly commercialApprovalGranted: boolean;
  readonly commercialApprovalDenied: boolean;
  readonly commercialApprovalRequirementsSummary: readonly string[];
  readonly commercialApprovalPolicySummary: readonly string[];
  readonly commercialApprovalEvidenceSummary: readonly string[];
  readonly commercialApprovalTraceSummary: readonly string[];
  readonly commercialApprovalDecisionSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly commercialApprovalStartAt: string;
  readonly commercialApprovalEndAt: string;
  readonly commercialApprovalEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialGovernanceEngineEligibility[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1;
  readonly ruleTrace: B1CommercialGovernanceEngineRuleTraceV1;
  readonly analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-approvals.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialGovernanceEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial feature-flag decision
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialFeatureFlagDecisionV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialFeatureFlagDecisionId: string;
  readonly commercialFeatureFlagDecisionReference: string;
  readonly commercialFeatureFlagDecisionVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly commercialFeatureFlagDecisionState: B1CommercialFeatureFlagState;
  readonly commercialFeatureFlagDecisionOutcome: B1CommercialGovernanceEngineDecisionOutcome;
  readonly commercialFeatureFlagDecisionHash: string;
  readonly commercialFeatureFlagDecisionReplayHash: string;
  readonly commercialFeatureFlagRequestHash: string;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly commercialFeatureFlagKey: string;
  readonly commercialFeatureFlagVersion: 1;
  readonly commercialFeatureFlagRolloutState: B1CommercialFeatureFlagRolloutState;
  readonly commercialFeatureFlagActivationReadiness: B1CommercialActivationReadiness;
  readonly commercialFeatureFlagEnabled: boolean;
  readonly commercialFeatureFlagApplicable: boolean;
  readonly commercialFeatureRegistrationSummary: readonly string[];
  readonly commercialRolloutStateSummary: readonly string[];
  readonly commercialEnablementRulesSummary: readonly string[];
  readonly commercialDependencyRulesSummary: readonly string[];
  readonly commercialActivationReadinessSummary: readonly string[];
  readonly commercialRolloutEvidenceSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly commercialFeatureFlagStartAt: string;
  readonly commercialFeatureFlagEndAt: string;
  readonly commercialFeatureFlagEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialGovernanceEngineEligibility[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly explanationTrace: B1CommercialGovernanceEngineExplanationTraceV1;
  readonly ruleTrace: B1CommercialGovernanceEngineRuleTraceV1;
  readonly analyticsTrace: B1CommercialGovernanceEngineAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialGovernanceEngineAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-feature-flag.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialGovernanceEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineAuditEvidenceV1 {
  readonly auditEntityType: string;
  readonly auditEntityId: string;
  readonly auditAction: string;
  readonly auditActor: string;
  readonly auditCorrelationId: string;
  readonly auditRequestId: string;
  readonly auditCausationId: string | null;
  readonly auditOutboxEventType: string;
  readonly auditOutboxEventId: string | null;
  readonly auditRecorded: boolean;
}

/**
 * The B1 commercial-governance engine explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'COMMERCIAL_DATA_CLASSIFICATION_DECISION'
    | 'COMMERCIAL_IDEMPOTENCY_DECISION'
    | 'COMMERCIAL_AUDIT_DECISION'
    | 'COMMERCIAL_APPROVAL_DECISION'
    | 'COMMERCIAL_FEATURE_FLAG_DECISION'
    | 'COMMERCIAL_GOVERNANCE_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1CommercialGovernanceEngineExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1CommercialGovernanceEngineRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1CommercialGovernanceEngineRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 commercial-governance engine rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1CommercialGovernanceEngineRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1CommercialGovernanceEngineRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1CommercialGovernanceEngineRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 commercial-governance engine analytics trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineAnalyticsTraceV1 {
  readonly analyticsTraceId: string;
  readonly analyticsSteps: readonly B1CommercialGovernanceEngineAnalyticsStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine analytics step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineAnalyticsStepV1 {
  readonly stepIndex: number;
  readonly stepKind:
    | 'COMMERCIAL_CLASSIFICATION'
    | 'COMMERCIAL_DISCLOSURE'
    | 'COMMERCIAL_SENSITIVITY'
    | 'COMMERCIAL_RETENTION'
    | 'COMMERCIAL_EXPORT_RULES'
    | 'COMMERCIAL_IDEMPOTENCY'
    | 'COMMERCIAL_REPLAY_POLICY'
    | 'COMMERCIAL_REPLAY_ELIGIBILITY'
    | 'COMMERCIAL_REPLAY_EVIDENCE'
    | 'COMMERCIAL_AUDIT_EVIDENCE'
    | 'COMMERCIAL_AUDIT_CORRELATION'
    | 'COMMERCIAL_AUDIT_ACTOR_MAPPING'
    | 'COMMERCIAL_AUDIT_ENTITY_MAPPING'
    | 'COMMERCIAL_AUDIT_EVENT'
    | 'COMMERCIAL_APPROVAL_REQUIREMENTS'
    | 'COMMERCIAL_APPROVAL_POLICY'
    | 'COMMERCIAL_APPROVAL_EVIDENCE'
    | 'COMMERCIAL_APPROVAL_TRACE'
    | 'COMMERCIAL_APPROVAL_DECISION'
    | 'COMMERCIAL_FEATURE_REGISTRATION'
    | 'COMMERCIAL_ROLLOUT_STATE'
    | 'COMMERCIAL_ENABLEMENT_RULES'
    | 'COMMERCIAL_DEPENDENCY_RULES'
    | 'COMMERCIAL_ACTIVATION_READINESS'
    | 'COMMERCIAL_ROLLOUT_EVIDENCE';
  readonly stepReference: string;
  readonly stepLabel: string;
  readonly stepOutcome: B1CommercialGovernanceEngineRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepAmount: string;
  readonly stepCurrency: B1CommercialGovernanceEngineCurrency;
  readonly stepEvaluatedAt: string;
}

/**
 * The B1 commercial-governance engine decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineFailureV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly code: B1CommercialGovernanceEngineFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1CommercialGovernanceEngineRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 commercial-governance engine commercial data-classification
 * request (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialDataClassificationRequestV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialDataClassificationRequestId: string;
  readonly commercialDataClassificationRequestVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly expectedCurrency: B1CommercialGovernanceEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialGovernanceEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialClassificationLevel: B1CommercialClassificationLevel;
  readonly commercialSensitivity: B1CommercialSensitivity;
  readonly commercialDisclosureLevel: B1CommercialDisclosureLevel;
  readonly commercialRetentionClass: B1CommercialRetentionClass;
  readonly commercialExportRule: B1CommercialExportRule;
  readonly commercialDataClassificationStartAt: string;
  readonly commercialDataClassificationEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial idempotency request
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialIdempotencyRequestV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialIdempotencyRequestId: string;
  readonly commercialIdempotencyRequestVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly expectedCurrency: B1CommercialGovernanceEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialGovernanceEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialIdempotencyScope: string;
  readonly commercialIdempotencyKey: string;
  readonly commercialReplayPolicy: B1CommercialReplayPolicy;
  readonly commercialReplayWindowSeconds: number;
  readonly commercialIdempotencyStartAt: string;
  readonly commercialIdempotencyEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial audit request (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialAuditRequestV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialAuditRequestId: string;
  readonly commercialAuditRequestVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly expectedCurrency: B1CommercialGovernanceEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialGovernanceEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialAuditEvent: B1CommercialAuditEvent;
  readonly commercialAuditActor: string;
  readonly commercialAuditEntityType: string;
  readonly commercialAuditEntityId: string;
  readonly commercialAuditStartAt: string;
  readonly commercialAuditEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial approval request
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialApprovalRequestV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialApprovalRequestId: string;
  readonly commercialApprovalRequestVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly expectedCurrency: B1CommercialGovernanceEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialGovernanceEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialApprovalRequirement: B1CommercialApprovalRequirement;
  readonly commercialApprovalPolicy: B1CommercialApprovalPolicy;
  readonly commercialApprovalStartAt: string;
  readonly commercialApprovalEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial feature-flag request
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialFeatureFlagRequestV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly commercialFeatureFlagRequestId: string;
  readonly commercialFeatureFlagRequestVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly expectedCurrency: B1CommercialGovernanceEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialGovernanceEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-data-classification'
    | 'commercial.virtual-account.inbound-funding.commercial-idempotency'
    | 'commercial.virtual-account.inbound-funding.commercial-audit'
    | 'commercial.virtual-account.inbound-funding.commercial-approvals'
    | 'commercial.virtual-account.inbound-funding.commercial-feature-flag';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1CommercialGovernanceEnginePeriodKey;
  readonly periodVersion: B1CommercialGovernanceEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialFeatureFlagKey: string;
  readonly commercialFeatureFlagRolloutState: B1CommercialFeatureFlagRolloutState;
  readonly commercialFeatureFlagActivationReadiness: B1CommercialActivationReadiness;
  readonly commercialFeatureFlagStartAt: string;
  readonly commercialFeatureFlagEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly costAccountingDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-governance engine commercial data-classification
 * replay-safe result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T10).
 */
export interface B1CommercialDataClassificationDecisionReplaySafeResultV1 {
  readonly record: B1CommercialDataClassificationDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-data-classification.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialDataClassificationRequestHash: string;
  readonly commercialDataClassificationDecisionHash: string;
  readonly commercialDataClassificationDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine commercial idempotency replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialIdempotencyDecisionReplaySafeResultV1 {
  readonly record: B1CommercialIdempotencyDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-idempotency.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialIdempotencyRequestHash: string;
  readonly commercialIdempotencyDecisionHash: string;
  readonly commercialIdempotencyDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine commercial audit replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialAuditDecisionReplaySafeResultV1 {
  readonly record: B1CommercialAuditDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-audit.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialAuditRequestHash: string;
  readonly commercialAuditDecisionHash: string;
  readonly commercialAuditDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine commercial approval replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialApprovalDecisionReplaySafeResultV1 {
  readonly record: B1CommercialApprovalDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-approvals.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialApprovalRequestHash: string;
  readonly commercialApprovalDecisionHash: string;
  readonly commercialApprovalDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine commercial feature-flag replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialFeatureFlagDecisionReplaySafeResultV1 {
  readonly record: B1CommercialFeatureFlagDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-governance-engine.commercial-feature-flag.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialFeatureFlagRequestHash: string;
  readonly commercialFeatureFlagDecisionHash: string;
  readonly commercialFeatureFlagDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-governance engine compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export type B1CommercialGovernanceEngineCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1CommercialGovernanceEngineFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 commercial-governance engine document versioning contract
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineDocumentVersioningContractV1 {
  readonly contractName: B1CommercialGovernanceEngineContractName;
  readonly contractVersion: B1CommercialGovernanceEngineContractVersion;
  readonly documentVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly scopeKey: B1CommercialGovernanceEngineScopeKey;
  readonly scopeVersion: B1CommercialGovernanceEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 commercial-governance engine document persistence record
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1CommercialGovernanceEngineDocumentVersion;
  readonly documentKind: B1CommercialGovernanceEngineDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record:
    | B1CommercialDataClassificationDecisionV1
    | B1CommercialIdempotencyDecisionV1
    | B1CommercialAuditDecisionV1
    | B1CommercialApprovalDecisionV1
    | B1CommercialFeatureFlagDecisionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 commercial-governance engine read-only consumer ports (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10).
 */
export interface B1CommercialGovernanceEngineConsumerPortsV1 {
  /**
   * B1 commercial data-classification decision generate. Returns the
   * canonical B1 commercial data-classification decision for the
   * supplied B1 commercial data-classification request. The generate
   * is read-only; the B1 commercial-governance engine never writes
   * source records, never mutates classifications, never executes an
   * approval, never enables a feature, never dispatches a
   * notification, or executes any financial effect.
   */
  readonly generateCommercialDataClassificationDecision: (
    request: B1CommercialDataClassificationRequestV1,
  ) => Promise<B1CommercialDataClassificationDecisionV1>;

  /**
   * B1 commercial data-classification decision replay-safe generate.
   * Returns the canonical B1 commercial data-classification decision
   * replay-safe result for the supplied B1 commercial data-
   * classification request. The replay-safe generate is read-only;
   * the B1 commercial-governance engine never writes source records,
   * never mutates classifications, never executes an approval, never
   * enables a feature, never dispatches a notification, or executes
   * any financial effect.
   */
  readonly replaySafeGenerateCommercialDataClassificationDecision: (
    request: B1CommercialDataClassificationRequestV1,
  ) => Promise<B1CommercialDataClassificationDecisionReplaySafeResultV1>;

  /**
   * B1 commercial idempotency decision generate. Returns the
   * canonical B1 commercial idempotency decision for the supplied
   * B1 commercial idempotency request. The generate is read-only;
   * the B1 commercial-governance engine never writes source records,
   * never mutates idempotency state, never executes an approval,
   * never enables a feature, never dispatches a notification, or
   * executes any financial effect.
   */
  readonly generateCommercialIdempotencyDecision: (
    request: B1CommercialIdempotencyRequestV1,
  ) => Promise<B1CommercialIdempotencyDecisionV1>;

  /**
   * B1 commercial idempotency decision replay-safe generate. Returns
   * the canonical B1 commercial idempotency decision replay-safe
   * result for the supplied B1 commercial idempotency request. The
   * replay-safe generate is read-only; the B1 commercial-governance
   * engine never writes source records, never mutates idempotency
   * state, never executes an approval, never enables a feature,
   * never dispatches a notification, or executes any financial
   * effect.
   */
  readonly replaySafeGenerateCommercialIdempotencyDecision: (
    request: B1CommercialIdempotencyRequestV1,
  ) => Promise<B1CommercialIdempotencyDecisionReplaySafeResultV1>;

  /**
   * B1 commercial audit decision generate. Returns the canonical
   * B1 commercial audit decision for the supplied B1 commercial
   * audit request. The generate is read-only; the B1 commercial-
   * governance engine never writes source records, never auto-
   * repairs, never executes an approval, never enables a feature,
   * never dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateCommercialAuditDecision: (
    request: B1CommercialAuditRequestV1,
  ) => Promise<B1CommercialAuditDecisionV1>;

  /**
   * B1 commercial audit decision replay-safe generate. Returns the
   * canonical B1 commercial audit decision replay-safe result for
   * the supplied B1 commercial audit request. The replay-safe
   * generate is read-only; the B1 commercial-governance engine
   * never writes source records, never auto-repairs, never executes
   * an approval, never enables a feature, never dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCommercialAuditDecision: (
    request: B1CommercialAuditRequestV1,
  ) => Promise<B1CommercialAuditDecisionReplaySafeResultV1>;

  /**
   * B1 commercial approval decision generate. Returns the canonical
   * B1 commercial approval decision for the supplied B1 commercial
   * approval request. The generate is read-only; the B1 commercial-
   * governance engine never executes an approval, never writes
   * source records, never auto-repairs, never enables a feature,
   * never dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateCommercialApprovalDecision: (
    request: B1CommercialApprovalRequestV1,
  ) => Promise<B1CommercialApprovalDecisionV1>;

  /**
   * B1 commercial approval decision replay-safe generate. Returns
   * the canonical B1 commercial approval decision replay-safe
   * result for the supplied B1 commercial approval request. The
   * replay-safe generate is read-only; the B1 commercial-governance
   * engine never executes an approval, never writes source records,
   * never auto-repairs, never enables a feature, never dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCommercialApprovalDecision: (
    request: B1CommercialApprovalRequestV1,
  ) => Promise<B1CommercialApprovalDecisionReplaySafeResultV1>;

  /**
   * B1 commercial feature-flag decision generate. Returns the
   * canonical B1 commercial feature-flag decision for the supplied
   * B1 commercial feature-flag request. The generate is read-only;
   * the B1 commercial-governance engine never enables a feature,
   * never executes an approval, never writes source records, never
   * auto-repairs, never dispatches a notification, or executes any
   * financial effect.
   */
  readonly generateCommercialFeatureFlagDecision: (
    request: B1CommercialFeatureFlagRequestV1,
  ) => Promise<B1CommercialFeatureFlagDecisionV1>;

  /**
   * B1 commercial feature-flag decision replay-safe generate.
   * Returns the canonical B1 commercial feature-flag decision
   * replay-safe result for the supplied B1 commercial feature-flag
   * request. The replay-safe generate is read-only; the B1
   * commercial-governance engine never enables a feature, never
   * executes an approval, never writes source records, never auto-
   * repairs, never dispatches a notification, or executes any
   * financial effect.
   */
  readonly replaySafeGenerateCommercialFeatureFlagDecision: (
    request: B1CommercialFeatureFlagRequestV1,
  ) => Promise<B1CommercialFeatureFlagDecisionReplaySafeResultV1>;

  /**
   * B1 commercial-governance engine compatibility check. Returns
   * the canonical B1 commercial-governance engine compatibility
   * result for the supplied B1 commercial data-classification /
   * commercial idempotency / commercial audit / commercial approval /
   * commercial feature-flag request. The compatibility check is
   * read-only; the B1 commercial-governance engine never writes
   * source records, never mutates classifications, never executes
   * an approval, never enables a feature, never dispatches a
   * notification, or executes any financial effect.
   */
  readonly compatibilityCheck: (
    request:
      | B1CommercialDataClassificationRequestV1
      | B1CommercialIdempotencyRequestV1
      | B1CommercialAuditRequestV1
      | B1CommercialApprovalRequestV1
      | B1CommercialFeatureFlagRequestV1,
  ) => Promise<B1CommercialGovernanceEngineCompatibilityResultV1>;
}
