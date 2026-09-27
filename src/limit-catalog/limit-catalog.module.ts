import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { LimitAssignmentController } from './limit-assignment.controller';
import { LimitAssignmentService } from './limit-assignment.service';
import { LimitAssignment } from './limit-assignment.entity';
import { LimitCatalogController } from './limit-catalog.controller';
import { LimitCatalogService } from './limit-catalog.service';
import { LimitDiagnosticsService } from './limit-diagnostics.service';
import { LimitEnforcementService } from './limit-enforcement.service';
import { LimitOperationsController } from './limit-operations.controller';
import { LimitProfile } from './limit-profile.entity';
import { LimitProfileResolverService } from './limit-profile-resolver.service';
import { LimitReservation } from './limit-reservation.entity';
import { LimitReservationRecoveryService } from './limit-reservation-recovery.service';
import { LimitRule } from './limit-rule.entity';
import { LimitUsage } from './limit-usage.entity';
import { LimitUsageService } from './limit-usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([LimitProfile, LimitRule, LimitAssignment, LimitUsage, LimitReservation]), OperationsModule],
  controllers: [LimitCatalogController, LimitAssignmentController, LimitOperationsController],
  providers: [
    LimitCatalogService,
    LimitAssignmentService,
    LimitUsageService,
    LimitProfileResolverService,
    LimitEnforcementService,
    LimitDiagnosticsService,
    LimitReservationRecoveryService,
  ],
  exports: [
    LimitCatalogService,
    LimitAssignmentService,
    LimitUsageService,
    LimitProfileResolverService,
    LimitEnforcementService,
    LimitDiagnosticsService,
    LimitReservationRecoveryService,
  ],
})
export class LimitCatalogModule {}
