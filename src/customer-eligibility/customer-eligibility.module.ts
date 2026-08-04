import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerOnboarding } from '../customer-onboarding/customer-onboarding.entity';
import { OperationsModule } from '../operations/operations.module';
import { CustomerEligibility } from './customer-eligibility.entity';
import { CustomerEligibilityController } from './customer-eligibility.controller';
import { CustomerEligibilityService } from './customer-eligibility.service';
import { CustomerLimitProfile } from './customer-limit-profile.entity';
import { CustomerOperatingPermission } from './customer-operating-permission.entity';
import { CustomerProductEnrollment } from './customer-product-enrollment.entity';
import { CustomerRestriction } from './customer-restriction.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerOnboarding,
      CustomerEligibility,
      CustomerLimitProfile,
      CustomerProductEnrollment,
      CustomerOperatingPermission,
      CustomerRestriction,
    ]),
  ],
  controllers: [CustomerEligibilityController],
  providers: [CustomerEligibilityService],
  exports: [CustomerEligibilityService],
})
export class CustomerEligibilityModule {}
