import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { WithdrawScreen } from '../src/screens/authenticated/WithdrawScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

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
    customerId: 'cust-uuid-666',
  }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

describe('Withdrawal Screen Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-source-uuid-666',
      status: 'ACTIVE',
      currency: 'NGN',
      balanceMinor: 20000, // 200.00 Naira
    },
  ];

  beforeEach(() => {
    // Reset (not just clear) so leftover implementations and unconsumed
    // mockResolvedValueOnce queues cannot leak between tests.
    jest.resetAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
  });

  test('should validate empty bank account details or insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<WithdrawScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. Zenith Bank - 1012345678')).toBeTruthy();
    });

    // The form renders immediately, but the wallet fetch resolves after mount.
    // Wait for committed wallet state (the balance block only renders once a
    // wallet exists) so submit handlers never see an empty wallet list.
    await waitFor(() => {
      expect(getByText('AVAILABLE BALANCE')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.changeText(getByPlaceholderText('0.00'), '300'); // more than 200 NGN available
    fireEvent.changeText(getByPlaceholderText('e.g. Zenith Bank - 1012345678'), 'Zenith 123');
    
    fireEvent.press(getByText('Confirm Withdrawal'));

    await waitFor(() => {
      expect(getByText('Insufficient funds in wallet.')).toBeTruthy();
    }, { timeout: 5000 });
  });

  test('should withdraw successfully in sandbox environment', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValueOnce({ id: 'with-uuid-123' });

    const { getByPlaceholderText, getByText } = render(<WithdrawScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. Zenith Bank - 1012345678')).toBeTruthy();
    });

    // Ensure the wallet fetch has resolved and committed before submitting.
    await waitFor(() => {
      expect(getByText('AVAILABLE BALANCE')).toBeTruthy();
    }, { timeout: 5000 });

    fireEvent.changeText(getByPlaceholderText('0.00'), '50'); // 50 NGN
    fireEvent.changeText(getByPlaceholderText('e.g. Zenith Bank - 1012345678'), 'Zenith Bank - 1012345678');
    
    fireEvent.press(getByText('Confirm Withdrawal'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        1,
        '/withdrawals',
        expect.objectContaining({
          walletId: 'wallet-source-uuid-666',
          amountMinor: '5000',
          narration: 'Withdraw to Zenith Bank - 1012345678',
        }),
        expect.any(Object)
      );
      // Processing/completion are operational transitions; the request stays pending for the customer.
      expect(ApiClient.post).toHaveBeenCalledTimes(1);
      expect(getByText('Withdrawal Initiated!')).toBeTruthy();
    }, { timeout: 5000 });
  });
});
