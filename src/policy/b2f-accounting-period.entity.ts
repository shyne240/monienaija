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

import type { B2FAccountingPeriodState } from './b2f-fiscal-period.types';

@Entity({ name: 'b2f_finance_accounting_periods' })
@Unique('uq_b2f_finance_period_key_version', ['periodKey', 'periodVersion'])
@Unique('uq_b2f_finance_period_reference', ['periodReference'])
@Unique('uq_b2f_finance_period_year_number', ['fiscalYearId', 'periodNumber'])
@Index('idx_b2f_finance_period_state', ['state', 'startDate'])
@Index('idx_b2f_finance_period_year', ['fiscalYearId', 'periodNumber'])
@Check('chk_b2f_finance_period_number', 'period_number BETWEEN 1 AND 12')
@Check(
  'chk_b2f_finance_period_state',
  "state IN ('PLANNED','OPEN','SOFT_CLOSED','HARD_CLOSED','REOPENED','RETIRED')",
)
@Check('chk_b2f_finance_period_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_b2f_finance_period_last_decision_hash',
  "last_decision_hash IS NULL OR last_decision_hash ~ '^[a-f0-9]{64}$'",
)
@Check('chk_b2f_finance_period_dates', 'end_date_exclusive > start_date')
export class B2FFinanceAccountingPeriod {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'period_reference', type: 'varchar', length: 100 }) periodReference!: string;
  @Column({ name: 'period_key', type: 'varchar', length: 100 }) periodKey!: string;
  @Column({ name: 'period_version', type: 'integer' }) periodVersion!: 1;
  @Column({ name: 'fiscal_year_id', type: 'uuid' }) fiscalYearId!: string;
  @Column({ name: 'fiscal_year_reference', type: 'varchar', length: 100 })
  fiscalYearReference!: string;
  @Column({ name: 'period_number', type: 'smallint' }) periodNumber!: number;
  @Column({ name: 'period_label', type: 'varchar', length: 7 }) periodLabel!: string;
  @Column({ name: 'start_date', type: 'date' }) startDate!: string;
  @Column({ name: 'end_date_exclusive', type: 'date' }) endDateExclusive!: string;
  @Column({ name: 'cutoff_at', type: 'timestamptz' }) cutoffAt!: Date;
  @Column({ type: 'varchar', length: 20 }) state!: B2FAccountingPeriodState;
  @Column({ name: 'state_version', type: 'integer', default: 1 }) stateVersion!: number;
  @Column({ name: 'definition_hash', type: 'char', length: 64 }) definitionHash!: string;
  @Column({ name: 'last_decision_hash', type: 'char', length: 64, nullable: true })
  lastDecisionHash!: string | null;
  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true }) openedAt!: Date | null;
  @Column({ name: 'soft_closed_at', type: 'timestamptz', nullable: true })
  softClosedAt!: Date | null;
  @Column({ name: 'hard_closed_at', type: 'timestamptz', nullable: true })
  hardClosedAt!: Date | null;
  @Column({ name: 'reopened_at', type: 'timestamptz', nullable: true }) reopenedAt!: Date | null;
  @Column({ name: 'reopen_expires_at', type: 'timestamptz', nullable: true })
  reopenExpiresAt!: Date | null;
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true }) retiredAt!: Date | null;
  @Column({ name: 'last_approval_id', type: 'uuid', nullable: true }) lastApprovalId!:
    | string
    | null;
  @Column({ name: 'last_reason', type: 'varchar', length: 500, nullable: true }) lastReason!:
    | string
    | null;
  @Column({ name: 'last_control_evidence', type: 'jsonb', default: () => "'{}'::jsonb" })
  lastControlEvidence!: Record<string, unknown>;
  @Column({ name: 'last_correlation_id', type: 'varchar', length: 255, nullable: true })
  lastCorrelationId!: string | null;
  @Column({ name: 'last_request_id', type: 'varchar', length: 255, nullable: true })
  lastRequestId!: string | null;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
