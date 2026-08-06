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

import { MfaChallengeStatus } from './mfa-challenge.enums';

@Entity({ name: 'mfa_challenges' })
@Index('idx_mfa_challenges_customer_status', ['customerId', 'status'])
@Index('idx_mfa_challenges_expires', ['status', 'expiresAt'])
@Index('idx_mfa_challenges_method', ['methodId', 'createdAt'])
@Check('chk_mfa_challenges_status', "status IN ('ACTIVE', 'VERIFIED', 'EXPIRED', 'REVOKED')")
@Check('chk_mfa_challenges_version', 'version > 0')
export class MfaChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'enrollment_id', type: 'uuid' })
  enrollmentId!: string;

  @Column({ name: 'method_id', type: 'uuid' })
  methodId!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'challenge_hash', type: 'varchar', length: 512 })
  challengeHash!: string;

  @Column({ type: 'varchar', length: 20, default: MfaChallengeStatus.ACTIVE })
  status!: MfaChallengeStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
