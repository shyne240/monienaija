import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { B1BillingEngineModule } from './b1-billing-engine.module';
import { B1BillingDocument } from './b1-billing-engine.entity';
import {
  B1DueDateAmendment,
  B1InvoicePaymentTermBinding,
  B1PaymentTerm,
} from './b1-payment-term.entity';
import { B1PaymentTermService } from './b1-payment-term.service';

@Module({
  imports: [
    OperationsModule,
    AuthorizationModule,
    B1BillingEngineModule,
    TypeOrmModule.forFeature([
      B1BillingDocument,
      B1PaymentTerm,
      B1InvoicePaymentTermBinding,
      B1DueDateAmendment,
    ]),
  ],
  providers: [B1PaymentTermService],
  exports: [B1PaymentTermService],
})
export class B1PaymentTermModule {}
