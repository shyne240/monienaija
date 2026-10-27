import { SecureStorage } from './secure-storage';

/**
 * V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-01.
 *
 * Durable, Agent-scoped record of an in-flight financial operation's Idempotency-Key, so
 * that killing the app process between "request sent" and "response received" never forces
 * the Agent to mint a brand-new key for what they still believe is the same attempt.
 *
 * Scope: ONLY the three Agent flows whose backend idempotency boundary is a generic
 * `agent-financial.v1:<agentId>` ledger reservation with no independent business-level
 * duplicate guard — Cash→Wallet (CASH_IN), Wallet→Cash (CASH_OUT), Cash→Cash send
 * (CASH_TO_CASH_SEND). Cash→Cash CLAIM is deliberately excluded: `cash_to_cash_transfers`
 * carries its own UNCLAIMED→CLAIMED state machine keyed by the immutable `transferId`
 * (src/agent/agent-cash-to-cash-claim.service.ts), so a claim retry with a brand-new key
 * after process death is already rejected server-side with a definitive 409 — persisting a
 * key for it would add complexity without closing any real gap. See
 * docs/V1/V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.md for the full analysis.
 *
 * Design notes (deliberately NOT a copy of customer-mobile's pending-transfer.ts):
 *  - Customer Mobile has exactly one flow/shape (Wallet→Wallet) so one storage key suffices.
 *    Agent Mobile has three distinct operation shapes and must not let one flow's pending
 *    state collide with, or be read by, another — hence `operationType` is part of the
 *    storage key, not merely a field inside the record.
 *  - Per V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01 Part 6: the Idempotency-Key itself
 *    — not amount/recipient/phone/narration — is the identity of the pending operation. The
 *    `params` captured alongside it are used only as a defense-in-depth sanity check (do the
 *    details the Agent is re-entering actually look like the same attempt?), never as the
 *    sole basis for deciding whether to resume a key.
 *  - Reuses the existing SecureStorage abstraction already used for Agent session data — no
 *    new storage mechanism, no new identity system.
 */

export type AgentOperationType = 'CASH_IN' | 'CASH_OUT' | 'CASH_TO_CASH_SEND';

const STORAGE_KEY_PREFIX = 'pending_agent_operation';

// Namespaced by agentId AND operationType: Agent A's Cash-In attempt can never collide with
// Agent B's, and an Agent's own Cash-In attempt can never collide with their own Cash-Out or
// Cash→Cash-send attempt (even if, implausibly, more than one were ever mid-flight at once).
function storageKeyFor(agentId: string, operationType: AgentOperationType): string {
  return `${STORAGE_KEY_PREFIX}:${agentId}:${operationType}`;
}

// A pending intent older than this is treated as abandoned and ignored (and dropped from
// storage) rather than resurrected against a much later, unrelated operation that happens to
// reuse the same screen. Matches the customer-mobile precedent: comfortably exceeds any
// realistic ambiguous-timeout recovery window without lingering indefinitely on the device.
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AgentOperationParams {
  /** The single other party identifier for this operation (recipient/customer/beneficiary). */
  counterpartyId: string;
  amountMinor: string;
  currency: string;
}

export interface PendingAgentOperation extends AgentOperationParams {
  agentId: string;
  operationType: AgentOperationType;
  idempotencyKey: string;
  createdAt: string;
}

function isPendingAgentOperation(value: unknown): value is PendingAgentOperation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.agentId === 'string' &&
    typeof v.operationType === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.counterpartyId === 'string' &&
    typeof v.amountMinor === 'string' &&
    typeof v.currency === 'string' &&
    typeof v.createdAt === 'string'
  );
}

/**
 * Loads the persisted pending operation, but ONLY if it belongs to the given Agent and
 * operation type and has not exceeded the staleness window. Any mismatch, parse failure, or
 * staleness returns null (staleness also clears the stale record) — never leaks one Agent's
 * (or one operation type's) pending key into another's.
 */
export async function loadPendingAgentOperation(
  agentId: string,
  operationType: AgentOperationType,
): Promise<PendingAgentOperation | null> {
  const raw = await SecureStorage.get(storageKeyFor(agentId, operationType));
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Defense in depth: the storage key already encodes agentId+operationType, but a stored
  // value whose own fields disagree with the key it was read from must never be trusted.
  if (!isPendingAgentOperation(parsed)) return null;
  if (parsed.agentId !== agentId || parsed.operationType !== operationType) return null;

  const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_PENDING_AGE_MS) {
    await clearPendingAgentOperation(agentId, operationType);
    return null;
  }

  return parsed;
}

/**
 * True only if every re-entered business field matches exactly — i.e. this really does look
 * like the same logical operation the Agent is resuming, not a different one that happens to
 * land on the same screen. This is a safety NET on top of the Idempotency-Key identity, never
 * a replacement for it (per Part 6: never identify an operation solely by these fields).
 */
export function matchesPendingAgentOperation(
  intent: PendingAgentOperation,
  candidate: AgentOperationParams,
): boolean {
  return (
    intent.counterpartyId === candidate.counterpartyId &&
    intent.amountMinor === candidate.amountMinor &&
    intent.currency === candidate.currency
  );
}

/** Persisted immediately before the request is sent, so an app kill right after send is still covered. */
export async function savePendingAgentOperation(intent: PendingAgentOperation): Promise<void> {
  await SecureStorage.set(storageKeyFor(intent.agentId, intent.operationType), JSON.stringify(intent));
}

/** Called after a DEFINITIVE outcome (success or a definitive rejection). */
export async function clearPendingAgentOperation(
  agentId: string,
  operationType: AgentOperationType,
): Promise<void> {
  await SecureStorage.remove(storageKeyFor(agentId, operationType));
}

const ALL_OPERATION_TYPES: AgentOperationType[] = ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH_SEND'];

/**
 * ARENA 1 Six-Digit Redemption (`POST /api/v1/agents/cash-to-cash/claims/recover-by-number`)
 * requires the SAME claiming Agent session AND the ORIGINAL financial `idempotencyKey` alongside
 * `(senderPhone, transferNumber)`. Persisting ONLY those non-secret locator & idempotency fields
 * immediately before `claim-by-number` ensures an interrupted claim can recover its receipt or
 * safely retry with the identical `idempotencyKey` and locked `redemptionMethod` without ever
 * minting a fresh key for an ambiguous financial attempt.
 *
 * SECURITY: NEVER stores `transferCode`, `otp`, or `agentPin`.
 */
const LOCATOR_CLAIM_STORAGE_PREFIX = 'pending_c2c_locator_claim';

function locatorClaimStorageKeyFor(agentId: string): string {
  return `${LOCATOR_CLAIM_STORAGE_PREFIX}:${agentId}`;
}

export interface CashToCashLocatorClaimParams {
  senderPhone: string;
  transferNumber: string;
  beneficiaryPhone: string;
  customerId: string;
}

export interface PendingCashToCashLocatorClaim extends CashToCashLocatorClaimParams {
  agentId: string;
  redemptionMethod: 'CUSTOMER_WALLET' | 'AGENT_CASH';
  idempotencyKey: string;
  createdAt: string;
}

function isPendingCashToCashLocatorClaim(
  value: unknown,
): value is PendingCashToCashLocatorClaim {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.agentId === 'string' &&
    typeof v.senderPhone === 'string' &&
    typeof v.transferNumber === 'string' &&
    /^[0-9]{6}$/.test(v.transferNumber) &&
    typeof v.beneficiaryPhone === 'string' &&
    typeof v.customerId === 'string' &&
    (v.redemptionMethod === 'CUSTOMER_WALLET' || v.redemptionMethod === 'AGENT_CASH') &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.createdAt === 'string'
  );
}

export async function savePendingCashToCashLocatorClaim(
  intent: PendingCashToCashLocatorClaim,
): Promise<void> {
  await SecureStorage.set(locatorClaimStorageKeyFor(intent.agentId), JSON.stringify(intent));
}

export async function clearPendingCashToCashLocatorClaim(agentId: string): Promise<void> {
  await SecureStorage.remove(locatorClaimStorageKeyFor(agentId));
}

export async function loadPendingCashToCashLocatorClaim(
  agentId: string,
): Promise<PendingCashToCashLocatorClaim | null> {
  const raw = await SecureStorage.get(locatorClaimStorageKeyFor(agentId));
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPendingCashToCashLocatorClaim(parsed)) return null;
  if (parsed.agentId !== agentId) return null;

  const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_PENDING_AGE_MS) {
    await clearPendingCashToCashLocatorClaim(agentId);
    return null;
  }

  return parsed;
}

export function matchesPendingCashToCashLocatorClaim(
  intent: PendingCashToCashLocatorClaim,
  candidate: CashToCashLocatorClaimParams,
): boolean {
  return (
    intent.senderPhone === candidate.senderPhone &&
    intent.transferNumber === candidate.transferNumber &&
    intent.beneficiaryPhone === candidate.beneficiaryPhone &&
    intent.customerId === candidate.customerId
  );
}

/** Called on logout / session purge — no pending operation may ever cross an Agent identity boundary. */
export async function clearAllPendingAgentOperations(agentId: string): Promise<void> {
  await Promise.all([
    ...ALL_OPERATION_TYPES.map((type) => clearPendingAgentOperation(agentId, type)),
    clearPendingCashToCashLocatorClaim(agentId),
  ]);
}
