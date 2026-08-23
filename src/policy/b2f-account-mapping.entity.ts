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
import type { B2FAccountMappingStatus } from './b2f-account-mapping.types';

@Entity({ name: 'b2f_finance_account_mappings' })
@Index('uq_b2f_account_mapping_reference_version', ['mappingReference', 'mappingVersion'], {
  unique: true,
})
@Index(
  'uq_b2f_account_mapping_semantic_version',
  ['bookKey', 'classificationKey', 'a5LedgerAccountId', 'mappingVersion'],
  { unique: true },
)
@Index('uq_b2f_account_mapping_active_a5', ['bookKey', 'a5LedgerAccountId'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('idx_b2f_account_mapping_classification', ['bookKey', 'classificationKey', 'status'])
@Index('idx_b2f_account_mapping_effective', ['status', 'effectiveFrom', 'effectiveTo'])
@Index('idx_b2f_account_mapping_idempotency', ['idempotencyScope', 'idempotencyKey'])
@Index('idx_b2f_account_mapping_correlation', ['correlationId'])
@Check(
  'chk_b2f_account_mapping_status',
  "status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','EXPIRED','REVOKED','REJECTED')",
)
@Check(
  'chk_b2f_account_mapping_scope',
  "book_key='finance.book.ng.primary' AND book_version=1 AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'",
)
@Check(
  'chk_b2f_account_mapping_hashes',
  "request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND a5_snapshot_hash ~ '^[a-f0-9]{64}$'",
)
@Check('chk_b2f_account_mapping_dates', 'effective_to IS NULL OR effective_to > effective_from')
export class B2FFinanceAccountMapping {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'mapping_reference', type: 'varchar', length: 100 }) mappingReference!: string;
  @Column({ name: 'mapping_version', type: 'integer' }) mappingVersion!: number;
  @Column({ type: 'varchar', length: 24 }) status!: B2FAccountMappingStatus;
  @Column({ name: 'book_key', type: 'varchar', length: 100 }) bookKey!: 'finance.book.ng.primary';
  @Column({ name: 'book_version', type: 'integer' }) bookVersion!: 1;
  @Column({ name: 'classification_key', type: 'varchar', length: 160 }) classificationKey!: string;
  @Column({ name: 'classification_version', type: 'integer' }) classificationVersion!: 1;
  @Column({ name: 'a5_ledger_account_id', type: 'uuid' }) a5LedgerAccountId!: string;
  @Column({ name: 'observed_a5_code', type: 'varchar', length: 100 }) observedA5Code!: string;
  @Column({ name: 'observed_a5_name', type: 'varchar', length: 160 }) observedA5Name!: string;
  @Column({ name: 'observed_a5_account_type', type: 'varchar', length: 20 })
  observedA5AccountType!: string;
  @Column({ name: 'observed_a5_normal_balance', type: 'varchar', length: 6 })
  observedA5NormalBalance!: string;
  @Column({ name: 'observed_a5_active', type: 'boolean' }) observedA5Active!: boolean;
  @Column({ name: 'observed_a5_allow_negative_balance', type: 'boolean' })
  observedA5AllowNegativeBalance!: boolean;
  @Column({ type: 'varchar', length: 3 }) currency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ name: 'effective_from', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true }) effectiveTo!: Date | null;
  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120 })
  idempotencyScope!: 'b2.finance.account-mapping.idempotency.v1';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 }) idempotencyKey!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'decision_hash', type: 'char', length: 64 }) decisionHash!: string;
  @Column({ name: 'a5_snapshot_hash', type: 'char', length: 64 }) a5SnapshotHash!: string;
  @Column({ name: 'control_decision_reference', type: 'varchar', length: 100, nullable: true })
  controlDecisionReference!: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'created_roles', type: 'jsonb' }) createdRoles!: readonly string[];
  @Column({ name: 'approved_by', type: 'varchar', length: 160, nullable: true }) approvedBy!:
    | string
    | null;
  @Column({ name: 'last_reason', type: 'varchar', length: 500, nullable: true }) lastReason!:
    | string
    | null;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true }) causationId!:
    | string
    | null;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
