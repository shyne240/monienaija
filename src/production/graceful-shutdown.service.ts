import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RequestTrackerService } from './request-tracker.service';

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);

  constructor(
    private readonly tracker: RequestTrackerService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.tracker.beginDrain();
    const timeoutMs =
      (this.configService.get<number>('SHUTDOWN_DRAIN_TIMEOUT_SECONDS') ?? 30) * 1000;
    const drained = await this.tracker.waitForDrain(timeoutMs);
    this.logger.log(
      { signal, drained, activeRequests: this.tracker.activeCount() },
      'Application drain complete',
    );
  }
}
