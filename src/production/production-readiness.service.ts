import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';

const EXPECTED_MIGRATION_TIMESTAMP = '1785753600006';
const EXPECTED_MIGRATION_NAME = 'CreateProductionMaturityMetadata1785753600006';

type Row = Record<string, unknown>;

@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  async verifyStartup(): Promise<void> {
    const readiness = await this.getReadiness();
    if (readiness.status !== 'ok') {
      throw new Error(`Production readiness failed: ${readiness.reason}`);
    }
  }

  async getReadiness() {
    const database = await this.checkDatabase();
    const migrations =
      database.status === 'ok'
        ? await this.checkMigrations()
        : {
            status: 'error' as const,
            compatible: false,
            appliedCount: 0,
            latestTimestamp: null,
            latestName: null,
          };
    let reconciliation: 'PASS' | 'WARNING' | 'ERROR' = 'ERROR';
    if (migrations.compatible) {
      try {
        reconciliation = (await this.reconciliationService.runReconciliation()).status;
      } catch {
        reconciliation = 'ERROR';
      }
    }
    const pendingOutbox = await this.pendingOutboxCount();
    const status =
      database.status === 'ok' &&
      migrations.compatible &&
      reconciliation !== 'ERROR' &&
      pendingOutbox >= 0
        ? 'ok'
        : 'error';
    const reason =
      status === 'ok'
        ? null
        : database.status !== 'ok'
          ? 'database_unavailable'
          : !migrations.compatible
            ? 'schema_incompatible'
            : reconciliation === 'ERROR'
              ? 'reconciliation_not_ready'
              : 'outbox_unavailable';
    return {
      status,
      reason,
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      apiVersion: process.env.API_VERSION ?? 'v1',
      database,
      migrations,
      reconciliation: { status: reconciliation },
      pendingOutbox,
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error' }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  }

  private async checkMigrations() {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT timestamp::text AS timestamp, name
           FROM typeorm_migrations
          ORDER BY timestamp DESC
          LIMIT 1`,
      );
      const latest = rowsOf(result)[0] ?? {};
      const latestTimestamp = stringValue(latest.timestamp);
      const latestName = stringValue(latest.name);
      const compatible =
        latestTimestamp === EXPECTED_MIGRATION_TIMESTAMP && latestName === EXPECTED_MIGRATION_NAME;
      const countResult: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS applied_count FROM typeorm_migrations`,
      );
      const countRow = rowsOf(countResult)[0] ?? {};
      return {
        status: compatible ? ('ok' as const) : ('error' as const),
        compatible,
        appliedCount: Number(countRow.applied_count ?? 0),
        latestTimestamp: latestTimestamp || null,
        latestName: latestName || null,
      };
    } catch {
      return {
        status: 'error' as const,
        compatible: false,
        appliedCount: 0,
        latestTimestamp: null,
        latestName: null,
      };
    }
  }

  private async pendingOutboxCount(): Promise<number> {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS pending_count
           FROM outbox_events
          WHERE status IN ('PENDING', 'FAILED')`,
      );
      const row = rowsOf(result)[0] ?? {};
      return Number(row.pending_count ?? 0);
    } catch {
      return -1;
    }
  }
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
