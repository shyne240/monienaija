import { Controller, Get, Query } from '@nestjs/common';

import { AuditService } from './audit.service';
import { DiagnosticsService } from './diagnostics.service';
import { MetricsService } from './metrics.service';
import { OutboxService } from './outbox.service';
import { OutboxEventStatus } from './operations.enums';

@Controller('internal')
export class OperationsController {
  constructor(
    private readonly auditService: AuditService,
    private readonly diagnosticsService: DiagnosticsService,
    private readonly metricsService: MetricsService,
    private readonly outboxService: OutboxService,
  ) {}

  @Get('metrics')
  getMetrics() {
    return this.metricsService.getMetrics();
  }

  @Get('diagnostics')
  getDiagnostics() {
    return this.diagnosticsService.getDiagnostics();
  }

  @Get('audit')
  getAudit(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('correlationId') correlationId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.list({
      entityType,
      entityId,
      correlationId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('outbox')
  getOutbox(@Query('status') status?: OutboxEventStatus, @Query('limit') limit?: string) {
    return this.outboxService.list({ status, limit: limit ? Number(limit) : undefined });
  }
}
