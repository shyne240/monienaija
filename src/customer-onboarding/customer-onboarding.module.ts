import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerAddress } from '../customer/customer-address.entity';
import { CustomerIdentityDocument } from '../customer/customer-identity-document.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { OperationsModule } from '../operations/operations.module';
import { CustomerAgreement } from './customer-agreement.entity';
import { CustomerApprovalDecision } from './customer-approval-decision.entity';
import { CustomerOnboardingController } from './customer-onboarding.controller';
import { CustomerOnboarding } from './customer-onboarding.entity';
import { CustomerOnboardingService } from './customer-onboarding.service';
import { CustomerOnboardingTask } from './customer-onboarding-task.entity';
import { CustomerRiskProfile } from './customer-risk-profile.entity';

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerProfile,
      CustomerAddress,
      CustomerIdentityDocument,
      CustomerOnboarding,
      CustomerAgreement,
      CustomerRiskProfile,
      CustomerOnboardingTask,
      CustomerApprovalDecision,
    ]),
  ],
  controllers: [CustomerOnboardingController],
  providers: [CustomerOnboardingService],
  exports: [CustomerOnboardingService],
})
export class CustomerOnboardingModule {}
