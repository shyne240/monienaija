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
 * ownership-scoped `GET /customers/me/wallets` endpoint. The previous
 * version of this test asserted the legacy unauthenticated
 * `/customers/:id/wallets` route and a customer-initiated wallet
 * "provisioning" POST that V1 does not support (wallets are provisioned
 * atomically during registration).
 *
 * V1-CUSTOMER-07 — "recent transactions" assertions now target the unified
 * `GET /customers/me/transactions` endpoint instead of the Wallet→Wallet-only
 * `GET /customers/me/transfers` endpoint.
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
      if (url.startsWith('/customers/me/transactions')) return Promise.resolve(mockTxHistory);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/wallets');
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/transactions?page=1&limit=5');
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

  test('should render recent transactions mapped from the unified history shape', async () => {
    const mockWallets = [
      { id: 'wallet-uuid-999', currency: 'NGN', status: 'ACTIVE', balanceMinor: 100000 },
    ];
    const mockTxHistory = {
      items: [
        {
          id: 'transfer-1',
          type: 'WALLET_TRANSFER',
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
      if (url.startsWith('/customers/me/transactions')) return Promise.resolve(mockTxHistory);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('Rent split')).toBeTruthy();
    });
  });

  test('should render a Cash→Wallet credit on the dashboard with agent context and no raw ledger codes', async () => {
    const mockWallets = [
      { id: 'wallet-uuid-999', currency: 'NGN', status: 'ACTIVE', balanceMinor: 100000 },
    ];
    const mockTxHistory = {
      items: [
        {
          id: 'cash-in-1',
          type: 'CASH_IN',
          narration: null,
          reference: 'ref-cash-in-1',
          amountMinor: '15000',
          currency: 'NGN',
          direction: 'CREDIT',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/customers/me/wallets')) return Promise.resolve(mockWallets);
      if (url.startsWith('/customers/me/transactions')) return Promise.resolve(mockTxHistory);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('Cash Deposit via Agent')).toBeTruthy();
      expect(getByText('+₦150.00')).toBeTruthy();
    });
  });
});
