import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NOTIFICATION_PROVIDER_TOKEN } from './notification.constants';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDelivery } from './notification-delivery.entity';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationWorkerService } from './notification-worker.service';
import { RobaseNotificationProvider } from './robase-notification-provider';

/**
 * V1-005 Notification Delivery Foundation
 * V1-006 Customer Notification Inbox (READ, CUSTOMER SELF, paginated, safe projection, no second table)
 * SMS-V1-01 Robase production SMS: provider-neutral adapter selected via NOTIFICATION_SMS_PROVIDER
 *   ('console' default keeps dev/test provider-neutral; 'robase' requires ROBASE_API_KEY at startup
 *   — environment schema enforces this, see src/config/environment.ts).
 * SMS-V1-01 NotificationWorkerService: provider-neutral background worker (outbox drain + bounded
 *   SMS retry), enabled per environment via NOTIFICATION_WORKER_ENABLED.
 * No second outbox/event bus. Reuses OutboxService eventKey for idempotency.
 */
@Module({
  imports: [TypeOrmModule.forFeature([NotificationDelivery])],
  controllers: [NotificationInboxController],
  providers: [
    NotificationTemplateService,
    NotificationChannelResolverService,
    NotificationInboxService,
    {
      provide: NOTIFICATION_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('NOTIFICATION_SMS_PROVIDER') ?? 'console';
        if (provider === 'robase') {
          return new RobaseNotificationProvider({
            baseUrl:
              configService.get<string>('ROBASE_API_BASE_URL') ?? 'https://api.robase.dev',
            // Validated non-empty by the environment schema when provider=robase (fail-fast).
            apiKey: configService.get<string>('ROBASE_API_KEY') ?? '',
            requestTimeoutMs: configService.get<number>('ROBASE_REQUEST_TIMEOUT_MS') ?? 10_000,
          });
        }
        return new ConsoleNotificationProvider();
      },
    },
    NotificationDispatcherService,
    NotificationWorkerService,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationChannelResolverService,
    NotificationTemplateService,
    NotificationInboxService,
    NotificationWorkerService,
    NOTIFICATION_PROVIDER_TOKEN,
  ],
})
export class NotificationModule {}
