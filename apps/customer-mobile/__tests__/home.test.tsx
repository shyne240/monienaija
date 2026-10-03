import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../src/screens/authenticated/HomeScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({
    customerId: 'test-customer-uuid',
    logout: jest.fn(),
  }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL, authenticated,
 * ownership-scoped `GET /customers/me/wallets` and
 * `GET /customers/me/transfers` endpoints. The previous version of this
 * test asserted the legacy unauthenticated `/customers/:id/wallets` route
 * and a customer-initiated wallet "provisioning" POST that V1 does not
 * support (wallets are provisioned atomically during registration).
 */
describe('HomeScreen Dashboard Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render balance correctly formatted from minor units, reading from /customers/me/*', async () => {
    const mockWallets = [
      {
        id: 'wallet-uuid-999',
        currency: 'NGN',
        status: 'ACTIVE',
        balanceMinor: 250000, // 2500.00 Naira
      },
    ];

    const mockTxHistory = { items: [] };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/customers/me/wallets')) return Promise.resolve(mockWallets);
      if (url.startsWith('/customers/me/transfers')) return Promise.resolve(mockTxHistory);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/wallets');
      expect(getByText('₦2,500.00')).toBeTruthy();
      expect(getByText('Wallet ID: wallet-uuid-999')).toBeTruthy();
    });
  });

  test('should display a no-wallet state and NOT offer any self-service wallet creation', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue([]);

    const { getByText, queryByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('No Wallet Found')).toBeTruthy();
    });

    // V1 has no customer-initiated wallet provisioning endpoint; this control
    // must not exist.
    expect(queryByText('Provision Primary NGN Wallet')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should render recent transactions mapped from the transfer list shape', async () => {
    const mockWallets = [
      { id: 'wallet-uuid-999', currency: 'NGN', status: 'ACTIVE', balanceMinor: 100000 },
    ];
    const mockTxHistory = {
      items: [
        {
          id: 'transfer-1',
          transferId: 'transfer-1',
          narration: 'Rent split',
          reference: 'ref-1',
          amountMinor: '5000',
          currency: 'NGN',
          direction: 'SENT',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/customers/me/wallets')) return Promise.resolve(mockWallets);
      if (url.startsWith('/customers/me/transfers')) return Promise.resolve(mockTxHistory);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('Rent split')).toBeTruthy();
    });
  });
});
