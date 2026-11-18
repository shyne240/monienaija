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
    WorkerLeaseService,
    WorkerSupervisorService,
  ],
})
export class OperationsModule {}
