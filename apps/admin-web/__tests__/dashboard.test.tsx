import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useAuthStore } from '../src/store/auth-store';
import { ApiClient, ApiError } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  }
  return {
    ApiClient: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: MockApiError,
  };
});

function setPrincipal(roles: string[], scopes: string[] = []) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'dash-bearer',
    sessionId: 'dash-sess',
    principal: {
      type: 'PRIVILEGED',
      principalId: 'iss:v1-super-admin-principal',
      sessionId: 'dash-sess',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('Admin Web Portal — V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 real dashboard rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(['SUPER_ADMIN'], ['privileged:execute']);
  });

  test('renders KPI tiles and a byType breakdown from a real-shaped transaction-summary response, and never shows a "profit" figure', async () => {
    const dashboard = {
      templateKey: 'EXECUTIVE_GOVERNANCE',
      displayName: 'Executive & Governance',
      description: 'Platform-wide executive overview.',
      isFallback: false,
      widgets: [
        {
          widgetKey: 'transaction-summary',
          order: 2,
          displayName: 'Transaction Summary',
          description: 'desc',
          fetchMode: 'proxy',
          supportsPeriodFilter: true,
          kind: 'kpi-summary',
          authorized: true,
        },
      ],
    };
    const summary = {
      period: '7d',
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      currency: 'NGN',
      totalCompletedCount: 42,
      totalCompletedValueMinor: '1000000',
      totalFailedCount: 3,
      totalPendingCount: 1,
      successRatePercent: 93.33,
      totalFeeRevenueMinor: '15000',
      feeRevenueNote: 'Fee revenue note text',
      byType: [
        { type: 'W2W', completedCount: 20, completedValueMinor: '500000', failedCount: 1, pendingCount: 0, feeRevenueMinor: '7500' },
        { type: 'C2W', completedCount: 10, completedValueMinor: '300000', failedCount: 1, pendingCount: 1, feeRevenueMinor: null },
        { type: 'W2C', completedCount: 8, completedValueMinor: '150000', failedCount: 1, pendingCount: 0, feeRevenueMinor: null },
        { type: 'C2C', completedCount: 4, completedValueMinor: '50000', failedCount: 0, pendingCount: 0, feeRevenueMinor: '7500' },
      ],
      commission: null,
      commissionNote: 'No verified commission source.',
    };

    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(dashboard);
      if (url.startsWith('/internal/a2/workforce/dashboard/widgets/transaction-summary')) return Promise.resolve(summary);
      return Promise.resolve(undefined);
    });

    const { findByText, getAllByText, queryByText } = render(<App />);

    expect(await findByText('Transaction Summary')).toBeTruthy();
    expect(await findByText('42')).toBeTruthy(); // completed count (volume)
    expect(await findByText('₦10,000.00')).toBeTruthy(); // completed value (1,000,000 kobo)
    expect(await findByText('₦150.00')).toBeTruthy(); // fee revenue (15,000 kobo)
    expect(getAllByText('N/A (no fee column)').length).toBe(2); // C2W + W2C fee cells

    // Never label fee revenue as profit, and never show a profit figure.
    expect(queryByText(/^Profit$/i)).toBeNull();
    expect(queryByText(/profit:/i)).toBeNull();
  });

  test('shows a restricted tile (and never fetches) for a widget the backend marked unauthorized', async () => {
    const dashboard = {
      templateKey: 'FRAUD_CASE_MONITORING',
      displayName: 'Fraud Case Monitoring',
      description: 'desc',
      isFallback: false,
      widgets: [
        {
          widgetKey: 'ledger-summary',
          order: 2,
          displayName: 'Ledger Summary',
          description: 'desc',
          fetchMode: 'proxy',
          kind: 'status-breakdown',
          authorized: false,
        },
      ],
    };
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(dashboard);
      return Promise.resolve(undefined);
    });

    const { findByText } = render(<App />);

    expect(await findByText(/Restricted/)).toBeTruthy();
    // The restricted widget's own data endpoint must never be called.
    const calledUrls = (ApiClient.get as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calledUrls.some((u: string) => u.includes('/widgets/ledger-summary'))).toBe(false);
  });

  test('shows a clear error state when the dashboard fetch fails, without crashing the page', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.reject(new Error('Network unreachable'));
      return Promise.resolve(undefined);
    });

    const { findByText } = render(<App />);
    expect(await findByText(/Unable to load your dashboard/)).toBeTruthy();
  });

  test('shows a safe-fallback badge when the backend reports isFallback with a reason', async () => {
    const dashboard = {
      templateKey: 'DEFAULT_FALLBACK',
      displayName: 'Default Dashboard',
      description: 'Safe minimum dashboard.',
      isFallback: true,
      fallbackReason: 'No active dashboard template assignment found for any held role.',
      widgets: [],
    };
    (ApiClient.get as jest.Mock).mockResolvedValue(dashboard);

    const { findByText } = render(<App />);
    expect(await findByText(/Default dashboard —/)).toBeTruthy();
  });
});

describe('Admin Web Portal — Dashboard Settings (role → template assignment)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(['SUPER_ADMIN'], ['privileged:execute']);
  });

  const templates = [
    {
      id: 't1',
      templateKey: 'EXECUTIVE_GOVERNANCE',
      displayName: 'Executive & Governance',
      description: 'desc',
      operationalArea: 'EXECUTIVE_GOVERNANCE',
      isActive: true,
      layout: { widgets: [{ widgetKey: 'transaction-summary', order: 0 }] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 't2',
      templateKey: 'RECONCILIATION_VISIBILITY',
      displayName: 'Reconciliation Visibility',
      description: 'desc',
      operationalArea: 'RECONCILIATION_VISIBILITY',
      isActive: true,
      layout: { widgets: [{ widgetKey: 'reconciliation-status', order: 0 }] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const assignments = [
    { id: 'a1', roleKey: 'TREASURY', templateKey: 'RECONCILIATION_VISIBILITY', assignedBy: 'system-seed', assignedAt: new Date().toISOString() },
  ];

  test('lists templates and current role assignments, and successfully reassigns a role to a different existing template', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({ templateKey: 'EXECUTIVE_GOVERNANCE', displayName: 'x', description: '', isFallback: false, widgets: [] });
      }
      if (url === '/internal/a2/workforce/dashboard/templates') return Promise.resolve(templates);
      if (url === '/internal/a2/workforce/dashboard/assignments') return Promise.resolve(assignments);
      if (url === '/internal/a2/workforce/dashboard/widget-registry') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    (ApiClient.put as jest.Mock).mockResolvedValue({
      id: 'a1',
      roleKey: 'TREASURY',
      templateKey: 'EXECUTIVE_GOVERNANCE',
      assignedBy: 'iss:v1-super-admin-principal',
      assignedAt: new Date().toISOString(),
      reason: 'new template for broader visibility',
    });

    const { getByText, findByText, findAllByText, getByDisplayValue } = render(<App />);

    fireEvent.click(getByText('⚙️ Dashboard Settings'));

    expect((await findAllByText('EXECUTIVE_GOVERNANCE')).length).toBeGreaterThan(0);
    expect(getByText('TREASURY')).toBeTruthy();

    const select = getByDisplayValue('RECONCILIATION_VISIBILITY') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'EXECUTIVE_GOVERNANCE' } });

    fireEvent.click(getByText('Save'));

    await waitFor(() => {
      expect(ApiClient.put).toHaveBeenCalledWith('/internal/a2/workforce/dashboard/assignments/TREASURY', {
        templateKey: 'EXECUTIVE_GOVERNANCE',
        reason: undefined,
      });
    });
    expect(await findByText(/now EXECUTIVE_GOVERNANCE/)).toBeTruthy();
  });

  test('shows a clear permission-denied state (not a crash) when the backend returns 403', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({ templateKey: 'DEFAULT_FALLBACK', displayName: 'x', description: '', isFallback: true, widgets: [] });
      }
      return Promise.reject(new ApiError('Caller lacks required function: workforce.dashboard.view', 403));
    });

    const { getByText, findByText } = render(<App />);
    fireEvent.click(getByText('⚙️ Dashboard Settings'));

    expect(await findByText(/do not have permission to view or change dashboard configuration/)).toBeTruthy();
  });

  test('shows a clear, specific error message (not a silent failure) when saving an assignment is rejected', async () => {
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({ templateKey: 'EXECUTIVE_GOVERNANCE', displayName: 'x', description: '', isFallback: false, widgets: [] });
      }
      if (url === '/internal/a2/workforce/dashboard/templates') return Promise.resolve(templates);
      if (url === '/internal/a2/workforce/dashboard/assignments') return Promise.resolve(assignments);
      if (url === '/internal/a2/workforce/dashboard/widget-registry') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    (ApiClient.put as jest.Mock).mockRejectedValue(new ApiError("Dashboard template 'GHOST' is not a known, active template.", 400));

    const { getByText, findByText, getByDisplayValue } = render(<App />);
    fireEvent.click(getByText('⚙️ Dashboard Settings'));

    const select = await waitFor(() => getByDisplayValue('RECONCILIATION_VISIBILITY') as HTMLSelectElement);
    fireEvent.change(select, { target: { value: 'EXECUTIVE_GOVERNANCE' } });
    fireEvent.click(getByText('Save'));

    expect(await findByText(/is not a known, active template/)).toBeTruthy();
  });
});
