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
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

/**
 * V1-CUSTOMER-02 — rewritten against the REAL authorization contract.
 * The previous version of this test hit the legacy unauthenticated
 * `/transfers` endpoint with no Transaction PIN at all, which made a real
 * authorization gap look like a passing test (a PIN field in the UI is
 * NOT proof the backend enforces it). This version asserts the actual
 * endpoint (`/customers/me/transfers`), the actual wallet source
 * (`/customers/me/wallets`), that the PIN is sent, and that it is cleared
 * from memory after submission.
 */
describe('Send Money (Transfer) Screen Tests', () => {
  const mockWallets = [
    {
      id: 'wallet-source-uuid',
      currency: 'NGN',
      status: 'ACTIVE',
      balanceMinor: 50000, // 500.00 Naira
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue(mockWallets);
  });

  const fillAndSubmit = async (
    getByPlaceholderText: any,
    getByText: any,
    { destination = '12345678-1234-1234-1234-123456789012', amount = '100', pin = '1234' } = {},
  ) => {
    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), destination);
    fireEvent.changeText(getByPlaceholderText('0.00'), amount);
    fireEvent.changeText(getByPlaceholderText('••••'), pin);

    fireEvent.press(getByText('Send Funds'));
  };

  test('loads the wallet from the authenticated /customers/me/wallets endpoint', async () => {
    render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/wallets');
    });
  });

  test('should require a Transaction PIN before allowing submission', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 5e6f7g8h-...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 5e6f7g8h-...'), '12345678-1234-1234-1234-123456789012');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100');
    // PIN left blank
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Enter your 4-12 digit Transaction PIN.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should validate insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText, { amount: '600' });

    await waitFor(() => {
      expect(getByText('Insufficient wallet balance.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should execute transfer against the real PIN-protected endpoint and clear the PIN afterward', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-789', status: 'COMPLETED' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText, { amount: '100', pin: '4321' });

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });

    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/me/transfers',
        expect.objectContaining({
          sourceWalletId: 'wallet-source-uuid',
          destinationWalletId: '12345678-1234-1234-1234-123456789012',
          amountMinor: '10000',
          pin: '4321',
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('Home');
    });

    // The PIN input must never remain in rendered state after a successful submit.
    expect(getByPlaceholderText('••••').props.value).toBe('');
  });

  test('should surface a locked-PIN failure in plain language and clear the PIN field', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Customer PIN is locked', 401),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(
        getByText('Your Transaction PIN is locked due to too many failed attempts. Contact support to continue.'),
      ).toBeTruthy();
    });
    expect(getByPlaceholderText('••••').props.value).toBe('');
  });

  test('should explain a LIMIT_* failure code in plain language', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Daily transfer amount exceeded', 422, 'LIMIT_DAILY_AMOUNT_EXCEEDED'),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(
        getByText('This transfer exceeds an account transaction limit. Try a smaller amount or contact support.'),
      ).toBeTruthy();
    });
  });

  test('should explain a 409 idempotency conflict clearly in the error banner', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('The idempotency key was already used for another transfer', 409),
    );

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await fillAndSubmit(getByPlaceholderText, getByText);

    await waitFor(() => {
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
    });
    fireEvent.press(getByText('Confirm'));

    await waitFor(() => {
      expect(getByText('The idempotency key was already used for another transfer')).toBeTruthy();
    });
  });
});
