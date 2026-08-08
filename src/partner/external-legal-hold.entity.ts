import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalLegalHoldStatus,
} from './external-data-minimization.enums';

@Entity({ name: 'external_legal_hold_records' })
@Index('idx_external_legal_hold_scope_reference', ['scope', 'referenceId'])
@Index('idx_external_legal_hold_status', ['status'])
@Check(
  'chk_external_legal_hold_scope',
  "scope IN ('EXTERNAL_OPERATION', 'EXTERNAL_REFERENCE', 'EXTERNAL_CALLBACK', 'EXTERNAL_SETTLEMENT', 'EXTERNAL_SUSPENSE', 'EXTERNAL_AUDIT', 'EXTERNAL_OUTBOX', 'EXTERNAL_IDEMPOTENCY', 'EXTERNAL_DATA_CLASSIFICATION', 'EXTERNAL_CONSENT', 'EXTERNAL_DISCLOSURE', 'EXTERNAL_SUPPORT_TRACE', 'EXTERNAL_SECRET')",
)
@Check(
  'chk_external_legal_hold_authority',
  "authority IN ('LEGAL', 'REGULATORY', 'INVESTIGATION', 'SECURITY', 'FRAUD', 'DISPUTE', 'FINANCIAL_CONTROL')",
)
@Check('chk_external_legal_hold_status', "status IN ('ACTIVE', 'RELEASED')")
@Check('chk_external_legal_hold_owner', "owner ~ '^[\\x20-\\x7E]{1,160}$'")
@Check('chk_external_legal_hold_reason', "reason ~ '^[\\x20-\\x7E]{1,255}$'")
@Check('chk_external_legal_hold_imposed_by', "imposed_by ~ '^[\\x20-\\x7E]{1,160}$'")
@Check(
  'chk_external_legal_hold_released_by',
  "released_by IS NULL OR released_by ~ '^[\\x20-\\x7E]{1,160}$'",
)
@Check(
  'chk_external_legal_hold_release_state',
  "(status = 'ACTIVE' AND released_at IS NULL AND released_by IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL AND released_by IS NOT NULL)",
)
export class ExternalLegalHoldEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scope', type: 'varchar', length: 40 })
  scope!: ExternalLegalHoldScope;

  @Column({ name: 'reference_id', type: 'uuid' })
  referenceId!: string;

  @Column({ name: 'owner', type: 'varchar', length: 160 })
  owner!: string;

  @Column({ name: 'authority', type: 'varchar', length: 24 })
  authority!: ExternalLegalHoldAuthority;

  @Column({ name: 'reason', type: 'varchar', length: 255 })
  reason!: string;

  @Column({ name: 'imposed_at', type: 'timestamptz' })
  imposedAt!: Date;

  @Column({ name: 'imposed_by', type: 'varchar', length: 160 })
  imposedBy!: string;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ name: 'released_by', type: 'varchar', length: 160, nullable: true })
  releasedBy!: string | null;

  @Column({ name: 'notes', type: 'varchar', length: 255, nullable: true })
  notes!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: ExternalLegalHoldStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
