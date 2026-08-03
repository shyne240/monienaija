import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { createDatabaseOptions } from './config/database.config';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
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
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-api-key',
            'res.headers.set-cookie',
          ],
          censor: '[REDACTED]',
        },
        customProps: (request) => ({ requestId: request.id }),
      },
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => createDatabaseOptions(validateEnvironment(process.env)),
    }),
    HealthModule,
    LedgerModule,
    WalletModule,
  ],
})
export class AppModule {}
