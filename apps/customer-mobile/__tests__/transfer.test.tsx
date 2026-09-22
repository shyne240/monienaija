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
    },
  ];

  // Available balance is read through the financial binding read model.
  const mockFinancialAccounts = {
    customerId: 'cust-uuid-555',
    generatedAt: new Date().toISOString(),
    accounts: [
      {
        bindingId: 'binding-uuid-555',
        customerWalletId: 'wallet-source-uuid',
        walletAccountId: 'wallet-account-source-uuid',
        bindingState: 'ACTIVE',
        readState: 'ACTIVE',
        currency: 'NGN',
        balanceMinor: '50000', // 500.00 Naira
        receivingNumber: '7033001122',
        warnings: [],
      },
    ],
    warnings: [],
  };

  const mockRecipient = {
    lookupMode: 'MONIENAIJA_NUMBER',
    displayName: 'Ada Okoro',
    receivingNumber: '7065111760',
    canonicalPhone: null,
    currency: 'NGN',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/recipients/by-number')) return Promise.resolve(mockRecipient);
      if (url.includes('/recipients/by-phone'))
        return Promise.resolve({ ...mockRecipient, lookupMode: 'PHONE' });
      if (url.includes('/financial-accounts')) return Promise.resolve(mockFinancialAccounts);
      if (url.endsWith('/wallets')) return Promise.resolve(mockWallets);
      return Promise.resolve([]);
    });
  });

  test('should validate MonieNaija number shape before attempting resolution', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 7065111760'), 'wallet-uuid-not-a-number');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100');
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('A MonieNaija receiving number is exactly 10 digits.')).toBeTruthy();
    });
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should validate insufficient balance', async () => {
    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 7065111760'), '7065111760');
    fireEvent.changeText(getByPlaceholderText('0.00'), '600'); // More than available 500 Naira

    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Insufficient wallet balance.')).toBeTruthy();
    });
  });

  test('should resolve the receiving number, show safe recipient confirmation, and execute', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-789' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 7065111760'), '7065111760');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100'); // 100 Naira

    fireEvent.press(getByText('Send Funds'));

    // Server-authoritative recipient confirmation first
    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/customers/cust-uuid-555/recipients/by-number?number=7065111760',
      );
      expect(getByText('Confirm Money Transfer')).toBeTruthy();
      expect(getByText(/Ada Okoro/)).toBeTruthy();
    });

    // The PIN dialog is the step-up authorization; no PIN, no transfer.
    fireEvent.changeText(getByPlaceholderText('••••'), '1379');
    fireEvent.press(getByText('Authorize'));

    await waitFor(() => {
      expect(ApiClient.post).toHaveBeenCalledWith(
        '/customers/cust-uuid-555/transfers',
        expect.objectContaining({
          amountMinor: '10000',
          transactionPin: '1379',
        }),
        expect.any(Object),
      );
      // Typed destination: never a hand-entered UUID, never a client source.
      const payload = (ApiClient.post as jest.Mock).mock.calls[0][1];
      expect(payload.destination).toEqual({
        type: 'MONIENAIJA_NUMBER',
        value: '7065111760',
      });
      expect(payload.sourceWalletId).toBeUndefined();
      expect(payload.destinationWalletId).toBeUndefined();
      expect(mockNavigate).toHaveBeenCalledWith('Home');
    });
  });

  test('phone mode resolves through the phone endpoint and sends a PHONE destination', async () => {
    (ApiClient.post as jest.Mock).mockResolvedValue({ id: 'tx-uuid-790' });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.press(getByText('Phone Number'));
    fireEvent.changeText(getByPlaceholderText('e.g. 07065111760'), '07065111760');
    fireEvent.changeText(getByPlaceholderText('0.00'), '50');

    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith(
        '/customers/cust-uuid-555/recipients/by-phone?phone=07065111760',
      );
      expect(getByText('Authorize')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('••••'), '24680');
    fireEvent.press(getByText('Authorize'));

    await waitFor(() => {
      const payload = (ApiClient.post as jest.Mock).mock.calls[0][1];
      expect(payload.destination).toEqual({ type: 'PHONE', value: '07065111760' });
      expect(payload.transactionPin).toBe('24680');
      expect(mockNavigate).toHaveBeenCalledWith('Home');
    });
  });

  test('recipient resolution failure blocks the confirmation and shows the error', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/recipients/'))
        return Promise.reject(new ApiError('Recipient not found', 404));
      if (url.includes('/financial-accounts')) return Promise.resolve(mockFinancialAccounts);
      if (url.endsWith('/wallets')) return Promise.resolve(mockWallets);
      return Promise.resolve([]);
    });

    const { getByPlaceholderText, getByText, queryByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 7065111760'), '7065111760');
    fireEvent.changeText(getByPlaceholderText('0.00'), '100');
    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Recipient not found')).toBeTruthy();
    });
    expect(queryByText('Confirm Money Transfer')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('should explain 409 idempotency conflict clearly in error banner', async () => {
    (ApiClient.post as jest.Mock).mockRejectedValue(
      new ApiError('Transfer attempt carrying a different payload', 409),
    );
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      // A 409 on the transfer reaches the dialog's UNKNOWN branch, which keeps
      // the dialog open so the customer can re-read the conflict explanation.
      if (url.includes('/recipients/'))
        return Promise.resolve({
          accountNumber: '1234567890',
          bankCode: '001',
          accountName: 'Ada Okoro',
          displayName: 'Ada Test Okoro',
          customerReference: 'MN-08065566771',
        });
      if (url.includes('/financial-accounts')) return Promise.resolve(mockFinancialAccounts);
      if (url.endsWith('/wallets')) return Promise.resolve(mockWallets);
      return Promise.resolve([]);
    });

    const { getByPlaceholderText, getByText } = render(<SendMoneyScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('e.g. 7065111760')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('e.g. 7065111760'), '7065111760');
    fireEvent.changeText(getByPlaceholderText('0.00'), '10');

    fireEvent.press(getByText('Send Funds'));

    await waitFor(() => {
      expect(getByText('Authorize')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('••••'), '4321');
    fireEvent.press(getByText('Authorize'));

    await waitFor(() => {
      // Explains conflict clearly (409s that are not PIN-related stay UNKNOWN
      // and surface in the transfer error banner)
      expect(getByText('Transfer attempt carrying a different payload')).toBeTruthy();
    });
  });
});
