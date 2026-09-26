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

@Module({
  imports: [
    OperationsModule,
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
