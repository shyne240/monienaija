import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { AgentCredentialStatus, AgentCredentialType } from './agent.enums';

/**
 * A6 — an Agent-owned authentication credential.
 *
 * `credential_type` discriminates the LOGIN secret from the TRANSACTION PIN, so
 * the two are separate rows and one can never be used as the other. Only the
 * hash is stored; the plaintext secret is never persisted, logged, returned or
 * audited.
 */
@Entity({ name: 'agent_authentication_credentials' })
@Index('idx_agent_auth_credentials_agent', ['agentId'])
export class AgentAuthenticationCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'credential_type', type: 'varchar', length: 20 })
  credentialType!: AgentCredentialType;

  /** PBKDF2-encoded hash. Never the plaintext secret. */
  @Column({ name: 'secret_hash', type: 'varchar', length: 512 })
  secretHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: string;

  @Column({ type: 'varchar', length: 20, default: AgentCredentialStatus.ACTIVE })
  status!: AgentCredentialStatus;

  @Column({ name: 'failed_authentication_count', type: 'integer', default: 0 })
  failedAuthenticationCount!: number;

  @Column({ name: 'account_locked', type: 'boolean', default: false })
  accountLocked!: boolean;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 500, nullable: true })
  lockReason!: string | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
