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
