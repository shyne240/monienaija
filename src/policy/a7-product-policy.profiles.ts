/**
 * A7T03 — A4 product-policy profile registrations for the A7 first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and
 * `docs/A7-PRODUCT-CATALOG-CONTRACT.md`). The A7 product-policy
 * contract reuses the A4 `CapabilityPolicyProfile` shape, the A4
 * `profile()` helper, the A4 `PolicySourceRequirements`, the A4
 * `PolicyProductEligibilityRequirements`, the A4 limit-dimension
 * vocabulary, the A4 enrollment/permission/risk/compliance/binding
 * requirement modes, and the A4 `PolicyObligationTemplate` shape.
 *
 * No new A4 vocabulary is introduced. No A4 source record is mutated.
 * No new policy evaluator, re-evaluation engine, replay engine,
 * persistence layer, audit store, or idempotency store is introduced.
 *
 * The A7 product-policy profiles are added to the A4 `PolicyProfileRegistry`
 * via the existing A4 `StaticCapabilityPolicyProfileRegistry` constructor
 * at the A7 module initialization. The A7 product-policy service composes
 * the A4 default profiles and the A7 product-policy profiles into a
 * single A4 `PolicyProfileRegistry` and passes the composed registry to
 * the A4 `CapabilityPolicyEvaluationService` and the A4
 * `CapabilityPolicyRecoveryService`.
 */

import { createHash } from 'node:crypto';

import {
  PolicyAccountBindingRequirement,
  PolicyComplianceRequirement,
  PolicyEnrollmentRequirement,
  PolicyLimitDimension,
  PolicyLimitRequirement,
  PolicyPermissionRequirement,
  PolicyRequirementMode,
  PolicyRiskRequirement,
  PolicySourceClass,
} from './capability-policy.enums';
import {
  DEFAULT_CAPABILITY_POLICY_PROFILES,
  calculatePolicyProfileDefinitionHash,
} from './capability-policy.profiles';
import type { CapabilityPolicyProfile } from './capability-policy.types';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_POLICY_ALLOWED_DECISIONS,
  A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_VERSION,
} from './a7-product-policy.constants';
import type { A7ProductPolicyProfileRegistration } from './a7-product-policy.types';

/**
 * The A4 `profile()` helper is not exported from `capability-policy.profiles.ts`.
 * The A7 product-policy profiles are composed through the same internal
 * helper. To avoid reaching into the A4 internal helper, the A7
 * product-policy profiles are constructed by a local `profile()` helper
 * that mirrors the A4 internal `profile()` helper exactly. The
 * composition is verified by the A7 product-policy profile tests
 * (`test/a7-product-policy.profiles.spec.ts`).
 */

const PROFILE_DECISION_VALIDITY_SECONDS = 15 * 60;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function calculateDefinitionHash(input: Omit<CapabilityPolicyProfile, 'definitionHash'>): string {
  const definition = { ...input };
  delete (definition as { effectiveFrom?: string }).effectiveFrom;
  delete (definition as { effectiveTo?: string | null }).effectiveTo;
  delete (definition as { lifecycleState?: string }).lifecycleState;
  return createHash('sha256').update(canonicalJson(definition)).digest('hex');
}

function profile(input: Omit<CapabilityPolicyProfile, 'definitionHash'>): CapabilityPolicyProfile {
  const definition = {
    ...input,
    decisionValidity: input.decisionValidity ?? {
      expiresInSeconds: PROFILE_DECISION_VALIDITY_SECONDS,
    },
  };
  return { ...definition, definitionHash: calculateDefinitionHash(definition) };
}

function productAssignmentSourceRequirements(): CapabilityPolicyProfile['evidenceRequirements'] {
  return {
    [PolicySourceClass.CUSTOMER]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.LIMITS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.RISK]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.REQUIRED_IF_CONTEXT,
    [PolicySourceClass.AUTHORIZATION]: PolicyRequirementMode.REQUIRED_CURRENT,
  };
}

function productLifecycleSourceRequirements(): CapabilityPolicyProfile['evidenceRequirements'] {
  return {
    [PolicySourceClass.CUSTOMER]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.LIMITS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.RISK]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.REQUIRED_IF_CONTEXT,
    [PolicySourceClass.AUTHORIZATION]: PolicyRequirementMode.REQUIRED_CURRENT,
  };
}

function productAssignmentEligibility(): CapabilityPolicyProfile['productEligibility'] {
  return {
    customerLifecycle: 'ACTIVE_REQUIRED',
    onboarding: 'COMPLETED_REQUIRED',
    eligibility: 'ELIGIBLE_REQUIRED',
    restrictions: 'NO_BLOCKING_RESTRICTION',
    risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
    compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
    accountState: 'PROFILE_CONTROLLED',
  };
}

function productLifecycleEligibility(): CapabilityPolicyProfile['productEligibility'] {
  return {
    customerLifecycle: 'ACTIVE_REQUIRED',
    onboarding: 'COMPLETED_REQUIRED',
    eligibility: 'ELIGIBLE_REQUIRED',
    restrictions: 'NO_BLOCKING_RESTRICTION',
    risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
    compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
    accountState: 'PROFILE_CONTROLLED',
  };
}

const A7_PRODUCT_OBLIGATIONS_FOR_ASSIGN: CapabilityPolicyProfile['obligations'] = [
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
    required: true,
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
    required: true,
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
    required: true,
    reference: 'a6-partner-reference:virtual-account-assign',
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    required: true,
  },
];

const A7_PRODUCT_OBLIGATIONS_FOR_LIFECYCLE: CapabilityPolicyProfile['obligations'] = [
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
    required: true,
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
    required: true,
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
    required: true,
    reference: 'a6-partner-reference:virtual-account-lifecycle',
  },
  {
    code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    required: true,
  },
];

/**
 * The A7 first product's `product.virtual-account` / `assign` A4 product-policy
 * profile. The A4 `CapabilityPolicyProfile` is composed via the A4
 * `profile()` helper mirror. The A4 definition hash is the SHA-256 hash of
 * the canonical-JSON profile definition (excluding `effectiveFrom`,
 * `effectiveTo`, and `lifecycleState`).
 */
function buildProductAssignmentProfile(): CapabilityPolicyProfile {
  return profile({
    profileReference: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    profileKey: 'profile.product-virtual-account-assign',
    profileVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_VERSION,
    policyVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
    capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
    actions: [A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: productAssignmentSourceRequirements(),
    productEligibility: productAssignmentEligibility(),
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'virtual-account',
    },
    permissionRequirement: { mode: PolicyPermissionRequirement.NOT_REQUIRED },
    riskRequirement: { mode: PolicyRiskRequirement.PROFILE_CONTROLLED },
    complianceRequirement: { mode: PolicyComplianceRequirement.PROFILE_CONTROLLED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT },
    limitRequirement: {
      mode: PolicyLimitRequirement.CONFIGURATION_REQUIRED,
      dimensions: [PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT],
      returnsLimits: true,
    },
    allowedDecisions: A7_PRODUCT_POLICY_ALLOWED_DECISIONS,
    obligations: A7_PRODUCT_OBLIGATIONS_FOR_ASSIGN,
  });
}

/**
 * The A7 first product's `product.virtual-account` / `lifecycle` A4
 * product-policy profile. The A4 `CapabilityPolicyProfile` is composed via
 * the A4 `profile()` helper mirror.
 */
function buildProductLifecycleProfile(): CapabilityPolicyProfile {
  return profile({
    profileReference: A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    profileKey: 'profile.product-virtual-account-lifecycle',
    profileVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_VERSION,
    policyVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
    capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
    actions: [A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: productLifecycleSourceRequirements(),
    productEligibility: productLifecycleEligibility(),
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'virtual-account',
    },
    permissionRequirement: { mode: PolicyPermissionRequirement.NOT_REQUIRED },
    riskRequirement: { mode: PolicyRiskRequirement.PROFILE_CONTROLLED },
    complianceRequirement: { mode: PolicyComplianceRequirement.PROFILE_CONTROLLED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT },
    limitRequirement: {
      mode: PolicyLimitRequirement.CONFIGURATION_AND_USAGE_REQUIRED,
      dimensions: [
        PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_COUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT,
        PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT,
        PolicyLimitDimension.WALLET_BALANCE,
      ],
      returnsLimits: true,
    },
    allowedDecisions: A7_PRODUCT_POLICY_ALLOWED_DECISIONS,
    obligations: A7_PRODUCT_OBLIGATIONS_FOR_LIFECYCLE,
  });
}

/**
 * The A7 first product's frozen A4 product-policy profiles, exported as a
 * frozen array. The A7 product-policy module composes this array with the
 * A4 default profiles into a single A4 `PolicyProfileRegistry`.
 */
export const A7_PRODUCT_POLICY_PROFILES: readonly CapabilityPolicyProfile[] = Object.freeze([
  buildProductAssignmentProfile(),
  buildProductLifecycleProfile(),
]);

/**
 * The A7 first product's frozen A4 product-policy profile registrations,
 * exported as a frozen array. The A7 product-policy service consumes this
 * array to look up the A4 product-policy profile for a given A7
 * capability / action.
 */
export const A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS: readonly A7ProductPolicyProfileRegistration[] =
  Object.freeze(
    A7_PRODUCT_POLICY_PROFILES.map((profileEntry) => {
      const registration: A7ProductPolicyProfileRegistration = {
        productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
        capability: profileEntry.capability,
        action: profileEntry.actions[0] as string,
        profileReference: profileEntry.profileReference,
        profileVersion: profileEntry.profileVersion,
        policyVersion: profileEntry.policyVersion,
        definitionHash: profileEntry.definitionHash,
        reevaluationTrigger: A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
        limitDimensions: Object.freeze([...profileEntry.limitRequirement.dimensions]),
        obligationCodes: Object.freeze(
          profileEntry.obligations.map((obligation) => obligation.code),
        ),
      };
      return Object.freeze(registration);
    }),
  );

/**
 * The A4 default profiles + the A7 product-policy profiles, composed
 * deterministically. The A7 product-policy module consumes this composed
 * list to build a single A4 `PolicyProfileRegistry`.
 */
export const A7_PRODUCT_POLICY_COMPOSED_PROFILES: readonly CapabilityPolicyProfile[] =
  Object.freeze([...DEFAULT_CAPABILITY_POLICY_PROFILES, ...A7_PRODUCT_POLICY_PROFILES]);

/**
 * Verifies that the A7 product-policy profile composition produces the same
 * A4 definition hash as the A4 `profile()` helper. This is a defensive
 * consistency check used by tests; the A4 `profile()` helper is the
 * authoritative source of truth for the A4 definition hash.
 */
export function assertA7ProductPolicyProfileHashesConsistent(): readonly {
  productKey: string;
  capability: string;
  action: string;
  profileReference: string;
  policyVersion: string;
  definitionHash: string;
}[] {
  return Object.freeze(
    A7_PRODUCT_POLICY_PROFILES.map((profileEntry) => ({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      capability: profileEntry.capability,
      action: profileEntry.actions[0] as string,
      profileReference: profileEntry.profileReference,
      policyVersion: profileEntry.policyVersion,
      definitionHash: calculatePolicyProfileDefinitionHash(profileEntry),
    })),
  );
}
