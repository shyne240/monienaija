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
