import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';
import { Customer } from './customer.entity';
import { CustomerAddress } from './customer-address.entity';
import { CustomerContactMethod } from './customer-contact-method.entity';
import { CustomerController } from './customer.controller';
import { CustomerIdentityDocument } from './customer-identity-document.entity';
import { CustomerKycAssessment } from './customer-kyc-assessment.entity';
import { CustomerProfile } from './customer-profile.entity';
import { CustomerService } from './customer.service';
import { CustomerTransactionPin } from './customer-transaction-pin.entity';
import { CustomerTransactionPinService } from './customer-transaction-pin.service';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    OperationsModule,
    // V1-ADMIN-AUTHORIZATION-HARDENING-01: CustomerController's PATCH :id lifecycle handler
    // calls AuthorizationService.requireFunction() (customer.suspend/.activate/.close, derived
    // from the request body per Decision 4).
    AuthorizationModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerProfile,
      CustomerAddress,
      CustomerContactMethod,
      CustomerIdentityDocument,
      CustomerKycAssessment,
      CustomerTransactionPin,
    ]),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerTransactionPinService],
  exports: [CustomerService, CustomerTransactionPinService],
})
export class CustomerModule {}
