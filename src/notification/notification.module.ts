import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NOTIFICATION_PROVIDER_TOKEN } from './notification.constants';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDelivery } from './notification-delivery.entity';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationTemplateService } from './notification-template.service';

/**
 * V1-005 Notification Delivery Foundation
 * Provider-neutral dispatch: Financial/Support EVENT → Existing Outbox → Dispatcher → Push/SMS Provider Adapter
 * No second outbox/event bus. Reuses OutboxService eventKey for idempotency.
 * Console/Test adapter verified; external SMS/Push pending.
 */
@Module({
  imports: [TypeOrmModule.forFeature([NotificationDelivery])],
  providers: [
    NotificationTemplateService,
    NotificationChannelResolverService,
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
    NOTIFICATION_PROVIDER_TOKEN,
  ],
})
export class NotificationModule {}

// Alternative simple provider registration for tests that want Test provider:
// Test harness can override NOTIFICATION_PROVIDER_TOKEN with TestNotificationProvider.
