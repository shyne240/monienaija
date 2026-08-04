import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { PasswordResetTokenStatus } from './customer-authentication.enums';

@Entity({ name: 'password_reset_tokens' })
@Index('uq_password_reset_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_password_reset_tokens_request_created', ['requestId', 'createdAt'])
@Check('chk_password_reset_tokens_status', "status IN ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED')")
@Check('chk_password_reset_tokens_version', 'token_version > 0 AND version > 0')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 512 })
  tokenHash!: string;

  @Column({ name: 'token_version', type: 'integer' })
  tokenVersion!: number;

  @Column({ type: 'varchar', length: 20, default: PasswordResetTokenStatus.ACTIVE })
  status!: PasswordResetTokenStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
