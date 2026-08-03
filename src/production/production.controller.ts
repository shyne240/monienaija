import { Controller, Get } from '@nestjs/common';

import { ApiVersionService } from './api-version.service';
import { ProductionConfigurationService } from './production-configuration.service';
import { ProductionReadinessService } from './production-readiness.service';

@Controller('internal')
export class ProductionController {
  constructor(
    private readonly apiVersionService: ApiVersionService,
    private readonly configurationService: ProductionConfigurationService,
    private readonly readinessService: ProductionReadinessService,
  ) {}

  @Get('version')
  getVersion() {
    return this.apiVersionService.getVersionMetadata();
  }

  @Get('configuration')
  getConfiguration() {
    return this.configurationService.getSafeConfiguration();
  }

  @Get('deployment')
  getDeployment() {
    return this.readinessService.getReadiness();
  }

  @Get('readiness')
  getReadiness() {
    return this.readinessService.getReadiness();
  }
}
