import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerRegistrationPhoneChallenge } from './customer-registration-phone-challenge.entity';
import { CustomerRegistrationController } from './customer-registration.controller';
import { CustomerRegistrationService } from './customer-registration.service';

/**
 * V1-CUSTOMER-ONBOARDING-01 — customer registration + phone verification foundation.
 * Public front door (capture → OTP verification → DRAFT customer) per the decided hybrid
 * model; workforce-controlled KYC/activation and all downstream steps are out of scope.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerRegistrationPhoneChallenge]),
    AuthorizationModule,
    NotificationModule,
    OperationsModule,
  ],
  controllers: [CustomerRegistrationController],
  providers: [CustomerRegistrationService],
  exports: [CustomerRegistrationService],
})
export class CustomerRegistrationModule {}
