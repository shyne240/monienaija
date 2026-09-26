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

import {
  AgentAuthenticationCredentialStatus,
  AgentPasswordHashAlgorithm,
} from './agent-authentication.enums';

@Entity({ name: 'agent_authentication_credentials' })
@Index('uq_agent_authentication_credentials_active_agent', ['agentId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_agent_authentication_credentials_agent_status', ['agentId', 'status'])
@Check('chk_agent_authentication_credentials_status', "status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')")
@Check(
  'chk_agent_authentication_credentials_algorithm',
  "hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')",
)
@Check('chk_agent_authentication_credentials_password_version', 'password_version > 0')
@Check('chk_agent_authentication_credentials_failed_count', 'failed_authentication_count >= 0')
@Check('chk_agent_authentication_credentials_version', 'version > 0')
export class AgentAuthenticationCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 512 })
  passwordHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: AgentPasswordHashAlgorithm;

  @Column({ name: 'password_version', type: 'integer' })
  passwordVersion!: number;

  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  passwordChangedAt!: Date;

  @Column({ name: 'password_expires_at', type: 'timestamptz', nullable: true })
  passwordExpiresAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: AgentAuthenticationCredentialStatus.ACTIVE })
  status!: AgentAuthenticationCredentialStatus;

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

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
