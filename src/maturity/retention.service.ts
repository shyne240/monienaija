import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import type { RetentionCount, RetentionPolicy, RetentionReport } from './maturity.types';

@Injectable()
export class RetentionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async preview(now = new Date()): Promise<RetentionReport> {
    return this.collectReport(true, now);
  }

  async execute(now = new Date()): Promise<RetentionReport> {
    const [metricsPolicy, auditPolicy, idempotencyPolicy, outboxPolicy] = this.policies(now);
    const policies = [metricsPolicy, auditPolicy, idempotencyPolicy, outboxPolicy];
    const counts: RetentionCount[] = [];
    await this.dataSource.transaction(async (manager) => {
      await manager.query("SET LOCAL app.audit_retention_delete = 'on'");
      counts.push({
        name: 'metrics',
        candidates: await this.deleteMetrics(manager, metricsPolicy),
      });
      counts.push({ name: 'audit', candidates: await this.deleteAudit(manager, auditPolicy) });
      counts.push({
        name: 'idempotency',
        candidates: await this.deleteIdempotency(manager, idempotencyPolicy),
      });
      counts.push({ name: 'outbox', candidates: await this.deleteOutbox(manager, outboxPolicy) });
    });
    return { dryRun: false, policies, counts, executedAt: new Date().toISOString() };
  }

  private async collectReport(dryRun: boolean, now: Date): Promise<RetentionReport> {
    const [metricsPolicy, auditPolicy, idempotencyPolicy, outboxPolicy] = this.policies(now);
    const policies = [metricsPolicy, auditPolicy, idempotencyPolicy, outboxPolicy];
    const counts = await Promise.all([
      this.count('operational_metrics', 'updated_at', metricsPolicy.cutoff),
      this.count('audit_events', 'created_at', auditPolicy.cutoff),
      this.count('idempotency_records', 'expires_at', idempotencyPolicy.cutoff),
      this.count(
        'outbox_events',
        'created_at',
        outboxPolicy.cutoff,
        "status IN ('PUBLISHED', 'FAILED')",
      ),
    ]);
    return {
      dryRun,
      policies,
      counts: policies.map((policy, index) => ({
        name: policy.name,
        candidates: counts[index] ?? 0,
      })),
      executedAt: new Date().toISOString(),
    };
  }

  private policies(
    now: Date,
  ): [RetentionPolicy, RetentionPolicy, RetentionPolicy, RetentionPolicy] {
    return [
      this.policy('metrics', 'METRICS_RETENTION_SECONDS', 2_592_000, now),
      this.policy('audit', 'AUDIT_RETENTION_SECONDS', 31_536_000, now),
      this.policy('idempotency', 'IDEMPOTENCY_RETENTION_SECONDS', 86_400, now),
      this.policy('outbox', 'OUTBOX_RETENTION_SECONDS', 2_592_000, now),
    ];
  }

  private policy(
    name: RetentionPolicy['name'],
    configKey: string,
    fallback: number,
    now: Date,
  ): RetentionPolicy {
    const retentionSeconds = this.configService.get<number>(configKey) ?? fallback;
    return {
      name,
      retentionSeconds,
      cutoff: new Date(now.getTime() - retentionSeconds * 1000).toISOString(),
    };
  }

  private async count(
    table: string,
    column: string,
    cutoff: string,
    condition = 'TRUE',
  ): Promise<number> {
    const result: unknown = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${column} < $1 AND ${condition}`,
      [cutoff],
    );
    const rows = isUnknownArray(result) ? result : [];
    const first = rows[0];
    const record = first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
    return Number(record.count ?? 0);
  }

  private async deleteMetrics(manager: EntityManager, policy: RetentionPolicy): Promise<number> {
    const result: unknown = await manager.query(
      `DELETE FROM operational_metrics WHERE updated_at < $1`,
      [policy.cutoff],
    );
    return this.affected(result);
  }

  private async deleteAudit(manager: EntityManager, policy: RetentionPolicy): Promise<number> {
    const result: unknown = await manager.query(`DELETE FROM audit_events WHERE created_at < $1`, [
      policy.cutoff,
    ]);
    return this.affected(result);
  }

  private async deleteIdempotency(
    manager: EntityManager,
    policy: RetentionPolicy,
  ): Promise<number> {
    const result: unknown = await manager.query(
      `DELETE FROM idempotency_records WHERE expires_at < $1`,
      [policy.cutoff],
    );
    return this.affected(result);
  }

  private async deleteOutbox(manager: EntityManager, policy: RetentionPolicy): Promise<number> {
    const result: unknown = await manager.query(
      `DELETE FROM outbox_events
        WHERE created_at < $1 AND status IN ('PUBLISHED', 'FAILED')`,
      [policy.cutoff],
    );
    return this.affected(result);
  }

  private affected(result: unknown): number {
    if (typeof result === 'object' && result !== null && 'rowCount' in result) {
      return Number(result.rowCount ?? 0);
    }
    return 0;
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
