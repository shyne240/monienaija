import type { AgentStatus } from './agent.enums';

/**
 * Stage 1 Agent identity commands and views (ADR-0093 §8).
 *
 * Nothing here carries financial meaning. There is deliberately no wallet,
 * account, binding, balance, number, credential or PIN field.
 */

export interface CreateAgentCommand {
  /**
   * Caller-supplied registry/correlation reference, normalized to lowercase
   * safe characters. NOT the Agent Code (open product decision C1/O3).
   */
  reference: string;
  /** Optional, non-authoritative trace to a Customer (ADR-0093 §8.5). */
  operatorCustomerId?: string | null;
  /** Actor recorded on the immutable audit event. */
  actor: string;
  correlationId?: string;
  requestId?: string;
}

export interface ListAgentsQuery {
  status?: AgentStatus;
  page?: number;
  limit?: number;
}

export interface AgentView {
  id: string;
  reference: string;
  status: AgentStatus;
  operatorCustomerId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** F-2 — command to provision an Agent's dedicated e-float account. */
export interface ProvisionAgentFloatAccountCommand {
  agentId: string;
  actor: string;
  idempotencyKey?: string;
  correlationId?: string;
  requestId?: string;
}

/**
 * F-1 — the deterministic financial identity of an Agent's e-float.
 *
 * Carries no balance: balance is read through the existing ledger authority
 * and is never cached here.
 */
export interface AgentFloatAccountView {
  agentId: string;
  agentWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  currency: string;
  accountingUnit: string;
  state: string;
  bindingId: string;
}

/**
 * F-4C — read-only Agent settlement position.
 *
 * Answers "for Agent X, what is the current electronic e-float balance?" using
 * the EXISTING ledger authority. There is no balance column and no second
 * source of truth: `balanceMinor` is read from LedgerService at query time.
 *
 * Transaction history is intentionally not duplicated here; it is served by the
 * existing owner-agnostic wallet transaction history keyed on
 * `walletAccountId`, which is returned below so the caller can reach it.
 */
export interface AgentSettlementPositionView {
  agentId: string;
  agentReference: string;
  agentStatus: string;
  agentWalletId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  currency: string;
  accountingUnit: string;
  bindingState: string;
  /** Electronic e-float, read from the ledger. Physical cash is NOT included. */
  balanceMinor: string;
  asOf: string;
}
