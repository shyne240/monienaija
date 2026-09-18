import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { TransactionsScreen } from '../src/screens/authenticated/TransactionsScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({
    customerId: 'cust-uuid-777',
  }),
}));

describe('Transactions Screen History Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-uuid-777',
      type: 'PRIMARY',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and render paginated transactions list correctly', async () => {
    const mockTxResponse = {
      items: [
        {
          id: 'tx-uuid-1',
          narration: 'Grocery funding',
          reference: 'ref-grocery-001',
          amountMinor: 4500,
          currency: 'NGN',
          type: 'TRANSFER_OUT',
          status: 'SUCCESS',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(mockWallets) // get wallets
      .mockResolvedValueOnce(mockTxResponse); // get transactions

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenNthCalledWith(1, '/customers/cust-uuid-777/wallets');
      expect(ApiClient.get).toHaveBeenNthCalledWith(2, '/wallets/wallet-uuid-777/transactions?page=1&limit=15');
      expect(getByText('Grocery funding')).toBeTruthy();
      expect(getByText('-₦45.00')).toBeTruthy();
    });
  });

  test('should render empty state correctly', async () => {
    (ApiClient.get as jest.Mock)
      .mockResolvedValueOnce(mockWallets)
      .mockResolvedValueOnce({ items: [] });

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(getByText('No transaction records found.')).toBeTruthy();
    });
  });
});
