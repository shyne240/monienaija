import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { Customer } from '../customer/customer.entity';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { WalletOwnership } from '../customer-wallet/wallet-ownership.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerLine } from '../ledger/ledger-line.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingRepairService } from './customer-financial-account-binding-repair.service';
import { CustomerFinancialAccountBindingService } from './customer-financial-account-binding.service';
import { CustomerFinancialAccountReadService } from './customer-financial-account-read.service';
import { WalletAccount } from './wallet-account.entity';
import { WalletController } from './wallet.controller';
import { WalletOwnershipReconciliationController } from './wallet-ownership-reconciliation.controller';
import { WalletOwnershipReconciliationService } from './wallet-ownership-reconciliation.service';
import { WalletOwnershipResolutionService } from './wallet-ownership-resolution.service';
import { WalletOwnershipController } from './wallet-ownership.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [
    forwardRef(() => KycTierModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => LedgerModule),
    forwardRef(() => ReconciliationModule),
    TypeOrmModule.forFeature([
      Customer,
      CustomerWallet,
      WalletOwnership,
      LedgerAccount,
      LedgerLine,
      WalletAccount,
      CustomerFinancialAccountBinding,
    ]),
  ],
  controllers: [
    WalletController,
    WalletOwnershipController,
    WalletOwnershipReconciliationController,
  ],
  providers: [
    WalletService,
    CustomerFinancialAccountBindingService,
    CustomerFinancialAccountReadService,
    CustomerFinancialAccountBindingRepairService,
    WalletOwnershipResolutionService,
    WalletOwnershipReconciliationService,
  ],
  exports: [
    WalletService,
    CustomerFinancialAccountBindingService,
    CustomerFinancialAccountReadService,
    CustomerFinancialAccountBindingRepairService,
  ],
})
export class WalletModule {}
