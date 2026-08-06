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

import { AuthenticationSessionStatus } from './authentication-session.enums';

@Entity({ name: 'authentication_sessions' })
@Index('uq_authentication_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('idx_authentication_sessions_customer_status', ['customerId', 'status'])
@Index('idx_authentication_sessions_expires', ['status', 'expiresAt'])
@Check('chk_authentication_sessions_token_hash', "token_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_authentication_sessions_status', "status IN ('ACTIVE', 'REVOKED', 'EXPIRED')")
@Check('chk_authentication_sessions_version', 'version > 0')
export class AuthenticationSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'credential_id', type: 'uuid' })
  credentialId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 80, default: 'customer-api' })
  audience!: string;

  @Column({ type: 'varchar', length: 20, default: AuthenticationSessionStatus.ACTIVE })
  status!: AuthenticationSessionStatus;

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
