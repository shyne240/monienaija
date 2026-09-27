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

import { LimitProfile } from './limit-profile.entity';
import { LimitRule } from './limit-rule.entity';

const bigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
  from: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
};

@Entity({ name: 'limit_usages' })
@Index('idx_limit_usages_principal', ['principalType', 'principalId'])
@Index('idx_limit_usages_window_key', ['windowKey'])
@Index('idx_limit_usages_window_start', ['windowStart'])
@Index('idx_limit_usages_profile_product', ['limitProfileCode', 'product'])
@Index('uq_limit_usages_window', ['principalType', 'principalId', 'limitProfileCode', 'product', 'direction', 'channel', 'dimension', 'currency', 'windowKey'], {
  unique: true,
})
@Check('chk_limit_usages_window_type', "window_type IN ('DAILY','WEEKLY','MONTHLY','YEARLY')")
@Check('chk_limit_usages_dimension', "dimension IN ('DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')")
@Check('chk_limit_usages_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_limit_usages_window', 'window_end > window_start')
@Check('chk_limit_usages_used_amount', 'used_amount_minor >= 0')
@Check('chk_limit_usages_used_count', 'used_count >= 0')
@Check('chk_limit_usages_reserved_amount', 'reserved_amount_minor >= 0')
@Check('chk_limit_usages_reserved_count', 'reserved_count >= 0')
@Check('chk_limit_usages_version', 'version > 0')
export class LimitUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 20 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'limit_profile_code', type: 'varchar', length: 80 })
  limitProfileCode!: string;

  @ManyToOne(() => LimitProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'limit_profile_code', referencedColumnName: 'code' })
  limitProfile!: LimitProfile;

  @Column({ name: 'limit_rule_id', type: 'uuid', nullable: true })
  limitRuleId!: string | null;

  @ManyToOne(() => LimitRule, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'limit_rule_id' })
  limitRule!: LimitRule | null;

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

  @Column({ name: 'used_amount_minor', type: 'bigint', transformer: bigintTransformer, default: '0' })
  usedAmountMinor!: string;

  @Column({ name: 'used_count', type: 'integer', default: 0 })
  usedCount!: number;

  @Column({ name: 'reserved_amount_minor', type: 'bigint', transformer: bigintTransformer, default: '0' })
  reservedAmountMinor!: string;

  @Column({ name: 'reserved_count', type: 'integer', default: 0 })
  reservedCount!: number;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
