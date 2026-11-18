import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { AuditEvent } from './audit-event.entity';
import { AuditService } from './audit.service';
import { DiagnosticsService } from './diagnostics.service';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyService } from './idempotency.service';
import { MetricsService } from './metrics.service';
import { OperationalMetric } from './operational-metric.entity';
import { ALERT_CHANNEL, AlertingService } from './alerting.service';
import { createAlertChannel } from './alert-webhook.channel';
import { IntegrityMonitoringService } from './integrity-monitoring.service';
import { OperationsCentreService } from './operations-centre.service';
import { OperationalMetricsService } from './operational-metrics.service';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';
import { OperationsController } from './operations.controller';
import { WorkerLeaseService } from './worker-lease.service';
import { WorkerSupervisorService } from './worker-supervisor.service';

@Global()
@Module({
  imports: [
    // V1-ADMIN-AUTHORIZATION-READ-SURFACE-01: AuthorizationModule already forward-refs back to
    // this module (RuntimeAccessGuard -> AuthenticationSessionService -> CustomerAuthenticationModule
    // -> ... -> OperationsModule), so this edge must be lazy too.
    forwardRef(() => AuthorizationModule),
    ReconciliationModule,
    TypeOrmModule.forFeature([AuditEvent, IdempotencyRecord, OperationalMetric, OutboxEvent]),
  ],
  controllers: [OperationsController],
  providers: [
    AuditService,
    DiagnosticsService,
    IdempotencyService,
    MetricsService,
    OutboxService,
    OperationalMetricsService,
    IntegrityMonitoringService,
    AlertingService,
    /*
     * ARENA 3D Group 38. The delivery seam from Group 19 finally has a second implementation: when
     * ALERT_WEBHOOK_URL and ALERT_WEBHOOK_SECRET are set, alerts leave the process over a signed
     * HTTPS webhook. Unset means NoneAlertChannel — evaluated and recorded, nobody paged, and the
     * report says so. Half-configured throws here, at startup, rather than running dark.
     */
    {
      provide: ALERT_CHANNEL,
      useFactory: () => createAlertChannel(process.env),
    },
    OperationsCentreService,
    WorkerLeaseService,
    // Group 15 supervision. Exported from this @Global module so any worker can report into it without a
    // new module edge — all four worker modules already import OperationsModule.
    WorkerSupervisorService,
  ],
  exports: [
    AuditService,
    DiagnosticsService,
    IdempotencyService,
    MetricsService,
    OutboxService,
    OperationalMetricsService,
    IntegrityMonitoringService,
    AlertingService,
    OperationsCentreService,
    WorkerLeaseService,
    WorkerSupervisorService,
  ],
})
export class OperationsModule {}
