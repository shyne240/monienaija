import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { OutboxEventStatus } from './operations.enums';

@Entity({ name: 'outbox_events' })
@Index('idx_outbox_events_pending', ['status', 'availableAt', 'createdAt'])
@Index('idx_outbox_events_aggregate', ['aggregateType', 'aggregateId', 'createdAt'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 80 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

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
