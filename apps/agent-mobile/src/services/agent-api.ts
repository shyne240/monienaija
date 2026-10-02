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

/* ---------------------------------------------------------------------------
 * MFA challenge contract (V1-AGENT-MFA-API-01, consumed by V1-AGENT-MOBILE-03).
 * POST /agents/me/mfa-challenges — issue-only surface: it NEVER returns the
 * OTP, and there is NO standalone Agent-facing verification endpoint (the OTP
 * is supplied to the transaction execution endpoints themselves in a later
 * phase). Exactly two purposes exist; no others are ever sent.
 * ------------------------------------------------------------------------- */

export type MfaChallengePurpose = 'WALLET_TO_CASH' | 'CASH_TO_CASH_CLAIM';

export interface AgentMfaChallenge {
  challengeId: string;
  customerId: string;
  purpose: MfaChallengePurpose;
  deliveryChannel: string;
  destinationMasked: string;
  delivered: boolean;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Issue a customer-MFA challenge for a future transaction step.
 * `ttlSeconds` is forwarded ONLY when the caller explicitly supplies it —
 * otherwise the backend default applies and the server still reports the
 * effective ttl in the response.
 */
export async function requestAgentMfaChallenge(
  customerId: string,
  purpose: MfaChallengePurpose,
  ttlSeconds?: number,
): Promise<AgentMfaChallenge> {
  const body: Record<string, unknown> = { customerId, purpose };
  if (ttlSeconds !== undefined) {
    body.ttlSeconds = ttlSeconds;
  }
  return ApiClient.post<AgentMfaChallenge>('api/v1/agents/me/mfa-challenges', body);
}

/* ---------------------------------------------------------------------------
 * Cash→Wallet (V1-AGENT-MOBILE-04) — exact backend contract
 * (src/agent/agent-cash-in.controller.ts + recipient-resolution): the
 * backend is the sole authority for resolution, fees, limits, authorization,
 * idempotency and ledger effects. PIN is required by the contract (body
 * field); the app never stores/logs it. There is NO customer OTP/MFA in this
 * flow — the backend does not require it, so none is invented.
 *
 * IMPORTANT: this endpoint answers 401 for PIN_invalid/locked (A11). That
 * 401 is NOT session expiry — therefore agentCashIn opts out of the
 * automatic session purge (the purge stays intact for every other call).
 * ------------------------------------------------------------------------- */

/** Recipient identity as resolved by GET /recipients/resolve (agent-facing). */
export interface ResolvedRecipientView {
  ownerType: 'CUSTOMER' | 'AGENT';
  receivingNumber: string;
  display: string;
  status: string;
}

/**
 * GET /recipients/resolve?identifier=... — identity needed to credit the
 * right wallet. The backend internal `ownerId` is deliberately stripped at
 * the binding layer: agent UI must never see internal customer IDs.
 */
export async function resolveAgentRecipient(identifier: string): Promise<ResolvedRecipientView> {
  const raw = await ApiClient.get<ResolvedRecipientView & { ownerId: string }>(
    `api/v1/recipients/resolve?identifier=${encodeURIComponent(identifier.trim())}`,
  );
  return {
    ownerType: raw.ownerType,
    receivingNumber: raw.receivingNumber,
    display: raw.display,
    status: raw.status,
  };
}

export interface AgentCashInRequest {
  recipientIdentifier: string;
  /** kobo, /^[1-9]\d*$/ — derived from UI naira input only (never computed for money logic). */
  amountMinor: string;
  currency: 'NGN';
  idempotencyKey: string;
  pin: string;
}

/** Server transaction result for Cash→Wallet (201). Internal ledger/customer
 * ids stay typed for truthfulness but are never rendered by the UI. */
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
  createdAt: string;
}

/** POST /agents/cash-in (201). Idempotency key in the contract body (A12)
 * AND in the established idempotency-key header. PIN failure surfaces as
 * 401 — never purge the session for that. */
export async function agentCashIn(request: AgentCashInRequest): Promise<AgentCashInResult> {
  return ApiClient.post<AgentCashInResult>(
    'api/v1/agents/cash-in',
    { ...request },
    { idempotencyKey: request.idempotencyKey, preserveSessionOn401: true },
  );
}

/* ---------------------------------------------------------------------------
 * Unified Agent transaction history (V1-AGENT-MOBILE-06).
 * GET /agents/me/transactions — verified against
 * src/agent/agent-transaction-history.service.ts (V1-AGENT-HISTORY-01).
 * The response is the backend's SAFE projection: no journal internals, no
 * ledger account ids, no request hashes, no PIN/OTP/hash material, no
 * workforce identity. The UI additionally never renders the row `id` (it is
 * used only for React keys / cache lookups) and never renders `counterparty
 * .aggregatorId` — identical to the audit's "no internal IDs" rule.
 * ------------------------------------------------------------------------- */

export type AgentHistoryType =
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'CASH_TO_CASH'
  | 'AGENT_FUNDING'
  | 'AGENT_DEFUNDING';

export type AgentHistoryDirection = 'DEBIT' | 'CREDIT' | 'UNKNOWN';

export type AgentHistoryCounterparty =
  | { type: 'CUSTOMER'; beneficiaryPhone?: string | null }
  | { type: 'AGENT' }
  | { type: 'AGGREGATOR'; aggregatorId?: string | null }
  | { type: 'WORKFORCE' }
  | null;

export interface AgentHistoryCommission {
  commissionMinor: string;
  payable: boolean;
  treatment: string | null;
}

export interface AgentHistoryItem {
  id: string;
  type: string;
  status: string;
  amountMinor: string;
  currency: string;
  direction: string;
  createdAt: string;
  completedAt: string | null;
  reference: string | null;
  narration: string | null;
  feeMinor: string;
  counterparty: AgentHistoryCounterparty;
  commission: AgentHistoryCommission | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface AgentHistoryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface AgentUnifiedHistoryResponse {
  items: AgentHistoryItem[];
  pagination: AgentHistoryPagination;
}

export interface AgentTransactionsQuery {
  page?: number;
  limit?: number;
  type?: AgentHistoryType;
}

/** GET /agents/me/transactions — project-supported paging + type filter only. */
export async function getAgentTransactions(query: AgentTransactionsQuery = {}): Promise<AgentUnifiedHistoryResponse> {
  const params = new URLSearchParams();
  if (query.page != null) params.set('page', String(query.page));
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.type) params.set('type', query.type);
  const qs = params.toString();
  return ApiClient.get<AgentUnifiedHistoryResponse>(
    `api/v1/agents/me/transactions${qs ? `?${qs}` : ''}`,
  );
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
