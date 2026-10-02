import { ApiClient } from './api-client';

/**
 * Agent Mobile — typed bindings for the exact backend contracts
 * (src/agent-authentication, verified by V1-AGENT-MFA-API-01/a21 suites).
 * Only authentication + identity contracts are bound in the foundation task;
 * financial surfaces arrive in later phases per the approved specification.
 */

export interface AgentSession {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  agentId: string;
  sessionId: string;
}

export interface AgentLoginRotationRequired {
  rotationRequired: true;
  agentId: string;
}

export type AgentLoginResult = AgentSession | AgentLoginRotationRequired;

export function isRotationRequired(result: AgentLoginResult): result is AgentLoginRotationRequired {
  return (result as AgentLoginRotationRequired).rotationRequired === true;
}

export interface AgentIdentity {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/agents/sessions (backend alias /agents/login unused by design). */
export async function agentLogin(agentId: string, password: string): Promise<AgentLoginResult> {
  return ApiClient.post<AgentLoginResult>('api/v1/agents/sessions', { agentId, password });
}

/** POST /api/v1/agents/credentials/rotate — mandatory temporary-credential rotation. */
export async function agentRotateCredentials(
  agentId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AgentSession> {
  return ApiClient.post<AgentSession>('api/v1/agents/credentials/rotate', {
    agentId,
    currentPassword,
    newPassword,
  });
}

/** POST /api/v1/agents/sessions/logout — revokes the presented Bearer session. */
export async function agentLogout(): Promise<{ revoked: boolean }> {
  return ApiClient.post<{ revoked: boolean }>('api/v1/agents/sessions/logout', {});
}

/** GET /api/v1/agents/me — agent identity (never hashes/PIN/secrets). */
export async function getAgentMe(): Promise<AgentIdentity> {
  return ApiClient.get<AgentIdentity>('api/v1/agents/me');
}

/* ---------------------------------------------------------------------------
 * Operating-context read contracts (V1-AGENT-MOBILE-02) — exact shapes
 * verified from src/agent/agent-app.controller.ts. No fields invented.
 * ------------------------------------------------------------------------- */

export interface AgentClassView {
  id: string;
  reference: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** GET /agents/me/profile — superset of /agents/me with agent class. */
export interface AgentProfile extends AgentIdentity {
  agentClassId: string | null;
  agentClass: AgentClassView | null;
}

export async function getAgentProfile(): Promise<AgentProfile> {
  return ApiClient.get<AgentProfile>('api/v1/agents/me/profile');
}

/** GET /agents/me/financial-position — ledger-derived balance (minor units). */
export interface AgentFinancialPosition {
  agentId: string;
  currency: string;
  balanceMinor: string;
  availableBalanceMinor: string;
  walletExists: boolean;
  walletId?: string;
  ledgerAccountId?: string;
  status?: string;
}

export async function getAgentFinancialPosition(): Promise<AgentFinancialPosition> {
  return ApiClient.get<AgentFinancialPosition>('api/v1/agents/me/financial-position');
}

/** Canonical backend service identifiers (agents/me/capabilities). */
export type AgentCanonicalService =
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'CASH_TO_CASH'
  | 'AGENT_FUNDING'
  | 'AGENT_DEFUNDING';

export interface AgentCapabilityEvaluation {
  service: string;
  canonicalService: AgentCanonicalService;
  allowed: boolean;
  reason: string | null;
}

/** GET /agents/me/capabilities — backend-authoritative capability evaluation. */
export interface AgentCapabilities {
  agentId: string;
  permittedServices: AgentCanonicalService[];
  evaluations: AgentCapabilityEvaluation[];
}

export async function getAgentCapabilities(): Promise<AgentCapabilities> {
  return ApiClient.get<AgentCapabilities>('api/v1/agents/me/capabilities');
}

/** Raw contract of GET /agents/me/receiving-number. */
export interface AgentReceivingNumberView {
  id: string;
  agentId: string;
  receivingNumber: string;
  status: string;
  assignedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentReceivingNumberNone {
  agentId: string;
  receivingNumber: null;
  status: 'NONE';
}

export async function getAgentReceivingNumber(): Promise<AgentReceivingNumberView | null> {
  const raw: AgentReceivingNumberView | AgentReceivingNumberNone =
    await ApiClient.get('api/v1/agents/me/receiving-number');
  // Backend answers {receivingNumber: null, status: 'NONE'} when unassigned —
  // normalize to null ("not assigned"); otherwise the full assignment view.
  if (raw && raw.receivingNumber === null) {
    return null;
  }
  return raw as AgentReceivingNumberView;
}

/** GET /agents/me/outlets — safe projection list (array, possibly empty). */
export interface AgentOutlet {
  id: string;
  agentId: string;
  reference: string;
  code: string;
  name: string;
  displayName: string | null;
  status: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getAgentOutlets(): Promise<AgentOutlet[]> {
  return ApiClient.get<AgentOutlet[]>('api/v1/agents/me/outlets');
}

/** GET /agents/me/terminals — safe projection list (array, possibly empty). */
export interface AgentTerminal {
  id: string;
  agentId: string;
  outletId: string | null;
  reference: string;
  code: string;
  label: string | null;
  status: string;
  serialNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getAgentTerminals(): Promise<AgentTerminal[]> {
  return ApiClient.get<AgentTerminal[]>('api/v1/agents/me/terminals');
}

/**
 * User-facing message for API failures (§9 error handling):
 * raw server errors are not surfaced verbatim when not meaningful to an agent.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) return 'Your session has expired. Please log in again.';
    if (status === 403) return 'This information is not available for your account.';
    if (typeof status === 'number' && status >= 500) return 'The service is temporarily unavailable. Please retry.';
    return error.message;
  }
  if (error instanceof Error && error.name === 'NetworkError') {
    return 'No network connection. Check your connection and retry.';
  }
  return 'Something went wrong. Please retry.';
}
