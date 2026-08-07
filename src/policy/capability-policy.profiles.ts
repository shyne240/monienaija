import { createHash } from 'node:crypto';

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
} from './capability-policy.enums';
import type {
  CapabilityPolicyProfile,
  PolicyProfileRegistry,
  PolicySourceRequirements,
} from './capability-policy.types';

const ALL_DECISIONS = Object.values(PolicyDecisionState);

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

export function calculatePolicyProfileDefinitionHash(
  input: Omit<CapabilityPolicyProfile, 'definitionHash'>,
): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function sources(overrides: Partial<PolicySourceRequirements> = {}): PolicySourceRequirements {
  return {
    [PolicySourceClass.CUSTOMER]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.LIMITS]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.RISK]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.NOT_USED,
    [PolicySourceClass.AUTHORIZATION]: PolicyRequirementMode.REQUIRED_CURRENT,
    ...overrides,
  };
}

function financialSources(): PolicySourceRequirements {
  return sources({
    [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.LIMITS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.RISK]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.REQUIRED_CURRENT,
    [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.REQUIRED_CURRENT,
  });
}

function profile(input: Omit<CapabilityPolicyProfile, 'definitionHash'>): CapabilityPolicyProfile {
  return { ...input, definitionHash: calculatePolicyProfileDefinitionHash(input) };
}

const commonFinancialEligibility = {
  customerLifecycle: 'ACTIVE_REQUIRED' as const,
  onboarding: 'COMPLETED_REQUIRED' as const,
  eligibility: 'ELIGIBLE_REQUIRED' as const,
  restrictions: 'NO_BLOCKING_RESTRICTION' as const,
  risk: PolicyRiskRequirement.CURRENT_REQUIRED,
  compliance: PolicyComplianceRequirement.CURRENT_REQUIRED,
  accountState: 'ACTIVE_REQUIRED' as const,
};

const allFinancialDecisions = ALL_DECISIONS;

export const DEFAULT_CAPABILITY_POLICY_PROFILES: readonly CapabilityPolicyProfile[] = [
  profile({
    profileReference: 'profile.wallet-transfer-create.v1',
    profileKey: 'profile.wallet-transfer-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-transfer-create.v1',
    capability: 'wallet.transfer',
    actions: ['create'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: financialSources(),
    productEligibility: commonFinancialEligibility,
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'wallet.transfer',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'TRANSFER',
    },
    riskRequirement: { mode: PolicyRiskRequirement.CURRENT_REQUIRED },
    complianceRequirement: { mode: PolicyComplianceRequirement.CURRENT_REQUIRED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.ACTIVE_REQUIRED },
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
    allowedDecisions: allFinancialDecisions,
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true },
      { code: 'RECHECK_A3_BINDING', required: true },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true },
    ],
  }),
  profile({
    profileReference: 'profile.wallet-deposit-create.v1',
    profileKey: 'profile.wallet-deposit-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-deposit-create.v1',
    capability: 'wallet.deposit',
    actions: ['create'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: financialSources(),
    productEligibility: commonFinancialEligibility,
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'wallet.deposit',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'DEPOSIT',
    },
    riskRequirement: { mode: PolicyRiskRequirement.CURRENT_REQUIRED },
    complianceRequirement: { mode: PolicyComplianceRequirement.CURRENT_REQUIRED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.ACTIVE_REQUIRED },
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
    allowedDecisions: allFinancialDecisions,
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true },
      { code: 'RECHECK_A3_BINDING', required: true },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true },
    ],
  }),
  profile({
    profileReference: 'profile.wallet-withdrawal-create.v1',
    profileKey: 'profile.wallet-withdrawal-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-withdrawal-create.v1',
    capability: 'wallet.withdrawal',
    actions: ['create'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: financialSources(),
    productEligibility: commonFinancialEligibility,
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'wallet.withdrawal',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'WITHDRAW',
    },
    riskRequirement: { mode: PolicyRiskRequirement.CURRENT_REQUIRED },
    complianceRequirement: { mode: PolicyComplianceRequirement.CURRENT_REQUIRED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.ACTIVE_REQUIRED },
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
    allowedDecisions: allFinancialDecisions,
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true },
      { code: 'RECHECK_A3_BINDING', required: true },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true },
    ],
  }),
  profile({
    profileReference: 'profile.wallet-payment-create.v1',
    profileKey: 'profile.wallet-payment-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-payment-create.v1',
    capability: 'wallet.payment',
    actions: ['create'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: financialSources(),
    productEligibility: {
      ...commonFinancialEligibility,
      accountState: 'PROFILE_CONTROLLED',
    },
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'wallet.payment',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'PAYMENT',
    },
    riskRequirement: { mode: PolicyRiskRequirement.CURRENT_REQUIRED },
    complianceRequirement: { mode: PolicyComplianceRequirement.CURRENT_REQUIRED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT },
    limitRequirement: {
      mode: PolicyLimitRequirement.CONFIGURATION_AND_USAGE_REQUIRED,
      dimensions: [
        PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_COUNT,
        PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT,
        PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT,
      ],
      returnsLimits: true,
    },
    allowedDecisions: allFinancialDecisions,
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true },
    ],
  }),
  profile({
    profileReference: 'profile.customer-product-enroll.v1',
    profileKey: 'profile.customer-product-enroll',
    profileVersion: 1,
    policyVersion: 'a4.profile.customer-product-enroll.v1',
    capability: 'customer.product',
    actions: ['enroll'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: sources({
      [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RISK]: PolicyRequirementMode.OPTIONAL_REFERENCE,
      [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    }),
    productEligibility: {
      customerLifecycle: 'ACTIVE_REQUIRED',
      onboarding: 'COMPLETED_REQUIRED',
      eligibility: 'ELIGIBLE_REQUIRED',
      restrictions: 'NO_BLOCKING_RESTRICTION',
      risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
      compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
      accountState: 'NOT_REQUIRED',
    },
    enrollmentRequirement: { mode: PolicyEnrollmentRequirement.ENROLLMENT_ACTION },
    permissionRequirement: { mode: PolicyPermissionRequirement.NOT_REQUIRED },
    riskRequirement: { mode: PolicyRiskRequirement.PROFILE_CONTROLLED },
    complianceRequirement: { mode: PolicyComplianceRequirement.PROFILE_CONTROLLED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.NOT_REQUIRED },
    limitRequirement: {
      mode: PolicyLimitRequirement.NOT_APPLICABLE,
      dimensions: [],
      returnsLimits: false,
    },
    allowedDecisions: [
      PolicyDecisionState.ALLOW,
      PolicyDecisionState.PENDING_REVIEW,
      PolicyDecisionState.DENY,
      PolicyDecisionState.SUSPEND,
    ],
    obligations: [{ code: 'RECHECK_A2_AUTHORIZATION', required: true }],
  }),
  profile({
    profileReference: 'profile.product-virtual-account-use.v1',
    profileKey: 'profile.product-virtual-account-use',
    profileVersion: 1,
    policyVersion: 'a4.profile.product-virtual-account-use.v1',
    capability: 'product.virtual-account',
    actions: ['use'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: sources({
      [PolicySourceClass.ONBOARDING]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RISK]: PolicyRequirementMode.OPTIONAL_REFERENCE,
      [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.OPTIONAL_REFERENCE,
      [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.REQUIRED_IF_CONTEXT,
    }),
    productEligibility: {
      customerLifecycle: 'ACTIVE_REQUIRED',
      onboarding: 'CURRENT_REQUIRED',
      eligibility: 'ELIGIBLE_REQUIRED',
      restrictions: 'NO_BLOCKING_RESTRICTION',
      risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
      compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
      accountState: 'PROFILE_CONTROLLED',
    },
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_ACTIVE,
      productKey: 'virtual-account',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'VIRTUAL_ACCOUNT',
    },
    riskRequirement: { mode: PolicyRiskRequirement.PROFILE_CONTROLLED },
    complianceRequirement: { mode: PolicyComplianceRequirement.PROFILE_CONTROLLED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT },
    limitRequirement: {
      mode: PolicyLimitRequirement.NOT_APPLICABLE,
      dimensions: [],
      returnsLimits: false,
    },
    allowedDecisions: [
      PolicyDecisionState.ALLOW,
      PolicyDecisionState.PENDING_REVIEW,
      PolicyDecisionState.DENY,
      PolicyDecisionState.SUSPEND,
    ],
    obligations: [{ code: 'RECHECK_A2_AUTHORIZATION', required: true }],
  }),
  profile({
    profileReference: 'profile.wallet-account-read.v1',
    profileKey: 'profile.wallet-account-read',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-account-read.v1',
    capability: 'wallet.account',
    actions: ['read'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: sources({
      [PolicySourceClass.ACCOUNT_BINDING]: PolicyRequirementMode.REQUIRED_CURRENT,
    }),
    productEligibility: {
      customerLifecycle: 'CURRENT_REQUIRED',
      onboarding: 'NOT_REQUIRED',
      eligibility: 'NOT_REQUIRED',
      restrictions: 'NOT_REQUIRED',
      risk: PolicyRiskRequirement.NOT_REQUIRED,
      compliance: PolicyComplianceRequirement.NOT_REQUIRED,
      accountState: 'ACTIVE_REQUIRED',
    },
    enrollmentRequirement: { mode: PolicyEnrollmentRequirement.NOT_REQUIRED },
    permissionRequirement: { mode: PolicyPermissionRequirement.NOT_REQUIRED },
    riskRequirement: { mode: PolicyRiskRequirement.NOT_REQUIRED },
    complianceRequirement: { mode: PolicyComplianceRequirement.NOT_REQUIRED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.CURRENT_REQUIRED },
    limitRequirement: {
      mode: PolicyLimitRequirement.NOT_APPLICABLE,
      dimensions: [],
      returnsLimits: false,
    },
    allowedDecisions: [
      PolicyDecisionState.ALLOW,
      PolicyDecisionState.PENDING_REVIEW,
      PolicyDecisionState.DENY,
      PolicyDecisionState.SUSPEND,
    ],
    obligations: [{ code: 'RECHECK_A2_AUTHORIZATION', required: true }],
  }),
  profile({
    profileReference: 'profile.channel-api-use.v1',
    profileKey: 'profile.channel-api-use',
    profileVersion: 1,
    policyVersion: 'a4.profile.channel-api-use.v1',
    capability: 'channel.api',
    actions: ['use'],
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: 1,
    evidenceRequirements: sources({
      [PolicySourceClass.ELIGIBILITY]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RESTRICTIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.ENROLLMENT]: PolicyRequirementMode.REQUIRED_IF_CONTEXT,
      [PolicySourceClass.PERMISSIONS]: PolicyRequirementMode.REQUIRED_CURRENT,
      [PolicySourceClass.RISK]: PolicyRequirementMode.OPTIONAL_REFERENCE,
      [PolicySourceClass.COMPLIANCE]: PolicyRequirementMode.OPTIONAL_REFERENCE,
    }),
    productEligibility: {
      customerLifecycle: 'CURRENT_REQUIRED',
      onboarding: 'NOT_REQUIRED',
      eligibility: 'ELIGIBLE_REQUIRED',
      restrictions: 'NO_BLOCKING_RESTRICTION',
      risk: PolicyRiskRequirement.PROFILE_CONTROLLED,
      compliance: PolicyComplianceRequirement.PROFILE_CONTROLLED,
      accountState: 'PROFILE_CONTROLLED',
    },
    enrollmentRequirement: {
      mode: PolicyEnrollmentRequirement.REQUIRED_CURRENT,
      productKey: 'api',
    },
    permissionRequirement: {
      mode: PolicyPermissionRequirement.REQUIRED_ENABLED,
      permissionType: 'API',
    },
    riskRequirement: { mode: PolicyRiskRequirement.PROFILE_CONTROLLED },
    complianceRequirement: { mode: PolicyComplianceRequirement.PROFILE_CONTROLLED },
    accountBindingRequirement: { mode: PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT },
    limitRequirement: {
      mode: PolicyLimitRequirement.NOT_APPLICABLE,
      dimensions: [],
      returnsLimits: false,
    },
    allowedDecisions: [
      PolicyDecisionState.ALLOW,
      PolicyDecisionState.PENDING_REVIEW,
      PolicyDecisionState.DENY,
      PolicyDecisionState.SUSPEND,
    ],
    obligations: [{ code: 'RECHECK_A2_AUTHORIZATION', required: true }],
  }),
];

export class StaticCapabilityPolicyProfileRegistry implements PolicyProfileRegistry {
  private readonly profiles: readonly CapabilityPolicyProfile[];

  constructor(profiles: readonly CapabilityPolicyProfile[] = DEFAULT_CAPABILITY_POLICY_PROFILES) {
    this.profiles = profiles;
  }

  getProfile(
    capability: string,
    action: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null> {
    const profile = this.profiles.find(
      (candidate) =>
        candidate.capability === capability &&
        candidate.actions.includes(action) &&
        (policyVersionHint === undefined || candidate.policyVersion === policyVersionHint),
    );
    return Promise.resolve(profile ?? null);
  }
}
