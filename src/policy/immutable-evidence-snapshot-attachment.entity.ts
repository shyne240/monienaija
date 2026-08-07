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
import { PolicyCollectionStatus } from './capability-policy.enums';
import { PolicyRetentionClass } from './capability-policy-persistence.enums';

@Entity({ name: 'immutable_evidence_snapshot_attachments' })
@Unique('uq_immutable_evidence_snapshots_reference', ['snapshotReference'])
@Index('idx_immutable_evidence_snapshots_hash', ['normalizedInputHash'])
@Index('idx_immutable_evidence_snapshots_subject_scope', [
  'customerId',
  'capability',
  'action',
  'collectedAt',
])
@Check('chk_immutable_evidence_snapshots_input_hash', "normalized_input_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_immutable_evidence_snapshots_collection_status',
  "collection_status IN ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')",
)
@Check('chk_immutable_evidence_snapshots_hash_algorithm', "hash_algorithm = 'SHA-256'")
export class ImmutableEvidenceSnapshotAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_reference', type: 'varchar', length: 180 })
  snapshotReference!: string;

  @Column({ name: 'snapshot_contract_name', type: 'varchar', length: 80 })
  snapshotContractName!: string;

  @Column({ name: 'snapshot_contract_version', type: 'integer' })
  snapshotContractVersion!: number;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'varchar', length: 128 })
  capability!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'as_of', type: 'timestamptz' })
  asOf!: Date;

  @Column({ name: 'evidence_profile', type: 'varchar', length: 160 })
  evidenceProfile!: string;

  @Column({ name: 'policy_version_hint', type: 'varchar', length: 160, nullable: true })
  policyVersionHint!: string | null;

  @Column({ name: 'collected_at', type: 'timestamptz' })
  collectedAt!: Date;

  @Column({ name: 'collection_status', type: 'varchar', length: 20 })
  collectionStatus!: PolicyCollectionStatus;

  @Column({ name: 'required_source_classes', type: 'jsonb' })
  requiredSourceClasses!: readonly string[];

  @Column({ name: 'freshness_summary', type: 'jsonb' })
  freshnessSummary!: readonly string[];

  @Column({ name: 'normalized_input_hash', type: 'char', length: 64 })
  normalizedInputHash!: string;

  @Column({ name: 'canonicalization_version', type: 'integer' })
  canonicalizationVersion!: number;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: 'SHA-256';

  /** Full minimized immutable snapshot payload; it contains no selected policy result. */
  @Column({ name: 'snapshot_payload', type: 'jsonb' })
  snapshotPayload!: Readonly<Record<string, unknown>>;

  @Column({
    name: 'retention_class',
    type: 'varchar',
    length: 64,
    default: PolicyRetentionClass.EVIDENCE_SNAPSHOT,
  })
  retentionClass!: string;

  @Column({ name: 'legal_hold', type: 'boolean', default: false })
  legalHold!: boolean;

  @Column({ name: 'retention_expires_at', type: 'timestamptz', nullable: true })
  retentionExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
