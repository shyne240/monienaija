import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { KycProviderManagementScreen } from '../src/screens/authenticated/KycProviderManagementScreen';
import { KycTierPolicyManagementScreen } from '../src/screens/authenticated/KycTierPolicyManagementScreen';
import {
  KycProviderGovernanceApi,
  KycTierPolicyApi,
  type KycProviderConfiguration,
} from '../src/services/kyc-governance-api';
import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';
import { useAuthStore, type WorkforcePrincipal } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
}));

const providerConfiguration: KycProviderConfiguration = {
  providers: {
    MONNIFY: { enabled: true, capabilities: ['BVN'] },
    DOJAH: { enabled: false, capabilities: [] },
    SYNTHETIC: { enabled: false, capabilities: [] },
  },
  routes: {
    BVN: { primary: 'MONNIFY', fallback: null },
    NIN: { primary: null, fallback: null },
  },
};

const providerWorkspace = {
  version: 3,
  configuration: providerConfiguration,
  catalogue: [
    {
      code: 'MONNIFY',
      candidateCapabilities: ['BVN', 'NIN'],
      confirmedCapabilities: [],
      testOnly: false,
      ready: false,
    },
    {
      code: 'DOJAH',
      candidateCapabilities: ['BVN', 'NIN'],
      confirmedCapabilities: [],
      testOnly: false,
      ready: false,
    },
    {
      code: 'SYNTHETIC',
      candidateCapabilities: ['BVN', 'NIN'],
      confirmedCapabilities: ['BVN', 'NIN'],
      testOnly: true,
      ready: false,
    },
  ],
};

function setPrincipal(principal: Partial<WorkforcePrincipal> = {}) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    error: null,
    principal: {
      type: 'OPERATOR',
      principalId: 'operator-1',
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles: ['COMPLIANCE'],
      scopes: ['kyc.provider.view', 'kyc.policy.view'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
      ...principal,
    },
  });
}

function mockGovernanceReads() {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path === '/internal/kyc/providers') return Promise.resolve(providerWorkspace);
    if (path === '/internal/kyc/providers/proposals') return Promise.resolve([]);
    if (path === '/internal/kyc/providers/history') return Promise.resolve([]);
    if (path === '/internal/kyc/tier-policies') return Promise.resolve([]);
    if (path === '/internal/kyc/tier-policies/proposals') return Promise.resolve([]);
    throw new Error(`Unexpected KYC governance API path: ${path}`);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  setPrincipal();
  mockGovernanceReads();
});

test('provider governance navigation requires its own view scope, not a role label', () => {
  expect(canAccessAdminView('kycProviders', ['kyc.provider.view'], ['COMPLIANCE'])).toBe(true);
  expect(canAccessAdminView('kycProviders', ['kyc.policy.view'], ['SUPER_ADMIN'])).toBe(false);
  expect(canAccessAdminView('kycTierPolicies', ['kyc.policy.view'], ['COMPLIANCE'])).toBe(true);
  expect(canAccessAdminView('kycTierPolicies', ['kyc.provider.view'], ['SUPER_ADMIN'])).toBe(false);
});

test('provider workspace uses the backend governance endpoints and presents readiness as fail-closed', async () => {
  render(<KycProviderManagementScreen />);

  expect(await screen.findByRole('heading', { name: 'KYC provider management' })).toBeTruthy();
  expect(screen.getAllByText('Not dispatch-ready')).toHaveLength(2);
  expect(screen.getByRole('heading', { name: 'Dojah' })).toBeTruthy();
  expect(screen.getByText('Test only')).toBeTruthy();
  expect(screen.getByText(/Monnify and Dojah account access/)).toBeTruthy();
  expect(screen.getByText(/BVN full-record Basic\/Advance access is not assumed/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit proposal' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();

  await waitFor(() => {
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/kyc/providers');
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/kyc/providers/proposals');
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/kyc/providers/history');
  });
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('tier policy workspace stays unconfigured and does not allow proposals without a maker grant', async () => {
  render(<KycTierPolicyManagementScreen />);

  expect(await screen.findByRole('heading', { name: 'KYC tier policies' })).toBeTruthy();
  expect(
    screen.getByText(
      'No policy version is published. Tier evaluation stays unconfigured and fails closed.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /The engine always retains the built-in Tier 1 BVN-or-NIN and Tier 2 BVN-and-NIN floors/,
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit policy proposal' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByText(/Proposal action requires an MFA SUPER_ADMIN session/)).toBeTruthy();

  await waitFor(() => {
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/kyc/tier-policies');
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/kyc/tier-policies/proposals');
  });
  expect(ApiClient.post).not.toHaveBeenCalled();
});

test('proposal and decision wrappers match the provider and tier-policy controller contracts', async () => {
  (ApiClient.post as jest.Mock)
    .mockResolvedValueOnce({ id: 'provider-proposal', replay: false })
    .mockResolvedValueOnce({ version: 4, state: 'APPROVED' })
    .mockResolvedValueOnce({ version: 4, state: 'REJECTED' })
    .mockResolvedValueOnce({ id: 'tier-proposal', replay: false })
    .mockResolvedValueOnce({ version: 5, state: 'APPROVED' })
    .mockResolvedValueOnce({ version: 5, state: 'REJECTED' });
  const providerInput = {
    requestId: 'request-provider-1',
    expectedVersion: 3,
    configuration: providerWorkspace.configuration,
    reason: 'ROUTING_CHANGE' as const,
  };
  const policyInput = {
    requestId: 'request-policy-1',
    expectedVersion: 4,
    definition: {
      regulatoryRequirementsConfirmed: true as const,
      effectiveFrom: '2026-11-15T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: {
        LEVEL_1: { all: [], any: [] },
        LEVEL_2: { all: [], any: [] },
      },
      operator: {
        LEVEL_1: { all: [], any: [] },
        LEVEL_2: { all: [], any: [] },
      },
    },
  };

  await KycProviderGovernanceApi.propose(providerInput);
  await KycProviderGovernanceApi.approve('provider-proposal');
  await KycProviderGovernanceApi.reject('provider-proposal');
  await KycTierPolicyApi.propose(policyInput);
  await KycTierPolicyApi.approve('tier-proposal');
  await KycTierPolicyApi.reject('tier-proposal');

  expect(ApiClient.post).toHaveBeenNthCalledWith(
    1,
    '/internal/kyc/providers/proposals',
    providerInput,
  );
  expect(ApiClient.post).toHaveBeenNthCalledWith(
    2,
    '/internal/kyc/providers/proposals/provider-proposal/approve',
  );
  expect(ApiClient.post).toHaveBeenNthCalledWith(
    3,
    '/internal/kyc/providers/proposals/provider-proposal/reject',
  );
  expect(ApiClient.post).toHaveBeenNthCalledWith(
    4,
    '/internal/kyc/tier-policies/proposals',
    policyInput,
  );
  expect(ApiClient.post).toHaveBeenNthCalledWith(
    5,
    '/internal/kyc/tier-policies/proposals/tier-proposal/approve',
  );
  expect(ApiClient.post).toHaveBeenNthCalledWith(
    6,
    '/internal/kyc/tier-policies/proposals/tier-proposal/reject',
  );
});
