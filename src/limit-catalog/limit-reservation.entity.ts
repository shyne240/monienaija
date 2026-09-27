import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import type { ValueTransformer } from 'typeorm';

import { LimitUsage } from './limit-usage.entity';

const bigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
  from: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
};

export enum LimitReservationStatus {
  RESERVED = 'RESERVED',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
}

@Entity({ name: 'limit_reservations' })
@Index('idx_limit_reservations_idempotency', ['idempotencyKey'])
@Index('idx_limit_reservations_principal', ['principalType', 'principalId'])
@Index('idx_limit_reservations_usage', ['limitUsageId'])
@Index('idx_limit_reservations_status', ['status'])
@Index('uq_limit_reservations_idempotent', ['idempotencyKey', 'limitUsageId'], { unique: true, where: 'limit_usage_id IS NOT NULL' })
@Check('chk_limit_reservations_status', "status IN ('RESERVED','COMMITTED','RELEASED')")
@Check('chk_limit_reservations_dimension', "dimension IN ('DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')")
@Check('chk_limit_reservations_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_limit_reservations_version', 'version > 0')
export class LimitReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 160, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'principal_type', type: 'varchar', length: 20 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'limit_profile_code', type: 'varchar', length: 80 })
  limitProfileCode!: string;

  @Column({ name: 'limit_rule_id', type: 'uuid', nullable: true })
  limitRuleId!: string | null;

  @Column({ type: 'varchar', length: 80 })
  product!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  direction!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  channel!: string | null;

  @Column({ type: 'varchar', length: 40 })
  dimension!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'window_type', type: 'varchar', length: 20 })
  windowType!: string;

  @Column({ name: 'window_key', type: 'varchar', length: 80 })
  windowKey!: string;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart!: Date;

  @Column({ name: 'window_end', type: 'timestamptz' })
  windowEnd!: Date;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer, nullable: true })
  amountMinor!: string | null;

  @Column({ type: 'integer', nullable: true })
  count!: number | null;

  @Column({ type: 'varchar', length: 20 })
  status!: string; // LimitReservationStatus

  @Column({ name: 'limit_usage_id', type: 'uuid', nullable: true })
  limitUsageId!: string | null;

  @ManyToOne(() => LimitUsage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'limit_usage_id' })
  limitUsage!: LimitUsage | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'reserved_at', type: 'timestamptz', default: () => 'NOW()' })
  reservedAt!: Date;

  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt!: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;
}
