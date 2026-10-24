import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CustomerProofOfAddressReviewStatus } from './customer-proof-of-address.enums';

@Entity({ name: 'customer_proof_of_address_submissions' })
@Index('idx_customer_poa_customer_address_created', [
  'customerId',
  'residentialAddressId',
  'createdAt',
])
@Index('uq_customer_poa_submission_id_customer', ['id', 'customerId'], { unique: true })
@Index('uq_customer_poa_submission_id_customer_group', ['id', 'customerId', 'submissionGroupId'], {
  unique: true,
})
@Index('uq_customer_poa_submission_group_revision', ['submissionGroupId', 'revisionNumber'], {
  unique: true,
})
@Index('uq_customer_poa_submission_supersedes', ['supersedesSubmissionId'], {
  unique: true,
  where: 'supersedes_submission_id IS NOT NULL',
})
@Check('chk_customer_poa_submission_status', "review_status IN ('PENDING', 'VERIFIED', 'REJECTED')")
@Check(
  'chk_customer_poa_submission_review_metadata',
  `(
    (review_status = 'PENDING' AND reviewed_by_principal_id IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
    OR (review_status = 'VERIFIED' AND reviewed_by_principal_id IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
    OR (review_status = 'REJECTED' AND reviewed_by_principal_id IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)
  )`,
)
@Check(
  'chk_customer_poa_submission_reviewer_separation',
  `reviewed_by_principal_id IS NULL OR
    (reviewed_by_principal_id <> created_by_principal_id AND
     (uploaded_by_principal_id IS NULL OR reviewed_by_principal_id <> uploaded_by_principal_id))`,
)
@Check(
  'chk_customer_poa_submission_review_requires_file',
  "review_status = 'PENDING' OR storage_object_key IS NOT NULL",
)
@Check(
  'chk_customer_poa_submission_revision_link',
  '((revision_number = 1 AND supersedes_submission_id IS NULL) OR (revision_number > 1 AND supersedes_submission_id IS NOT NULL))',
)
@Check('chk_customer_poa_submission_revision_positive', 'revision_number > 0')
@Check(
  'chk_customer_poa_submission_file_metadata',
  `(
    (storage_object_key IS NULL AND original_file_name IS NULL AND detected_mime_type IS NULL AND file_size_bytes IS NULL AND sha256_checksum IS NULL AND uploaded_by_principal_id IS NULL AND uploaded_at IS NULL)
    OR (storage_object_key IS NOT NULL AND original_file_name IS NOT NULL AND detected_mime_type IN ('application/pdf', 'image/jpeg', 'image/png') AND file_size_bytes > 0 AND sha256_checksum ~ '^[a-fA-F0-9]{64}$' AND uploaded_by_principal_id IS NOT NULL AND uploaded_at IS NOT NULL)
  )`,
)
export class CustomerProofOfAddressSubmission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'submission_group_id', type: 'uuid' })
  submissionGroupId!: string;

  @Column({ name: 'revision_number', type: 'integer', default: 1 })
  revisionNumber!: number;

  @Column({ name: 'supersedes_submission_id', type: 'uuid', nullable: true })
  supersedesSubmissionId!: string | null;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'residential_address_id', type: 'uuid' })
  residentialAddressId!: string;

  /** Configurable candidate classification; not an approved acceptance policy. */
  @Column({ type: 'varchar', length: 60 })
  category!: string;

  /** Configurable candidate document type; not an approved acceptance policy. */
  @Column({ name: 'document_type', type: 'varchar', length: 100 })
  documentType!: string;

  @Column({ name: 'issuer_name', type: 'varchar', length: 200, nullable: true })
  issuerName!: string | null;

  /** Informational document date only; no freshness rule is encoded. */
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate!: string | null;

  @Column({
    name: 'review_status',
    type: 'varchar',
    length: 16,
    default: CustomerProofOfAddressReviewStatus.PENDING,
  })
  reviewStatus!: CustomerProofOfAddressReviewStatus;

  /** Internal object key only. No public URL or document bytes are stored in this database. */
  @Column({ name: 'storage_object_key', type: 'varchar', length: 512, nullable: true })
  storageObjectKey!: string | null;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255, nullable: true })
  originalFileName!: string | null;

  /** Set only from content inspection after a future approved upload implementation. */
  @Column({ name: 'detected_mime_type', type: 'varchar', length: 120, nullable: true })
  detectedMimeType!: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes!: string | null;

  @Column({ name: 'sha256_checksum', type: 'varchar', length: 64, nullable: true })
  sha256Checksum!: string | null;

  @Column({ name: 'created_by_principal_id', type: 'varchar', length: 160 })
  createdByPrincipalId!: string;

  @Column({ name: 'created_by_role_key', type: 'varchar', length: 100 })
  createdByRoleKey!: string;

  @Column({ name: 'uploaded_by_principal_id', type: 'varchar', length: 160, nullable: true })
  uploadedByPrincipalId!: string | null;

  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  @Column({ name: 'reviewed_by_principal_id', type: 'varchar', length: 160, nullable: true })
  reviewedByPrincipalId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 1000, nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
