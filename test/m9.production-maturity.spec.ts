import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { ApiVersionService } from '../src/production/api-version.service';
import type { ProductionReadinessService } from '../src/production/production-readiness.service';
import type { DiagnosticsService } from '../src/operations/diagnostics.service';
import type { AuditService } from '../src/operations/audit.service';
import type { MetricsService } from '../src/operations/metrics.service';
import type { OutboxService } from '../src/operations/outbox.service';
import type { GovernanceMetadata } from '../src/maturity/governance-metadata.entity';
import { GovernanceService } from '../src/maturity/governance.service';
import { MaturityService } from '../src/maturity/maturity.service';
import { OperationalReportService } from '../src/maturity/operational-report.service';
import { RetentionService } from '../src/maturity/retention.service';

class RetentionDataSource {
  query(): Promise<unknown[]> {
    return Promise.resolve([{ count: '2' }]);
  }

  transaction<T>(
    isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
    if (!callback) {
      throw new Error('Missing transaction callback');
    }
    const manager = {
      query: () => Promise.resolve({ rowCount: 2 }),
    };
    return callback(manager as unknown as EntityManager);
  }
}

class GovernanceRepository {
  readonly records: GovernanceMetadata[] = [];

  create(input: Partial<GovernanceMetadata>): GovernanceMetadata {
    return input as GovernanceMetadata;
  }

  save(metadata: GovernanceMetadata): Promise<GovernanceMetadata> {
    metadata.createdAt = metadata.startupTimestamp;
    this.records.push(metadata);
    return Promise.resolve(metadata);
  }

  findOne(): Promise<GovernanceMetadata | null> {
    return Promise.resolve(this.records[0] ?? null);
  }
}

class GovernanceManager {
  constructor(private readonly repository: GovernanceRepository) {}

  getRepository(): Repository<GovernanceMetadata> {
    return this.repository as unknown as Repository<GovernanceMetadata>;
  }
}

describe('M9 production maturity', () => {
  it('previews and executes retention cleanup without a scheduler', async () => {
    const config = {
      get: (key: string) =>
        ({
          METRICS_RETENTION_SECONDS: 100,
          AUDIT_RETENTION_SECONDS: 200,
          IDEMPOTENCY_RETENTION_SECONDS: 300,
          OUTBOX_RETENTION_SECONDS: 400,
        })[key],
    };
    const service = new RetentionService(
      new RetentionDataSource() as unknown as DataSource,
      config as never,
    );

    const preview = await service.preview(new Date('2026-08-03T00:00:00.000Z'));
    expect(preview.dryRun).toBe(true);
    expect(preview.counts.every((count) => count.candidates === 2)).toBe(true);

    const execution = await service.execute(new Date('2026-08-03T00:00:00.000Z'));
    expect(execution.dryRun).toBe(false);
    expect(execution.counts).toHaveLength(4);
  });

  it('records immutable governance metadata with a configuration fingerprint', async () => {
    const repository = new GovernanceRepository();
    const config = {
      getSafeConfiguration: () => ({
        environment: 'staging',
        version: '1.0.0',
        apiVersion: 'v1',
        port: 3000,
      }),
    };
    const readiness = {
      getReadiness: () =>
        Promise.resolve({
          status: 'ok' as const,
          migrations: { latestTimestamp: '1785753600006', latestName: 'M9' },
        }),
    };
    const dataSource = {
      transaction: <T>(callback: (manager: EntityManager) => Promise<T>) =>
        callback(new GovernanceManager(repository) as unknown as EntityManager),
    };
    const service = new GovernanceService(
      repository as unknown as Repository<GovernanceMetadata>,
      dataSource as unknown as DataSource,
      config as never,
      readiness as unknown as ProductionReadinessService,
    );

    const metadata = await service.recordStartup();

    expect(metadata.applicationVersion).toBe('1.0.0');
    expect(metadata.migrationHead).toBe('1785753600006:M9');
    expect(metadata.configurationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.records).toHaveLength(1);
  });

  it('returns warning acceptance when only operational warnings remain', async () => {
    const readiness = {
      getReadiness: () =>
        Promise.resolve({
          status: 'ok' as const,
          database: { status: 'ok' },
          migrations: { compatible: true, status: 'ok', latestName: 'M9' },
          reconciliation: { status: 'WARNING' as const },
          pendingOutbox: 1,
          version: '1.0.0',
        }),
    };
    const diagnostics = { getDiagnostics: () => Promise.resolve({ status: 'ok' as const }) };
    const reports = {
      reconciliationSummary: () => Promise.resolve({ status: 'WARNING' as const }),
    };
    const outbox = { list: () => Promise.resolve([{ status: 'PENDING' }]) };
    const apiVersion = { getVersionMetadata: () => ({ current: 'v1' }) };
    const maturity = new MaturityService(
      readiness as unknown as ProductionReadinessService,
      diagnostics as unknown as DiagnosticsService,
      {} as MetricsService,
      {} as AuditService,
      outbox as unknown as OutboxService,
      {} as GovernanceService,
      reports as unknown as OperationalReportService,
      {} as RetentionService,
      apiVersion as unknown as ApiVersionService,
    );

    const report = await maturity.acceptance();
    expect(report.status).toBe('WARNING');
    expect(report.checks.find((check) => check.name === 'reconciliation')?.status).toBe('WARNING');
  });

  it('generates daily operational summaries from internal reports', async () => {
    const dataSource = {
      query: () => Promise.resolve([{ count: '3' }]),
    };
    const reports = new OperationalReportService(
      dataSource as unknown as DataSource,
      { runReconciliation: () => Promise.resolve({ status: 'PASS' as const }) } as never,
    );

    const summary = await reports.dailySummary();
    expect(summary.journals).toBe(3);
    expect(summary.transfers).toBe(3);
    expect(summary.outboxEvents).toBe(3);
  });
});
