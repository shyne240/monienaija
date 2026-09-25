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

import { AgentAuthenticationSessionStatus } from './agent-authentication.enums';

@Entity({ name: 'agent_authentication_sessions' })
@Index('uq_agent_authentication_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('idx_agent_authentication_sessions_agent_status', ['agentId', 'status'])
@Index('idx_agent_authentication_sessions_expires', ['status', 'expiresAt'])
@Check('chk_agent_authentication_sessions_token_hash', "token_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_agent_authentication_sessions_status', "status IN ('ACTIVE', 'REVOKED', 'EXPIRED')")
@Check('chk_agent_authentication_sessions_version', 'version > 0')
export class AgentAuthenticationSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'credential_id', type: 'uuid' })
  credentialId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 80, default: 'agent-api' })
  audience!: string;

  @Column({ type: 'varchar', length: 20, default: AgentAuthenticationSessionStatus.ACTIVE })
  status!: AgentAuthenticationSessionStatus;

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
