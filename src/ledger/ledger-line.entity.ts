import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { bigintTransformer } from '../common/bigint.transformer';
import { LedgerEntryDirection } from './ledger.enums';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerJournal } from './ledger-journal.entity';

@Entity({ name: 'ledger_lines' })
@Unique('uq_ledger_lines_journal_line_number', ['journalId', 'lineNumber'])
@Index('idx_ledger_lines_account_created', ['ledgerAccountId', 'createdAt'])
@Index('idx_ledger_lines_journal', ['journalId'])
@Check('chk_ledger_lines_amount_positive', 'amount_minor > 0')
export class LedgerLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @ManyToOne(() => LedgerJournal, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_id' })
  journal!: LedgerJournal;

  @Column({ name: 'ledger_account_id', type: 'uuid' })
  ledgerAccountId!: string;

  @ManyToOne(() => LedgerAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ledger_account_id' })
  ledgerAccount!: LedgerAccount;

  @Column({ name: 'line_number', type: 'smallint' })
  lineNumber!: number;

  @Column({ type: 'varchar', length: 6 })
  direction!: LedgerEntryDirection;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintTransformer })
  amountMinor!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
