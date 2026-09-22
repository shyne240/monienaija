import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerEligibility } from '../customer-eligibility/customer-eligibility.entity';
import { CustomerOnboarding } from '../customer-onboarding/customer-onboarding.entity';
import { OperationsModule } from '../operations/operations.module';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerReceivingNumber } from './customer-receiving-number.entity';
import { CustomerReceivingNumberService } from './customer-receiving-number.service';
import { CustomerWallet } from './customer-wallet.entity';
import { CustomerWalletController } from './customer-wallet.controller';
import { CustomerWalletService } from './customer-wallet.service';
import { WalletAlias } from './wallet-alias.entity';
import { WalletOwnership } from './wallet-ownership.entity';
import { WalletProvisioningHistory } from './wallet-provisioning-history.entity';

@Module({
  imports: [
    OperationsModule,
    WalletModule,
    TypeOrmModule.forFeature([
      Customer,
      CustomerOnboarding,
      CustomerEligibility,
      CustomerWallet,
      WalletProvisioningHistory,
      WalletAlias,
      WalletOwnership,
      CustomerReceivingNumber,
      CustomerContactMethod,
    ]),
  ],
  controllers: [CustomerWalletController],
  providers: [CustomerWalletService, CustomerReceivingNumberService],
  exports: [CustomerWalletService, CustomerReceivingNumberService],
})
export class CustomerWalletModule {}
