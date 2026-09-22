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
      type: 'PRIMARY',
      currency: 'NGN',
    },
  ];

  // Available balance is read through the financial binding read model.
  const mockFinancialAccounts = {
    customerId: 'cust-uuid-666',
    generatedAt: new Date().toISOString(),
    accounts: [
      {
        bindingId: 'binding-uuid-666',
        customerWalletId: 'wallet-source-uuid-666',
        walletAccountId: 'wallet-account-source-uuid-666',
        bindingState: 'ACTIVE',
        readState: 'ACTIVE',
        currency: 'NGN',
        balanceMinor: '20000', // 200.00 Naira
        warnings: [],
      },
    ],
    warnings: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/financial-accounts')) return Promise.resolve(mockFinancialAccounts);
      if (url.endsWith('/wallets')) return Promise.resolve(mockWallets);
      return Promise.resolve([]);
    });
  });

  test('should validate empty bank account details or insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<WithdrawScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. Zenith Bank - 1012345678')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('0.00'), '300'); // more than 200 NGN available
    fireEvent.changeText(getByPlaceholderText('e.g. Zenith Bank - 1012345678'), 'Zenith 123');
    
    fireEvent.press(getByText('Confirm Withdrawal'));

    await waitFor(() => {
      expect(getByText('Insufficient funds in wallet.')).toBeTruthy();
    });
  });

  test('should withdraw successfully in sandbox environment', async () => {
    (ApiClient.post as jest.Mock)
      .mockResolvedValueOnce({ id: 'with-uuid-123' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const { getByPlaceholderText, getByText } = render(<WithdrawScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. Zenith Bank - 1012345678')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('0.00'), '50'); // 50 NGN
    fireEvent.changeText(getByPlaceholderText('e.g. Zenith Bank - 1012345678'), 'Zenith Bank - 1012345678');

    fireEvent.press(getByText('Confirm Withdrawal'));

    // Step-up: the withdrawal executes only after transaction-PIN authorization.
    await waitFor(() => {
      expect(getByText('Authorize Withdrawal')).toBeTruthy();
    });
    fireEvent.changeText(getByPlaceholderText('••••'), '1357');
    fireEvent.press(getByText('Authorize'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        1,
        '/customers/cust-uuid-666/withdrawals',
        expect.objectContaining({
          amountMinor: '5000',
          narration: 'Withdraw to Zenith Bank - 1012345678',
          transactionPin: '1357',
        }),
        expect.any(Object)
      );
      // The target WalletAccount is resolved server-side through the binding.
      expect((ApiClient.post as jest.Mock).mock.calls[0][1].walletId).toBeUndefined();
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        2,
        '/customers/cust-uuid-666/withdrawals/with-uuid-123/process'
      );
      expect(ApiClient.post).toHaveBeenNthCalledWith(
        3,
        '/customers/cust-uuid-666/withdrawals/with-uuid-123/complete'
      );
      expect(getByText('Withdrawal Initiated!')).toBeTruthy();
    });
  });
});
