import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerEligibility } from '../customer-eligibility/customer-eligibility.entity';
import { CustomerOnboarding } from '../customer-onboarding/customer-onboarding.entity';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import { CustomerActivationReadinessService } from '../customer-onboarding/customer-activation-readiness.service';
import { CustomerClassModule } from '../customer-class/customer-class.module';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerWallet } from './customer-wallet.entity';
import { CustomerWalletActivationController } from './customer-wallet-activation.controller';
import { CustomerWalletActivationService } from './customer-wallet-activation.service';
import { CustomerWalletController } from './customer-wallet.controller';
import { CustomerWalletService } from './customer-wallet.service';
import { WalletAlias } from './wallet-alias.entity';
import { WalletOwnership } from './wallet-ownership.entity';
import { WalletProvisioningHistory } from './wallet-provisioning-history.entity';

@Module({
  imports: [
    OperationsModule,
    KycTierModule,
    AuthorizationModule,
    CustomerClassModule,
    forwardRef(() => WalletModule),
    TypeOrmModule.forFeature([
      Customer,
      CustomerOnboarding,
      CustomerEligibility,
      CustomerWallet,
      WalletProvisioningHistory,
      WalletAlias,
      WalletOwnership,
    ]),
  ],
  controllers: [CustomerWalletController, CustomerWalletActivationController],
  providers: [
    CustomerWalletService,
    CustomerActivationReadinessService,
    CustomerWalletActivationService,
  ],
  exports: [
    CustomerWalletService,
    CustomerActivationReadinessService,
    CustomerWalletActivationService,
  ],
})
export class CustomerWalletModule {}
