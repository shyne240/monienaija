/**
 * ARENA 3D Group 37 — process roles.
 *
 * ## The gap this closes
 *
 * Every background worker in this application starts from `onModuleInit` inside whichever process
 * boots `AppModule`. Until now that was only ever the HTTP process, which means "are the workers
 * running?" and "is the API serving?" had the same answer: they were the same process. That is not a
 * deployment architecture, it is a side effect.
 *
 * Two consequences, both named in the continuation record as a standing obligation:
 *
 *  - an API replica count of four means four replicas of every worker, each with its own timers, and
 *    nothing in the deployment says whether that is intended;
 *  - a worker that dies silently takes an API with it, and an API restart restarts every worker
 *    mid-tick.
 *
 * `PROCESS_ROLE` makes the distinction explicit and deployable from the same image.
 *
 * ## Why the default is `all-in-one`
 *
 * Changing the default would change what every existing deployment does on upgrade. The default
 * therefore preserves today's behaviour exactly, and the role that a production deployment *should*
 * use is documented rather than imposed — see `docs/integration/WORKER-EXECUTION.md`. A default that
 * silently stopped running workers on upgrade would be a worse bug than the one being fixed.
 *
 * ## What this does NOT do
 *
 * It does not add a scheduler, a leader election or a queue. The database leases (Group 14), fencing,
 * idempotency and the existing financial authority remain the only authority on who may do what. A
 * role tells the process **whether to start the drivers it already has**; it grants nothing.
 */

export const PROCESS_ROLE_ENV = 'PROCESS_ROLE';

/**
 * - `api` — serves HTTP and starts no background worker drivers.
 * - `worker` — starts the drivers and serves no HTTP at all.
 * - `all-in-one` — the historical behaviour: both in one process. Correct for development and
 *   single-instance deployments, and explicitly not recommended for a fleet.
 */
export type ProcessRole = 'api' | 'worker' | 'all-in-one';

export const PROCESS_ROLES: readonly ProcessRole[] = ['api', 'worker', 'all-in-one'];

/**
 * Resolves the role, refusing anything unrecognised.
 *
 * A typo must not silently become a role. `PROCESS_ROLE=worke` reading as `all-in-one` would mean an
 * operator who tried to separate the workers got a process doing both, with no indication that their
 * intent was discarded.
 */
export function resolveProcessRole(raw: string | undefined): ProcessRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'all-in-one';
  const match = PROCESS_ROLES.find((role) => role === value);
  if (!match) {
    throw new Error(
      `${PROCESS_ROLE_ENV}=${JSON.stringify(raw)} is not a process role. Allowed: ` +
        `${PROCESS_ROLES.join(', ')} (unset means all-in-one).`,
    );
  }
  return match;
}

/** Whether this role serves HTTP. */
export function servesHttp(role: ProcessRole): boolean {
  return role === 'api' || role === 'all-in-one';
}

/** Whether this role starts background worker drivers. */
export function runsBackgroundWorkers(role: ProcessRole): boolean {
  return role === 'worker' || role === 'all-in-one';
}

/** The worker flags a process uses to decide whether to attach its timers. */
export const WORKER_ENABLEMENT_KEYS: readonly string[] = [
  'CASH_TO_CASH_EXPIRY_WORKER_ENABLED',
  'KYC_TIER_WORKER_ENABLED',
  'BANKING_DISPATCH_WORKER_ENABLED',
  'NOTIFICATION_WORKER_ENABLED',
];

/**
 * Composes the environment for the role, refusing contradictions.
 *
 * A `PROCESS_ROLE=api` process must not attach worker timers, or the split is cosmetic. The flags are
 * how each worker decides, so the role turns them off — but only when the operator has not asked for
 * the opposite. If someone sets `KYC_TIER_WORKER_ENABLED=true` **and** `PROCESS_ROLE=api`, one of the
 * two is a mistake, and silently preferring either produces a deployment nobody can reason about. So
 * it refuses, with both values named.
 *
 * `worker` and `all-in-one` change nothing: every worker keeps its own documented default and its own
 * explicit flag. The role decides whether the *process* serves HTTP; it does not silently re-tune
 * individual workers.
 */
export function applyProcessRoleEnvironment(
  role: ProcessRole,
  env: Record<string, string | undefined>,
): readonly string[] {
  if (role !== 'api') return [];

  const conflicts = WORKER_ENABLEMENT_KEYS.filter(
    (key) => (env[key] ?? '').trim().toLowerCase() === 'true',
  );
  if (conflicts.length > 0) {
    throw new Error(
      `PROCESS_ROLE=api contradicts ${conflicts.join(', ')}=true. An API process starts no background ` +
        'workers; remove the role, remove the flag, or use PROCESS_ROLE=worker.',
    );
  }
  for (const key of WORKER_ENABLEMENT_KEYS) {
    env[key] = 'false';
  }
  return WORKER_ENABLEMENT_KEYS.map((key) => `${key}=false`);
}
