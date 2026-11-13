import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { AddMoneyScreen } from '../src/screens/authenticated/AddMoneyScreen';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

jest.mock('../src/store/auth-store', () => ({
  useAuthStore: () => ({ customerId: 'customer-1' }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const dashboard = (overrides: Record<string, unknown> = {}) => ({
  identity: { id: 'customer-1' },
  profile: null,
  balance: {
    wallets: [{ id: 'w1', currency: 'NGN', status: 'ACTIVE', balanceMinor: '1000' }],
    primary: { id: 'w1', currency: 'NGN', status: 'ACTIVE', balanceMinor: '1000' },
  },
  receivingIdentity: '08031234567',
  recentTransactions: { items: [] },
  ...overrides,
});

const route = (options: { dashboard?: unknown; requests?: unknown; limits?: unknown }) =>
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/customers/me/dashboard') return Promise.resolve(options.dashboard);
    if (url.startsWith('/customers/me/funding-requests')) {
      return Promise.resolve(options.requests ?? { items: [] });
    }
    if (url === '/customers/me/limits') return Promise.resolve(options.limits ?? { products: [] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });

describe('AddMoneyScreen — honest funding entry point', () => {
  beforeEach(() => jest.clearAllMocks());

  test('states that in-app funding does not exist rather than showing a fake deposit form', async () => {
    route({ dashboard: dashboard() });
    const { getByText, queryByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getByText('Fund your wallet')).toBeTruthy());

    expect(getByText(/In-app funding is not available in this release/)).toBeTruthy();
    expect(queryByText(/Enter amount/i)).toBeNull();
    // No client-side money movement is attempted from this screen.
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('shows the real receiving number so an agent can credit the wallet', async () => {
    route({ dashboard: dashboard() });
    const { getAllByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getAllByText('08031234567').length).toBeGreaterThan(0));
  });

  test('renders recorded funding requests with their real statuses', async () => {
    route({
      dashboard: dashboard(),
      requests: {
        items: [
          {
            id: 'fr-1',
            reference: 'FUND-1',
            amountMinor: '250000',
            currency: 'NGN',
            status: 'PENDING',
            externalReference: null,
            channel: 'CUSTOMER_FUNDING',
            description: null,
            createdAt: '2026-11-12T09:00:00.000Z',
            approvedAt: null,
            rejectedAt: null,
            rejectionReason: null,
          },
          {
            id: 'fr-2',
            reference: 'FUND-2',
            amountMinor: '100000',
            currency: 'NGN',
            status: 'REJECTED',
            externalReference: null,
            channel: 'CUSTOMER_FUNDING',
            description: null,
            createdAt: '2026-11-11T09:00:00.000Z',
            approvedAt: null,
            rejectedAt: '2026-11-11T10:00:00.000Z',
            rejectionReason: 'Reference could not be reconciled.',
          },
        ],
      },
    });
    const { getByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getByText('Funding history')).toBeTruthy());

    expect(getByText('NGN ₦2,500.00')).toBeTruthy();
    expect(getByText('NGN ₦1,000.00')).toBeTruthy();
    expect(getByText('Reference could not be reconciled.')).toBeTruthy();
  });

  test('explains a customer record with no wallet instead of offering to fund nothing', async () => {
    route({
      dashboard: dashboard({ balance: { wallets: [], primary: null }, receivingIdentity: null }),
    });
    const { getByText, queryByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getByText('No wallet to fund yet')).toBeTruthy());
    expect(queryByText('Receiving number')).toBeNull();
    expect(getByText(/Fund your wallet/)).toBeTruthy();
  });

  test('surfaces incoming limits the backend actually configured', async () => {
    route({
      dashboard: dashboard(),
      limits: {
        customerId: 'customer-1',
        currency: 'NGN',
        asOf: '2026-11-13T10:00:00.000Z',
        products: [
          {
            product: 'CASH_TO_WALLET',
            direction: 'INCOMING',
            currency: 'NGN',
            configured: true,
            perTransactionMinMinor: '10000',
            perTransactionMaxMinor: '500000',
            walletBalanceMaxMinor: '1000000',
            windows: [
              {
                dimension: 'product',
                period: 'DAILY',
                kind: 'AMOUNT',
                limitMinor: '1000000',
                limitCount: null,
                remainingMinor: '750000',
                remainingCount: null,
              },
            ],
          },
        ],
      },
    });
    const { getByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getByText('Incoming limits')).toBeTruthy());
    expect(getByText('Cash deposit through an agent')).toBeTruthy();
    expect(getByText('Per transaction up to ₦5,000.00')).toBeTruthy();
    expect(getByText(/₦7,500\.00 remaining/)).toBeTruthy();
  });
});
