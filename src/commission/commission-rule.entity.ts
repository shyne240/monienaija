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
 * V1-COMMISSION-01 — commission rule DEFINITION (registry row), not an allocation.
 *
 * Mirrors the FeeRule conventions (V1-COMMERCIAL-03): bps over BASIS_POINTS 10000,
 * *Minor integer minor units, effective window + priority + optimistic versioning +
 * audited workforce administration. Historical explainability: version + audit trail +
 * the Commercial Decision Snapshot practice of capturing ruleId + ruleVersion +
 * effective parameters (commissionDecision.allocations entries already carry
 * ruleId/ruleVersion/basis — snapshot schema untouched).
 *
 * Commission is a distinct commercial concept from customer fee, platform revenue,
 * reward/cashback and principal; this registry deliberately knows NOTHING about how
 * much fee was charged or how much revenue the platform retains — each rule only
 * describes one recipient's commission mechanics.
 */

export type CommissionRecipientType = 'AGENT' | 'AGGREGATOR' | 'PLATFORM';
export type CommissionCalculationBasis = 'PRINCIPAL' | 'FEE' | 'NET';
export type CommissionCalculationModel =
  | 'FIXED'
  | 'PERCENTAGE'
  | 'PERCENTAGE_MIN'
  | 'PERCENTAGE_MAX'
  | 'PERCENTAGE_MIN_MAX'
  | 'FLAT_PLUS_PERCENTAGE'
  | 'TIERED';

export const COMMISSION_RECIPIENT_TYPES: readonly CommissionRecipientType[] = ['AGENT', 'AGGREGATOR', 'PLATFORM'];
export const COMMISSION_CALCULATION_BASES: readonly CommissionCalculationBasis[] = ['PRINCIPAL', 'FEE', 'NET'];
export const COMMISSION_CALCULATION_MODELS: readonly CommissionCalculationModel[] = [
  'FIXED',
  'PERCENTAGE',
  'PERCENTAGE_MIN',
  'PERCENTAGE_MAX',
  'PERCENTAGE_MIN_MAX',
  'FLAT_PLUS_PERCENTAGE',
  'TIERED',
];

/**
 * One marginal bracket of a TIERED rule:
 *  - upToMinor: exclusive upper bound of the bracket in minor units (string);
 *    null on the LAST bracket = open-ended.
 *  - bps / flatMinor: applied MARGINALLY to the slice of the base inside this bracket
 *    (bps of the slice, plus flatMinor once IF the base reaches the bracket at all).
 *    At least one of bps/flatMinor must be present per bracket.
 */
export interface CommissionTier {
  upToMinor: string | null;
  bps?: number | null;
  flatMinor?: string | null;
}

const nullableBigintTransformer: ValueTransformer = {
  to: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
  from: (value: string | number | bigint | null | undefined): string | null =>
    value === null || value === undefined ? null : value.toString(),
};

@Entity({ name: 'commission_rules' })
@Index('idx_commission_rules_product', ['productCode'])
@Index('idx_commission_rules_active', ['isActive'])
@Index('idx_commission_rules_effective_from', ['effectiveFrom'])
@Check('chk_commission_rules_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_commission_rules_recipient', "recipient_type IN ('AGENT','AGGREGATOR','PLATFORM')")
@Check('chk_commission_rules_min_max', 'minimum_commission_minor IS NULL OR maximum_commission_minor IS NULL OR minimum_commission_minor <= maximum_commission_minor')
@Check('chk_commission_rules_effective', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_commission_rules_version', 'version > 0')
export class CommissionRuleDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 80 })
  productCode!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'recipient_type', type: 'varchar', length: 20 })
  recipientType!: CommissionRecipientType;

  @Column({ name: 'calculation_model', type: 'varchar', length: 24 })
  calculationModel!: CommissionCalculationModel;

  @Column({ name: 'calculation_basis', type: 'varchar', length: 20 })
  calculationBasis!: CommissionCalculationBasis;

  @Column({ name: 'flat_commission_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  flatCommissionMinor!: string | null;

  @Column({ name: 'percentage_bps', type: 'integer', nullable: true })
  percentageBps!: number | null;

  @Column({ name: 'minimum_commission_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  minimumCommissionMinor!: string | null;

  @Column({ name: 'maximum_commission_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  maximumCommissionMinor!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  tiers!: CommissionTier[] | null;

  /** Single-dimensional targeting: at most one of these is non-null (DB CHECK). */
  @Column({ name: 'agent_class_id', type: 'uuid', nullable: true })
  agentClassId!: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'aggregator_id', type: 'uuid', nullable: true })
  aggregatorId!: string | null;

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
