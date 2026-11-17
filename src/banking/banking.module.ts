import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import type { Environment } from '../config/environment';
import { AuthorizationModule } from '../authorization/authorization.module';
import { FeeModule } from '../fee/fee.module';
import { ProtectedAuthorityModule } from '../authorization/protected-authority.module';

import { BankingProviderRegistry } from './banking-provider.registry';
import {
  BANKING_PROVIDER_CAPABILITY_SOURCE,
  BankingProviderGovernanceService,
} from './banking-provider-governance.service';
import { BankingReadinessService } from './banking-readiness.service';
import { BankingOutboundService } from './banking-outbound.service';
import { BankingInboundService } from './banking-inbound.service';
import { BankingVirtualAccountService } from './banking-virtual-account.service';
import { BankingReconciliationService } from './banking-reconciliation.service';
import { BankingWebhookService } from './banking-webhook.service';
import { BankingDispatchWorker } from './banking-dispatch-worker.service';
import { BankingCommitmentBridgeService } from './banking-commitment-bridge.service';
import { BankingFeeBindingService } from './banking-fee-binding.service';
import { BankingWithdrawalExecutionAuthority } from './banking-withdrawal-execution-authority';
import { BankingExternalOperationStatusVerifier } from './banking-external-operation-status-verifier';
import { BankingInboundFundingVerifier } from './banking-inbound-funding-verifier';
import { BankingInboundInstitutionAuthority } from './banking-inbound-institution-authority';
import { BankingAdminController } from './banking-admin.controller';
import { BankingCustomerController } from './banking-customer.controller';
import { BankingWebhookController } from './banking-webhook.controller';
import { buildBankingRegistry } from './banking.config';
import { PostgresWebhookAttribution } from './banking-webhook.config';

export const BANKING_RUNTIME = Symbol('BANKING_RUNTIME');
export const BANKING_PROVIDER_KEYS = Symbol('BANKING_PROVIDER_KEYS');

export interface BankingRuntime {
  readonly enabled: boolean;
  readonly environment: 'sandbox' | 'production';
  readonly registeredProviders: readonly string[];
  readonly skippedProviders: readonly { provider: string; reason: string }[];
}

/**
 * The banking application module.
 *
 * Registration is resolved once at module construction from configuration, and the registry it
 * produces is injected everywhere else. Two properties matter:
 *
 * 1. **Nothing is registered by default.** `BANKING_ENABLED` is false and every provider needs its
 *    own credentials, so importing this module into an application cannot begin moving money. The
 *    module is always importable and always safe to import.
 * 2. **Everything downstream is a consumer of the registry, never of configuration.** A service asks
 *    "is this capability usable for this institution"; it never asks "are credentials present". That
 *    keeps the approval, credential, operational and entitlement distinctions in exactly one place.
 */
@Module({
  imports: [AuthorizationModule, FeeModule, ProtectedAuthorityModule],
  providers: [
    {
      provide: BANKING_RUNTIME,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): BankingRuntime => {
        const logger = new Logger('BankingRegistration');
        const result = buildBankingRegistry(
          {
            enabled: config.get('BANKING_ENABLED', { infer: true }),
            environment: config.get('BANKING_ENVIRONMENT', { infer: true }),
            contractCode: config.get('BANKING_MONNIFY_CONTRACT_CODE', { infer: true }),
            apiKey: config.get('BANKING_MONNIFY_API_KEY', { infer: true }),
            secretKey: config.get('BANKING_MONNIFY_SECRET_KEY', { infer: true }),
          },
          logger,
        );
        return {
          enabled: config.get('BANKING_ENABLED', { infer: true }),
          environment: config.get('BANKING_ENVIRONMENT', { infer: true }),
          registeredProviders: result.registered,
          skippedProviders: result.skipped,
        };
      },
    },
    {
      // The live registry. Resolved once and shared: a second registry instance would let one part of
      // the application believe a provider is registered while another believes it is not.
      provide: BankingProviderRegistry,
      inject: [ConfigService, BANKING_RUNTIME],
      useFactory: (config: ConfigService<Environment, true>): BankingProviderRegistry => {
        const logger = new Logger('BankingRegistration');
        return buildBankingRegistry(
          {
            enabled: config.get('BANKING_ENABLED', { infer: true }),
            environment: config.get('BANKING_ENVIRONMENT', { infer: true }),
            contractCode: config.get('BANKING_MONNIFY_CONTRACT_CODE', { infer: true }),
            apiKey: config.get('BANKING_MONNIFY_API_KEY', { infer: true }),
            secretKey: config.get('BANKING_MONNIFY_SECRET_KEY', { infer: true }),
          },
          logger,
        ).registry;
      },
    },
    {
      provide: BANKING_PROVIDER_KEYS,
      inject: [BANKING_RUNTIME],
      useFactory: (runtime: BankingRuntime): readonly string[] => runtime.registeredProviders,
    },
    BankingReadinessService,
    {
      // The registry is the sole capability source: a proposed configuration can never claim a
      // capability the adapter does not implement.
      provide: BANKING_PROVIDER_CAPABILITY_SOURCE,
      inject: [BankingProviderRegistry],
      useFactory: (registry: BankingProviderRegistry) => registry,
    },
    BankingProviderGovernanceService,
    BankingOutboundService,
    BankingInboundService,
    BankingVirtualAccountService,
    BankingReconciliationService,
    BankingCommitmentBridgeService,
    BankingFeeBindingService,
    BankingInboundInstitutionAuthority,
    PostgresWebhookAttribution,
    {
      provide: BankingWebhookService,
      inject: [BankingInboundService, ConfigService, PostgresWebhookAttribution],
      useFactory: (
        inbound: BankingInboundService,
        config: ConfigService<Environment, true>,
        attribution: PostgresWebhookAttribution,
      ): BankingWebhookService =>
        // One endpoint serves every institution: the provider key is fixed (this is Monnify's
        // endpoint) but the institution is resolved per payment from the receiving account.
        new BankingWebhookService(inbound, {
          providerKey: 'MONNIFY',
          // An absent secret makes every verification fail closed, which is the correct outcome for
          // a deployment that has not configured the webhook.
          clientSecret: config.get('BANKING_MONNIFY_CLIENT_SECRET', { infer: true }) ?? '',
          environment: config.get('BANKING_ENVIRONMENT', { infer: true }),
          resolveAttribution: (input) => attribution.resolve(input),
        }),
    },
    {
      provide: BankingWithdrawalExecutionAuthority,
      inject: [BankingReadinessService, BANKING_PROVIDER_KEYS, BANKING_RUNTIME],
      useFactory: (
        readiness: BankingReadinessService,
        keys: readonly string[],
        runtime: BankingRuntime,
      ) => new BankingWithdrawalExecutionAuthority(readiness, keys, runtime.environment),
    },
    {
      provide: BankingExternalOperationStatusVerifier,
      inject: [DataSource, BankingProviderRegistry, BankingReadinessService, BANKING_RUNTIME],
      useFactory: (
        db: DataSource,
        registry: BankingProviderRegistry,
        readiness: BankingReadinessService,
        runtime: BankingRuntime,
      ) => new BankingExternalOperationStatusVerifier(db, registry, readiness, runtime.environment),
    },
    {
      provide: BankingInboundFundingVerifier,
      inject: [DataSource, BankingProviderRegistry, BankingReadinessService, BANKING_RUNTIME],
      useFactory: (
        db: DataSource,
        registry: BankingProviderRegistry,
        readiness: BankingReadinessService,
        runtime: BankingRuntime,
      ) => new BankingInboundFundingVerifier(db, registry, readiness, runtime.environment),
    },
    {
      provide: BankingDispatchWorker,
      inject: [ConfigService, BankingOutboundService],
      useFactory: (
        config: ConfigService<Environment, true>,
        outbound: BankingOutboundService,
      ): BankingDispatchWorker =>
        new BankingDispatchWorker(outbound.dataSource, outbound, {
          enabled:
            config.get('BANKING_DISPATCH_WORKER_ENABLED', { infer: true }) ??
            (config.get('BANKING_ENABLED', { infer: true }) && process.env.NODE_ENV !== 'test'),
          pollIntervalMs: config.get('BANKING_DISPATCH_POLL_INTERVAL_MS', { infer: true }),
          leaseMs: config.get('BANKING_DISPATCH_LEASE_MS', { infer: true }),
          maxAttempts: config.get('BANKING_DISPATCH_MAX_ATTEMPTS', { infer: true }),
          intakeDisabled: config.get('BANKING_INTAKE_DISABLED', { infer: true }),
        }),
    },
  ],
  controllers: [BankingAdminController, BankingCustomerController, BankingWebhookController],
  exports: [
    BankingProviderRegistry,
    BANKING_RUNTIME,
    BANKING_PROVIDER_KEYS,
    BankingReadinessService,
    BankingProviderGovernanceService,
    BankingOutboundService,
    BankingInboundService,
    BankingVirtualAccountService,
    BankingReconciliationService,
    BankingWebhookService,
    BankingCommitmentBridgeService,
    BankingFeeBindingService,
    BankingWithdrawalExecutionAuthority,
    BankingExternalOperationStatusVerifier,
    BankingInboundFundingVerifier,
    BankingInboundInstitutionAuthority,
    BankingDispatchWorker,
  ],
})
export class BankingModule {}
