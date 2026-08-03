import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProductionConfigurationService {
  constructor(private readonly configService: ConfigService) {}

  getSafeConfiguration() {
    return {
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      version: this.configService.get<string>('APP_VERSION') ?? '0.1.0',
      apiVersion: this.configService.get<string>('API_VERSION') ?? 'v1',
      port: this.configService.get<number>('PORT') ?? 3000,
      logLevel: this.configService.get<string>('LOG_LEVEL') ?? 'info',
      databaseSsl: this.configService.get<boolean>('DB_SSL') ?? false,
      idempotencyRetentionSeconds:
        this.configService.get<number>('IDEMPOTENCY_RETENTION_SECONDS') ?? 86_400,
      outboxRetryDelaySeconds: this.configService.get<number>('OUTBOX_RETRY_DELAY_SECONDS') ?? 60,
      shutdownDrainTimeoutSeconds:
        this.configService.get<number>('SHUTDOWN_DRAIN_TIMEOUT_SECONDS') ?? 30,
    };
  }
}
