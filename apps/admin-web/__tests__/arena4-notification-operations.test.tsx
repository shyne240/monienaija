import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { NotificationOperationsScreen } from '../src/screens/authenticated/NotificationOperationsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

jest.mock('../src/services/api-client', () => ({
  ApiClient: { get: jest.fn() },
}));

const summary = {
  window: { hours: 24, from: '2026-11-21T00:00:00Z' },
  totals: {
    deliveries: 6,
    byStatus: [
      { status: 'SENT', count: 3 },
      { status: 'FAILED', count: 3 },
    ],
  },
  retryBacklog: {
    pending: 0,
    failedAwaitingRetry: 3,
    dead: 0,
    unknown: 0,
    oldestPendingAt: null,
    nextScheduledRetryAt: '2026-11-22T06:10:00Z',
  },
  failureDiagnostics: [
    { errorCode: 'ATTEMPTS_EXHAUSTED', count: 2, lastSeenAt: '2026-11-22T06:00:00Z' },
  ],
  provider: {
    projectionScope: 'MINIMAL',
    channels: [{ channel: 'SMS', available: true }],
  },
  retryPolicy: {
    manualRetrySupported: false,
    manualRetryPolicyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
    automaticRetry: { maxAttempts: null, baseDelaySeconds: null },
  },
};

const deliveries = {
  data: [
    {
      id: 'd1',
      eventType: 'PAYMENT_RECEIVED',
      channel: 'SMS',
      recipientType: 'PHONE',
      recipientId: '+23*****5678',
      status: 'FAILED',
      attempts: 2,
      errorCode: 'ATTEMPTS_EXHAUSTED',
      createdAt: '2026-11-22T06:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const detail = {
  delivery: {
    id: 'd1',
    eventType: 'PAYMENT_RECEIVED',
    eventKey: 'evt-1',
    recipientType: 'PHONE',
    recipientId: '+23*****5678',
    channel: 'SMS',
    status: 'FAILED',
    attempts: 2,
    errorCode: 'ATTEMPTS_EXHAUSTED',
  },
  attempts: [
    {
      attemptNumber: 1,
      status: 'FAILED',
      reason: 'PROVIDER_REJECTED_RETRYABLE',
      claimedAt: '2026-11-22T06:00:00Z',
      finishedAt: '2026-11-22T06:00:01Z',
    },
    {
      attemptNumber: 2,
      status: 'FAILED',
      reason: 'ATTEMPTS_EXHAUSTED',
      claimedAt: '2026-11-22T06:05:00Z',
      finishedAt: '2026-11-22T06:05:01Z',
    },
  ],
  idempotency: {
    eventKey: 'evt-1',
    uniqueOn: 'EVENT_KEY_RECIPIENT_CHANNEL',
    materialization: 'ONE_ROW_PER_OUTBOX_EVENT_RECIPIENT_CHANNEL',
  },
  retry: {
    manualRetrySupported: false,
    manualRetryPolicyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
    automaticRetryState: 'AWAITING_AUTOMATIC_RETRY',
    automaticRetry: { maxAttempts: 3, baseDelaySeconds: 60 },
  },
  provider: { projectionScope: 'FULL', channel: 'SMS', available: true, provider: 'robase' },
};

function session(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    token: 's',
    sessionId: 's',
    principal: {
      type: 'OPERATOR',
      principalId: 'operator',
      sessionId: 's',
      audience: 'workforce-admin',
      roles: ['OPERATIONS'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  session(['notification.view_deliveries']);
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/notifications/operations/summary')) {
      return Promise.resolve(summary);
    }
    if (path.startsWith('/internal/notifications/deliveries?')) {
      return Promise.resolve(deliveries);
    }
    if (path.startsWith('/internal/notifications/deliveries/')) {
      return Promise.resolve(detail);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

test('requires the delivery-visibility function', () => {
  session(['customer.view']);
  render(<NotificationOperationsScreen />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(ApiClient.get).not.toHaveBeenCalled();
});

test('shows read-only retry policy, status counts and failure diagnostics', async () => {
  render(<NotificationOperationsScreen />);
  expect((await screen.findAllByText('ATTEMPTS_EXHAUSTED')).length).toBeGreaterThan(0);
  expect(screen.getByTestId('a4-notification-readonly-notice').textContent).toContain('read-only');
  expect(screen.getByTestId('a4-notification-provider-scope').textContent).toContain('MINIMAL');
  expect(document.body.textContent).toContain('Next scheduled retry:');
});

test('applies server-side filters including bounded search', async () => {
  render(<NotificationOperationsScreen />);
  await screen.findByText('PAYMENT_RECEIVED');

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });
  fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'SMS' } });
  fireEvent.change(screen.getByLabelText('Search event, key or aggregate'), {
    target: { value: 'evt-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

  const calls = (ApiClient.get as jest.Mock).mock.calls.map((call) => String(call[0]));
  const filtered = calls.filter((path) => path.startsWith('/internal/notifications/deliveries?'));
  expect(filtered.some((path) => path.includes('status=FAILED'))).toBe(true);
  expect(filtered.some((path) => path.includes('channel=SMS'))).toBe(true);
  expect(filtered.some((path) => path.includes('search=evt-1'))).toBe(true);
});

test('delivery detail exposes retry history but no retry control', async () => {
  render(<NotificationOperationsScreen />);
  await screen.findByText('PAYMENT_RECEIVED');
  fireEvent.click(screen.getByRole('button', { name: 'View details' }));

  expect(await screen.findByText('Retry history')).toBeTruthy();
  expect(screen.getAllByText('PROVIDER_REJECTED_RETRYABLE').length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain('AWAITING_AUTOMATIC_RETRY');
  expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  expect(ApiClient.get).toHaveBeenCalledWith('/internal/notifications/deliveries/d1');
});

const cardWindowDeliveries = {
  ...deliveries,
  window: {
    from: '2026-11-18T15:56:00.000Z',
    to: '2026-11-25T15:56:00.000Z',
    upperBound: 'exclusive' as const,
    boundary: 'created_at >= from AND created_at < to (half-open, UTC)',
  },
};

const editWindowDeliveries = {
  ...deliveries,
  window: {
    from: '2026-11-25T12:00:00.000Z',
    to: '2026-11-25T14:00:00.000Z',
    upperBound: 'inclusive' as const,
    boundary: 'created_at >= from AND created_at <= to (inclusive upper bound, UTC)',
  },
};

const localStamp = (iso: string): string => {
  const d = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

test('a drill-down hands the card window to the queue with the bound excluded, and says so', async () => {
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/notifications/operations/summary')) {
      return Promise.resolve(summary);
    }
    if (path.startsWith('/internal/notifications/deliveries?')) {
      return Promise.resolve(cardWindowDeliveries);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  render(
    <NotificationOperationsScreen
      initialStatus="FAILED"
      initialWindow={{
        from: '2026-11-18T15:56:00.000Z',
        to: '2026-11-25T15:56:00.000Z',
        exclusive: true,
      }}
    />,
  );

  // Waiting on the note alone is not enough: the field values it echoes are known before the queue answers,
  // so it paints once with the "the queue did not report" fallback. Awaiting the boundary the server
  // reported is what makes this assert the applied window rather than an intermediate render.
  await screen.findByText('created_at >= from AND created_at < to (half-open, UTC)');
  const note = screen.getByTestId('a4-applied-window');
  expect(note.textContent).toContain('half-open');
  expect(screen.getByTestId('a4-applied-window-card-match').textContent).toContain(
    'the same interval the dashboard exception card aggregated',
  );
  const path = String(
    (ApiClient.get as jest.Mock).mock.calls.find((call) =>
      String(call[0]).startsWith('/internal/notifications/deliveries?'),
    )![0],
  );
  // The instant on the wire is the card's instant, minute-rounded only in the visible field, and the
  // exclusive bound is what makes the two counts comparable rather than one apart.
  expect(path).toContain('toExclusive=true');
  expect(path).toContain('from=2026-11-18T15%3A56%3A00.000Z');
  expect(path).toContain('to=2026-11-25T15%3A56%3A00.000Z');
});

test('editing the upper bound ends the card handoff: the inclusive bound returns', async () => {
  // Each request is answered the way the real queue answers it: the drill-down's `toExclusive=true` gets the
  // half-open echo, the edited query (no flag) gets the inclusive echo. The screen's statement therefore
  // follows the server's answer in both directions, which is the behavior under test.
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/notifications/operations/summary')) {
      return Promise.resolve(summary);
    }
    if (path.startsWith('/internal/notifications/deliveries?')) {
      return Promise.resolve(
        path.includes('toExclusive=true') ? cardWindowDeliveries : editWindowDeliveries,
      );
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  render(
    <NotificationOperationsScreen
      initialStatus="FAILED"
      initialWindow={{
        from: '2026-11-18T15:56:00.000Z',
        to: '2026-11-25T15:56:00.000Z',
        exclusive: true,
      }}
    />,
  );
  await screen.findByTestId('a4-applied-window-card-match');

  fireEvent.change(screen.getByLabelText('Created to'), {
    target: { value: localStamp('2026-11-25T14:00:00.000Z') },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

  expect(screen.queryByTestId('a4-applied-window-card-match')).toBeNull();
  const paths = (ApiClient.get as jest.Mock).mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.startsWith('/internal/notifications/deliveries?'));
  // The edited request is identified by its own `to` value rather than by being last, so the assertion
  // cannot pass against the drill-down request that preceded it. No exclusive bound, an inclusive `to`,
  // and `Created from` still the card's because it was not touched: ordinary queue behaviour.
  const last = paths.find((path) => path.includes('to=2026-11-25T14%3A00%3A00.000Z'))!;
  expect(last).not.toContain('toExclusive');
  expect(last).toContain('to=2026-11-25T14%3A00%3A00.000Z');
  expect(last).toContain('from=2026-11-18T15%3A56%3A00.000Z');
});

test('a queue that does not report its bound warns, and does not also claim the card match', async () => {
  // The response below deliberately has no `window` at all — the shape an older queue answers with. The
  // screen's only honest move is to say the bound is unreported; rendering the card-match sentence next to
  // that warning would put "treat this count as inclusive" and "these counts are meant to be equal" in the
  // same paragraph, which is the contradiction this test exists to keep out.
  (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/internal/notifications/operations/summary')) {
      return Promise.resolve(summary);
    }
    if (path.startsWith('/internal/notifications/deliveries?')) {
      return Promise.resolve(deliveries);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  render(
    <NotificationOperationsScreen
      initialStatus="FAILED"
      initialWindow={{
        from: '2026-11-18T15:56:00.000Z',
        to: '2026-11-25T15:56:00.000Z',
        exclusive: true,
      }}
    />,
  );
  // Barrier first: the queue answer has been painted (so the absence asserted below is not a pre-response
  // emptiness), and it was requested with the exclusive bound.
  await screen.findByText(/1 matching deliveries/);
  const requested = (ApiClient.get as jest.Mock).mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.startsWith('/internal/notifications/deliveries?'))
    .at(-1)!;
  expect(requested).toContain('toExclusive=true');

  const note = await screen.findByTestId('a4-applied-window');
  expect(note.textContent).toContain(
    'the queue did not report which upper bound it used — treat this count as inclusive of the end of the window',
  );
  expect(screen.queryByTestId('a4-applied-window-card-match')).toBeNull();
});
