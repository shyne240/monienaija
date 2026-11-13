import {
  PolicyComplianceRequirement,
  PolicyRequirementMode,
  PolicySourceClass,
} from './capability-policy.enums';
import { calculatePolicyProfileDefinitionHash } from './capability-policy.profiles';
import type { CapabilityPolicyProfile } from './capability-policy.types';
import { A7_PRODUCT_POLICY_PROFILES } from './a7-product-policy.profiles';

/** A draft definition only: a governed, effective A4 profile must be published separately.
 * Admission is nonfinancial and does not certify receipt, settlement or credit. */
const existing = A7_PRODUCT_POLICY_PROFILES[1]!;
const { definitionHash: _oldHash, ...base } = existing;
void _oldHash;
const definition: Omit<CapabilityPolicyProfile, 'definitionHash'> = {
  ...base,
  profileReference: 'profile.product-virtual-account-inbound-admission.v1',
  profileKey: 'profile.product-virtual-account-inbound-admission',
  profileVersion: 1,
  policyVersion: 'a4.profile.product-virtual-account-inbound-admission.v1',
  capability: 'product.virtual-account.inbound',
  actions: ['admit'],
  evidenceRequirements: {
    ...existing.evidenceRequirements,
    [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.REQUIRED_CURRENT,
  },
  productEligibility: {
    ...existing.productEligibility,
    compliance: PolicyComplianceRequirement.CURRENT_REQUIRED,
  },
  complianceRequirement: { mode: PolicyComplianceRequirement.CURRENT_REQUIRED },
  obligations: [
    { code: 'RECHECK_A2_AUTHORIZATION', required: true },
    { code: 'RECHECK_A3_BINDING', required: true },
    { code: 'RECHECK_INBOUND_INTENT', required: true },
    { code: 'RECHECK_INBOUND_ROUTE_AND_CONSENT', required: true },
    { code: 'RECHECK_INBOUND_ELIGIBILITY_AND_COMPLIANCE', required: true },
    { code: 'RECHECK_INBOUND_LIMIT', required: true },
    { code: 'RECHECK_INBOUND_INSTITUTION', required: true },
    { code: 'VERIFY_RECEIPT_AND_LIMIT_BEFORE_CREDIT', required: true },
  ],
};
export const A7_INBOUND_ADMISSION_PROFILE: CapabilityPolicyProfile = Object.freeze({
  ...definition,
  definitionHash: calculatePolicyProfileDefinitionHash(definition),
});
