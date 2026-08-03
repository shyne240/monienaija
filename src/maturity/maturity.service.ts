import { Injectable } from '@nestjs/common';

import { AuditService } from '../operations/audit.service';
import { DiagnosticsService } from '../operations/diagnostics.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxEventStatus } from '../operations/operations.enums';
import { VerificationStatus } from '../reconciliation/reconciliation.types';
import { OutboxService } from '../operations/outbox.service';
import { ApiVersionService } from '../production/api-version.service';
import { ProductionReadinessService } from '../production/production-readiness.service';
import { GovernanceService } from './governance.service';
import { OperationalReportService } from './operational-report.service';
import { RetentionService } from './retention.service';
import type {
  AcceptanceReport,
  OperationalHealthDashboard,
  RetentionReport,
} from './maturity.types';

@Injectable()
export class MaturityService {
  constructor(
    private readonly readinessService: ProductionReadinessService,
    private readonly diagnosticsService: DiagnosticsService,
    private readonly metricsService: MetricsService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly governanceService: GovernanceService,
    private readonly reports: OperationalReportService,
    private readonly retentionService: RetentionService,
    private readonly apiVersionService: ApiVersionService,
  ) {}

  async healthDashboard(): Promise<OperationalHealthDashboard> {
    const [readiness, diagnostics, metrics, governance, audit, outbox, reconciliation] =
      await Promise.all([
        this.readinessService.getReadiness(),
        this.diagnosticsService.getDiagnostics(),
        this.metricsService.getMetrics(),
        this.governanceService.latest(),
        this.auditService.list({ limit: 1 }),
        this.outboxService.list({ limit: 1000 }),
        this.reports.reconciliationSummary(),
      ]);
    const reconciliationStatus = reconciliation.status;
    const systemStatus =
      readiness.status === 'error' || diagnostics.status === 'degraded'
        ? 'FAIL'
        : reconciliationStatus === VerificationStatus.WARNING ||
            outbox.some((event) => event.status === OutboxEventStatus.FAILED)
          ? 'WARNING'
          : 'PASS';
    return {
      systemStatus,
      database: readiness.database,
      migrations: readiness.migrations,
      ledger: { status: reconciliationStatus },
      reconciliation: { status: reconciliationStatus },
      outbox: {
        status: outbox.some((event) => event.status === OutboxEventStatus.FAILED)
          ? 'WARNING'
          : 'PASS',
        pending: readiness.pendingOutbox,
      },
      audit: { status: 'PASS', eventCount: audit.length },
      metrics: metrics.metrics,
      applicationVersion: readiness.version,
      apiVersion: this.apiVersionService.getVersionMetadata().current,
      governance,
      generatedAt: new Date().toISOString(),
    };
  }

  async acceptance(): Promise<AcceptanceReport> {
    const [readiness, diagnostics, reconciliation, outbox] = await Promise.all([
      this.readinessService.getReadiness(),
      this.diagnosticsService.getDiagnostics(),
      this.reports.reconciliationSummary(),
      this.outboxService.list({ limit: 1000 }),
    ]);
    const checks: AcceptanceReport['checks'] = [
      {
        name: 'database',
        status: readiness.database.status === 'ok' ? 'PASS' : 'FAIL',
        message:
          readiness.database.status === 'ok' ? 'Database is healthy' : 'Database is unavailable',
      },
      {
        name: 'migration',
        status: readiness.migrations.compatible ? 'PASS' : 'FAIL',
        message: readiness.migrations.compatible
          ? 'Migration head is compatible'
          : 'Migration head is incompatible',
      },
      {
        name: 'reconciliation',
        status:
          reconciliation.status === VerificationStatus.ERROR
            ? 'FAIL'
            : reconciliation.status === VerificationStatus.WARNING
              ? 'WARNING'
              : 'PASS',
        message: `Reconciliation status is ${reconciliation.status}`,
      },
      {
        name: 'operational_dependencies',
        status: diagnostics.status === 'degraded' ? 'FAIL' : 'PASS',
        message:
          diagnostics.status === 'degraded'
            ? 'Operational dependency is degraded'
            : 'Operational dependencies are healthy',
      },
      {
        name: 'outbox',
        status: outbox.some((event) => event.status === OutboxEventStatus.FAILED)
          ? 'WARNING'
          : 'PASS',
        message: outbox.some((event) => event.status === OutboxEventStatus.FAILED)
          ? 'Failed outbox events require review'
          : 'No failed outbox events reported',
      },
      {
        name: 'application_version',
        status: readiness.version ? 'PASS' : 'FAIL',
        message: readiness.version
          ? 'Application version is available'
          : 'Application version is missing',
      },
    ];
    const status = checks.some((check) => check.status === 'FAIL')
      ? 'FAIL'
      : checks.some((check) => check.status === 'WARNING')
        ? 'WARNING'
        : 'PASS';
    return {
      status,
      checks,
      applicationVersion: readiness.version,
      apiVersion: this.apiVersionService.getVersionMetadata().current,
      generatedAt: new Date().toISOString(),
    };
  }

  previewRetention(): Promise<RetentionReport> {
    return this.retentionService.preview();
  }

  executeRetention(): Promise<RetentionReport> {
    return this.retentionService.execute();
  }
}
