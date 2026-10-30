import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * V1-CUSTOMER-ONBOARDING-01 — pre-customer phone-verification challenge store.
 *
 * Established because the existing `mfa_challenges` model cannot represent the decided
 * hybrid onboarding order (capture → phone verification → DRAFT customer): mfa_challenges
 * requires NOT NULL customer_id + enrollment_id + method_id + session_id, i.e. a subject
 * that already exists and is already authenticated. This table binds an OTP challenge to a
 * normalized Nigerian phone BEFORE any customer row exists, and after successful verification
 * issues a one-time `verification_token_hash` that the registration endpoint must consume to
 * create the DRAFT customer + verified PHONE contact method in a single transaction.
 *
 * Security properties (V1-CUSTOMER-ONBOARDING-DECISION-01 SUB-1):
 * - The OTP itself is NEVER stored (only a per-challenge salted PBKDF2 digest + salt).
 * - Status machine ACTIVE → VERIFIED | EXPIRED | REVOKED; VERIFIED rows are consumed exactly
 *   once (consumed_at) — no token replay, no cross-phone binding (normalized_phone on the row).
 * - At most one ACTIVE and one VERIFIED-unconsumed challenge per normalized phone (partial
 *   unique indexes in migration 1785753600078).
 */
export type CustomerRegistrationPhoneChallengeStatus =
  | 'ACTIVE'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'REVOKED';

@Entity({ name: 'customer_registration_phone_challenges' })
@Index('idx_reg_phone_challenges_phone_created', ['normalizedPhone', 'createdAt'])
@Index('idx_reg_phone_challenges_status_expires', ['status', 'expiresAt'])
@Check('chk_reg_phone_challenges_status', "status IN ('ACTIVE', 'VERIFIED', 'EXPIRED', 'REVOKED')")
@Check('chk_reg_phone_challenges_attempts', 'attempt_count >= 0')
@Check('chk_reg_phone_challenges_version', 'version > 0')
export class CustomerRegistrationPhoneChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Canonical 10-digit Nigerian national significant number (e.g. 8012345678). */
  @Column({ name: 'normalized_phone', type: 'varchar', length: 32 })
  normalizedPhone!: string;

  /** E.164 rendering (+2348012345678) used as the SMS destination. */
  @Column({ name: 'destination_phone', type: 'varchar', length: 32 })
  destinationPhone!: string;

  @Column({ name: 'code_salt', type: 'varchar', length: 64 })
  codeSalt!: string;

  /** PBKDF2-SHA256 digest (base64url) of the OTP under code_salt — never the code itself. */
  @Column({ name: 'code_hash', type: 'varchar', length: 256 })
  codeHash!: string;

  /** SHA-256 (hex) of the one-time registration token issued on successful verification. */
  @Column({ name: 'verification_token_hash', type: 'varchar', length: 64, nullable: true })
  verificationTokenHash!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: CustomerRegistrationPhoneChallengeStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  /** Set when the registration endpoint consumes the verification token. */
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
