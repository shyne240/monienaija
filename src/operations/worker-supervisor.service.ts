/**
 * ARENA 3D Group 15 — the registry of workers this application actually runs.
 *
 * See `worker-scheduler.service.ts` for why supervision exists and what it cannot see. This file contains
 * only the wiring: which workers exist, and how each is configured.
 *
 * ## No new environment variables
 *
 * Every worker already reads its own `*_WORKER_ENABLED` / `*_WORKER_POLL_INTERVAL_MS` /
 * `*_WORKER_BATCH_SIZE` keys. The registry reads **the same keys through the same `ConfigService`**, so
 * there is exactly one source of truth per worker. A second set of supervisor-specific keys would let the
 * registry and the worker disagree about whether that worker is running — and the registry's answer would
 * look authoritative while being wrong.
 *
 * ## Why not every worker in the codebase
 *
 * These four are the always-on background pollers. Work that is driven by a request, a transaction commit,
 * or an explicit operator action is not a background worker and is not listed here. Listing it would
 * imply a polling schedule that does not exist.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WorkerScheduler, type SupervisorReport } from './worker-scheduler.service';

/** Stable identifiers. Changing these changes the contract with dashboards and alerts. */
export const SUPERVISED_WORKERS = {
  AGENT_CASH_TO_CASH_EXPIRY: 'agent-cash-to-cash-expiry',
  KYC_TIER_REEVALUATION: 'kyc-tier-reevaluation',
  BANKING_DISPATCH: 'banking-dispatch',
  NOTIFICATION_DELIVERY: 'notification-delivery',
} as const;

export type SupervisedWorkerName = (typeof SUPERVISED_WORKERS)[keyof typeof SUPERVISED_WORKERS];

/**
 * Defaults mirror the workers' own defaults exactly.
 *
 * They are duplicated rather than imported because importing `process.env` defaults from four services
 * would couple this registry to their internals. The duplication is guarded by a test that asserts these
 * values match each worker's documented default — so a drift becomes a failing test rather than a
 * silently wrong dashboard.
 */
export const SUPERVISED_WORKER_DEFAULTS: Readonly<
  Record<
    SupervisedWorkerName,
    { enabledKey: string; intervalKey: string; defaultIntervalMs: number }
  >
> = {
  [SUPERVISED_WORKERS.AGENT_CASH_TO_CASH_EXPIRY]: {
    enabledKey: 'CASH_TO_CASH_EXPIRY_WORKER_ENABLED',
    intervalKey: 'CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS',
    defaultIntervalMs: 60_000,
  },
  [SUPERVISED_WORKERS.KYC_TIER_REEVALUATION]: {
    enabledKey: 'KYC_TIER_WORKER_ENABLED',
    intervalKey: 'KYC_TIER_WORKER_POLL_INTERVAL_MS',
    defaultIntervalMs: 30_000,
  },
  [SUPERVISED_WORKERS.BANKING_DISPATCH]: {
    // Note the key name: banking's poll interval is `BANKING_DISPATCH_POLL_INTERVAL_MS`, *not*
    // `..._WORKER_POLL_INTERVAL_MS` like the other three. Getting this wrong would make the registry
    // report a default while the worker ran on a configured value.
    enabledKey: 'BANKING_DISPATCH_WORKER_ENABLED',
    intervalKey: 'BANKING_DISPATCH_POLL_INTERVAL_MS',
    defaultIntervalMs: 5_000,
  },
  [SUPERVISED_WORKERS.NOTIFICATION_DELIVERY]: {
    enabledKey: 'NOTIFICATION_WORKER_ENABLED',
    intervalKey: 'NOTIFICATION_WORKER_POLL_INTERVAL_MS',
    defaultIntervalMs: 5_000,
  },
};

@Injectable()
export class WorkerSupervisorService {
  readonly scheduler: WorkerScheduler;

  constructor(private readonly config: ConfigService) {
    this.scheduler = new WorkerScheduler();
    for (const name of Object.values(SUPERVISED_WORKERS)) {
      const defaults = SUPERVISED_WORKER_DEFAULTS[name];
      const enabled = this.resolveEnabled(name);
      const pollIntervalMs =
        this.config.get<number>(defaults.intervalKey) ?? defaults.defaultIntervalMs;
      this.scheduler.register({ name, enabled, scheduled: enabled, pollIntervalMs });
    }
  }

  /**
   * Effective enablement, resolving each worker's *actual* rule rather than a generic one.
   *
   * Banking dispatch is the exception: its module factory enables it when
   * `BANKING_DISPATCH_WORKER_ENABLED` is unset **and** `BANKING_ENABLED` is on outside tests. Reading only
   * the first key would report banking as disabled on a correctly-configured instance, or worse, the
   * reverse. Every other worker is a plain `=== true` on its own key, which the schema parses as a boolean,
   * so an unparseable value reads as "off" here exactly as it does in the worker.
   */
  private resolveEnabled(name: SupervisedWorkerName): boolean {
    if (name === SUPERVISED_WORKERS.BANKING_DISPATCH) {
      const explicit = this.config.get<boolean>('BANKING_DISPATCH_WORKER_ENABLED');
      if (explicit !== undefined) return explicit === true;
      const bankingEnabled = this.config.get<boolean>('BANKING_ENABLED') === true;
      return bankingEnabled && process.env.NODE_ENV !== 'test';
    }
    return this.config.get<boolean>(SUPERVISED_WORKER_DEFAULTS[name].enabledKey) === true;
  }

  /**
   * Observations across all supervised workers.
   *
   * Process-local. See the `scope` field in the payload and the module comment: this is not a fleet-wide
   * liveness signal, and the continuation record states that plainly.
   */
  report(): SupervisorReport {
    return this.scheduler.report();
  }
}
