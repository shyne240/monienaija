import type { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from './ledger.enums';
import type { LedgerJournal } from './ledger-journal.entity';
import type { LedgerLine } from './ledger-line.entity';

export interface CreateLedgerAccountCommand {
  code: string;
  name: string;
  accountType: LedgerAccountType;
  normalBalance?: LedgerNormalBalance;
  currency: string;
  accountingUnit?: string;
  allowNegativeBalance?: boolean;
}

export interface PostJournalLineCommand {
  accountId: string;
  direction: LedgerEntryDirection;
  amountMinor: string | number | bigint;
}

export interface PostJournalCommand {
  idempotencyKey: string;
  currency: string;
  accountingUnit?: string;
  reference?: string;
  description?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  lines: PostJournalLineCommand[];
  reversalOfJournalId?: string;
}

export interface LedgerLineView {
  id: string;
  journalId: string;
  accountId: string;
  lineNumber: number;
  direction: LedgerEntryDirection;
  amountMinor: string;
  currency: string;
  accountingUnit: string;
  createdAt: Date;
}

export interface LedgerJournalView {
  id: string;
  idempotencyKey: string;
  currency: string;
  accountingUnit: string;
  status: string;
  reference: string | null;
  description: string | null;
  correlationId: string | null;
  reversalOfJournalId: string | null;
  metadata: Record<string, unknown>;
  totalMinor: string;
  createdAt: Date;
  postedAt: Date;
  lines: LedgerLineView[];
}

export interface LedgerAccountView {
  id: string;
  code: string;
  name: string;
  accountType: LedgerAccountType;
  normalBalance: LedgerNormalBalance;
  currency: string;
  accountingUnit: string;
  allowNegativeBalance: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerAccountBalance {
  accountId: string;
  currency: string;
  accountingUnit: string;
  balanceMinor: string;
}

export type JournalAndLines = {
  journal: LedgerJournal;
  lines: LedgerLine[];
};
