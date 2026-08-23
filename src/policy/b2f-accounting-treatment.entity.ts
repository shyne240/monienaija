import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type {
  B2FAccountingTreatmentDecisionV1,
  B2FAccountingTreatmentState,
  B2FSourceCategory,
} from './b2f-accounting-treatment.types';

@Entity({ name: 'b2f_finance_accounting_treatments' })
@Index('uq_b2f_finance_treatment_reference', ['treatmentReference'], { unique: true })
@Index('uq_b2f_finance_treatment_source', ['sourceCategory', 'sourceReference', 'sourceVersion'], {
  unique: true,
})
@Index('idx_b2f_finance_treatment_state', ['state', 'createdAt'])
@Index('idx_b2f_finance_treatment_period', ['periodKey', 'accountingDate'])
@Check('chk_b2f_finance_treatment_state', "state IN ('ADOPTED','JOURNAL_DRAFT_CREATED','REJECTED')")
@Check(
  'chk_b2f_finance_treatment_hashes',
  "request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND source_hash ~ '^[a-f0-9]{64}$'",
)
@Check(
  'chk_b2f_finance_treatment_scope',
  "book_key='finance.book.ng.primary' AND book_version=1 AND legal_entity_reference='finance.legal-entity.ng.primary' AND accounting_basis='ACCRUAL' AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'",
)
export class B2FFinanceAccountingTreatment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'treatment_reference', type: 'varchar', length: 100 })
  treatmentReference!: string;
  @Column({ name: 'treatment_version', type: 'integer' }) treatmentVersion!: 1;
  @Column({ type: 'varchar', length: 24 }) state!: B2FAccountingTreatmentState;
  @Column({ name: 'source_category', type: 'varchar', length: 48 })
  sourceCategory!: B2FSourceCategory;
  @Column({ name: 'source_owner', type: 'varchar', length: 8 }) sourceOwner!: 'B1' | 'A6' | 'A7';
  @Column({ name: 'source_reference', type: 'varchar', length: 200 }) sourceReference!: string;
  @Column({ name: 'source_version', type: 'integer' }) sourceVersion!: 1;
  @Column({ name: 'source_hash', type: 'char', length: 64 }) sourceHash!: string;
  @Column({ name: 'source_effective_at', type: 'timestamptz' }) sourceEffectiveAt!: Date;
  @Column({ name: 'book_key', type: 'varchar', length: 100 }) bookKey!: 'finance.book.ng.primary';
  @Column({ name: 'book_version', type: 'integer' }) bookVersion!: 1;
  @Column({ name: 'legal_entity_reference', type: 'varchar', length: 120 })
  legalEntityReference!: 'finance.legal-entity.ng.primary';
  @Column({ name: 'accounting_basis', type: 'varchar', length: 20 }) accountingBasis!: 'ACCRUAL';
  @Column({ type: 'varchar', length: 3 }) currency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ name: 'period_key', type: 'varchar', length: 100 }) periodKey!: string;
  @Column({ name: 'period_version', type: 'integer' }) periodVersion!: 1;
  @Column({ name: 'accounting_date', type: 'date' }) accountingDate!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'decision_hash', type: 'char', length: 64 }) decisionHash!: string;
  @Column({ name: 'control_decision_reference', type: 'varchar', length: 100, nullable: true })
  controlDecisionReference!: string | null;
  @Column({ name: 'finance_journal_reference', type: 'varchar', length: 100, nullable: true })
  financeJournalReference!: string | null;
  @Column({ type: 'jsonb' }) decision!: B2FAccountingTreatmentDecisionV1;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
