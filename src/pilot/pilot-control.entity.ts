import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';

@Entity({ name: 'pilot_controls' })
@Index('uq_pilot_controls_control_key', ['controlKey'], { unique: true })
@Check('chk_pilot_controls_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_pilot_controls_min_amount', 'min_transaction_amount_minor > 0')
@Check(
  'chk_pilot_controls_amount_range',
  'max_transaction_amount_minor >= min_transaction_amount_minor',
)
@Check(
  'chk_pilot_controls_daily_count',
  'daily_transaction_count_limit IS NULL OR daily_transaction_count_limit > 0',
)
@Check(
  'chk_pilot_controls_daily_amount',
  'daily_transaction_amount_minor IS NULL OR daily_transaction_amount_minor > 0',
)
export class PilotControl {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'control_key', type: 'varchar', length: 160 })
  controlKey!: string;

  @Column({ type: 'varchar', length: 128 })
  capability!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 80 })
  scope!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'cohort_customer_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  cohortCustomerIds!: string[];

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({
    name: 'min_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  minTransactionAmountMinor!: string;

  @Column({
    name: 'max_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  maxTransactionAmountMinor!: string;

  @Column({ name: 'daily_transaction_count_limit', type: 'integer', nullable: true })
  dailyTransactionCountLimit!: number | null;

  @Column({
    name: 'daily_transaction_amount_minor',
    type: 'bigint',
    transformer: bigintTransformer,
    nullable: true,
  })
  dailyTransactionAmountMinor!: string | null;

  @Column({ name: 'safety_thresholds', type: 'jsonb', default: () => "'{}'::jsonb" })
  safetyThresholds!: Record<string, unknown>;

  @Column({ name: 'updated_by', type: 'varchar', length: 160 })
  updatedBy!: string;

  @Column({ name: 'last_correlation_id', type: 'varchar', length: 255, nullable: true })
  lastCorrelationId!: string | null;

  @Column({ name: 'last_request_id', type: 'varchar', length: 255, nullable: true })
  lastRequestId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;
}
