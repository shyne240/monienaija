import type { AuthorizationPrincipal } from '../authorization/authorization.types';

export interface AgentCashOutInput {
  /** Acting Agent id (from authenticated principal) */
  agentId: string;
  /** Agent authenticated principal (from RuntimeAccessGuard) */
  agentPrincipal: AuthorizationPrincipal;
  /** Agent transaction PIN (plaintext, never logged) */
  agentPin: string;
  /** Customer id whose wallet is being debited (must be the payer) */
  customerId: string;
  /** Customer transaction PIN (plaintext, never logged) */
  customerPin: string;
  /** MFA challenge id for OTP (issued via MfaExecutionService) */
  mfaChallengeId: string;
  /** OTP code / hash provided by Customer (will be verified as providedHash) */
  otp: string;
  /** Amount in minor units (kobo), must be >0 */
  amountMinor: string | number | bigint;
  /** Currency, must be NGN */
  currency: string;
  /** Caller-supplied idempotency key, 1..255, scoped via A12 per Agent */
  idempotencyKey: string;
  /** Optional reference */
  reference?: string;
  /** Optional description */
  description?: string;
  /** Optional correlationId */
  correlationId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface AgentCashOutResult {
  status: 'COMPLETED' | 'REPLAYED';
  journalId: string;
  agentId: string;
  customerId: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  correlationId?: string;
  reference?: string;
  createdAt: Date;
}
