import { KycTierModule } from '../kyc-verification/kyc-tier.module';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { MobileAccountClaimService } from './mobile-account-claim.service';
import { MobileOnboardingAuthController } from './mobile-onboarding-auth.controller';
import { MobileOnboardingAuthService } from './mobile-onboarding-auth.service';
import { MobileOnboardingStateService } from './mobile-onboarding-state.service';
import { CustomerActivationReadinessService } from '../customer-onboarding/customer-activation-readiness.service';
import { CustomerWalletModule } from '../customer-wallet/customer-wallet.module';
import { KycSyntheticCredentialsController } from '../kyc-verification/kyc-synthetic-credentials.controller';
import { KycSyntheticCredentialsService } from '../kyc-verification/kyc-synthetic-credentials.service';
import { KycRegistrationCompletionController } from '../kyc-verification/kyc-registration-completion.controller';
import { KycRegistrationCompletionService } from '../kyc-verification/kyc-registration-completion.service';
import { AuditService } from '../operations/audit.service';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { NotificationModule } from '../notification/notification.module';
import { OperationsModule } from '../operations/operations.module';
import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { CustomerAuthenticationCredential } from '../customer-authentication/customer-authentication-credential.entity';
import { CustomerAuthenticationModule } from '../customer-authentication/customer-authentication.module';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletModule } from '../wallet/wallet.module';
import { CustomerRegistrationPhoneChallenge } from './customer-registration-phone-challenge.entity';
import { CustomerRegistrationController } from './customer-registration.controller';
import { CustomerRegistrationService } from './customer-registration.service';
import { DataSource } from 'typeorm';
import { KycProviderGovernanceController } from '../kyc-verification/kyc-provider-governance.controller';
import { KycProviderGovernanceService } from '../kyc-verification/kyc-provider-governance.service';
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
 * Legacy OTP phone verification remains available for workforce contact verification.
 * Public self-service completion is disabled until genuine KYC activation is implemented.
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
    forwardRef(() => KycTierModule),
    forwardRef(() => CustomerAuthenticationModule),
    AuthorizationModule,
    NotificationModule,
    OperationsModule,
    forwardRef(() => WalletModule),
    // The shared activation-readiness projection (admin review + customer activation + this
    // mobile state read) is provided by CustomerWalletModule; importing it keeps ONE authority.
    CustomerWalletModule,
  ],
  controllers: [
    CustomerRegistrationController,
    KycRegistrationSessionController,
    KycRegistrationCompletionController,
    KycSyntheticCredentialsController,
    MobileOnboardingAuthController,
    KycProviderGovernanceController,
  ],
  providers: [
    CustomerRegistrationService,
    {
      provide: MobileAccountClaimService,
      inject: [DataSource, AuditService],
      useFactory: (db: DataSource, audit: AuditService) => new MobileAccountClaimService(db, audit),
    },
    {
      provide: KycRegistrationSessionService,
      inject: [DataSource, NOTIFICATION_PROVIDER_TOKEN, A2SecurityRateLimitService],
      useFactory: (
        db: DataSource,
        sms: NotificationProvider,
        limiter: A2SecurityRateLimitService,
      ) => new KycRegistrationSessionService(db, sms, limiter),
    },
    {
      provide: KycRegistrationCompletionService,
      inject: [DataSource, AuditService, KycRegistrationSessionService],
      useFactory: (db: DataSource, audit: AuditService, sessions: KycRegistrationSessionService) =>
        new KycRegistrationCompletionService(db, audit, sessions),
    },
    {
      provide: KycSyntheticCredentialsService,
      inject: [DataSource, AuditService, KycRegistrationCompletionService],
      useFactory: (
        db: DataSource,
        audit: AuditService,
        completion: KycRegistrationCompletionService,
      ) => new KycSyntheticCredentialsService(db, audit, completion),
    },
    {
      provide: MobileOnboardingAuthService,
      inject: [
        DataSource,
        AuditService,
        KycRegistrationCompletionService,
        CustomerFinancialEligibilityService,
        AuthenticationSessionService,
      ],
      useFactory: (
        db: DataSource,
        audit: AuditService,
        completion: KycRegistrationCompletionService,
        eligibility: CustomerFinancialEligibilityService,
        sessions: AuthenticationSessionService,
      ) => new MobileOnboardingAuthService(db, audit, completion, eligibility, sessions),
    },
    {
      provide: MobileOnboardingStateService,
      inject: [DataSource, CustomerActivationReadinessService],
      useFactory: (db: DataSource, readiness: CustomerActivationReadinessService) =>
        new MobileOnboardingStateService(db, readiness),
    },
    { provide: REGISTRATION_SYNTHETIC_PROVIDER, useClass: RegistrationSyntheticProvider },
    {
      provide: KycRegistrationVerificationService,
      inject: [DataSource, REGISTRATION_SYNTHETIC_PROVIDER, KycProviderGovernanceService],
      useFactory: (
        db: DataSource,
        provider: KycProvider,
        governance: KycProviderGovernanceService,
      ) => new KycRegistrationVerificationService(db, provider, governance),
    },
  ],
  exports: [CustomerRegistrationService],
})
export class CustomerRegistrationModule {}
