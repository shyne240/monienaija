/**
 * B2T09 — B2 webhook authority NestJS module.
 *
 * The B2 webhook module wires the webhook service to the shared
 * IdempotencyService, AuditService, OutboxService, and MetricsService
 * through OperationsModule and to the TypeORM persistence for the two
 * webhook tables. It does not create a second webhook authority, a
 * second consumer table, or a second delivery scheduler.
 */

import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OperationsModule } from '../operations/operations.module';

import { B2WebhookDelivery, B2WebhookRegistration } from './b2-webhook.entity';
import { B2WebhookRepository } from './b2-webhook.repository';
import { B2WebhookService } from './b2-webhook.service';

export const B2_WEBHOOK_PROVIDERS: readonly Provider[] = Object.freeze([
  B2WebhookRepository,
  B2WebhookService,
]);

@Module({
  imports: [OperationsModule, TypeOrmModule.forFeature([B2WebhookRegistration, B2WebhookDelivery])],
  providers: B2_WEBHOOK_PROVIDERS as Provider[],
  exports: [B2WebhookService, B2WebhookRepository],
})
export class B2WebhookModule {}
