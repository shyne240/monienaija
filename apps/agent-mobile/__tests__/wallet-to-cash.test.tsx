import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { WalletToCashRecipientScreen } from '../src/screens/authenticated/cash-out/WalletToCashRecipientScreen';
import { WalletToCashAmountScreen } from '../src/screens/authenticated/cash-out/WalletToCashAmountScreen';
import { WalletToCashConfirmScreen } from '../src/screens/authenticated/cash-out/WalletToCashConfirmScreen';
import { WalletToCashSuccessScreen } from '../src/screens/authenticated/cash-out/WalletToCashSuccessScreen';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import {
  describeApiError,
  describeCashOutError,
  type ResolvedCustomerRecipientView,
  type AgentCashOutResult,
  type AgentMfaChallenge,
} from '../src/services/agent-api';
import {
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  savePendingAgentOperation,
} from '../src/services/pending-operation';

jest.mock('../src/services/agent-api', () => ({
  resolveCustomerRecipient: jest.fn(),
  requestAgentMfaChallenge: jest.fn(),
  agentCashOut: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
  describeCashOutError: jest.requireActual('../src/services/agent-api').describeCashOutError,
  isAmbiguousOperationOutcome: jest.requireActual('../src/services/agent-api').isAmbiguousOperationOutcome,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveCustomerRecipient: jest.Mock;
  requestAgentMfaChallenge: jest.Mock;
  agentCashOut: jest.Mock;
};

const mockNavigate = jest.fn();
const mockReset = jest.fn();
let mockRoute: any = { key: 'k', name: 'route', params: {} };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, reset: mockReset }),
  useRoute: () => mockRoute,
}));

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

const customerRecipient: ResolvedCustomerRecipientView = {
  ownerType: 'CUSTOMER',
  customerId: 'cust-uuid-12345',
  receivingNumber: '8000000001',
  display: 'Ada Nnaji',
  status: 'ACTIVE',
};

const mfaChallenge: AgentMfaChallenge = {
  challengeId: 'mfa-challenge-uuid-777',
  customerId: 'cust-uuid-12345',
  purpose: 'WALLET_TO_CASH',
  deliveryChannel: 'SMS',
  destinationMasked: '*******0001',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  ttlSeconds: 300,
  issuedAt: new Date().toISOString(),
  delivered: true,
};

const cashOutResult: AgentCashOutResult = {
  status: 'COMPLETED',
  journalId: 'internal-journal-uuid-9',
  agentId: 'internal-agent-uuid-1',
  customerId: 'cust-uuid-12345',
  amountMinor: '300000',
  currency: 'NGN',
  idempotencyKey: 'w2c-test-idemp-1',
  requestHash: 'internal-request-hash-w2c',
  replayed: false,
  reference: 'CASH_OUT-w2c-test-idemp-1',
  createdAt: '2026-10-02T12:00:00.000Z',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Wallet→Cash — Step 1: Customer Identification Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('valid customer number resolves and renders authoritative identity (no internal customerId)', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId, getByText, queryByText } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '8000000001');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    await waitFor(() => expect(getByTestId('w2c-customer-identity-card')).toBeTruthy());
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();
    expect(getByText('Wallet status: ACTIVE')).toBeTruthy();
    // Internal customerId is not rendered:
    expect(queryByText('cust-uuid-12345')).toBeNull();
  });

  test('not found customer (404) shows sanitized user-friendly error', async () => {
    mockApi.resolveCustomerRecipient.mockRejectedValue(apiError('Not found', 404));
    const { getByTestId, getByText, queryByTestId } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '8000000999');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    await waitFor(() =>
      expect(
        getByText('Customer not found. Wallet→Cash requires an active customer wallet.'),
      ).toBeTruthy(),
    );
    expect(queryByTestId('w2c-customer-identity-card')).toBeNull();
  });

  test('invalid phone format blocked client-side before API call', () => {
    const { getByTestId, getByText } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '123');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    expect(getByText(/10-digit MonieNaija receiving number/)).toBeTruthy();
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();
  });

  test('AGENT recipient is ineligible for Wallet→Cash (fail-closed, no continue)', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue({
      ...customerRecipient,
      ownerType: 'AGENT',
      display: 'Agent Outlet',
    });
    const { getByTestId, getByText, queryByTestId } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '8000000002');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    await waitFor(() => expect(getByTestId('w2c-customer-ineligible')).toBeTruthy());
    expect(getByText(/Only Customer wallets can perform Wallet→Cash/)).toBeTruthy();
    expect(queryByTestId('w2c-recipient-continue')).toBeNull();
  });

  test('INACTIVE/SUSPENDED customer is ineligible (fail-closed)', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue({
      ...customerRecipient,
      status: 'SUSPENDED',
    });
    const { getByTestId, getByText, queryByTestId } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '8000000003');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    await waitFor(() => expect(getByTestId('w2c-customer-inactive')).toBeTruthy());
    expect(
      getByText(/This customer wallet is not active and cannot perform cash-out/),
    ).toBeTruthy();
    expect(queryByTestId('w2c-recipient-continue')).toBeNull();
  });

  test('continue navigates to amount with customer recipient payload', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId } = wrap(<WalletToCashRecipientScreen />);

    fireEvent.changeText(getByTestId('w2c-recipient-input'), '8000000001');
    fireEvent.press(getByTestId('w2c-recipient-verify-button'));

    await waitFor(() => expect(getByTestId('w2c-recipient-continue')).toBeTruthy());
    fireEvent.press(getByTestId('w2c-recipient-continue'));

    expect(mockNavigate).toHaveBeenCalledWith('WalletToCashAmount', {
      customer: customerRecipient,
    });
  });
});

describe('Wallet→Cash — Step 2: Amount Entry Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k',
      name: 'WalletToCashAmount',
      params: { customer: customerRecipient },
    };
  });

  test('blocks zero, negative, malformed, and >2dp amounts client-side', () => {
    const { getByTestId, getByText } = wrap(<WalletToCashAmountScreen />);

    fireEvent.changeText(getByTestId('w2c-amount-input'), '0');
    fireEvent.press(getByTestId('w2c-amount-continue'));
    expect(getByText(/greater than zero/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('w2c-amount-input'), '-100');
    fireEvent.press(getByTestId('w2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('w2c-amount-input'), '50.123');
    fireEvent.press(getByTestId('w2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('w2c-amount-input'), 'invalid');
    fireEvent.press(getByTestId('w2c-amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('valid amount navigates to confirm with idempotency key starting with w2c-', async () => {
    const { getByTestId, getByText } = wrap(<WalletToCashAmountScreen />);

    fireEvent.changeText(getByTestId('w2c-amount-input'), '3000');
    expect(getByText(/Customer will withdraw ₦3,000.00 NGN/)).toBeTruthy();

    fireEvent.press(getByTestId('w2c-amount-continue'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

    const [screen, params] = mockNavigate.mock.calls[0] as any[];
    expect(screen).toBe('WalletToCashConfirm');
    expect(params.customer).toEqual(customerRecipient);
    expect(params.amountMinor).toBe('300000');
    expect(params.idempotencyKey).toMatch(/^w2c-/);
  });
});

describe('Wallet→Cash — Step 3: Confirmation & Multi-party Authorization', () => {
  const params = {
    customer: customerRecipient,
    amountMinor: '300000',
    idempotencyKey: 'w2c-test-idemp-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { key: 'k', name: 'WalletToCashConfirm', params };
  });

  test('summary displays authoritative customer identity and amount without client-side fee math', () => {
    const { getByText, getByTestId } = wrap(<WalletToCashConfirmScreen />);
    expect(getByTestId('w2c-confirm-summary-card')).toBeTruthy();
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();
    expect(getByText('₦3,000.00 NGN')).toBeTruthy();
  });

  test('client-side validation: blocks submit if MFA challenge has not been requested', async () => {
    const { getByTestId, getByText } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    expect(getByText('Send customer verification code first')).toBeTruthy();
    expect(mockApi.agentCashOut).not.toHaveBeenCalled();
  });

  test('client-side validation: blocks submit if OTP or PINs are missing', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    const { getByTestId, getByText } = wrap(<WalletToCashConfirmScreen />);

    // Request MFA challenge
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    // Submit with empty OTP
    fireEvent.press(getByTestId('w2c-confirm-submit'));
    expect(getByText('Enter the customer one-time verification code')).toBeTruthy();
    expect(mockApi.agentCashOut).not.toHaveBeenCalled();

    // Fill OTP, leave Customer PIN empty
    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.press(getByTestId('w2c-confirm-submit'));
    expect(getByText('Enter the customer transaction PIN')).toBeTruthy();
    expect(mockApi.agentCashOut).not.toHaveBeenCalled();

    // Fill Customer PIN, leave Agent PIN empty
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.press(getByTestId('w2c-confirm-submit'));
    expect(getByText('Enter your agent transaction PIN')).toBeTruthy();
    expect(mockApi.agentCashOut).not.toHaveBeenCalled();
  });

  test('correct request construction with all multi-party credentials and single idempotency key', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockResolvedValue(cashOutResult);
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    // Request MFA
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(mockApi.agentCashOut).toHaveBeenCalledWith({
        customerId: 'cust-uuid-12345',
        customerPin: '1111',
        mfaChallengeId: 'mfa-challenge-uuid-777',
        otp: '123456',
        amountMinor: '300000',
        currency: 'NGN',
        idempotencyKey: 'w2c-test-idemp-1',
        agentPin: '2222',
      }),
    );
  });

  test('duplicate-submit prevention while in-flight', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    let resolveIt: (v: any) => void = () => {};
    mockApi.agentCashOut.mockImplementation(
      () =>
        new Promise((res) => {
          resolveIt = res;
        }),
    );
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() => expect(mockApi.agentCashOut).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('w2c-confirm-submit')); // Disabled in flight
    expect(mockApi.agentCashOut).toHaveBeenCalledTimes(1);

    await act(async () => resolveIt(cashOutResult));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
  });

  test('server error translations: customer PIN failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('Customer PIN invalid', 401));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'Customer transaction PIN is invalid. Ask the customer to check and try again.',
      ),
    );
    // Credentials wiped from state on error:
    expect(getByTestId('w2c-otp-input').props.value).toBe('');
    expect(getByTestId('w2c-customer-pin-input').props.value).toBe('');
    expect(getByTestId('w2c-agent-pin-input').props.value).toBe('');
  });

  test('server error translations: agent PIN failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('Agent PIN invalid: PIN_INVALID', 401));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '9999');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'Agent transaction PIN is incorrect. Try again.',
      ),
    );
  });

  test('server error translations: OTP invalid failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('OTP invalid: MFA_INVALID_OTP', 400));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '000000');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'Customer verification code (OTP) is invalid. Check the code and try again.',
      ),
    );
  });

  test('server error translations: OTP expired failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('OTP expired', 400));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'Customer verification code has expired. Request a new code.',
      ),
    );
  });

  test('server error translations: insufficient customer balance', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('Insufficient available balance', 409));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'Customer has insufficient available balance for this cash-out.',
      ),
    );
  });

  test('server error translations: authorization failure (403)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('Agent not permitted: AGENT_SUSPENDED', 403));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'You are not permitted to perform Wallet→Cash cash-outs.',
      ),
    );
  });

  test('server error translations: 500 internal error is sanitized', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockRejectedValue(apiError('Database deadlock at tx_34', 500));
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'The service is temporarily unavailable. Please retry.',
      ),
    );
  });

  test('server error translations: network failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    const netErr = new Error('network down');
    (netErr as any).name = 'NetworkError';
    mockApi.agentCashOut.mockRejectedValue(netErr);
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() =>
      expect(getByTestId('w2c-confirm-error').props.children).toBe(
        'No network connection. Check your connection and retry.',
      ),
    );
  });

  test('success invalidates financial position, transactions, and history queries', async () => {
    useAuthStore.setState({ agentId: 'agent-uuid-1' });
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockResolvedValue(cashOutResult);
    const { client, getByTestId } = wrap(<WalletToCashConfirmScreen />);
    const spy = jest.spyOn(client, 'invalidateQueries');

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-financial-position', 'agent-uuid-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-transactions', 'agent-uuid-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-history', 'agent-uuid-1'] });
  });

  test('CRITICAL SECURITY: customer PIN, agent PIN, and OTP are never persisted or logged', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashOut.mockResolvedValue(cashOutResult);
    const { getByTestId } = wrap(<WalletToCashConfirmScreen />);

    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('w2c-otp-input'), '654321');
    fireEvent.changeText(getByTestId('w2c-customer-pin-input'), '7777');
    fireEvent.changeText(getByTestId('w2c-agent-pin-input'), '8888');
    fireEvent.press(getByTestId('w2c-confirm-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('654321');
        expect(String(call.join(' '))).not.toContain('7777');
        expect(String(call.join(' '))).not.toContain('8888');
      }
    }
    for (const call of setSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('654321');
      expect(String(call.join(' '))).not.toContain('7777');
      expect(String(call.join(' '))).not.toContain('8888');
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('Wallet→Cash — Step 4: Success, Physical Cash Handover Guidance & Receipt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k',
      name: 'WalletToCashSuccess',
      params: {
        result: cashOutResult,
        amountMinor: '300000',
        customerDisplay: 'Ada Nnaji',
        customerReceivingNumber: '8000000001',
      },
    };
  });

  test('prominently displays physical cash handover card with exact cash amount to hand over', () => {
    const { getByTestId, getByText } = wrap(<WalletToCashSuccessScreen />);

    expect(getByTestId('w2c-handover-card')).toBeTruthy();
    expect(getByTestId('w2c-handover-amount').props.children).toBe('₦3,000.00 NGN');
    expect(getByText('Wallet Debited — Hand Over Cash')).toBeTruthy();
    expect(getByText(/Pay the customer the exact amount above in physical banknotes/)).toBeTruthy();
  });

  test('renders shared receipt with zero internal database UUIDs', () => {
    const { getByTestId, getByText, queryByText } = wrap(<WalletToCashSuccessScreen />);

    const receipt = getByTestId('w2c-receipt');
    expect(receipt).toBeTruthy();
    expect(getByText('Wallet→Cash Receipt')).toBeTruthy();
    expect(getByText('COMPLETED')).toBeTruthy();
    expect(getByText('CASH_OUT-w2c-test-idemp-1')).toBeTruthy();
    expect(within(receipt).getByText('₦3,000.00 NGN')).toBeTruthy();
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();

    // Internal UUIDs never rendered:
    expect(queryByText(/internal-journal-uuid-9/)).toBeNull();
    expect(queryByText(/internal-agent-uuid-1/)).toBeNull();
    expect(queryByText(/cust-uuid-12345/)).toBeNull();
    expect(queryByText(/internal-request-hash-w2c/)).toBeNull();
  });

  test('replayed result renders honest REPLAYED status and guidance', () => {
    const replayedResult = { ...cashOutResult, status: 'REPLAYED' as const, replayed: true };
    mockRoute = {
      key: 'k',
      name: 'WalletToCashSuccess',
      params: {
        result: replayedResult,
        amountMinor: '300000',
        customerDisplay: 'Ada Nnaji',
        customerReceivingNumber: '8000000001',
      },
    };

    const { getByText } = wrap(<WalletToCashSuccessScreen />);
    expect(getByText('Already recorded')).toBeTruthy();
    expect(getByText('REPLAYED')).toBeTruthy();
    expect(getByText(/This cash-out was already completed/)).toBeTruthy();
  });

  test('receipt share text contains receipt details and zero secrets or internal IDs', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValueOnce({ action: 'sharedAction' } as never);
    const { getByTestId } = wrap(<WalletToCashSuccessScreen />);

    fireEvent.press(getByTestId('receipt-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    const message = (shareSpy.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain('Wallet→Cash Receipt');
    expect(message).toContain('Status: COMPLETED');
    expect(message).toContain('Amount cashed out: ₦3,000.00 NGN');
    expect(message).toContain('Transaction reference: CASH_OUT-w2c-test-idemp-1');
    expect(message).toContain('Ada Nnaji');
    expect(message).toContain('8000000001');

    // Internal UUIDs not present in share text:
    expect(message).not.toContain('internal-journal-uuid-9');
    expect(message).not.toContain('internal-agent-uuid-1');
    expect(message).not.toContain('cust-uuid-12345');
    expect(message).not.toContain('internal-request-hash-w2c');

    shareSpy.mockRestore();
  });

  test('navigation buttons reset cleanly to History, New, and Home', () => {
    const { getByTestId } = wrap(<WalletToCashSuccessScreen />);

    fireEvent.press(getByTestId('w2c-success-history'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Transactions' }],
    });

    fireEvent.press(getByTestId('w2c-success-new'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'WalletToCash' }],
    });

    fireEvent.press(getByTestId('w2c-success-done'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  });
});

// V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01 — the process-kill recovery fix. Mirrors the
// Cash→Wallet coverage: a fresh Confirm instance after a simulated restart must reuse the
// durable SecureStorage-backed pending-operation record (not a freshly-minted route-param key),
// across the full multi-party OTP + customer PIN + agent PIN authorization flow.
describe('Wallet→Cash — Idempotency-Key durability across a simulated process kill', () => {
  const agentId = 'agent-persist-w2c';
  const customer = customerRecipient; // customerId 'cust-uuid-12345', receivingNumber '8000000001'

  const fillAndSubmit = async (screen: ReturnType<typeof wrap>) => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    fireEvent.press(screen.getByTestId('mfa-request-button'));
    await waitFor(() => expect(screen.getByTestId('mfa-ready-title')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('w2c-otp-input'), '123456');
    fireEvent.changeText(screen.getByTestId('w2c-customer-pin-input'), '1111');
    fireEvent.changeText(screen.getByTestId('w2c-agent-pin-input'), '2222');
    fireEvent.press(screen.getByTestId('w2c-confirm-submit'));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    useAuthStore.setState({ agentId });
    await clearPendingAgentOperation(agentId, 'CASH_OUT');
  });

  test('1. an ambiguous outcome (NetworkError) durably persists the pending operation, not just in-memory', async () => {
    mockRoute = {
      key: 'k1',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '300000', idempotencyKey: 'w2c-persist-k1' },
    };
    const networkErr = new Error('fetch failed');
    (networkErr as any).name = 'NetworkError';
    mockApi.agentCashOut.mockRejectedValueOnce(networkErr);

    const screen = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(screen);
    await waitFor(() => expect(mockApi.agentCashOut).toHaveBeenCalledTimes(1));

    const persisted = await loadPendingAgentOperation(agentId, 'CASH_OUT');
    expect(persisted).not.toBeNull();
    expect(persisted?.idempotencyKey).toBe('w2c-persist-k1');
    expect(persisted?.counterpartyId).toBe('cust-uuid-12345');
    expect(persisted?.amountMinor).toBe('300000');
  });

  test('2. a fresh Confirm instance after a simulated restart reuses the persisted key, not the freshly-minted route-param one', async () => {
    // Precondition: left behind by an earlier ambiguous attempt (per test 1 above).
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_OUT',
      idempotencyKey: 'w2c-restart-original',
      counterpartyId: 'cust-uuid-12345',
      amountMinor: '300000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    // "Reopen the app": a fresh Confirm instance with a BRAND NEW route-param key, exactly
    // what WalletToCashAmountScreen would mint since its in-memory useRef cannot have
    // survived the process kill.
    mockApi.agentCashOut.mockResolvedValueOnce(cashOutResult);
    mockRoute = {
      key: 'k2',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '300000', idempotencyKey: 'w2c-restart-FRESH-K2' },
    };
    const second = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(second);
    await waitFor(() => expect(mockApi.agentCashOut).toHaveBeenCalledTimes(1));

    expect(mockApi.agentCashOut.mock.calls[0][0].idempotencyKey).toBe('w2c-restart-original');
  });

  test('3. success clears the persisted operation', async () => {
    mockRoute = {
      key: 'k1',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '300000', idempotencyKey: 'w2c-success-clear' },
    };
    mockApi.agentCashOut.mockResolvedValueOnce(cashOutResult);
    const screen = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(screen);
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    await waitFor(async () => expect(await loadPendingAgentOperation(agentId, 'CASH_OUT')).toBeNull());
  });

  test('4. a definitive rejection (4xx) clears the persisted operation — a later attempt gets a clean new key', async () => {
    mockRoute = {
      key: 'k1',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '300000', idempotencyKey: 'w2c-definitive-reject' },
    };
    mockApi.agentCashOut.mockRejectedValueOnce(apiError('Customer PIN invalid', 401));
    const first = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(first);
    await waitFor(() =>
      expect(first.getByTestId('w2c-confirm-error').props.children).toBe(
        'Customer transaction PIN is invalid. Ask the customer to check and try again.',
      ),
    );
    await waitFor(async () => expect(await loadPendingAgentOperation(agentId, 'CASH_OUT')).toBeNull());
    first.unmount();

    mockApi.agentCashOut.mockResolvedValueOnce(cashOutResult);
    mockRoute = {
      key: 'k2',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '300000', idempotencyKey: 'w2c-clean-retry-key' },
    };
    const second = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(second);
    await waitFor(() => expect(mockApi.agentCashOut).toHaveBeenCalledTimes(2));
    expect(mockApi.agentCashOut.mock.calls[1][0].idempotencyKey).toBe('w2c-clean-retry-key');
  });

  test('5. a persisted operation for a DIFFERENT amount is never reused — no fuzzy attribution', async () => {
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_OUT',
      idempotencyKey: 'w2c-amount-a',
      counterpartyId: 'cust-uuid-12345',
      amountMinor: '300000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    mockApi.agentCashOut.mockResolvedValueOnce({ ...cashOutResult, amountMinor: '700000' });
    mockRoute = {
      key: 'k2',
      name: 'WalletToCashConfirm',
      params: { customer, amountMinor: '700000', idempotencyKey: 'w2c-amount-b-own-key' },
    };
    const second = wrap(<WalletToCashConfirmScreen />);
    await fillAndSubmit(second);
    await waitFor(() => expect(mockApi.agentCashOut).toHaveBeenCalledTimes(1));
    expect(mockApi.agentCashOut.mock.calls[0][0].idempotencyKey).toBe('w2c-amount-b-own-key');
  });
});
