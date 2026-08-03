import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { Withdrawal } from './withdrawal.entity';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';

@Module({
  imports: [LedgerModule, PaymentModule, TypeOrmModule.forFeature([Withdrawal])],
  controllers: [WithdrawalController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
