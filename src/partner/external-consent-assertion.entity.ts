import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalConsentSource, ExternalConsentStatus } from './external-data-minimization.enums';

@Entity({ name: 'external_consent_assertions' })
@Index('idx_external_consent_assertions_customer', ['customerId'])
@Index('idx_external_consent_assertions_target', ['source', 'targetId', 'targetVersion'])
@Index('idx_external_consent_assertions_status', ['status'])
@Check(
  'chk_external_consent_assertions_source',
  "source IN ('CUSTOMER_BENEFICIARY', 'CUSTOMER_FUNDING_INSTRUMENT', 'EXTERNAL_TARGET', 'DERIVED')",
)
@Check(
  'chk_external_consent_assertions_status',
  "status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'INVALID')",
)
@Check('chk_external_consent_assertions_purpose', "purpose ~ '^[A-Z_]{3,80}$'")
@Check('chk_external_consent_assertions_jurisdiction', "jurisdiction ~ '^[A-Z]{2}$'")
@Check('chk_external_consent_assertions_mandate', "mandate_reference ~ '^[\\x20-\\x7E]{1,160}$'")
@Check('chk_external_consent_assertions_granted_by', "granted_by ~ '^[\\x20-\\x7E]{1,160}$'")
@Check('chk_external_consent_assertions_target_version', 'target_version > 0')
@Check('chk_external_consent_assertions_mandate_version', 'mandate_version > 0')
@Check('chk_external_consent_assertions_revocable', 'revocable IN (true, false)')
@Check(
  'chk_external_consent_assertions_revoke_state',
  "(revoked_at IS NULL) OR (revoked_at IS NOT NULL AND status = 'REVOKED')",
)
export class ExternalConsentAssertionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'source', type: 'varchar', length: 40 })
  source!: ExternalConsentSource;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ name: 'target_version', type: 'integer' })
  targetVersion!: number;

  @Column({ name: 'purpose', type: 'varchar', length: 80 })
  purpose!: string;

  @Column({ name: 'jurisdiction', type: 'varchar', length: 2 })
  jurisdiction!: string;

  @Column({ name: 'mandate_reference', type: 'varchar', length: 160 })
  mandateReference!: string;

  @Column({ name: 'mandate_version', type: 'integer' })
  mandateVersion!: number;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'granted_by', type: 'varchar', length: 160 })
  grantedBy!: string;

  @Column({ name: 'revocable', type: 'boolean', default: true })
  revocable!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: ExternalConsentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
