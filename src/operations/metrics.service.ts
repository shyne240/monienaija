import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { MetricsView } from './operations.types';

@Injectable()
export class MetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async increment(
    manager: EntityManager | undefined,
    metricName: string,
    amount = 1,
  ): Promise<void> {
    if (!/^[a-z][a-z0-9_.-]{1,119}$/.test(metricName) || !Number.isSafeInteger(amount)) {
      return;
    }
    try {
      const executor = manager ?? this.dataSource;
      await executor.query(
        `INSERT INTO operational_metrics (metric_name, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (metric_name)
         DO UPDATE SET value = operational_metrics.value + EXCLUDED.value, updated_at = NOW()`,
        [metricName, amount],
      );
    } catch {
      // Observability must not make a financial transaction fail.
    }
  }

  async observeDuration(metricName: string, startedAt: number): Promise<void> {
    await this.increment(
      undefined,
      metricName,
      Math.max(0, Math.round(performance.now() - startedAt)),
    );
  }

  async getMetrics(): Promise<MetricsView> {
    const result: unknown = await this.dataSource.query(
      `SELECT metric_name, value::text AS value FROM operational_metrics ORDER BY metric_name`,
    );
    const rows = isUnknownArray(result) ? result : [];
    const metrics: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const record = row as Record<string, unknown>;
      const metricName = record.metric_name;
      if (typeof metricName !== 'string') {
        continue;
      }
      const value = typeof record.value === 'string' ? record.value : '0';
      metrics[metricName] = value;
    }
    return { generatedAt: new Date().toISOString(), metrics };
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
