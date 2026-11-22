import type { DataSource } from 'typeorm';

import {
  deriveAutomaticRetryState,
  NotificationOperationsService,
} from './notification-operations.service';

function dataSourceWith(responses: unknown[][]): DataSource {
  let index = 0;
  return {
    query: jest.fn(() => Promise.resolve(responses[index++] ?? [])),
  } as unknown as DataSource;
}

describe('ARENA 4 notification operations', () => {
  describe('deriveAutomaticRetryState', () => {
    it('never treats an ambiguous outcome as retryable', () => {
      expect(deriveAutomaticRetryState('UNKNOWN', 2)).toBe('OUTCOME_UNKNOWN');
      expect(deriveAutomaticRetryState('UNKNOWN', 0)).toBe('OUTCOME_UNKNOWN');
    });

    it('distinguishes awaiting retry, exhaustion and delivery', () => {
      expect(deriveAutomaticRetryState('FAILED', 1)).toBe('AWAITING_AUTOMATIC_RETRY');
      expect(deriveAutomaticRetryState('PENDING', 0)).toBe('NOT_STARTED');
      expect(deriveAutomaticRetryState('DEAD', 3)).toBe('TERMINAL_EXHAUSTED');
      expect(deriveAutomaticRetryState('DEAD', 0)).toBe('TERMINAL_PERMANENT');
      expect(deriveAutomaticRetryState('SENT', 1)).toBe('DELIVERED');
      expect(deriveAutomaticRetryState('SKIPPED', 1)).toBe('SUPPRESSED');
    });
  });

  describe('deliveryDetail', () => {
    it('projects attempts without destination, message, lease token or raw provider error', async () => {
      const dataSource = dataSourceWith([
        [
          {
            id: '11111111-1111-4111-8111-111111111111',
            event_type: 'PAYMENT_RECEIVED',
            event_key: 'evt-key-1',
            aggregate_type: 'TRANSFER',
            aggregate_id: null,
            recipient_type: 'PHONE',
            recipient_id: '+2348012345678',
            channel: 'SMS',
            status: 'FAILED',
            attempts: 2,
            provider_ref: 'raw-provider-secret-ref',
            correlation_id: 'flow-1',
            causation_id: null,
            last_error: 'ROBASE_HTTP_500: upstream body with PII',
            next_attempt_at: new Date('2026-11-22T00:00:00Z'),
            created_at: new Date('2026-11-21T23:00:00Z'),
            updated_at: new Date('2026-11-21T23:05:00Z'),
            sent_at: null,
            failed_at: new Date('2026-11-21T23:05:00Z'),
            destination: '+2348012345678',
            message: 'Do not leak this message body',
            rendered_html: '<p>secret</p>',
            lease_token: '22222222-2222-4222-8222-222222222222',
            payload: { pin: '1234' },
          },
        ],
        [
          {
            attempt_number: 1,
            status: 'FAILED',
            reason: 'ROBASE_HTTP_500: raw upstream error',
            claimed_at: new Date('2026-11-21T23:00:00Z'),
            started_at: new Date('2026-11-21T23:00:01Z'),
            finished_at: new Date('2026-11-21T23:00:02Z'),
          },
        ],
      ]);
      const service = new NotificationOperationsService(dataSource);

      const detail = await service.deliveryDetail('11111111-1111-4111-8111-111111111111', false);

      const serialized = JSON.stringify(detail);
      expect(serialized).not.toContain('Do not leak this message body');
      expect(serialized).not.toContain('rendered_html');
      expect(serialized).not.toContain('22222222-2222-4222-8222-222222222222');
      expect(serialized).not.toContain('raw-provider-secret-ref');
      expect(serialized).not.toContain('raw upstream error');
      expect(serialized).not.toContain('+2348012345678');
      expect(detail.delivery.recipientId).not.toBe('+2348012345678');
      expect(detail.delivery.errorCode).toBe('UNCLASSIFIED');
      expect(detail.attempts[0]?.reason).toBe('UNCLASSIFIED');
      expect(detail.retry.manualRetrySupported).toBe(false);
      expect(detail.retry.automaticRetryState).toBe('AWAITING_AUTOMATIC_RETRY');
      expect(detail.idempotency.uniqueOn).toBe('EVENT_KEY_RECIPIENT_CHANNEL');
      expect(detail.provider.projectionScope).toBe('MINIMAL');
    });

    it('rejects an unknown delivery', async () => {
      const service = new NotificationOperationsService(dataSourceWith([[]]));
      await expect(service.deliveryDetail('missing', false)).rejects.toThrow(
        'Notification delivery not found',
      );
    });
  });

  describe('summary', () => {
    it('aggregates by status/channel and sanitizes failure codes', async () => {
      const dataSource = dataSourceWith([
        // byChannelAndStatus
        [
          { channel: 'SMS', status: 'SENT', count: 3 },
          { channel: 'SMS', status: 'FAILED', count: 1 },
          { channel: 'EMAIL', status: 'DEAD', count: 2 },
        ],
        // backlog
        [
          {
            pending: 0,
            failed: 1,
            dead: 2,
            unknown: 0,
            oldest_pending_at: null,
            next_scheduled_retry_at: new Date('2026-11-22T00:10:00Z'),
          },
        ],
        // failure rows: one safe, one unsafe
        [
          { last_error: 'ATTEMPTS_EXHAUSTED', count: 2, last_seen_at: null },
          { last_error: 'BREVO_HTTP_500: body', count: 1, last_seen_at: null },
        ],
        // receipts
        [{ status: 'MATERIALIZED', count: 4 }],
      ]);
      const service = new NotificationOperationsService(dataSource);

      const summary = await service.summary({ hours: 24, includeProviderIdentity: false });

      expect(summary.totals.deliveries).toBe(6);
      expect(summary.totals.byStatus.find((row) => row.status === 'SENT')?.count).toBe(3);
      expect(summary.retryBacklog.failedAwaitingRetry).toBe(1);
      expect(summary.retryBacklog.dead).toBe(2);
      expect(summary.failureDiagnostics.map((row) => row.errorCode).sort()).toEqual([
        'ATTEMPTS_EXHAUSTED',
        'UNCLASSIFIED',
      ]);
      expect(summary.retryPolicy.manualRetrySupported).toBe(false);
      expect(summary.retryPolicy.automaticRetry.visibility).toBe('MINIMAL');
      expect(summary.provider.projectionScope).toBe('MINIMAL');
      expect(summary.outboxReceipts.find((row) => row.status === 'MATERIALIZED')?.count).toBe(4);
    });

    it('bounds the reporting window', async () => {
      const dataSource = dataSourceWith([[], [], [], []]);
      const service = new NotificationOperationsService(dataSource);
      const summary = await service.summary({ hours: 9999, includeProviderIdentity: false });
      expect(summary.window.hours).toBe(168);
    });
  });
});
