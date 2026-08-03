import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { DiagnosticsReport } from '../operations/operations.types';
import { DiagnosticsService } from '../operations/diagnostics.service';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
  diagnostics?: DiagnosticsReport;
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
      if (!this.diagnosticsService) {
        return this.live();
      }
      const diagnostics = await this.diagnosticsService.getDiagnostics();
      if (diagnostics.status === 'degraded') {
        throw new ServiceUnavailableException({
          status: 'error',
          message: 'Service dependencies are degraded',
          diagnostics,
        });
      }
      return { ...this.live(), diagnostics };
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
