import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  live(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return this.live();
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Service dependencies are unavailable',
      });
    }
  }
}
