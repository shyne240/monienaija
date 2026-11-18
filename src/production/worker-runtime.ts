/**
 * ARENA 3D Group 37 — the worker process runtime.
 *
 * Boots the application's dependency graph **without an HTTP listener**, verifies the same production
 * readiness gate the API uses, and keeps the process alive on the worker drivers it already has.
 *
 * ## Why the readiness gate is checked here too
 *
 * A worker that runs against a database the API refuses to serve is worse than a worker that does not
 * start: it processes real queue items against a schema the application has declared incompatible.
 * So the worker calls the same `verifyStartup()` and refuses on the same terms — eight unverified
 * financial dependencies, an out-of-date schema, unsound authority. There is no worker-specific
 * override.
 *
 * ## Why shutdown is bounded
 *
 * A `SIGTERM` that hangs is a deployment that hangs: the orchestrator waits, then kills the process
 * mid-transaction. Shutdown is therefore given a deadline, and exceeding it exits non-zero with the
 * reason, so a stuck close is visible in the deployment's own logs rather than being inferred from a
 * restart count.
 *
 * ## Why the dependencies are injected
 *
 * The behaviour that matters here — initialise, verify, refuse, register signals, close once, honour
 * the deadline — has nothing to do with Nest or PostgreSQL. Injecting the application factory and the
 * readiness check makes every one of those paths testable without a database, and means the test that
 * proves "a failed gate closes the application" is about this file rather than about TypeORM.
 */

import type { ProcessRole } from './process-role';

/** The slice of a Nest application context this runtime uses. */
export interface WorkerApplicationContext {
  init(): Promise<unknown>;
  close(): Promise<unknown>;
  get<T>(token: unknown): T;
}

export interface WorkerRuntimeOptions {
  readonly role: ProcessRole;
  readonly createApplication: () => Promise<WorkerApplicationContext>;
  /** Resolves when the process may run; rejects with the reason when it may not. */
  readonly verifyReadiness: (application: WorkerApplicationContext) => Promise<void>;
  /** Names the workers whose drivers are attached, for the log line an operator reads. */
  readonly describeWorkers?: (application: WorkerApplicationContext) => readonly string[];
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
  /** Injectable for tests; defaults to the real process. */
  readonly onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
  readonly exit?: (code: number) => void;
  readonly shutdownTimeoutMs?: number;
  /** Which signals ask for a graceful stop. */
  readonly signals?: readonly NodeJS.Signals[];
}

export type WorkerStartOutcome =
  | { readonly status: 'RUNNING'; readonly workers: readonly string[] }
  | { readonly status: 'REFUSED'; readonly reason: string };

export interface WorkerRuntimeHandle {
  readonly outcome: WorkerStartOutcome;
  /** Idempotent. Safe to call from a test or from a signal handler. */
  shutdown(reason: string): Promise<void>;
  /** How many times the application was closed — asserted to be at most one. */
  readonly closeCount: () => number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Starts a worker process.
 *
 * Order matters and is asserted: initialise, verify readiness, only then announce that workers are
 * running. Announcing first would mean a refused process logs success immediately before exiting.
 */
export async function startWorkerRuntime(
  options: WorkerRuntimeOptions,
): Promise<WorkerRuntimeHandle> {
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const logError = options.logError ?? ((message: string) => process.stderr.write(`${message}\n`));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];

  let closeCount = 0;
  let closing: Promise<void> | null = null;
  let application: WorkerApplicationContext | null = null;

  const closeApplication = async (reason: string): Promise<void> => {
    if (application === null) return;
    closeCount += 1;
    log(`worker process closing (${reason})`);
    await application.close();
  };

  const shutdown = (reason: string): Promise<void> => {
    closing ??= (async () => {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), shutdownTimeoutMs);
        // A pending deadline must not keep the process alive by itself.
        timer.unref?.();
      });
      try {
        const result = await Promise.race([
          closeApplication(reason).then(() => 'closed' as const),
          deadline,
        ]);
        if (result === 'timeout') {
          logError(
            `worker process did not shut down within ${String(shutdownTimeoutMs)}ms (${reason}); ` +
              'exiting non-zero so the deployment does not wait indefinitely',
          );
          exit(1);
          return;
        }
        exit(0);
      } catch (error) {
        logError(
          `worker process failed to close cleanly (${reason}): ` +
            `${error instanceof Error ? error.message : 'unknown'}`,
        );
        exit(1);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    return closing;
  };

  if (options.role !== 'worker') {
    // The caller is responsible for role routing; reaching here is a wiring error, not a bad env.
    throw new Error(`startWorkerRuntime was asked to start a "${options.role}" process`);
  }

  const app = await options.createApplication();
  application = app;
  await app.init();

  try {
    await options.verifyReadiness(app);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'production readiness failed';
    logError(`worker process refused to start: ${reason}`);
    // Closing the context releases the connection pool and any lease it acquired during init.
    await closeApplication('readiness refused');
    exit(1);
    return { outcome: { status: 'REFUSED', reason }, shutdown, closeCount: () => closeCount };
  }

  const workers = options.describeWorkers?.(app) ?? [];

  const onSignal =
    options.onSignal ??
    ((signal, handler) => {
      process.once(signal, handler);
    });
  for (const signal of signals) {
    onSignal(signal, () => {
      void shutdown(signal);
    });
  }

  log(
    workers.length > 0
      ? `worker process running (${workers.join(', ')}); readiness verified, no HTTP listener`
      : 'worker process running; readiness verified, no HTTP listener',
  );

  return { outcome: { status: 'RUNNING', workers }, shutdown, closeCount: () => closeCount };
}
