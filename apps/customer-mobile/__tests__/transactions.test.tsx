import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { TransactionsScreen } from '../src/screens/authenticated/TransactionsScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
  },
}));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

/**
 * V1-CUSTOMER-07 — rewritten against the REAL, authenticated,
 * ownership-scoped, UNIFIED `GET /customers/me/transactions` endpoint,
 * which merges Wallet→Wallet, Wallet→Cash, Cash→Wallet, Cash→Cash, and
 * funding activity. The previous version of this test asserted the
 * Wallet→Wallet-only `GET /customers/me/transfers` endpoint.
 */
describe('Transactions Screen History Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load and render paginated transactions from /customers/me/transactions', async () => {
    const mockTxResponse = {
      items: [
        {
          id: 'tx-uuid-1',
          type: 'WALLET_TRANSFER',
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
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/transactions?page=1&limit=15');
      expect(getByText('Grocery funding')).toBeTruthy();
      expect(getByText('-₦45.00')).toBeTruthy();
    });
  });

  test('renders every V1 flow type with correct direction, label, and status', async () => {
    const mockTxResponse = {
      items: [
        {
          id: 'w2w-in',
          type: 'WALLET_TRANSFER',
          narration: null,
          reference: 'ref-w2w-in',
          amountMinor: '100000',
          currency: 'NGN',
          direction: 'RECEIVED',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
          counterparty: { displayName: 'John Customer' },
        },
        {
          id: 'cash-out',
          type: 'CASH_OUT',
          narration: null,
          reference: 'ref-cash-out',
          amountMinor: '200000',
          currency: 'NGN',
          direction: 'DEBIT',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'cash-in',
          type: 'CASH_IN',
          narration: null,
          reference: 'ref-cash-in',
          amountMinor: '300000',
          currency: 'NGN',
          direction: 'CREDIT',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'c2c-pending',
          type: 'CASH_TO_CASH',
          narration: null,
          reference: 'ref-c2c-pending',
          amountMinor: '50000',
          currency: 'NGN',
          direction: 'PENDING',
          status: 'UNCLAIMED',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'c2c-expired',
          type: 'CASH_TO_CASH',
          narration: null,
          reference: 'ref-c2c-expired',
          amountMinor: '60000',
          currency: 'NGN',
          direction: 'EXPIRED',
          status: 'EXPIRED',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    (ApiClient.get as jest.Mock).mockResolvedValueOnce(mockTxResponse);

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(getByText('Received from John Customer')).toBeTruthy();
      expect(getByText('+₦1,000.00')).toBeTruthy();

      expect(getByText('Cash Withdrawal via Agent')).toBeTruthy();
      expect(getByText('-₦2,000.00')).toBeTruthy();

      expect(getByText('Cash Deposit via Agent')).toBeTruthy();
      expect(getByText('+₦3,000.00')).toBeTruthy();

      expect(getByText('Cash Transfer Awaiting Claim')).toBeTruthy();
      expect(getByText('Cash Transfer Expired (Unclaimed)')).toBeTruthy();
      // Neutral (not-yet-settled / terminal-unsuccessful) amounts render without a sign.
      expect(getByText('₦500.00')).toBeTruthy();
      expect(getByText('₦600.00')).toBeTruthy();
    });
  });

  test('should render empty state correctly', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({ items: [] });

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(getByText('No transaction records found.')).toBeTruthy();
    });
  });

  test('should render an error banner when the request fails, without crashing', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValueOnce(new Error('network down'));

    const { getByText } = render(<TransactionsScreen />);

    await waitFor(() => {
      expect(getByText('Failed to load transactions.')).toBeTruthy();
    });
  });

  /**
   * V1-CUSTOMER-09 Part G — tapping "Get help" on a wallet-transfer row
   * navigates to CreateSupportTicket with the existing `relatedTransferId`
   * field (no new backend field invented), fully prefilled and editable.
   */
  test('"Get help" on a WALLET_TRANSFER row prefills category/subject/description and relatedTransferId', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          id: 'transfer-uuid-1',
          type: 'WALLET_TRANSFER',
          narration: 'Rent',
          reference: 'REF-ABC-123',
          amountMinor: '150000',
          currency: 'NGN',
          direction: 'SENT',
          status: 'COMPLETED',
          createdAt: new Date('2026-01-15T10:00:00Z').toISOString(),
        },
      ],
    });

    const { findByTestId } = render(<TransactionsScreen />);
    const helpButton = await findByTestId('transaction-row-get-help');
    fireEvent.press(helpButton);

    expect(mockNavigate).toHaveBeenCalledWith(
      'CreateSupportTicket',
      expect.objectContaining({
        category: 'TRANSFER',
        relatedTransferId: 'transfer-uuid-1',
        subject: expect.stringContaining('REF-ABC-123'),
        description: expect.stringContaining('REF-ABC-123'),
      }),
    );
    // No fundingRequestId should leak onto an unrelated WALLET_TRANSFER context.
    expect((mockNavigate.mock.calls[0][1] as Record<string, unknown>).fundingRequestId).toBeUndefined();
  });

  test('"Get help" on a FUNDING row prefills fundingRequestId instead of relatedTransferId', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          id: 'funding-uuid-1',
          type: 'FUNDING',
          narration: 'Wallet top-up',
          reference: 'FUND-REF-9',
          amountMinor: '500000',
          currency: 'NGN',
          direction: 'RECEIVED',
          status: 'COMPLETED',
          createdAt: new Date('2026-01-10T10:00:00Z').toISOString(),
        },
      ],
    });

    const { findByTestId } = render(<TransactionsScreen />);
    fireEvent.press(await findByTestId('transaction-row-get-help'));

    expect(mockNavigate).toHaveBeenCalledWith(
      'CreateSupportTicket',
      expect.objectContaining({ category: 'FUNDING', fundingRequestId: 'funding-uuid-1' }),
    );
    expect((mockNavigate.mock.calls[0][1] as Record<string, unknown>).relatedTransferId).toBeUndefined();
  });

  test('"Get help" on a CASH_TO_CASH row embeds the reference in the description with no new id field', async () => {
    (ApiClient.get as jest.Mock).mockResolvedValueOnce({
      items: [
        {
          id: 'c2c-uuid-1',
          type: 'CASH_TO_CASH',
          narration: null,
          reference: 'C2C-REF-7',
          amountMinor: '200000',
          currency: 'NGN',
          direction: 'SENT',
          status: 'UNCLAIMED',
          createdAt: new Date('2026-01-05T10:00:00Z').toISOString(),
        },
      ],
    });

    const { findByTestId } = render(<TransactionsScreen />);
    fireEvent.press(await findByTestId('transaction-row-get-help'));

    const [, params] = mockNavigate.mock.calls[0];
    expect(params).toEqual(
      expect.objectContaining({ category: 'CASH_TO_CASH', description: expect.stringContaining('C2C-REF-7') }),
    );
    expect(params.relatedTransferId).toBeUndefined();
    expect(params.fundingRequestId).toBeUndefined();
  });
});
