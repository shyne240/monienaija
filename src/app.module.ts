import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { FastifyRequest } from 'fastify';

import { createDatabaseOptions } from './config/database.config';
import { validateEnvironment } from './config/environment';
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
    QuoteModule,
    ReconciliationModule,
    TransferModule,
    VirtualAccountModule,
    WalletModule,
    WithdrawalModule,
  ],
})
export class AppModule {}
