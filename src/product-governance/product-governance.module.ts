import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { ProductGovernanceRecord } from './product-governance-record.entity';
import { ProductGovernanceController } from './product-governance.controller';
import { ProductGovernanceService } from './product-governance.service';

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([ProductGovernanceRecord])],
  controllers: [ProductGovernanceController],
  providers: [ProductGovernanceService],
  exports: [ProductGovernanceService],
})
export class ProductGovernanceModule {}
