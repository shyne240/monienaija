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
import type {
  B2FFinanceJournalClassification,
  B2FFinanceJournalLineV1,
  B2FFinanceJournalState,
  B2FFinanceSourceDocumentV1,
} from './b2f-journal-governance.types';

@Entity({ name: 'b2f_finance_journal_governance' })
@Index('uq_b2f_finance_journal_reference', ['financeJournalReference'], { unique: true })
@Index('idx_b2f_finance_journal_state', ['state', 'updatedAt'])
@Index('idx_b2f_finance_journal_period', ['periodKey', 'accountingDate'])
@Index('idx_b2f_finance_journal_a5', ['a5JournalId'], {
  unique: true,
  where: 'a5_journal_id IS NOT NULL',
})
@Check(
  'chk_b2f_finance_journal_state',
  "state IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','POSTING_REQUESTED','POSTED','FAILED','POSTING_UNKNOWN')",
)
@Check(
  'chk_b2f_finance_journal_scope',
  "book_key = 'finance.book.ng.primary' AND book_version = 1 AND legal_entity_reference = 'finance.legal-entity.ng.primary' AND accounting_basis = 'ACCRUAL' AND currency = 'NGN' AND accounting_unit = 'CUSTOMER_FUNDS'",
)
@Check(
  'chk_b2f_finance_journal_hashes',
  "request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND replay_hash ~ '^[a-f0-9]{64}$'",
)
@Check(
  'chk_b2f_finance_journal_totals',
  'total_debit_minor::numeric > 0 AND total_debit_minor::numeric = total_credit_minor::numeric',
)
@Check(
  'chk_b2f_finance_journal_posted',
  "state <> 'POSTED' OR (a5_journal_id IS NOT NULL AND a5_posted_at IS NOT NULL)",
)
export class B2FFinanceJournalGovernance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'finance_journal_reference', type: 'varchar', length: 100 })
  financeJournalReference!: string;
  @Column({ name: 'finance_journal_version', type: 'integer' }) financeJournalVersion!: 1;
  @Column({ type: 'varchar', length: 24 }) state!: B2FFinanceJournalState;
  @Column({ type: 'varchar', length: 24 }) classification!: B2FFinanceJournalClassification;
  @Column({ name: 'book_key', type: 'varchar', length: 100 }) bookKey!: 'finance.book.ng.primary';
  @Column({ name: 'book_version', type: 'integer' }) bookVersion!: 1;
  @Column({ name: 'legal_entity_reference', type: 'varchar', length: 120 })
  legalEntityReference!: 'finance.legal-entity.ng.primary';
  @Column({ name: 'accounting_basis', type: 'varchar', length: 20 }) accountingBasis!: 'ACCRUAL';
  @Column({ name: 'period_key', type: 'varchar', length: 100 }) periodKey!: string;
  @Column({ name: 'period_version', type: 'integer' }) periodVersion!: 1;
  @Column({ name: 'accounting_date', type: 'date' }) accountingDate!: string;
  @Column({ type: 'varchar', length: 3 }) currency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ type: 'varchar', length: 500 }) description!: string;
  @Column({ name: 'source_document', type: 'jsonb' }) sourceDocument!: B2FFinanceSourceDocumentV1;
  @Column({ type: 'jsonb' }) lines!: readonly B2FFinanceJournalLineV1[];
  @Column({ name: 'total_debit_minor', type: 'varchar', length: 80 }) totalDebitMinor!: string;
  @Column({ name: 'total_credit_minor', type: 'varchar', length: 80 }) totalCreditMinor!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'decision_hash', type: 'char', length: 64 }) decisionHash!: string;
  @Column({ name: 'replay_hash', type: 'char', length: 64 }) replayHash!: string;
  @Column({ name: 'approval_id', type: 'uuid', nullable: true }) approvalId!: string | null;
  @Column({ name: 'prepared_by', type: 'varchar', length: 160, nullable: true }) preparedBy!:
    | string
    | null;
  @Column({ name: 'prepared_roles', type: 'jsonb', default: () => "'[]'::jsonb" })
  preparedRoles!: readonly string[];
  @Column({ name: 'control_decision_reference', type: 'varchar', length: 100, nullable: true })
  controlDecisionReference!: string | null;
  @Column({ name: 'a5_idempotency_key', type: 'varchar', length: 255 }) a5IdempotencyKey!: string;
  @Column({ name: 'a5_journal_id', type: 'uuid', nullable: true }) a5JournalId!: string | null;
  @Column({ name: 'a5_posted_at', type: 'timestamptz', nullable: true }) a5PostedAt!: Date | null;
  @Column({ name: 'posting_failure_code', type: 'varchar', length: 100, nullable: true })
  postingFailureCode!: string | null;
  @Column({ name: 'posting_failure_message', type: 'varchar', length: 500, nullable: true })
  postingFailureMessage!: string | null;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true }) causationId!:
    | string
    | null;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
