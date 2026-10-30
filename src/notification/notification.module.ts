import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthorizationModule } from '../authorization/authorization.module';
import { OperationsModule } from '../operations/operations.module';
import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from './notification.constants';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDelivery } from './notification-delivery.entity';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { CodeNotificationEmailTemplateService } from './notification-email-template.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationProviderConfigController } from './notification-provider-config.controller';
import {
  ConfigurableEmailNotificationProvider,
  ConfigurableSmsNotificationProvider,
  NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN,
  NotificationProviderConfigService,
} from './notification-provider-config.service';
import { NotificationRegistryController } from './notification-registry.controller';
import { NotificationRegistryService } from './notification-registry.service';
import { NotificationSecretEncryptionService } from './notification-secret-encryption.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationWorkerService } from './notification-worker.service';
import { NormalizingSmsNotificationProvider } from './normalizing-sms-notification-provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationDelivery]),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => OperationsModule),
  ],
  controllers: [
    NotificationInboxController,
    NotificationRegistryController,
    NotificationProviderConfigController,
  ],
  providers: [
    {
      provide: NOTIFICATION_PROVIDER_HTTP_FETCH_TOKEN,
      useValue: undefined,
    },
    NotificationSecretEncryptionService,
    NotificationProviderConfigService,
    ConfigurableSmsNotificationProvider,
    NormalizingSmsNotificationProvider,
    ConfigurableEmailNotificationProvider,
    {
      provide: NOTIFICATION_PROVIDER_TOKEN,
      useExisting: NormalizingSmsNotificationProvider,
    },
    {
      provide: NOTIFICATION_EMAIL_PROVIDER_TOKEN,
      useExisting: ConfigurableEmailNotificationProvider,
    },
    CodeNotificationEmailTemplateService,
    {
      provide: NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
      useExisting: CodeNotificationEmailTemplateService,
    },
    NotificationChannelResolverService,
    NotificationTemplateService,
    NotificationDispatcherService,
    NotificationInboxService,
    NotificationWorkerService,
    NotificationRegistryService,
  ],
  exports: [
    NotificationChannelResolverService,
    NotificationTemplateService,
    NotificationDispatcherService,
    NotificationInboxService,
    NotificationWorkerService,
    NotificationRegistryService,
    NotificationSecretEncryptionService,
    NotificationProviderConfigService,
    NOTIFICATION_PROVIDER_TOKEN,
    NOTIFICATION_EMAIL_PROVIDER_TOKEN,
    NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  ],
})
export class NotificationModule {}
