import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  AGENT_SESSION_KEYS,
  ApiClient,
  ApiError,
  NetworkError,
  isBearerSessionExpired401Message,
  setBaseUrl,
} from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import {
  clearPendingCashToCashLocatorClaim,
  loadPendingCashToCashLocatorClaim,
  savePendingCashToCashLocatorClaim,
} from '../src/services/pending-operation';
import { useAuthStore } from '../src/store/auth-store';
import { CashToCashClaimRecipientScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen';
import { CashToCashClaimConfirmScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen';
import {
  CASH_TO_CASH_REFERENCE_HANDOFF_PLAN,
  classifyCashToCashClaimIdentifier,
  validateSixDigitTransferNumber,
} from '../src/screens/authenticated/cash-to-cash/cash-to-cash-reference-handoff.plan';
import type { AgentCashToCashClaimResult, AgentMfaChallenge } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => {
  const actual = jest.requireActual('../src/services/agent-api');
  return {
    ...actual,
    resolveCustomerRecipient: jest.fn(),
    requestAgentMfaChallenge: jest.fn(),
    agentCashToCashClaim: jest.fn(),
    agentCashToCashClaimByNumber: jest.fn(),
    getAgentCashToCashClaim: jest.fn(),
    recoverAgentCashToCashClaimByNumber: jest.fn(),
  };
});

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveCustomerRecipient: jest.Mock;
  requestAgentMfaChallenge: jest.Mock;
  agentCashToCashClaim: jest.Mock;
  agentCashToCashClaimByNumber: jest.Mock;
  getAgentCashToCashClaim: jest.Mock;
  recoverAgentCashToCashClaimByNumber: jest.Mock;
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

const makeApiError = (message: string, status: number, code = 'ERR') =>
  new ApiError(message, status, code);

const AGENT_ID = '11111111-1111-4111-8111-111111111111';

const customerFixture = {
  ownerType: 'CUSTOMER' as const,
  customerId: '22222222-2222-4222-8222-222222222222',
  walletId: '33333333-3333-4333-8333-333333333333',
  receivingNumber: '8012345678',
  status: 'ACTIVE',
  display: 'Amina Bello',
};

const challengeFixture: AgentMfaChallenge = {
  challengeId: 'mfa-sprint3-1',
  customerId: customerFixture.customerId,
  purpose: 'CASH_TO_CASH_CLAIM',
  deliveryChannel: 'SMS',
  destinationMasked: '***5678',
  delivered: true,
  issuedAt: '2026-10-27T08:00:00.000Z',
  ttlSeconds: 300,
  expiresAt: '2099-12-31T23:59:59.000Z',
};

const settledClaimFixture: AgentCashToCashClaimResult = {
  status: 'COMPLETED',
  transferId: '55555555-5555-4555-8555-555555555555',
  journalId: '66666666-6666-4666-8666-666666666666',
  beneficiaryPhone: '8012345678',
  principalMinor: '450000',
  currency: 'NGN',
  amountMinor: '450000',
  claimantCustomerId: customerFixture.customerId,
  redemptionMethod: 'AGENT_CASH',
  idempotencyKey: 'c2c-claim-locator-1',
  requestHash: 'hash-locator-1',
  replayed: false,
  reference: 'CASH_TO_CASH_CLAIM-c2c-claim-locator-1',
  claimedAt: '2026-10-27T10:15:00.000Z',
};

describe('Sprint 3 Final — Agent Mobile Six-Digit Cash-to-Cash Redemption & Recovery', () => {
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    setBaseUrl('https://api.monienaija.test');
    (global as any).fetch = fetchMock;
    await SecureStorage.set(AGENT_SESSION_KEYS.token, 'sprint3-agent-token');
    await SecureStorage.set(AGENT_SESSION_KEYS.agentId, AGENT_ID);
    await clearPendingCashToCashLocatorClaim(AGENT_ID);
    useAuthStore.setState({
      isAuthenticated: true,
      agentId: AGENT_ID,
      sessionData: null,
    } as any);
  });

  test('validateSixDigitTransferNumber & classifyCashToCashClaimIdentifier preserve leading zeros and reject unpadded/invalid values', () => {
    expect(validateSixDigitTransferNumber('000042')).toBe('000042');
    expect(validateSixDigitTransferNumber(' 000000 ')).toBe('000000');
    expect(validateSixDigitTransferNumber('42')).toBeNull();
    expect(validateSixDigitTransferNumber('0000421')).toBeNull();
    expect(validateSixDigitTransferNumber('00A042')).toBeNull();

    expect(classifyCashToCashClaimIdentifier('   ')).toEqual({
      kind: 'EMPTY',
      normalized: '',
    });
    expect(classifyCashToCashClaimIdentifier(' 000042 ')).toEqual({
      kind: 'TRANSFER_NUMBER',
      normalized: '000042',
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

  test('CashToCashClaimRecipientScreen validates senderPhone & leading-zero 6-digit transferNumber and never populates transferId', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue(customerFixture);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimRecipientScreen />
      </QueryClientProvider>,
    );

    fireEvent.changeText(view.getByTestId('c2c-claim-phone-input'), '08012345678');
    fireEvent.changeText(view.getByTestId('c2c-claim-sender-phone-input'), '08031234567');

    // 1. Pasting a sender receipt reference guides the Agent to enter the 6-digit transfer number
    fireEvent.changeText(
      view.getByTestId('c2c-claim-transfer-number-input'),
      'CASH_TO_CASH-c2c-send-key-99',
    );
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    expect(view.getByTestId('c2c-claim-recipient-error').props.children).toContain(
      'You entered a receipt reference',
    );
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();

    // 2. Unpadded short number ("42") is rejected — NEVER auto-padded
    fireEvent.changeText(view.getByTestId('c2c-claim-transfer-number-input'), '42');
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    expect(view.getByTestId('c2c-claim-recipient-error').props.children).toContain(
      'exact 6-digit transfer number',
    );
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();

    // 3. Valid leading-zero 6-digit transferNumber ("000042") resolves beneficiary and navigates cleanly
    fireEvent.changeText(view.getByTestId('c2c-claim-transfer-number-input'), '000042');
    fireEvent.press(view.getByTestId('c2c-claim-verify-button'));
    await waitFor(() =>
      expect(mockApi.resolveCustomerRecipient).toHaveBeenCalledWith('8012345678'),
    );
    await waitFor(() => expect(view.getByTestId('c2c-claim-continue')).toBeTruthy());
    fireEvent.press(view.getByTestId('c2c-claim-continue'));

    expect(mockNavigate).toHaveBeenCalledWith('CashToCashClaimConfirm', {
      customer: customerFixture,
      senderPhone: '8031234567',
      transferNumber: '000042',
      beneficiaryPhone: '8012345678',
    });
    expect(mockNavigate.mock.calls[0][1]).not.toHaveProperty('transferId');

    view.unmount();
    queryClient.clear();
  });

  test('CashToCashClaimConfirmScreen submits to claim-by-number without speculative mount recovery, validates 8..20 digit transferCode, and omits transferId', async () => {
    mockRoute = {
      key: 'claim-confirm-locator',
      name: 'CashToCashClaimConfirm',
      params: {
        senderPhone: '8031234567',
        transferNumber: '000042',
        beneficiaryPhone: '8012345678',
        customer: customerFixture,
      },
    };

    mockApi.requestAgentMfaChallenge.mockResolvedValueOnce(challengeFixture);
    mockApi.agentCashToCashClaimByNumber.mockResolvedValueOnce(settledClaimFixture);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimConfirmScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(view.getByTestId('c2c-claim-mfa-card')).toBeTruthy());
    // Fresh mount must NOT call recover-by-number or UUID claim lookup
    expect(mockApi.recoverAgentCashToCashClaimByNumber).not.toHaveBeenCalled();
    expect(mockApi.getAgentCashToCashClaim).not.toHaveBeenCalled();
    expect(view.getByTestId('c2c-claim-summary-sender-phone').props.children).toBe('8031234567');
    expect(view.getByTestId('c2c-claim-summary-transfer-number').props.children).toBe('000042');

    // Select AGENT_CASH and issue beneficiary MFA OTP
    fireEvent.press(view.getByTestId('c2c-claim-method-cash'));
    fireEvent.press(view.getByTestId('mfa-request-button'));
    await waitFor(() => expect(view.getByTestId('mfa-ready-title')).toBeTruthy());

    // Invalid short/non-numeric transferCode blocked before calling API
    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '8765-ABCD');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.changeText(view.getByTestId('c2c-claim-agent-pin-input'), '1234');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));
    expect(view.getByText('Transfer code must contain 8 to 20 numeric digits')).toBeTruthy();
    expect(mockApi.agentCashToCashClaimByNumber).not.toHaveBeenCalled();

    // Valid 8-digit transferCode submits exact ARENA 1 DTO without transferId
    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '00778899');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.agentCashToCashClaimByNumber).toHaveBeenCalledTimes(1);
    const submittedPayload = mockApi.agentCashToCashClaimByNumber.mock.calls[0][0];
    expect(submittedPayload).toMatchObject({
      senderPhone: '8031234567',
      transferNumber: '000042',
      beneficiaryPhone: '8012345678',
      transferCode: '00778899',
      customerId: customerFixture.customerId,
      mfaChallengeId: challengeFixture.challengeId,
      otp: '123456',
      redemptionMethod: 'AGENT_CASH',
      agentPin: '1234',
    });
    expect(typeof submittedPayload.transferNumber).toBe('string');
    expect(submittedPayload).not.toHaveProperty('transferId');
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();
    expect(await loadPendingCashToCashLocatorClaim(AGENT_ID)).toBeNull();

    view.unmount();
    queryClient.clear();
  });

  test('Ambiguous 503 C2C_RETRY_REQUIRED & simulated restart recover via claims/recover-by-number using ORIGINAL idempotencyKey and never mint a new key', async () => {
    mockRoute = {
      key: 'claim-confirm-recover',
      name: 'CashToCashClaimConfirm',
      params: {
        senderPhone: '8031234567',
        transferNumber: '000042',
        beneficiaryPhone: '8012345678',
        customer: customerFixture,
      },
    };

    mockApi.requestAgentMfaChallenge.mockResolvedValueOnce(challengeFixture);
    mockApi.agentCashToCashClaimByNumber.mockRejectedValueOnce(
      makeApiError('Claim outcome unavailable; recover before retrying', 503, 'C2C_RETRY_REQUIRED'),
    );
    // Automatic post-503 recovery gets immediate 404 (not yet committed) -> holds in recovery mode
    mockApi.recoverAgentCashToCashClaimByNumber
      .mockRejectedValueOnce(makeApiError('Claim not available', 404, 'C2C_CLAIM_NOT_AVAILABLE'))
      .mockResolvedValueOnce({
        ...settledClaimFixture,
        status: 'REPLAYED',
        replayed: true,
      });

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

    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    // Holds in recovery mode; "Change payout method (new attempt)" is NOT rendered after ambiguous error
    await waitFor(() =>
      expect(view.getByTestId('c2c-claim-post-submit-recovery-card')).toBeTruthy(),
    );
    expect(view.queryByTestId('c2c-claim-unlock-method-button')).toBeNull();

    const originalKey = mockApi.agentCashToCashClaimByNumber.mock.calls[0][0].idempotencyKey;
    expect(mockApi.recoverAgentCashToCashClaimByNumber).toHaveBeenCalledWith({
      senderPhone: '8031234567',
      transferNumber: '000042',
      idempotencyKey: originalKey,
    });

    // Agent taps "Check claim status" -> recovers committed receipt with same original key!
    fireEvent.press(view.getByTestId('c2c-claim-post-submit-recovery-button'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.recoverAgentCashToCashClaimByNumber).toHaveBeenNthCalledWith(2, {
      senderPhone: '8031234567',
      transferNumber: '000042',
      idempotencyKey: originalKey,
    });
    expect(await loadPendingCashToCashLocatorClaim(AGENT_ID)).toBeNull();

    view.unmount();

    // Simulated process restart mid-flight: persisted PendingCashToCashLocatorClaim triggers mount recovery
    jest.clearAllMocks();
    await savePendingCashToCashLocatorClaim({
      agentId: AGENT_ID,
      senderPhone: '8031234567',
      transferNumber: '000042',
      beneficiaryPhone: '8012345678',
      customerId: customerFixture.customerId,
      redemptionMethod: 'AGENT_CASH',
      idempotencyKey: 'persisted-claim-key-restart',
      createdAt: new Date().toISOString(),
    });
    mockApi.recoverAgentCashToCashClaimByNumber.mockResolvedValueOnce({
      ...settledClaimFixture,
      status: 'REPLAYED',
      replayed: true,
      idempotencyKey: 'persisted-claim-key-restart',
    });

    const restartedView = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimConfirmScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.recoverAgentCashToCashClaimByNumber).toHaveBeenCalledWith({
      senderPhone: '8031234567',
      transferNumber: '000042',
      idempotencyKey: 'persisted-claim-key-restart',
    });
    restartedView.unmount();
    queryClient.clear();
  });

  test('Handles uniform 404 C2C_CLAIM_NOT_AVAILABLE (non-enumerating, same-key retry) and 429 C2C_LOCATOR_RATE_LIMITED cleanly', async () => {
    mockRoute = {
      key: 'claim-confirm-404-429',
      name: 'CashToCashClaimConfirm',
      params: {
        senderPhone: '8031234567',
        transferNumber: '000042',
        beneficiaryPhone: '8012345678',
        customer: customerFixture,
      },
    };

    const challenge2 = { ...challengeFixture, challengeId: 'mfa-sprint3-2' };
    mockApi.requestAgentMfaChallenge
      .mockResolvedValueOnce(challengeFixture)
      .mockResolvedValueOnce(challenge2);
    mockApi.agentCashToCashClaimByNumber
      .mockRejectedValueOnce(
        makeApiError('Too many locator requests; retry later', 429, 'C2C_LOCATOR_RATE_LIMITED'),
      )
      .mockRejectedValueOnce(
        makeApiError('Claim not available', 404, 'C2C_CLAIM_NOT_AVAILABLE'),
      )
      .mockResolvedValueOnce(settledClaimFixture);

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

    // 1. 429 C2C_LOCATOR_RATE_LIMITED surfaces wait guidance without burning recover-by-number or invalidating OTP
    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(view.getByTestId('c2c-claim-confirm-error').props.children).toContain(
        'Wait at least 60 seconds',
      ),
    );
    expect(mockApi.recoverAgentCashToCashClaimByNumber).not.toHaveBeenCalled();
    expect(view.getByTestId('mfa-ready-title')).toBeTruthy();

    // 2. 404 C2C_CLAIM_NOT_AVAILABLE surfaces privacy-safe message, invalidates MFA, and preserves idempotencyKey
    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    await waitFor(() => {
      const msg = view.getByTestId('c2c-claim-confirm-error').props.children as string;
      expect(msg).toContain('Claim could not be completed');
      expect(msg).not.toMatch(/not found|does not exist|already claimed/i);
      expect(view.getByTestId('mfa-consumed-notice')).toBeTruthy();
    });

    const firstKey = mockApi.agentCashToCashClaimByNumber.mock.calls[0][0].idempotencyKey;

    // 3. Request fresh OTP and retry -> reuses identical idempotencyKey
    fireEvent.press(view.getByTestId('mfa-request-button'));
    await waitFor(() => expect(view.getByTestId('mfa-ready-title')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '654321');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.agentCashToCashClaimByNumber.mock.calls[2][0].idempotencyKey).toBe(firstKey);

    view.unmount();
    queryClient.clear();
  });

  test('Preserves session-purge 401 detection, Sprint 2 claim security exceptions, and legacy UUID claim compatibility', async () => {
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
      ApiClient.post('api/v1/agents/cash-to-cash/claim-by-number', {}, { preserveSessionOn401: true }),
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
      ApiClient.post('api/v1/agents/cash-to-cash/claim-by-number', {}, { preserveSessionOn401: true }),
    ).rejects.toThrow('Agent session expired or revoked during claim');
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();

    expect(
      mockApi.describeCashToCashClaimError(
        makeApiError('Agent PIN changed or was revoked during claim', 401),
      ),
    ).toBe(
      'Your transaction PIN was changed or revoked while processing this claim. Re-enter your current PIN in a new attempt.',
    );
    expect(
      mockApi.describeCashToCashClaimError(
        makeApiError(
          'Wallet redemption KYC assessment is not approved or has expired. A current approved KYC assessment is required',
          403,
        ),
      ),
    ).toBe(
      'Beneficiary wallet KYC assessment is not approved or has expired. A current approved KYC assessment is required for wallet redemption.',
    );

    // Legacy UUID route compatibility still calls getAgentCashToCashClaim & agentCashToCashClaim
    useAuthStore.setState({ isAuthenticated: true, agentId: AGENT_ID } as any);
    mockRoute = {
      key: 'legacy-uuid-compat',
      name: 'CashToCashClaimConfirm',
      params: {
        transferId: '55555555-5555-4555-8555-555555555555',
        beneficiaryPhone: '8012345678',
        customer: customerFixture,
      },
    };
    mockApi.getAgentCashToCashClaim.mockRejectedValueOnce(makeApiError('Not found', 404));
    mockApi.requestAgentMfaChallenge.mockResolvedValueOnce(challengeFixture);
    mockApi.agentCashToCashClaim.mockResolvedValueOnce(settledClaimFixture);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const legacyView = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimConfirmScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(legacyView.getByTestId('c2c-claim-mfa-card')).toBeTruthy());
    expect(mockApi.getAgentCashToCashClaim).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
    );
    expect(legacyView.getByTestId('c2c-claim-summary-transfer-id').props.children).toBe(
      '55555555-5555-4555-8555-555555555555',
    );
    legacyView.unmount();
    queryClient.clear();
  });
});
