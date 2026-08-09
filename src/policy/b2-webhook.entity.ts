/**
 * B2T09 — B2 webhook authority persistence entities.
 *
 * The two entities are the durable TypeORM records for webhook
 * registrations and webhook deliveries. Each table is the only
 * persistence surface for its kind. The registration table never stores
 * a raw secret — only secretHash and challengeNonce. The delivery table
 * stores the HMAC signature, timestamp, Delivery-Id, attempt, and
 * exponential backoff state.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2WebhookDeliveryState,
  B2WebhookEventType,
  B2WebhookRegistrationState,
} from './b2-webhook.types';

@Index('uq_b2_webhook_registration_reference', ['registrationReference', 'registrationVersion'], {
  unique: true,
})
@Index('idx_b2_webhook_registration_consumer', ['consumerId'])
@Index('idx_b2_webhook_registration_state', ['state'])
@Index('idx_b2_webhook_registration_cohort', ['cohortKey', 'cohortVersion'])
@Index('idx_b2_webhook_registration_request_hash', ['requestHash'])
@Index('idx_b2_webhook_registration_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_webhook_registration_correlation', ['correlationId'])
@Entity('b2_webhook_registration')
export class B2WebhookRegistration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'registration_reference', type: 'varchar', length: 200 })
  registrationReference!: string;

  @Column({ name: 'registration_version', type: 'integer' })
  registrationVersion!: number;

  @Column({ name: 'registration_id', type: 'varchar', length: 64 })
  registrationId!: string;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'url', type: 'varchar', length: 500 })
  url!: string;

  @Column({ name: 'events', type: 'jsonb' })
  events!: B2WebhookEventType[];

  @Column({ name: 'hmac_algorithm', type: 'varchar', length: 20 })
  hmacAlgorithm!: string;

  @Column({ name: 'secret_hash', type: 'varchar', length: 200 })
  secretHash!: string;

  @Column({ name: 'challenge_nonce', type: 'varchar', length: 80 })
  challengeNonce!: string;

  @Column({ name: 'state', type: 'varchar', length: 24 })
  state!: B2WebhookRegistrationState;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

@Index('uq_b2_webhook_delivery_reference', ['deliveryReference', 'deliveryVersion'], {
  unique: true,
})
@Index('idx_b2_webhook_delivery_registration', ['registrationId'])
@Index('idx_b2_webhook_delivery_state', ['state'])
@Index('idx_b2_webhook_delivery_event', ['event'])
@Index('idx_b2_webhook_delivery_delivery_id', ['deliveryId'])
@Index('idx_b2_webhook_delivery_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_webhook_delivery_correlation', ['correlationId'])
@Entity('b2_webhook_delivery')
export class B2WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'delivery_reference', type: 'varchar', length: 200 })
  deliveryReference!: string;

  @Column({ name: 'delivery_version', type: 'integer' })
  deliveryVersion!: number;

  @Column({ name: 'delivery_id', type: 'varchar', length: 64 })
  deliveryId!: string;

  @Column({ name: 'registration_id', type: 'varchar', length: 64 })
  registrationId!: string;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'event', type: 'varchar', length: 40 })
  event!: B2WebhookEventType;

  @Column({ name: 'url', type: 'varchar', length: 500 })
  url!: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ name: 'signature', type: 'varchar', length: 200 })
  signature!: string;

  @Column({ name: 'timestamp', type: 'bigint' })
  timestamp!: number;

  @Column({ name: 'attempt', type: 'integer' })
  attempt!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'state', type: 'varchar', length: 24 })
  state!: B2WebhookDeliveryState;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'cohort_key', type: 'varchar', length: 200 })
  cohortKey!: string;

  @Column({ name: 'cohort_version', type: 'integer' })
  cohortVersion!: number;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ name: 'decision_hash', type: 'varchar', length: 64 })
  decisionHash!: string;

  @Column({ name: 'decision_replay_hash', type: 'varchar', length: 64 })
  decisionReplayHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'record', type: 'jsonb' })
  record!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
