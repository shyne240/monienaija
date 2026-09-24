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
