import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import type { CustomerCredentialRecoveryPurpose } from './customer-credential-recovery.constants';

export type CustomerCredentialRecoveryStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'REVOKED';

/**
 * ARENA 4 — recovery evidence journey (see migration 1785753600402 for the security rationale).
 * Never holds a credential: only a salted OTP digest, an OTP-derived single-use token hash, and the
 * lifecycle timestamps.
 */
@Entity({ name: 'customer_credential_recovery_challenges' })
@Index('idx_ccrc_customer_purpose', ['customerId', 'purpose', 'createdAt'])
@Index('idx_ccrc_status_expires', ['status', 'expiresAt'])
@Check('chk_ccrc_purpose', "purpose IN ('LOGIN_PASSCODE','TRANSACTION_PIN')")
@Check('chk_ccrc_status', "status IN ('ACTIVE','CONSUMED','EXPIRED','REVOKED')")
@Check('chk_ccrc_attempts', 'attempt_count >= 0')
@Check('chk_ccrc_version', 'version > 0')
export class CustomerCredentialRecoveryChallenge {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 32 })
  purpose!: CustomerCredentialRecoveryPurpose;

  @Column({ name: 'normalized_phone', type: 'varchar', length: 32 })
  normalizedPhone!: string;

  @Column({ name: 'destination_phone', type: 'varchar', length: 32 })
  destinationPhone!: string;

  @Column({ name: 'code_salt', type: 'varchar', length: 64 })
  codeSalt!: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 256 })
  codeHash!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64, nullable: true })
  tokenHash!: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: CustomerCredentialRecoveryStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
