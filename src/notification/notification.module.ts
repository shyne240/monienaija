import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NOTIFICATION_PROVIDER_TOKEN } from './notification.constants';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDelivery } from './notification-delivery.entity';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationTemplateService } from './notification-template.service';

/**
 * V1-005 Notification Delivery Foundation
 * V1-006 Customer Notification Inbox (READ, CUSTOMER SELF, paginated, safe projection, no second table)
 * Provider-neutral dispatch: Financial/Support EVENT → Existing Outbox → Dispatcher → Push/SMS Provider Adapter
 * No second outbox/event bus. Reuses OutboxService eventKey for idempotency.
 * Console/Test adapter verified; external SMS/Push pending.
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
      useFactory: () => new ConsoleNotificationProvider(),
    },
    NotificationDispatcherService,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationChannelResolverService,
    NotificationTemplateService,
    NotificationInboxService,
    NOTIFICATION_PROVIDER_TOKEN,
  ],
})
export class NotificationModule {}

// Alternative simple provider registration for tests that want Test provider:
// Test harness can override NOTIFICATION_PROVIDER_TOKEN with TestNotificationProvider.
