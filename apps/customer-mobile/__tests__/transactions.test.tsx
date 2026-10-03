import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { TransactionsScreen } from '../src/screens/authenticated/TransactionsScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL, authenticated,
 * ownership-scoped `GET /customers/me/transfers` endpoint. The previous
 * version asserted the legacy unauthenticated `/customers/:id/wallets` +
 * `/wallets/:id/transactions` routes.
 */
describe('Transactions Screen History Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and render paginated transactions list from /customers/me/transfers', async () => {
    const mockTxResponse = {
      items: [
        {
          id: 'tx-uuid-1',
          transferId: 'tx-uuid-1',
          narration: 'Grocery funding',
          reference: 'ref-grocery-001',
          amountMinor: '4500',
          currency: 'NGN',
          direction: 'SENT',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    (ApiClient.get as jest.Mock).mockResolvedValueOnce(mockTxResponse);

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/transfers?page=1&limit=15');
      expect(getByText('Grocery funding')).toBeTruthy();
      expect(getByText('-₦45.00')).toBeTruthy();
    });
  });

  test('should render empty state correctly', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({ items: [] });

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(getByText('No transaction records found.')).toBeTruthy();
    });
  });
});
