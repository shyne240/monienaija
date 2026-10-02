import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationsModule } from '../operations/operations.module';
import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerAuthenticationCredential } from '../customer-authentication/customer-authentication-credential.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerRegistrationPhoneChallenge } from './customer-registration-phone-challenge.entity';
import { CustomerRegistrationController } from './customer-registration.controller';
import { CustomerRegistrationService } from './customer-registration.service';

/**
 * V1-CUSTOMER-01 — Customer registration module.
 * Public front door (OTP phone verification -> customer creation, password setup, and primary NGN wallet provisioning).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerRegistrationPhoneChallenge,
      Customer,
      CustomerContactMethod,
      CustomerProfile,
      CustomerAuthenticationCredential,
      WalletAccount,
      LedgerAccount,
    ]),
    AuthorizationModule,
    NotificationModule,
    OperationsModule,
    forwardRef(() => WalletModule),
  ],
  controllers: [CustomerRegistrationController],
  providers: [CustomerRegistrationService],
  exports: [CustomerRegistrationService],
})
export class CustomerRegistrationModule {}
