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

import { bigintTransformer } from '../common/bigint.transformer';
import { TransferFailureCode, TransferStatus } from './transfer.enums';

@Entity({ name: 'transfers' })
@Index('uq_transfers_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: 'idempotency_scope IS NULL',
})
@Index('uq_transfers_scoped_idempotency_key', ['idempotencyScope', 'idempotencyKey'], {
  unique: true,
  where: 'idempotency_scope IS NOT NULL',
})
@Index('uq_transfers_command_id', ['commandId'], {
  unique: true,
  where: 'command_id IS NOT NULL',
})
@Index('uq_transfers_journal_id', ['journalId'], {
  unique: true,
  where: 'journal_id IS NOT NULL',
})
@Index('idx_transfers_source_created', ['sourceWalletId', 'createdAt', 'id'])
@Index('idx_transfers_destination_created', ['destinationWalletId', 'createdAt', 'id'])
@Index('idx_transfers_source_customer_created', ['sourceCustomerId', 'createdAt', 'id'])
@Index('idx_transfers_destination_customer_created', ['destinationCustomerId', 'createdAt', 'id'])
@Index('idx_transfers_correlation_created', ['correlationId', 'createdAt', 'id'])
@Index('idx_transfers_status_updated', ['status', 'updatedAt', 'id'])
@Check('chk_transfers_amount_positive', 'amount_minor > 0')
@Check(
  'chk_transfers_status',
  "status IN ('PENDING', 'PROCESSING', 'PENDING_RECOVERY', 'UNKNOWN', 'COMPLETED', 'FAILED', 'CANCELLED')",
)
@Check(
  'chk_transfers_completion_has_journal',
  "status <> 'COMPLETED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)",
)
@Check(
  'chk_transfers_recovery_has_reference',
  "status NOT IN ('UNKNOWN', 'PENDING_RECOVERY') OR recovery_reference IS NOT NULL",
)
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** A5 command identity; null is retained only for legacy compatibility rows. */
  @Column({ name: 'command_id', type: 'uuid', nullable: true })
  commandId!: string | null;

  @Column({ name: 'command_type', type: 'varchar', length: 80, nullable: true })
  commandType!: string | null;

  @Column({ name: 'command_version', type: 'integer', nullable: true })
  commandVersion!: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  capability!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  action!: string | null;

  @Column({ name: 'command_scope', type: 'varchar', length: 80, nullable: true })
  commandScope!: string | null;

  @Column({ name: 'source_customer_id', type: 'uuid', nullable: true })
  sourceCustomerId!: string | null;

  @Column({ name: 'destination_customer_id', type: 'uuid', nullable: true })
  destinationCustomerId!: string | null;

  @Column({ name: 'source_customer_wallet_id', type: 'uuid', nullable: true })
  sourceCustomerWalletId!: string | null;

  @Column({ name: 'destination_customer_wallet_id', type: 'uuid', nullable: true })
  destinationCustomerWalletId!: string | null;

  @Column({ name: 'source_binding_id', type: 'uuid', nullable: true })
  sourceBindingId!: string | null;

  @Column({ name: 'destination_binding_id', type: 'uuid', nullable: true })
  destinationBindingId!: string | null;

  @Column({ name: 'source_binding_version', type: 'integer', nullable: true })
  sourceBindingVersion!: number | null;

  @Column({ name: 'destination_binding_version', type: 'integer', nullable: true })
  destinationBindingVersion!: number | null;

  @Column({ name: 'source_ledger_account_id', type: 'uuid', nullable: true })
  sourceLedgerAccountId!: string | null;

  @Column({ name: 'destination_ledger_account_id', type: 'uuid', nullable: true })
  destinationLedgerAccountId!: string | null;

  @Column({ name: 'authorization_context_reference', type: 'varchar', length: 180, nullable: true })
  authorizationContextReference!: string | null;

  @Column({ name: 'policy_decision_reference', type: 'varchar', length: 180, nullable: true })
  policyDecisionReference!: string | null;

  @Column({ name: 'policy_version', type: 'varchar', length: 160, nullable: true })
  policyVersion!: string | null;

  @Column({ name: 'policy_profile_reference', type: 'varchar', length: 160, nullable: true })
  policyProfileReference!: string | null;

  @Column({ name: 'policy_profile_version', type: 'integer', nullable: true })
  policyProfileVersion!: number | null;

  @Column({ name: 'policy_snapshot_reference', type: 'varchar', length: 180, nullable: true })
  policySnapshotReference!: string | null;

  @Column({ name: 'policy_input_hash', type: 'char', length: 64, nullable: true })
  policyInputHash!: string | null;

  @Column({ name: 'source_wallet_id', type: 'uuid' })
  sourceWalletId!: string;

  @Column({ name: 'destination_wallet_id', type: 'uuid' })
  destinationWalletId!: string;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'payment_reference', type: 'varchar', length: 64, nullable: true })
  paymentReference!: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  accountingUnit!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: TransferStatus;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120, nullable: true })
  idempotencyScope!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 255, nullable: true })
  requestId!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'trace_id', type: 'varchar', length: 255, nullable: true })
  traceId!: string | null;

  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true })
  causationId!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz', nullable: true })
  requestedAt!: Date | null;

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

  @Column({ name: 'recovery_reference', type: 'varchar', length: 180, nullable: true })
  recoveryReference!: string | null;

  @Column({ name: 'state_reason', type: 'varchar', length: 255, nullable: true })
  stateReason!: string | null;

  @Column({ name: 'pending_at', type: 'timestamptz', nullable: true })
  pendingAt!: Date | null;

  @Column({ name: 'processing_at', type: 'timestamptz', nullable: true })
  processingAt!: Date | null;

  @Column({ name: 'pending_recovery_at', type: 'timestamptz', nullable: true })
  pendingRecoveryAt!: Date | null;

  @Column({ name: 'unknown_at', type: 'timestamptz', nullable: true })
  unknownAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @VersionColumn({ type: 'integer', default: 1 })
  version!: number;
}
