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

import { AgentPasswordHashAlgorithm } from './agent-authentication.enums';

@Entity({ name: 'agent_transaction_pins' })
@Index('uq_agent_transaction_pins_active_agent', ['agentId'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('idx_agent_transaction_pins_agent', ['agentId'])
@Check(
  'chk_agent_transaction_pins_algorithm',
  "hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')",
)
@Check('chk_agent_transaction_pins_pin_version', 'pin_version > 0')
@Check('chk_agent_transaction_pins_failed_count', 'failed_count >= 0')
@Check('chk_agent_transaction_pins_version', 'version > 0')
export class AgentTransactionPin {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'pin_hash', type: 'varchar', length: 512 })
  pinHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: AgentPasswordHashAlgorithm;

  @Column({ name: 'pin_version', type: 'integer' })
  pinVersion!: number;

  @Column({ name: 'failed_count', type: 'integer', default: 0 })
  failedCount!: number;

  @Column({ name: 'account_locked', type: 'boolean', default: false })
  accountLocked!: boolean;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 500, nullable: true })
  lockReason!: string | null;

  @Column({ name: 'last_changed_at', type: 'timestamptz' })
  lastChangedAt!: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
