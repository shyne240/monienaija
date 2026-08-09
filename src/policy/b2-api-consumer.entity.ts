/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit persistence entities.
 *
 * The four entities are the durable TypeORM records for the consumer
 * registry, credential lifecycle, quota policies, and token-bucket rate
 * limiting. Each table is the only persistence surface for its kind.
 * No table contains a raw secret column — only secretHash.
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type {
  B2ApiConsumerState,
  B2ApiConsumerType,
  B2ApiCredentialKind,
  B2ApiCredentialState,
  B2ApiQuotaGroup,
  B2ApiQuotaState,
  B2ApiRateLimitBucket,
  B2ApiRateLimitState,
  B2ApiSandboxType,
} from './b2-api-consumer.types';

@Index('uq_b2_api_consumer_reference', ['consumerReference', 'consumerVersion'], { unique: true })
@Index('idx_b2_api_consumer_type', ['consumerType'])
@Index('idx_b2_api_consumer_state', ['state'])
@Index('idx_b2_api_consumer_owner_customer', ['ownerCustomerId'])
@Index('idx_b2_api_consumer_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2_api_consumer_correlation', ['correlationId'])
@Entity('b2_api_consumer')
export class B2ApiConsumer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'consumer_reference', type: 'varchar', length: 200 })
  consumerReference!: string;

  @Column({ name: 'consumer_version', type: 'integer' })
  consumerVersion!: number;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  @Column({ name: 'consumer_type', type: 'varchar', length: 16 })
  consumerType!: B2ApiConsumerType;

  @Column({ name: 'owner_customer_id', type: 'varchar', length: 64, nullable: true })
  ownerCustomerId!: string | null;

  @Column({ name: 'owner_merchant_id', type: 'varchar', length: 64, nullable: true })
  ownerMerchantId!: string | null;

  @Column({ name: 'owner_agent_id', type: 'varchar', length: 64, nullable: true })
  ownerAgentId!: string | null;

  @Column({ name: 'audience', type: 'jsonb' })
  audience!: string[];

  @Column({ name: 'scopes', type: 'jsonb' })
  scopes!: string[];

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state!: B2ApiConsumerState;

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

@Index('uq_b2_api_credential_reference', ['credentialReference', 'credentialVersion'], {
  unique: true,
})
@Index('idx_b2_api_credential_consumer', ['consumerId'])
@Index('idx_b2_api_credential_key_id', ['keyId'])
@Index('idx_b2_api_credential_state', ['state'])
@Index('idx_b2_api_credential_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Entity('b2_api_credential')
export class B2ApiCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'credential_reference', type: 'varchar', length: 200 })
  credentialReference!: string;

  @Column({ name: 'credential_version', type: 'integer' })
  credentialVersion!: number;

  @Column({ name: 'credential_id', type: 'varchar', length: 64 })
  credentialId!: string;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'kind', type: 'varchar', length: 24 })
  kind!: B2ApiCredentialKind;

  @Column({ name: 'key_id', type: 'varchar', length: 80 })
  keyId!: string;

  @Column({ name: 'client_id', type: 'varchar', length: 80, nullable: true })
  clientId!: string | null;

  @Column({ name: 'secret_hash', type: 'varchar', length: 200 })
  secretHash!: string;

  @Column({ name: 'scopes', type: 'jsonb' })
  scopes!: string[];

  @Column({ name: 'sandbox_type', type: 'varchar', length: 16 })
  sandboxType!: B2ApiSandboxType;

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state!: B2ApiCredentialState;

  @Column({ name: 'expiry_at', type: 'timestamptz' })
  expiryAt!: Date;

  @Column({ name: 'rotation_next_key_id', type: 'varchar', length: 80, nullable: true })
  rotationNextKeyId!: string | null;

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

@Index('uq_b2_api_quota_consumer_group', ['consumerId', 'quotaGroup'], { unique: true })
@Index('idx_b2_api_quota_consumer', ['consumerId'])
@Entity('b2_api_quota')
export class B2ApiQuota {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'quota_reference', type: 'varchar', length: 200 })
  quotaReference!: string;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'quota_group', type: 'varchar', length: 32 })
  quotaGroup!: B2ApiQuotaGroup;

  @Column({ name: 'limit', type: 'integer' })
  limit!: number;

  @Column({ name: 'remaining', type: 'integer' })
  remaining!: number;

  @Column({ name: 'window', type: 'varchar', length: 32 })
  window!: string;

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state!: B2ApiQuotaState;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 80 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

@Index('uq_b2_rate_limit_bucket_consumer', ['consumerId', 'bucket'], { unique: true })
@Index('idx_b2_rate_limit_consumer', ['consumerId'])
@Entity('b2_rate_limit_bucket')
export class B2RateLimitBucket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'bucket', type: 'varchar', length: 64 })
  bucket!: B2ApiRateLimitBucket;

  @Column({ name: 'consumer_id', type: 'varchar', length: 64 })
  consumerId!: string;

  @Column({ name: 'capacity', type: 'integer' })
  capacity!: number;

  @Column({ name: 'remaining', type: 'integer' })
  remaining!: number;

  @Column({ name: 'refill_per_second', type: 'numeric' })
  refillPerSecond!: number;

  @Column({ name: 'strategy', type: 'varchar', length: 16 })
  strategy!: string;

  @Column({ name: 'state', type: 'varchar', length: 16 })
  state!: B2ApiRateLimitState;

  @Column({ name: 'retry_after_seconds', type: 'integer', nullable: true })
  retryAfterSeconds!: number | null;

  @Column({ name: 'last_refill_at', type: 'timestamptz', default: () => 'now()' })
  lastRefillAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
