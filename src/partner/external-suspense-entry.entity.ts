import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalSuspenseStatus } from './external-settlement.enums';
import { EXTERNAL_SETTLEMENT_SUSPENSE_REASONS } from './external-settlement.enums';

@Entity({ name: 'external_suspense_entries' })
@Index('idx_external_suspense_operation', ['externalOperationId', 'createdAt', 'id'])
@Index('idx_external_suspense_customer', ['customerId', 'status', 'createdAt', 'id'])
@Index('idx_external_suspense_owner', ['owner', 'status', 'createdAt', 'id'])
@Index('idx_external_suspense_evidence', ['evidenceHash', 'createdAt', 'id'])
@Index('idx_external_suspense_status', ['status', 'createdAt', 'id'])
@Check('chk_external_suspense_status', "status IN ('OPEN', 'HELD', 'CLEARED')")
@Check('chk_external_suspense_currency', "currency = 'NGN'")
@Check('chk_external_suspense_accounting_unit', "accounting_unit = 'CUSTOMER_FUNDS'")
@Check('chk_external_suspense_amount', 'amount_minor > 0')
@Check(
  'chk_external_suspense_reason',
  `reason IN (${EXTERNAL_SETTLEMENT_SUSPENSE_REASONS.map((r) => `'${r}'`).join(', ')})`,
)
@Check('chk_external_suspense_evidence_hash', "evidence_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_external_suspense_owner', "owner ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'")
@Check('chk_external_suspense_owner_principal', "owner_principal ~ '^[\\x20-\\x7E]{1,160}$'")
@Check('chk_external_suspense_cleared_metadata', "status <> 'CLEARED' OR cleared_at IS NOT NULL")
@Check(
  'chk_external_suspense_reversal_metadata',
  "reversal_journal_id IS NULL OR reversal_journal_id ~ '^[0-9a-f-]{36}$'",
)
@Check(
  'chk_external_suspense_lifecycle_state',
  "lifecycle_state IN ('PENDING_VERIFICATION', 'UNKNOWN', 'MANUAL_REVIEW', 'FAILED', 'CANCELLED')",
)
@Check('chk_external_suspense_correlation_id', "correlation_id ~ '^[\\x20-\\x7E]{1,255}$'")
@Check('chk_external_suspense_request_id', "request_id ~ '^[\\x20-\\x7E]{1,255}$'")
export class ExternalSuspenseEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'external_operation_id', type: 'uuid' })
  externalOperationId!: string;

  @Column({ name: 'external_operation_reference', type: 'varchar', length: 200 })
  externalOperationReference!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  @Column({ name: 'reason', type: 'varchar', length: 64 })
  reason!: string;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: ExternalSuspenseStatus;

  @Column({ name: 'owner', type: 'varchar', length: 120 })
  owner!: string;

  @Column({ name: 'owner_principal', type: 'varchar', length: 160 })
  ownerPrincipal!: string;

  @Column({ name: 'evidence_hash', type: 'char', length: 64 })
  evidenceHash!: string;

  @Column({ name: 'lifecycle_state', type: 'varchar', length: 32 })
  lifecycleState!: string;

  @Column({ name: 'rejection_code', type: 'varchar', length: 80 })
  rejectionCode!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 255 })
  requestId!: string;

  @Column({ name: 'reversal_journal_id', type: 'uuid', nullable: true })
  reversalJournalId!: string | null;

  @Column({ name: 'settlement_id', type: 'uuid', nullable: true })
  settlementId!: string | null;

  @Column({ name: 'cleared_at', type: 'timestamptz', nullable: true })
  clearedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
