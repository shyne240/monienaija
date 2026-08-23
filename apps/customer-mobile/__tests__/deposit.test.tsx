import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FundWalletScreen } from '../src/screens/authenticated/FundWalletScreen';
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
    customerId: 'cust-uuid-444',
  }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

describe('Fund Wallet Screen Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-uuid-444',
      type: 'PRIMARY',
      currency: 'NGN',
      balanceMinor: 10000,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
  });

  test('should validate zero/negative amounts', async () => {
    const { getByPlaceholderText, getByText } = render(<FundWalletScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('0.00')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('0.00'), '0');
    fireEvent.press(getByText('Fund Wallet Now'));

    await waitFor(() => {
      expect(getByText('Amount must be greater than zero.')).toBeTruthy();
    });
  });

  test('should execute deposit and complete it immediately in sandbox', async () => {
    (ApiClient.post as jest.Mock)
      .mockResolvedValueOnce({ id: 'dep-uuid-123' }) // deposit creation
      .mockResolvedValueOnce({ status: 'SUCCESS' }); // deposit completion

    const { getByPlaceholderText, getByText } = render(<FundWalletScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('0.00')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('0.00'), '150'); // 150 NGN = 15000 kobo
    fireEvent.press(getByText('Fund Wallet Now'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        1,
        '/deposits',
        expect.objectContaining({
          walletId: 'wallet-uuid-444',
          amountMinor: '15000',
        }),
        expect.any(Object)
      );
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        2,
        '/deposits/dep-uuid-123/complete'
      );
      expect(getByText('Wallet Funded Successfully!')).toBeTruthy();
    });
  });

  test('should retain the same idempotency key across retries on failure', async () => {
    // Mock deposit creation failure
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Temporary database failure', 500)
    );

    const { getByPlaceholderText, getByText } = render(<FundWalletScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('0.00')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('0.00'), '50');
    
    // First submit click
    fireEvent.press(getByText('Fund Wallet Now'));

    let originalKey = '';
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledTimes(1);
      originalKey = (ApiClient.post as jest.Mock).mock.calls[0][2].idempotencyKey;
      expect(originalKey).toBeTruthy();
      expect(getByText('Temporary database failure')).toBeTruthy();
    });

    // Second submit click (retry)
    fireEvent.press(getByText('Fund Wallet Now'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledTimes(2);
      const retryKey = (ApiClient.post as jest.Mock).mock.calls[1][2].idempotencyKey;
      // Retained key across manual retry of the same form!
      expect(retryKey).toBe(originalKey);
    });
  });
});
