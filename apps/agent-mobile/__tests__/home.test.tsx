import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HomeScreen } from '../src/screens/authenticated/HomeScreen';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/agent-api', () => ({
  getAgentMe: jest.fn(),
}));

const { getAgentMe } = jest.requireMock('../src/services/agent-api') as {
  getAgentMe: jest.Mock;
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('HomeScreen (Agent identity context)', () => {
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

  test('loads GET /agents/me and renders reference + status badge', async () => {
    getAgentMe.mockResolvedValue({
      id: 'agent-uuid-1',
      reference: 'agent-ref-42',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { getByText } = wrap(<HomeScreen />);

    await waitFor(() => expect(getByText('agent-ref-42')).toBeTruthy());
    expect(getByText('ACTIVE')).toBeTruthy();
    expect(getByText(/This build contains the Agent foundation/)).toBeTruthy();
  });

  test('shows a retryable error state when the profile fails to load', async () => {
    getAgentMe.mockRejectedValue(new Error('Request failed with status 500'));

    const { getByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByText('Could not load Agent profile')).toBeTruthy());
  });

  test('does not expose financial actions as working', async () => {
    getAgentMe.mockResolvedValue({
      id: 'agent-uuid-1',
      reference: 'agent-ref-42',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { getByText, queryByText } = wrap(<HomeScreen />);
    await waitFor(() => expect(getByText('Transactions (upcoming)')).toBeTruthy());
    // No functional cash-action button is exposed in the foundation build.
    expect(queryByText('Cash→Wallet')).toBeNull();
    expect(queryByText('Wallet→Cash')).toBeNull();
    expect(queryByText('Cash→Cash')).toBeNull();
  });
});
