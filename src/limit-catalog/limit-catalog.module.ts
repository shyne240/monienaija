import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LimitAssignmentController } from './limit-assignment.controller';
import { LimitAssignmentService } from './limit-assignment.service';
import { LimitAssignment } from './limit-assignment.entity';
import { LimitCatalogController } from './limit-catalog.controller';
import { LimitCatalogService } from './limit-catalog.service';
import { LimitProfile } from './limit-profile.entity';
import { LimitReservation } from './limit-reservation.entity';
import { LimitRule } from './limit-rule.entity';
import { LimitUsage } from './limit-usage.entity';
import { LimitUsageService } from './limit-usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([LimitProfile, LimitRule, LimitAssignment, LimitUsage, LimitReservation])],
  controllers: [LimitCatalogController, LimitAssignmentController],
  providers: [LimitCatalogService, LimitAssignmentService, LimitUsageService],
  exports: [LimitCatalogService, LimitAssignmentService, LimitUsageService],
})
export class LimitCatalogModule {}
