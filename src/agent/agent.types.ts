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
