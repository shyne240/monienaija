import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { OperationalMetricsService } from '../src/operations/operational-metrics.service';
import { WorkerLeaseService } from '../src/operations/worker-lease.service';
import { WorkerSupervisorService } from '../src/operations/worker-supervisor.service';

/**
 * ARENA 3D Group 17 — operational metrics.
 *
 * The gap this group closes is precise: Group 14's `health()` and `deadLetters()` and Group 15's
 * `report()` existed and had **no consumer**. These tests assert that the signals reach an exposition
 * format, and — more importantly — that "zero" and "could not read" never collapse into the same output.
 */

function supervisorConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

interface Harness {
  service: OperationalMetricsService;
  leases: WorkerLeaseService;
  supervisor: WorkerSupervisorService;
}

function harness(values: Record<string, unknown> = {}): Harness {
  const supervisor = new WorkerSupervisorService(supervisorConfig(values));
  const leases = new WorkerLeaseService();
  const dataSource = { manager: {} } as DataSource;
  return {
    service: new OperationalMetricsService(dataSource, leases, supervisor),
    leases,
    supervisor,
  };
}

describe('Group 17 — operational metrics', () => {
  describe('the signals that had no consumer are now collected', () => {
    it('emits outbox queue gauges from the lease service', async () => {
      const { service, leases } = harness();
      jest.spyOn(leases, 'health').mockResolvedValue({
        pending: 12,
        deadLettered: 3,
        stalled: 1,
        oldestPendingAgeSeconds: 240,
      });
      const snapshot = await service.snapshot();
      const byName = new Map(snapshot.samples.map((sample) => [sample.name, sample.value]));
      expect(byName.get('outbox_pending')).toBe(12);
      expect(byName.get('outbox_dead_lettered')).toBe(3);
      expect(byName.get('outbox_stalled_leases')).toBe(1);
      expect(byName.get('outbox_oldest_pending_age_seconds')).toBe(240);
    });

    it('emits per-worker gauges and counters from the supervisor', async () => {
      const { service, supervisor } = harness({ NOTIFICATION_WORKER_ENABLED: true });
      await supervisor.scheduler.observe('notification-delivery', () => Promise.resolve());
      const snapshot = await service.snapshot();
      const notification = snapshot.samples.filter(
        (sample) => sample.labels?.worker === 'notification-delivery',
      );
      expect(notification.length).toBeGreaterThan(0);
      const completed = notification.find(
        (sample) => sample.name === 'worker_ticks_completed_total',
      );
      expect(completed?.value).toBe(1);
      expect(completed?.type).toBe('counter');

      const observed = notification.find((sample) => sample.name === 'worker_activity_observed');
      expect(observed?.value).toBe(1);
    });

    it('marks a worker with no observation as unmeasured, not healthy', async () => {
      const { service } = harness({ NOTIFICATION_WORKER_ENABLED: true });
      const snapshot = await service.snapshot();
      const observed = snapshot.samples.find(
        (sample) =>
          sample.name === 'worker_activity_observed' &&
          sample.labels?.worker === 'notification-delivery',
      );
      expect(observed?.value).toBe(0);
    });
  });

  describe('zero is not the same as unreadable', () => {
    it('names an unreadable queue instead of reporting zeros', async () => {
      // The failure mode this prevents: a dashboard showing "0 dead letters" during an incident, when the
      // truth is that the dead-letter table could not be read.
      const { service, leases } = harness();
      jest.spyOn(leases, 'health').mockRejectedValue(new Error('connection refused'));
      const snapshot = await service.snapshot();
      expect(snapshot.unavailable).toEqual([
        { signal: 'outbox', reason: 'outbox queue state could not be read' },
      ]);
      expect(snapshot.samples.some((sample) => sample.name === 'outbox_pending')).toBe(false);
    });

    it('still emits worker metrics when the queue is unreadable', async () => {
      // One degraded source must not take the whole endpoint down — during an incident the worker signal is
      // often the more useful half.
      const { service, leases } = harness({ NOTIFICATION_WORKER_ENABLED: true });
      jest.spyOn(leases, 'health').mockRejectedValue(new Error('down'));
      const snapshot = await service.snapshot();
      expect(snapshot.unavailable).toHaveLength(1);
      expect(snapshot.samples.some((sample) => sample.name === 'worker_enabled')).toBe(true);
    });
  });

  describe('supervision status is exported truthfully', () => {
    it('reports indeterminate as its own one-hot gauge', async () => {
      const { service } = harness();
      const snapshot = await service.snapshot();
      const statuses = snapshot.samples
        .filter((sample) => sample.name === 'worker_supervision_status')
        .map((sample) => [sample.labels?.status, sample.value]);
      expect(statuses).toEqual(
        expect.arrayContaining([
          ['ok', 0],
          ['degraded', 0],
          ['indeterminate', 1],
        ]),
      );
    });
  });

  describe('Prometheus exposition', () => {
    it('emits HELP and TYPE once per metric name', async () => {
      const { service, leases } = harness();
      jest.spyOn(leases, 'health').mockResolvedValue({
        pending: 1,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: 5,
      });
      const text = await service.prometheus();
      const helpLines = text.split('\n').filter((line) => line.startsWith('# HELP outbox_pending'));
      const typeLines = text.split('\n').filter((line) => line.startsWith('# TYPE outbox_pending'));
      expect(helpLines).toHaveLength(1);
      expect(typeLines).toHaveLength(1);
    });

    it('produces parseable sample lines', async () => {
      const { service, leases } = harness({ NOTIFICATION_WORKER_ENABLED: true });
      jest.spyOn(leases, 'health').mockResolvedValue({
        pending: 4,
        deadLettered: 2,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      const text = await service.prometheus();
      // Every non-comment line must match `name{labels} value`.
      const sampleLines = text
        .split('\n')
        .filter((line) => line.length > 0 && !line.startsWith('#'));
      expect(sampleLines.length).toBeGreaterThan(0);
      for (const line of sampleLines) {
        expect(line).toMatch(/^[a-z][a-z0-9_]*(\{[^}]*\})? -?\d+(\.\d+)?$/);
      }
    });

    it('escapes quotes and backslashes in label values', async () => {
      // An unescaped quote produces a corrupt exposition that a scraper rejects wholesale, taking every
      // other metric down with it. Exercised through the real formatter by injecting a worker name that
      // contains a quote.
      const { service, supervisor } = harness();
      (supervisor as unknown as { scheduler: { report: () => unknown } }).scheduler.report =
        () => ({
          generatedAt: new Date().toISOString(),
          status: 'ok',
          workers: [
            {
              name: 'weird"worker\\name',
              enabled: true,
              scheduled: true,
              pollIntervalMs: 1000,
              lastStartedAt: null,
              lastCompletedAt: null,
              lastDurationMs: null,
              consecutiveFailures: 0,
              totalCompleted: 0,
              totalFailed: 0,
              lastError: null,
              state: 'HEALTHY',
              activityObserved: true,
            },
          ],
          neverObserved: [],
          disabled: [],
          failing: [],
          stale: [],
          scope: 'test',
        });
      const text = await service.prometheus();
      const line = text.split('\n').find((entry) => entry.startsWith('worker_enabled{'));
      expect(line).toBeDefined();
      expect(line).toContain('weird\\"worker\\\\name');
    });

    it('ends with a trailing newline, as the format requires', async () => {
      const { service, leases } = harness();
      jest.spyOn(leases, 'health').mockResolvedValue({
        pending: 0,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      expect((await service.prometheus()).endsWith('\n')).toBe(true);
    });
  });

  describe('no identifiers leak into labels', () => {
    it('labels the worker series with a fixed name only', async () => {
      // Cardinality and privacy both depend on this: labels must never carry a customer, operation or
      // correlation identifier.
      const { service, leases } = harness();
      jest.spyOn(leases, 'health').mockResolvedValue({
        pending: 1,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: 1,
      });
      const snapshot = await service.snapshot();
      const labelKeys = new Set(
        snapshot.samples.flatMap((sample) => Object.keys(sample.labels ?? {})),
      );
      expect([...labelKeys].sort()).toEqual(['status', 'worker']);
    });
  });
});
