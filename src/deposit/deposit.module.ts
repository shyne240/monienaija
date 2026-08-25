import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { FinancialCommandGateService } from '../authorization/financial-command-gate.service';
import { CapabilityPolicyModule } from '../policy/capability-policy.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { WalletModule } from '../wallet/wallet.module';
import { Deposit } from './deposit.entity';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { DepositGateService } from './deposit-gate.service';

@Module({
  imports: [
    AuthorizationModule,
    CapabilityPolicyModule,
    LedgerModule,
    PaymentModule,
    WalletModule,
    TypeOrmModule.forFeature([Deposit]),
  ],
  controllers: [DepositController],
  providers: [DepositService, FinancialCommandGateService, DepositGateService],
  exports: [DepositService],
})
export class DepositModule {}
