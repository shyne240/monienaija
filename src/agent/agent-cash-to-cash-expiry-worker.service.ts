import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentCashToCashExpiryService } from './agent-cash-to-cash-expiry.service';

export interface ExpiryTickResult {
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'DISABLED';
  expiredCount: number;
}

/** One bounded batch per poll. PostgreSQL transfer locks, not an in-memory lease,
 * are the cross-process correctness boundary. Failed work remains due for the next poll. */
@Injectable()
export class AgentCashToCashExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentCashToCashExpiryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<ExpiryTickResult> | null = null;
  private stopping = false;

  constructor(
    private readonly expiry: AgentCashToCashExpiryService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.stopping = false;
    if (this.config.get<boolean>('CASH_TO_CASH_EXPIRY_WORKER_ENABLED') !== true) {
      this.logger.log({ event: 'c2c_expiry_worker_disabled' });
      return;
    }
    const intervalMs = this.config.get<number>('CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS') ?? 60_000;
    this.logger.log({ event: 'c2c_expiry_worker_started', intervalMs });
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref();
    void this.tick(); // Catch up persisted due work immediately on startup/restart.
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.active; // Finish/rollback before Nest destroys database providers.
    this.logger.log({ event: 'c2c_expiry_worker_stopped' });
  }

  tick(): Promise<ExpiryTickResult> {
    if (this.stopping || this.config.get<boolean>('CASH_TO_CASH_EXPIRY_WORKER_ENABLED') !== true) {
      return Promise.resolve({ status: 'DISABLED', expiredCount: 0 });
    }
    if (this.active) return Promise.resolve({ status: 'SKIPPED', expiredCount: 0 });
    this.active = this.run().finally(() => { this.active = null; });
    return this.active;
  }

  private async run(): Promise<ExpiryTickResult> {
    const correlationId = randomUUID();
    const started = Date.now();
    const limit = this.config.get<number>('CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE') ?? 100;
    this.logger.log({ event: 'c2c_expiry_tick_started', correlationId, limit });
    try {
      const result = await this.expiry.expireDueTransfers({
        limit,
        statementTimeoutMs: this.config.get<number>('CASH_TO_CASH_EXPIRY_WORKER_STATEMENT_TIMEOUT_MS') ?? 10_000,
        correlationId,
        actor: 'system-c2c-expiry-worker',
      });
      this.logger.log({
        event: 'c2c_expiry_tick_completed', correlationId,
        expiredCount: result.expiredCount, limit, batchFull: result.expiredCount === limit,
        durationMs: Date.now() - started,
      });
      return { status: 'COMPLETED', expiredCount: result.expiredCount };
    } catch (error: unknown) {
      // Allow only a bounded SQLSTATE, never arbitrary driver text or parameters.
      const candidate = error as { code?: unknown; driverError?: { code?: unknown } } | null;
      const code = candidate?.driverError?.code ?? candidate?.code;
      const errorCode = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'EXPIRY_SWEEP_FAILED';
      this.logger.error({ event: 'c2c_expiry_tick_failed', correlationId, errorCode, durationMs: Date.now() - started });
      return { status: 'FAILED', expiredCount: 0 };
    }
  }
}
