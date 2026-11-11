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
import { DataSource } from 'typeorm';
import { A2SecurityRateLimitService } from '../authorization/security-rate-limit.service';
import { NOTIFICATION_PROVIDER_TOKEN } from '../notification/notification.constants';
import type { NotificationProvider } from '../notification/notification.types';
import { KycRegistrationSessionController } from '../kyc-verification/kyc-registration-session.controller';
import { KycRegistrationSessionService } from '../kyc-verification/kyc-registration-session.service';
import {
  KycRegistrationVerificationService,
  RegistrationSyntheticProvider,
  REGISTRATION_SYNTHETIC_PROVIDER,
} from '../kyc-verification/kyc-registration-verification.service';
import type { KycProvider } from '../kyc-verification/kyc.types';

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
  controllers: [CustomerRegistrationController, KycRegistrationSessionController],
  providers: [
    CustomerRegistrationService,
    {
      provide: KycRegistrationSessionService,
      inject: [DataSource, NOTIFICATION_PROVIDER_TOKEN, A2SecurityRateLimitService],
      useFactory: (
        db: DataSource,
        sms: NotificationProvider,
        limiter: A2SecurityRateLimitService,
      ) => new KycRegistrationSessionService(db, sms, limiter),
    },
    { provide: REGISTRATION_SYNTHETIC_PROVIDER, useClass: RegistrationSyntheticProvider },
    {
      provide: KycRegistrationVerificationService,
      inject: [DataSource, REGISTRATION_SYNTHETIC_PROVIDER],
      useFactory: (db: DataSource, provider: KycProvider) =>
        new KycRegistrationVerificationService(db, provider),
    },
  ],
  exports: [CustomerRegistrationService],
})
export class CustomerRegistrationModule {}
