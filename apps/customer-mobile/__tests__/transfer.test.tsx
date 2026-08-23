import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SendMoneyScreen } from '../src/screens/authenticated/SendMoneyScreen';
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

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
  });

  test('should validate insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '600'); // More than available 500 Naira
    
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Insufficient wallet balance.')).toBeTruthy();
    });
  });

  test('should execute transfer successfully after confirmation', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-789' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100'); // 100 Naira
    
    fireEvent.press(getByText('Send Funds'));

    // Confirmation dialog should be displayed
    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });

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
    });
  });

  test('should explain 409 idempotency conflict clearly in error banner', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Transfer attempt carrying a different payload', 409)
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '10');
    
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Confirm')).toBeTruthy();
    });

    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      // Explains conflict clearly
      expect(getByText('Transfer attempt carrying a different payload')).toBeTruthy();
    });
  });
});
