import {
  A7_PRODUCT_POLICY_COMPOSED_PROFILES,
  A7_PRODUCT_POLICY_PROFILES,
  A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
  assertA7ProductPolicyProfileHashesConsistent,
} from '../src/policy/a7-product-policy.profiles';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
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
  A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
  A7_PRODUCT_POLICY_ALLOWED_DECISIONS,
} from '../src/policy/a7-product-policy.constants';
import {
  PolicyAccountBindingRequirement,
  PolicyComplianceRequirement,
  PolicyDecisionState,
  PolicyEnrollmentRequirement,
  PolicyLimitDimension,
  PolicyLimitRequirement,
  PolicyPermissionRequirement,
  PolicyRequirementMode,
  PolicyRiskRequirement,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import { calculatePolicyProfileDefinitionHash } from '../src/policy/capability-policy.profiles';
import { DEFAULT_CAPABILITY_POLICY_PROFILES } from '../src/policy/capability-policy.profiles';
import type { CapabilityPolicyProfile } from '../src/policy/capability-policy.types';

const HASH_PATTERN = /^[a-f0-9]{64}$/i;

describe('A7T03 A4 product-policy profile composition', () => {
  it('exposes the A7 first product policy profiles as a frozen two-element array', () => {
    expect(A7_PRODUCT_POLICY_PROFILES).toHaveLength(2);
    expect(Object.isFrozen(A7_PRODUCT_POLICY_PROFILES)).toBe(true);
  });

  it('binds the assign capability/action to a uniquely identified A4 product-policy profile', () => {
    const assign = A7_PRODUCT_POLICY_PROFILES[0];
    if (!assign) throw new Error('Expected the A7 assign product-policy profile');
    expect(assign).toMatchObject({
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
    });
  });

  it('binds the lifecycle capability/action to a uniquely identified A4 product-policy profile', () => {
    const lifecycle = A7_PRODUCT_POLICY_PROFILES[1];
    if (!lifecycle) throw new Error('Expected the A7 lifecycle product-policy profile');
    expect(lifecycle).toMatchObject({
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
    });
  });

  it('records an A4 product-policy decision-validity window for both profiles', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.decisionValidity).toEqual({
        expiresInSeconds: 15 * 60,
      });
    }
  });

  it('records an A4 product-policy definition-hash that the A4 reference algorithm can recompute deterministically', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.definitionHash).toMatch(HASH_PATTERN);
      const recomputedA = calculatePolicyProfileDefinitionHash(profileEntry);
      const recomputedB = calculatePolicyProfileDefinitionHash(profileEntry);
      expect(recomputedA).toBe(recomputedB);
    }
  });

  it('records an A4 product-policy obligation template that defers to A2, A3, A6, and the execution limit', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.obligations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
            required: true,
          }),
          expect.objectContaining({
            code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
            required: true,
          }),
          expect.objectContaining({
            code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
            required: true,
          }),
          expect.objectContaining({
            code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
            required: true,
          }),
        ]),
      );
    }
  });

  it('records an A4 product-policy decision vocabulary that reuses the A4 decision states', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.allowedDecisions).toEqual([
        PolicyDecisionState.ALLOW,
        PolicyDecisionState.ALLOW_WITH_LIMITS,
        PolicyDecisionState.PENDING_REVIEW,
        PolicyDecisionState.DENY,
        PolicyDecisionState.SUSPEND,
      ]);
      expect(profileEntry.allowedDecisions).toEqual(A7_PRODUCT_POLICY_ALLOWED_DECISIONS);
    }
  });

  it('records an A4 product-policy product-eligibility contract for both profiles', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.productEligibility).toEqual({
        customerLifecycle: 'ACTIVE_REQUIRED',
        onboarding: 'COMPLETED_REQUIRED',
        eligibility: 'ELIGIBLE_REQUIRED',
        restrictions: 'NO_BLOCKING_RESTRICTION',
        risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
        compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
        accountState: 'PROFILE_CONTROLLED',
      });
    }
  });

  it('records an A4 product-policy evidence requirement set that defers source precedence to A4', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.evidenceRequirements).toEqual({
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
      });
    }
  });

  it('records the assign profile with a single A4 product-policy limit dimension', () => {
    const assign = A7_PRODUCT_POLICY_PROFILES[0];
    if (!assign) throw new Error('Expected the A7 assign product-policy profile');
    expect(assign.limitRequirement).toEqual({
      mode: PolicyLimitRequirement.CONFIGURATION_REQUIRED,
      dimensions: [PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT],
      returnsLimits: true,
    });
  });

  it('records the lifecycle profile with the full A4 product-policy limit dimension set', () => {
    const lifecycle = A7_PRODUCT_POLICY_PROFILES[1];
    if (!lifecycle) throw new Error('Expected the A7 lifecycle product-policy profile');
    expect(lifecycle.limitRequirement).toEqual({
      mode: PolicyLimitRequirement.CONFIGURATION_AND_USAGE_REQUIRED,
      dimensions: [
        PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_COUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT,
        PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT,
        PolicyLimitDimension.WALLET_BALANCE,
      ],
      returnsLimits: true,
    });
  });

  it('records an A4 product-policy enrollment and permission contract for both profiles', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.enrollmentRequirement).toEqual({
        mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
        productKey: 'virtual-account',
      });
      expect(profileEntry.permissionRequirement).toEqual({
        mode: PolicyPermissionRequirement.NOT_REQUIRED,
      });
    }
  });

  it('records the same A4 product-policy account-binding requirement for both profiles', () => {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      expect(profileEntry.accountBindingRequirement).toEqual({
        mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT,
      });
    }
  });

  it('exposes A4 product-policy profile registrations as a frozen array of two entries', () => {
    expect(A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS).toHaveLength(2);
    expect(Object.isFrozen(A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS)).toBe(true);
  });

  it('binds each registration to the A7 first product key and the A4 default re-evaluation trigger', () => {
    for (const registration of A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS) {
      expect(registration.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
      expect(registration.reevaluationTrigger).toBe(A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER);
      expect(registration.capability).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY);
    }
  });

  it('binds the A4 product-policy registration obligation codes to the A4 product-policy obligations', () => {
    const assign = A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[0];
    const lifecycle = A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[1];
    if (!assign || !lifecycle) throw new Error('Expected the A7 product-policy registrations');
    expect(assign.obligationCodes).toEqual([
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    ]);
    expect(lifecycle.obligationCodes).toEqual([
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    ]);
  });

  it('binds the A4 product-policy registration limit dimensions to the A4 limit requirement', () => {
    const assign = A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[0];
    const lifecycle = A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[1];
    if (!assign || !lifecycle) throw new Error('Expected the A7 product-policy registrations');
    expect(assign.limitDimensions).toEqual([PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT]);
    expect(lifecycle.limitDimensions).toEqual([
      PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT,
      PolicyLimitDimension.DAILY_TRANSACTION_COUNT,
      PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT,
      PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT,
      PolicyLimitDimension.WALLET_BALANCE,
    ]);
  });

  it('composes the A4 product-policy profiles with the A4 default profiles', () => {
    const composed: readonly CapabilityPolicyProfile[] = A7_PRODUCT_POLICY_COMPOSED_PROFILES;
    expect(composed.length).toBe(DEFAULT_CAPABILITY_POLICY_PROFILES.length + 2);
    const references = composed.map((entry) => entry.profileReference);
    expect(references).toEqual(
      expect.arrayContaining([
        A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
        A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
      ]),
    );
  });

  it('verifies A4 product-policy definition-hash consistency for both A7 profiles', () => {
    const verified = assertA7ProductPolicyProfileHashesConsistent();
    expect(verified).toHaveLength(2);
    for (const entry of verified) {
      expect(entry.definitionHash).toMatch(HASH_PATTERN);
      expect(entry.policyVersion).toMatch(
        /^a4\.profile\.product-virtual-account-(assign|lifecycle)\.v1$/,
      );
      expect(entry.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    }
  });
});
