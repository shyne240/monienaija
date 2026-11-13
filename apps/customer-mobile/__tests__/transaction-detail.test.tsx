import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { TransactionDetailScreen } from '../src/screens/authenticated/TransactionDetailScreen';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => {
  const actual = jest.requireActual('../src/services/api-client');
  return {
    ...actual,
    ApiClient: { get: jest.fn(), post: jest.fn() },
  };
});

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

const mockNavigate = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockParams }),
}));

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: 'transfer-1',
  transferId: 'transfer-1',
  type: 'WALLET_TRANSFER',
  direction: 'SENT',
  amountMinor: '125000',
  currency: 'NGN',
  feeMinor: '0',
  status: 'COMPLETED',
  reference: 'MN-REF-0001',
  narration: 'Rent split',
  counterparty: { displayName: 'Chidi Okeke', receivingNumber: '08030000001' },
  createdAt: '2026-11-12T08:00:00.000Z',
  completedAt: '2026-11-12T08:00:04.000Z',
  failureCode: null,
  failureMessage: null,
  ...overrides,
});

describe('TransactionDetailScreen — receipt backed by /customers/me/transactions/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { transactionId: 'transfer-1' };
  });

  test('renders a completed transfer receipt with amount, reference and counterparty', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(detail());
    const { getByText, getAllByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('NGN ₦1,250.00')).toBeTruthy());

    expect(getByText('Rent split')).toBeTruthy();
    expect(getByText('Chidi Okeke')).toBeTruthy();
    expect(getAllByText('MN-REF-0001').length).toBeGreaterThan(0);
    expect(getByText('Settled transaction')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/transactions/transfer-1');
  });

  test('presents a pending transfer as unresolved, never as settled', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(
      detail({ status: 'PENDING', completedAt: null }),
    );
    const { getByText, queryByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('Status: Pending')).toBeTruthy());

    expect(getByText(/still in progress/)).toBeTruthy();
    expect(queryByText('Settled transaction')).toBeNull();
    expect(queryByText(/Completed at/)).toBeNull();
  });

  test('presents a reconciliation-pending transfer without claiming either outcome', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(
      detail({ status: 'PENDING_RECOVERY', completedAt: null }),
    );
    const { getByText, queryByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('Status: Pending')).toBeTruthy());
    expect(getByText(/neither completed nor failed/)).toBeTruthy();
    expect(queryByText(/amount was not moved/)).toBeNull();
  });

  test('explains a failure using the backend failure message', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(
      detail({
        status: 'FAILED',
        completedAt: null,
        failureCode: 'INSUFFICIENT_FUNDS',
        failureMessage: 'The source wallet did not have enough funds.',
      }),
    );
    const { getByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('Why it did not go through')).toBeTruthy());
    expect(getByText('The source wallet did not have enough funds.')).toBeTruthy();
    expect(getByText('INSUFFICIENT_FUNDS')).toBeTruthy();
  });

  test('falls back to the list preview and owns the gap when no detail record exists', async () => {
    mockParams = {
      transactionId: 'funding-1',
      preview: {
        type: 'FUNDING',
        narration: 'Wallet funding',
        reference: 'FUND-1',
        amountMinor: 50000,
        currency: 'NGN',
        status: 'PENDING',
        createdAt: '2026-11-12T09:00:00.000Z',
      },
    };
    (ApiClient.get as jest.Mock).mockRejectedValue(new ApiError('Transfer not found', 404));

    const { getByText, getAllByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('Receipt unavailable')).toBeTruthy());
    expect(getAllByText('Wallet funding').length).toBeGreaterThan(0);
    expect(getAllByText('FUND-1').length).toBeGreaterThan(0);
    expect(getByText(/do not all expose a receipt here yet/)).toBeTruthy();
  });

  test('prefills a support ticket from the receipt without fabricating an identifier', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValue(detail());
    const { getByText } = render(<TransactionDetailScreen />);

    await waitFor(() => expect(getByText('Get help with this transaction')).toBeTruthy());
    fireEvent.press(getByText('Get help with this transaction'));

    expect(mockNavigate).toHaveBeenCalledWith(
      'CreateSupportTicket',
      expect.objectContaining({
        category: 'TRANSFER',
        subject: 'Issue with transaction MN-REF-0001',
        description: expect.stringContaining('MN-REF-0001'),
      }),
    );
  });
});
