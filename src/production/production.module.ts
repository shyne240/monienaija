import { Global, Module } from '@nestjs/common';

import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { ApiVersionService } from './api-version.service';
import { GracefulShutdownService } from './graceful-shutdown.service';
import { ProductionConfigurationService } from './production-configuration.service';
import { ProductionController } from './production.controller';
import { ProductionReadinessService } from './production-readiness.service';
import { RequestTrackerService } from './request-tracker.service';

@Global()
@Module({
  imports: [ReconciliationModule],
  controllers: [ProductionController],
  providers: [
    ApiVersionService,
    GracefulShutdownService,
    ProductionConfigurationService,
    ProductionReadinessService,
    RequestTrackerService,
  ],
  exports: [
    ApiVersionService,
    GracefulShutdownService,
    ProductionConfigurationService,
    ProductionReadinessService,
    RequestTrackerService,
  ],
})
export class ProductionModule {}
