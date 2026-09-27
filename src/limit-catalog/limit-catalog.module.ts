import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LimitCatalogController } from './limit-catalog.controller';
import { LimitCatalogService } from './limit-catalog.service';
import { LimitProfile } from './limit-profile.entity';
import { LimitRule } from './limit-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LimitProfile, LimitRule])],
  controllers: [LimitCatalogController],
  providers: [LimitCatalogService],
  exports: [LimitCatalogService],
})
export class LimitCatalogModule {}
