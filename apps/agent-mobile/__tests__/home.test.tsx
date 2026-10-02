import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HomeScreen } from '../src/screens/authenticated/HomeScreen';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/agent-api', () => ({
  getAgentProfile: jest.fn(),
  getAgentFinancialPosition: jest.fn(),
  getAgentCapabilities: jest.fn(),
  getAgentReceivingNumber: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  getAgentProfile: jest.Mock;
  getAgentFinancialPosition: jest.Mock;
  getAgentCapabilities: jest.Mock;
  getAgentReceivingNumber: jest.Mock;
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const apiError = (message: string, status: number) => {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ApiError';
  e.status = status;
  return e;
};

const profileFixture = {
  id: 'agent-uuid-1',
  reference: 'agent-ref-42',
  status: 'ACTIVE',
  agentClassId: 'class-1',
  agentClass: { id: 'class-1', reference: 'ac-1', code: 'SILVER', name: 'Silver Agent', isActive: true },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const financialFixture = {
  agentId: 'agent-uuid-1',
  currency: 'NGN',
  balanceMinor: '250000',
  availableBalanceMinor: '250000',
  walletExists: true,
  walletId: 'wallet-internal-id',
  ledgerAccountId: 'ledger-internal-id',
  status: 'ACTIVE',
};

const capabilitiesFixture = {
  agentId: 'agent-uuid-1',
  permittedServices: ['CASH_IN'],
  evaluations: [
    { service: 'CASH_IN', canonicalService: 'CASH_IN', allowed: true, reason: null },
    { service: 'CASH_OUT', canonicalService: 'CASH_OUT', allowed: false, reason: 'Not assigned to your agent class' },
    { service: 'CASH_TO_CASH', canonicalService: 'CASH_TO_CASH', allowed: false, reason: 'Not assigned to your agent class' },
  ],
};

const receivingFixture = {
  id: 'recv-1',
  agentId: 'agent-uuid-1',
  receivingNumber: '2348000001',
  status: 'ACTIVE',
  assignedAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('HomeScreen (real Agent operating context)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      agentId: 'agent-uuid-1',
      session: {
        accessToken: 't',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        agentId: 'agent-uuid-1',
        sessionId: 's',
      },
      pendingRotation: null,
      error: null,
    });
  });

  test('loading state: balance shows a distinct loading indicator', () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockReturnValue(new Promise(() => {}));
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByTestId } = wrap(<HomeScreen />);
    expect(getByTestId('financial-loading')).toBeTruthy();
  });

  test('success: identity+class, balance from server minor units, receiving number, capabilities', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByText, getByTestId } = wrap(<HomeScreen />);

    await waitFor(() => expect(getByTestId('agent-reference')).toBeTruthy());
    expect(getByText('agent-ref-42')).toBeTruthy();
    expect(getByText('ACTIVE')).toBeTruthy();
    expect(getByText('Silver Agent · Class SILVER')).toBeTruthy();
    // Server value 250000 kobo formatted for display only (no client business math).
    expect(getByText('₦2,500.00')).toBeTruthy();
    expect(getByText('2348000001')).toBeTruthy();
    expect(getByTestId('capability-state-cash-in')).toBeTruthy();
    expect(getByText('Enabled')).toBeTruthy();
  });

  test('failure: financial-position failure shows retry and does not invent a balance', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockRejectedValue(apiError('boom', 500));
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByTestId, queryByTestId } = wrap(<HomeScreen />);

    await waitFor(() => expect(getByTestId('financial-retry')).toBeTruthy());
    expect(queryByTestId('financial-balance')).toBeNull();
  });

  test('retry refetches the financial position after failure', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition
      .mockRejectedValueOnce(apiError('boom', 500))
      .mockResolvedValueOnce(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByTestId, getByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByTestId('financial-retry')).toBeTruthy());
    fireEvent.press(getByTestId('financial-retry'));
    await waitFor(() => expect(getByText('₦2,500.00')).toBeTruthy());
    expect(mockApi.getAgentFinancialPosition).toHaveBeenCalledTimes(2);
  });

  test('no-wallet state renders an explicit message instead of a fake balance', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue({
      agentId: 'agent-uuid-1', currency: 'NGN', balanceMinor: '0', availableBalanceMinor: '0', walletExists: false,
    });
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByTestId } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByTestId('financial-no-wallet')).toBeTruthy());
  });

  test('capability-driven visibility is fail-closed: denied services show reason, never enabled', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByTestId, getAllByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByTestId('capability-state-cash-out')).toBeTruthy());
    expect(getAllByText('Unavailable')).toHaveLength(2);
    expect(getByTestId('capability-reason-cash-out')).toBeTruthy();
  });

  test('session-expired (401) surfaces the established message, not a raw server error', async () => {
    mockApi.getAgentProfile.mockRejectedValue(apiError('Unauthorized', 401));
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getAllByText } = wrap(<HomeScreen />);
    await waitFor(() =>
      expect(getAllByText('Your session has expired. Please log in again.').length).toBeGreaterThan(0),
    );
  });

  test('financial card never renders internal ledger/wallet identifiers', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { queryByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(queryByText('₦2,500.00')).toBeTruthy());
    expect(queryByText(/wallet-internal-id/)).toBeNull();
    expect(queryByText(/ledger-internal-id/)).toBeNull();
  });

  test('receiving number: unassigned state renders NONE presentation', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(null);

    const { getByTestId } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByTestId('receiving-none')).toBeTruthy());
  });

  test('no functional transaction actions are exposed in this phase', async () => {
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentFinancialPosition.mockResolvedValue(financialFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);

    const { getByText, queryByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByText('Transactions & History (upcoming)')).toBeTruthy());
    expect(queryByText('Execute')).toBeNull();
  });
});
