import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import {
  PolicyProfileLifecycleState,
  PolicyRetentionClass,
} from './capability-policy-persistence.enums';

@Entity({ name: 'policy_profile_versions' })
@Unique('uq_policy_profile_versions_reference', ['profileReference'])
@Unique('uq_policy_profile_versions_key_version', ['profileKey', 'profileVersion'])
@Unique('uq_policy_profile_versions_policy_version', ['policyVersion'])
@Index('idx_policy_profile_versions_capability_action_effective', [
  'capability',
  'effectiveFrom',
  'effectiveTo',
])
@Index('idx_policy_profile_versions_lifecycle', ['lifecycleState', 'effectiveFrom'])
@Check('chk_policy_profile_versions_profile_version', 'profile_version > 0')
@Check('chk_policy_profile_versions_definition_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_policy_profile_versions_effective_interval',
  '(effective_to IS NULL OR effective_to > effective_from)',
)
@Check(
  'chk_policy_profile_versions_lifecycle',
  "lifecycle_state IN ('DRAFT', 'ACTIVE', 'RETIRED', 'REJECTED', 'ABANDONED')",
)
@Check(
  'chk_policy_profile_versions_publication_metadata',
  "(lifecycle_state <> 'ACTIVE' OR (published_at IS NOT NULL AND published_by IS NOT NULL)) AND (lifecycle_state <> 'RETIRED' OR (retired_at IS NOT NULL AND retired_by IS NOT NULL))",
)
export class PolicyProfileVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'profile_reference', type: 'varchar', length: 160 })
  profileReference!: string;

  @Column({ name: 'profile_key', type: 'varchar', length: 160 })
  profileKey!: string;

  @Column({ name: 'profile_version', type: 'integer' })
  profileVersion!: number;

  @Column({ name: 'policy_version', type: 'varchar', length: 160 })
  policyVersion!: string;

  @Column({ name: 'definition_hash', type: 'char', length: 64 })
  definitionHash!: string;

  @Column({ type: 'varchar', length: 128 })
  capability!: string;

  @Column({ type: 'jsonb' })
  actions!: readonly string[];

  @Column({ name: 'subject_type', type: 'varchar', length: 20 })
  subjectType!: 'CUSTOMER';

  @Column({ name: 'contract_name', type: 'varchar', length: 80 })
  contractName!: string;

  @Column({ name: 'contract_version', type: 'integer' })
  contractVersion!: number;

  @Column({ name: 'profile_contract_version', type: 'integer' })
  profileContractVersion!: number;

  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 })
  recordVersion!: number;

  @Column({ name: 'definition_payload', type: 'jsonb' })
  definitionPayload!: Readonly<Record<string, unknown>>;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @Column({
    name: 'lifecycle_state',
    type: 'varchar',
    length: 20,
    default: PolicyProfileLifecycleState.DRAFT,
  })
  lifecycleState!: PolicyProfileLifecycleState;

  @Column({ name: 'created_by', type: 'varchar', length: 160 })
  createdBy!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'published_by', type: 'varchar', length: 160, nullable: true })
  publishedBy!: string | null;

  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  @Column({ name: 'retired_by', type: 'varchar', length: 160, nullable: true })
  retiredBy!: string | null;

  @Column({ name: 'last_correlation_id', type: 'varchar', length: 255, nullable: true })
  lastCorrelationId!: string | null;

  @Column({ name: 'last_request_id', type: 'varchar', length: 255, nullable: true })
  lastRequestId!: string | null;

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

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
