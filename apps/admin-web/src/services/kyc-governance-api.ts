import { ApiClient } from './api-client';

export type KycIdentityKind = 'BVN' | 'NIN';
export type KycAssuranceCapability = 'ADDRESS_VERIFICATION' | 'ENHANCED_DUE_DILIGENCE';
export type KycProviderCapability = KycIdentityKind | KycAssuranceCapability;
export const KYC_PROVIDER_CAPABILITIES: readonly KycProviderCapability[] = [
  'BVN',
  'NIN',
  'ADDRESS_VERIFICATION',
  'ENHANCED_DUE_DILIGENCE',
];
export type KycProviderCode = 'MONNIFY' | 'DOJAH' | 'PREMBLY' | 'SYNTHETIC';

export interface KycProviderSetting {
  enabled: boolean;
  capabilities: KycProviderCapability[];
}
export interface KycProviderRoute {
  primary: KycProviderCode | null;
  fallback: KycProviderCode | null;
}
export interface KycProviderConfiguration {
  providers: Record<KycProviderCode, KycProviderSetting>;
  routes: Record<KycProviderCapability, KycProviderRoute>;
}
export interface KycProviderCatalogueCapability {
  code: KycProviderCapability;
  candidate: boolean;
  confirmed: boolean;
  ready: boolean;
}
export interface KycProviderCatalogueItem {
  code: KycProviderCode;
  candidateCapabilities: KycProviderCapability[];
  confirmedCapabilities: KycProviderCapability[];
  testOnly: boolean;
  ready: boolean;
  capabilities: KycProviderCatalogueCapability[];
}
export interface KycProviderWorkspace {
  version: number;
  configuration: KycProviderConfiguration;
  catalogue: KycProviderCatalogueItem[];
}
export interface KycProviderProposal {
  id: string;
  request_id: string;
  expected_version: number;
  configuration: KycProviderConfiguration;
  reason_code: 'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE';
  maker_id: string;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  created_at: string;
  expires_at: string;
}
export interface KycProviderHistory {
  version: number;
  proposal_id: string;
  configuration: KycProviderConfiguration;
  maker_id: string;
  checker_id: string;
  reason_code: string;
  applied_at: string;
}

export interface PremblyCredentialEnvironmentStatus {
  configured: boolean;
  version: number;
  fingerprint: string | null;
  keyVersion: string | null;
  updatedAt: string | null;
}

export interface PremblyCredentialStatus {
  provider: 'PREMBLY';
  encryptionAvailable: boolean;
  sandboxTestEnabled: boolean;
  productionReleased: boolean;
  sandbox: PremblyCredentialEnvironmentStatus;
  production: PremblyCredentialEnvironmentStatus;
}

export interface PremblyCredentialProposal {
  id: string;
  expectedRouteVersion: number;
  expectedCredentialVersion: number;
  environment: 'sandbox' | 'production';
  operation: 'SET' | 'CLEAR';
  fingerprint: string | null;
  makerId: string;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  expiresAt: string;
}

export interface PremblyConnectionTestResult {
  source: 'ACTUAL_PREMBLY_SANDBOX';
  environment: 'sandbox';
  operation: 'BVN_BASIC_TEST_DATA';
  outcome: 'CONNECTED' | 'AUTH_FAILED' | 'INDETERMINATE';
  httpStatus: number | null;
  responseCode: string | null;
  testedAt: string;
}

export type TierEvidenceCode =
  | 'BVN'
  | 'NIN'
  | 'PHONE'
  | 'BIOMETRIC'
  | 'ADDRESS'
  | 'ADDRESS_VERIFICATION'
  | 'UTILITY_BILL'
  | 'GPS'
  | 'IDENTITY_DOCUMENT'
  | 'DATE_OF_BIRTH'
  | 'OCCUPATION'
  | 'SOURCE_OF_FUNDS'
  | 'SOURCE_OF_WEALTH'
  | 'BUSINESS_PURPOSE'
  | 'PEP_SCREENING'
  | 'SANCTIONS_SCREENING'
  | 'CUSTOMER_RISK_ASSESSMENT'
  | 'ENHANCED_DUE_DILIGENCE';
export interface KycTierRequirements {
  all: TierEvidenceCode[];
  any: TierEvidenceCode[][];
}
export interface KycTierPolicyDefinition {
  regulatoryRequirementsConfirmed: true;
  effectiveFrom: string;
  effectiveUntil: string | null;
  regulatory: {
    LEVEL_1: KycTierRequirements;
    LEVEL_2: KycTierRequirements;
    LEVEL_3: KycTierRequirements;
  };
  operator: {
    LEVEL_1: KycTierRequirements;
    LEVEL_2: KycTierRequirements;
    LEVEL_3: KycTierRequirements;
  };
}
export interface KycTierPolicyVersion {
  version: number;
  definition: KycTierPolicyDefinition;
  maker_id: string;
  checker_id: string;
  approved_at: string;
}
export interface KycTierPolicyProposal {
  id: string;
  definition: KycTierPolicyDefinition;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  maker_id: string;
  expected_version: number;
  expires_at: string;
}

export const KycProviderGovernanceApi = {
  workspace: () => ApiClient.get<KycProviderWorkspace>('/internal/kyc/providers'),
  history: () => ApiClient.get<KycProviderHistory[]>('/internal/kyc/providers/history'),
  proposals: () => ApiClient.get<KycProviderProposal[]>('/internal/kyc/providers/proposals'),
  propose: (input: {
    requestId: string;
    expectedVersion: number;
    configuration: KycProviderConfiguration;
    reason: 'INITIAL_SETUP' | 'ROUTING_CHANGE' | 'PROVIDER_DISABLE';
  }) => ApiClient.post<{ id: string; replay: boolean }>('/internal/kyc/providers/proposals', input),
  approve: (proposalId: string) =>
    ApiClient.post<{ version: number; state: 'APPROVED' }>(
      `/internal/kyc/providers/proposals/${encodeURIComponent(proposalId)}/approve`,
    ),
  reject: (proposalId: string) =>
    ApiClient.post<{ version: number; state: 'REJECTED' }>(
      `/internal/kyc/providers/proposals/${encodeURIComponent(proposalId)}/reject`,
    ),
};

export const PremblyCredentialApi = {
  status: () =>
    ApiClient.get<PremblyCredentialStatus>('/internal/kyc/providers/prembly/credentials'),
  proposals: () =>
    ApiClient.get<PremblyCredentialProposal[]>(
      '/internal/kyc/providers/prembly/credential-proposals',
    ),
  propose: (input: {
    requestId: string;
    environment: 'sandbox' | 'production';
    operation: 'SET' | 'CLEAR';
    apiKey?: string;
  }) =>
    ApiClient.post<{ id: string; replay: boolean }>(
      '/internal/kyc/providers/prembly/credential-proposals',
      input,
    ),
  approve: (proposalId: string) =>
    ApiClient.post<{ credentialVersion: number; state: 'APPROVED' }>(
      `/internal/kyc/providers/prembly/credential-proposals/${encodeURIComponent(proposalId)}/approve`,
    ),
  reject: (proposalId: string) =>
    ApiClient.post<{ credentialVersion: number; state: 'REJECTED' }>(
      `/internal/kyc/providers/prembly/credential-proposals/${encodeURIComponent(proposalId)}/reject`,
    ),
  testSandboxConnection: () =>
    ApiClient.post<PremblyConnectionTestResult>(
      '/internal/kyc/providers/prembly/test-connection',
      {},
    ),
};

export const KycTierPolicyApi = {
  versions: () => ApiClient.get<KycTierPolicyVersion[]>('/internal/kyc/tier-policies'),
  proposals: () => ApiClient.get<KycTierPolicyProposal[]>('/internal/kyc/tier-policies/proposals'),
  propose: (input: {
    requestId: string;
    expectedVersion: number;
    definition: KycTierPolicyDefinition;
  }) =>
    ApiClient.post<{ id: string; replay: boolean }>('/internal/kyc/tier-policies/proposals', input),
  approve: (proposalId: string) =>
    ApiClient.post<{ version: number; state: 'APPROVED' }>(
      `/internal/kyc/tier-policies/proposals/${encodeURIComponent(proposalId)}/approve`,
    ),
  reject: (proposalId: string) =>
    ApiClient.post<{ version: number; state: 'REJECTED' }>(
      `/internal/kyc/tier-policies/proposals/${encodeURIComponent(proposalId)}/reject`,
    ),
};

export function createKycRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new Error('Secure browser UUID generation is unavailable. Reload from a secure context.');
}
