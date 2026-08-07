import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { FastifyRequest } from 'fastify';

import { AuthorizationModule } from './authorization/authorization.module';
import { RuntimeAccessGuard } from './authorization/runtime-access.guard';
import { createDatabaseOptions } from './config/database.config';
import { validateEnvironment } from './config/environment';
import { CustomerModule } from './customer/customer.module';
import { CustomerAuthenticationModule } from './customer-authentication/customer-authentication.module';
import { CustomerBeneficiaryModule } from './customer-beneficiary/customer-beneficiary.module';
import { CustomerComplianceModule } from './customer-compliance/customer-compliance.module';
import { CustomerEligibilityModule } from './customer-eligibility/customer-eligibility.module';
import { CustomerFundingInstrumentModule } from './customer-funding-instrument/customer-funding-instrument.module';
import { CustomerPreferenceModule } from './customer-preference/customer-preference.module';
import { CustomerRiskProfileModule } from './customer-risk-profile/customer-risk-profile.module';
import { CustomerWalletModule } from './customer-wallet/customer-wallet.module';
import { CustomerOnboardingModule } from './customer-onboarding/customer-onboarding.module';
import { CapabilityPolicyModule } from './policy/capability-policy.module';
import { getRequestContext } from './production/request-context';
import { BankModule } from './bank/bank.module';
import { BeneficiaryModule } from './beneficiary/beneficiary.module';
import { FeeModule } from './fee/fee.module';
import { HealthModule } from './health/health.module';
import { DepositModule } from './deposit/deposit.module';
import { LedgerModule } from './ledger/ledger.module';
import { LimitModule } from './limit/limit.module';
import { MaturityModule } from './maturity/maturity.module';
import { OperationsModule } from './operations/operations.module';
import { PaymentModule } from './payment/payment.module';
import { ProductionModule } from './production/production.module';
import { ProductGovernanceModule } from './product-governance/product-governance.module';
import { QuoteModule } from './quote/quote.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransferModule } from './transfer/transfer.module';
import { VirtualAccountModule } from './virtual-account/virtual-account.module';
import { WithdrawalModule } from './withdrawal/withdrawal.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (request) => getRequestContext(request as unknown as FastifyRequest).requestId,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-api-key',
            'req.body.password',
            'req.body.passwordHash',
            'req.body.token',
            'req.body.tokenHash',
            'req.body.accessToken',
            'req.body.refreshToken',
            'req.body.secret',
            'req.body.code',
            'req.body.codeHash',
            'req.body.challengeHash',
            'req.body.providedHash',
            'req.body.deviceFingerprintHash',
            'req.body.fingerprintHash',
            'res.headers.set-cookie',
          ],
          censor: '[REDACTED]',
        },
        customProps: (request) => getRequestContext(request as unknown as FastifyRequest),
      },
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => createDatabaseOptions(validateEnvironment(process.env)),
    }),
    HealthModule,
    AuthorizationModule,
    CustomerModule,
    CustomerAuthenticationModule,
    CustomerBeneficiaryModule,
    CustomerComplianceModule,
    CustomerOnboardingModule,
    CapabilityPolicyModule,
    CustomerEligibilityModule,
    CustomerWalletModule,
    CustomerFundingInstrumentModule,
    CustomerPreferenceModule,
    CustomerRiskProfileModule,
    BankModule,
    BeneficiaryModule,
    DepositModule,
    FeeModule,
    LedgerModule,
    LimitModule,
    MaturityModule,
    OperationsModule,
    PaymentModule,
    ProductionModule,
    ProductGovernanceModule,
    QuoteModule,
    ReconciliationModule,
    TransferModule,
    VirtualAccountModule,
    WalletModule,
    WithdrawalModule,
  ],
  providers: [{ provide: APP_GUARD, useExisting: RuntimeAccessGuard }],
})
export class AppModule {}
