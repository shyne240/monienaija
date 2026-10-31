import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { LimitAssignmentScreen } from '../src/screens/authenticated/LimitAssignmentScreen';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

function setPrincipal(roles: string[], scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: 'OPERATOR',
      principalId: `issuer:${roles[0] ?? 'test'}`,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Admin Web batch 03: limit read-only diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockResolvedValue({ items: [] });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('usage and reservation panels query existing filtered, paginated read endpoints and render structured rows', async () => {
    setPrincipal(['FINANCE_AUDITOR'], ['limit.view']);
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/limit-assignments') return Promise.resolve({ items: [] });
      if (path.startsWith('/internal/limit-usages?')) {
        return Promise.resolve({ page: 1, limit: 20, total: 21, totalPages: 2, data: [{ id: 'usage-1', principalType: 'AGENT', principalId: 'agent-123', limitProfileCode: 'AGENT_STANDARD', product: 'CASH_IN', dimension: 'PER_DAY', currency: 'NGN', windowStart: '2026-10-23T00:00:00.000Z', usedAmountMinor: '250000', usedCount: 2, reservedAmountMinor: '50000', reservedCount: 1 }] });
      }
      if (path.startsWith('/internal/limit-reservations?')) {
        return Promise.resolve({ page: 1, limit: 20, total: 1, totalPages: 1, staleThresholdMinutes: 30, data: [{ id: 'reservation-1', status: 'RESERVED', principalType: 'AGENT', principalId: 'agent-123', limitProfileCode: 'AGENT_STANDARD', product: 'CASH_IN', amountMinor: '50000', currency: 'NGN', reservedAt: '2026-10-23T09:00:00.000Z', ageSeconds: 3600, stale: true, correlationId: 'corr-1' }] });
      }
      return Promise.resolve({ items: [] });
    });

    const view = render(<LimitAssignmentScreen />);
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-assignments'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-usages'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-reservations'));

    fireEvent.change(view.getAllByPlaceholderText('Profile code')[0], { target: { value: 'AGENT_STANDARD' } });
    fireEvent.change(view.getAllByPlaceholderText('Product')[0], { target: { value: 'CASH_IN' } });
    fireEvent.click(view.getByRole('button', { name: 'Search usage' }));
    expect((await view.findAllByText('250000')).length).toBeGreaterThan(0);
    expect(view.getByText('Total 21 · Page 1 of 2')).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-usages?page=1&limit=20&limitProfileCode=AGENT_STANDARD&product=CASH_IN');
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-usages?page=2&limit=20&limitProfileCode=AGENT_STANDARD&product=CASH_IN'));

    fireEvent.change(view.getByLabelText('Stale only'), { target: { value: 'true' } });
    fireEvent.click(view.getByRole('button', { name: 'Search reservations' }));
    expect(await view.findByText(/Stale threshold 30 min/)).toBeTruthy();
    expect((await view.findAllByText('3,600')).length).toBeGreaterThan(0);
    expect(view.getByText(/Total 1 · Page 1 of 1/)).toBeTruthy();
    expect(ApiClient.get).toHaveBeenCalledWith('/internal/limit-reservations?page=1&limit=20&stale=true');
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.queryByText('requestHash')).toBeNull();
  });

  test('assignment-only principals do not issue assignment list or diagnostics GET requests without limit.view', async () => {
    setPrincipal(['AGENT_NETWORK_MANAGER'], ['agent.assign_limit']);
    const view = render(<LimitAssignmentScreen />);
    expect(view.getByTestId('limit-view-required-notice')).toBeTruthy();
    expect(view.getByText(/shown only to principals with/)).toBeTruthy();
    expect(ApiClient.get).not.toHaveBeenCalled();
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-usages'));
    expect(ApiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/internal/limit-reservations'));
  });
});
