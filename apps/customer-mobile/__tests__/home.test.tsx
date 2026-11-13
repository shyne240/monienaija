import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const dashboardFixture = (overrides: Record<string, unknown> = {}) => ({
  identity: {
    id: 'customer-1',
    reference: 'CUS-0001',
    type: 'INDIVIDUAL',
    status: 'ACTIVE',
    kycLevel: 'LEVEL_1',
    kycStatus: 'APPROVED',
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  profile: { id: 'profile-1', displayName: 'Amaka Obi', legalName: 'Amaka Obi' },
  balance: {
    wallets: [{ id: 'wallet-uuid-999', currency: 'NGN', status: 'ACTIVE', balanceMinor: '250000' }],
    primary: { id: 'wallet-uuid-999', currency: 'NGN', status: 'ACTIVE', balanceMinor: '250000' },
  },
  receivingIdentity: '08031234567',
  recentTransactions: { items: [] },
  ...overrides,
});

const kycFixture = (overrides: Record<string, unknown> = {}) => ({
  customerId: 'customer-1',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  assessment: { level: 'LEVEL_1', status: 'APPROVED', reason: null, expiresAt: null },
  policy: { configured: true, version: 1 },
  requirements: {
    level: 'LEVEL_2',
    regulatory: { all: ['PHONE'], any: [['BVN']] },
    operator: { all: [], any: [] },
  },
  evidenceAssessment: {
    status: 'UNAVAILABLE',
    reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
    note: 'Evidence cannot be assessed.',
  },
  lastEvaluation: null,
  manualHold: null,
  upgradePathway: { status: 'EVIDENCE_UNAVAILABLE', nextLevel: 'LEVEL_2' },
  asOf: '2026-11-13T10:00:00.000Z',
  ...overrides,
});

const routeGet = (mocks: { dashboard: unknown; kyc: unknown }) =>
  (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/customers/me/dashboard') return Promise.resolve(mocks.dashboard);
    if (url === '/customers/me/kyc') return Promise.resolve(mocks.kyc);
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

/**
 * ARENA 4 — the dashboard now reads ONE backend projection (`GET /customers/me/dashboard`) plus the
 * customer KYC projection, instead of composing `/me/wallets` and `/me/transactions` in the client.
 * Every assertion below checks that a value the backend returned is rendered as returned, and that
 * absent data is presented as absent rather than filled in.
 */
describe('HomeScreen banking dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the backend balance, greeting name and receiving number', async () => {
    routeGet({ dashboard: dashboardFixture(), kyc: kycFixture() });

    const { getByText, getAllByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(ApiClient.get).toHaveBeenCalledWith('/customers/me/dashboard');
      expect(getByText('Amaka Obi')).toBeTruthy();
      expect(getByText('₦2,500.00')).toBeTruthy();
      expect(getAllByText('08031234567').length).toBeGreaterThan(0);
    });

    // The receivable figure is presented as a receiving number, not as an invented NUBAN.
    expect(getByText('Your receiving number')).toBeTruthy();
  });

  test('hides the balance on request without changing the underlying value', async () => {
    routeGet({ dashboard: dashboardFixture(), kyc: kycFixture() });
    const { getByText, queryByText, getByLabelText } = render(<HomeScreen />);

    await waitFor(() => expect(getByText('₦2,500.00')).toBeTruthy());

    fireEvent.press(getByLabelText('Hide balance'));

    expect(queryByText('₦2,500.00')).toBeNull();
    expect(getByText('••••••')).toBeTruthy();

    fireEvent.press(getByLabelText('Show balance'));
    expect(getByText('₦2,500.00')).toBeTruthy();
  });

  test('explains a customer record with no provisioned wallet instead of showing a balance', async () => {
    routeGet({
      dashboard: dashboardFixture({
        balance: { wallets: [], primary: null },
        receivingIdentity: null,
      }),
      kyc: kycFixture({ kycLevel: 'NONE', kycStatus: 'NOT_STARTED' }),
    });

    const { getByText, queryByText } = render(<HomeScreen />);

    await waitFor(() => expect(getByText('No wallet provisioned yet')).toBeTruthy());

    expect(queryByText('Available balance')).toBeNull();
    expect(getByText('Contact support')).toBeTruthy();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });

  test('renders recent unified transactions and opens the receipt', async () => {
    routeGet({
      dashboard: dashboardFixture({
        recentTransactions: {
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
              createdAt: '2026-11-12T08:00:00.000Z',
            },
          ],
        },
      }),
      kyc: kycFixture(),
    });

    const { getByText, getByLabelText } = render(<HomeScreen />);

    await waitFor(() => expect(getByText('Rent split')).toBeTruthy());
    fireEvent.press(getByLabelText(/Rent split/));

    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', {
      transactionId: 'transfer-1',
      preview: expect.objectContaining({ reference: 'ref-1', status: 'COMPLETED' }),
    });
  });

  test('shows the real tier and an honest upgrade pathway, never a fabricated rejection', async () => {
    routeGet({ dashboard: dashboardFixture(), kyc: kycFixture() });
    const { getByText, queryByText } = render(<HomeScreen />);

    await waitFor(() => expect(getByText('Tier 1 · Verified')).toBeTruthy());

    expect(getByText('Approved · policy v1')).toBeTruthy();
    expect(getByText('Your Tier 2 · Enhanced upgrade is not yet assessable')).toBeTruthy();
    expect(queryByText(/unmet|failed requirement/i)).toBeNull();
  });

  test('reports a load failure and offers retry rather than showing a balance', async () => {
    (ApiClient.get as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    const { getByText, queryByText } = render(<HomeScreen />);

    await waitFor(() => expect(getByText('Network request failed')).toBeTruthy());

    expect(queryByText('Available balance')).toBeNull();
    expect(getByText('Retry')).toBeTruthy();
  });
});
