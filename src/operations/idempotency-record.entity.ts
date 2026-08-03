import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { IdempotencyRecordStatus } from './operations.enums';

@Entity({ name: 'idempotency_records' })
@Index('uq_idempotency_records_scope_key', ['scope', 'idempotencyKey'], { unique: true })
@Index('idx_idempotency_records_expires', ['expiresAt'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  scope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: IdempotencyRecordStatus;

  @Column({ name: 'response_status_code', type: 'smallint', nullable: true })
  responseStatusCode!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 80, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'hit_count', type: 'integer', default: 0 })
  hitCount!: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
