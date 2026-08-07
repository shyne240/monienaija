import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { PolicyDecisionState, PolicyCollectionStatus } from './capability-policy.enums';
import { PolicyRetentionClass } from './capability-policy-persistence.enums';

@Entity({ name: 'policy_decision_records' })
@Unique('uq_policy_decision_records_reference', ['decisionReference'])
@Index('idx_policy_decision_records_scope_time', [
  'customerId',
  'capability',
  'action',
  'evaluatedAt',
])
@Index('idx_policy_decision_records_request_hash', ['requestHash'])
@Index('idx_policy_decision_records_snapshot_hash', ['normalizedInputHash'])
@Index('idx_policy_decision_records_policy_version', ['policyVersion', 'profileVersion'])
@Check('chk_policy_decision_records_definition_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_policy_decision_records_request_hash', "request_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_policy_decision_records_input_hash', "normalized_input_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_policy_decision_records_result_hash', "result_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_policy_decision_records_decision',
  "decision IN ('ALLOW', 'ALLOW_WITH_LIMITS', 'PENDING_REVIEW', 'DENY', 'SUSPEND')",
)
@Check(
  'chk_policy_decision_records_collection_status',
  "collection_status IN ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')",
)
export class PolicyDecisionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'decision_reference', type: 'varchar', length: 180 })
  decisionReference!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'varchar', length: 128 })
  capability!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'profile_reference', type: 'varchar', length: 160 })
  profileReference!: string;

  @Column({ name: 'profile_key', type: 'varchar', length: 160 })
  profileKey!: string;

  @Column({ name: 'profile_version', type: 'integer' })
  profileVersion!: number;

  @Column({ name: 'policy_version', type: 'varchar', length: 160 })
  policyVersion!: string;

  @Column({ name: 'contract_name', type: 'varchar', length: 80 })
  contractName!: string;

  @Column({ name: 'contract_version', type: 'integer' })
  contractVersion!: number;

  @Column({ name: 'definition_hash', type: 'char', length: 64 })
  definitionHash!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'snapshot_reference', type: 'varchar', length: 180 })
  snapshotReference!: string;

  @Column({ name: 'snapshot_contract_version', type: 'integer' })
  snapshotContractVersion!: number;

  @Column({ name: 'normalized_input_hash', type: 'char', length: 64 })
  normalizedInputHash!: string;

  @Column({ name: 'result_hash', type: 'char', length: 64 })
  resultHash!: string;

  @Column({ type: 'varchar', length: 20 })
  decision!: PolicyDecisionState;

  @Column({ name: 'reason_codes', type: 'jsonb' })
  reasonCodes!: readonly string[];

  @Column({ name: 'explanation', type: 'jsonb' })
  explanation!: Readonly<Record<string, unknown>>;

  @Column({ type: 'jsonb' })
  obligations!: readonly Record<string, unknown>[];

  @Column({ type: 'jsonb' })
  limits!: readonly Record<string, unknown>[];

  @Column({ name: 'source_references', type: 'jsonb' })
  sourceReferences!: readonly Record<string, unknown>[];

  @Column({ name: 'freshness_summary', type: 'jsonb' })
  freshnessSummary!: readonly string[];

  @Column({ name: 'collection_status', type: 'varchar', length: 20 })
  collectionStatus!: PolicyCollectionStatus;

  @Column({ name: 'authorization_context_reference', type: 'varchar', length: 180 })
  authorizationContextReference!: string;

  @Column({ name: 'target_binding_reference', type: 'varchar', length: 180, nullable: true })
  targetBindingReference!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'review_at', type: 'timestamptz', nullable: true })
  reviewAt!: Date | null;

  @Column({ name: 'supersedes_decision_reference', type: 'varchar', length: 180, nullable: true })
  supersedesDecisionReference!: string | null;

  @Column({ name: 'request_context', type: 'jsonb' })
  requestContext!: Readonly<Record<string, unknown>>;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({
    name: 'retention_class',
    type: 'varchar',
    length: 64,
    default: PolicyRetentionClass.POLICY_HISTORY,
  })
  retentionClass!: string;

  @Column({ name: 'legal_hold', type: 'boolean', default: false })
  legalHold!: boolean;

  @Column({ name: 'retention_expires_at', type: 'timestamptz', nullable: true })
  retentionExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
