import type { DataSource } from 'typeorm';

import { NotificationOperationsService } from '../src/admin/notification-operations.service';

/**
 * ARENA 6 — the delivery trace a drill-down card opens onto.
 *
 * `deliveryDetail()` grew two reads so that one screen can answer "what happened to this message"
 * end to end. Both must degrade with a stated reason rather than an empty object, because an absent
 * upstream event and an unreadable one look the same in JSON unless the difference is spelled out —
 * and an operator who reads "no provider receipt" as "the provider never got it" will pursue the
 * wrong thing. These tests pin the three-way distinction at the source.
 */

const deliveryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'delivery-1',
  event_type: 'transfer.completed',
  event_key: 'transfer.completed:req-1',
  aggregate_type: 'TRANSFER',
  aggregate_id: 'transfer-9',
  recipient_type: 'CUSTOMER',
  recipient_id: 'customer-1',
  channel: 'SMS',
  status: 'FAILED',
  attempts: 2,
  provider_ref: 'provider-ref-1',
  correlation_id: 'corr-1',
  causation_id: 'cause-1',
  last_error: 'PROVIDER_TIMEOUT',
  next_attempt_at: null,
  created_at: new Date('2026-11-05T09:00:00.000Z'),
  updated_at: new Date('2026-11-05T09:05:00.000Z'),
  sent_at: null,
  failed_at: new Date('2026-11-05T09:05:00.000Z'),
  ...overrides,
});

/**
 * A DataSource double, cast to the declared dependency type at the seam. Returning the mock alongside
 * the fake lets a test assert on what was asked for, which is the only way to pin "did not query at all"
 * — an absence cannot be observed through the returned payload.
 */
type QueryHandler = (sql: string, params: unknown[]) => unknown;

const fakeDataSource = (handler: QueryHandler) => {
  const query = jest.fn(
    (sql: string, params: unknown[] = []): Promise<unknown> =>
      // Deferred so a handler that throws models a failed statement, i.e. a rejected query.
      Promise.resolve().then(() => handler(sql, params)),
  );
  return { query, dataSource: { query } as unknown as DataSource };
};

const serviceFor = (handler: QueryHandler): NotificationOperationsService =>
  new NotificationOperationsService(fakeDataSource(handler).dataSource);

describe('ARENA 6 — notification delivery trace', () => {
  it('links the delivery to its outbox event and the consumer receipt on it', async () => {
    const service = serviceFor((sql) => {
      if (sql.includes('FROM notification_deliveries') && sql.includes('WHERE id=$1'))
        return [deliveryRow()];
      if (sql.includes('notification_delivery_attempts'))
        return [
          {
            attempt_number: 1,
            status: 'FAILED',
            reason: 'PROVIDER_TIMEOUT',
            claimed_at: '2026-11-05T09:01:00.000Z',
            started_at: '2026-11-05T09:01:30.000Z',
            finished_at: '2026-11-05T09:05:00.000Z',
          },
        ];
      if (sql.includes('FROM outbox_events o'))
        return [
          {
            id: 'event-1',
            event_type: 'transfer.completed',
            status: 'PUBLISHED',
            attempts: 3,
            occurred_at: new Date('2026-11-05T08:59:00.000Z'),
            published_at: new Date('2026-11-05T09:00:30.000Z'),
            available_at: new Date('2026-11-05T08:59:00.000Z'),
            last_error: null,
            receipt_status: 'ACKNOWLEDGED',
            receipt_reason: 'projection advanced',
            receipt_attempts: 1,
            receipt_next_attempt_at: null,
            receipt_updated_at: new Date('2026-11-05T09:06:00.000Z'),
          },
        ];
      if (sql.includes('notification_delivery_receipts')) return [];
      return [];
    });

    const detail = await service.deliveryDetail('delivery-1', false);
    expect(detail.relatedEvent.availability).toBe('FOUND');
    expect(detail.relatedEvent.id).toBe('event-1');
    expect(detail.relatedEvent.status).toBe('PUBLISHED');
    expect(detail.relatedEvent.eventHasError).toBe(false);
    expect(detail.relatedEvent.receipt?.status).toBe('ACKNOWLEDGED');
    iso(detail.relatedEvent.checkedAt);
    expect(String(detail.relatedEvent.source)).toMatch(/outbox_events/);

    // A provider that reported nothing is its own state, with the absence interpreted for the reader.
    expect(detail.providerReceipts.availability).toBe('NONE_RECORDED');
    expect(detail.providerReceipts.items).toEqual([]);
    expect(detail.providerReceipts.returned).toBe(0);
    expect(String(detail.providerReceipts.reason)).toMatch(/not evidence of delivery or failure/i);
  });

  it('says NOT_FOUND when the delivery carries no event key, without querying for one', async () => {
    const { query, dataSource } = fakeDataSource((sql) =>
      sql.includes('FROM notification_deliveries') && sql.includes('WHERE id=$1')
        ? [deliveryRow({ event_key: '' })]
        : sql.includes('notification_delivery_attempts')
          ? []
          : [],
    );
    const service = new NotificationOperationsService(dataSource);
    const detail = await service.deliveryDetail('delivery-1', false);

    expect(detail.relatedEvent.availability).toBe('NOT_FOUND');
    expect(String(detail.relatedEvent.reason)).toMatch(/no event key/i);
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM outbox_events o'))).toBe(false);
  });

  it('reports UNAVAILABLE, not NOT_FOUND, when the event read itself fails', async () => {
    const service = serviceFor((sql) => {
      if (sql.includes('FROM notification_deliveries') && sql.includes('WHERE id=$1'))
        return [deliveryRow()];
      if (sql.includes('notification_delivery_attempts')) return [];
      if (sql.includes('FROM outbox_events o'))
        throw new Error('relation outbox_events does not exist');
      if (sql.includes('notification_delivery_receipts'))
        throw new Error('relation notification_delivery_receipts does not exist');
      return [];
    });

    const detail = await service.deliveryDetail('delivery-1', false);
    expect(detail.relatedEvent.availability).toBe('UNAVAILABLE');
    expect(detail.providerReceipts.availability).toBe('UNAVAILABLE');
    // The failure is stated, and the underlying database error text never crosses the boundary.
    expect(String(detail.relatedEvent.reason)).toMatch(/could not be read/i);
    expect(String(detail.relatedEvent.reason)).not.toMatch(/relation/i);
    // A failed read must not invalidate the delivery row the operator came for.
    expect(detail.delivery.id).toBe('delivery-1');
    expect(detail.delivery.status).toBe('FAILED');
  });

  it('projects provider receipts with verification and a closed-set code only', async () => {
    const service = serviceFor((sql) => {
      if (sql.includes('FROM notification_deliveries') && sql.includes('WHERE id=$1'))
        return [deliveryRow()];
      if (sql.includes('notification_delivery_attempts')) return [];
      if (sql.includes('notification_delivery_receipts'))
        return [
          {
            id: 'receipt-2',
            kind: 'DELIVERY_STATUS',
            verification: 'SIGNED',
            provider_code: 'SMS_OPT_OUT',
            occurred_at: new Date('2026-11-05T09:07:00.000Z'),
            received_at: new Date('2026-11-05T09:07:01.000Z'),
            raw_detail: 'SECRET_PROVIDER_BODY phone=+2348012345678',
          },
          {
            id: 'receipt-1',
            kind: 'ACCEPTED',
            verification: 'GUESS',
            provider_code: 'free text with phone:+2348012345678',
            occurred_at: new Date('2026-11-05T09:04:00.000Z'),
            received_at: new Date('2026-11-05T09:04:02.000Z'),
          },
        ];
      return [];
    });

    const detail = await service.deliveryDetail('delivery-1', false);
    expect(detail.providerReceipts.availability).toBe('AVAILABLE');
    expect(detail.providerReceipts.returned).toBe(2);
    expect(detail.providerReceipts.items[0]).toMatchObject({
      id: 'receipt-2',
      verification: 'SIGNED',
      // A recognized code survives; the raw provider detail beside it does not.
      providerCode: 'SMS_OPT_OUT',
    });
    // An unrecognized verification never becomes an assertion, and a free-text code is not echoed.
    expect(detail.providerReceipts.items[1]!.verification).toBe('UNVERIFIED');
    expect(detail.providerReceipts.items[1]!.providerCode).toBe('UNCLASSIFIED');
    const serialized = JSON.stringify(detail);
    for (const secret of ['SECRET_PROVIDER_BODY', '+2348012345678', 'free text']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('aggregates the summary over the half-open window a caller supplied', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const service = serviceFor((sql, params) => {
      seen.push({ sql, params });
      if (sql.includes('GROUP BY channel, status'))
        return [{ channel: 'SMS', status: 'FAILED', count: 3 }];
      if (sql.includes('error_code')) return [];
      if (sql.includes('notification_outbox_receipts')) return [];
      return [{ count: '0' }];
    });

    const from = new Date('2026-11-04T00:00:00.000Z');
    const to = new Date('2026-11-05T00:00:00.000Z');
    const summary = await service.summary({ hours: 168, from, to, includeProviderIdentity: false });

    expect(summary.window.from).toEqual(from);
    expect(summary.window.to).toEqual(to);
    expect(summary.totals.deliveries).toBe(3);
    expect(summary.totals.byStatus.find((row) => row.status === 'FAILED')!.count).toBe(3);
    // The window is half-open so a delivery at exactly `to` is counted once, by the next window.
    for (const query of seen.filter((entry) => entry.sql.includes('notification_deliveries'))) {
      expect(query.sql).toMatch(/created_at >= \$1::timestamptz AND created_at < \$2::timestamptz/);
      expect(query.params[0]).toEqual(from);
      expect(query.params[1]).toEqual(to);
    }
  });

  it('clamps a bare hours window and still states the window it used', async () => {
    const service = serviceFor((sql) =>
      sql.includes('GROUP BY channel, status') ? [] : [{ count: '0' }],
    );
    const summary = await service.summary({ hours: 10_000, includeProviderIdentity: false });
    expect(summary.window.hours).toBe(168);
    expect(summary.window.to.getTime() - summary.window.from.getTime()).toBe(168 * 60 * 60 * 1000);
    expect(summary.generatedAt instanceof Date).toBe(true);
    // The window ceiling is a documented limit, so the payload states the window it actually used
    // rather than silently agreeing to "10,000 hours".
    expect(summary.retryPolicy.manualRetrySupported).toBe(false);
    expect(summary.retryPolicy.manualRetryPolicyReference.length).toBeGreaterThan(0);
    // No provider identity was authorized, and the payload says so instead of implying none exists.
    expect(summary.provider.projectionScope).toBe('MINIMAL');
  });
});

const iso = (value: unknown) => {
  expect(typeof value).toBe('string');
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
};
