import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LimitAssignmentController } from './limit-assignment.controller';
import { LimitAssignmentService } from './limit-assignment.service';
import { LimitAssignment } from './limit-assignment.entity';
import { LimitCatalogController } from './limit-catalog.controller';
import { LimitCatalogService } from './limit-catalog.service';
import { LimitProfile } from './limit-profile.entity';
import { LimitRule } from './limit-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LimitProfile, LimitRule, LimitAssignment])],
  controllers: [LimitCatalogController, LimitAssignmentController],
  providers: [LimitCatalogService, LimitAssignmentService],
  exports: [LimitCatalogService, LimitAssignmentService],
})
export class LimitCatalogModule {}
