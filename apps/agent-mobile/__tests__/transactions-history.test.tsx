import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TransactionsScreen } from '../src/screens/authenticated/TransactionsScreen';
import { TransactionReceiptScreen } from '../src/screens/authenticated/TransactionReceiptScreen';
import { useAuthStore } from '../src/store/auth-store';
import type { AgentHistoryItem } from '../src/services/agent-api';

jest.mock('../src/services/agent-api', () => ({
  getAgentTransactions: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  getAgentTransactions: jest.Mock;
};

let mockRoute: any = { key: 'k', name: 'Transactions', params: {} };
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => mockRoute,
}));

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

const cashInRow: AgentHistoryItem = {
  id: 'journal-internal-uuid-1',
  type: 'CASH_IN',
  status: 'COMPLETED',
  amountMinor: '250000',
  currency: 'NGN',
  direction: 'DEBIT',
  createdAt: '2026-06-02T10:15:00.000Z',
  completedAt: '2026-06-02T10:15:01.000Z',
  reference: 'CASH_IN-c2w-abc',
  narration: null,
  feeMinor: '0',
  counterparty: { type: 'CUSTOMER' },
  commission: null,
  failureCode: null,
  failureMessage: null,
};

const c2cRow: AgentHistoryItem = {
  id: 'transfer-internal-uuid-2',
  type: 'CASH_TO_CASH',
  status: 'UNCLAIMED',
  amountMinor: '500000',
  currency: 'NGN',
  direction: 'DEBIT',
  createdAt: '2026-06-03T09:00:00.000Z',
  completedAt: null,
  reference: 'C2C-x1',
  narration: 'Cash→Cash for 08030000099',
  feeMinor: '5000',
  counterparty: { type: 'CUSTOMER', beneficiaryPhone: '08030000099' },
  commission: { commissionMinor: '2500', payable: true, treatment: 'ACCRUE' },
  failureCode: null,
  failureMessage: null,
};

const fundingRow: AgentHistoryItem = {
  id: 'journal-internal-uuid-3',
  type: 'AGENT_FUNDING',
  status: 'COMPLETED',
  amountMinor: '7500000',
  currency: 'NGN',
  direction: 'CREDIT',
  createdAt: '2026-06-01T08:00:00.000Z',
  completedAt: '2026-06-01T08:00:04.000Z',
  reference: 'FUND-77',
  narration: null,
  feeMinor: '0',
  counterparty: { type: 'AGGREGATOR', aggregatorId: 'internal-aggregator-uuid-77' },
  commission: null,
  failureCode: null,
  failureMessage: null,
};

const pageOf = (items: AgentHistoryItem[], hasNextPage = false) => ({
  items,
  pagination: { page: 1, limit: items.length, total: items.length, totalPages: 1, hasNextPage },
});

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('TransactionsScreen (unified Agent history)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ agentId: 'agent-uuid-1' });
  });

  test('B.loading state renders while fetching', () => {
    mockApi.getAgentTransactions.mockReturnValue(new Promise(() => {}));
    const { getByText } = wrap(<TransactionsScreen />);
    expect(getByText('Loading Agent transaction history...')).toBeTruthy();
  });

  test('B.empty state when server returns no rows', async () => {
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([]));
    const { getByTestId, getByText } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(getByTestId('history-empty')).toBeTruthy());
    expect(getByText(/executed Agent transactions will appear here/)).toBeTruthy();
  });

  test('B.populated rows render type/status/amount/time/reference/counterparty safely', async () => {
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([cashInRow, c2cRow, fundingRow]));
    const { getAllByText, getByText, getByTestId, queryByText } = wrap(<TransactionsScreen />);

    await waitFor(() => expect(getByTestId('transaction-row-journal-internal-uuid-1')).toBeTruthy());
    expect(getAllByText('Cash→Wallet').length).toBeGreaterThan(0); // chip + CASH_IN row label
    expect(getAllByText('Cash→Cash').length).toBeGreaterThan(0); // chip + C2C row label
    expect(getByText('Agent Funding')).toBeTruthy(); // unique to the funding row
    // Direction signs from contract field, not string matching:
    expect(getByText('−₦2,500.00')).toBeTruthy();
    expect(getByText('+₦75,000.00')).toBeTruthy();
    // Statuses verbatim from server:
    expect(getAllByText('COMPLETED')).toHaveLength(2);
    expect(getByText('UNCLAIMED')).toBeTruthy();
    // Reference + counterparty safe fields:
    expect(getByText('Ref: CASH_IN-c2w-abc')).toBeTruthy();
    expect(getByText('Customer · beneficiary 08030000099')).toBeTruthy();
    expect(getByText('Aggregator')).toBeTruthy();
    // Fee/commission rendered where authoritative:
    expect(getByText('Fee ₦50.00')).toBeTruthy();
    expect(getByText('Commission ₦25.00')).toBeTruthy();
    // NEVER internal ids:
    expect(queryByText(/journal-internal|transfer-internal/)).toBeNull();
    expect(queryByText(/internal-aggregator-uuid-77/)).toBeNull();
  });

  test('B.filter chips issue server-side type filter', async () => {
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([cashInRow]));
    const { getByTestId } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(getByTestId('filter-cash_in')).toBeTruthy());
    fireEvent.press(getByTestId('filter-cash_to_cash'));
    await waitFor(() =>
      expect(mockApi.getAgentTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CASH_TO_CASH', page: 1 }),
      ),
    );
  });

  test('B.load-more enlarges the page limit while server reports hasNextPage', async () => {
    mockApi.getAgentTransactions.mockResolvedValue({
      items: [cashInRow],
      pagination: { page: 1, limit: 20, total: 25, totalPages: 2, hasNextPage: true },
    });
    const { getByTestId } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(getByTestId('history-load-more')).toBeTruthy());
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([cashInRow]));
    fireEvent.press(getByTestId('history-load-more'));
    await waitFor(() =>
      expect(mockApi.getAgentTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 40 }),
      ),
    );
  });

  test('A.failure shows sanitized error and retry refetches', async () => {
    mockApi.getAgentTransactions.mockRejectedValueOnce(apiError('SQL dump secret 9', 500)).mockResolvedValueOnce(pageOf([cashInRow]));
    const { getByText, getByTestId, queryByText } = wrap(<TransactionsScreen />);
    await waitFor(() =>
      expect(getByText('The service is temporarily unavailable. Please retry.')).toBeTruthy(),
    );
    fireEvent.press(getByText(/Try|Retry/));
    await waitFor(() => expect(getByTestId('transaction-row-journal-internal-uuid-1')).toBeTruthy());
    expect(queryByText(/SQL dump secret 9/)).toBeNull();
  });

  test('A.session-expiry surfaces established message (401 purge stays API-client-side)', async () => {
    mockApi.getAgentTransactions.mockRejectedValue(apiError('Unauthorized', 401));
    const { getByText } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(getByText('Your session has expired. Please log in again.')).toBeTruthy());
  });

  test('B.tapping a row navigates to the history-derived receipt with small params only', async () => {
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([cashInRow]));
    const { getByTestId } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(getByTestId('transaction-row-journal-internal-uuid-1')).toBeTruthy());
    fireEvent.press(getByTestId('transaction-row-journal-internal-uuid-1'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionReceipt', {
      itemId: 'journal-internal-uuid-1',
      filter: undefined,
    });
    const params = (mockNavigate.mock.calls[0]?.[1] as any);
    expect(Object.keys(params).sort()).toEqual(['filter', 'itemId']);
  });

  test('B.receipt renders from cached history row; missing row shows honest state', async () => {
    mockApi.getAgentTransactions.mockResolvedValue(pageOf([c2cRow]));
    const { client } = wrap(<TransactionsScreen />);
    await waitFor(() => expect(client.getQueryData(['agent-transactions', 'agent-uuid-1', 'ALL', 20])).toBeTruthy());

    // Prime cache through screen render, then route to the receipt screen:
    mockRoute = { key: 'k', name: 'TransactionReceipt', params: { itemId: 'transfer-internal-uuid-2' } };
    const receiptView = render(
      <QueryClientProvider client={client}>
        <TransactionReceiptScreen />
      </QueryClientProvider>,
    );
    expect(receiptView.getByTestId('history-receipt')).toBeTruthy();
    expect(receiptView.getByTestId('receipt-heading').props.children).toBe('Cash→Cash Receipt');
    expect(receiptView.getByTestId('receipt-status').props.children).toBe('UNCLAIMED');

    mockRoute = { key: 'k', name: 'TransactionReceipt', params: { itemId: 'not-cached' } };
    const missingView = render(
      <QueryClientProvider client={client}>
        <TransactionReceiptScreen />
      </QueryClientProvider>,
    );
    expect(missingView.getByTestId('history-receipt-missing')).toBeTruthy();
  });
});
