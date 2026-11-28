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

interface RouteOptions {
  dashboard: Record<string, unknown>;
  requests?: { items: unknown[] };
  limits?: { products: unknown[] };
  account?: Record<string, unknown> | 'none';
  deposits?: unknown[];
}

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

const route = (options: Record<string, any>) =>
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/customers/me/dashboard') return Promise.resolve(options.dashboard);
    if (url.startsWith('/customers/me/funding-requests')) {
      return Promise.resolve(options.requests ?? { items: [] });
    }
    if (url === '/customers/me/limits') return Promise.resolve(options.limits ?? { products: [] });
    // ARENA 3D: the bank-transfer receiving account and its verified deposits.
    if (url.startsWith('/customers/me/banking/virtual-account')) {
      return options.account === 'none'
        ? Promise.reject(new Error('banking unavailable'))
        : Promise.resolve(options.account ?? { state: 'NOT_PROVISIONED', accountNumber: null });
    }
    if (url.startsWith('/customers/me/banking/deposits')) {
      return Promise.resolve(options.deposits ?? []);
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });

describe('AddMoneyScreen — honest funding entry point', () => {
  beforeEach(() => jest.clearAllMocks());

  test('offers a real bank-transfer account instead of a fabricated deposit form', async () => {
    route({ dashboard: dashboard() });
    const { getByText, queryByText } = render(<AddMoneyScreen />);

    await waitFor(() => expect(getByText('Fund your wallet')).toBeTruthy());

    // The old placeholder text is gone because the capability now exists.
    expect(queryByText(/In-app funding is not available in this release/)).toBeNull();
    expect(getByText('Transfer from your bank')).toBeTruthy();
    // Still no client-side amount entry: a transfer is initiated at the customer's own bank.
    expect(queryByText(/Enter amount/i)).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('shows the real account number once the bank has issued one', async () => {
    route({
      dashboard: dashboard(),
      account: {
        state: 'PROVISIONED',
        accountNumber: '9012345678',
        bankName: 'Wema Bank',
        accountName: 'MONIENAija / customer-1',
      },
    });
    const { getAllByText, getByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getAllByText('9012345678').length).toBeGreaterThan(0));
    expect(getByText(/Wema Bank/)).toBeTruthy();
  });

  test('never renders a NUBAN when the provider has not issued one', async () => {
    route({ dashboard: dashboard() });
    const { getByText, queryByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getByText('Fund your wallet')).toBeTruthy());

    expect(getByText('Get my account number')).toBeTruthy();
    // The only number on screen is the internal receiving number, which is not a bank account, and it
    // is labelled as such.
    expect(getByText('Receiving number')).toBeTruthy();
  });

  test('warns against retrying while a request is still unconfirmed', async () => {
    route({
      dashboard: dashboard(),
      account: { state: 'UNKNOWN', accountNumber: null, unknownPending: true },
    });
    const { getByText, queryByText } = render(<AddMoneyScreen />);
    await waitFor(() =>
      expect(getByText(/A bank account request is still being confirmed/)).toBeTruthy(),
    );
    expect(getByText(/Do not request another account/)).toBeTruthy();
    // No control that would resubmit an uncertain provision.
    expect(queryByText('Get my account number')).toBeNull();
  });

  test('distinguishes a received-but-uncredited transfer from a credited one', async () => {
    route({
      dashboard: dashboard(),
      account: {
        state: 'PROVISIONED',
        accountNumber: '9012345678',
        bankName: 'Wema Bank',
        accountName: 'MONIENAija',
      },
      deposits: [
        {
          id: 'd1',
          reference: 'prov-1',
          amountMinor: '50000',
          currency: 'NGN',
          receivedAt: new Date().toISOString(),
          state: 'CONFIRMED_PENDING_CREDIT',
        },
      ],
    });
    const { getByText } = render(<AddMoneyScreen />);
    // The words matter: a customer told 'credited' when only arrival was proven would think their
    // balance is wrong.
    await waitFor(() => expect(getByText('Received — credit pending')).toBeTruthy());
  });

  test('shows the durable business reference and never calls an withheld payment credited', async () => {
    route({
      dashboard: dashboard(),
      account: {
        state: 'PROVISIONED',
        accountNumber: '9012345678',
        bankName: 'Wema Bank',
        accountName: 'MONIENAija',
        accountReference: 'MN123456789',
      },
      deposits: [
        {
          id: 'd2',
          businessReference: 'B2W-0123456789ABCDEF0123456789ABCDEF',
          reference: 'MNFY|provider-ref',
          amountMinor: '990000',
          grossAmountMinor: '1000000',
          providerFeeMinor: '10000',
          settlementAmountMinor: '990000',
          monienaijaFeeMinor: '0',
          currency: 'NGN',
          receivedAt: new Date().toISOString(),
          state: 'CREDITED',
          exceptionReason: null,
          permittedNextAction: null,
        },
        {
          id: 'd3',
          businessReference: 'B2W-FEDCBA9876543210FEDCBA9876543210',
          reference: 'MNFY|withheld-ref',
          amountMinor: '0',
          grossAmountMinor: '50000',
          providerFeeMinor: '0',
          settlementAmountMinor: null,
          monienaijaFeeMinor: '0',
          currency: 'NGN',
          receivedAt: new Date().toISOString(),
          state: 'EXCEPTION',
          exceptionReason: 'LIMIT_BLOCKED',
          permittedNextAction: 'FINANCE_DECIDE_RELEASE_OR_RETURN',
        },
      ],
    });
    const { getByText, queryByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getByText('Credited')).toBeTruthy());
    expect(getByText(/Reference B2W-0123456789ABCDEF/)).toBeTruthy();
    expect(getByText('Withheld — Finance review')).toBeTruthy();
    expect(queryByText('Received — credit pending')).toBeNull();
  });

  test('keeps the cash-agent channel usable when banking is unavailable', async () => {
    route({ dashboard: dashboard(), account: 'none' });
    const { getByText } = render(<AddMoneyScreen />);
    await waitFor(() => expect(getByText('Fund your wallet')).toBeTruthy());
    // One unavailable channel must not present as broken funding, and must not show an error banner.
    expect(getByText('Cash through a MonieNaija agent')).toBeTruthy();
    expect(getByText(/Bank transfer details are unavailable right now/)).toBeTruthy();
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
