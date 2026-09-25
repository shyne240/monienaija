import type { AgentAuthorizedTransactionContext } from './agent-transaction-authorization.types';
import type { LedgerEntryDirection } from '../ledger/ledger.enums';

export type AgentFinancialExecutionStatus = 'COMPLETED' | 'REPLAYED';

export interface AgentFinancialExecutionInput {
  /** Already-authorized context from A11 (must be AUTHORIZED) */
  authorizedContext: AgentAuthorizedTransactionContext;
  /** Caller-supplied idempotency key (1..255 chars), scoped to Agent via implementation */
  idempotencyKey: string;
  /** Currency — foundation enforces NGN only */
  currency: string;
  accountingUnit?: string;
  /** Double-entry lines (2..100, balanced, NGN) */
  lines: Array<{
    accountId: string;
    direction: LedgerEntryDirection;
    amountMinor: string | number | bigint;
  }>;
  reference?: string;
  description?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  /** Test-only hook to simulate failure after journal for rollback verification */
  _simulateFailureAfterJournal?: boolean;
}

export interface AgentFinancialExecutionResult {
  status: AgentFinancialExecutionStatus;
  journalId: string;
  journal?: unknown; // LedgerJournalView when available
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  agentId: string;
  createdAt: Date;
  // For replay, points to original
  replayedFrom?: string;
}

export interface AgentFinancialExecutionView {
  status: AgentFinancialExecutionStatus;
  journalId: string;
  idempotencyKey: string;
  requestHash: string;
  agentId: string;
  currency: string;
  accountingUnit: string;
  totalMinor: string;
  createdAt: Date;
  replayed: boolean;
}
