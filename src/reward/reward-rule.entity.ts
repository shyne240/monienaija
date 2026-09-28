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
 * V1-REWARD-01 — reward rule DEFINITION (registry row), not a grant.
 *
 * Mirrors the CommissionRule conventions (V1-COMMISSION-01) which mirror the FeeRule
 * conventions (V1-COMMERCIAL-03): bps over BASIS_POINTS 10000, *Minor integer minor
 * units, effective window + priority + optimistic versioning + audited workforce
 * administration. Historical explainability: version + audit trail + the Commercial
 * Decision Snapshot practice of capturing ruleId + ruleVersion + effective parameters
 * (rewardDecision.grants entries already carry ruleId/ruleVersion/basis/rewardType —
 * snapshot schema untouched).
 *
 * Reward/cashback is a distinct commercial concept from principal, customer fee,
 * platform revenue and agent/aggregator commission; it is NOT a negative fee, NOT a
 * fake commission and NOT a fee discount. This registry deliberately knows NOTHING
 * about how much fee was charged or how much commission any recipient earned — each
 * rule only describes one beneficiary group's reward mechanics.
 */

export type RewardBeneficiaryType = 'CUSTOMER' | 'AGENT';
export type RewardGrantType = 'CASHBACK' | 'BONUS' | 'PROMOTION';
export type RewardCalculationBasis = 'PRINCIPAL' | 'FEE' | 'NET';
export type RewardCalculationModel =
  | 'FIXED'
  | 'PERCENTAGE'
  | 'PERCENTAGE_MIN'
  | 'PERCENTAGE_MAX'
  | 'PERCENTAGE_MIN_MAX'
  | 'FLAT_PLUS_PERCENTAGE'
  | 'TIERED';
/** The EXISTING authoritative CustomerKycLevel enum values (src/customer/customer.enums.ts). */
export type RewardCustomerKycLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';

export const REWARD_BENEFICIARY_TYPES: readonly RewardBeneficiaryType[] = ['CUSTOMER', 'AGENT'];
export const REWARD_GRANT_TYPES: readonly RewardGrantType[] = ['CASHBACK', 'BONUS', 'PROMOTION'];
export const REWARD_CALCULATION_BASES: readonly RewardCalculationBasis[] = ['PRINCIPAL', 'FEE', 'NET'];
export const REWARD_CALCULATION_MODELS: readonly RewardCalculationModel[] = [
  'FIXED',
  'PERCENTAGE',
  'PERCENTAGE_MIN',
  'PERCENTAGE_MAX',
  'PERCENTAGE_MIN_MAX',
  'FLAT_PLUS_PERCENTAGE',
  'TIERED',
];
export const REWARD_CUSTOMER_KYC_LEVELS: readonly RewardCustomerKycLevel[] = ['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'];

/**
 * One marginal bracket of a TIERED rule:
 *  - upToMinor: exclusive upper bound of the bracket in minor units (string);
 *    null on the LAST bracket = open-ended.
 *  - bps / flatMinor: applied MARGINALLY to the slice of the base inside this bracket
 *    (bps of the slice, plus flatMinor once IF the base reaches the bracket at all).
 *    At least one of bps/flatMinor must be present per bracket.
 */
export interface RewardTier {
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

@Entity({ name: 'reward_rules' })
@Index('idx_reward_rules_product', ['productCode'])
@Index('idx_reward_rules_active', ['isActive'])
@Index('idx_reward_rules_effective_from', ['effectiveFrom'])
@Check('chk_reward_rules_currency', "currency ~ '^[A-Z]{3}$'")
@Check('chk_reward_rules_beneficiary', "beneficiary_type IN ('CUSTOMER','AGENT')")
@Check('chk_reward_rules_reward_type', "reward_type IN ('CASHBACK','BONUS','PROMOTION')")
@Check('chk_reward_rules_kyc_level', "customer_kyc_level IS NULL OR customer_kyc_level IN ('NONE','LEVEL_1','LEVEL_2','LEVEL_3')")
@Check('chk_reward_rules_min_max', 'minimum_reward_minor IS NULL OR maximum_reward_minor IS NULL OR minimum_reward_minor <= maximum_reward_minor')
@Check('chk_reward_rules_effective', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_reward_rules_version', 'version > 0')
export class RewardRuleDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_code', type: 'varchar', length: 80 })
  productCode!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'beneficiary_type', type: 'varchar', length: 20 })
  beneficiaryType!: RewardBeneficiaryType;

  /** Grant classification carried into the snapshot's required RewardGrantSnapshot.rewardType. */
  @Column({ name: 'reward_type', type: 'varchar', length: 20 })
  rewardType!: RewardGrantType;

  @Column({ name: 'calculation_model', type: 'varchar', length: 24 })
  calculationModel!: RewardCalculationModel;

  @Column({ name: 'calculation_basis', type: 'varchar', length: 20 })
  calculationBasis!: RewardCalculationBasis;

  @Column({ name: 'flat_reward_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  flatRewardMinor!: string | null;

  @Column({ name: 'percentage_bps', type: 'integer', nullable: true })
  percentageBps!: number | null;

  @Column({ name: 'minimum_reward_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  minimumRewardMinor!: string | null;

  @Column({ name: 'maximum_reward_minor', type: 'bigint', transformer: nullableBigintTransformer, nullable: true })
  maximumRewardMinor!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  tiers!: RewardTier[] | null;

  /** Single-dimensional eligibility targeting: at most one of these is non-null (DB CHECK). */
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  /** Existing authoritative CustomerKycLevel values — a classification, not an FK. */
  @Column({ name: 'customer_kyc_level', type: 'varchar', length: 20, nullable: true })
  customerKycLevel!: RewardCustomerKycLevel | null;

  @Column({ name: 'agent_class_id', type: 'uuid', nullable: true })
  agentClassId!: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  /** Configuration-only promotion identity (no campaign registry exists — not an FK). */
  @Column({ name: 'campaign_code', type: 'varchar', length: 80, nullable: true })
  campaignCode!: string | null;

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
