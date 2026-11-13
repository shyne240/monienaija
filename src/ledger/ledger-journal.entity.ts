import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { LedgerJournalStatus } from './ledger.enums';

@Entity({ name: 'ledger_journals' })
@Index('uq_ledger_journals_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_ledger_journals_reversal_of', ['reversalOfJournalId'], {
  unique: true,
  where: 'reversal_of_journal_id IS NOT NULL',
})
export class LedgerJournal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64, default: 'CUSTOMER_FUNDS' })
  accountingUnit!: string;

  @Column({ type: 'varchar', length: 20, default: LedgerJournalStatus.POSTED })
  status!: LedgerJournalStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 255, nullable: true })
  correlationId!: string | null;

  @Column({ name: 'reversal_of_journal_id', type: 'uuid', nullable: true })
  reversalOfJournalId!: string | null;

  /**
   * Institutional context of the journal (ARENA 4 Phase 2). Derived from the posted accounts at
   * INSERT time — journals are immutable, so this can never be back-filled later. `null` means the
   * journal has no institutional context, and every account it touches must be unattributed or
   * platform-level.
   */
  @Column({ name: 'institution_id', type: 'uuid', nullable: true })
  institutionId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /** Total debits and credits, stored as a string-safe integer. */
  @Column({ name: 'total_minor', type: 'bigint', transformer: bigintTransformer })
  totalMinor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'posted_at', type: 'timestamptz' })
  postedAt!: Date;
}
