import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'cash_to_cash_transfers' })
@Index('uq_cash_to_cash_agent_idempotency', ['agentId', 'idempotencyKey'], { unique: true })
@Index('uq_cash_to_cash_journal', ['journalId'], { unique: true })
@Index('idx_cash_to_cash_beneficiary', ['beneficiaryPhone'])
@Index('idx_cash_to_cash_agent', ['agentId'])
@Index('idx_cash_to_cash_status', ['status'])
@Index('idx_cash_to_cash_expiry', ['status', 'expiresAt'])
export class CashToCashTransfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'beneficiary_phone', type: 'varchar', length: 10 })
  beneficiaryPhone!: string;

  @Column({ name: 'principal_minor', type: 'bigint' })
  principalMinor!: string;

  @Column({ name: 'fee_minor', type: 'bigint', default: '0' })
  feeMinor!: string;

  @Column({ name: 'vat_minor', type: 'bigint', default: '0' })
  vatMinor!: string;

  @Column({ name: 'total_minor', type: 'bigint' })
  totalMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'UNCLAIMED' })
  status!: string;

  @Column({ name: 'transfer_code_hash', type: 'varchar', length: 512 })
  transferCodeHash!: string;

  @Column({ name: 'hash_algorithm', type: 'varchar', length: 20 })
  hashAlgorithm!: string;

  @Column({ name: 'transfer_code_version', type: 'integer', default: 1 })
  transferCodeVersion!: number;

  @Column({ name: 'failed_attempts', type: 'integer', default: 0 })
  failedAttempts!: number;

  @Column({ name: 'is_locked', type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_reason', type: 'varchar', length: 500, nullable: true })
  lockReason!: string | null;

    @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'claimant_customer_id', type: 'uuid', nullable: true })
  claimantCustomerId!: string | null;

  @Column({ name: 'claim_journal_id', type: 'uuid', nullable: true })
  claimJournalId!: string | null;

  @Column({ name: 'claim_idempotency_key', type: 'varchar', length: 255, nullable: true })
  claimIdempotencyKey!: string | null;

  @Column({ name: 'claim_reference', type: 'varchar', length: 255, nullable: true })
  claimReference!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
