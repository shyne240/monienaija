import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import type { DiagnosticsReport } from './operations.types';

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  async getDiagnostics(): Promise<DiagnosticsReport> {
    const database = await this.checkDatabase();
    const migrations = await this.checkMigrations();
    const pendingOutbox = await this.pendingOutboxCount();
    let reconciliation: DiagnosticsReport['reconciliation'] = { status: 'ERROR' };
    try {
      const report = await this.reconciliationService.runReconciliation();
      reconciliation = { status: report.status };
    } catch {
      reconciliation = { status: 'ERROR' };
    }

    const status =
      database.status === 'ok' &&
      migrations.status === 'ok' &&
      reconciliation.status !== 'ERROR' &&
      pendingOutbox >= 0
        ? 'ok'
        : 'degraded';
    return {
      status,
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      database,
      migrations,
      reconciliation,
      pendingOutbox,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<DiagnosticsReport['database']> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  }

  private async checkMigrations(): Promise<DiagnosticsReport['migrations']> {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS applied_count FROM typeorm_migrations`,
      );
      const rows = isUnknownArray(result) ? result : [];
      const first = rows[0];
      const record = first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
      const appliedCount = Number(record.applied_count ?? 0);
      return { status: 'ok', appliedCount };
    } catch {
      return { status: 'error', appliedCount: 0 };
    }
  }

  private async pendingOutboxCount(): Promise<number> {
    try {
      const result: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS pending_count
           FROM outbox_events
          WHERE status IN ('PENDING', 'FAILED')`,
      );
      const rows = isUnknownArray(result) ? result : [];
      const first = rows[0];
      const record = first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
      return Number(record.pending_count ?? 0);
    } catch {
      return -1;
    }
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
