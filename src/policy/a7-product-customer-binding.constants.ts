/**
 * A7T03 — A4 product-policy frozen constants for the A7 first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and `docs/A7-PRODUCT-CATALOG-CONTRACT.md`).
 * The A7 product-policy contract reuses the A4 capability, action, policy-version,
 * profile-version, decision-vocabulary, source-requirement-mode, and
 * product-eligibility vocabulary. No new A4 vocabulary is introduced. No A4
 * source record is mutated. No new policy evaluator, re-evaluation engine,
 * replay engine, persistence layer, audit store, or idempotency store is
 * introduced; the A4 authority remains the only policy authority.
 */

import { PolicyDecisionState } from './capability-policy.enums';
import { PolicyReevaluationTrigger } from './capability-policy-recovery.enums';
import { NIBSS_NIP_PARTNER_KEY } from '../partner/partner-adapter.types';

/**
 * A7 product-catalog product key for the first product (frozen by
 * `docs/A7-PRODUCT-CATALOG-CONTRACT.md` §3).
 */
export const A7_PRODUCT_KEY_VIRTUAL_ACCOUNT = 'VIRTUAL_ACCOUNT' as const;

/**
 * A4 capability and action keys for the first product's two capabilities.
 * The A4 capability is reused as-is; the A4 action is one of the A7 product's
 * two product-catalog action verbs.
 */
export const A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY = 'product.virtual-account' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN = 'assign' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE = 'lifecycle' as const;

/**
 * A4 product-policy profile references (frozen) for the first product's two
 * capabilities. The profile reference is the A4 lookup key; the policy version
 * is the A4 frozen version identifier; the profile version is the A4 numeric
 * version.
 */
export const A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE =
  'profile.product-virtual-account-assign.v1' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION =
  'a4.profile.product-virtual-account-assign.v1' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_VERSION = 1 as const;

export const A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE =
  'profile.product-virtual-account-lifecycle.v1' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION =
  'a4.profile.product-virtual-account-lifecycle.v1' as const;
export const A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_VERSION = 1 as const;

/**
 * A4 decision-vocabulary constants (reused). The A7 product-policy contract
 * does not introduce a new decision state.
 */
export const A7_PRODUCT_POLICY_ALLOWED_DECISIONS: readonly PolicyDecisionState[] = [
  PolicyDecisionState.ALLOW,
  PolicyDecisionState.ALLOW_WITH_LIMITS,
  PolicyDecisionState.PENDING_REVIEW,
  PolicyDecisionState.DENY,
  PolicyDecisionState.SUSPEND,
] as const;

/**
 * A4 re-evaluation-trigger default for the A7 product-policy re-evaluation.
 * The A7 first product's re-evaluation trigger is `SOURCE_CHANGED`, which fires
 * when a partner-cleared virtual-account assignment becomes available.
 */
export const A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER =
  PolicyReevaluationTrigger.SOURCE_CHANGED;

/**
 * A4 idempotency scope (reused) for the A7 product-policy idempotency.
 */
export const A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE = 'policy.capability-decision.v1' as const;

/**
 * A4 re-evaluation idempotency scope (reused) for the A7 product-policy
 * re-evaluation idempotency.
 */
export const A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE =
  'policy.capability-decision.v1' as const;

/**
 * A4 audit actor (reused) for the A7 product-policy audit.
 */
export const A7_PRODUCT_POLICY_AUDIT_ACTOR = 'a7-product-policy' as const;

/**
 * A4 re-evaluation audit actor (reused) for the A7 product-policy
 * re-evaluation audit.
 */
export const A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR = 'a7-product-policy-reevaluation' as const;

/**
 * A7 product-policy obligation template codes (recorded as A4
 * `PolicyObligationTemplate.code`). These are A4 obligation codes that
 * the A7 product-policy service records against the A4 product-policy
 * profile. The A4 evaluator serializes the obligation codes as part of
 * the A4 `PolicyDecisionResult.obligations`. The A7 product-policy
 * contract does not introduce a new A4 obligation template; it records
 * these codes against the existing A4 obligation template.
 */
export const A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION =
  'RECHECK_A2_AUTHORIZATION' as const;
export const A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING = 'RECHECK_A3_BINDING' as const;
export const A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE =
  'RECHECK_A6_PARTNER_REFERENCE' as const;
export const A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT =
  'RECHECK_EXECUTION_LIMIT' as const;

/**
 * A7T04 — A7 product customer-binding frozen constants.
 *
 * The A7 product customer-binding contract is a read-only consumer of the
 * A3 binding authority, the existing `virtual-account` module (compatibility
 * input), the A6 partner boundary, the A4 product-policy, the A2
 * authorization context, and the A7 product catalog. The A7 product
 * customer-binding contract does not mutate any source record. The A3
 * binding authority remains the only customer-binding authority.
 */

/**
 * A7 product customer-binding contract name.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_NAME = 'A7-PRODUCT-CUSTOMER-BINDING' as const;

/**
 * A7 product customer-binding contract version.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_CONTRACT_VERSION = 1 as const;

/**
 * A7 product customer-binding mapping name.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_MAPPING_NAME = 'A7-PRODUCT-CUSTOMER-BINDING' as const;

/**
 * A7 product customer-binding mapping version.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_MAPPING_VERSION = 1 as const;

/**
 * A7 product customer-binding handoff scope.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_SCOPE =
  'a7-product-customer-binding-handoff.v1' as const;

/**
 * A7 product customer-binding handoff validity interval (single-use,
 * support-traceable, A2-protected internal control surface).
 */
export const A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_VALIDITY_SECONDS = 15 * 60;

/**
 * A7 product customer-binding audit actor.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTOR = 'a7-product-customer-binding' as const;

/**
 * A7 product customer-binding audit action codes. The A7 product
 * customer-binding audit facts are recorded through the shared
 * Operations `AuditService` (or the A4 `TypeOrmPolicyAuditAdapter`); the
 * A4 `A4_POLICY_DECISION` entity is reused as the audit entity type.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_RESOLVED =
  'A7_PRODUCT_CUSTOMER_BINDING_RESOLVED' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_VERIFIED =
  'A7_PRODUCT_CUSTOMER_BINDING_VERIFIED' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_HANDOFF_ISSUED =
  'A7_PRODUCT_CUSTOMER_BINDING_HANDOFF_ISSUED' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_AUDIT_ACTION_MAP_REJECTED =
  'A7_PRODUCT_CUSTOMER_BINDING_REJECTED' as const;

/**
 * A7 product customer-binding read-only check prefixes (used for diagnostic
 * logging; the A7 product customer-binding service does not write any source
 * record).
 */
export const A7_PRODUCT_CUSTOMER_BINDING_READ_A3_BINDING =
  'a7-product-customer-binding-read-a3-binding' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_READ_VIRTUAL_ACCOUNT =
  'a7-product-customer-binding-read-virtual-account' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_READ_A6_PARTNER =
  'a7-product-customer-binding-read-a6-partner' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_READ_A4_PRODUCT_POLICY =
  'a7-product-customer-binding-read-a4-product-policy' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_READ_A2_AUTHORIZATION =
  'a7-product-customer-binding-read-a2-authorization' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_READ_A6T04_FUNDING_TARGET =
  'a7-product-customer-binding-read-a6t04-funding-target' as const;

/**
 * A6 partner identity and reference types. The A6 partner is the only
 * partner-reference authority.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_KEY_NIBSS_NIP = NIBSS_NIP_PARTNER_KEY;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_CAPABILITY_EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT =
  'external.wallet.withdrawal.settlement' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_OPERATION_TYPE_OUTBOUND_BANK_SETTLEMENT =
  'OUTBOUND_BANK_SETTLEMENT' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_ENVIRONMENT_SANDBOX = 'sandbox' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_ENVIRONMENT_PRODUCTION = 'production' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_OPERATION = 'OPERATION' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_TRANSACTION = 'TRANSACTION' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_SETTLEMENT = 'SETTLEMENT' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_CALLBACK = 'CALLBACK' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_STATEMENT_ROW = 'STATEMENT_ROW' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_PROVIDER_IDEMPOTENCY =
  'PROVIDER_IDEMPOTENCY' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_REFERENCE_REQUEST = 'REQUEST' as const;

/**
 * A6 partner evidence source types. The A6 partner is the only
 * partner-evidence authority.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_EVIDENCE_ACKNOWLEDGEMENT =
  'ACKNOWLEDGEMENT' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_EVIDENCE_STATUS_QUERY = 'STATUS_QUERY' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_EVIDENCE_CALLBACK = 'CALLBACK' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_EVIDENCE_STATEMENT = 'STATEMENT' as const;
export const A7_PRODUCT_CUSTOMER_BINDING_PARTNER_EVIDENCE_REPORT = 'REPORT' as const;

/**
 * A7 product customer-binding customer-binding check failure codes. The
 * A7 product customer-binding service fails closed for any of these
 * evidence states and returns a deterministic controlled-denial,
 * pending, or manual-review outcome.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_MISSING = 'A3_BINDING_MISSING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_BINDING_NOT_ACTIVE = 'A3_BINDING_NOT_ACTIVE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_STALE_BINDING = 'A3_STALE_BINDING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_IDENTITY_MISMATCH = 'A3_IDENTITY_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A3_ACCOUNT_DIMENSION_MISMATCH =
  'A3_ACCOUNT_DIMENSION_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_MISSING =
  'VIRTUAL_ACCOUNT_MISSING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_INACTIVE =
  'VIRTUAL_ACCOUNT_INACTIVE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_OWNER_MISMATCH =
  'VIRTUAL_ACCOUNT_OWNER_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_PROVIDER_MISMATCH =
  'VIRTUAL_ACCOUNT_PROVIDER_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_NUMBER_MISMATCH =
  'VIRTUAL_ACCOUNT_NUMBER_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_VIRTUAL_ACCOUNT_BANK_DIRECTORY_UNSUPPORTED =
  'VIRTUAL_ACCOUNT_BANK_DIRECTORY_UNSUPPORTED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_BANK_NOT_FOUND = 'BANK_NOT_FOUND';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_BANK_NOT_ACTIVE = 'BANK_NOT_ACTIVE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_MISSING =
  'A4_POLICY_DECISION_MISSING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_EXPIRED =
  'A4_POLICY_DECISION_EXPIRED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE =
  'A4_POLICY_DECISION_NOT_EXECUTABLE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A4_POLICY_LIMIT_INSUFFICIENT =
  'A4_POLICY_LIMIT_INSUFFICIENT';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_MISSING =
  'A2_AUTHORIZATION_MISSING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_STALE = 'A2_AUTHORIZATION_STALE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A2_AUTHORIZATION_DENIED =
  'A2_AUTHORIZATION_DENIED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_MISSING =
  'A6_PARTNER_REFERENCE_MISSING';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_REPLAYED =
  'A6_PARTNER_REFERENCE_REPLAYED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_REFERENCE_STALE =
  'A6_PARTNER_REFERENCE_STALE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_CONNECTION_UNAVAILABLE =
  'A6_PARTNER_CONNECTION_UNAVAILABLE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6_PARTNER_CAPABILITY_UNAVAILABLE =
  'A6_PARTNER_CAPABILITY_UNAVAILABLE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_SOURCE_UNAVAILABLE =
  'A6T04_TARGET_SOURCE_UNAVAILABLE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_NOT_FOUND = 'A6T04_TARGET_NOT_FOUND';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_TYPE_UNSUPPORTED =
  'A6T04_TARGET_TYPE_UNSUPPORTED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_NOT_VERIFIED =
  'A6T04_TARGET_NOT_VERIFIED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_NOT_ACTIVE =
  'A6T04_TARGET_NOT_ACTIVE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_VERSION_STALE =
  'A6T04_TARGET_VERSION_STALE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_TARGET_OWNERSHIP_MISMATCH =
  'A6T04_TARGET_OWNERSHIP_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_BANK_NOT_FOUND = 'A6T04_BANK_NOT_FOUND';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_BANK_NOT_ACTIVE = 'A6T04_BANK_NOT_ACTIVE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_BANK_NOT_SUPPORTED =
  'A6T04_BANK_NOT_SUPPORTED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CONSENT_INVALID = 'A6T04_CONSENT_INVALID';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_CURRENCY_UNSUPPORTED =
  'A6T04_CURRENCY_UNSUPPORTED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_A6T04_ACCOUNTING_UNIT_MISMATCH =
  'A6T04_ACCOUNTING_UNIT_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_PRODUCT_PURPOSE_MISMATCH =
  'PRODUCT_PURPOSE_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE =
  'OPERATIONS_EVIDENCE_UNAVAILABLE';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_PRODUCT_CATALOG_REJECTED =
  'PRODUCT_CATALOG_REJECTED';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_CURRENCY_MISMATCH = 'CURRENCY_MISMATCH';
export const A7_PRODUCT_CUSTOMER_BINDING_FAILURE_ACCOUNTING_UNIT_MISMATCH =
  'ACCOUNTING_UNIT_MISMATCH';

/**
 * A7 product customer-binding frozen product-state vocabulary. The
 * vocabulary is the union of the A7T02 frozen first-product
 * capability-level lifecycle state sets. A7T04 does not introduce a
 * new product state.
 */
export const A7_PRODUCT_CUSTOMER_BINDING_ASSIGN_STATES = [
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
] as const;

export const A7_PRODUCT_CUSTOMER_BINDING_FUNDING_STATES = [
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
] as const;

export const A7_PRODUCT_CUSTOMER_BINDING_ALL_STATES = [
  ...A7_PRODUCT_CUSTOMER_BINDING_ASSIGN_STATES,
  ...A7_PRODUCT_CUSTOMER_BINDING_FUNDING_STATES,
] as const;

export type A7ProductCustomerBindingState = (typeof A7_PRODUCT_CUSTOMER_BINDING_ALL_STATES)[number];
