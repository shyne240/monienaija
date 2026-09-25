import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AgentSessionStatus } from './agent.enums';

/**
 * A6 — an authenticated Agent session.
 *
 * Only the SHA-256 hash of the bearer token is stored. The token is returned
 * once at login and never persisted, logged or audited. Sessions are
 * audience-bound so an Agent session can never be presented to the internal
 * workforce or customer surfaces.
 */
@Entity({ name: 'agent_sessions' })
@Index('idx_agent_sessions_agent_status', ['agentId', 'status'])
export class AgentSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 120 })
  audience!: string;

  @Column({ type: 'varchar', length: 20, default: AgentSessionStatus.ACTIVE })
  status!: AgentSessionStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 500, nullable: true })
  revokedReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
