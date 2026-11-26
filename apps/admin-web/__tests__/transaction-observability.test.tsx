import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import App from '../src/App';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

describe('Transaction History replaces the legacy global trace and simulator navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.location.hash = '';
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      token: 'synthetic',
      sessionId: 'synthetic',
      principal: {
        type: 'OPERATOR',
        principalId: 'synthetic',
        sessionId: 'synthetic',
        audience: 'workforce-admin',
        roles: ['OPERATIONS'],
        scopes: ['transaction.view'],
        customerAccess: 'NONE',
        assuranceLevel: 'MFA',
      },
    });
    (ApiClient.get as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('transaction-history')
          ? { items: [], nextCursor: null }
          : {
              templateKey: 'DEFAULT_FALLBACK',
              displayName: 'Dashboard',
              description: '',
              isFallback: true,
              widgets: [],
            },
      ),
    );
  });
  test('one history destination, no generic deposit/withdrawal navigation or fee simulation', async () => {
    const view = render(<App />);
    fireEvent.click(view.getByTestId('nav-transfers'));
    expect(await view.findByText('No matching transactions')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Transaction History' })).toBeTruthy();
    for (const key of ['cashIn', 'cashOut', 'cashToCashOps'])
      expect(view.queryByTestId(`nav-${key}`)).toBeNull();
    expect(view.queryByText('Run Simulation')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
  test('read errors stay visible and never trigger settlement commands', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((path: string) =>
      path.includes('transaction-history')
        ? Promise.reject(new Error('Institution scope unavailable'))
        : Promise.resolve({ widgets: [] }),
    );
    const view = render(<App />);
    fireEvent.click(view.getByTestId('nav-transfers'));
    expect(await view.findByText('Institution scope unavailable')).toBeTruthy();
    expect(view.queryByText('Trigger Sandbox Completion')).toBeNull();
    expect(ApiClient.post).not.toHaveBeenCalled();
  });
});
