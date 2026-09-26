import type { AuthorizationPrincipal } from '../authorization/authorization.types';

export interface AgentCashToCashInput {
  agentId: string;
  agentPrincipal: AuthorizationPrincipal;
  agentPin: string;
  beneficiaryPhone: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  reference?: string;
  description?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCashToCashResult {
  status: 'COMPLETED' | 'REPLAYED';
  transferId: string;
  journalId: string;
  agentId: string;
  beneficiaryPhone: string;
  principalMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
  currency: string;
  amountMinor: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  correlationId?: string;
  reference?: string;
  createdAt: Date;
  // One-time plaintext transfer code — only returned on initial COMPLETED, never on REPLAYED
  // and never persisted. Caller must deliver to beneficiary via secure channel.
  transferCode?: string;
}
