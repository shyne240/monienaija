import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalSettlementDecision, ExternalSettlementStatus } from './external-settlement.enums';
import { ExternalOperationLifecycleState } from './external-operation-lifecycle.enums';

@Entity({ name: 'external_settlements' })
@Index('uq_external_settlements_operation_id', ['externalOperationId'], { unique: true })
@Index('uq_external_settlements_idempotency', ['idempotencyScope', 'idempotencyKey'], {
  unique: true,
})
@Index('uq_external_settlements_journal_id', ['journalId'], { unique: true })
@Index('idx_external_settlements_customer', ['customerId', 'createdAt', 'id'])
@Index('idx_external_settlements_correlation', ['correlationId', 'createdAt', 'id'])
@Index('idx_external_settlements_status', ['status', 'createdAt', 'id'])
@Check('chk_external_settlements_partner', "partner_key = 'NIBSS_NIP'")
@Check(
  'chk_external_settlements_capability',
  "capability_key = 'external.wallet.withdrawal.settlement'",
)
@Check('chk_external_settlements_operation_type', "operation_type = 'OUTBOUND_BANK_SETTLEMENT'")
@Check('chk_external_settlements_decision', "decision IN ('SETTLE', 'REJECT')")
@Check('chk_external_settlements_status_value', "status IN ('POSTED', 'REVERSED')")
@Check('chk_external_settlements_currency', "currency = 'NGN'")
@Check('chk_external_settlements_accounting_unit', "accounting_unit = 'CUSTOMER_FUNDS'")
@Check('chk_external_settlements_amount', 'amount_minor > 0')
@Check('chk_external_settlements_request_hash', "request_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_external_settlements_idempotency_key',
  "idempotency_key ~ '^a6-settlement:[a-f0-9]{64}$'",
)
@Check('chk_external_settlements_evidence_hash', "evidence_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_external_settlements_evidence_value', "evidence_value ~ '^[\\x20-\\x7E]{1,255}$'")
@Check(
  'chk_external_settlements_posted_journal',
  "decision <> 'SETTLE' OR (journal_id IS NOT NULL AND posted_at IS NOT NULL AND reversal_journal_id IS NULL)",
)
@Check(
  'chk_external_settlements_reversal_metadata',
  'reversal_journal_id IS NULL OR reversal_posted_at IS NOT NULL',
)
@Check(
  'chk_external_settlements_evidence_type',
  "evidence_type IN ('OPERATION', 'TRANSACTION', 'SETTLEMENT')",
)
@Check(
  'chk_external_settlements_evidence_namespace',
  "evidence_namespace ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'",
)
@Check(
  'chk_external_settlements_evidence_source',
  "evidence_source IN ('ACKNOWLEDGEMENT', 'STATUS_QUERY', 'CALLBACK', 'STATEMENT', 'REPORT')",
)
@Check('chk_external_settlements_owner_principal', "owner_principal ~ '^[\\x20-\\x7E]{1,160}$'")
@Check(
  'chk_external_settlements_lifecycle_state',
  "lifecycle_state IN ('PENDING_VERIFICATION', 'SETTLED', 'FAILED', 'CANCELLED', 'REJECTED', 'COMPENSATED')",
)
export class ExternalSettlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'external_operation_id', type: 'uuid' })
  externalOperationId!: string;

  @Column({ name: 'external_operation_reference', type: 'varchar', length: 200 })
  externalOperationReference!: string;

  @Column({ name: 'partner_key', type: 'varchar', length: 64 })
  partnerKey!: string;

  @Column({ name: 'capability_key', type: 'varchar', length: 160 })
  capabilityKey!: string;

  @Column({ name: 'operation_type', type: 'varchar', length: 80 })
  operationType!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'wallet_account_id', type: 'uuid' })
  walletAccountId!: string;

  @Column({ name: 'customer_ledger_account_id', type: 'uuid' })
  customerLedgerAccountId!: string;

  @Column({ name: 'settlement_asset_ledger_account_id', type: 'uuid' })
  settlementAssetLedgerAccountId!: string;

  @Column({ name: 'decision', type: 'varchar', length: 16 })
  decision!: ExternalSettlementDecision;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: ExternalSettlementStatus;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  @Column({ name: 'lifecycle_state', type: 'varchar', length: 32 })
  lifecycleState!: ExternalOperationLifecycleState | 'SETTLED' | 'REJECTED' | 'COMPENSATED';

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'reversal_journal_id', type: 'uuid', nullable: true })
  reversalJournalId!: string | null;

  @Column({ name: 'evidence_type', type: 'varchar', length: 32 })
  evidenceType!: string;

  @Column({ name: 'evidence_value', type: 'varchar', length: 255 })
  evidenceValue!: string;

  @Column({ name: 'evidence_namespace', type: 'varchar', length: 120 })
  evidenceNamespace!: string;

  @Column({ name: 'evidence_source', type: 'varchar', length: 24 })
  evidenceSource!: string;

  @Column({ name: 'evidence_hash', type: 'char', length: 64 })
  evidenceHash!: string;

  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120 })
  idempotencyScope!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 255 })
  requestId!: string;

  @Column({ name: 'owner_principal', type: 'varchar', length: 160 })
  ownerPrincipal!: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'reversal_posted_at', type: 'timestamptz', nullable: true })
  reversalPostedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
