import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerFundingRequest } from './customer-funding-request.entity';
import { CustomerFundingService } from './customer-funding.service';
import { CustomerFundingInternalController } from './customer-funding-internal.controller';
import { CustomerFundingCustomerController } from './customer-funding-customer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerFundingRequest]), LedgerModule, PaymentModule, OperationsModule],
  controllers: [CustomerFundingInternalController, CustomerFundingCustomerController],
  providers: [CustomerFundingService],
  exports: [CustomerFundingService],
})
export class CustomerFundingModule {}
