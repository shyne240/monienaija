import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { WithdrawalFailureCode, WithdrawalStatus } from './withdrawal.enums';

@Entity({ name: 'withdrawals' })
@Index('uq_withdrawals_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_withdrawals_payment_reference', ['paymentReference'], { unique: true })
@Index('idx_withdrawals_wallet_created', ['walletId', 'createdAt', 'id'])
@Check('chk_withdrawals_amount_positive', 'amount_minor > 0')
@Check(
  'chk_withdrawals_completed_has_journal',
  "status <> 'COMPLETED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)",
)
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'payment_reference', type: 'varchar', length: 64 })
  paymentReference!: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: WithdrawalStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  narration!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode!: WithdrawalFailureCode | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 255, nullable: true })
  failureMessage!: string | null;

  @Column({ name: 'failure_status_code', type: 'smallint', nullable: true })
  failureStatusCode!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
