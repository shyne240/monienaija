import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audit_events' })
@Index('idx_audit_events_entity_time', ['entityType', 'entityId', 'occurredAt'])
@Index('idx_audit_events_correlation', ['correlationId', 'occurredAt'])
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 80 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ type: 'varchar', length: 80 })
  action!: string;

  @Column({ type: 'varchar', length: 160 })
  actor!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 255, nullable: true })
  requestId!: string | null;

  @Column({ name: 'previous_values', type: 'jsonb', nullable: true })
  previousValues!: Record<string, unknown> | null;

  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues!: Record<string, unknown> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
