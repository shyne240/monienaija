import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';

import { ProductGovernanceRecord } from './product-governance-record.entity';
import { ProductGovernanceController } from './product-governance.controller';
import { ProductGovernanceService } from './product-governance.service';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([ProductGovernanceRecord]),
    // P0-A: the controller injects CommercialRuleGovernanceService + AuthorizationService,
    // both exported by AuthorizationModule (same wiring as FeeRulesModule/CommissionModule).
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [ProductGovernanceController],
  providers: [ProductGovernanceService],
  exports: [ProductGovernanceService],
})
export class ProductGovernanceModule {}
