import { ApiClient } from './api-client';

export type KycIdentityKind = 'BVN' | 'NIN';
export type KycProviderCode = 'MONNIFY' | 'DOJAH' | 'SYNTHETIC';

export interface KycProviderSetting {
  enabled: boolean;
  capabilities: KycIdentityKind[];
}
export interface KycProviderRoute {
  primary: KycProviderCode | null;
  fallback: KycProviderCode | null;
}
export interface KycProviderConfiguration {
  providers: Record<KycProviderCode, KycProviderSetting>;
  routes: Record<KycIdentityKind, KycProviderRoute>;
}
export interface KycProviderCatalogueItem {
  code: KycProviderCode;
  candidateCapabilities: KycIdentityKind[];
  confirmedCapabilities: KycIdentityKind[];
  testOnly: boolean;
  ready: boolean;
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

export type TierEvidenceCode =
  | 'BVN'
  | 'NIN'
  | 'PHONE'
  | 'BIOMETRIC'
  | 'ADDRESS'
  | 'UTILITY_BILL'
  | 'GPS';
export interface KycTierRequirements {
  all: TierEvidenceCode[];
  any: TierEvidenceCode[][];
}
export interface KycTierPolicyDefinition {
  regulatoryRequirementsConfirmed: true;
  effectiveFrom: string;
  effectiveUntil: string | null;
  regulatory: { LEVEL_1: KycTierRequirements; LEVEL_2: KycTierRequirements };
  operator: { LEVEL_1: KycTierRequirements; LEVEL_2: KycTierRequirements };
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
