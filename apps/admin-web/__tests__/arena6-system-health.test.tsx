import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SystemHealthScreen } from '../src/screens/authenticated/SystemHealthScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

/**
 * ARENA 6 — the component and availability drill-down on System Health.
 *
 * The panel used to answer "is the platform healthy" with a single word. These tests pin the three
 * answers an operator actually needs — what was checked and what each state means, when that was
 * measured, and which sources could not be read at all — and in particular the rule that an unreadable
 * source is stated as unreadable instead of being rendered as a healthy blank.
 */

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const calls = ApiClient.get as jest.Mock;

const principal = (scopes: string[]) =>
  useAuthStore.setState({
    principal: {
      type: 'OPERATOR',
      principalId: 'ops',
      sessionId: 'ops',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    } as any,
  });

const diagnostics = (components: unknown) => ({
  status: 'degraded',
  timestamp: '2026-11-05T10:00:00.000Z',
  database: { status: 'ok' },
  migrations: { status: 'ok', appliedCount: 42 },
  reconciliation: { status: 'WARNING' },
  pendingOutbox: 4,
  components,
});

const fiveComponents = [
  {
    key: 'database',
    label: 'Database',
    state: 'ok',
    availability: 'CHECKED',
    meaning: 'A trivial query returned, so connections are being served.',
    detail: { reachable: true },
    checkedAt: '2026-11-05T09:59:58.000Z',
    source: 'DiagnosticsService → SELECT 1',
  },
  {
    key: 'migrations',
    label: 'Migrations',
    state: 'ok',
    availability: 'CHECKED',
    meaning: '42 migrations are recorded as applied.',
    detail: { appliedCount: 42 },
    checkedAt: '2026-11-05T09:59:58.100Z',
    source: 'DiagnosticsService → typeorm_migrations',
  },
  {
    key: 'reconciliation',
    label: 'Reconciliation',
    state: 'degraded',
    availability: 'CHECKED',
    meaning: 'The reconciliation run reported a WARNING.',
    detail: { status: 'WARNING' },
    checkedAt: '2026-11-05T09:59:58.200Z',
    source: 'ReconciliationService.runReconciliation()',
  },
  {
    key: 'outbox',
    label: 'Outbox backlog',
    state: 'degraded',
    availability: 'CHECKED',
    meaning: 'Events are waiting to be published or retried.',
    detail: { pendingOrFailed: 4 },
    checkedAt: '2026-11-05T09:59:58.300Z',
    source: 'DiagnosticsService → outbox_events',
  },
  {
    key: 'workers',
    label: 'Worker supervision',
    state: 'unknown',
    availability: 'UNAVAILABLE',
    meaning:
      'No completed tick was observed in this process, so liveness is unknown rather than absent.',
    detail: {},
    checkedAt: '2026-11-05T09:59:58.400Z',
    source: 'WorkerSupervisorService.report()',
    reason: 'no completed tick observed in this process (single-process deployment)',
  },
];

const centre = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2026-11-05T10:00:00.000Z',
  clear: false,
  partial: false,
  items: [
    {
      id: 'notifications:failures',
      area: 'NOTIFICATIONS',
      urgency: 'IMMEDIATE',
      severity: 'WARNING',
      summary: 'Notification deliveries are failing and awaiting automatic retry.',
      context: { pending: 3 },
    },
  ],
  unavailable: [
    { area: 'INTEGRITY', reason: 'integrity history could not be read' },
    { area: 'QUEUE', reason: 'outbox queue state could not be read' },
  ],
  counts: { immediate: 1, routine: 0, info: 0 },
  scope: 'process-local',
  ...overrides,
});

const snapshot = (unavailable: unknown[] = [{ signal: 'event_loop_lag', reason: 'not collected' }]) => ({
  generatedAt: '2026-11-05T10:00:00.500Z',
  unavailable,
  samples: [],
});

const route = (responses: Record<string, unknown>) =>
  calls.mockImplementation(async (path: string) => {
    for (const [needle, value] of Object.entries(responses)) {
      if (path.includes(needle)) return value;
    }
    throw new Error(`No fixture for ${path}`);
  });

beforeEach(() => {
  jest.resetAllMocks();
  principal(['diagnostics.view', 'metrics.view']);
});

describe('ARENA 6 — health components and source availability', () => {
  it('lists every component with its meaning, its own check time and its source', async () => {
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': centre({ items: [], clear: true }),
      'operational-metrics': snapshot([]),
      metrics: { metrics: { jobs_completed: 4 } },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    const table = await screen.findByTestId('health-components-table');
    expect(
      within_rows(table).map((row) => row.querySelector('th')?.textContent),
    ).toEqual(['Database', 'Migrations', 'Reconciliation', 'Outbox backlog', 'Worker supervision']);

    // Each row states what the value means and when it was measured — not just a colour.
    expect(table.textContent).toContain('42 migrations are recorded as applied.');
    expect(within_row(table, 'Reconciliation').textContent).toContain(
      'The reconciliation run reported a WARNING.',
    );
    expect(within_row(table, 'Outbox backlog').textContent).toContain('pendingOrFailed=4');
    // Per-row check times come from the payload, and they are distinct from the report assembly time.
    expect(within_row(table, 'Reconciliation').textContent).toContain(
      new Date('2026-11-05T09:59:58.200Z').toLocaleString(),
    );
    expect(table.textContent).toContain('report assembled');
  });

  it('marks an unreadable component as unknown with its reason, never as ok', async () => {
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': centre(),
      'operational-metrics': snapshot([]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    const row = within_row(await screen.findByTestId('health-components-table'), 'Worker supervision');
    expect(row.textContent).toContain('UNAVAILABLE');
    expect(row.querySelector('.health-redesign__chip--unknown')).toBeTruthy();
    expect(row.textContent).toContain('no completed tick observed in this process');
    expect(row.textContent).toContain('no values reported');
    // "not reported" is a statement about the payload; a blank cell would read as "no such event".
    expect(row.textContent).toContain('via WorkerSupervisorService.report()');
  });

  it('states plainly when the build offers no component breakdown', async () => {
    route({
      diagnostics: { status: 'ok', timestamp: '2026-11-05T10:00:00.000Z' },
      'operations-centre': centre({ items: [], clear: true, unavailable: [] }),
      'operational-metrics': snapshot([]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    const absent = await screen.findByTestId('health-components-absent');
    expect(absent.textContent).toMatch(/no component breakdown/i);
    expect(absent.textContent).toMatch(/all that can honestly be shown/i);
    expect(screen.queryByTestId('health-components-table')).toBeNull();
  });

  it('names the unreadable sources from both reads and refuses to imply an all-clear', async () => {
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': centre({ partial: true }),
      'operational-metrics': snapshot([
        { signal: 'event_loop_lag', reason: 'collector not enabled in this process' },
      ]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    const list = await screen.findByTestId('health-unavailable-sources');
    expect(list.textContent).toContain('INTEGRITY');
    expect(list.textContent).toContain('integrity history could not be read');
    expect(list.textContent).toContain('operations centre');
    // The metrics snapshot's own unavailability is attributed to the read that named it.
    expect(list.textContent).toContain('event_loop_lag');
    expect(list.textContent).toContain('collector not enabled in this process');
    expect(list.textContent).toContain('internal/operational-metrics');

    expect(screen.getByTestId('health-centre-verdict').textContent).toMatch(
      /PARTIAL — at least one source could not be read/,
    );
    // A partial read with items listed is not the same as an empty list, and is not written as one.
    expect(screen.getByTestId('health-attention-items').textContent).toContain(
      'Notification deliveries are failing',
    );
  });

  it('distinguishes a measured all-clear from an unmeasured one', async () => {
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': centre({ clear: true, partial: false, items: [], unavailable: [] }),
      'operational-metrics': snapshot([]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    expect(await screen.findByTestId('health-no-unavailable-sources')).toBeTruthy();
    const verdict = screen.getByTestId('health-centre-verdict');
    expect(verdict.textContent).toMatch(/CLEAR — every source consulted was read/);
    expect(screen.getByTestId('health-no-attention-items').textContent).toMatch(
      /Measured and clear/,
    );
  });

  it('does not treat a failed operations-centre read as an empty attention list', async () => {
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': { unexpected: 'shape' },
      'operational-metrics': snapshot([]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    render(<SystemHealthScreen />);
    const verdict = await screen.findByTestId('health-centre-verdict');
    expect(verdict.textContent).toMatch(/UNKNOWN — the operations centre view could not be read/);
    expect(verdict.textContent).toMatch(/not a clean bill of health/i);
    expect(screen.getByTestId('health-no-attention-items').textContent).toMatch(
      /not a measured all-clear/i,
    );
  });

  it('offers the delivery workspace only when the caller can actually open it', async () => {
    const onOpenNotificationOperations = jest.fn();
    route({
      diagnostics: diagnostics(fiveComponents),
      'operations-centre': centre(),
      'operational-metrics': snapshot([]),
      metrics: { metrics: {} },
      outbox: { items: [], total: 0 },
    });
    const view = render(
      <SystemHealthScreen onOpenNotificationOperations={onOpenNotificationOperations} />,
    );
    // A NOTIFICATIONS attention item is what makes the deep link worth offering.
    const button = await screen.findByTestId('health-open-notification-operations');
    fireEvent.click(button);
    expect(onOpenNotificationOperations).toHaveBeenCalledTimes(1);
    view.unmount();

    // Without a reachable workspace the affordance is absent, and the finding is still stated.
    calls.mockClear();
    render(<SystemHealthScreen />);
    await waitFor(() => expect(screen.getByTestId('health-attention-items')).toBeTruthy());
    expect(screen.queryByTestId('health-open-notification-operations')).toBeNull();
  });

  it('keeps each composed read independent of the others', async () => {
    // The metrics-only principal gets the snapshot read and no operations-centre read; the sections
    // that need `diagnostics.view` are not rendered, and no request is issued for them.
    principal(['metrics.view']);
    route({ 'operational-metrics': snapshot([]), metrics: { metrics: { jobs_completed: 1 } } });
    render(<SystemHealthScreen />);
    await screen.findByText('jobs_completed');
    expect(calls.mock.calls.map(([path]) => path).sort()).toEqual([
      '/internal/metrics',
      '/internal/operational-metrics',
    ]);
    expect(screen.queryByTestId('health-components-table')).toBeNull();
    expect(screen.queryByTestId('health-centre-verdict')).toBeNull();
  });
});

const within_rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr'));
const within_row = (container: HTMLElement, label: string) => {
  const row = within_rows(container).find((tr) => tr.querySelector('th')?.textContent === label);
  if (!row) throw new Error(`no health component row labelled ${label}`);
  return row;
};
