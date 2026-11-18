import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { AlertingService, NoneAlertChannel } from '../src/operations/alerting.service';
import { ALERT_RULES, type AlertChannel } from '../src/operations/alerting.types';
import { WorkerLeaseService } from '../src/operations/worker-lease.service';
import { WorkerSupervisorService } from '../src/operations/worker-supervisor.service';

/**
 * ARENA 3D Group 19 — alert evaluation, deduplication and flapping suppression.
 *
 * The substance of this group is not "does it detect a problem" — that is a handful of comparisons. It is
 * whether the system survives its first month without being muted. Deduplication and flap suppression are
 * therefore the tests that matter.
 */

function config(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

interface Harness {
  service: AlertingService;
  leases: WorkerLeaseService;
  channel: { name: string; configured: boolean; deliver: jest.Mock };
}

/** Number of deliveries for one specific rule, which is what most assertions here care about. */
function deliveryCountFor(channel: Harness['channel'], ruleId: string): number {
  // `jest.Mock` types `calls` as `any[][]`, so the parameter is annotated rather than inferred. The cast is
  // to the alert shape the channel is always called with.
  const calls = channel.deliver.mock.calls as Array<[{ ruleId: string }]>;
  return calls.filter((call) => call[0].ruleId === ruleId).length;
}

function harness(
  options: {
    health?: Record<string, unknown> | 'throw';
    config?: Record<string, unknown>;
    passes?: unknown[] | 'throw';
    tuning?: Record<string, unknown>;
  } = {},
): Harness {
  const leases = new WorkerLeaseService();
  if (options.health === 'throw') {
    jest.spyOn(leases, 'health').mockRejectedValue(new Error('db down'));
  } else {
    jest.spyOn(leases, 'health').mockResolvedValue(
      (options.health ?? {
        pending: 0,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      }) as never,
    );
  }
  const supervisor = new WorkerSupervisorService(config(options.config ?? {}));
  const integrity = {
    lastPasses:
      options.passes === 'throw'
        ? jest.fn().mockRejectedValue(new Error('no history'))
        : jest.fn().mockResolvedValue(options.passes ?? []),
  };
  const channel = {
    name: 'test-channel',
    configured: true,
    deliver: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const service = new AlertingService(
    { manager: {} } as DataSource,
    leases,
    supervisor,
    integrity as never,
    channel as unknown as AlertChannel,
    options.tuning ?? {},
  );
  return { service, leases, channel };
}

describe('Group 19 — alerting', () => {
  describe('severity and urgency are separate', () => {
    it('does not interrupt for a stable dead-letter backlog', async () => {
      // 40 dead letters is CRITICAL severity but a known, stable condition. Paging on it every pass is how a
      // channel gets muted, which then also hides the real incident.
      const { service } = harness({
        health: { pending: 0, deadLettered: 40, stalled: 0, oldestPendingAgeSeconds: null },
      });
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find(
        (entry) => entry.ruleId === ALERT_RULES.OUTBOX_DEAD_LETTERS,
      );
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.urgency).toBe('ROUTINE');
    });

    it('interrupts immediately for a single newly-stalled lease', async () => {
      // One stalled lease means a worker is dying mid-delivery right now. The count is small; the condition
      // is new. That is the opposite shape to the backlog above.
      const { service } = harness({
        health: { pending: 0, deadLettered: 0, stalled: 1, oldestPendingAgeSeconds: null },
      });
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find(
        (entry) => entry.ruleId === ALERT_RULES.OUTBOX_STALLED_LEASES,
      );
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.urgency).toBe('IMMEDIATE');
    });

    it('escalates urgency only after repeated worker failures', async () => {
      const { service } = harness({ config: { NOTIFICATION_WORKER_ENABLED: true } });
      const supervisor = (service as unknown as { supervisor: WorkerSupervisorService }).supervisor;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          supervisor.scheduler.observe('notification-delivery', () =>
            Promise.reject(new Error('x')),
          ),
        ).rejects.toThrow();
      }
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find((entry) => entry.ruleId === ALERT_RULES.WORKER_FAILING);
      expect(alert?.urgency).toBe('ROUTINE');

      await expect(
        supervisor.scheduler.observe('notification-delivery', () => Promise.reject(new Error('x'))),
      ).rejects.toThrow();
      const escalated = await service.evaluate();
      expect(
        escalated.alerts.find((entry) => entry.ruleId === ALERT_RULES.WORKER_FAILING)?.urgency,
      ).toBe('IMMEDIATE');
    });
  });

  describe('silence is never ambiguous', () => {
    it('names satisfied rules rather than reporting an empty list', async () => {
      const { service } = harness();
      const evaluation = await service.evaluate();
      expect(evaluation.satisfied).toContain(ALERT_RULES.OUTBOX_DEAD_LETTERS);
      expect(evaluation.satisfied).toContain(ALERT_RULES.OUTBOX_STALLED_LEASES);
    });

    it('reports an unreadable source as skipped, never as satisfied', async () => {
      // "No alerts" must not mean "could not check".
      const { service } = harness({ health: 'throw' });
      const evaluation = await service.evaluate();
      expect(evaluation.satisfied).not.toContain(ALERT_RULES.OUTBOX_DEAD_LETTERS);
      expect(evaluation.skipped.map((entry) => entry.ruleId)).toContain(
        ALERT_RULES.OUTBOX_DEAD_LETTERS,
      );
      expect(
        evaluation.skipped.find((entry) => entry.ruleId === ALERT_RULES.OUTBOX_DEAD_LETTERS)
          ?.reason,
      ).toMatch(/could not be read/);
    });

    it('keeps evaluating other sources when one fails', async () => {
      const { service } = harness({
        health: 'throw',
        config: { NOTIFICATION_WORKER_ENABLED: true },
      });
      const evaluation = await service.evaluate();
      // Worker rules still ran: outbox is skipped while supervision is evaluated (and, with nothing observed
      // yet, correctly reports indeterminate rather than satisfied).
      expect(evaluation.skipped.map((entry) => entry.ruleId)).toContain(
        ALERT_RULES.OUTBOX_DEAD_LETTERS,
      );
      expect(evaluation.alerts.map((entry) => entry.ruleId)).toContain(
        ALERT_RULES.WORKER_SUPERVISION_INDETERMINATE,
      );
    });
  });

  describe('deduplication', () => {
    it('sends one alert for a condition observed repeatedly', async () => {
      const { service, channel } = harness({
        health: { pending: 0, deadLettered: 5, stalled: 0, oldestPendingAgeSeconds: null },
      });
      const onlyDeadLetters = (result: { dispatched: Array<{ alert: { ruleId: string } }> }) =>
        result.dispatched.filter((entry) => entry.alert.ruleId === ALERT_RULES.OUTBOX_DEAD_LETTERS);

      const first = await service.dispatch();
      expect(onlyDeadLetters(first)).toHaveLength(1);
      const afterFirst = deliveryCountFor(channel, ALERT_RULES.OUTBOX_DEAD_LETTERS);

      const second = await service.dispatch();
      // The condition is still present but was already sent: no new delivery for it.
      expect(onlyDeadLetters(second)).toHaveLength(0);
      expect(second.suppressed.map((entry) => entry.dedupeKey)).toContain(
        ALERT_RULES.OUTBOX_DEAD_LETTERS,
      );
      expect(deliveryCountFor(channel, ALERT_RULES.OUTBOX_DEAD_LETTERS)).toBe(afterFirst);
    });

    it('keys the condition, not the occurrence', async () => {
      // `worker.failing:banking-dispatch` identifies a condition. If the key included a timestamp every pass
      // would be a new alert and deduplication would do nothing.
      const { service } = harness({ config: { NOTIFICATION_WORKER_ENABLED: true } });
      const supervisor = (service as unknown as { supervisor: WorkerSupervisorService }).supervisor;
      await expect(
        supervisor.scheduler.observe('notification-delivery', () => Promise.reject(new Error('x'))),
      ).rejects.toThrow();
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find((entry) => entry.ruleId === ALERT_RULES.WORKER_FAILING);
      expect(alert?.dedupeKey).toBe(`${ALERT_RULES.WORKER_FAILING}:notification-delivery`);
    });

    it('tracks separate conditions separately', async () => {
      const { service } = harness({
        health: { pending: 0, deadLettered: 3, stalled: 1, oldestPendingAgeSeconds: null },
      });
      const result = await service.dispatch();
      const keys = result.dispatched.map((entry) => entry.alert.dedupeKey);
      expect(keys).toContain(ALERT_RULES.OUTBOX_DEAD_LETTERS);
      expect(keys).toContain(ALERT_RULES.OUTBOX_STALLED_LEASES);
      expect(keys.length).toBe(new Set(keys).size);
    });
  });

  describe('flapping suppression', () => {
    it('treats a condition that clears and returns inside the window as the same incident', async () => {
      // An oscillating check produces a stream nobody reads. One incident, not three alerts.
      const { service, channel } = harness({
        health: { pending: 0, deadLettered: 1, stalled: 0, oldestPendingAgeSeconds: null },
        tuning: { flapWindowMs: 60_000 },
      });
      const sentFor = () => deliveryCountFor(channel, ALERT_RULES.OUTBOX_DEAD_LETTERS);
      await service.dispatch();
      expect(sentFor()).toBe(1);

      // Condition clears.
      (service as unknown as { leases: { health: jest.Mock } }).leases.health.mockResolvedValue({
        pending: 0,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      await service.dispatch();

      // And returns immediately.
      (service as unknown as { leases: { health: jest.Mock } }).leases.health.mockResolvedValue({
        pending: 0,
        deadLettered: 1,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      const flap = await service.dispatch();
      expect(
        flap.dispatched.filter((entry) => entry.alert.ruleId === ALERT_RULES.OUTBOX_DEAD_LETTERS),
      ).toHaveLength(0);
      expect(sentFor()).toBe(1);
    });

    it('re-alerts once the flap window has elapsed', async () => {
      const { service } = harness({
        health: { pending: 0, deadLettered: 1, stalled: 0, oldestPendingAgeSeconds: null },
        tuning: { flapWindowMs: 10 },
      });
      await service.dispatch();
      (service as unknown as { leases: { health: jest.Mock } }).leases.health.mockResolvedValue({
        pending: 0,
        deadLettered: 0,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      await service.dispatch();
      await new Promise((resolve) => setTimeout(resolve, 30));
      (service as unknown as { leases: { health: jest.Mock } }).leases.health.mockResolvedValue({
        pending: 0,
        deadLettered: 1,
        stalled: 0,
        oldestPendingAgeSeconds: null,
      });
      const result = await service.dispatch();
      expect(
        result.dispatched.filter((entry) => entry.alert.ruleId === ALERT_RULES.OUTBOX_DEAD_LETTERS),
      ).toHaveLength(1);
    });
  });

  describe('delivery is honest about being unconfigured', () => {
    it('defaults to a channel that records but does not deliver', async () => {
      // An unconfigured deployment must never appear to have paged anyone.
      const service = new AlertingService(
        { manager: {} } as DataSource,
        Object.assign(new WorkerLeaseService(), {}),
        new WorkerSupervisorService(config()),
        { lastPasses: () => Promise.resolve([]) } as never,
      );
      expect(service.deliveryConfigured).toBe(false);
      expect(service.channelName).toBe('none');
      const channel = new NoneAlertChannel();
      await expect(channel.deliver()).resolves.toMatchObject({ delivered: false });
    });

    it('reports the delivery outcome per alert', async () => {
      const { service, channel } = harness({
        health: { pending: 0, deadLettered: 2, stalled: 0, oldestPendingAgeSeconds: null },
      });
      channel.deliver.mockResolvedValue({ delivered: false, reason: 'channel refused' });
      const result = await service.dispatch();
      expect(result.dispatched[0]).toMatchObject({ delivered: false, reason: 'channel refused' });
    });
  });

  describe('backlog thresholds are configuration, not guesses', () => {
    it('does not alert when no threshold is configured', async () => {
      // Inventing a backlog threshold would be inventing an operational policy nobody agreed to.
      const { service } = harness({
        health: { pending: 999_999, deadLettered: 0, stalled: 0, oldestPendingAgeSeconds: 999_999 },
      });
      const evaluation = await service.evaluate();
      expect(evaluation.alerts.some((entry) => entry.ruleId === ALERT_RULES.OUTBOX_BACKLOG)).toBe(
        false,
      );
      expect(evaluation.satisfied).toContain(ALERT_RULES.OUTBOX_BACKLOG);
    });

    it('alerts once a configured depth threshold is exceeded', async () => {
      const { service } = harness({
        health: { pending: 51, deadLettered: 0, stalled: 0, oldestPendingAgeSeconds: 10 },
        tuning: { outboxBacklogDepth: 50 },
      });
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find((entry) => entry.ruleId === ALERT_RULES.OUTBOX_BACKLOG);
      expect(alert?.context).toMatchObject({ pending: 51, depthLimit: 50 });
    });
  });

  describe('integrity alerts distinguish new from stale', () => {
    it('does not emit a regression alert from the evaluator', async () => {
      // Regressions come from the integrity endpoint, which has the drift comparison. Re-running
      // reconciliation on a timer here would make alerting a second caller of a read-only scan, at its own
      // cost and with its own failure modes.
      const { service } = harness({ passes: [] });
      const evaluation = await service.evaluate();
      expect(
        evaluation.alerts.some((entry) => entry.ruleId === ALERT_RULES.INTEGRITY_REGRESSION),
      ).toBe(false);
      expect(
        evaluation.skipped.find((entry) => entry.ruleId === ALERT_RULES.INTEGRITY_REGRESSION),
      ).toBeDefined();
    });

    it('escalates a long-standing failure as ROUTINE, not IMMEDIATE', async () => {
      const { service } = harness({
        passes: [
          {
            checkName: 'journal_balance_integrity',
            lastStatus: 'ERROR',
            lastPassedAt: new Date(Date.now() - 86_400_000).toISOString(),
            lastObservedAt: new Date().toISOString(),
          },
        ],
        tuning: { integrityStaleFailureSeconds: 3_600 },
      });
      const evaluation = await service.evaluate();
      const alert = evaluation.alerts.find(
        (entry) => entry.ruleId === ALERT_RULES.INTEGRITY_STALE_FAILURE,
      );
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.urgency).toBe('ROUTINE');
    });

    it('reports unreadable integrity history as skipped', async () => {
      const { service } = harness({ passes: 'throw' });
      const evaluation = await service.evaluate();
      expect(evaluation.skipped.map((entry) => entry.ruleId)).toContain(
        ALERT_RULES.INTEGRITY_STALE_FAILURE,
      );
    });
  });

  describe('no secrets in alert payloads', () => {
    it('carries worker and error details but no credential fields', async () => {
      const { service } = harness({ config: { NOTIFICATION_WORKER_ENABLED: true } });
      const supervisor = (service as unknown as { supervisor: WorkerSupervisorService }).supervisor;
      await expect(
        supervisor.scheduler.observe('notification-delivery', () =>
          Promise.reject(new Error('provider rejected')),
        ),
      ).rejects.toThrow();
      const evaluation = await service.evaluate();
      for (const alert of evaluation.alerts) {
        const serialized = JSON.stringify(alert);
        expect(serialized).not.toMatch(/apiKey|password|secret|pin"/i);
      }
    });
  });
});
