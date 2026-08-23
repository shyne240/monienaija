import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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

describe('HomeScreen Dashboard Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render balance correctly formatted from minor units', async () => {
    const mockWallets = [
      {
        id: 'wallet-uuid-999',
        customerId: 'test-customer-uuid',
        type: 'PRIMARY',
        currency: 'NGN',
        status: 'ACTIVE',
        balanceMinor: 250000, // 2500.00 Naira
      },
    ];

    const mockTxHistory = {
      items: [],
    };

    (ApiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/wallets?')) return Promise.resolve(mockTxHistory);
      if (url.includes('/wallets')) return Promise.resolve(mockWallets);
      return Promise.resolve([]);
    });

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      // 2,500.00 Naira
      expect(getByText('₦2,500.00')).toBeTruthy();
      expect(getByText('Wallet ID: wallet-uuid-999')).toBeTruthy();
    });
  });

  test('should display empty state with provisioning CTA when customer has no wallets', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue([]);

    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('No Wallets Found')).toBeTruthy();
      expect(getByText('Provision Primary NGN Wallet')).toBeTruthy();
    });

    // Tap provision wallet
    fireEvent.press(getByText('Provision Primary NGN Wallet'));
    
    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith('/customers/test-customer-uuid/wallets', expect.objectContaining({
        type: 'PRIMARY',
        currency: 'NGN',
      }));
    });
  });
});
