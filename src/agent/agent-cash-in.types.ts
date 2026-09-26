import type { AuthorizationPrincipal } from '../authorization/authorization.types';

export interface AgentCashInInput {
  /** Acting Agent id (from authenticated principal) */
  agentId: string;
  /** Authenticated principal (from RuntimeAccessGuard) */
  principal: AuthorizationPrincipal;
  /** Transaction PIN (plaintext, never logged) */
  pin: string;
  /** Recipient identifier (Customer phone or MonieNaija receiving number, canonical 10-digit) */
  recipientIdentifier: string;
  /** Amount in minor units (kobo), string | number | bigint, must be >0 */
  amountMinor: string | number | bigint;
  /** Currency, must be NGN */
  currency: string;
  /** Caller-supplied idempotency key, 1..255, scoped to Agent via A12 */
  idempotencyKey: string;
  /** Optional transaction reference */
  reference?: string;
  /** Optional description */
  description?: string;
  /** Optional correlationId for tracing */
  correlationId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface AgentCashInResult {
  status: 'COMPLETED' | 'REPLAYED';
  journalId: string;
  agentId: string;
  recipientCustomerId: string;
  recipientReceivingNumber: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  correlationId?: string;
  reference?: string;
  createdAt: Date;
}
