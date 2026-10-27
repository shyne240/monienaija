import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from './notification.constants';
import { ConsoleEmailProvider, NoneEmailProvider } from './email-provider.interface';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDelivery } from './notification-delivery.entity';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { CodeNotificationEmailTemplateService } from './notification-email-template.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationWorkerService } from './notification-worker.service';
import { ResendEmailProvider } from './resend-email-provider';
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
    // ARENA3-NOTIFICATION-EMAIL — EMAIL channel providers + template seam.
    // NOTIFICATION_EMAIL_PROVIDER: 'none' (default, email dark — dispatcher generates no
    // EMAIL intents, worker fails closed) | 'console' (dev/test only — rejected in
    // production by the environment schema) | 'resend' (production adapter; requires
    // RESEND_API_KEY + NOTIFICATION_EMAIL_FROM, enforced fail-fast by the schema).
    {
      provide: NOTIFICATION_EMAIL_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('NOTIFICATION_EMAIL_PROVIDER') ?? 'none';
        if (provider === 'resend') {
          return new ResendEmailProvider({
            baseUrl: configService.get<string>('RESEND_API_BASE_URL') ?? 'https://api.resend.com',
            // Validated non-empty + re_ prefix by the environment schema (fail-fast).
            apiKey: configService.get<string>('RESEND_API_KEY') ?? '',
            from: configService.get<string>('NOTIFICATION_EMAIL_FROM') ?? '',
            replyTo: configService.get<string>('NOTIFICATION_EMAIL_REPLY_TO') ?? null,
            requestTimeoutMs: configService.get<number>('RESEND_REQUEST_TIMEOUT_MS') ?? 10_000,
          });
        }
        if (provider === 'console') {
          return new ConsoleEmailProvider();
        }
        return new NoneEmailProvider();
      },
    },
    CodeNotificationEmailTemplateService,
    {
      // Template seam binding — Arena 1's future database-backed registry replaces this
      // binding WITHOUT dispatcher/worker changes (documented coordination contract).
      provide: NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
      useExisting: CodeNotificationEmailTemplateService,
    },
  ],
  exports: [
    NotificationDispatcherService,
    NotificationChannelResolverService,
    NotificationTemplateService,
    NotificationInboxService,
    NotificationWorkerService,
    NOTIFICATION_PROVIDER_TOKEN,
    NOTIFICATION_EMAIL_PROVIDER_TOKEN,
    NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  ],
})
export class NotificationModule {}
