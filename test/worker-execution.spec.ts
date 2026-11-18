import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROCESS_ROLES,
  WORKER_ENABLEMENT_KEYS,
  applyProcessRoleEnvironment,
  resolveProcessRole,
  runsBackgroundWorkers,
  servesHttp,
} from '../src/production/process-role';
import {
  startWorkerRuntime,
  type WorkerApplicationContext,
} from '../src/production/worker-runtime';

/**
 * ARENA 3D Group 37 — automated worker execution.
 *
 * The continuation record has carried this as a standing requirement since Group 15: supervision
 * observes, it does not start anything, and nothing documented or tested a deployable mechanism that
 * guarantees the essential workers are invoked in a running deployment.
 *
 * What is proven here is the mechanism: a role that serves no HTTP, verifies the same production
 * readiness gate, refuses to run when the gate refuses, and shuts down once and within a deadline.
 * What is NOT proven here — and cannot be, in this sandbox — is that a deployment actually runs it.
 * That distinction is carried into the release gate, not argued away.
 */

function fakeApplication(overrides: Partial<WorkerApplicationContext> = {}) {
  const calls: string[] = [];
  const application: WorkerApplicationContext = {
    init: () => {
      calls.push('init');
      return Promise.resolve();
    },
    close: () => {
      calls.push('close');
      return Promise.resolve();
    },
    get: <T>() => ({}) as T,
    ...overrides,
  };
  return { application, calls };
}

function harness() {
  const exits: number[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const signals: { signal: NodeJS.Signals; handler: () => void }[] = [];
  return {
    exits,
    logs,
    errors,
    signals,
    options: {
      log: (message: string) => logs.push(message),
      logError: (message: string) => errors.push(message),
      exit: (code: number) => exits.push(code),
      onSignal: (signal: NodeJS.Signals, handler: () => void) => signals.push({ signal, handler }),
    },
  };
}

describe('process roles', () => {
  it('defaults to all-in-one so an upgrade changes nothing', () => {
    expect(resolveProcessRole(undefined)).toBe('all-in-one');
    expect(resolveProcessRole('')).toBe('all-in-one');
    expect(resolveProcessRole('   ')).toBe('all-in-one');
  });

  it('accepts the three roles, case- and space-insensitively', () => {
    expect(resolveProcessRole('api')).toBe('api');
    expect(resolveProcessRole('WORKER')).toBe('worker');
    expect(resolveProcessRole(' All-In-One ')).toBe('all-in-one');
    expect(PROCESS_ROLES).toEqual(['api', 'worker', 'all-in-one']);
  });

  it('refuses a typo instead of silently choosing a role', () => {
    // `worke` must not read as all-in-one: the operator intended to separate the workers.
    expect(() => resolveProcessRole('worke')).toThrow(/is not a process role/);
    expect(() => resolveProcessRole('workers')).toThrow(/Allowed: api, worker, all-in-one/);
  });

  it('splits HTTP from worker execution', () => {
    expect(servesHttp('api')).toBe(true);
    expect(servesHttp('worker')).toBe(false);
    expect(servesHttp('all-in-one')).toBe(true);
    expect(runsBackgroundWorkers('worker')).toBe(true);
    expect(runsBackgroundWorkers('api')).toBe(false);
    expect(runsBackgroundWorkers('all-in-one')).toBe(true);
  });
});

describe('process role environment', () => {
  it('turns every worker flag off for an API process', () => {
    const env: Record<string, string | undefined> = {};
    const changes = applyProcessRoleEnvironment('api', env);
    expect(changes).toHaveLength(WORKER_ENABLEMENT_KEYS.length);
    for (const key of WORKER_ENABLEMENT_KEYS) {
      expect(env[key]).toBe('false');
    }
  });

  it('refuses a configuration that contradicts the role', () => {
    const env = { KYC_TIER_WORKER_ENABLED: 'TRUE' };
    expect(() => applyProcessRoleEnvironment('api', env)).toThrow(
      /PROCESS_ROLE=api contradicts KYC_TIER_WORKER_ENABLED=true/,
    );
  });

  it('changes nothing for a worker or all-in-one process', () => {
    for (const role of ['worker', 'all-in-one'] as const) {
      const env: Record<string, string | undefined> = { KYC_TIER_WORKER_ENABLED: 'true' };
      expect(applyProcessRoleEnvironment(role, env)).toEqual([]);
      expect(env.KYC_TIER_WORKER_ENABLED).toBe('true');
    }
  });
});

describe('worker runtime', () => {
  it('initialises, verifies readiness, then reports running — in that order', async () => {
    const { application, calls } = fakeApplication();
    const order: string[] = [];
    const h = harness();

    const handle = await startWorkerRuntime({
      role: 'worker',
      createApplication: () => {
        order.push('create');
        return Promise.resolve(application);
      },
      verifyReadiness: () => {
        order.push('verify');
        // The application must already be initialised when the gate runs.
        expect(calls).toEqual(['init']);
        return Promise.resolve();
      },
      describeWorkers: () => ['banking-dispatch', 'kyc-tier-reevaluation'],
      ...h.options,
    });

    expect(handle.outcome).toEqual({
      status: 'RUNNING',
      workers: ['banking-dispatch', 'kyc-tier-reevaluation'],
    });
    expect(order).toEqual(['create', 'verify']);
    expect(h.logs.join(' ')).toMatch(/readiness verified, no HTTP listener/);
    expect(h.exits).toEqual([]);
  });

  it('refuses to run when the production readiness gate refuses, and closes what it opened', async () => {
    const { application, calls } = fakeApplication();
    const h = harness();

    const handle = await startWorkerRuntime({
      role: 'worker',
      createApplication: () => Promise.resolve(application),
      verifyReadiness: () =>
        Promise.reject(new Error('Production readiness failed: financial_dependencies_not_ready')),
      ...h.options,
    });

    expect(handle.outcome).toMatchObject({ status: 'REFUSED' });
    // The context is closed: a refused process must not hold a connection pool or a lease.
    expect(calls).toEqual(['init', 'close']);
    expect(h.exits).toEqual([1]);
    expect(h.errors.join(' ')).toMatch(/refused to start: Production readiness failed/);
    // A refused process registers no signal handlers: there is nothing to stop.
    expect(h.signals).toEqual([]);
  });

  it('closes exactly once on SIGTERM and exits zero', async () => {
    const { application } = fakeApplication();
    const h = harness();

    const handle = await startWorkerRuntime({
      role: 'worker',
      createApplication: () => Promise.resolve(application),
      verifyReadiness: () => Promise.resolve(),
      ...h.options,
    });

    expect(h.signals.map((entry) => entry.signal)).toEqual(['SIGTERM', 'SIGINT']);
    h.signals[0]?.handler();
    await handle.shutdown('SIGTERM');

    expect(handle.closeCount()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('is idempotent: a second signal does not close twice or exit twice', async () => {
    const { application } = fakeApplication();
    const h = harness();

    const handle = await startWorkerRuntime({
      role: 'worker',
      createApplication: () => Promise.resolve(application),
      verifyReadiness: () => Promise.resolve(),
      ...h.options,
    });

    await Promise.all([handle.shutdown('SIGTERM'), handle.shutdown('SIGINT')]);
    await handle.shutdown('SIGTERM');

    expect(handle.closeCount()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('does not hang a deployment: a close that never finishes exits non-zero', async () => {
    const { application } = fakeApplication({
      close: () => new Promise<never>(() => undefined),
    });
    const h = harness();

    const handle = await startWorkerRuntime({
      role: 'worker',
      createApplication: () => Promise.resolve(application),
      verifyReadiness: () => Promise.resolve(),
      shutdownTimeoutMs: 10,
      ...h.options,
    });

    await handle.shutdown('SIGTERM');
    expect(h.exits).toEqual([1]);
    expect(h.errors.join(' ')).toMatch(/did not shut down within 10ms/);
  });

  it('refuses to start a process whose role does not run workers', async () => {
    const h = harness();
    await expect(
      startWorkerRuntime({
        role: 'api',
        createApplication: () => Promise.resolve(fakeApplication().application),
        verifyReadiness: () => Promise.resolve(),
        ...h.options,
      }),
    ).rejects.toThrow(/asked to start a "api" process/);
  });

  it('adds no financial authority of its own', () => {
    // The role decides whether drivers start. The database leases, fencing and financial authority
    // established in Groups 14 and 3 remain the only authority over what a tick may do.
    for (const file of ['src/production/worker-runtime.ts', 'src/production/process-role.ts']) {
      // Comments are stripped first: the module *describes* leader election in order to say it does
      // not add one, and a check that cannot tell prose from code is a check that fails on honesty.
      const source = readFileSync(join(__dirname, '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/from '\.\.\/ledger/);
      expect(source).not.toMatch(/from '\.\.\/banking/);
      expect(source).not.toMatch(/from '\.\.\/agent/);
      expect(source).not.toMatch(/leader|election/i);
      expect(source).not.toMatch(/DataSource|Repository/);
    }
  });

  it('routes the worker role before any HTTP adapter exists', () => {
    // A worker process must not be able to reach a listener, even by a future edit to the HTTP path.
    const main = readFileSync(join(__dirname, '..', 'src/main.ts'), 'utf8');
    const roleIndex = main.indexOf('resolveProcessRole(process.env.PROCESS_ROLE)');
    const adapterIndex = main.indexOf('new FastifyAdapter(');
    expect(roleIndex).toBeGreaterThan(-1);
    expect(adapterIndex).toBeGreaterThan(roleIndex);
    expect(main).toContain("if (role === 'worker')");
    expect(main).toContain('await bootstrapWorker();');
    // …and the worker bootstrap itself never creates an HTTP application.
    const workerBootstrap = main.slice(
      main.indexOf('async function bootstrapWorker'),
      main.indexOf('async function bootstrap('),
    );
    expect(workerBootstrap).toContain('createApplicationContext');
    expect(workerBootstrap).not.toMatch(/NestFastifyApplication|FastifyAdapter|app\.listen/);
  });
});
