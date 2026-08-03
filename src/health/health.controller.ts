import { Controller, Get } from '@nestjs/common';

import { HealthService, type HealthStatus } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  health(): HealthStatus {
    return this.healthService.live();
  }

  @Get('ready')
  ready(): Promise<HealthStatus> {
    return this.healthService.ready();
  }
}
