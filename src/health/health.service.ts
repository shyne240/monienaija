import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DiagnosticsService } from '../operations/diagnostics.service';

/**
 * Public health payload.
 *
 * The public endpoints report state only. Operational detail (migration head, reconciliation
 * status, outbox backlog, diagnostics) stays behind `internal:access` at
 * `GET /api/v1/internal/readiness`, `/diagnostics`, `/deployment` and `/metrics`, so an anonymous
 * caller can never enumerate the deployment's internals.
 */
export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly diagnosticsService?: DiagnosticsService,
  ) {}

  live(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      if (this.diagnosticsService) {
        // Diagnostics decide readiness; they are not part of the public response body.
        const diagnostics = await this.diagnosticsService.getDiagnostics();
        if (diagnostics.status === 'degraded') {
          throw new ServiceUnavailableException({
            status: 'error',
            message: 'Service dependencies are degraded',
          });
        }
      }
      return this.live();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Service dependencies are unavailable',
      });
    }
  }
}
