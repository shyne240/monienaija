/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit NestJS module.
 *
 * The B2 API consumer module wires the consumer, credential, quota, and
 * rate-limit service to the shared IdempotencyService, AuditService,
 * OutboxService, and MetricsService through OperationsModule and to the
 * TypeORM persistence for the four tables. It does not create a second
 * authentication vault, a second authorization vault, or a second
 * consumer/credential vault.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import {
  B2ApiConsumer,
  B2ApiCredential,
  B2ApiQuota,
  B2RateLimitBucket,
} from './b2-api-consumer.entity';
import { B2ApiConsumerRepository } from './b2-api-consumer.repository';
import { B2ApiConsumerService } from './b2-api-consumer.service';

export const B2_API_CONSUMER_PROVIDERS: readonly Provider[] = Object.freeze([
  B2ApiConsumerRepository,
  B2ApiConsumerService,
]);

@Module({
  imports: [
    OperationsModule,
    TypeOrmModule.forFeature([B2ApiConsumer, B2ApiCredential, B2ApiQuota, B2RateLimitBucket]),
  ],
  providers: B2_API_CONSUMER_PROVIDERS as Provider[],
  exports: [B2ApiConsumerService, B2ApiConsumerRepository],
})
export class B2ApiConsumerModule {}
