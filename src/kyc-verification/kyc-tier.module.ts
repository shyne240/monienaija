import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Environment } from '../config/environment';
import { AuthorizationService } from '../authorization/authorization.service';
import { ProtectedAuthorityService } from '../authorization/protected-authority.service';
import { AuditService } from '../operations/audit.service';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { CustomerTierDefaultClassService } from '../customer-class/customer-tier-default-class.service';
import { CustomerEffectiveConfigurationService } from '../customer-onboarding/customer-effective-configuration.service';
import {
  MonnifyVerificationProvider,
  monnifyOptionsFromEnvironment,
} from '../identity-verification/monnify-verification.provider';
import {
  DojahVerificationProvider,
  dojahOptionsFromEnvironment,
} from '../identity-verification/dojah-verification.provider';
import { PremblyVerificationProvider } from '../identity-verification/prembly-verification.provider';
import {
  premblyHttpsTransport,
  type PremblyTransport,
} from '../identity-verification/prembly-transport';
import {
  KycProviderGovernanceService,
  type KycProviderRuntimeReadiness,
  type ProviderCode,
} from './kyc-provider-governance.service';
import { KycTierPolicyService } from './kyc-tier-policy.service';
import { KycTierPolicyController } from './kyc-tier-policy.controller';
import { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { KycTierTransitionService } from './kyc-tier-transition.service';
import { KycTierReviewController } from './kyc-tier-review.controller';
import { CustomerFinancialEligibilityService } from './customer-financial-eligibility.service';
import { KycTierWorker } from './kyc-tier-worker.service';
import { KycCustomerSessionValidator } from './kyc-customer-session-validator';
import { KycCustomerVerificationService } from './kyc-customer-verification.service';
import { customerKycConfigurationFromEnvironment } from './kyc-customer-verification.config';
import { DojahKycProvider } from './dojah-kyc.provider';
import { MonnifyKycProvider } from './monnify-kyc.provider';
import { PremblyKycProvider } from './prembly-kyc.provider';
import { PremblyCredentialController } from './prembly-credential.controller';
import { PremblyCredentialGovernanceService } from './prembly-credential-governance.service';
import { KycProviderSecretEncryptionService } from './kyc-provider-secret-encryption.service';
import type { KycProvider } from './kyc.types';

const KYC_PROVIDER_RUNTIME = 'KYC_PROVIDER_RUNTIME';
const PREMBLY_TRANSPORT = 'PREMBLY_TRANSPORT';
const PREMBLY_VERIFICATION_ADAPTER = 'PREMBLY_VERIFICATION_ADAPTER';
type ProviderRuntime = {
  providers: readonly KycProvider[];
  readiness: KycProviderRuntimeReadiness;
};
function providerRuntimeFromConfig(
  config: ConfigService<Environment, true>,
  premblyCredentials: PremblyCredentialGovernanceService,
  premblyAdapter: PremblyVerificationProvider,
): ProviderRuntime {
  const monnifyOptions = monnifyOptionsFromEnvironment({
    MONNIFY_VERIFICATION_ENABLED: config.get('MONNIFY_VERIFICATION_ENABLED', { infer: true })
      ? 'true'
      : 'false',
    MONNIFY_API_KEY: config.get('MONNIFY_API_KEY', { infer: true }),
    MONNIFY_SECRET_KEY: config.get('MONNIFY_SECRET_KEY', { infer: true }),
  });
  const dojahOptions = dojahOptionsFromEnvironment({
    DOJAH_VERIFICATION_ENABLED: config.get('DOJAH_VERIFICATION_ENABLED', { infer: true })
      ? 'true'
      : 'false',
    DOJAH_VERIFICATION_ENV: config.get('DOJAH_VERIFICATION_ENV', { infer: true }),
    DOJAH_SECRET_KEY: config.get('DOJAH_SECRET_KEY', { infer: true }),
    DOJAH_APP_ID: config.get('DOJAH_APP_ID', { infer: true }),
  });
  const contractsReviewed = config.get('KYC_PROVIDER_CONTRACTS_REVIEWED', { infer: true });
  const liveCallsReleased = config.get('KYC_PROVIDER_LIVE_CALLS_ENABLED', { infer: true });
  const readyValues: Record<ProviderCode, boolean> = {
    MONNIFY:
      contractsReviewed &&
      liveCallsReleased &&
      monnifyOptions.enabled === true &&
      typeof monnifyOptions.apiKey === 'string' &&
      monnifyOptions.apiKey.length > 0 &&
      !monnifyOptions.apiKey.includes(':') &&
      typeof monnifyOptions.secretKey === 'string' &&
      monnifyOptions.secretKey.length > 0,
    DOJAH:
      contractsReviewed &&
      liveCallsReleased &&
      dojahOptions.enabled === true &&
      typeof dojahOptions.environment === 'string' &&
      typeof dojahOptions.secretKey === 'string' &&
      dojahOptions.secretKey.length > 0 &&
      typeof dojahOptions.appId === 'string' &&
      dojahOptions.appId.length > 0,
    PREMBLY: false,
    SYNTHETIC: config.get('NODE_ENV', { infer: true }) === 'test',
  };
  const readiness: KycProviderRuntimeReadiness = {
    ...readyValues,
    isReady: (provider) =>
      provider === 'PREMBLY' ? premblyCredentials.isRuntimeReady() : readyValues[provider],
  };
  return {
    providers: [
      new MonnifyKycProvider(new MonnifyVerificationProvider(monnifyOptions)),
      new DojahKycProvider(new DojahVerificationProvider(dojahOptions)),
      new PremblyKycProvider(premblyAdapter),
    ],
    readiness,
  };
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- lazy require breaks a Nest DI cycle observed in compiled CI/unit bootstrap */
@Module({
  imports: [
    forwardRef(
      () => require('../authorization/protected-authority.module').ProtectedAuthorityModule,
    ),
    forwardRef(() => require('../authorization/authorization.module').AuthorizationModule),
    forwardRef(() => require('../operations/operations.module').OperationsModule),
    forwardRef(
      () =>
        require('../customer-authentication/customer-authentication.module')
          .CustomerAuthenticationModule,
    ),
    forwardRef(() => require('../customer-class/customer-class.module').CustomerClassModule),
    forwardRef(() => require('../fee-rules/fee-rules.module').FeeRulesModule),
    forwardRef(() => require('../limit-catalog/limit-catalog.module').LimitCatalogModule),
    forwardRef(() => require('../product-catalog/product-catalog.module').ProductCatalogModule),
  ],
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
  controllers: [KycTierPolicyController, KycTierReviewController, PremblyCredentialController],
  providers: [
    CustomerFinancialEligibilityService,
    { provide: PREMBLY_TRANSPORT, useValue: premblyHttpsTransport },
    {
      provide: KycProviderSecretEncryptionService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new KycProviderSecretEncryptionService(config),
    },
    {
      provide: PremblyCredentialGovernanceService,
      inject: [
        DataSource,
        AuthorizationService,
        ProtectedAuthorityService,
        KycProviderSecretEncryptionService,
        AuditService,
        ConfigService,
        PREMBLY_TRANSPORT,
      ],
      useFactory: (
        db: DataSource,
        auth: AuthorizationService,
        protectedAuthority: ProtectedAuthorityService,
        encryption: KycProviderSecretEncryptionService,
        audit: AuditService,
        config: ConfigService<Environment, true>,
        transport: PremblyTransport,
      ) =>
        new PremblyCredentialGovernanceService(
          db,
          auth,
          protectedAuthority,
          encryption,
          audit,
          config,
          transport,
        ),
    },
    {
      provide: PREMBLY_VERIFICATION_ADAPTER,
      inject: [PremblyCredentialGovernanceService, PREMBLY_TRANSPORT],
      useFactory: (credentials: PremblyCredentialGovernanceService, transport: PremblyTransport) =>
        new PremblyVerificationProvider({
          credentialResolver: { getApiKey: () => credentials.getRuntimeApiKey() },
          transport,
        }),
    },

    {
      provide: KycTierPolicyService,
      inject: [DataSource, AuthorizationService, ProtectedAuthorityService],
      useFactory: (
        db: DataSource,
        auth: AuthorizationService,
        protectedAuthority: ProtectedAuthorityService,
      ) => new KycTierPolicyService(db, auth, protectedAuthority),
    },
    { provide: KycTierEvidenceReader, useFactory: () => new KycTierEvidenceReader() },
    {
      provide: KYC_PROVIDER_RUNTIME,
      inject: [ConfigService, PremblyCredentialGovernanceService, PREMBLY_VERIFICATION_ADAPTER],
      useFactory: (
        config: ConfigService<Environment, true>,
        credentials: PremblyCredentialGovernanceService,
        adapter: PremblyVerificationProvider,
      ) => providerRuntimeFromConfig(config, credentials, adapter),
    },
    {
      provide: KycProviderGovernanceService,
      inject: [DataSource, AuthorizationService, ProtectedAuthorityService, KYC_PROVIDER_RUNTIME],
      useFactory: (
        db: DataSource,
        auth: AuthorizationService,
        protectedAuthority: ProtectedAuthorityService,
        runtime: ProviderRuntime,
      ) => new KycProviderGovernanceService(db, auth, protectedAuthority, runtime.readiness),
    },
    {
      provide: KycCustomerSessionValidator,
      inject: [AuthenticationSessionService],
      useFactory: (sessions: AuthenticationSessionService) =>
        new KycCustomerSessionValidator(sessions),
    },
    {
      provide: KycCustomerVerificationService,
      inject: [
        DataSource,
        KycCustomerSessionValidator,
        KycProviderGovernanceService,
        KYC_PROVIDER_RUNTIME,
        ConfigService,
        KycTierPolicyService,
        KycTierEvidenceReader,
      ],
      useFactory: (
        db: DataSource,
        sessions: KycCustomerSessionValidator,
        governance: KycProviderGovernanceService,
        runtime: ProviderRuntime,
        config: ConfigService<Environment, true>,
        policies: KycTierPolicyService,
        reader: KycTierEvidenceReader,
      ) =>
        new KycCustomerVerificationService(
          db,
          sessions,
          governance,
          runtime.providers,
          customerKycConfigurationFromEnvironment({
            KYC_CUSTOMER_VERIFICATION_ENABLED: config.get('KYC_CUSTOMER_VERIFICATION_ENABLED', {
              infer: true,
            }),
            KYC_VERIFICATION_POLICY_JSON: config.get('KYC_VERIFICATION_POLICY_JSON', {
              infer: true,
            }),
            KYC_CONSENT_NOTICE_VERSION: config.get('KYC_CONSENT_NOTICE_VERSION', { infer: true }),
            KYC_CONSENT_NOTICE_TEXT: config.get('KYC_CONSENT_NOTICE_TEXT', { infer: true }),
            KYC_CONSENT_VALIDITY_SECONDS: config.get('KYC_CONSENT_VALIDITY_SECONDS', {
              infer: true,
            }),
            KYC_OWNERSHIP_KEY_BASE64: config.get('KYC_OWNERSHIP_KEY_BASE64', { infer: true }),
            KYC_OWNERSHIP_KEY_VERSION: config.get('KYC_OWNERSHIP_KEY_VERSION', { infer: true }),
          }),
          policies,
          reader,
        ),
    },
    CustomerEffectiveConfigurationService,
    {
      provide: KycTierTransitionService,
      inject: [
        DataSource,
        KycTierPolicyService,
        KycTierEvidenceReader,
        AuditService,
        AuthorizationService,
        AuthenticationSessionService,
        CustomerClassResolverService,
        CustomerTierDefaultClassService,
        CustomerEffectiveConfigurationService,
      ],
      useFactory: (
        db: DataSource,
        policies: KycTierPolicyService,
        reader: KycTierEvidenceReader,
        audit: AuditService,
        auth: AuthorizationService,
        sessions: AuthenticationSessionService,
        classResolver: CustomerClassResolverService,
        tierDefaults: CustomerTierDefaultClassService,
        effectiveConfig: CustomerEffectiveConfigurationService,
      ) =>
        new KycTierTransitionService(
          db,
          policies,
          reader,
          audit,
          auth,
          sessions,
          classResolver,
          tierDefaults,
          effectiveConfig,
        ),
    },
    {
      provide: KycTierWorker,
      inject: [DataSource, KycTierTransitionService, KycTierPolicyService, ConfigService],
      useFactory: (
        db: DataSource,
        transitions: KycTierTransitionService,
        policies: KycTierPolicyService,
        config: ConfigService<Environment, true>,
      ) =>
        new KycTierWorker(db, transitions, policies, {
          enabled: config.get('KYC_TIER_WORKER_ENABLED', { infer: true }),
          pollIntervalMs: config.get('KYC_TIER_WORKER_POLL_INTERVAL_MS', { infer: true }),
        }),
    },
  ],
  exports: [
    KycTierTransitionService,
    CustomerFinancialEligibilityService,
    KycTierEvidenceReader,
    KycProviderGovernanceService,
    KycCustomerVerificationService,
    CustomerEffectiveConfigurationService,
  ],
})
export class KycTierModule {}
