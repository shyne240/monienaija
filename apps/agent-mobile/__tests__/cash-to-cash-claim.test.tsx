import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CashToCashClaimRecipientScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimRecipientScreen';
import { CashToCashClaimConfirmScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimConfirmScreen';
import { CashToCashClaimSuccessScreen } from '../src/screens/authenticated/cash-to-cash/CashToCashClaimSuccessScreen';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import {
  describeApiError,
  describeCashToCashClaimError,
  type ResolvedCustomerRecipientView,
  type AgentCashToCashClaimResult,
  type AgentMfaChallenge,
} from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  resolveCustomerRecipient: jest.fn(),
  requestAgentMfaChallenge: jest.fn(),
  agentCashToCashClaim: jest.fn(),
  getAgentCashToCashClaim: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
  describeCashToCashClaimError: jest.requireActual('../src/services/agent-api').describeCashToCashClaimError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveCustomerRecipient: jest.Mock;
  requestAgentMfaChallenge: jest.Mock;
  agentCashToCashClaim: jest.Mock;
  getAgentCashToCashClaim: jest.Mock;
};

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockNavigation = { navigate: mockNavigate, reset: mockReset };
let mockRoute: any = { key: 'k', name: 'route', params: {} };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

async function waitForClaimForm(getByTestId: (id: string) => unknown) {
  await waitFor(() => expect(getByTestId('c2c-claim-mfa-card')).toBeTruthy());
}

const customerRecipient: ResolvedCustomerRecipientView = {
  ownerType: 'CUSTOMER',
  customerId: 'cust-uuid-claim-12345',
  receivingNumber: '8012345678',
  display: 'Emeka Obi',
  status: 'ACTIVE',
};

const mfaChallenge: AgentMfaChallenge = {
  challengeId: 'mfa-challenge-claim-uuid-888',
  customerId: 'cust-uuid-claim-12345',
  purpose: 'CASH_TO_CASH_CLAIM',
  deliveryChannel: 'SMS',
  destinationMasked: '*******5678',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  ttlSeconds: 300,
  issuedAt: new Date().toISOString(),
  delivered: true,
};

const claimResult: AgentCashToCashClaimResult = {
  status: 'COMPLETED',
  transferId: 'c2c-transfer-uuid-999',
  journalId: 'internal-claim-journal-uuid-9',
  beneficiaryPhone: '8012345678',
  principalMinor: '450000',
  currency: 'NGN',
  amountMinor: '450000',
  claimantCustomerId: 'cust-uuid-claim-12345',
  redemptionMethod: 'CUSTOMER_WALLET',
  idempotencyKey: 'c2c-claim-key-1',
  requestHash: 'internal-request-hash-claim',
  replayed: false,
  reference: 'CASH_TO_CASH_CLAIM-c2c-claim-key-1',
  claimedAt: '2026-10-02T14:30:00.000Z',
};

const cashClaimResult: AgentCashToCashClaimResult = {
  ...claimResult,
  redemptionMethod: 'AGENT_CASH',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Cash→Cash Claim — Step 1: Beneficiary Identification & Transfer ID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('valid beneficiary phone and transfer ID resolves and renders identity', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId, getByText, queryByText } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '08012345678');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), '12345678-1234-1234-1234-1234567890ab');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    await waitFor(() => expect(getByTestId('c2c-claim-customer-card')).toBeTruthy());
    expect(getByText('Emeka Obi')).toBeTruthy();
    expect(getByText('8012345678')).toBeTruthy();
    expect(getByText('Account status: ACTIVE')).toBeTruthy();
    // Internal customerId is never displayed:
    expect(queryByText('cust-uuid-claim-12345')).toBeNull();
  });

  test('invalid phone format blocked client-side before API call', () => {
    const { getByTestId, getByText } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '123');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), '12345678-1234-1234-1234-1234567890ab');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    expect(getByText(/Enter a valid 10-digit Nigerian phone number/)).toBeTruthy();
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();
  });

  test('invalid transfer ID format (non-UUID) blocked client-side', () => {
    const { getByTestId, getByText } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '08012345678');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), 'not-a-valid-uuid');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    expect(getByText(/Enter a valid Transfer ID \(UUID format\)/)).toBeTruthy();
    expect(mockApi.resolveCustomerRecipient).not.toHaveBeenCalled();
  });

  test('not found beneficiary customer (404) shows sanitized user-friendly error', async () => {
    mockApi.resolveCustomerRecipient.mockRejectedValue(apiError('Customer not found', 404));
    const { getByTestId, getByText, queryByTestId } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '08099999999');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), '12345678-1234-1234-1234-1234567890ab');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    await waitFor(() =>
      expect(
        getByText('Beneficiary customer not found. An active customer account is required to claim.'),
      ).toBeTruthy(),
    );
    expect(queryByTestId('c2c-claim-customer-card')).toBeNull();
  });

  test('ineligible recipient (AGENT) is blocked fail-closed', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue({
      ...customerRecipient,
      ownerType: 'AGENT',
      display: 'Other Agent',
    });
    const { getByTestId, getByText, queryByTestId } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '08012345678');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), '12345678-1234-1234-1234-1234567890ab');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    await waitFor(() => expect(getByTestId('c2c-claim-customer-ineligible')).toBeTruthy());
    expect(getByText(/Only Customer accounts can claim Cash→Cash transfers/)).toBeTruthy();
    expect(queryByTestId('c2c-claim-continue')).toBeNull();
  });

  test('continue navigates to confirm screen with safe parameters', async () => {
    mockApi.resolveCustomerRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId } = wrap(<CashToCashClaimRecipientScreen />);

    fireEvent.changeText(getByTestId('c2c-claim-phone-input'), '08012345678');
    fireEvent.changeText(getByTestId('c2c-claim-transfer-id-input'), '12345678-1234-1234-1234-1234567890ab');
    fireEvent.press(getByTestId('c2c-claim-verify-button'));

    await waitFor(() => expect(getByTestId('c2c-claim-continue')).toBeTruthy());
    fireEvent.press(getByTestId('c2c-claim-continue'));

    expect(mockNavigate).toHaveBeenCalledWith('CashToCashClaimConfirm', {
      customer: customerRecipient,
      transferId: '12345678-1234-1234-1234-1234567890ab',
      beneficiaryPhone: '8012345678',
    });
  });
});

describe('Cash→Cash Claim — Step 2: Confirmation & Multi-party Verification', () => {
  const params = {
    customer: customerRecipient,
    transferId: 'c2c-transfer-uuid-999',
    beneficiaryPhone: '8012345678',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ agentId: 'agent-uuid-claim-1' });
    mockApi.getAgentCashToCashClaim.mockRejectedValue(apiError('Cash-to-Cash claim not found for this Agent', 404));
    mockRoute = { key: 'k', name: 'CashToCashClaimConfirm', params };
  });

  test('summary displays beneficiary details and transfer ID', () => {
    const { getByText, getByTestId } = wrap(<CashToCashClaimConfirmScreen />);
    expect(getByTestId('c2c-claim-summary-card')).toBeTruthy();
    expect(getByText('Emeka Obi')).toBeTruthy();
    expect(getByText('8012345678')).toBeTruthy();
    expect(getByText('c2c-transfer-uuid-999')).toBeTruthy();
  });

  test('recovers an already committed claim instead of exposing a second claim form', async () => {
    const replayedResult = { ...claimResult, status: 'REPLAYED' as const, replayed: true };
    mockApi.getAgentCashToCashClaim.mockResolvedValue(replayedResult);
    const { queryByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitFor(() => expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{
        name: 'CashToCashClaimSuccess',
        params: {
          result: replayedResult,
          customerDisplay: 'Emeka Obi',
          customerReceivingNumber: '8012345678',
        },
      }],
    }));
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();
    expect(queryByTestId('c2c-claim-mfa-card')).toBeNull();
  });

  test('keeps claim submission blocked when recovery status is unknown, then retries safely', async () => {
    mockApi.getAgentCashToCashClaim.mockRejectedValueOnce(apiError('Recovery unavailable', 503));
    const { getByTestId, queryByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitFor(() => expect(getByTestId('c2c-claim-recovery-retry')).toBeTruthy());
    expect(queryByTestId('c2c-claim-mfa-card')).toBeNull();
    expect(queryByTestId('c2c-claim-submit')).toBeNull();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('c2c-claim-recovery-retry'));
    await waitFor(() => expect(getByTestId('c2c-claim-mfa-card')).toBeTruthy());
    expect(mockApi.getAgentCashToCashClaim).toHaveBeenCalledTimes(2);
  });

  test('blocks submission if MFA challenge has not been requested', async () => {
    const { getByTestId, getByText } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    expect(getByText('Send beneficiary verification code first')).toBeTruthy();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();
  });

  test('blocks submission if transfer code or OTP are missing', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    const { getByTestId, getByText } = wrap(<CashToCashClaimConfirmScreen />);

    // Request MFA challenge
    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    // Submit with empty transfer code
    fireEvent.press(getByTestId('c2c-claim-submit'));
    expect(getByText('Enter the secret transfer code')).toBeTruthy();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();

    // Fill transfer code, leave OTP empty
    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.press(getByTestId('c2c-claim-submit'));
    expect(getByText('Enter the customer one-time verification code')).toBeTruthy();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();
  });

  test('correct request construction with all credentials and single idempotency key', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockResolvedValue(claimResult);
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    // Request MFA
    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(mockApi.agentCashToCashClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 'c2c-transfer-uuid-999',
          beneficiaryPhone: '8012345678',
          transferCode: '87654321',
          customerId: 'cust-uuid-claim-12345',
          mfaChallengeId: 'mfa-challenge-claim-uuid-888',
          otp: '123456',
          idempotencyKey: expect.stringMatching(/^c2c-claim-/),
        }),
      ),
    );
  });

  test('Agent cash mode requires a transaction PIN and sends the method without retaining the PIN', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockResolvedValue(cashClaimResult);
    const { getByTestId, getByText } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('c2c-claim-method-cash'));
    expect(getByTestId('c2c-claim-method-cash').props.accessibilityState.checked).toBe(true);
    expect(getByText(/current approved Customer KYC assessment/)).toBeTruthy();
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));
    expect(getByText('Enter your Agent transaction PIN for cash payout')).toBeTruthy();
    expect(mockApi.agentCashToCashClaim).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('c2c-claim-agent-pin-input'), '1234');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockApi.agentCashToCashClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        redemptionMethod: 'AGENT_CASH',
        agentPin: '1234',
        transferCode: '87654321',
        otp: '123456',
      }),
    ));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(getByTestId('c2c-claim-agent-pin-input').props.value).toBe('');
    const navigationPayload = JSON.stringify(mockReset.mock.calls[0]?.[0]);
    expect(navigationPayload).not.toContain('"agentPin"');
    expect(navigationPayload).not.toContain('"agentPin":"1234"');
  });

  test('duplicate-submission protection: button disabled while in-flight', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    let resolveIt: (v: any) => void = () => {};
    mockApi.agentCashToCashClaim.mockImplementation(
      () => new Promise((res) => { resolveIt = res; }),
    );
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockApi.agentCashToCashClaim).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('c2c-claim-submit')); // Disabled in flight
    expect(mockApi.agentCashToCashClaim).toHaveBeenCalledTimes(1);

    await act(async () => resolveIt(claimResult));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
  });

  test('server error translations: invalid transfer code (401)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(apiError('Transfer code invalid', 401));
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '00000000');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Transfer code is invalid. Check the code and try again.',
      ),
    );
    // Credentials wiped from state on error:
    expect(getByTestId('c2c-claim-code-input').props.value).toBe('');
    expect(getByTestId('c2c-claim-otp-input').props.value).toBe('');
  });

  test('server error translations: transfer code locked (403)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(
      apiError('Transfer code is locked due to too many failed attempts', 403),
    );
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '00000000');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Transfer code is locked due to too many failed attempts.',
      ),
    );
  });

  test('server error translations: KYC identity not verified (403)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(
      apiError('Claimant identity not verified (KYC not APPROVED)', 403),
    );
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Beneficiary identity is not verified. Customer KYC approval is required for wallet redemption.',
      ),
    );
  });

  test('server error translations: transfer expired (409)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(
      apiError('Transfer has expired and cannot be claimed', 409),
    );
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'This Cash→Cash transfer has expired and cannot be claimed.',
      ),
    );
  });

  test('server error translations: already claimed (409)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(apiError('Transfer already claimed', 409));
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'This Cash→Cash transfer has already been claimed.',
      ),
    );
  });

  test('server error translations: OTP invalid (400)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(apiError('OTP invalid: MISMATCH', 400));
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '000000');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Customer verification code (OTP) is invalid. Check the code and try again.',
      ),
    );
  });

  test('server error translations: OTP expired (400)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(apiError('OTP expired', 400));
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Customer verification code has expired. Request a new code.',
      ),
    );
  });

  test('server error translations: beneficiary phone mismatch (400)', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(
      apiError('Beneficiary phone does not match transfer', 400),
    );
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'Beneficiary phone number does not match this transfer.',
      ),
    );
  });

  test('server error translations: 500 internal error is sanitized', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockRejectedValue(apiError('PostgreSQL constraint violation at tx_88', 500));
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'The service is temporarily unavailable. Please retry.',
      ),
    );
  });

  test('server error translations: network failure', async () => {
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    const netErr = new Error('fetch failed');
    (netErr as any).name = 'NetworkError';
    mockApi.agentCashToCashClaim.mockRejectedValue(netErr);
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() =>
      expect(getByTestId('c2c-claim-confirm-error').props.children).toBe(
        'No network connection. Check your connection and retry.',
      ),
    );
  });

  test('success invalidates financial position, transactions, and history queries', async () => {
    useAuthStore.setState({ agentId: 'agent-uuid-claim-1' });
    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockResolvedValue(claimResult);
    const { client, getByTestId } = wrap(<CashToCashClaimConfirmScreen />);
    const spy = jest.spyOn(client, 'invalidateQueries');

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '87654321');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '123456');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-financial-position', 'agent-uuid-claim-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-transactions', 'agent-uuid-claim-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-history', 'agent-uuid-claim-1'] });
  });

  test('CRITICAL SECURITY: transfer code and OTP are never persisted or logged', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.requestAgentMfaChallenge.mockResolvedValue(mfaChallenge);
    mockApi.agentCashToCashClaim.mockResolvedValue(claimResult);
    const { getByTestId } = wrap(<CashToCashClaimConfirmScreen />);

    await waitForClaimForm(getByTestId);
    fireEvent.press(getByTestId('mfa-request-button'));
    await waitFor(() => expect(getByTestId('mfa-ready-title')).toBeTruthy());

    fireEvent.changeText(getByTestId('c2c-claim-code-input'), '99887766');
    fireEvent.changeText(getByTestId('c2c-claim-otp-input'), '654321');
    fireEvent.press(getByTestId('c2c-claim-submit'));

    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('99887766');
        expect(String(call.join(' '))).not.toContain('654321');
      }
    }
    for (const call of setSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('99887766');
      expect(String(call.join(' '))).not.toContain('654321');
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('Cash→Cash Claim — Step 3: Customer-Wallet Credit Receipt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k',
      name: 'CashToCashClaimSuccess',
      params: {
        result: claimResult,
        customerDisplay: 'Emeka Obi',
        customerReceivingNumber: '8012345678',
      },
    };
  });

  test('prominently displays the Customer-wallet credit and prohibits physical cash payout', () => {
    const { getByTestId, getByText } = wrap(<CashToCashClaimSuccessScreen />);

    expect(getByTestId('c2c-claim-wallet-credit-card')).toBeTruthy();
    expect(getByTestId('c2c-claim-wallet-credit-amount').props.children).toBe('₦4,500.00 NGN');
    expect(getByText('Customer wallet credited')).toBeTruthy();
    expect(getByText(/This transaction did not pay physical cash/)).toBeTruthy();
    expect(getByText(/No physical cash handout is included in this wallet redemption/)).toBeTruthy();
  });

  test('renders shared receipt with zero internal database UUIDs or secrets', () => {
    const { getByTestId, getByText, queryByText } = wrap(<CashToCashClaimSuccessScreen />);

    const receipt = getByTestId('c2c-claim-receipt');
    expect(receipt).toBeTruthy();
    expect(getByText('Cash→Cash Claim Receipt')).toBeTruthy();
    expect(getByText('COMPLETED')).toBeTruthy();
    expect(getByText('CASH_TO_CASH_CLAIM-c2c-claim-key-1')).toBeTruthy();
    expect(within(receipt).getByText('₦4,500.00 NGN')).toBeTruthy();
    expect(getByText('Emeka Obi')).toBeTruthy();
    expect(getByText('8012345678')).toBeTruthy();

    // Internal UUIDs never rendered:
    expect(queryByText(/internal-claim-journal-uuid-9/)).toBeNull();
    expect(queryByText(/cust-uuid-claim-12345/)).toBeNull();
    expect(queryByText(/internal-request-hash-claim/)).toBeNull();
    expect(queryByText(/87654321/)).toBeNull();
  });

  test('Agent-cash receipt identifies float credit and separates the physical handover', () => {
    mockRoute = {
      key: 'k',
      name: 'CashToCashClaimSuccess',
      params: {
        result: cashClaimResult,
        customerDisplay: 'Emeka Obi',
        customerReceivingNumber: '8012345678',
      },
    };

    const { getByTestId, getByText, queryByText } = wrap(<CashToCashClaimSuccessScreen />);
    expect(getByTestId('c2c-claim-agent-float-card')).toBeTruthy();
    expect(getByTestId('c2c-claim-agent-float-amount').props.children).toBe('₦4,500.00 NGN');
    expect(getByText('Agent float credited')).toBeTruthy();
    expect(getByText('Cash→Cash Cash Payout Receipt')).toBeTruthy();
    expect(within(getByTestId('c2c-claim-receipt')).getByText('Amount credited to Agent float')).toBeTruthy();
    expect(within(getByTestId('c2c-claim-receipt')).getByText(/Physical cash handover is separate/)).toBeTruthy();
    expect(queryByText('1234')).toBeNull();
  });

  test('replayed result renders honest REPLAYED state and guidance', () => {
    const replayedResult = { ...claimResult, status: 'REPLAYED' as const, replayed: true };
    mockRoute = {
      key: 'k',
      name: 'CashToCashClaimSuccess',
      params: {
        result: replayedResult,
        customerDisplay: 'Emeka Obi',
        customerReceivingNumber: '8012345678',
      },
    };

    const { getByText } = wrap(<CashToCashClaimSuccessScreen />);
    expect(getByText('Wallet claim already recorded')).toBeTruthy();
    expect(getByText('REPLAYED')).toBeTruthy();
    expect(getByText(/recovered or repeated receipt/)).toBeTruthy();
  });

  test('receipt share text contains receipt details and zero secrets or internal IDs', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: 'sharedAction' } as never);
    const { getByTestId } = wrap(<CashToCashClaimSuccessScreen />);

    fireEvent.press(getByTestId('receipt-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());

    const message = (shareSpy.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain('Cash→Cash Claim Receipt');
    expect(message).toContain('Status: COMPLETED');
    expect(message).toContain('Amount credited to Customer wallet: ₦4,500.00 NGN');
    expect(message).toContain('Transaction reference: CASH_TO_CASH_CLAIM-c2c-claim-key-1');
    expect(message).toContain('No physical cash payout is included in this transaction.');
    expect(message).toContain('Emeka Obi');
    expect(message).toContain('8012345678');

    // Internal UUIDs not present in share text:
    expect(message).not.toContain('internal-claim-journal-uuid-9');
    expect(message).not.toContain('cust-uuid-claim-12345');
    expect(message).not.toContain('internal-request-hash-claim');

    shareSpy.mockRestore();
  });

  test('navigation buttons reset cleanly to History, New Claim, and Home', () => {
    const { getByTestId } = wrap(<CashToCashClaimSuccessScreen />);

    fireEvent.press(getByTestId('c2c-claim-success-history'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Transactions' }],
    });

    fireEvent.press(getByTestId('c2c-claim-success-new'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'CashToCashClaim' }],
    });

    fireEvent.press(getByTestId('c2c-claim-success-done'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  });
});
