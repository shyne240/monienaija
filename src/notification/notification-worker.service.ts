import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from './notification.constants';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDeliveryProcessor } from './notification-delivery-processor';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationProviderConfigService } from './notification-provider-config.service';
import { NotificationTemplateService } from './notification-template.service';
import type { NotificationEmailTemplateLookup, NotificationProvider } from './notification.types';

export interface NotificationWorkerTickResult {
  outboxProcessed: number;
  /** Historical field names; counts now include first PENDING sends as well as retries. */
  retriesClaimed: number;
  retriesSent: number;
  retriesFailed: number;
  retriesOptedOut: number;
  retriesSuppressed: number;
}

@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly configService: ConfigService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN) @Optional() private readonly provider: NotificationProvider | null,
    @Inject(NOTIFICATION_EMAIL_PROVIDER_TOKEN) @Optional() private readonly emailProvider: NotificationProvider | null = null,
    // Kept for constructor/DI compatibility. New deliveries store the exact rendered email
    // at materialization and never re-render a potentially different template during recovery.
    @Inject(NOTIFICATION_EMAIL_TEMPLATE_TOKEN) @Optional() _emailTemplates: NotificationEmailTemplateLookup | null = null,
    @Optional() private readonly templateService?: NotificationTemplateService,
    @Optional() private readonly providerConfigService?: NotificationProviderConfigService,
  ) { void _emailTemplates; }

  private get enabled(): boolean { return this.configService.get<boolean>('NOTIFICATION_WORKER_ENABLED') === true; }
  private get pollIntervalMs(): number { return this.configService.get<number>('NOTIFICATION_WORKER_POLL_INTERVAL_MS') ?? 5_000; }
  private get batchSize(): number { return this.configService.get<number>('NOTIFICATION_WORKER_BATCH_SIZE') ?? 10; }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Notification worker disabled');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch(() => this.logger.warn({ event: 'notification.worker_tick_failed' }));
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.logger.log('Notification worker started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<NotificationWorkerTickResult> {
    const empty: NotificationWorkerTickResult = {
      outboxProcessed: 0, retriesClaimed: 0, retriesSent: 0, retriesFailed: 0,
      retriesOptedOut: 0, retriesSuppressed: 0,
    };
    if (this.running) return empty;
    this.running = true;
    try {
      await this.providerConfigService?.refreshRuntimeCache();
      const outboxProcessed = await this.dispatcher.processPendingOutboxEvents(this.batchSize);
      const processor = new NotificationDeliveryProcessor({
        dataSource: this.dataSource,
        resolver: new NotificationChannelResolverService(this.dataSource),
        templates: this.templateService ?? new NotificationTemplateService(),
        smsProvider: this.provider,
        emailProvider: this.emailProvider,
        maxAttempts: this.configService.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? 3,
        baseDelaySeconds: this.configService.get<number>('SMS_RETRY_BASE_DELAY_SECONDS') ?? 60,
      });
      const result = await processor.processBatch(this.batchSize);
      return { outboxProcessed, retriesClaimed: result.claimed, retriesSent: result.sent,
        retriesFailed: result.failed, retriesOptedOut: result.optedOut, retriesSuppressed: result.suppressed };
    } finally {
      this.running = false;
    }
  }
}
