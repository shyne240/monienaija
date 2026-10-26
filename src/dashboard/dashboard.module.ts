import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationRole } from '../authorization-catalogue/authorization-role.entity';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { DashboardController } from './dashboard.controller';
import { DashboardSeedService } from './dashboard-seed.service';
import { DashboardService } from './dashboard.service';
import { DashboardTemplate } from './dashboard-template.entity';
import { DashboardWidgetDataService } from './dashboard-widget-data.service';
import { RoleDashboardAssignment } from './role-dashboard-assignment.entity';

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01. `AuditService` is injected without an explicit
 * import here because `OperationsModule` (its home) is declared `@Global()` elsewhere in
 * app.module.ts, mirroring how `OperationsController` itself consumes it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DashboardTemplate, RoleDashboardAssignment, AuthorizationRole]),
    AuthorizationModule,
    ReconciliationModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardSeedService, DashboardWidgetDataService],
  exports: [DashboardService],
})
export class DashboardModule {}
