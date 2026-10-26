import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  AGENT_SESSION_KEYS,
  ApiClient,
  ApiError,
  isBearerSessionExpired401Message,
  setBaseUrl,
} from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import { CashToCashClaimRecipientScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen';
import { CashToCashClaimConfirmScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen';
import {
  CASH_TO_CASH_REFERENCE_HANDOFF_PLAN,
  classifyCashToCashClaimIdentifier,
} from '../src/screens/authenticated/cash-to-cash/cash-to-cash-reference-handoff.plan';
import type { AgentMfaChallenge } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => {
  const actual = jest.requireActual('../src/services/agent-api');
  return {
    ...actual,
    resolveCustomerRecipient: jest.fn(),
    requestAgentMfaChallenge: jest.fn(),
    agentCashToCashClaim: jest.fn(),
    getAgentCashToCashClaim: jest.fn(),
  };
});

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveCustomerRecipient: jest.Mock;
  requestAgentMfaChallenge: jest.Mock;
  agentCashToCashClaim: jest.Mock;
  getAgentCashToCashClaim: jest.Mock;
  describeCashToCashClaimError: typeof import('../src/services/agent-api').describeCashToCashClaimError;
};

let mockRoute: any = { key: 'sprint3-route', name: 'CashToCashClaimConfirm', params: {} };
const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockNavigation = { navigate: mockNavigate, reset: mockReset };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));

const makeApiError = (message: string, status: number) => new ApiError(message, status, 'ERR');

describe('Sprint 3 — Agent Mobile Cash-to-Cash Claim Contract Review & Hardening', () => {
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    setBaseUrl('https://api.monienaija.test');
    (global as any).fetch = fetchMock;
    await SecureStorage.set(AGENT_SESSION_KEYS.token, 'sprint3-agent-token');
    await SecureStorage.set(AGENT_SESSION_KEYS.agentId, '11111111-1111-4111-8111-111111111111');
    useAuthStore.setState({
      isAuthenticated: true,
      agentId: '11111111-1111-4111-8111-111111111111',
      sessionData: null,
    } as any);
  });

  test('isolated reference-handoff plan classifies UUID vs receipt reference without making network calls', () => {
    expect(classifyCashToCashClaimIdentifier('   ')).toEqual({
      kind: 'EMPTY',
      normalized: '',
    });
    expect(
      classifyCashToCashClaimIdentifier(' 55555555-5555-4555-8555-555555555555 '),
    ).toEqual({
      kind: 'UUID',
      normalized: '55555555-5555-4555-8555-555555555555',
    });
    expect(classifyCashToCashClaimIdentifier('CASH_TO_CASH-c2c-send-01')).toEqual({
      kind: 'TRANSFER_REFERENCE',
      normalized: 'CASH_TO_CASH-c2c-send-01',
    });
    expect(classifyCashToCashClaimIdentifier('C2C-20261026-ABJ-001')).toEqual({
      kind: 'TRANSFER_REFERENCE',
      normalized: 'C2C-20261026-ABJ-001',
    });
    expect(classifyCashToCashClaimIdentifier('not-a-uuid')).toEqual({
      kind: 'INVALID',
      normalized: 'not-a-uuid',
    });
    expect(CASH_TO_CASH_REFERENCE_HANDOFF_PLAN.length).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('CashToCashClaimRecipientScreen distinguishes receipt references from UUIDs and resolves valid UUID claims cleanly', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue({
      ownerType: 'CUSTOMER',
      customerId: '22222222-2222-4222-8222-222222222222',
      walletId: '33333333-3333-4333-8333-333333333333',
      receivingNumber: '8012345678',
      status: 'ACTIVE',
      display: 'Amina Bello',
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimRecipientScreen />
      </QueryClientProvider>,
    );

    fireEvent.changeText(view.getByTestId('c2c-claim-phone-input'), '08012345678');

    // 1. Pasting a sender receipt reference guides the Agent instead of calling nonexistent endpoints
    fireEvent.changeText(
      view.getByTestId('c2c-claim-transfer-id-input'),
      'CASH_TO_CASH-c2c-send-key-99',
    );
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    expect(view.getByTestId('c2c-claim-recipient-error').props.children).toContain(
      'You entered a receipt reference',
    );
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();

    // 2. Malformed random string keeps standard UUID validation message
    fireEvent.changeText(view.getByTestId('c2c-claim-transfer-id-input'), 'bad-id');
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    expect(view.getByTestId('c2c-claim-recipient-error').props.children).toBe(
      'Enter a valid Transfer ID (UUID format)',
    );
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();

    // 3. Valid 36-char UUID resolves beneficiary and navigates with canonical params
    fireEvent.changeText(
      view.getByTestId('c2c-claim-transfer-id-input'),
      '55555555-5555-4555-8555-555555555555',
    );
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    await waitFor(() =>
      expect(mockApi.resolveCustomerRecipient).toHaveBeenCalledWith('8012345678'),
    );
    await waitFor(() => expect(view.getByTestId('c2c-claim-continue')).toBeTruthy());
    fireEvent.press(view.getByTestId('c2c-claim-continue'));

    expect(mockNavigate).toHaveBeenCalledWith(
      'CashToCashClaimConfirm',
      expect.objectContaining({
        transferId: '55555555-5555-4555-8555-555555555555',
        beneficiaryPhone: '8012345678',
      }),
    );

    view.unmount();
    queryClient.clear();
  });

  test('CashToCashClaimConfirmScreen blocks non-numeric transferCode before burning the beneficiary MFA OTP challenge', async () => {
    mockRoute = {
      key: 'claim-confirm-sprint3',
      name: 'CashToCashClaimConfirm',
      params: {
        transferId: '55555555-5555-4555-8555-555555555555',
        beneficiaryPhone: '8012345678',
        customer: {
          ownerType: 'CUSTOMER',
          customerId: '22222222-2222-4222-8222-222222222222',
          walletId: '33333333-3333-4333-8333-333333333333',
          receivingNumber: '8012345678',
          status: 'ACTIVE',
          display: 'Amina Bello',
        },
      },
    };

    const challenge: AgentMfaChallenge = {
      challengeId: 'mfa-sprint3-1',
      purpose: 'CASH_TO_CASH_CLAIM',
      maskedPhone: '***5678',
      expiresAt: '2099-12-31T23:59:59.000Z',
    } as any;

    mockApi.getAgentCashToCashClaim.mockRejectedValueOnce(makeApiError('Not found', 404));
    mockApi.requestAgentMfaChallenge.mockResolvedValueOnce(challenge);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimConfirmScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(view.getByTestId('c2c-claim-mfa-card')).toBeTruthy());
    fireEvent.press(view.getByTestId('mfa-request-button'));
    await waitFor(() => expect(view.getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '8765-ABCD');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    expect(view.getByText('Transfer code must contain 1 to 20 numeric digits')).toBeTruthy();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();

    view.unmount();
    queryClient.clear();
  });

  test('aligns session-purge 401 detection and describeCashToCashClaimError with ARENA 1 Sprint 2 claim security exceptions', async () => {
    expect(isBearerSessionExpired401Message('A current Agent session is required for this claim')).toBe(
      true,
    );
    expect(isBearerSessionExpired401Message('Agent session expired or revoked during claim')).toBe(
      true,
    );
    expect(isBearerSessionExpired401Message('Agent PIN changed or was revoked during claim')).toBe(
      false,
    );

    // Mid-claim PIN rotation preserves session even with preserveSessionOn401: true
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Agent PIN changed or was revoked during claim' }),
    });
    await expect(
      ApiClient.post('api/v1/agents/cash-to-cash/claim', {}, { preserveSessionOn401: true }),
    ).rejects.toThrow('Agent PIN changed or was revoked during claim');
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBe('sprint3-agent-token');

    // Mid-claim session revocation purges stored session even with preserveSessionOn401: true
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Agent session expired or revoked during claim' }),
    });
    await expect(
      ApiClient.post('api/v1/agents/cash-to-cash/claim', {}, { preserveSessionOn401: true }),
    ).rejects.toThrow('Agent session expired or revoked during claim');
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();

    // Error message mapping for ARENA 1 Sprint 2 PIN rotation & expired wallet KYC
    expect(
      mockApi.describeCashToCashClaimError(
        makeApiError('Agent PIN changed or was revoked during claim', 401),
      ),
    ).toBe(
      'Your transaction PIN was changed or revoked while processing this claim. Re-enter your current PIN in a new attempt.',
    );
    expect(
      mockApi.describeCashToCashClaimError(
        makeApiError('Wallet redemption KYC assessment is not approved or has expired', 403),
      ),
    ).toBe(
      'Beneficiary wallet KYC assessment is not approved or has expired. A current approved KYC assessment is required for wallet redemption.',
    );
    expect(
      mockApi.describeCashToCashClaimError(
        makeApiError('Agent session expired or revoked during claim', 401),
      ),
    ).toBe('Your session has expired. Please log in again.');
  });
});
