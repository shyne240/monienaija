import React, { act } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SendMoneyScreen } from '../src/screens/authenticated/SendMoneyScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

// The first React render in a fresh jest worker pays a one-time synchronous
// initialization cost (React Native host components, StyleSheet, jest-expo
// native mocks, V8 lazy compilation). Under the cold-cache + CPU-contention
// conditions of a CI runner this single section can exceed Jest's default 5 s
// per-test budget, so the FIRST test of the file is aborted with
// "Exceeded timeout of 5000 ms for a test" before it can make an assertion.
// jest.setTimeout raises the outer budget for tests AND hooks (worst measured
// warm-up: ~23 s on a 2-core box under 300% contention); the beforeAll warm-up
// performs that first render inside the hook, so every assertion test runs in
// an already-warm worker. Assertion sensitivity is unchanged: each waitFor
// keeps its own 5 s budget and real assertion failures still report at ~5 s.
jest.setTimeout(30000);

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({
    customerId: 'cust-uuid-555',
  }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

describe('Send Money (Transfer) Screen Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-source-uuid',
      type: 'PRIMARY',
      currency: 'NGN',
      balanceMinor: 50000, // 500.00 Naira
    },
  ];


  // One-time worker warm-up: render (and unmount) the screen before the first
  // test so the cold React Native / jest-expo initialization cost is paid here
  // (hook budget: see jest.setTimeout above) instead of inside the first test.
  beforeAll(async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
    const warm = render(<SendMoneyScreen />);
    await act(async () => {});
    warm.unmount();
  });

  beforeEach(() => {
    // Reset (not just clear) so leftover implementations and unconsumed
    // mockResolvedValueOnce queues cannot leak between tests.
    jest.resetAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
  });

  test('should validate insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    // The form renders immediately, but the wallet fetch resolves after mount.
    // Wait for committed wallet state (the balance block only renders once a
    // wallet exists) so validation never runs against an empty wallet list.
    await waitFor(() => {
      expect(getByText('AVAILABLE BALANCE')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '600'); // More than available 500 Naira
    
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Insufficient wallet balance.')).toBeTruthy();
    }, { timeout: 5000 });
  });

  test('should execute transfer successfully after confirmation', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-789' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    // Ensure the wallet fetch has resolved and committed before submitting.
    await waitFor(() => {
      expect(getByText('AVAILABLE BALANCE')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100'); // 100 Naira
    
    fireEvent.press(getByText('Send Funds'));

    // Confirmation dialog should be displayed
    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    }, { timeout: 5000 });

    // Confirm it
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/transfers',
        expect.objectContaining({
          sourceWalletId: 'wallet-source-uuid',
          destinationWalletId: '12345678-1234-1234-1234-123456789012',
          amountMinor: '10000',
        }),
        expect.any(Object)
      );
      expect(mockNavigate).toHaveBeenCalledWith('Home');
    }, { timeout: 5000 });
  });

  test('should explain 409 idempotency conflict clearly in error banner', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Transfer attempt carrying a different payload', 409)
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    // Ensure the wallet fetch has resolved and committed before submitting.
    await waitFor(() => {
      expect(getByText('AVAILABLE BALANCE')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '10');
    
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Confirm')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      // Explains conflict clearly
      expect(getByText('Transfer attempt carrying a different payload')).toBeTruthy();
    }, { timeout: 5000 });
  });
});
