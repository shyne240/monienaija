import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import type { ValueTransformer } from 'typeorm';

/**
 * V1-COMMERCIAL-03 — fee rule DEFINITION (registry row), not a charge.
 *
 * Terminology mirrors the authoritative FeeRule contract (src/fee/fee.types.ts):
 * flatFeeMinor / percentageBps / minimumFeeMinor / maximumFeeMinor / vatBps.
 * Associated with the canonical product identity via `product_code → products.code`.
 *
 * Rows are managed with optimistic-locking version bumps (repository convention); administrative
 * changes are audited. Historical explainability comes from version + audit trail plus the
 * Commercial Decision Snapshot practice of capturing ruleId + ruleVersion + effective values.
 */

const nullableBigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
  from: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
};

@Entity({ name: 'fee_rules' })
@Index('idx_fee_rules_product', ['productCode'])
@Index('idx_fee_rules_currency', ['currency'])
@Index('idx_fee_rules_active', ['isActive'])
@Index('idx_fee_rules_effective_from', ['effectiveFrom'])
@Index('uq_fee_rules_identity', ['productCode', 'currency', 'effectiveFrom'], { unique: true, where: 'deleted_at IS NULL' })
@Check('chk_fee_rules_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_fee_rules_flat', 'flat_fee_minor IS NULL OR flat_fee_minor >= 0')
@Check('chk_fee_rules_percentage', 'percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000)')
@Check('chk_fee_rules_minimum', 'minimum_fee_minor IS NULL OR minimum_fee_minor >= 0')
@Check('chk_fee_rules_maximum', 'maximum_fee_minor IS NULL OR maximum_fee_minor >= 0')
@Check('chk_fee_rules_vat', 'vat_bps IS NULL OR (vat_bps >= 0 AND vat_bps <= 10000)')
@Check('chk_fee_rules_effective', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_fee_rules_version', 'version > 0')
@Check('chk_fee_rules_params', 'flat_fee_minor IS NOT NULL OR percentage_bps IS NOT NULL')
@Check('chk_fee_rules_min_max', 'minimum_fee_minor IS NULL OR maximum_fee_minor IS NULL OR minimum_fee_minor <= maximum_fee_minor')
export class FeeRuleDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 80 })
  productCode!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'flat_fee_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  flatFeeMinor!: string | null;

  @Column({ name: 'percentage_bps', type: 'integer', nullable: true })
  percentageBps!: number | null;

  @Column({ name: 'minimum_fee_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  minimumFeeMinor!: string | null;

  @Column({ name: 'maximum_fee_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  maximumFeeMinor!: string | null;

  @Column({ name: 'vat_bps', type: 'integer', nullable: true })
  vatBps!: number | null;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 160, nullable: true })
  updatedBy!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
