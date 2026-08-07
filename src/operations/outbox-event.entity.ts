import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { OutboxEventStatus } from './operations.enums';

@Entity({ name: 'outbox_events' })
@Index('idx_outbox_events_pending', ['status', 'availableAt', 'createdAt'])
@Index('idx_outbox_events_aggregate', ['aggregateType', 'aggregateId', 'createdAt'])
@Index('uq_outbox_events_event_key', ['eventKey'], {
  unique: true,
  where: 'event_key IS NOT NULL',
})
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 80 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'event_key', type: 'varchar', length: 180, nullable: true })
  eventKey!: string | null;

  @Column({ name: 'schema_version', type: 'integer', default: 1 })
  schemaVersion!: number;

  @Column({ type: 'varchar', length: 80, default: 'INTERNAL_OPERATIONS' })
  classification!: string;

  @Column({ name: 'retention_class', type: 'varchar', length: 80, default: 'OPERATIONS_DEFAULT' })
  retentionClass!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'NOW()' })
  occurredAt!: Date;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true })
  causationId!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20 })
  status!: OutboxEventStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @Column({ name: 'last_error', type: 'varchar', length: 255, nullable: true })
  lastError!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
