import { Module } from '@nestjs/common';

import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { DepositModule } from '../deposit/deposit.module';
import { TransferModule } from '../transfer/transfer.module';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalModule } from '../withdrawal/withdrawal.module';
import { CustomerFinancialOperationsController } from './customer-financial-operations.controller';
import { CustomerFinancialOperationsService } from './customer-financial-operations.service';
import { CustomerTransactionAuthorizationService } from './customer-transaction-authorization.service';

@Module({
  imports: [
    CustomerAuthenticationModule,
    DepositModule,
    TransferModule,
    WalletModule,
    WithdrawalModule,
  ],
  controllers: [CustomerFinancialOperationsController],
  providers: [CustomerFinancialOperationsService, CustomerTransactionAuthorizationService],
  exports: [CustomerFinancialOperationsService, CustomerTransactionAuthorizationService],
})
export class CustomerFinancialOperationsModule {}
