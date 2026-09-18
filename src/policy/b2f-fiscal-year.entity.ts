import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import type { B2FFiscalYearState } from './b2f-fiscal-period.types';

@Entity({ name: 'b2f_finance_fiscal_years' })
@Unique('uq_b2f_finance_fiscal_year_key_version', ['fiscalYearKey', 'fiscalYearVersion'])
@Unique('uq_b2f_finance_fiscal_year_reference', ['fiscalYearReference'])
@Index('idx_b2f_finance_fiscal_year_state', ['state'])
@Check('chk_b2f_finance_fiscal_year_value', 'fiscal_year BETWEEN 2000 AND 9999')
@Check('chk_b2f_finance_fiscal_year_state', "state IN ('PLANNED','ACTIVE','CLOSED','RETIRED')")
@Check(
  'chk_b2f_finance_fiscal_year_scope',
  "book_key = 'finance.book.ng.primary' AND book_version = 1 AND legal_entity_reference = 'finance.legal-entity.ng.primary' AND jurisdiction = 'NG' AND accounting_basis = 'ACCRUAL' AND functional_currency = 'NGN' AND accounting_unit = 'CUSTOMER_FUNDS' AND calendar_key = 'finance.calendar.ng.gregorian' AND calendar_version = 1",
)
@Check('chk_b2f_finance_fiscal_year_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
@Check('chk_b2f_finance_fiscal_year_dates', 'end_date_exclusive > start_date')
export class B2FFinanceFiscalYear {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'fiscal_year_reference', type: 'varchar', length: 100 })
  fiscalYearReference!: string;
  @Column({ name: 'fiscal_year_key', type: 'varchar', length: 100 }) fiscalYearKey!: string;
  @Column({ name: 'fiscal_year_version', type: 'integer' }) fiscalYearVersion!: 1;
  @Column({ name: 'fiscal_year', type: 'integer' }) fiscalYear!: number;
  @Column({ type: 'varchar', length: 20 }) state!: B2FFiscalYearState;
  @Column({ name: 'book_key', type: 'varchar', length: 100 }) bookKey!: 'finance.book.ng.primary';
  @Column({ name: 'book_version', type: 'integer' }) bookVersion!: 1;
  @Column({ name: 'legal_entity_reference', type: 'varchar', length: 120 })
  legalEntityReference!: 'finance.legal-entity.ng.primary';
  @Column({ type: 'varchar', length: 2 }) jurisdiction!: 'NG';
  @Column({ name: 'accounting_basis', type: 'varchar', length: 20 }) accountingBasis!: 'ACCRUAL';
  @Column({ name: 'functional_currency', type: 'varchar', length: 3 }) functionalCurrency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ name: 'calendar_key', type: 'varchar', length: 120 })
  calendarKey!: 'finance.calendar.ng.gregorian';
  @Column({ name: 'calendar_version', type: 'integer' }) calendarVersion!: 1;
  @Column({ name: 'start_date', type: 'date' }) startDate!: string;
  @Column({ name: 'end_date_exclusive', type: 'date' }) endDateExclusive!: string;
  @Column({ name: 'definition_hash', type: 'char', length: 64 }) definitionHash!: string;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'last_correlation_id', type: 'varchar', length: 255 }) lastCorrelationId!: string;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
