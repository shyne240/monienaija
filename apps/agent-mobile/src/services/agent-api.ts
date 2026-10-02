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
  const raw: AgentReceivingNumberView | AgentReceivingNumberNone = await ApiClient.get(
    'api/v1/agents/me/receiving-number',
  );
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
 * Recipient / Customer Resolution (GET /recipients/resolve)
 * ------------------------------------------------------------------------- */

/** Recipient identity as resolved by GET /recipients/resolve (agent-facing). */
export interface ResolvedRecipientView {
  ownerType: 'CUSTOMER' | 'AGENT';
  receivingNumber: string;
  display: string;
  status: string;
}

/**
 * Customer recipient with internal customerId (used exclusively by the
 * API binding layer for MFA challenge issuance and cash-out requests;
 * NEVER rendered in user-facing UI).
 */
export interface ResolvedCustomerRecipientView extends ResolvedRecipientView {
  customerId: string;
}

/**
 * GET /recipients/resolve?identifier=... — identity needed to credit/debit.
 * The backend internal `ownerId` is stripped for generic views, or assigned
 * to `customerId` internally for authorized financial commands.
 */
export async function resolveAgentRecipient(identifier: string): Promise<ResolvedRecipientView> {
  const raw = await ApiClient.get<{
    ownerType: 'CUSTOMER' | 'AGENT';
    ownerId: string;
    receivingNumber: string;
    display: string;
    status: string;
  }>(`api/v1/recipients/resolve?identifier=${encodeURIComponent(identifier.trim())}`);
  return {
    ownerType: raw.ownerType,
    receivingNumber: raw.receivingNumber,
    display: raw.display,
    status: raw.status,
  };
}

export async function resolveCustomerRecipient(
  identifier: string,
): Promise<ResolvedCustomerRecipientView> {
  const raw = await ApiClient.get<{
    ownerType: 'CUSTOMER' | 'AGENT';
    ownerId: string;
    receivingNumber: string;
    display: string;
    status: string;
  }>(`api/v1/recipients/resolve?identifier=${encodeURIComponent(identifier.trim())}`);
  return {
    ownerType: raw.ownerType,
    customerId: raw.ownerId,
    receivingNumber: raw.receivingNumber,
    display: raw.display,
    status: raw.status,
  };
}

/* ---------------------------------------------------------------------------
 * Cash→Wallet (V1-AGENT-MOBILE-04) — exact backend contract
 * (src/agent/agent-cash-in.controller.ts + recipient-resolution).
 * ------------------------------------------------------------------------- */

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

/** POST /agents/cash-in (201). PIN failure surfaces as 401 — never purge session. */
export async function agentCashIn(request: AgentCashInRequest): Promise<AgentCashInResult> {
  return ApiClient.post<AgentCashInResult>(
    'api/v1/agents/cash-in',
    { ...request },
    { idempotencyKey: request.idempotencyKey, preserveSessionOn401: true },
  );
}

/* ---------------------------------------------------------------------------
 * Cash→Cash Initiation (V1-AGENT-MOBILE-07) — exact backend contract
 * (src/agent/agent-cash-to-cash.controller.ts + agent-cash-to-cash.service.ts).
 * ------------------------------------------------------------------------- */

export interface AgentCashToCashRequest {
  beneficiaryPhone: string;
  /** kobo minor units, /^[1-9]\d*$/ */
  amountMinor: string;
  currency: 'NGN';
  idempotencyKey: string;
  agentPin: string;
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
  createdAt: string;
  /** One-time plaintext transfer code — returned ONLY on initial 201 COMPLETED, never on replay. */
  transferCode?: string;
}

/** Safe projection of result for navigation/receipts — transferCode is strictly omitted. */
export type SafeCashToCashResult = Omit<AgentCashToCashResult, 'transferCode'>;

/** POST /agents/cash-to-cash (201). PIN failure surfaces as 401 (preserve session). */
export async function agentCashToCash(
  request: AgentCashToCashRequest,
): Promise<AgentCashToCashResult> {
  return ApiClient.post<AgentCashToCashResult>(
    'api/v1/agents/cash-to-cash',
    { ...request },
    { idempotencyKey: request.idempotencyKey, preserveSessionOn401: true },
  );
}

let pendingDisplayOnceTransferCode: string | null = null;

export function setPendingTransferCode(code?: string | null): void {
  pendingDisplayOnceTransferCode = code ?? null;
}

export function consumePendingTransferCode(): string | null {
  const code = pendingDisplayOnceTransferCode;
  pendingDisplayOnceTransferCode = null;
  return code;
}

export function clearPendingTransferCode(): void {
  pendingDisplayOnceTransferCode = null;
}

export function describeCashToCashError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) {
      if (/locked/i.test(error.message)) return 'Your transaction PIN is locked. Contact support.';
      return 'Incorrect transaction PIN. Try again.';
    }
    if (status === 403) {
      return 'You are not permitted to perform Cash→Cash for this account.';
    }
  }
  return describeApiError(error);
}

/* ---------------------------------------------------------------------------
 * Wallet→Cash Method 1 (V1-AGENT-MOBILE-08) — exact backend contract
 * (src/agent/agent-cash-out.controller.ts + agent-cash-out.service.ts).
 * Requires Agent PIN + Customer PIN + Customer OTP (from MFA challenge).
 * Customer wallet is debited, Agent electronic float is credited.
 * ------------------------------------------------------------------------- */

export interface AgentCashOutRequest {
  customerId: string;
  amountMinor: string;
  currency: 'NGN';
  idempotencyKey: string;
  agentPin: string;
  customerPin: string;
  mfaChallengeId: string;
  otp: string;
  reference?: string;
  description?: string;
  correlationId?: string;
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
  createdAt: string;
}

/** POST /agents/cash-out (201). Multi-party authorization, preserveSessionOn401. */
export async function agentCashOut(request: AgentCashOutRequest): Promise<AgentCashOutResult> {
  return ApiClient.post<AgentCashOutResult>(
    'api/v1/agents/cash-out',
    { ...request },
    { idempotencyKey: request.idempotencyKey, preserveSessionOn401: true },
  );
}

export function describeCashOutError(error: unknown): string {
  if (error instanceof Error && error.name === 'ApiError') {
    const status = (error as Error & { status?: number }).status;
    const msg = error.message;
    if (status === 401) {
      if (/Customer PIN is locked|Customer.*locked/i.test(msg)) {
        return 'Customer transaction PIN is locked. Ask the customer to contact support.';
      }
      if (/Customer PIN/i.test(msg)) {
        return 'Customer transaction PIN is invalid. Ask the customer to check and try again.';
      }
      if (/Agent PIN is locked|locked/i.test(msg)) {
        return 'Your agent transaction PIN is locked. Contact support.';
      }
      if (/Agent PIN|PIN invalid/i.test(msg)) {
        return 'Agent transaction PIN is incorrect. Try again.';
      }
      if (/OTP invalid|MFA_INVALID_OTP/i.test(msg)) {
        return 'Customer verification code (OTP) is invalid. Check the code and try again.';
      }
      return 'Incorrect transaction PIN. Try again.';
    }
    if (status === 400) {
      if (/OTP expired|expired/i.test(msg)) {
        return 'Customer verification code has expired. Request a new code.';
      }
      if (/OTP invalid|OTP verification failed|MISMATCH/i.test(msg)) {
        return 'Customer verification code (OTP) is invalid. Check the code and try again.';
      }
      if (/OTP already used/i.test(msg)) {
        return 'Customer verification code (OTP) has already been used. Request a new code.';
      }
      return error.message;
    }
    if (status === 403) {
      return 'You are not permitted to perform Wallet→Cash cash-outs.';
    }
    if (status === 409 || status === 422) {
      if (/insufficient/i.test(msg)) {
        return 'Customer has insufficient available balance for this cash-out.';
      }
      return error.message;
    }
  }
  return describeApiError(error);
}

/* ---------------------------------------------------------------------------
 * Unified Agent transaction history (V1-AGENT-MOBILE-06).
 * GET /agents/me/transactions — verified against
 * src/agent/agent-transaction-history.service.ts (V1-AGENT-HISTORY-01).
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
export async function getAgentTransactions(
  query: AgentTransactionsQuery = {},
): Promise<AgentUnifiedHistoryResponse> {
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
    if (typeof status === 'number' && status >= 500)
      return 'The service is temporarily unavailable. Please retry.';
    return error.message;
  }
  if (error instanceof Error && error.name === 'NetworkError') {
    return 'No network connection. Check your connection and retry.';
  }
  return 'Something went wrong. Please retry.';
}
