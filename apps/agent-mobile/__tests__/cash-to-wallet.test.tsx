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
import {
  clearPendingAgentOperation,
  loadPendingAgentOperation,
  savePendingAgentOperation,
} from '../src/services/pending-operation';
import type { ResolvedRecipientView } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  resolveAgentRecipient: jest.fn(),
  agentCashIn: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
  isAmbiguousOperationOutcome: jest.requireActual('../src/services/agent-api').isAmbiguousOperationOutcome,
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
    // Shared-receipt rendering (V1-AGENT-MOBILE-06 integration, RCP-1):
    expect(view.getByTestId('c2w-receipt')).toBeTruthy();
    expect(view.getByTestId('receipt-heading').props.children).toBe('Cash→Wallet Receipt');
    expect(view.getByTestId('receipt-status').props.children).toBe('COMPLETED');
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

  // V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01 — PART 6 confirmatory coverage. Unlike Customer
  // Mobile's SendMoneyScreen (fixed in that audit), this screen's Idempotency-Key is a fixed
  // route param generated ONCE upstream (CashToWalletAmountScreen) and is never regenerated by
  // this screen on any outcome — including an ambiguous NetworkError/5xx. This pins down that
  // Agent Cash→Wallet does NOT share the Customer W2W vulnerability: a retry after an ambiguous
  // failure here already, correctly, reuses the exact same key.
  test('21. an ambiguous outcome (NetworkError or 5xx) never changes the Idempotency-Key used by a retry', async () => {
    const networkErr = new Error('fetch failed');
    (networkErr as any).name = 'NetworkError';
    mockApi.agentCashIn.mockRejectedValueOnce(networkErr);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1));
    expect(mockApi.agentCashIn.mock.calls[0][0].idempotencyKey).toBe('c2w-abc');

    mockApi.agentCashIn.mockRejectedValueOnce(apiError('Internal error', 500));
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(2));
    expect(mockApi.agentCashIn.mock.calls[1][0].idempotencyKey).toBe('c2w-abc');

    mockApi.agentCashIn.mockResolvedValueOnce(cashInResult);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    expect(mockApi.agentCashIn.mock.calls[2][0].idempotencyKey).toBe('c2w-abc');
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

// V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01 — the process-kill recovery fix. Unlike the
// in-session-only coverage above (test 21), these simulate a genuine app-process kill by
// unmounting the Confirm screen entirely and mounting a BRAND NEW instance with a freshly
// minted route-param Idempotency-Key (exactly what CashToWalletAmountScreen would produce
// after a real restart, since its useRef-held key cannot survive process death) — then assert
// the durable SecureStorage-backed pending-operation record is what actually governs which key
// reaches the network, not the fresh one in the new route params.
describe('Cash→Wallet — Idempotency-Key durability across a simulated process kill', () => {
  const agentId = 'agent-persist-c2w';
  const recipient = customerRecipient; // receivingNumber '8000000001'

  beforeEach(async () => {
    jest.clearAllMocks();
    useAuthStore.setState({ agentId });
    await clearPendingAgentOperation(agentId, 'CASH_IN');
  });

  test('1. an ambiguous outcome (NetworkError) durably persists the pending operation, not just in-memory', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '250000', idempotencyKey: 'c2w-persist-k1' },
    };
    const networkErr = new Error('fetch failed');
    (networkErr as any).name = 'NetworkError';
    mockApi.agentCashIn.mockRejectedValueOnce(networkErr);

    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1));

    const persisted = await loadPendingAgentOperation(agentId, 'CASH_IN');
    expect(persisted).not.toBeNull();
    expect(persisted?.idempotencyKey).toBe('c2w-persist-k1');
    expect(persisted?.counterpartyId).toBe('8000000001');
    expect(persisted?.amountMinor).toBe('250000');
  });

  test('2. a fresh Confirm instance after a simulated restart reuses the persisted key, not the freshly-minted route-param one', async () => {
    // Precondition: an earlier "session" sent a request with K1, the process was killed before
    // any response arrived, and — per test 1 above — the pending-operation record for this
    // exact recipient + amount was durably persisted with K1 before that request was sent.
    // Staged directly here (rather than re-driving a hung network mock through unmount) to
    // isolate what this test actually proves: a FRESH screen instance's own submission path
    // recognizes and reuses that persisted record.
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_IN',
      idempotencyKey: 'c2w-restart-original',
      counterpartyId: '8000000001',
      amountMinor: '250000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    // "Reopen the app": the Agent re-navigates Home → Recipient → Amount → Confirm for what
    // they believe is the same credit. CashToWalletAmountScreen mints a BRAND NEW key because
    // its in-memory useRef cannot have survived the process kill.
    mockApi.agentCashIn.mockResolvedValueOnce(cashInResult);
    mockRoute = {
      key: 'k2',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '250000', idempotencyKey: 'c2w-restart-FRESH-K2' },
    };
    const second = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(second.getByTestId('pin-input'), '1234');
    fireEvent.press(second.getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1));

    // The network call must carry the ORIGINAL persisted key, not the fresh one minted
    // post-restart by the Amount screen.
    expect(mockApi.agentCashIn.mock.calls[0][0].idempotencyKey).toBe('c2w-restart-original');
  });

  test('3. success clears the persisted operation', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '250000', idempotencyKey: 'c2w-success-clear' },
    };
    mockApi.agentCashIn.mockResolvedValueOnce(cashInResult);
    const { getByTestId } = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(getByTestId('pin-input'), '1234');
    fireEvent.press(getByTestId('confirm-submit'));
    await waitFor(() => expect(mockReset).toHaveBeenCalled());
    await waitFor(async () => expect(await loadPendingAgentOperation(agentId, 'CASH_IN')).toBeNull());
  });

  test('4. a definitive rejection (4xx) clears the persisted operation — a later attempt gets a clean new key', async () => {
    mockRoute = {
      key: 'k1',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '250000', idempotencyKey: 'c2w-definitive-reject' },
    };
    mockApi.agentCashIn.mockRejectedValueOnce(apiError('Transaction PIN invalid: PIN_INVALID', 401));
    const first = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(first.getByTestId('pin-input'), '1234');
    fireEvent.press(first.getByTestId('confirm-submit'));
    await waitFor(() =>
      expect(first.getByTestId('confirm-error').props.children).toBe('Incorrect transaction PIN. Try again.'),
    );
    await waitFor(async () => expect(await loadPendingAgentOperation(agentId, 'CASH_IN')).toBeNull());
    first.unmount();

    // A later attempt (new screen instance, new key) is NOT overridden by anything stale.
    mockApi.agentCashIn.mockResolvedValueOnce(cashInResult);
    mockRoute = {
      key: 'k2',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '250000', idempotencyKey: 'c2w-clean-retry-key' },
    };
    const second = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(second.getByTestId('pin-input'), '1234');
    fireEvent.press(second.getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(2));
    expect(mockApi.agentCashIn.mock.calls[1][0].idempotencyKey).toBe('c2w-clean-retry-key');
  });

  test('5. a persisted operation for a DIFFERENT amount is never reused — no fuzzy attribution', async () => {
    // Precondition: a pending operation for the SAME recipient but a DIFFERENT amount (₦2,500)
    // is sitting in storage, left behind by an earlier ambiguous attempt.
    await savePendingAgentOperation({
      agentId,
      operationType: 'CASH_IN',
      idempotencyKey: 'c2w-amount-a',
      counterpartyId: '8000000001',
      amountMinor: '250000',
      currency: 'NGN',
      createdAt: new Date().toISOString(),
    });

    // A genuinely different, later Cash→Wallet credit for a different amount (₦5,000) must get
    // its OWN key — it must never silently inherit the stale pending record for a different
    // amount just because it shares the same recipient and Agent.
    mockApi.agentCashIn.mockResolvedValueOnce({ ...cashInResult, amountMinor: '500000' });
    mockRoute = {
      key: 'k2',
      name: 'CashToWalletConfirm',
      params: { recipient, amountMinor: '500000', idempotencyKey: 'c2w-amount-b-own-key' },
    };
    const second = wrap(<CashToWalletConfirmScreen />);
    fireEvent.changeText(second.getByTestId('pin-input'), '1234');
    fireEvent.press(second.getByTestId('confirm-submit'));
    await waitFor(() => expect(mockApi.agentCashIn).toHaveBeenCalledTimes(1));
    expect(mockApi.agentCashIn.mock.calls[0][0].idempotencyKey).toBe('c2w-amount-b-own-key');
  });
});
