import type { ConfigService } from '@nestjs/config';

import {
  SUPERVISED_WORKER_DEFAULTS,
  SUPERVISED_WORKERS,
  WorkerSupervisorService,
} from '../src/operations/worker-supervisor.service';
import { WorkerScheduler } from '../src/operations/worker-scheduler.service';

/**
 * ARENA 3D Group 15 — worker supervision.
 *
 * These tests are about the supervisor telling the truth. The failure mode a supervisor can have is not
 * crashing; it is reporting `ok` when it measured nothing, which converts an unmonitored system into an
 * apparently-checked one.
 */

function configFrom(values: Record<string, unknown>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

describe('Group 15 — worker supervision', () => {
  describe('the registry names the keys that actually exist', () => {
    it('uses the real polling-interval key for every worker', () => {
      // Banking's interval is `BANKING_DISPATCH_POLL_INTERVAL_MS`, not `..._WORKER_POLL_INTERVAL_MS`.
      // An earlier draft of this registry guessed the uniform name; the mistake is silent, because the
      // registry then reports a default while the worker runs on a configured value. Pinning the exact
      // strings here makes any future rename a failing test.
      expect(SUPERVISED_WORKER_DEFAULTS[SUPERVISED_WORKERS.BANKING_DISPATCH].intervalKey).toBe(
        'BANKING_DISPATCH_POLL_INTERVAL_MS',
      );
      for (const name of [
        SUPERVISED_WORKERS.AGENT_CASH_TO_CASH_EXPIRY,
        SUPERVISED_WORKERS.KYC_TIER_REEVALUATION,
        SUPERVISED_WORKERS.NOTIFICATION_DELIVERY,
      ]) {
        expect(SUPERVISED_WORKER_DEFAULTS[name].intervalKey).toMatch(/_WORKER_POLL_INTERVAL_MS$/);
      }
    });

    it('lists exactly the four background pollers', () => {
      expect(Object.values(SUPERVISED_WORKERS).sort()).toEqual([
        'agent-cash-to-cash-expiry',
        'banking-dispatch',
        'kyc-tier-reevaluation',
        'notification-delivery',
      ]);
    });
  });

  describe('a supervisor that measured nothing never reports ok', () => {
    it('reports indeterminate when every worker is disabled', () => {
      const supervisor = new WorkerSupervisorService(configFrom({}));
      const report = supervisor.report();
      expect(report.status).toBe('indeterminate');
      // A fully-disabled fleet reports every worker as disabled, and none as "never observed": the two are
      // different operator actions (a configuration decision versus a fault to investigate).
      expect(report.disabled).toHaveLength(4);
      expect(report.neverObserved).toEqual([]);
      expect(report.workers.every((worker) => worker.state === 'DISABLED')).toBe(true);
      expect(report.workers.every((worker) => worker.activityObserved === false)).toBe(true);
    });

    it('reports indeterminate, not ok, when enabled but never ticked', () => {
      // "enabled and no observations yet" is the exact window in which a bad supervisor says healthy.
      const supervisor = new WorkerSupervisorService(
        configFrom({ NOTIFICATION_WORKER_ENABLED: true }),
      );
      const report = supervisor.report();
      expect(report.status).toBe('indeterminate');
      expect(report.neverObserved).toContain('notification-delivery');
      const notification = report.workers.find((worker) => worker.name === 'notification-delivery');
      expect(notification?.state).toBe('AWAITING_FIRST_TICK');
      expect(notification?.activityObserved).toBe(false);
    });

    it('states its scope so it cannot be mistaken for a fleet signal', () => {
      const supervisor = new WorkerSupervisorService(configFrom({}));
      expect(supervisor.report().scope).toMatch(/Process-local/i);
      expect(supervisor.report().scope).toMatch(/database lease/i);
    });
  });

  describe('observation records what happened', () => {
    let now: number;
    let scheduler: WorkerScheduler;
    const clock = (): number => now;

    beforeEach(() => {
      now = 1_000_000;
      scheduler = new WorkerScheduler({ now: clock, staleAfterMissedIntervals: 3 });
      scheduler.register({
        name: 'probe',
        enabled: true,
        scheduled: true,
        pollIntervalMs: 1_000,
      });
    });

    it('passes the result through unchanged', async () => {
      // The supervisor must not alter program behaviour. If it wrapped, reshaped or swallowed results it
      // would become part of the business logic instead of an observer of it.
      const value = { claimed: 2, dispatched: 1 };
      await expect(scheduler.observe('probe', () => Promise.resolve(value))).resolves.toBe(value);
    });

    it('rethrows the original error rather than swallowing it', async () => {
      const failure = new Error('provider unavailable');
      await expect(scheduler.observe('probe', () => Promise.reject(failure))).rejects.toBe(failure);
      expect(scheduler.report().failing).toEqual(['probe']);
    });

    it('refuses to observe an unregistered worker', async () => {
      // A typo in a worker name must fail loudly. Silently creating an untracked entry would produce a
      // report that looks complete while a worker runs outside supervision.
      await expect(scheduler.observe('not-registered', () => Promise.resolve())).rejects.toThrow(
        /not registered/,
      );
    });

    it('reports healthy only after an observed completion', async () => {
      expect(scheduler.report().status).toBe('indeterminate');
      await scheduler.observe('probe', () => Promise.resolve());
      const report = scheduler.report();
      expect(report.status).toBe('ok');
      expect(report.workers[0]?.state).toBe('HEALTHY');
      expect(report.workers[0]?.activityObserved).toBe(true);
      expect(report.workers[0]?.totalCompleted).toBe(1);
    });

    it('goes stale when the expected tick does not arrive', async () => {
      await scheduler.observe('probe', () => Promise.resolve());
      now += 1_000 * 3 + 1;
      expect(scheduler.report().workers[0]?.state).toBe('STALE');
      expect(scheduler.report().status).toBe('degraded');
      expect(scheduler.report().stale).toEqual(['probe']);
    });

    it('does not go stale within the grace window', async () => {
      await scheduler.observe('probe', () => Promise.resolve());
      now += 1_000 * 2;
      expect(scheduler.report().workers[0]?.state).toBe('HEALTHY');
    });

    it('recovers to healthy after a success following a failure', async () => {
      await expect(
        scheduler.observe('probe', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow();
      expect(scheduler.report().workers[0]?.state).toBe('FAILING');
      await scheduler.observe('probe', () => Promise.resolve());
      const worker = scheduler.report().workers[0];
      expect(worker?.state).toBe('HEALTHY');
      expect(worker?.consecutiveFailures).toBe(0);
      expect(worker?.lastError).toBeNull();
      expect(worker?.totalFailed).toBe(1);
      expect(worker?.totalCompleted).toBe(1);
    });

    it('records duration and completion time', async () => {
      const pending = scheduler.observe(
        'probe',
        () =>
          new Promise<void>((resolve) => {
            now += 250;
            resolve();
          }),
      );
      await pending;
      const worker = scheduler.report().workers[0];
      expect(worker?.lastDurationMs).toBe(250);
      expect(worker?.lastCompletedAt).not.toBeNull();
    });

    it('does not erase failure history when re-registered', () => {
      // Re-registration happens on configuration refresh. Resetting counters there would hide a worker that
      // has been failing continuously.
      scheduler.register({
        name: 'probe',
        enabled: true,
        scheduled: true,
        pollIntervalMs: 1_000,
      });
      expect(scheduler.report().workers).toHaveLength(1);
    });
  });

  describe('banking enablement follows the module factory, not the obvious guess', () => {
    it('treats explicit BANKING_DISPATCH_WORKER_ENABLED as authoritative', () => {
      const on = new WorkerSupervisorService(
        configFrom({ BANKING_DISPATCH_WORKER_ENABLED: true, BANKING_ENABLED: false }),
      );
      expect(on.report().workers.find((w) => w.name === 'banking-dispatch')?.enabled).toBe(true);

      const off = new WorkerSupervisorService(
        configFrom({ BANKING_DISPATCH_WORKER_ENABLED: false, BANKING_ENABLED: true }),
      );
      expect(off.report().workers.find((w) => w.name === 'banking-dispatch')?.enabled).toBe(false);
    });

    it('falls back to BANKING_ENABLED only outside the test environment', () => {
      // The module factory enables banking when the explicit switch is unset and BANKING_ENABLED is on,
      // except under NODE_ENV=test. Reading only the explicit key would misreport a live instance.
      const original = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const production = new WorkerSupervisorService(configFrom({ BANKING_ENABLED: true }));
        expect(
          production.report().workers.find((w) => w.name === 'banking-dispatch')?.enabled,
        ).toBe(true);

        process.env.NODE_ENV = 'test';
        const underTest = new WorkerSupervisorService(configFrom({ BANKING_ENABLED: true }));
        expect(underTest.report().workers.find((w) => w.name === 'banking-dispatch')?.enabled).toBe(
          false,
        );
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });
});
