import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import type { ValueTransformer } from 'typeorm';

import { LimitDirection, LimitDimension } from './limit-catalog.enums';
import { LimitProfile } from './limit-profile.entity';

const nullableBigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
  from: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
};

@Entity({ name: 'limit_rules' })
@Index('idx_limit_rules_profile', ['limitProfileCode'])
@Index('idx_limit_rules_profile_product', ['limitProfileCode', 'product'])
@Index('idx_limit_rules_dimension', ['dimension'])
@Index('idx_limit_rules_effective', ['effectiveFrom', 'effectiveTo'])
@Index('uq_limit_rules_active_key', ['limitProfileCode', 'product', 'direction', 'channel', 'currency', 'dimension', 'effectiveFrom'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Check('chk_limit_rules_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_limit_rules_product', "product ~ '^[A-Z0-9_][A-Z0-9_.-]{1,79}$'")
@Check('chk_limit_rules_direction', "direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')")
@Check('chk_limit_rules_dimension', "dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT','WALLET_BALANCE_MAX')")
@Check('chk_limit_rules_version', 'version > 0')
@Check('chk_limit_rules_effective', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_limit_rules_amount_count_exclusive', `
  (
    dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX')
    AND limit_value_minor IS NOT NULL AND limit_value_minor >= 0 AND limit_value_count IS NULL
  )
  OR
  (
    dimension IN ('DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
    AND limit_value_count IS NOT NULL AND limit_value_count >= 0 AND limit_value_minor IS NULL
  )
`)
@Check('chk_limit_rules_min_not_fee', "dimension <> 'MIN_AMOUNT_PER_TX' OR limit_value_minor >= 0")
export class LimitRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'limit_profile_code', type: 'varchar', length: 80 })
  limitProfileCode!: string;

  @ManyToOne(() => LimitProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'limit_profile_code', referencedColumnName: 'code' })
  limitProfile!: LimitProfile;

  @Column({ type: 'varchar', length: 80 })
  product!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  direction!: string | null; // LimitDirection

  @Column({ type: 'varchar', length: 30, nullable: true })
  channel!: string | null;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 40 })
  dimension!: string; // LimitDimension

  @Column({ name: 'limit_value_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  limitValueMinor!: string | null;

  @Column({ name: 'limit_value_count', type: 'integer', nullable: true })
  limitValueCount!: number | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160, nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
