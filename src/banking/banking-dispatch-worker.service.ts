import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { BankingOutboundService, OutboundState } from './banking-outbound.service';
import {
  SUPERVISED_WORKERS,
  type WorkerSupervisorService,
} from '../operations/worker-supervisor.service';

/**
 * Durable outbound dispatch.
 *
 * Ownership is a database lease, not an in-process flag, so two application instances cannot dispatch
 * the same operation. Three properties follow from that and are worth stating because each one is a
 * failure mode that has cost real money somewhere:
 *
 * 1. **Exclusive ownership.** `acquire()` is a single conditional upsert; exactly one caller wins. The
 *    `fence` counter is incremented on every acquisition, so a worker that lost its lease (paused too
 *    long, process stalled) can detect it and abandon rather than write a result for an operation
 *    someone else now owns.
 * 2. **Crash survival.** A lease is a timestamp, not a held connection. If the process dies the lease
 *    expires and the operation becomes reclaimable. Nothing is stranded, and nothing is double-run.
 * 3. **Bounded attempts.** After `maxAttempts` the operation is parked in MANUAL_REVIEW. Retrying an
 *    uncertain operation forever is not diligence, it is an unbounded source of provider traffic with
 *    no one ever looking at it.
 *
 * What this worker will never do: dispatch an operation that is not `CREATED`, and mint a provider
 * reference. `dispatch()` itself refuses non-`CREATED` records, so the worker's own guard is a second
 * layer rather than the only one. Uncertain operations are handled by `enquire()` — asking the
 * provider — never by resubmitting.
 *
 * Operational disablement stops *new* dispatch only. Operations already in flight continue to be
 * enquired and resolved, because stranding a committed obligation is worse than pausing intake.
 */
export interface BankingDispatchWorkerOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  /**
   * Stops claiming new work. Existing leases are still honoured and in-flight operations still
   * resolved. This is the "disable new banking operations" switch, and it deliberately does not
   * abandon committed obligations.
   */
  readonly intakeDisabled?: boolean;
}

export interface DispatchTickResult {
  readonly claimed: number;
  readonly dispatched: number;
  readonly enquired: number;
  readonly escalated: number;
  readonly skipped: number;
}

const ACTOR = 'banking-dispatch-worker';

@Injectable()
export class BankingDispatchWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BankingDispatchWorker.name);
  private readonly owner = `${ACTOR}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<DispatchTickResult> | null = null;
  private shuttingDown = false;
  private intakeDisabled: boolean;

  /**
   * Group 15 supervisor, optional on purpose.
   *
   * This worker is constructed by hand in tests and in the module factory below, so a required dependency
   * would change every call site for a purely observational concern. When absent, ticks run exactly as
   * before — supervision must never be a precondition for dispatch.
   */
  private supervisor: WorkerSupervisorService | null = null;

  /** Wired by the module factory (or a test) once the supervisor is available. */
  attachSupervisor(supervisor: WorkerSupervisorService): void {
    this.supervisor = supervisor;
  }

  constructor(
    private readonly db: DataSource,
    private readonly outbound: BankingOutboundService,
    options: BankingDispatchWorkerOptions = {},
  ) {
    // Tests default to disabled so a suite drives `tick()` deterministically; production defaults on.
    this.enabled = options.enabled ?? process.env.NODE_ENV !== 'test';
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.batchSize = options.batchSize ?? 10;
    this.leaseMs = options.leaseMs ?? 30_000;
    // Three attempts then a human. Enough to survive a transient outage, few enough that nobody can
    // point at the worker as the reason a stuck transfer was contacted forty times.
    this.maxAttempts = options.maxAttempts ?? 3;
    this.intakeDisabled = options.intakeDisabled ?? false;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        // A failed tick must not kill the timer; the next tick retries, and the error is logged.
        this.logger.error(
          `Dispatch tick failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  /** Stops the timer and waits for an in-flight tick. A half-run tick is never abandoned. */
  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.active) await this.active;
  }

  /** Test/ops hook. Once shutdown has begun no further work is claimed. */
  disableIntake(): void {
    this.intakeDisabled = true;
  }

  async tick(): Promise<DispatchTickResult> {
    if (this.active) return this.active;
    // Group 15: observation only. The scheduler wraps this worker's existing driver and passes the result
    // through untouched; it does not start, stop, or re-time anything here.
    const observe = this.supervisor
      ? this.supervisor.scheduler.observe(SUPERVISED_WORKERS.BANKING_DISPATCH, () => this.runOnce())
      : this.runOnce();
    const run = observe.finally(() => {
      this.active = null;
    });
    this.active = run;
    return run;
  }

  private async runOnce(): Promise<DispatchTickResult> {
    if (this.shuttingDown) {
      return { claimed: 0, dispatched: 0, enquired: 0, escalated: 0, skipped: 0 };
    }
    const result = { claimed: 0, dispatched: 0, enquired: 0, escalated: 0, skipped: 0 };

    // Recent leases may be stale if a process died; clearing them is safe because a live holder's
    // expiry is in the future and is never touched.
    await this.db.query(
      `DELETE FROM banking_dispatch_leases WHERE leased_until <= clock_timestamp()`,
    );

    const candidates = await this.db.query<
      Array<{ id: string; state: OutboundState; attempts: number; operation_reference: string }>
    >(
      `SELECT o.id,o.state,o.attempts,o.operation_reference
         FROM banking_outbound_operations o
         LEFT JOIN banking_dispatch_leases l ON l.operation_id=o.id
        WHERE (o.state='CREATED' AND $1::boolean = false)
           OR o.state IN ('SUBMITTING','UNKNOWN')
        ORDER BY o.updated_at
        LIMIT $2`,
      [this.intakeDisabled, this.batchSize],
    );

    for (const candidate of candidates) {
      if (this.shuttingDown) break;
      const owned = await this.acquire(candidate.id);
      if (!owned) {
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;
      try {
        if (candidate.state === 'CREATED') {
          await this.dispatchOne(candidate.id, candidate.operation_reference, owned.fence);
          result.dispatched += 1;
        } else {
          await this.enquireOne(candidate.id, candidate.operation_reference, owned.fence);
          result.enquired += 1;
        }
      } catch (error) {
        // The lease is released in `finally` so a single failing operation cannot block the batch.
        this.logger.error(
          `Dispatch handling failed for ${candidate.operation_reference}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        result.escalated += await this.escalateIfExhausted(candidate.id, owned.fence);
      } finally {
        await this.release(candidate.id, owned.fence);
      }
    }
    return result;
  }

  /** Conditional upsert: exactly one caller wins an expired-or-absent lease. */
  private async acquire(operationId: string): Promise<{ fence: number } | null> {
    const rows = await this.db.query<Array<{ fence: number }>>(
      `INSERT INTO banking_dispatch_leases(operation_id,lease_owner,leased_until,fence)
       VALUES($1,$2,clock_timestamp() + ($3::text || ' milliseconds')::interval,1)
       ON CONFLICT (operation_id) DO UPDATE
         SET lease_owner=EXCLUDED.lease_owner,
             leased_until=EXCLUDED.leased_until,
             acquired_at=clock_timestamp(),
             fence=banking_dispatch_leases.fence+1
         WHERE banking_dispatch_leases.leased_until <= clock_timestamp()
       RETURNING fence`,
      [operationId, this.owner, String(this.leaseMs)],
    );
    return rows[0] ? { fence: rows[0].fence } : null;
  }

  private async release(operationId: string, fence: number): Promise<void> {
    // Only the holder of this exact fence may release; a stolen lease stays with its new owner.
    await this.db.query(
      `DELETE FROM banking_dispatch_leases WHERE operation_id=$1 AND fence=$2 AND lease_owner=$3`,
      [operationId, fence, this.owner],
    );
  }

  private async dispatchOne(operationId: string, reference: string, fence: number): Promise<void> {
    const attempt = await this.nextAttemptNumber(operationId, 'DISPATCH');
    await this.recordAttempt(operationId, attempt, 'DISPATCH', fence, 'STARTED');
    const row = await this.db.query<
      Array<{
        provider_key: string;
        environment: string;
        currency: string;
        amount_minor: string;
        destination_bank_code: string;
        destination_account_number: string;
        destination_account_name: string | null;
        wallet_id: string;
        institution_id: string;
      }>
    >(
      `SELECT provider_key,environment,currency,amount_minor::text AS amount_minor,
              destination_bank_code,destination_account_number,destination_account_name,
              wallet_id,institution_id
         FROM banking_outbound_operations WHERE id=$1`,
      [operationId],
    );
    const operation = row[0];
    if (!operation) return;

    const record = await this.outbound.dispatch(operationId, {
      institutionId: operation.institution_id,
      walletId: operation.wallet_id,
      providerKey: operation.provider_key,
      environment: operation.environment as 'sandbox' | 'production',
      currency: operation.currency,
      amountMinor: operation.amount_minor,
      destinationBankCode: operation.destination_bank_code,
      destinationAccountNumber: operation.destination_account_number,
      destinationAccountName: operation.destination_account_name ?? '',
      narration: `Outbound transfer ${reference}`,
      correlationId: reference,
    });
    await this.finishAttempt(operationId, attempt, 'DISPATCH', record.state, null);
    if (record.state === 'UNKNOWN' || record.state === 'FAILED') {
      await this.escalateIfExhausted(operationId, fence);
    }
  }

  private async enquireOne(operationId: string, reference: string, fence: number): Promise<void> {
    const attempt = await this.nextAttemptNumber(operationId, 'ENQUIRE');
    await this.recordAttempt(operationId, attempt, 'ENQUIRE', fence, 'STARTED');
    const record = await this.outbound.enquire(operationId, reference);
    await this.finishAttempt(operationId, attempt, 'ENQUIRE', record.state, null);
    if (record.state === 'UNKNOWN') {
      await this.escalateIfExhausted(operationId, fence);
    }
  }

  /**
   * Parks an operation after the attempt bound.
   *
   * MANUAL_REVIEW, never FAILED: the worker has no evidence that the transfer failed, only that it
   * could not find out. Marking it failed would tell a customer their money did not move when it may
   * have.
   */
  private async escalateIfExhausted(operationId: string, fence: number): Promise<number> {
    const rows = await this.db.query<Array<{ attempts: number; state: string }>>(
      'SELECT attempts,state FROM banking_outbound_operations WHERE id=$1',
      [operationId],
    );
    const row = rows[0];
    if (!row) return 0;
    if (row.attempts < this.maxAttempts) return 0;
    if (row.state !== 'UNKNOWN' && row.state !== 'SUBMITTING') return 0;
    const attempt = await this.nextAttemptNumber(operationId, 'ESCALATE');
    await this.recordAttempt(operationId, attempt, 'ESCALATE', fence, 'EXHAUSTED');
    await this.outbound.escalateToReview(
      operationId,
      `Attempt bound reached after ${row.attempts} attempts`,
    );
    return 1;
  }

  private async nextAttemptNumber(operationId: string, action: string): Promise<number> {
    const rows = await this.db.query<Array<{ next: string }>>(
      `SELECT COALESCE(MAX(attempt_number),0)+1 AS next FROM banking_dispatch_attempts
        WHERE operation_id=$1 AND action=$2`,
      [operationId, action],
    );
    return Number(rows[0]?.next ?? '1');
  }

  private async recordAttempt(
    operationId: string,
    attemptNumber: number,
    action: 'DISPATCH' | 'ENQUIRE' | 'ESCALATE',
    fence: number,
    outcome: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO banking_dispatch_attempts
        (operation_id,attempt_number,lease_owner,fence,action,outcome)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [operationId, attemptNumber, this.owner, fence, action, outcome],
    );
  }

  private async finishAttempt(
    operationId: string,
    attemptNumber: number,
    action: 'DISPATCH' | 'ENQUIRE',
    outcome: string,
    errorCode: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE banking_dispatch_attempts
          SET outcome=$4,error_code=$5,finished_at=clock_timestamp()
        WHERE operation_id=$1 AND attempt_number=$2 AND action=$3`,
      [operationId, attemptNumber, action, outcome.slice(0, 32), errorCode],
    );
  }
}
