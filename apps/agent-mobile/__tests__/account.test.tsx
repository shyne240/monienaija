import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AccountScreen } from '../src/screens/authenticated/AccountScreen';
import { useAuthStore } from '../src/store/auth-store';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../src/services/agent-api', () => ({
  getAgentProfile: jest.fn(),
  getAgentReceivingNumber: jest.fn(),
  getAgentCapabilities: jest.fn(),
  getAgentOutlets: jest.fn(),
  getAgentTerminals: jest.fn(),
  getAgentTransactionPinStatus: jest.fn(),
  describeApiError: jest.requireActual('../src/services/agent-api').describeApiError,
}));

const mockApi = jest.requireMock('../src/services/agent-api') as {
  getAgentProfile: jest.Mock;
  getAgentReceivingNumber: jest.Mock;
  getAgentCapabilities: jest.Mock;
  getAgentOutlets: jest.Mock;
  getAgentTerminals: jest.Mock;
  getAgentTransactionPinStatus: jest.Mock;
};

const profileFixture = {
  id: 'agent-uuid-9',
  reference: 'ref-agent-9',
  status: 'ACTIVE',
  agentClassId: 'class-2',
  agentClass: { id: 'class-2', reference: 'ac-2', code: 'GOLD', name: 'Gold Agent', isActive: true },
  createdAt: '2025-06-15T00:00:00.000Z',
  updatedAt: '2025-06-15T00:00:00.000Z',
};

const capabilitiesFixture = {
  agentId: 'agent-uuid-9',
  permittedServices: ['CASH_IN', 'CASH_OUT'],
  evaluations: [
    { service: 'CASH_IN', canonicalService: 'CASH_IN', allowed: true, reason: null },
    { service: 'CASH_OUT', canonicalService: 'CASH_OUT', allowed: true, reason: null },
    { service: 'CASH_TO_CASH', canonicalService: 'CASH_TO_CASH', allowed: false, reason: 'Requires upgraded class' },
  ],
};

const pinStatusFixture = {
  status: 'ACTIVE' as const,
  exists: true,
  accountLocked: false,
  pinVersion: 1,
};

const outletsFixture = [
  {
    id: 'outlet-1', agentId: 'agent-uuid-9', reference: 'o-ref-1', code: 'OUT-01',
    name: 'HQ Outlet', displayName: 'HQ — Wuse 2', status: 'ACTIVE',
    addressLine: '12 Aminu Kano Cres', city: 'Abuja', state: 'FCT', country: 'NG',
    createdAt: '2025-06-15T00:00:00.000Z', updatedAt: '2025-06-15T00:00:00.000Z',
  },
  {
    id: 'outlet-2', agentId: 'agent-uuid-9', reference: 'o-ref-2', code: 'OUT-02',
    name: 'Branch Outlet', displayName: null, status: 'SUSPENDED',
    addressLine: null, city: 'Lagos', state: 'Lagos', country: 'NG',
    createdAt: '2025-06-15T00:00:00.000Z', updatedAt: '2025-06-15T00:00:00.000Z',
  },
];

const terminalsFixture = [
  {
    id: 'term-1', agentId: 'agent-uuid-9', outletId: 'outlet-1', reference: 't-ref-1',
    code: 'TERM-01', label: 'Counter POS', status: 'ACTIVE', serialNumber: 'SN-9981',
    createdAt: '2025-06-15T00:00:00.000Z', updatedAt: '2025-06-15T00:00:00.000Z',
  },
];

const receivingFixture = {
  id: 'recv-9', agentId: 'agent-uuid-9', receivingNumber: '2348000009', status: 'ACTIVE',
  assignedAt: '2025-06-16T00:00:00.000Z', revokedAt: null,
  createdAt: '2025-06-16T00:00:00.000Z', updatedAt: '2025-06-16T00:00:00.000Z',
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AccountScreen (real Agent information)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      agentId: 'agent-uuid-9',
      session: {
        accessToken: 't', tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 60000).toISOString(), agentId: 'agent-uuid-9', sessionId: 's',
      },
      pendingRotation: null,
      error: null,
    });
    mockApi.getAgentProfile.mockResolvedValue(profileFixture);
    mockApi.getAgentReceivingNumber.mockResolvedValue(receivingFixture);
    mockApi.getAgentCapabilities.mockResolvedValue(capabilitiesFixture);
    mockApi.getAgentOutlets.mockResolvedValue(outletsFixture);
    mockApi.getAgentTerminals.mockResolvedValue(terminalsFixture);
    mockApi.getAgentTransactionPinStatus.mockResolvedValue(pinStatusFixture);
  });

  test('renders profile, class, receiving number, PIN status, support entry, outlets, terminals from backend data', async () => {
    const { getAllByText, getByText, getByTestId, queryByText } = wrap(<AccountScreen />);

    await waitFor(() => expect(getByTestId('account-reference')).toBeTruthy());
    expect(getByText('ref-agent-9')).toBeTruthy();
    expect(getAllByText('ACTIVE').length).toBeGreaterThan(0);
    expect(getByText('Gold Agent (GOLD)')).toBeTruthy();
    expect(getByText('2348000009')).toBeTruthy();

    // PIN status card (V1-AGENT-MOBILE-10)
    expect(getByTestId('account-pin-card')).toBeTruthy();
    expect(getByTestId('account-pin-status').props.children).toBe('ACTIVE');
    expect(getByTestId('nav-transaction-pin')).toBeTruthy();

    fireEvent.press(getByTestId('nav-transaction-pin'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionPinManage');

    // Support card (V1-AGENT-MOBILE-11)
    expect(getByTestId('account-support-card')).toBeTruthy();
    expect(getByTestId('nav-support')).toBeTruthy();
    fireEvent.press(getByTestId('nav-support'));
    expect(mockNavigate).toHaveBeenCalledWith('Support');

    // Outlets
    expect(getByText('HQ — Wuse 2')).toBeTruthy();
    expect(getByText(/12 Aminu Kano Cres/)).toBeTruthy();
    expect(getByText('Branch Outlet')).toBeTruthy();
    // Terminal joined to outlet presentation
    expect(getByText('Counter POS')).toBeTruthy();
    expect(getAllByText(/HQ — Wuse 2/).length).toBeGreaterThan(1);
    expect(getByText(/SN-9981/)).toBeTruthy();

    // Raw secrets/passwords are never displayed.
    expect(queryByText(/password/i)).toBeNull();
  });

  test('capability summary is fail-closed (requires upgraded class never shown as enabled)', async () => {
    const { getAllByText, getByText, getByTestId } = wrap(<AccountScreen />);
    await waitFor(() => expect(getByTestId('account-capabilities-list')).toBeTruthy());
    expect(getAllByText('Enabled')).toHaveLength(2);
    expect(getAllByText('Unavailable')).toHaveLength(1);
    expect(getByText('Requires upgraded class')).toBeTruthy();
  });

  test('empty outlets and terminals render explicit empty states', async () => {
    mockApi.getAgentOutlets.mockResolvedValue([]);
    mockApi.getAgentTerminals.mockResolvedValue([]);
    const { getByTestId } = wrap(<AccountScreen />);
    await waitFor(() => expect(getByTestId('account-outlets-empty')).toBeTruthy());
    expect(getByTestId('account-terminals-empty')).toBeTruthy();
  });

  test('logout invokes the auth store logout flow', async () => {
    const logoutMock = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout: logoutMock as never, isLoading: false });
    const { getByTestId } = wrap(<AccountScreen />);
    await waitFor(() => expect(getByTestId('account-logout')).toBeTruthy());
    fireEvent.press(getByTestId('account-logout'));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  test('profile failure shows retry and never raw server errors', async () => {
    const e = new Error('Request failed with status 500') as Error & { status: number };
    e.name = 'ApiError';
    e.status = 500;
    mockApi.getAgentProfile.mockRejectedValue(e);
    const { getByTestId, getByText, queryByText } = wrap(<AccountScreen />);
    await waitFor(() => expect(getByTestId('account-profile-retry')).toBeTruthy());
    expect(getByText('The service is temporarily unavailable. Please retry.')).toBeTruthy();
    expect(queryByText('Request failed with status 500')).toBeNull();
  });
});
