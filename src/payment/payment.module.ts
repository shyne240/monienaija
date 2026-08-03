import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentReference } from './payment-reference.entity';
import { PaymentReferenceService } from './payment-reference.service';
import { SettlementAccountService } from './settlement-account.service';

@Module({
  imports: [LedgerModule, TypeOrmModule.forFeature([PaymentReference])],
  providers: [PaymentReferenceService, SettlementAccountService],
  exports: [PaymentReferenceService, SettlementAccountService],
})
export class PaymentModule {}
