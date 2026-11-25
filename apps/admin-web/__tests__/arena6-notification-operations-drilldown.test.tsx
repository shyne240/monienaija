import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotificationOperationsScreen } from '../src/screens/authenticated/NotificationOperationsScreen';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

/**
 * ARENA 6 — arriving in the delivery workspace from a dashboard tile or a health finding.
 *
 * A drill-down is only useful if it arrives with the question already asked and with the evidence
 * chain visible: an operator clicking "investigate failures" must not land on an unfiltered list and
 * re-type the filter, and a trace must state which stores were read and which said nothing. The
 * second half of that is the reason each step below carries its own checked-at time and source.
 */

jest.mock('../src/services/api-client', () => ({ ApiClient: { get: jest.fn() } }));
const calls = ApiClient.get as jest.Mock;

const summary = {
  generatedAt: '2026-11-22T07:00:00Z',
  window: { hours: 24, from: '2026-11-21T00:00:00Z', to: '2026-11-22T00:00:00Z' },
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
  outboxReceipts: [{ status: 'MATERIALIZED', count: 6 }],
  provider: { projectionScope: 'MINIMAL', channels: [{ channel: 'SMS', available: true }] },
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
      eventKey: 'payment:req-1',
      channel: 'SMS',
      recipientType: 'PHONE',
      recipientId: '+23*****5678',
      status: 'FAILED',
      attempts: 2,
      errorCode: 'ATTEMPTS_EXHAUSTED',
      correlationId: 'corr-77',
      createdAt: '2026-11-22T06:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  delivery: {
    id: 'd1',
    eventType: 'PAYMENT_RECEIVED',
    eventKey: 'payment:req-1',
    recipientType: 'PHONE',
    recipientId: '+23*****5678',
    channel: 'SMS',
    status: 'FAILED',
    attempts: 2,
    errorCode: 'ATTEMPTS_EXHAUSTED',
    correlationId: 'corr-77',
    causationId: 'cause-12',
    nextAttemptAt: '2026-11-22T07:10:00Z',
    sentAt: null,
    failedAt: '2026-11-22T06:05:00Z',
    createdAt: '2026-11-22T06:00:00Z',
    updatedAt: '2026-11-22T06:05:00Z',
  },
  attempts: [
    {
      attemptNumber: 1,
      status: 'FAILED',
      reason: 'PROVIDER_REJECTED_RETRYABLE',
      claimedAt: '2026-11-22T06:00:00Z',
      startedAt: '2026-11-22T06:00:01Z',
      finishedAt: '2026-11-22T06:00:02Z',
    },
  ],
  idempotency: { eventKey: 'payment:req-1', uniqueOn: 'EVENT_KEY_RECIPIENT_CHANNEL' },
  retry: {
    manualRetrySupported: false,
    manualRetryPolicyReference: 'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md',
    automaticRetryState: 'AWAITING_AUTOMATIC_RETRY',
    automaticRetry: { maxAttempts: 3, baseDelaySeconds: 60 },
  },
  auditInspection: { entityId: 'd1', correlationId: 'corr-77' },
  provider: { projectionScope: 'FULL', channel: 'SMS', available: true, provider: 'robase' },
  ...overrides,
});

const fullTrace = {
  relatedEvent: {
    availability: 'FOUND',
    checkedAt: '2026-11-22T07:00:01Z',
    source: 'outbox_events + notification_outbox_receipts (consumer notification-dispatch)',
    id: 'event-9',
    eventType: 'PAYMENT_RECEIVED',
    status: 'PUBLISHED',
    attempts: 1,
    occurredAt: '2026-11-22T05:59:00Z',
    publishedAt: null,
    availableAt: '2026-11-22T05:59:30Z',
    eventHasError: false,
    receipt: {
      status: 'MATERIALIZED',
      reason: null,
      attempts: 1,
      nextAttemptAt: null,
      updatedAt: '2026-11-22T05:59:40Z',
    },
  },
  providerReceipts: {
    availability: 'AVAILABLE',
    checkedAt: '2026-11-22T07:00:02Z',
    source: 'notification_delivery_receipts (append-only provider receipts)',
    limit: 20,
    returned: 1,
    items: [
      {
        id: 'receipt-3',
        kind: 'DELIVERY_STATUS',
        verification: 'SIGNED',
        providerCode: 'PROVIDER_REJECTED',
        occurredAt: '2026-11-22T06:04:00Z',
        receivedAt: '2026-11-22T06:04:30Z',
      },
    ],
  },
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
    } as any,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  session(['notification.view_deliveries', 'audit.search', 'audit.view']);
  calls.mockImplementation((path: string) => {
    if (path.startsWith('/internal/notifications/operations/summary'))
      return Promise.resolve(summary);
    if (path.startsWith('/internal/notifications/deliveries/'))
      return Promise.resolve(detail());
    if (path.startsWith('/internal/notifications/deliveries?'))
      return Promise.resolve(deliveries);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

const deliveryRequests = () =>
  calls.mock
    .calls.map(([path]) => String(path))
    .filter((path) => path.startsWith('/internal/notifications/deliveries?'));

describe('ARENA 6 — delivery workspace drill-down', () => {
  it('arrives with the failure filter already applied, and says so', async () => {
    render(<NotificationOperationsScreen initialStatus="FAILED" />);
    await screen.findByText('PAYMENT_RECEIVED');

    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('FAILED');
    expect(deliveryRequests()[0]).toContain('status=FAILED');
    // The pre-filter is stated on the page, and it says plainly which parts of the screen it does not
    // narrow — otherwise the aggregate cards read as "3 failures out of what I am looking at".
    const note = screen.getByTestId('a4-prefilter-note');
    expect(note.textContent).toContain('Status = FAILED already applied');
    expect(note.textContent).toMatch(/summary counts .* are window-wide/i);
  });

  it('an unrecognized pre-filter falls back to no filter rather than a blank status', async () => {
    render(<NotificationOperationsScreen initialStatus="NOT_A_STATUS" />);
    await screen.findByText('PAYMENT_RECEIVED');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('');
    expect(deliveryRequests()[0]).not.toContain('status=');
  });

  it('traces the delivery through every store that was read', async () => {
    calls.mockImplementation((path: string) =>
      path.startsWith('/internal/notifications/deliveries/d1')
        ? Promise.resolve(detail(fullTrace))
        : path.startsWith('/internal/notifications/deliveries?')
          ? Promise.resolve(deliveries)
          : Promise.resolve(summary),
    );
    render(<NotificationOperationsScreen />);
    await screen.findByText('PAYMENT_RECEIVED');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));

    const trace = await screen.findByTestId('a4-delivery-trace');
    // Step 1: the upstream event, with the publisher's own attempt count.
    expect(trace.textContent).toContain('Outbox event event-9');
    expect(trace.textContent).toContain('1 delivery attempt(s) by the publisher');
    // A time the store does not carry is stated as unrecorded, never left blank.
    expect(trace.textContent).toMatch(/published not recorded/);
    // Step 2: the consumer receipt, which is what proves the event was not lost.
    expect(trace.textContent).toContain('Consumer receipt MATERIALIZED');
    // Step 3: the delivery outcome itself.
    expect(trace.textContent).toContain('ATTEMPTS_EXHAUSTED');
    // Step 4: what the provider reported, with its verification level.
    expect(screen.getByTestId('a4-provider-receipt').textContent).toContain('verification SIGNED');
    expect(trace.textContent).toContain('PROVIDER_REJECTED');
    // Step 5: channel availability now, kept separate from the historical outcome.
    expect(trace.textContent).toMatch(/SMS: available/);
    // Every step says when and where it was read.
    expect(trace.textContent).toMatch(/Checked .* source outbox_events/);
    expect(trace.textContent).toMatch(/notification_delivery_receipts/);
  });

  it('states the absence of a trace without implying health', async () => {
    render(<NotificationOperationsScreen />);
    await screen.findByText('PAYMENT_RECEIVED');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    const note = await screen.findByTestId('a4-delivery-trace-unavailable');
    expect(note.textContent).toMatch(/without a trace projection/i);
    expect(note.textContent).toMatch(/not.*“the event was fine”/i);
    // The delivery record the operator came for is still shown.
    expect(screen.getByText('Retry history')).toBeTruthy();
  });

  it('hands the correlation identifiers to audit search when the operator asks for the trail', async () => {
    calls.mockImplementation((path: string) =>
      path.startsWith('/internal/notifications/deliveries/d1')
        ? Promise.resolve(detail(fullTrace))
        : path.startsWith('/internal/notifications/deliveries?')
          ? Promise.resolve(deliveries)
          : Promise.resolve(summary),
    );
    const onOpenAuditSearch = jest.fn();
    render(<NotificationOperationsScreen onOpenAuditSearch={onOpenAuditSearch} />);
    await screen.findByText('PAYMENT_RECEIVED');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    await screen.findByTestId('a4-delivery-trace');
    fireEvent.click(screen.getByTestId('open-audit-from-delivery'));
    // The correlation identifier is handed over as-is so the audit workspace opens on this request,
    // not on a search the operator has to retype.
    await waitFor(() => expect(onOpenAuditSearch).toHaveBeenCalledWith('corr-77'));
  });

  it('reports an unreadable upstream event as unread, not as a missing event', async () => {
    calls.mockImplementation((path: string) =>
      path.startsWith('/internal/notifications/deliveries/d1')
        ? Promise.resolve(
            detail({
              relatedEvent: {
                availability: 'UNAVAILABLE',
                checkedAt: '2026-11-22T07:00:01Z',
                source: 'outbox_events + notification_outbox_receipts',
                reason: 'the outbox read timed out for this request',
              },
              providerReceipts: {
                availability: 'UNAVAILABLE',
                checkedAt: '2026-11-22T07:00:02Z',
                source: 'notification_delivery_receipts',
                limit: 20,
                returned: 0,
                items: [],
                reason: 'the receipt table could not be read',
              },
            }),
          )
        : path.startsWith('/internal/notifications/deliveries?')
          ? Promise.resolve(deliveries)
          : Promise.resolve(summary),
    );
    render(<NotificationOperationsScreen />);
    await screen.findByText('PAYMENT_RECEIVED');
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));

    const trace = await screen.findByTestId('a4-delivery-trace');
    expect(screen.getByTestId('a4-trace-event-not-read').textContent).toMatch(
      /could not be read by this surface/i,
    );
    expect(screen.getByTestId('a4-trace-receipt-absent').textContent).toMatch(
      /no consumer receipt could be read/i,
    );
    expect(screen.getByTestId('a4-provider-receipts-none').textContent).toMatch(
      /not\s+evidence of delivery or of failure/i,
    );
    // The reason for the gap is quoted, and the trace is not silently shortened.
    expect(trace.textContent).toContain('the outbox read timed out for this request');
    expect(trace.textContent).not.toMatch(/healthy|all clear/i);
  });

  it('keeps the summary as-at line honest about the window it aggregated', async () => {
    calls.mockImplementation((path: string) =>
      path.startsWith('/internal/notifications/operations/summary')
        ? Promise.resolve({ ...summary, outboxReceipts: [] })
        : path.startsWith('/internal/notifications/deliveries?')
          ? Promise.resolve(deliveries)
          : Promise.reject(new Error('unexpected')),
    );
    render(<NotificationOperationsScreen initialStatus="FAILED" />);
    const line = await screen.findByTestId('a4-summary-generated-at');
    expect(line.textContent).toMatch(/Aggregates computed/i);
    expect(line.textContent).toMatch(/window 24h from/i);
    expect(line.textContent).toMatch(/do not describe the filtered table/i);
    // A checkpoint read that returned nothing is stated as "not provided", never as "no receipts".
    expect(screen.getByTestId('a4-outbox-receipts-unavailable').textContent).toMatch(
      /not that no receipts exist/i,
    );
  });
});
