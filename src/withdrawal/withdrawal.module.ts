import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { FinancialCommandGateService } from '../authorization/financial-command-gate.service';
import { CapabilityPolicyModule } from '../policy/capability-policy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { WalletModule } from '../wallet/wallet.module';
import { Withdrawal } from './withdrawal.entity';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalGateService } from './withdrawal-gate.service';

@Module({
  imports: [
    AuthorizationModule,
    CapabilityPolicyModule,
    LedgerModule,
    PaymentModule,
    WalletModule,
    TypeOrmModule.forFeature([Withdrawal]),
  ],
  controllers: [WithdrawalController],
  providers: [WithdrawalService, FinancialCommandGateService, WithdrawalGateService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
