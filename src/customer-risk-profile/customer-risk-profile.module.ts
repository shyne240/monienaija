import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { OperationsModule } from '../operations/operations.module';
import { CustomerRiskFactor } from './customer-risk-factor.entity';
import { CustomerRiskProfileController } from './customer-risk-profile.controller';
import { CustomerRiskProfile } from './customer-risk-profile.entity';
import { CustomerRiskProfileService } from './customer-risk-profile.service';
import { RiskFactorHistory } from './risk-factor-history.entity';
import { RiskProfileHistory } from './risk-profile-history.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerRiskProfile,
      CustomerRiskFactor,
      RiskProfileHistory,
      RiskFactorHistory,
    ]),
  ],
  controllers: [CustomerRiskProfileController],
  providers: [CustomerRiskProfileService],
  exports: [CustomerRiskProfileService],
})
export class CustomerRiskProfileModule {}
