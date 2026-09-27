import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * V1-COMMERCIAL-DECISION-01 — immutable durable record of the commercial decision applied to a
 * transaction (fee / commission / reward / limit). Historical evidence only: NEVER an authority
 * for usage counters, balances or ledger state.
 *
 * The table is protected by a BEFORE UPDATE OR DELETE trigger — this entity deliberately has no
 * @VersionColumn and no soft-delete: rows are written once and read forever. Corrections are new
 * compensating rows via `supersedesSnapshotId`.
 */

export type CommercialDecisionStatus = 'PENDING' | 'FINAL';
export type FeeDecisionStatus = 'NOT_CONFIGURED' | 'ZERO' | 'APPLIED' | 'WAIVED';
export type CommissionDecisionStatus = 'NONE' | 'ALLOCATED';
export type RewardDecisionStatus = 'NONE' | 'GRANTED';
export type LimitDecisionStatus = 'NOT_EVALUATED' | 'APPROVED' | 'REJECTED';
export type RevenueDecisionStatus = 'NONE' | 'RETAINED';

export interface CommercialRuleRef {
  ruleId: string;
  ruleVersion?: number | null;
  ruleCode?: string | null;
  dimension?: string | null;
  limitValueMinor?: string | null;
  limitValueCount?: number | null;
  [key: string]: unknown;
}

export interface FeeDecisionSnapshot {
  status: FeeDecisionStatus;
  paymentType?: string | null;
  currency?: string | null;
  amountMinor?: string | null;
  feeMinor?: string | null;
  vatMinor?: string | null;
  totalMinor?: string | null;
  ruleRefs?: CommercialRuleRef[];
  [key: string]: unknown;
}

export interface CommissionAllocationSnapshot {
  beneficiaryType: string;
  beneficiaryId?: string | null;
  amountMinor: string;
  currency?: string | null;
  basis?: string | null;
  ruleId?: string | null;
  ruleVersion?: number | null;
  [key: string]: unknown;
}

export interface CommissionDecisionSnapshot {
  status: CommissionDecisionStatus;
  allocations?: CommissionAllocationSnapshot[];
  ruleRefs?: CommercialRuleRef[];
  [key: string]: unknown;
}

export interface RewardGrantSnapshot {
  beneficiaryType: string;
  beneficiaryId?: string | null;
  rewardType: string;
  amountMinor: string;
  currency?: string | null;
  basis?: string | null;
  ruleId?: string | null;
  ruleVersion?: number | null;
  [key: string]: unknown;
}

export interface RewardDecisionSnapshot {
  status: RewardDecisionStatus;
  grants?: RewardGrantSnapshot[];
  ruleRefs?: CommercialRuleRef[];
  [key: string]: unknown;
}

export interface LimitDecisionSnapshot {
  status: LimitDecisionStatus;
  profileCode?: string | null;
  assignmentId?: string | null;
  failureCode?: string | null;
  ruleRefs?: CommercialRuleRef[];
  reservationIds?: string[];
  usageIds?: string[];
  [key: string]: unknown;
}

export interface RevenueDecisionSnapshot {
  status: RevenueDecisionStatus;
  retainedMinor?: string | null;
  currency?: string | null;
  [key: string]: unknown;
}

const principalAmountTransformer = {
  to: (value: string | number): string => String(value),
  from: (value: string | null): string | null => (value === null ? value : String(value)),
};

@Entity({ name: 'commercial_decision_snapshots' })
@Index('idx_commercial_decision_principal', ['principalType', 'principalId'])
@Index('idx_commercial_decision_status', ['decisionStatus'])
@Index('idx_commercial_decision_journal', ['journalId'])
export class CommercialDecisionSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 80 })
  product!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  direction!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  channel!: string | null;

  @Column({ name: 'principal_type', type: 'varchar', length: 20 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'principal_amount_minor', type: 'bigint', transformer: principalAmountTransformer })
  principalAmountMinor!: string;

  @Column({ name: 'transaction_reference', type: 'varchar', length: 255 })
  transactionReference!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 160, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'decision_status', type: 'varchar', length: 20, default: 'FINAL' })
  decisionStatus!: string; // CommercialDecisionStatus

  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt!: Date | null;

  @Column({ name: 'decided_at', type: 'timestamptz', default: () => 'NOW()' })
  decidedAt!: Date;

  @Column({ name: 'fee_decision', type: 'jsonb' })
  feeDecision!: FeeDecisionSnapshot;

  @Column({ name: 'commission_decision', type: 'jsonb' })
  commissionDecision!: CommissionDecisionSnapshot;

  @Column({ name: 'reward_decision', type: 'jsonb' })
  rewardDecision!: RewardDecisionSnapshot;

  @Column({ name: 'limit_decision', type: 'jsonb' })
  limitDecision!: LimitDecisionSnapshot;

  @Column({ name: 'revenue_decision', type: 'jsonb', nullable: true })
  revenueDecision!: RevenueDecisionSnapshot | null;

  @Column({ name: 'configuration_version', type: 'varchar', length: 80, nullable: true })
  configurationVersion!: string | null;

  @Column({ name: 'snapshot_schema_version', type: 'integer', default: 1 })
  snapshotSchemaVersion!: number;

  @Column({ name: 'supersedes_snapshot_id', type: 'uuid', nullable: true })
  supersedesSnapshotId!: string | null;

  @Column({ name: 'superseded_reason', type: 'varchar', length: 255, nullable: true })
  supersededReason!: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 80 })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt!: Date;

  // Deliberately NOT a @VersionColumn: the table is immutable (UPDATE blocked by trigger).
  @Column({ type: 'integer', default: 1 })
  version!: number;
}
