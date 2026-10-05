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

import { SupportWorkforceSessionStatus } from './support-authentication.enums';

@Entity({ name: 'support_workforce_sessions' })
@Index('uq_support_workforce_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('idx_support_workforce_sessions_user_status', ['supportUserId', 'status'])
@Index('idx_support_workforce_sessions_expires', ['status', 'expiresAt'])
@Check('chk_support_workforce_sessions_status', "status IN ('ACTIVE','REVOKED','EXPIRED')")
export class SupportWorkforceSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'support_user_id', type: 'uuid' })
  supportUserId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 80, default: 'support-workforce' })
  audience!: string;

  @Column({ type: 'varchar', length: 20, default: SupportWorkforceSessionStatus.ACTIVE })
  status!: SupportWorkforceSessionStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 500, nullable: true })
  revokeReason!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
