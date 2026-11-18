import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';

import { AlertingService } from '../src/operations/alerting.service';
import { OperationsCentreService } from '../src/operations/operations-centre.service';
import { WorkerLeaseService } from '../src/operations/worker-lease.service';
import { WorkerSupervisorService } from '../src/operations/worker-supervisor.service';

/**
 * ARENA 3D Group 20 — the operations centre.
 *
 * The risk in an aggregating view is not that it misses something; it is that it reports `clear` when it
 * measured nothing, or that it re-derives a verdict and disagrees with the endpoint an operator is also
 * looking at. Both are tested here.
 */

function config(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

interface Options {
  health?: Record<string, unknown> | 'throw';
  passes?: unknown[] | 'throw';
  workerConfig?: Record<string, unknown>;
}

function build(options: Options = {}) {
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
  const supervisor = new WorkerSupervisorService(config(options.workerConfig ?? {}));
  const integrity = {
    lastPasses:
      options.passes === 'throw'
        ? jest.fn().mockRejectedValue(new Error('no history'))
        : jest.fn().mockResolvedValue(options.passes ?? []),
  };
  const alerting = new AlertingService(
    { manager: {} } as DataSource,
    leases,
    supervisor,
    integrity as never,
  );
  const service = new OperationsCentreService(
    { manager: {} } as DataSource,
    leases,
    supervisor,
    integrity as never,
    alerting,
  );
  return { service, leases, supervisor, integrity };
}

describe('Group 20 — operations centre', () => {
  describe('clear means measured and clear', () => {
    it('is clear only when nothing needs attention and every source was read', async () => {
      const { service } = build();
      const view = await service.view();
      // Every readable source contributed. Alerting reports `integrity.regression` as skipped by design —
      // that rule is emitted by the integrity endpoint, which owns the drift comparison — and the centre
      // surfaces that as an unavailable area rather than silently omitting it.
      const reasons = view.unavailable.map((entry) => entry.reason).join(' | ');
      expect(view.unavailable.every((entry) => entry.area === 'SUPERVISION')).toBe(true);
      // `integrity.regression` is reported as not-evaluated here: the integrity endpoint owns the drift
      // comparison. `outbox.backlog` is *satisfied*, not skipped, when no threshold is configured — it was
      // evaluated and found within tolerance, which is different from not having been checked.
      expect(reasons).toMatch(/integrity\.regression/);
      expect(reasons).not.toMatch(/outbox\.backlog/);
      expect(view.partial).toBe(true);
      expect(view.clear).toBe(false);
      // With nothing configured, supervision measured nothing: that is itself an honest item, not silence.
      expect(view.items.map((item) => item.area)).toEqual(['SUPERVISION']);
      expect(view.items[0]?.id).toBe('supervision:indeterminate');
    });

    it('is not clear when a source could not be read', async () => {
      // The failure this prevents: "clear" while the integrity table was unreadable.
      const { service } = build({ passes: 'throw' });
      const view = await service.view();
      expect(view.clear).toBe(false);
      expect(view.partial).toBe(true);
      expect(view.unavailable.map((entry) => entry.area)).toContain('INTEGRITY');
    });

    it('names every unreadable area with a reason', async () => {
      const { service } = build({ passes: 'throw', health: 'throw' });
      const view = await service.view();
      expect(view.unavailable.map((entry) => entry.area).sort()).toContain('INTEGRITY');
      expect(view.unavailable.map((entry) => entry.area)).toContain('QUEUE');
      for (const entry of view.unavailable) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ranking puts interruption first', () => {
    it('orders IMMEDIATE before ROUTINE before INFO', async () => {
      const { service } = build({
        health: { pending: 0, deadLettered: 12, stalled: 2, oldestPendingAgeSeconds: 100 },
        passes: [
          {
            checkName: 'journal_balance_integrity',
            lastStatus: 'ERROR',
            lastPassedAt: new Date(Date.now() - 60_000).toISOString(),
            lastObservedAt: new Date().toISOString(),
          },
        ],
      });
      const view = await service.view();
      const urgencies = view.items.map((item) => item.urgency);
      const rank = (value: string) => (value === 'IMMEDIATE' ? 3 : value === 'ROUTINE' ? 2 : 1);
      const ranks = urgencies.map(rank);
      expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    });

    it('counts by urgency so a shift handover has one number', async () => {
      const { service } = build({
        health: { pending: 0, deadLettered: 12, stalled: 1, oldestPendingAgeSeconds: 100 },
      });
      const view = await service.view();
      expect(view.counts.immediate).toBeGreaterThanOrEqual(1);
      expect(view.counts.immediate + view.counts.routine + view.counts.info).toBe(
        view.items.length,
      );
    });
  });

  describe('it presents existing verdicts rather than re-deriving them', () => {
    it('reports a failing integrity check with the verdict the integrity service stored', async () => {
      const { service } = build({
        passes: [
          {
            checkName: 'wallet_balances_ledger_derived',
            lastStatus: 'ERROR',
            lastPassedAt: null,
            lastObservedAt: new Date().toISOString(),
          },
        ],
      });
      const view = await service.view();
      const item = view.items.find(
        (entry) => entry.id === 'integrity:wallet_balances_ledger_derived',
      );
      expect(item?.severity).toBe('CRITICAL');
      expect(item?.context).toMatchObject({ lastStatus: 'ERROR' });
    });

    it('does not list a passing check at all', async () => {
      // A passing check is not an item needing attention; listing it would bury the real ones.
      const { service } = build({
        passes: [
          {
            checkName: 'journal_balance_integrity',
            lastStatus: 'PASS',
            lastPassedAt: new Date().toISOString(),
            lastObservedAt: new Date().toISOString(),
          },
        ],
      });
      const view = await service.view();
      expect(view.items.some((item) => item.id === 'integrity:journal_balance_integrity')).toBe(
        false,
      );
    });

    it('does not report a dead-letter backlog twice under two names', async () => {
      // The area-specific item and the alert both describe the same condition. Two entries for one problem
      // is how an operator learns to distrust the list.
      const { service } = build({
        health: { pending: 0, deadLettered: 5, stalled: 0, oldestPendingAgeSeconds: 10 },
      });
      const view = await service.view();
      const deadLetterItems = view.items.filter(
        (item) => item.id === 'queue:dead-letters' || item.id === 'alert:outbox.dead-letters',
      );
      expect(deadLetterItems).toHaveLength(1);
      expect(deadLetterItems[0]?.id).toBe('queue:dead-letters');
    });

    it('does not list the same condition as both a supervisor item and an alert', async () => {
      // Found by inspecting real output: `supervision:indeterminate` and
      // `alert:worker.supervision-indeterminate` described one condition as two problems.
      const { service } = build();
      const view = await service.view();
      const indeterminate = view.items.filter((item) => item.id.includes('indeterminate'));
      expect(indeterminate).toHaveLength(1);
    });

    it('does not list a worker individually and again as a generic alert', async () => {
      const { service, supervisor } = build({
        workerConfig: { NOTIFICATION_WORKER_ENABLED: true },
      });
      await expect(
        supervisor.scheduler.observe('notification-delivery', () => Promise.reject(new Error('x'))),
      ).rejects.toThrow();
      const view = await service.view();
      const forWorker = view.items.filter(
        (item) => item.context.worker === 'notification-delivery',
      );
      expect(forWorker).toHaveLength(1);
    });

    it('keeps stable ids across polls', async () => {
      // Ids that change every poll make a UI flicker and make "is this the same problem?" unanswerable.
      const { service } = build({
        health: { pending: 0, deadLettered: 5, stalled: 0, oldestPendingAgeSeconds: 10 },
      });
      const first = await service.view();
      const second = await service.view();
      expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    });
  });

  describe('worker problems surface individually', () => {
    it('lists a failing worker', async () => {
      const { service, supervisor } = build({
        workerConfig: { NOTIFICATION_WORKER_ENABLED: true },
      });
      await expect(
        supervisor.scheduler.observe('notification-delivery', () => Promise.reject(new Error('x'))),
      ).rejects.toThrow();
      const view = await service.view();
      const item = view.items.find((entry) => entry.id === 'worker:notification-delivery:FAILING');
      expect(item).toBeDefined();
      expect(item?.context).toMatchObject({ worker: 'notification-delivery' });
    });
  });

  describe('unreviewed break-glass is visible where operators look (Group 21)', () => {
    function withReviews(posture: unknown) {
      const built = build();
      const service = new OperationsCentreService(
        { manager: {} } as DataSource,
        built.leases,
        built.supervisor,
        built.integrity as never,
        new AlertingService(
          { manager: {} } as DataSource,
          built.leases,
          built.supervisor,
          built.integrity as never,
        ),
        posture instanceof Error
          ? ({ posture: () => Promise.reject(posture) } as never)
          : ({ posture: () => Promise.resolve(posture) } as never),
      );
      return service;
    }

    it('lists emergency access owing a review', async () => {
      const service = withReviews({ pending: 2, reviewed: 5, oldestAwaitingSeconds: 600 });
      const view = await service.view();
      const item = view.items.find((entry) => entry.id === 'security:emergency-review-owed');
      expect(item?.area).toBe('SECURITY');
      expect(item?.urgency).toBe('ROUTINE');
      expect(item?.context).toMatchObject({ pending: 2 });
    });

    it('escalates by how long the review has been owed, not by how many', async () => {
      // One forgotten break-glass window is worse than five reviewed promptly: an unreviewed emergency grant
      // is how a temporary one becomes permanent.
      const service = withReviews({ pending: 1, reviewed: 0, oldestAwaitingSeconds: 90_000 });
      const view = await service.view();
      expect(
        view.items.find((entry) => entry.id === 'security:emergency-review-owed')?.urgency,
      ).toBe('IMMEDIATE');
    });

    it('reports nothing when no review is owed', async () => {
      const service = withReviews({ pending: 0, reviewed: 3, oldestAwaitingSeconds: null });
      const view = await service.view();
      expect(view.items.some((entry) => entry.id === 'security:emergency-review-owed')).toBe(false);
    });

    it('treats an unreadable review state as unavailable, not as clear', async () => {
      const service = withReviews(new Error('authority db down'));
      const view = await service.view();
      expect(view.partial).toBe(true);
      expect(view.unavailable.map((entry) => entry.area)).toContain('SECURITY');
      expect(view.clear).toBe(false);
    });
  });

  describe('open fraud findings and a silent detector are both visible (Group 22)', () => {
    function withFraud(posture: unknown) {
      const built = build();
      return new OperationsCentreService(
        { manager: {} } as DataSource,
        built.leases,
        built.supervisor,
        built.integrity as never,
        new AlertingService(
          { manager: {} } as DataSource,
          built.leases,
          built.supervisor,
          built.integrity as never,
        ),
        undefined,
        posture instanceof Error
          ? ({ detectionPosture: () => Promise.reject(posture) } as never)
          : ({ detectionPosture: () => Promise.resolve(posture) } as never),
      );
    }

    it('lists unreviewed findings', async () => {
      const service = withFraud({
        lastPassAt: '2026-01-01T00:00:00.000Z',
        lastRunAt: '2026-01-01T00:00:00.000Z',
        lastStatus: 'PASS',
        secondsSinceLastPass: 60,
        openFindings: 2,
      });
      const view = await service.view();
      const item = view.items.find((entry) => entry.id === 'fraud:open-findings');
      expect(item?.area).toBe('FRAUD');
      expect(item?.context).toMatchObject({ openFindings: 2 });
    });

    it('reports detection that never ran as unavailable, never as clean', async () => {
      // "No findings" and "we did not look" are identical in a findings count, and only the second is
      // dangerous. This is the Group 18 distinction applied to fraud.
      const service = withFraud({
        lastPassAt: null,
        lastRunAt: null,
        lastStatus: null,
        secondsSinceLastPass: null,
        openFindings: 0,
      });
      const view = await service.view();
      expect(view.unavailable.map((entry) => entry.area)).toContain('FRAUD');
      expect(view.partial).toBe(true);
      expect(view.clear).toBe(false);
    });

    it('reports a stalled evaluator separately from finding volume', async () => {
      // An evaluator that last passed days ago is an outage even when it found nothing; folding this into
      // the findings item would make "no findings" look like good news.
      const service = withFraud({
        lastPassAt: '2026-01-01T00:00:00.000Z',
        lastRunAt: '2026-01-01T00:00:00.000Z',
        lastStatus: 'PASS',
        secondsSinceLastPass: 90_000,
        openFindings: 0,
      });
      const view = await service.view();
      const stale = view.items.find((entry) => entry.id === 'fraud:detection-stale');
      expect(stale?.urgency).toBe('IMMEDIATE');
    });

    it('treats an unreadable detector as unavailable', async () => {
      const service = withFraud(new Error('db down'));
      const view = await service.view();
      expect(view.unavailable.map((entry) => entry.area)).toContain('FRAUD');
    });
  });

  describe('it is read-only and says so', () => {
    it('states that no remediation is offered', async () => {
      const { service } = build();
      const view = await service.view();
      expect(view.scope).toMatch(/Read-only/i);
      expect(view.scope).toMatch(/No remediation/i);
    });

    it('exposes no mutation surface', () => {
      // Guards the boundary structurally: if someone adds an acknowledge/resolve method, this fails and the
      // authority question gets asked.
      const { service } = build();
      const prototypes = Object.getOwnPropertyNames(
        Object.getPrototypeOf(service) as object,
      ).filter((name) => name !== 'constructor');
      expect(prototypes.sort()).toEqual(['view']);
    });
  });

  describe('no identifiers or secrets in the payload', () => {
    it('carries only names, states and counts', async () => {
      const { service } = build({
        health: { pending: 0, deadLettered: 12, stalled: 1, oldestPendingAgeSeconds: 100 },
        passes: [
          {
            checkName: 'journal_balance_integrity',
            lastStatus: 'ERROR',
            lastPassedAt: null,
            lastObservedAt: new Date().toISOString(),
          },
        ],
      });
      const view = await service.view();
      const serialized = JSON.stringify(view);
      expect(serialized).not.toMatch(/apiKey|password|secret|token"/i);
    });
  });
});
