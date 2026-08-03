import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { TransferFailureCode, TransferStatus } from './transfer.enums';

@Entity({ name: 'transfers' })
@Index('uq_transfers_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_transfers_journal_id', ['journalId'], {
  unique: true,
  where: 'journal_id IS NOT NULL',
})
@Index('idx_transfers_source_created', ['sourceWalletId', 'createdAt', 'id'])
@Index('idx_transfers_destination_created', ['destinationWalletId', 'createdAt', 'id'])
@Check('chk_transfers_amount_positive', 'amount_minor > 0')
@Check(
  'chk_transfers_completion_has_journal',
  "status = 'FAILED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)",
)
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_wallet_id', type: 'uuid' })
  sourceWalletId!: string;

  @Column({ name: 'destination_wallet_id', type: 'uuid' })
  destinationWalletId!: string;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: TransferStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  narration!: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode!: TransferFailureCode | null;

  @Column({ name: 'failure_message', type: 'varchar', length: 255, nullable: true })
  failureMessage!: string | null;

  @Column({ name: 'failure_status_code', type: 'smallint', nullable: true })
  failureStatusCode!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
