import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DashboardScreen } from '../src/screens/authenticated/DashboardScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import type { ResolvedWidget } from '../src/components/dashboard/types';

/**
 * ARENA 6 — dashboard card drill-downs.
 *
 * A tile is worth clicking only if the click lands somewhere the operator can act, and a tile is
 * worth showing at all only if its numbers are read from a source that answered. These tests pin the
 * four ways that goes wrong: a button offered for a workspace this session cannot open (a dead
 * control), no button where the registry declared one (a lost route), a restricted placement that
 * still fetches, and an unusable payload rendered as "nothing to see".
 */

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const calls = ApiClient.get as jest.Mock;

const principalWith = (scopes: string[], roles = ['OPERATIONS']) =>
  useAuthStore.setState({
    isAuthenticated: true,
    sessionId: 'test',
    principal: {
      type: 'OPERATOR',
      principalId: 'test',
      sessionId: 'test',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as any,
  });

const configuration = (widgets: unknown[]) => ({
  templateKey: 'TEST',
  displayName: 'Test',
  description: '',
  isFallback: false,
  widgets,
});

const exceptionsPayload = {
  period: '7d',
  from: '2026-10-29T00:00:00.000Z',
  to: '2026-11-05T00:00:00.000Z',
  availability: 'MEASURED',
  configuration: 'CONFIGURED',
  totals: {
    deliveries: 12,
    exceptions: 3,
    byStatus: [
      { status: 'SENT', count: 9 },
      { status: 'FAILED', count: 2 },
      { status: 'DEAD', count: 1 },
    ],
  },
  errorCodes: [{ errorCode: 'PROVIDER_TIMEOUT', count: 2, lastSeenAt: '2026-11-04T00:00:00.000Z' }],
  // ARENA 6 follow-up: the dashboard carries only the aggregate, its labeled window and the policy
  // statement. The fields above are kept in the fixture to prove the tile ignores them.
  window: {
    hours: 24,
    from: '2026-11-04T00:00:00.000Z',
    to: '2026-11-05T00:00:00.000Z',
    label: '7d window, 2026-11-04T00:00 to 2026-11-05T00:00 UTC',
    boundary: 'half-open: created_at >= from AND created_at < to (UTC)',
  },
  policy: {
    manualRetrySupported: false,
    policyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
  },
  retry: {
    pending: 1,
    failedAwaitingRetry: 1,
    dead: 1,
    unknown: 0,
    oldestPendingAt: '2026-11-03T00:00:00.000Z',
    nextScheduledRetryAt: '2026-11-05T02:00:00.000Z',
    manualRetrySupported: false,
    policyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
  },
  provider: {
    availability: 'CHECKED',
    projectionScope: 'MINIMAL',
    channels: [{ channel: 'SMS', available: true }],
  },
  definition:
    'Exception count is FAILED + DEAD + UNKNOWN deliveries created in the window. Read-only: recovery is the worker automatic retry.',
  checkedAt: '2026-11-05T10:00:00.000Z',
  source: 'notification_deliveries via DashboardWidgetDataService',
};

const widget = (overrides: Partial<ResolvedWidget>): ResolvedWidget =>
  ({
    widgetKey: 'notification-delivery-exceptions',
    displayName: 'Notification Delivery Exceptions',
    description: 'Delivery exceptions in the selected period.',
    order: 1,
    fetchMode: 'proxy',
    kind: 'status-breakdown',
    authorized: true,
    ...overrides,
  }) as ResolvedWidget;

/** The dashboard config is the first call; every widget read is matched on its own path. */
const route = (dashboard: unknown[], widgetResponses: Record<string, unknown> = {}) =>
  calls.mockImplementation(async (path: string) => {
    if (path.endsWith('/my-dashboard')) return configuration(dashboard);
    for (const [needle, value] of Object.entries(widgetResponses)) {
      if (path.includes(needle)) return value;
    }
    throw new Error('Synthetic unavailable');
  });

beforeEach(() => {
  jest.resetAllMocks();
  principalWith(['notification.view_deliveries', 'workforce.dashboard.view']);
});

describe('ARENA 6 — dashboard drill-down', () => {
  it('deep-links the exceptions card into the failures, not the whole queue', async () => {
    route([widget({ requiredFunctions: ['notification.view_deliveries'] })], {
      'notification-delivery-exceptions': exceptionsPayload,
    });
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);

    const button = await screen.findByTestId('notification-exceptions-drilldown');
    expect(button.textContent).toContain('Investigate failures');
    fireEvent.click(button);
    // The card's own labeled window travels with the status, and it is the half-open interval the
    // aggregate was computed over — otherwise the list would carry the rows stamped exactly at `to` that
    // the number above it deliberately excludes.
    expect(onNavigate).toHaveBeenCalledWith('notificationOperations', {
      notificationFrom: '2026-11-04T00:00:00.000Z',
      notificationTo: '2026-11-05T00:00:00.000Z',
      notificationToExclusive: true,
      notificationStatus: 'FAILED',
    });
  });

  it('refuses a MEASURED answer that cannot state its window, instead of showing a bare number', async () => {
    route([widget({ requiredFunctions: ['notification.view_deliveries'] })], {
      'notification-delivery-exceptions': { ...exceptionsPayload, window: undefined },
    });
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);

    // An aggregate with no interval is not comparable to anything, so the client will not render it as
    // though it were — and it certainly will not offer a drill-down keyed to a window it never saw.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/did not return a usable answer/i);
    expect(screen.queryByTestId('notification-exceptions-drilldown')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders no button at all when the resolved widget carries no drill-down', async () => {
    route(
      [
        widget({
          widgetKey: 'kyc-queue-summary',
          displayName: 'KYC Queue',
          kind: 'status-breakdown',
          requiredFunctions: ['kyc.view'],
        }),
      ],
      { 'kyc-queue-summary': { byStatus: [{ status: 'PENDING', count: 1 }] } },
    );
    principalWith(['kyc.view', 'workforce.dashboard.view']);
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);
    await screen.findByText('KYC Queue');
    expect(screen.queryByTestId('widget-drilldown-kyc-queue-summary')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('offers no route into a workspace this session cannot open', async () => {
    // The governance tile is authorized by the server (it holds workforce.role.view), so its numbers
    // are read; the workspace behind it additionally requires an assigner role. The tile must not
    // offer a control that would only produce a denial.
    route([
      widget({
        widgetKey: 'role-governance-queue',
        displayName: 'Role Definition Proposals',
        kind: 'table',
        fetchMode: 'direct',
        endpoint: '/internal/a2/workforce/role-definitions/proposals',
        requiredFunctions: ['workforce.role.view'],
        drilldown: { view: 'roleGovernance', label: 'Open role governance →' },
      }),
    ]);
    principalWith(['workforce.role.view', 'workforce.dashboard.view']);
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);
    await screen.findByText('Role Definition Proposals');
    expect(screen.queryByTestId('widget-drilldown-role-governance-queue')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    // The tile was still read: authorization to *see* a summary and authorization to *open* the
    // workspace behind it are separate decisions, and only the second one gates the control.
    expect(calls.mock.calls.map(([path]) => path)).toEqual([
      '/internal/a2/workforce/dashboard/my-dashboard',
      '/internal/a2/workforce/role-definitions/proposals',
    ]);
  });

  it('shows an unrestricted route for a card whose target this session can open', async () => {
    // Same registry entry, this time held by an administrator who can assign: the button appears and
    // carries the operator straight to the declared workspace.
    route([
      widget({
        widgetKey: 'role-governance-queue',
        displayName: 'Role Definition Proposals',
        kind: 'table',
        fetchMode: 'direct',
        endpoint: '/internal/a2/workforce/role-definitions/proposals',
        requiredFunctions: ['workforce.role.view'],
        drilldown: { view: 'roleGovernance', label: 'Open role governance →' },
      }),
    ]);
    principalWith(['workforce.role.view', 'workforce.role.assign'], ['SUPER_ADMIN']);
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);
    const button = await screen.findByTestId('widget-drilldown-role-governance-queue');
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith('roleGovernance', {});
  });

  it('suppresses the action for a restricted placement and names the missing function', async () => {
    calls.mockResolvedValue(
      configuration([
        widget({
          authorized: false,
          requiredFunctions: ['notification.view_deliveries'],
          drilldown: { view: 'notificationOperations', label: 'Open notification operations →' },
        }),
      ]),
    );
    principalWith(['workforce.dashboard.view']);
    const onNavigate = jest.fn();
    render(<DashboardScreen onNavigate={onNavigate} />);
    await screen.findByText(/notification\.view_deliveries/i);
    expect(screen.queryByTestId(/widget-drilldown/)).toBeNull();
    expect(screen.queryByTestId('notification-exceptions-drilldown')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    // A restricted card is not fetched: the restriction is decided before any request is made.
    expect(calls.mock.calls.map(([path]) => path)).toEqual([
      '/internal/a2/workforce/dashboard/my-dashboard',
    ]);
  });

  it('calls a placed-but-restricted placement "Restricted", not "Not configured"', async () => {
    calls.mockImplementation(async (path: string) => {
      if (path.endsWith('/my-dashboard'))
        return configuration([
          widget({
            widgetKey: 'transaction-summary',
            displayName: 'Transaction summary',
            kind: 'kpi',
            requiredFunctions: ['transaction.view'],
          }),
          widget({
            widgetKey: 'agent-lifecycle-summary',
            displayName: 'Agent Network Summary',
            kind: 'status-breakdown',
            authorized: false,
            requiredFunctions: ['agent.view'],
          }),
        ]);
      throw new Error('Synthetic unavailable');
    });
    principalWith(['transaction.view', 'workforce.dashboard.view']);
    render(<DashboardScreen />);
    // The summary card answers "Restricted" for the agent panel, and the agent tile itself carries
    // the same wording: the source exists in this template, this session just may not read it.
    await waitFor(() => expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Permission required').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not configured')).toBeNull();
  });

  it('shows an error rather than an empty state when the exception source returns something unusable', async () => {
    route([widget({ requiredFunctions: ['notification.view_deliveries'] })], {
      'notification-delivery-exceptions': { totals: { deliveries: 'twelve' } },
    });
    render(<DashboardScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/did not return a usable answer/i);
    expect(alert.textContent).toMatch(/not a zero/i);
    expect(screen.queryByText(/no data available/i)).toBeNull();
  });

  it('states on the card that manual retry is out of policy, and cites the policy', async () => {
    route([widget({ requiredFunctions: ['notification.view_deliveries'] })], {
      'notification-delivery-exceptions': exceptionsPayload,
    });
    render(<DashboardScreen />);
    const note = await screen.findByTestId('notification-exceptions-policy');
    expect(note.textContent).toMatch(/manual retry is not part of the approved delivery policy/i);
    expect(note.textContent).toContain('docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md');
    // The figures carry their own as-at time so a stale read is recognizable as a stale read.
    expect(await screen.findByTestId('notification-exceptions-drilldown')).toBeTruthy();
  });
});
