import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerFundingRequest } from './customer-funding-request.entity';
import { CustomerFundingService } from './customer-funding.service';
import { CustomerFundingInternalController } from './customer-funding-internal.controller';
import { CustomerFundingCustomerController } from './customer-funding-customer.controller';
import { LimitCatalogModule } from '../limit-catalog/limit-catalog.module';
import { CommercialDecisionModule } from '../commercial-decision/commercial-decision.module';
import { FeeRulesModule } from '../fee-rules/fee-rules.module';

// V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING commercial snapshot wiring (pilot extension):
// read-only fee resolution + immutable snapshot inside the existing SERIALIZABLE approve
// boundary. No charging, no fee engine wiring.
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerFundingRequest]),
    LedgerModule,
    PaymentModule,
    OperationsModule,
    LimitCatalogModule,
    CommercialDecisionModule,
    FeeRulesModule,
  ],
  controllers: [CustomerFundingInternalController, CustomerFundingCustomerController],
  providers: [CustomerFundingService],
  exports: [CustomerFundingService],
})
export class CustomerFundingModule {}
