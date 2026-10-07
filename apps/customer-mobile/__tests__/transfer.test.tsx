import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SendMoneyScreen } from '../src/screens/authenticated/SendMoneyScreen';
import { ApiClient, ApiError, NetworkError } from '../src/services/api-client';
import { clearPendingTransferIntent, loadPendingTransferIntent } from '../src/services/pending-transfer';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  NetworkError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NetworkError';
    }
  },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

// V1-MOBILE-IDEMPOTENCY-RECOVERY-01 — a fixed, controllable customerId so the persisted pending
// transfer intent (scoped by customerId) behaves deterministically across tests.
let mockCustomerId: string | null = 'customer-a-uuid';
jest.mock('../src/store/auth-store', () => ({
  useAuthStore: (selector: (state: { customerId: string | null }) => unknown) =>
    selector({ get customerId() { return mockCustomerId; } }),
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL authorization contract.
 * The previous version of this test hit the legacy unauthenticated
 * `/transfers` endpoint with no Transaction PIN at all, which made a real
 * authorization gap look like a passing test (a PIN field in the UI is
 * NOT proof the backend enforces it). This version asserts the actual
 * endpoint (`/customers/me/transfers`), the actual wallet source
 * (`/customers/me/wallets`), that the PIN is sent, and that it is cleared
 * from memory after submission.
 *
 * V1-MOBILE-IDEMPOTENCY-RECOVERY-01 adds coverage for the ambiguous-outcome /
 * definitive-outcome distinction: an ambiguous failure (NetworkError, 5xx) must
 * preserve the Idempotency-Key for a safe retry; a definitive rejection (4xx) must
 * mint a fresh one. See docs/V1/V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md.
 */
describe('Send Money (Transfer) Screen Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-source-uuid',
      currency: 'NGN',
      status: 'ACTIVE',
      balanceMinor: 50000, // 500.00 Naira
    },
  ];

  beforeEach(async () => {
    // Scoped to the mocks this file actually controls — `jest.resetAllMocks()`/`clearAllMocks()`
    // would also reset the test environment's global native-module mocks (e.g. Switch/other RN
    // host components stubbed by the jest-expo preset), breaking rendering entirely.
    (ApiClient.get as jest.Mock).mockReset();
    (ApiClient.post as jest.Mock).mockReset();
    mockNavigate.mockClear();
    mockCustomerId = 'customer-a-uuid';
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
    // The in-memory SecureStore fallback (NODE_ENV=test) is a module-level singleton and
    // persists across test cases within this file — explicitly clear any pending intent left
    // over from a prior test so each test starts from a clean slate.
    await clearPendingTransferIntent('customer-a-uuid');
    await clearPendingTransferIntent('customer-b-uuid');
  });

  const fillAndSubmit = async (
    getByPlaceholderText: any,
    getByText: any,
    { destination = '12345678-1234-1234-1234-123456789012', amount = '100', pin = '1234' } = {},
  ) => {
    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), destination);
    fireEvent.changeText(getByPlaceholderText('0.00'), amount);
    fireEvent.changeText(getByPlaceholderText('••••'), pin);

    fireEvent.press(getByText('Send Funds'));
  };

  test('loads the wallet from the authenticated /customers/me/wallets endpoint', async () => {
    render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/wallets');
    });
  });

  test('should require a Transaction PIN before allowing submission', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100');
    // PIN left blank
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Enter your 4-12 digit Transaction PIN.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should validate insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText, { amount: '600' });

    await waitFor(() => {
      expect(getByText('Insufficient wallet balance.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should execute transfer against the real PIN-protected endpoint and clear the PIN afterward', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-789', status: 'COMPLETED' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '4321' });

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });

    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/me/transfers',
        expect.objectContaining({
          sourceWalletId: 'wallet-source-uuid',
          destinationWalletId: '12345678-1234-1234-1234-123456789012',
          amountMinor: '10000',
          pin: '4321',
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('Home');
    });

    // The PIN input must never remain in rendered state after a successful submit.
    expect(getByPlaceholderText('••••').props.value).toBe('');

    // V1-MOBILE-IDEMPOTENCY-RECOVERY-01 — a definitive success must resolve (clear) the
    // persisted pending intent so it can never be mistakenly reused for a future transfer.
    await waitFor(async () => {
      expect(await loadPendingTransferIntent('customer-a-uuid')).toBeNull();
    });
  });

  test('should surface a locked-PIN failure in plain language and clear the PIN field', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Customer PIN is locked', 401),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(
        getByText('Your Transaction PIN is locked due to too many failed attempts. Contact support to continue.'),
      ).toBeTruthy();
    });
    expect(getByPlaceholderText('••••').props.value).toBe('');
  });

  test('should explain a LIMIT_* failure code in plain language', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Daily transfer amount exceeded', 422, 'LIMIT_DAILY_AMOUNT_EXCEEDED'),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(
        getByText('This transfer exceeds an account transaction limit. Try a smaller amount or contact support.'),
      ).toBeTruthy();
    });
  });

  test('should explain a 409 idempotency conflict clearly in the error banner', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('The idempotency key was already used for another transfer', 409),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(getByText('The idempotency key was already used for another transfer')).toBeTruthy();
    });
  });

  describe('V1-MOBILE-IDEMPOTENCY-RECOVERY-01 — ambiguous vs definitive outcome handling', () => {
    test('a NetworkError (ambiguous outcome) does NOT claim the transfer failed, and preserves the Idempotency-Key for a safe retry', async () => {
      (ApiClient.post as jest.Mock).mockRejectedValueOnce(new NetworkError('fetch failed'));

      const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));

      await waitFor(() => {
        expect(
          getByText(
            "We couldn't confirm whether this transfer went through. Please check your Transaction History before trying again — if you do retry, you will not be charged twice for the same transfer.",
          ),
        ).toBeTruthy();
      });
      // Must NOT say the transfer "failed" — the outcome is unknown, not negative.
      expect(() => getByText(/Transfer failed/i)).toThrow();

      const firstCallKey = (ApiClient.post as jest.Mock).mock.calls[0][2].idempotencyKey;

      // The pending intent must survive the ambiguous failure, scoped to this customer.
      const pending = await loadPendingTransferIntent('customer-a-uuid');
      expect(pending).not.toBeNull();
      expect(pending!.idempotencyKey).toBe(firstCallKey);

      // Retry the SAME logical transfer (identical destination/amount; PIN must be re-entered —
      // it is always cleared after any attempt, by design) — must reuse the exact same
      // Idempotency-Key, not mint a new one.
      (ApiClient.post as jest.Mock).mockResolvedValueOnce({ id: 'tx-retry-1', status: 'COMPLETED' });
      fireEvent.changeText(getByPlaceholderText('••••'), '1234');
      fireEvent.press(getByText('Send Funds'));
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Home'));
      const secondCallKey = (ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey;
      expect(secondCallKey).toBe(firstCallKey);

      // Definitive success now resolves (clears) the pending intent.
      expect(await loadPendingTransferIntent('customer-a-uuid')).toBeNull();
    });

    test('a 5xx response (ambiguous outcome) preserves the Idempotency-Key exactly like a NetworkError', async () => {
      (ApiClient.post as jest.Mock).mockRejectedValueOnce(new ApiError('Internal error', 500));

      const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));

      await waitFor(() => {
        expect(getByText(/couldn't confirm whether this transfer went through/)).toBeTruthy();
      });

      const pending = await loadPendingTransferIntent('customer-a-uuid');
      expect(pending).not.toBeNull();
    });

    test('a definitive 4xx rejection DOES mint a fresh Idempotency-Key and clears any pending intent', async () => {
      (ApiClient.post as jest.Mock).mockRejectedValueOnce(new ApiError('Incorrect PIN', 401));

      const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));

      await waitFor(() => expect(getByText('Incorrect Transaction PIN.')).toBeTruthy());

      const firstCallKey = (ApiClient.post as jest.Mock).mock.calls[0][2].idempotencyKey;
      // A definitive rejection must NOT leave a reusable pending intent behind.
      expect(await loadPendingTransferIntent('customer-a-uuid')).toBeNull();

      (ApiClient.post as jest.Mock).mockResolvedValueOnce({ id: 'tx-fresh-1', status: 'COMPLETED' });
      fireEvent.changeText(getByPlaceholderText('••••'), '4321');
      fireEvent.press(getByText('Send Funds'));
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Home'));
      const secondCallKey = (ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey;
      expect(secondCallKey).not.toBe(firstCallKey);
    });

    test('a pending intent belonging to a DIFFERENT customer is never reused (customer isolation)', async () => {
      (ApiClient.post as jest.Mock).mockRejectedValueOnce(new NetworkError('fetch failed'));

      // Customer A's attempt ends ambiguously and leaves a pending intent behind.
      const { getByPlaceholderText, getByText, unmount } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));
      await waitFor(() => expect(getByText(/couldn't confirm/)).toBeTruthy());
      unmount();

      expect(await loadPendingTransferIntent('customer-a-uuid')).not.toBeNull();
      // Customer B must never see Customer A's pending intent.
      expect(await loadPendingTransferIntent('customer-b-uuid')).toBeNull();

      // Customer B logs in on the same device and submits the SAME-looking transfer.
      mockCustomerId = 'customer-b-uuid';
      (ApiClient.post as jest.Mock).mockResolvedValueOnce({ id: 'tx-customer-b', status: 'COMPLETED' });
      const screenB = render(<SendMoneyScreen />);
      await fillAndSubmit(screenB.getByPlaceholderText, screenB.getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(screenB.getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(screenB.getByText('Confirm'));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Home'));

      const customerBKey = (ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey;
      const customerAPending = await loadPendingTransferIntent('customer-a-uuid');
      // Customer A's stale ambiguous intent is untouched/unaffected by Customer B's submission,
      // and Customer B's own key is NOT Customer A's — no cross-customer key reuse occurred.
      expect(customerAPending).not.toBeNull();
      expect(customerBKey).not.toBe(customerAPending!.idempotencyKey);
    });

    test('logout clears any pending transfer intent', async () => {
      (ApiClient.post as jest.Mock).mockRejectedValueOnce(new NetworkError('fetch failed'));

      const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());
      fireEvent.press(getByText('Confirm'));
      await waitFor(() => expect(getByText(/couldn't confirm/)).toBeTruthy());

      expect(await loadPendingTransferIntent('customer-a-uuid')).not.toBeNull();

      // Exercise the real logout() implementation (not a mock — `../src/store/auth-store` is
      // mocked at the top of this file for the component under test, but `requireActual` here
      // bypasses that for this one direct call) against the real (test-environment in-memory)
      // SecureStorage, to prove logout actually clears the pending intent. This real store
      // instance is independent of the mocked one the rendered component used, so it must be
      // told which customer is "logged in" before logging out, exactly as the real app would
      // have it populated from a real login.
      const { useAuthStore: realUseAuthStore } = jest.requireActual('../src/store/auth-store');
      realUseAuthStore.setState({
        isAuthenticated: true,
        customerId: 'customer-a-uuid',
        session: { accessToken: 't', sessionId: 's', expiresAt: '2999-01-01', customerId: 'customer-a-uuid', audience: 'customer-api' },
      });
      await realUseAuthStore.getState().logout();

      expect(await loadPendingTransferIntent('customer-a-uuid')).toBeNull();
    });

    test('rapid double-tap on Confirm only sends ONE request (synchronous in-flight guard)', async () => {
      let resolvePost: (value: unknown) => void;
      (ApiClient.post as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
      );

      const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);
      await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '1234' });
      await waitFor(() => expect(getByText('Confirm Money Transfer')).toBeTruthy());

      // Capture the Confirm element ONCE, then dispatch two presses against that same
      // reference in immediate succession — simulating two taps landing before the first
      // press's `setShowConfirm(false)`/`setIsLoading(true)` re-render has been committed
      // (the scenario the `isLoading`-disabled button alone cannot guarantee it prevents).
      const confirmButton = getByText('Confirm');
      fireEvent.press(confirmButton);
      fireEvent.press(confirmButton);

      resolvePost!({ id: 'tx-single', status: 'COMPLETED' });
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Home'));

      expect((ApiClient.post as jest.Mock).mock.calls.length).toBe(1);
    });
  });
});
