import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  AGENT_SESSION_KEYS,
  ApiClient,
  ApiError,
  setBaseUrl,
} from '../src/services/api-client';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import {
  receiptFromCashToCashResult,
  receiptFromHistoryItem,
} from '../src/components/AgentReceipt';
import { CashToCashClaimConfirmScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen';
import { TransactionsScreen } from '../src/screens/authenticated/TransactionsScreen';
import { TransactionReceiptScreen } from '../src/screens/authenticated/TransactionReceiptScreen';
import type {
  AgentCashToCashClaimResult,
  AgentCashToCashResult,
  AgentHistoryItem,
  AgentMfaChallenge,
} from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => {
  const actual = jest.requireActual('../src/services/agent-api');
  return {
    ...actual,
    requestAgentMfaChallenge: jest.fn(),
    agentCashToCashClaim: jest.fn(),
    getAgentCashToCashClaim: jest.fn(),
    getAgentTransactions: jest.fn(),
  };
});

const mockApi = jest.requireMock('../src/services/agent-api') as {
  requestAgentMfaChallenge: jest.Mock;
  agentCashToCashClaim: jest.Mock;
  getAgentCashToCashClaim: jest.Mock;
  getAgentTransactions: jest.Mock;
  describeCashToCashError: typeof import('../src/services/agent-api').describeCashToCashError;
  describeCashOutError: typeof import('../src/services/agent-api').describeCashOutError;
  describeCashToCashClaimError: typeof import('../src/services/agent-api').describeCashToCashClaimError;
  describeTransactionPinError: typeof import('../src/services/agent-api').describeTransactionPinError;
};

let mockRoute: any = { key: 'k', name: 'CashToCashClaimConfirm', params: {} };
const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockNavigation = { navigate: mockNavigate, reset: mockReset };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));

const makeApiError = (message: string, status: number) => {
  const err = new ApiError(message, status, 'ERR');
  return err;
};

describe('Sprint 2 — Agent Mobile operational hardening', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
    setBaseUrl('http://10.0.2.2:3000');
    useAuthStore.setState({
      isAuthenticated: true,
      agentId: '11111111-1111-4111-8111-111111111111',
      session: {
        accessToken: 'valid-agent-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        agentId: '11111111-1111-4111-8111-111111111111',
        sessionId: 'sess-sprint2',
      },
    });
  });

  test('preserveSessionOn401 purges session when Bearer guard rejects ("Agent authentication required"), while keeping session on step-up PIN 401', async () => {
    const jsonResp = (status: number, body: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    await SecureStorage.set(AGENT_SESSION_KEYS.token, 'valid-agent-token');
    await SecureStorage.set(AGENT_SESSION_KEYS.sessionData, '{"agentId":"11111111-1111-4111-8111-111111111111"}');

    // Step-up PIN 401 keeps session alive
    fetchMock.mockResolvedValueOnce(
      jsonResp(401, { message: 'Transaction PIN invalid: PIN_INVALID' }),
    );
    await expect(
      ApiClient.post('api/v1/agents/cash-in', { pin: '0000' }, { preserveSessionOn401: true }),
    ).rejects.toThrow('Transaction PIN invalid: PIN_INVALID');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBe('valid-agent-token');

    // Guard-level Bearer expiry 401 purges session even with preserveSessionOn401: true
    fetchMock.mockResolvedValueOnce(
      jsonResp(401, { message: 'Agent authentication required' }),
    );
    await expect(
      ApiClient.post('api/v1/agents/cash-in', { pin: '1234' }, { preserveSessionOn401: true }),
    ).rejects.toThrow('Agent authentication required');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(await SecureStorage.get(AGENT_SESSION_KEYS.token)).toBeNull();
  });

  test('error mappers distinguish Bearer session expiry, PIN_NOT_FOUND, and PIN_INVALID cleanly', () => {
    expect(
      mockApi.describeCashToCashError(makeApiError('Agent authentication required', 401)),
    ).toBe('Your session has expired. Please log in again.');
    expect(
      mockApi.describeCashToCashError(makeApiError('Transaction PIN invalid: PIN_NOT_FOUND', 401)),
    ).toContain('No transaction PIN is set for your account');

    expect(
      mockApi.describeCashOutError(makeApiError('Authentication required', 401)),
    ).toBe('Your session has expired. Please log in again.');
    expect(
      mockApi.describeCashOutError(makeApiError('Agent PIN invalid: PIN_NOT_FOUND', 401)),
    ).toContain('No transaction PIN is set for your account');

    expect(
      mockApi.describeCashToCashClaimError(makeApiError('Agent principal is required', 401)),
    ).toBe('Your session has expired. Please log in again.');
    expect(
      mockApi.describeCashToCashClaimError(makeApiError('Agent PIN invalid: PIN_NOT_FOUND', 401)),
    ).toContain('No transaction PIN is set for your account');

    expect(
      mockApi.describeTransactionPinError(makeApiError('Agent authentication required', 401)),
    ).toBe('Your session has expired. Please log in again.');
    expect(
      mockApi.describeTransactionPinError(makeApiError('Unauthorized', 401)),
    ).toBe('Incorrect transaction PIN. Check the PIN and try again.');
  });

  test('Cash-to-Cash Claim locks redemptionMethod & idempotencyKey after post-OTP rollback and resets MFA challenge cleanly', async () => {
    mockRoute = {
      key: 'claim-confirm',
      name: 'CashToCashClaimConfirm',
      params: {
        transferId: '55555555-5555-4555-8555-555555555555',
        beneficiaryPhone: '08012345678',
        customer: {
          ownerType: 'CUSTOMER',
          customerId: '22222222-2222-4222-8222-222222222222',
          receivingNumber: '8012345678',
          display: 'Emeka Obi',
          status: 'ACTIVE',
        },
      },
    };

    const challenge1: AgentMfaChallenge = {
      challengeId: 'mfa-1',
      customerId: '22222222-2222-4222-8222-222222222222',
      purpose: 'CASH_TO_CASH_CLAIM',
      deliveryChannel: 'SMS',
      destinationMasked: '***5678',
      delivered: true,
      issuedAt: new Date().toISOString(),
      ttlSeconds: 300,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const challenge2: AgentMfaChallenge = {
      ...challenge1,
      challengeId: 'mfa-2',
    };
    const settledClaim: AgentCashToCashClaimResult = {
      status: 'COMPLETED',
      transferId: '55555555-5555-4555-8555-555555555555',
      journalId: '66666666-6666-4666-8666-666666666666',
      claimantCustomerId: '22222222-2222-4222-8222-222222222222',
      beneficiaryPhone: '08012345678',
      principalMinor: '250000',
      amountMinor: '250000',
      currency: 'NGN',
      redemptionMethod: 'AGENT_CASH',
      idempotencyKey: 'idem-same',
      requestHash: 'hash-1',
      replayed: false,
      claimedAt: '2026-10-26T10:00:00.000Z',
    };

    mockApi.getAgentCashToCashClaim
      .mockRejectedValueOnce(makeApiError('Not found', 404)) // initial mount recovery check
      .mockRejectedValueOnce(makeApiError('Not found', 404)); // post-OTP rollback check -> 404 (not committed)
    mockApi.requestAgentMfaChallenge
      .mockResolvedValueOnce(challenge1)
      .mockResolvedValueOnce(challenge2);
    mockApi.agentCashToCashClaim
      .mockRejectedValueOnce(makeApiError('OTP already used', 400))
      .mockResolvedValueOnce(settledClaim);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CashToCashClaimConfirmScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(view.getByTestId('c2c-claim-mfa-card')).toBeTruthy());

    // Select AGENT_CASH payout and request first OTP
    fireEvent.press(view.getByTestId('c2c-claim-method-cash'));
    fireEvent.press(view.getByTestId('mfa-request-button'));
    await waitFor(() => expect(view.getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.changeText(view.getByTestId('c2c-claim-agent-pin-input'), '1234');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    // Wait for rollback notice + MFA consumed notice + payout method lock
    await waitFor(() => {
      expect(view.getByTestId('c2c-claim-method-locked-notice')).toBeTruthy();
      expect(view.getByTestId('c2c-claim-rollback-retry-notice')).toBeTruthy();
      expect(view.getByTestId('mfa-consumed-notice')).toBeTruthy();
    });

    const firstIdempotencyKey = mockApi.agentCashToCashClaim.mock.calls[0][0].idempotencyKey;

    // Attempting to click CUSTOMER_WALLET radio while locked does NOT switch away from AGENT_CASH
    fireEvent.press(view.getByTestId('c2c-claim-method-wallet'));
    expect(view.getByTestId('c2c-claim-agent-pin-input')).toBeTruthy();

    // Request fresh OTP (mfa-2) and retry — preserves exact same idempotencyKey and AGENT_CASH method
    fireEvent.press(view.getByTestId('mfa-request-button'));
    await waitFor(() => expect(view.getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-otp-input'), '654321');
    fireEvent.changeText(view.getByTestId('c2c-claim-agent-pin-input'), '1234');
    fireEvent.press(view.getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.agentCashToCashClaim).toHaveBeenCalledTimes(2);
    expect(mockApi.agentCashToCashClaim.mock.calls[1][0]).toMatchObject({
      idempotencyKey: firstIdempotencyKey,
      redemptionMethod: 'AGENT_CASH',
      mfaChallengeId: 'mfa-2',
      otp: '654321',
    });
    view.unmount();
    queryClient.clear();
  });

  test('AgentReceipt includes VAT on Cash-to-Cash send receipts and AGENT counterparty / failureMessage / expired guidance on history receipts', () => {
    const c2cResult: AgentCashToCashResult = {
      status: 'COMPLETED',
      transferId: '55555555-5555-4555-8555-555555555555',
      journalId: '66666666-6666-4666-8666-666666666666',
      agentId: '11111111-1111-4111-8111-111111111111',
      beneficiaryPhone: '08030000099',
      principalMinor: '500000',
      feeMinor: '10000',
      vatMinor: '750',
      totalMinor: '510750',
      amountMinor: '500000',
      currency: 'NGN',
      idempotencyKey: 'idem-c2c-vat',
      requestHash: 'hash-vat',
      replayed: false,
      reference: 'C2C-VAT-1',
      createdAt: '2026-10-26T10:00:00.000Z',
    };
    const sendReceipt = receiptFromCashToCashResult(c2cResult);
    expect(sendReceipt.lines).toEqual(
      expect.arrayContaining([
        { label: 'Fee', value: '₦100.00 NGN' },
        { label: 'VAT', value: '₦7.50 NGN' },
        { label: 'Total debited', value: '₦5,107.50 NGN' },
      ]),
    );

    const expiredHistoryRow: AgentHistoryItem = {
      id: 'hist-expired-1',
      type: 'CASH_TO_CASH',
      status: 'EXPIRED',
      amountMinor: '500000',
      currency: 'NGN',
      direction: 'CREDIT',
      createdAt: '2026-10-25T09:00:00.000Z',
      completedAt: null,
      reference: 'C2C-EXP-99',
      narration: null,
      feeMinor: '0',
      counterparty: { type: 'AGENT' },
      commission: null,
      failureCode: 'TRANSFER_EXPIRED',
      failureMessage: 'Transfer expired unredeemed after window elapsed',
    };
    const histReceipt = receiptFromHistoryItem(expiredHistoryRow);
    expect(histReceipt.stateTone).toBe('warning');
    expect(histReceipt.lines).toEqual(
      expect.arrayContaining([
        { label: 'Counterparty', value: 'MonieNaija Agent' },
        { label: 'Status detail', value: 'Transfer expired unredeemed after window elapsed' },
      ]),
    );
    expect(histReceipt.footerNote).toContain('expired before beneficiary redemption');
  });

  test('TransactionsScreen surfaces overflow Load more errors and TransactionReceiptScreen walks past page 1 on cache miss', async () => {
    const first100 = Array.from({ length: 100 }, (_, idx) => ({
      id: `item-${idx + 1}`,
      type: 'CASH_IN',
      status: 'COMPLETED',
      amountMinor: '10000',
      currency: 'NGN',
      direction: 'DEBIT',
      createdAt: '2026-10-26T08:00:00.000Z',
      completedAt: '2026-10-26T08:00:01.000Z',
      reference: `REF-${idx + 1}`,
      narration: null,
      feeMinor: '0',
      counterparty: { type: 'CUSTOMER' as const },
      commission: null,
      failureCode: null,
      failureMessage: null,
    }));

    mockApi.getAgentTransactions
      .mockResolvedValueOnce({
        items: first100.slice(0, 20),
        pagination: { page: 1, limit: 20, total: 105, totalPages: 6, hasNextPage: true },
      })
      .mockResolvedValueOnce({
        items: first100.slice(0, 40),
        pagination: { page: 1, limit: 40, total: 105, totalPages: 3, hasNextPage: true },
      })
      .mockResolvedValueOnce({
        items: first100.slice(0, 60),
        pagination: { page: 1, limit: 60, total: 105, totalPages: 2, hasNextPage: true },
      })
      .mockResolvedValueOnce({
        items: first100.slice(0, 80),
        pagination: { page: 1, limit: 80, total: 105, totalPages: 2, hasNextPage: true },
      })
      .mockResolvedValueOnce({
        items: first100,
        pagination: { page: 1, limit: 100, total: 105, totalPages: 2, hasNextPage: true },
      })
      .mockRejectedValueOnce(makeApiError('Gateway timeout', 504));

    const listClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    mockRoute = { key: 'tx', name: 'Transactions', params: {} };
    const txView = render(
      <QueryClientProvider client={listClient}>
        <TransactionsScreen />
      </QueryClientProvider>,
    );

    // Grow pageLimit 20 -> 40 -> 60 -> 80 -> 100, then page 2 overflow fails
    for (let step = 1; step <= 5; step += 1) {
      await waitFor(() => expect(mockApi.getAgentTransactions).toHaveBeenCalledTimes(step));
      await waitFor(() => expect(txView.getByTestId('history-load-more')).toBeTruthy());
      fireEvent.press(txView.getByTestId('history-load-more'));
    }

    await waitFor(() => {
      expect(txView.getByTestId('history-overflow-error').props.children).toContain(
        'temporarily unavailable',
      );
    });
    expect(txView.getAllByText(/Cash→Wallet/).length).toBeGreaterThan(0);
    txView.unmount();
    listClient.clear();

    // Now test TransactionReceiptScreen bounded multi-page cache-miss reload (finds item on page 2)
    const page2Target: AgentHistoryItem = {
      id: 'item-page-2-target',
      type: 'CASH_OUT',
      status: 'COMPLETED',
      amountMinor: '300000',
      currency: 'NGN',
      direction: 'CREDIT',
      createdAt: '2026-10-20T12:00:00.000Z',
      completedAt: '2026-10-20T12:00:02.000Z',
      reference: 'W2C-PAGE2-777',
      narration: null,
      feeMinor: '0',
      counterparty: { type: 'CUSTOMER' },
      commission: null,
      failureCode: null,
      failureMessage: null,
    };

    mockApi.getAgentTransactions
      .mockResolvedValueOnce({
        items: first100,
        pagination: { page: 1, limit: 100, total: 101, totalPages: 2, hasNextPage: true },
      })
      .mockResolvedValueOnce({
        items: [page2Target],
        pagination: { page: 2, limit: 100, total: 101, totalPages: 2, hasNextPage: false },
      });

    const receiptClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    mockRoute = {
      key: 'rcp',
      name: 'TransactionReceipt',
      params: { itemId: 'item-page-2-target', filter: undefined },
    };
    const rcpView = render(
      <QueryClientProvider client={receiptClient}>
        <TransactionReceiptScreen />
      </QueryClientProvider>,
    );

    expect(rcpView.getByTestId('history-receipt-missing')).toBeTruthy();
    fireEvent.press(rcpView.getByTestId('history-receipt-reload'));

    await waitFor(() => {
      expect(rcpView.getByTestId('history-receipt')).toBeTruthy();
      expect(rcpView.getByText('W2C-PAGE2-777')).toBeTruthy();
    });
    rcpView.unmount();
    receiptClient.clear();
  });
});
