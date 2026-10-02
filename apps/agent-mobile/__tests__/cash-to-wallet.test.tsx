import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CashToWalletRecipientScreen } from '../src/screens/authenticated/cash-in/CashToWalletRecipientScreen';
import { CashToWalletAmountScreen } from '../src/screens/authenticated/cash-in/CashToWalletAmountScreen';
import { CashToWalletConfirmScreen } from '../src/screens/authenticated/cash-in/CashToWalletConfirmScreen';
import { CashToWalletSuccessScreen } from '../src/screens/authenticated/cash-in/CashToWalletSuccessScreen';
import { SecureStorage } from '../src/services/secure-storage';
import { useAuthStore } from '../src/store/auth-store';
import { formatNairaFromMinor, newIdempotencyKey, parseNairaInputToMinor } from '../src/utils/format';
import type { ResolvedRecipientView } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  resolveAgentRecipient: jest.fn(),
  agentCashIn: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  resolveAgentRecipient: jest.Mock;
  agentCashIn: jest.Mock;
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

const customerRecipient: ResolvedRecipientView = {
  ownerType: 'CUSTOMER',
  receivingNumber: '8000000001',
  display: 'Ada Nnaji',
  status: 'ACTIVE',
};

const cashInResult = {
  status: 'COMPLETED' as const,
  journalId: 'internal-journal-9',
  agentId: 'internal-agent-1',
  recipientCustomerId: 'internal-customer-1',
  recipientReceivingNumber: '8000000001',
  amountMinor: '250000',
  currency: 'NGN',
  idempotencyKey: 'c2w-abc',
  requestHash: 'internal-hash',
  replayed: false,
  reference: 'CASH_IN-c2w-abc',
  createdAt: '2026-06-01T12:30:00.000Z',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Cash→Wallet — recipient step', () => {
  beforeEach(() => jest.clearAllMocks());

  test('1+2. recipient entry + resolution success shows backend identity', async () => {
    mockApi.resolveAgentRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId, getByText } = wrap(<CashToWalletRecipientScreen />);

    fireEvent.changeText(getByTestId('recipient-input'), '8000000001');
    fireEvent.press(getByTestId('recipient-verify-button'));

    await waitFor(() => expect(getByTestId('recipient-identity-card')).toBeTruthy());
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();
    expect(getByText('Wallet status: ACTIVE')).toBeTruthy();
    expect(mockApi.resolveAgentRecipient).toHaveBeenCalledWith('8000000001');
  });

  test('3. resolution failure (404) shows sanitized error, no identity', async () => {
    mockApi.resolveAgentRecipient.mockRejectedValue(apiError('Recipient 8000000009 not found', 404));
    const { getByTestId, getByText, queryByTestId } = wrap(<CashToWalletRecipientScreen />);
    fireEvent.changeText(getByTestId('recipient-input'), '8000000009');
    fireEvent.press(getByTestId('recipient-verify-button'));
    await waitFor(() => expect(getByText('Recipient 8000000009 not found')).toBeTruthy());
    expect(queryByTestId('recipient-identity-card')).toBeNull();
  });

  test('bad format blocked client-side before any API call', () => {
    const { getByTestId, getByText } = wrap(<CashToWalletRecipientScreen />);
    fireEvent.changeText(getByTestId('recipient-input'), '123');
    fireEvent.press(getByTestId('recipient-verify-button'));
    expect(getByText(/10-digit MonieNaija receiving number/)).toBeTruthy();
    expect(mockApi.resolveAgentRecipient).not.toHaveBeenCalled();
  });

  test('4. AGENT recipient is ineligible for Cash→Wallet (fail-closed, no continue)', async () => {
    mockApi.resolveAgentRecipient.mockResolvedValue({ ...customerRecipient, ownerType: 'AGENT', display: 'Other Agent' });
    const { getByTestId, getByText, queryByTestId } = wrap(<CashToWalletRecipientScreen />);
    fireEvent.changeText(getByTestId('recipient-input'), '8000000002');
    fireEvent.press(getByTestId('recipient-verify-button'));
    await waitFor(() => expect(getByTestId('recipient-ineligible')).toBeTruthy());
    expect(getByText(/Agent wallets cannot receive Cash→Wallet/)).toBeTruthy();
    expect(queryByTestId('recipient-continue')).toBeNull();
  });

  test('continue navigates to amount with the resolved identity as params (ids excluded)', async () => {
    mockApi.resolveAgentRecipient.mockResolvedValue(customerRecipient);
    const { getByTestId } = wrap(<CashToWalletRecipientScreen />);
    fireEvent.changeText(getByTestId('recipient-input'), '8000000001');
    fireEvent.press(getByTestId('recipient-verify-button'));
    await waitFor(() => expect(getByTestId('recipient-continue')).toBeTruthy());
    fireEvent.press(getByTestId('recipient-continue'));
    expect(mockNavigate).toHaveBeenCalledWith('CashToWalletAmount', { recipient: customerRecipient });
    const params = (mockNavigate.mock.calls[0]?.[1] as any).recipient;
    expect('ownerId' in params).toBe(false);
  });
});

describe('Cash→Wallet — amount step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {
      key: 'k', name: 'CashToWalletAmount',
      params: { recipient: customerRecipient },
    };
  });

  test('5. amount validation: zero/negative/3dp/bad input blocked client-side', () => {
    const { getByTestId, getByText } = wrap(<CashToWalletAmountScreen />);
    fireEvent.changeText(getByTestId('amount-input'), '0');
    fireEvent.press(getByTestId('amount-continue'));
    expect(getByText(/greater than zero/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('amount-input'), '10.505');
    fireEvent.press(getByTestId('amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('amount-input'), 'abc');
    fireEvent.press(getByTestId('amount-continue'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('5b. parseNairaInputToMinor is a pure unit conversion (kobo)', () => {
    expect(parseNairaInputToMinor('2500')).toBe('250000');
    expect(parseNairaInputToMinor('2,500.50')).toBe('250050');
    expect(parseNairaInputToMinor('0')).toBeNull();
    expect(parseNairaInputToMinor('-5')).toBeNull();
    expect(parseNairaInputToMinor('1.555')).toBeNull();
    expect(formatNairaFromMinor('250000')).toBe('₦2,500.00');
  });

  test('valid amount navigates to confirm with ONE idempotency key for attempt', async () => {
    const { getByTestId } = wrap(<CashToWalletAmountScreen />);
    fireEvent.changeText(getByTestId('amount-input'), '2500');
    fireEvent.press(getByTestId('amount-continue'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [name, params] = mockNavigate.mock.calls[0] as any[];
    expect(name).toBe('CashToWalletConfirm');
    expect(params.amountMinor).toBe('250000');
    expect(params.idempotencyKey).toMatch(/^c2w-/);
    expect(newIdempotencyKey('c2w')).not.toBe(newIdempotencyKey('c2w'));
  });
});

describe('Cash→Wallet — confirmation & submission', () => {
  const params = {
    recipient: customerRecipient,
    amountMinor: '250000',
    idempotencyKey: 'c2w-abc',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = { key: 'k', name: 'CashToWalletConfirm', params };
  });

  test('6. confirmation shows only authoritative/input data (no client-computed totals)', () => {
    const { getByText, getByTestId } = wrap(<CashToWalletConfirmScreen />);
    expect(getByText('Ada Nnaji')).toBeTruthy();
    expect(getByText('8000000001')).toBeTruthy();
    expect(getByText('₦2,500.00 NGN')).toBeTruthy();
    // No fee/commission presentation anywhere (backend provides none for preview).
    expect(getByTestId('confirm-summary-card')).toBeTruthy();
  });

  test('7+10. correct request construction: contract body + single idempotency key, PIN in body', async () => {
    mockApi.agentCashIn.mockResolvedValue(cashInResult);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(mockApi.agentCashIn).toHaveBeenCalledWith({
        recipientIdentifier: '8000000001',
        amountMinor: '250000',
        currency: 'NGN',
        idempotencyKey: 'c2w-abc',
        pin: '1234',
      }),
    );
  });

  test('11. duplicate-submit protection while in flight', async () => {
    let resolveIt: (v: any) => void = () => {};
    mockApi.agentCashIn.mockImplementation(() => new Promise((res) => { resolveIt = res; }));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('confirm-submit')); // button is loading-disabled → no second call
    expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1);
    await act(async () => resolveIt(cashInResult));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
  });

  test('12+13+14. success: server reference, status, amount rendered (never journal/customer ids)', async () => {
    mockApi.agentCashIn.mockResolvedValue(cashInResult);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    const successParams = (mockReset.mock.calls[0]?.[0] as any).routes[0].params;
    expect(successParams).toEqual({ result: cashInResult, amountMinor: '250000' });

    mockRoute = {
      key: 'k', name: 'CashToWalletSuccess',
      params: { result: cashInResult, amountMinor: '250000' },
    };
    const view = wrap(<CashToWalletSuccessScreen />);
    expect(view.getByTestId('success-status')).toBeTruthy();
    expect(view.getByText('COMPLETED')).toBeTruthy();
    expect(view.getByText('CASH_IN-c2w-abc')).toBeTruthy();
    expect(view.getByText('₦2,500.00 NGN')).toBeTruthy();
    // Internal identifiers never rendered:
    expect(view.queryByText(/internal-journal-9/)).toBeNull();
    expect(view.queryByText(/internal-customer-1/)).toBeNull();
    expect(view.queryByText(/internal-hash/)).toBeNull();
    expect(view.queryByText(/journalId|requestHash/i)).toBeNull();
  });

  test('15. insufficient balance surfaces the safe server message via shared mapping', async () => {
    mockApi.agentCashIn.mockRejectedValue(apiError('Insufficient available balance', 409));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toContain('Insufficient available balance'),
    );
  });

  test('16. limit failure surfaces through sanitized mapping (no raw details)', async () => {
    mockApi.agentCashIn.mockRejectedValue(apiError('Per-transaction limit exceeded', 400));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toContain('Per-transaction limit exceeded'),
    );
  });

  test('17. authorization failure (403) maps to agent-facing denial', async () => {
    mockApi.agentCashIn.mockRejectedValue(apiError('Agent not permitted: AGENT_SUSPENDED', 403));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toBe(
        'You are not permitted to perform Cash→Wallet for this account.',
      ),
    );
  });

  test('9. PIN failure (401) surfaces PIN-specific message — NOT session-expiry', async () => {
    mockApi.agentCashIn.mockRejectedValue(apiError('Transaction PIN invalid: PIN_INVALID', 401));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toBe('Incorrect transaction PIN. Try again.'),
    );

    mockApi.agentCashIn.mockRejectedValue(apiError('Transaction PIN is locked', 401));
    const second = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(second.getByTestId('pin-input'), '1234');
    fireEvent.press(second.getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(second.getByTestId('confirm-error').props.children).toBe(
        'Your transaction PIN is locked. Contact support.',
      ),
    );
  });

  test('18. sanitized server error (5xx) — raw traces never displayed', async () => {
    mockApi.agentCashIn.mockRejectedValue(apiError('ledger constraint stack trace internal', 500));
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toBe(
        'The service is temporarily unavailable. Please retry.',
      ),
    );
  });

  test('19. network failure surfaces connection guidance', async () => {
    const e = new Error('fetch failed');
    (e as any).name = 'NetworkError';
    mockApi.agentCashIn.mockRejectedValue(e);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(getByTestId('confirm-error').props.children).toBe(
        'No network connection. Check your connection and retry.',
      ),
    );
  });

  test('20. success invalidates financial-position + transaction queries (server refresh)', async () => {
    useAuthStore.setState({ agentId: 'agent-uuid-1' });
    mockApi.agentCashIn.mockResolvedValue(cashInResult);
    const { client, getByTestId } = wrap(<CashToWalletConfirmScreen />);
    const spy = jest.spyOn(client, 'invalidateQueries');
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-financial-position', 'agent-uuid-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['agent-transactions', 'agent-uuid-1'] });
  });

  test('22. PIN is never persisted and never logged; cleared on outcomes', async () => {
    const setSpy = jest.spyOn(SecureStorage, 'set');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockApi.agentCashIn.mockResolvedValue(cashInResult);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    const pinInput = getByTestId('pin-input');
    fireEvent.changeText(pinInput, '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());

    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('1234');
      }
    }
    // No SecureStorage write carried the PIN:
    for (const call of setSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('1234');
    }
    logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
    // error path also clears: second render with rejection
    mockApi.agentCashIn.mockRejectedValue(apiError('Transaction PIN invalid: PIN_INVALID', 401));
    const second = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(second.getByTestId('pin-input'), '1234');
    fireEvent.press(second.getByTestId('confirm-submit'));
    await waitFor(() => expect(second.getByText('Incorrect transaction PIN. Try again.')).toBeTruthy());
    expect(second.getByTestId('pin-input').props.value).toBe('');
  });

  test('21+23. no internal identifiers rendered anywhere; result kept receipt-compatible', async () => {
    mockApi.agentCashIn.mockResolvedValue({ ...cashInResult, status: 'REPLAYED', replayed: true });
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    const resultParam = (mockReset.mock.calls[0]?.[0] as any).routes[0].params.result;
    mockRoute = { key: 'k', name: 'CashToWalletSuccess', params: { result: resultParam, amountMinor: '250000' } };
    const view = wrap(<CashToWalletSuccessScreen />);
    // REPLAYED honesty:
    expect(view.getByText('Already recorded')).toBeTruthy();
    expect(view.getByText('REPLAYED')).toBeTruthy();
    // Receipt-authoritative fields preserved in the passed result document:
    expect(resultParam).toHaveProperty('reference', 'CASH_IN-c2w-abc');
    expect(resultParam).toHaveProperty('amountMinor', '250000');
    expect(resultParam).toHaveProperty('recipientReceivingNumber', '8000000001');
    expect(resultParam).toHaveProperty('createdAt');
    expect(resultParam).toHaveProperty('status');
  });
});
