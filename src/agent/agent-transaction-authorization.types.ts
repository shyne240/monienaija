import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AgentService } from './agent-service.enum';
import type { CapabilityReason } from './agent-service-capability.types';

export type AgentTransactionAuthorizationDecision = 'AUTHORIZED' | 'DENIED';

/**
 * Fail-closed taxonomy for A11. Reuses A10 capability reasons and adds
 * authentication / principal / PIN reasons. Keep aligned with existing
 * AuthorizationDenialReason conventions where possible.
 */
export type AgentTransactionAuthorizationReason =
  | CapabilityReason
  | 'UNAUTHENTICATED'
  | 'INVALID_PRINCIPAL'
  | 'PRINCIPAL_NOT_AGENT'
  | 'PRINCIPAL_MISMATCH'
  | 'WORKFORCE_NOT_PERMITTED'
  | 'PIN_REQUIRED'
  | 'PIN_NOT_FOUND'
  | 'PIN_INVALID'
  | 'PIN_LOCKED'
  | 'PIN_POLICY_VIOLATION';

export interface AgentAuthorizedTransactionContext {
  /** Acting Agent id (uuid) */
  agentId: string;
  /** Authenticated principal that was authorized */
  principal: AuthorizationPrincipal;
  /** Raw service string as requested */
  service: string;
  /** Normalized canonical service */
  canonicalService: AgentService;
  /** Agent lifecycle status at authorization time */
  agentStatus: string;
  /** AgentClass id */
  agentClassId: string;
  /** Whether class is active (always true for AUTHORIZED) */
  agentClassActive: boolean;
  /** Applicable services as stored on class (for downstream limits) */
  applicableServices: unknown;
  /** Applicable limits as stored on class (passthrough, no ₦1.2m hardcoding) */
  applicableLimits: unknown;
  /** Authorization timestamp */
  authorizedAt: Date;
  /**
   * ARENA 5 — audit id of the bound PIN verification. Present only when the caller supplied a
   * `financialBinding` and the PIN verified; carries the binding for financial commands to
   * re-check inside their transaction.
   */
  pinAuditId?: string;
}

export interface AgentTransactionAuthorizationResult {
  allowed: boolean;
  decision: AgentTransactionAuthorizationDecision;
  reason: AgentTransactionAuthorizationReason;
  agentId: string;
  service: string;
  canonicalService: AgentService | null;
  principal?: AuthorizationPrincipal;
  context?: AgentAuthorizedTransactionContext;
  // Convenience mirrors from capability evaluation for downstream
  agentStatus?: string;
  agentClassId?: string;
  agentClassActive?: boolean;
  applicableServices?: unknown;
  applicableLimits?: unknown;
  /** ARENA 5 — bound PIN audit id (same semantics as `AgentAuthorizedTransactionContext.pinAuditId`). */
  pinAuditId?: string;
}

export interface AuthorizeAgentTransactionInput {
  /** Target Agent id (uuid) that is to be authorized */
  agentId: string;
  /** Requested service name (raw, e.g., 'CASH_IN' or alias 'CASH_TO_WALLET') */
  service: string;
  /** Transaction PIN (plaintext, never logged). Undefined/empty → PIN_REQUIRED */
  pin?: string;
  /** Authenticated principal (from RuntimeAccessGuard). Undefined → UNAUTHENTICATED */
  principal?:
    | AuthorizationPrincipal
    | { type: string; agentId?: string; customerId?: string; principalId?: string };
  /** Optional actor override for PIN audit (defaults to principalId or agentId) */
  actor?: string;
  /**
   * ARENA 5 — optional financial binding for the PIN audit. When present, the produced
   * PIN_VERIFIED audit records the request hash and session so a financial command can re-bind
   * the exact authorization inside its transaction. Shape is validated by the authentication
   * service; anything malformed is refused rather than silently dropped.
   */
  financialBinding?: { requestHash: string; sessionId: string };
}
