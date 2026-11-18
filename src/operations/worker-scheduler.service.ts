/**
 * ARENA 3D Group 15 — worker supervision: one authoritative runtime view of every background worker.
 *
 * ## Scope, deliberately narrow
 *
 * Every worker in this application already owns its own execution: `setInterval` drivers in
 * `onModuleInit`, an internal overlap guard (`active`/`running`), re-entrancy protection, and — where
 * correctness needs it — a database lease (banking dispatch) or a natural database serialiser (KYC's
 * `ON CONFLICT DO NOTHING`). Group 14 established that those mechanisms are correct.
 *
 * This module therefore does **not** add a second ownership or scheduling layer. It adds the thing that
 * was actually missing: a single place that can answer, at runtime,
 *
 *   - which workers this process knows about,
 *   - whether each is enabled by configuration and actually ticking,
 *   - when each last succeeded or failed, and how long the last tick took,
 *   - whether any tick has been silently failing.
 *
 * Before this, that answer was scattered across four `getStatus()` methods with different shapes, three of
 * which did not exist.
 *
 * ## Why "stale" is measured, not assumed
 *
 * A worker is **stale** when a tick that should have happened has not been observed within a grace
 * multiple of its interval. That is a measurement of absence. The distinction matters:
 *
 *  - `INACTIVE` + `activityObserved: false` — disabled by configuration, or this process is not the
 *    scheduler. **Nothing has been measured**, so this must never be reported as healthy.
 *  - `STALE` — the worker is supposed to be ticking and has not. Measurable, and actionable.
 *
 * A supervisor that reports "healthy" because it never observed anything is worse than no supervisor:
 * it converts an unmeasured system into an apparently-checked one.
 *
 * ## What this cannot see
 *
 * Supervision is per process. Two instances each report their own view, and neither knows the other is
 * alive. Fleet-wide "is *someone* polling the queue" is not answerable from here — the database lease and
 * the queue itself remain the authority on whether work is progressing. `stale` is a signal about *this*
 * process, and is presented as such.
 */

/** Health of one supervised worker, as observed in this process. */
export type SupervisorWorkerState =
  /** Configured off. No timer, no ticks, nothing measured. */
  | 'DISABLED'
  /** Configured on, but no tick has been observed yet. Not evidence of health. */
  | 'AWAITING_FIRST_TICK'
  /** Ticking with recent successful completion. */
  | 'HEALTHY'
  /** A tick that should have completed has not, within the grace window. */
  | 'STALE'
  /** The last observed tick threw. The worker is still scheduled, but is not completing work. */
  | 'FAILING';

export interface WorkerObservation {
  name: string;
  /** Whether configuration enables this worker in this process. */
  enabled: boolean;
  /** Whether a driver (interval or external) is attached in this process. */
  scheduled: boolean;
  pollIntervalMs: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  totalCompleted: number;
  totalFailed: number;
  lastError: string | null;
  state: SupervisorWorkerState;
  /**
   * False when nothing has been observed at all — disabled, or never ticked. Callers must not read a
   * non-`FAILING` state as healthy unless this is true.
   */
  activityObserved: boolean;
}

export interface WorkerDescriptor {
  name: string;
  enabled: boolean;
  scheduled: boolean;
  pollIntervalMs: number;
}

export interface SupervisorReport {
  generatedAt: string;
  /** Aggregate readiness. `indeterminate` is a distinct outcome, not a synonym for `ok`. */
  status: 'ok' | 'degraded' | 'indeterminate';
  workers: WorkerObservation[];
  /** Workers that are configured on but have never been observed ticking in this process. */
  neverObserved: string[];
  /** Workers configured off. Nothing was measured for these, by definition. */
  disabled: string[];
  /** Workers whose last tick failed. */
  failing: string[];
  /** Workers whose expected tick did not arrive. */
  stale: string[];
  /**
   * Stated in the payload so a consumer cannot mistake this for a fleet-wide signal.
   */
  scope: string;
}

interface WorkerRecord {
  descriptor: WorkerDescriptor;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  totalCompleted: number;
  totalFailed: number;
  lastError: string | null;
}

export interface SchedulerOptions {
  /**
   * How many intervals may pass without a completed tick before the worker is called stale.
   * Default 3: one missed poll is normal jitter or a slow batch; three is a pattern.
   */
  staleAfterMissedIntervals?: number;
  /** Clock injection, so staleness is testable without sleeping. */
  now?: () => number;
}

export class WorkerScheduler {
  private readonly records = new Map<string, WorkerRecord>();
  private readonly staleAfterMissedIntervals: number;
  private readonly now: () => number;

  constructor(options: SchedulerOptions = {}) {
    this.staleAfterMissedIntervals = Math.max(options.staleAfterMissedIntervals ?? 3, 1);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Registers a worker for supervision. Nothing is started.
   *
   * Registration is separate from execution on purpose: the scheduler observes ticks that the worker's own
   * driver performs. It never calls `tick()` itself, so there is exactly one driver per worker and no
   * competing scheduler.
   */
  register(descriptor: WorkerDescriptor): void {
    const existing = this.records.get(descriptor.name);
    if (existing) {
      // Re-registration updates configuration but must not erase observation history — losing the history
      // would reset `consecutiveFailures` to zero and hide a failing worker.
      existing.descriptor = descriptor;
      return;
    }
    this.records.set(descriptor.name, {
      descriptor,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastDurationMs: null,
      consecutiveFailures: 0,
      totalCompleted: 0,
      totalFailed: 0,
      lastError: null,
    });
  }

  /**
   * Runs a worker tick under observation and returns its result unchanged.
   *
   * This is a **wrapper, not a driver**. It never decides when to run; the caller invokes it from the
   * worker's existing timer. The worker's return value passes through untouched so no caller behaviour
   * changes, and errors are re-thrown rather than swallowed — a supervisor that hides exceptions changes
   * program behaviour, which is not its job.
   */
  async observe<T>(name: string, run: () => Promise<T>): Promise<T> {
    const record = this.records.get(name);
    if (!record) {
      throw new Error(`Worker "${name}" is not registered with the scheduler`);
    }
    const startedAt = this.now();
    record.lastStartedAt = startedAt;
    try {
      const result = await run();
      record.totalCompleted += 1;
      record.consecutiveFailures = 0;
      record.lastError = null;
      return result;
    } catch (error) {
      record.totalFailed += 1;
      record.consecutiveFailures += 1;
      record.lastError = describeFailure(error);
      throw error;
    } finally {
      const completedAt = this.now();
      record.lastCompletedAt = completedAt;
      record.lastDurationMs = completedAt - startedAt;
    }
  }

  report(): SupervisorReport {
    const now = this.now();
    const workers = [...this.records.values()].map((record) => this.observeRecord(record, now));
    const neverObserved = workers
      .filter((worker) => worker.enabled && !worker.activityObserved)
      .map((worker) => worker.name);
    // Reported separately rather than folded into `neverObserved`. They share the property of having
    // measured nothing, but the operator action is opposite: `neverObserved` is a fault to investigate,
    // `disabled` is a configuration decision.
    const disabled = workers.filter((worker) => !worker.enabled).map((worker) => worker.name);
    const failing = workers
      .filter((worker) => worker.state === 'FAILING')
      .map((worker) => worker.name);
    const stale = workers.filter((worker) => worker.state === 'STALE').map((worker) => worker.name);

    /*
     * `indeterminate` is load-bearing.
     *
     * If no worker has been observed at all — every one disabled, or supervision attached to a process that
     * is not the scheduler — then nothing has been measured. Reporting `ok` there would let a deployment
     * with every worker switched off pass a supervision check, which is exactly the failure this report
     * exists to make visible.
     */
    const anyObserved = workers.some((worker) => worker.activityObserved);
    const status: SupervisorReport['status'] =
      failing.length > 0 || stale.length > 0
        ? 'degraded'
        : !anyObserved || neverObserved.length > 0
          ? 'indeterminate'
          : 'ok';

    return {
      generatedAt: new Date(now).toISOString(),
      status,
      workers,
      neverObserved,
      disabled,
      failing,
      stale,
      scope:
        'Process-local observation of this instance only. It does not prove that work is progressing ' +
        'fleet-wide; the database lease and queue depth remain the authority for that.',
    };
  }

  private observeRecord(record: WorkerRecord, now: number): WorkerObservation {
    const { descriptor } = record;
    const activityObserved = record.lastCompletedAt !== null;
    const base = {
      name: descriptor.name,
      enabled: descriptor.enabled,
      scheduled: descriptor.scheduled,
      pollIntervalMs: descriptor.pollIntervalMs,
      lastStartedAt:
        record.lastStartedAt === null ? null : new Date(record.lastStartedAt).toISOString(),
      lastCompletedAt:
        record.lastCompletedAt === null ? null : new Date(record.lastCompletedAt).toISOString(),
      lastDurationMs: record.lastDurationMs,
      consecutiveFailures: record.consecutiveFailures,
      totalCompleted: record.totalCompleted,
      totalFailed: record.totalFailed,
      lastError: record.lastError,
      activityObserved,
    };

    if (!descriptor.enabled) {
      return { ...base, state: 'DISABLED' };
    }
    if (!activityObserved) {
      return { ...base, state: 'AWAITING_FIRST_TICK' };
    }
    if (record.consecutiveFailures > 0) {
      return { ...base, state: 'FAILING' };
    }
    const graceMs = descriptor.pollIntervalMs * this.staleAfterMissedIntervals;
    const sinceCompletion = now - (record.lastCompletedAt ?? 0);
    if (sinceCompletion > graceMs) {
      return { ...base, state: 'STALE' };
    }
    return { ...base, state: 'HEALTHY' };
  }
}

/**
 * Extracts an error message without leaking a driver payload.
 *
 * Database driver errors embed the SQL and its bound parameters in `detail`; a supervisor report is
 * operationally visible (Group 17/19), so it must carry the failure identity and not the query.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 200);
  }
  return 'tick failed with a non-Error value';
}
