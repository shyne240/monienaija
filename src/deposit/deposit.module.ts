import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { Deposit } from './deposit.entity';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';

@Module({
  imports: [LedgerModule, PaymentModule, TypeOrmModule.forFeature([Deposit])],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositModule {}
