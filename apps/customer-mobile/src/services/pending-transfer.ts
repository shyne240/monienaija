import { SecureStorage } from './secure-storage';

/**
 * V1-MOBILE-IDEMPOTENCY-RECOVERY-01.
 *
 * Durable, customer-scoped record of the ONE in-flight Wallet→Wallet logical operation,
 * so that an ambiguous outcome (network error / timeout / 5xx — i.e. "we don't know whether
 * the backend already committed this") never causes the client to abandon the original
 * Idempotency-Key and mint a fresh one for what the customer still believes is the same
 * transfer attempt. See docs/V1/V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md for the full
 * design rationale.
 *
 * This reuses the existing SecureStorage abstraction already used for session data — no new
 * storage mechanism, no new identity system. The backend's own Idempotency-Key + request-hash
 * mechanism (src/transfer/transfer.service.ts) remains the sole financial authority; this
 * module only makes the CLIENT reliably reuse the correct key instead of discarding it.
 */

const STORAGE_KEY_PREFIX = 'pending_wallet_transfer_intent';

// Namespaced by customerId so two different customers signing in on the same device/session
// context never share a single storage slot — one customer's pending intent can never be
// silently evicted by, or leak into, another customer's attempt.
function storageKeyFor(customerId: string): string {
  return `${STORAGE_KEY_PREFIX}:${customerId}`;
}

// A pending intent older than this is treated as abandoned/stale and ignored (and dropped from
// storage) rather than resurrected against a much later, unrelated transfer that happens to
// share the same form values. Chosen to comfortably exceed any realistic ambiguous-timeout
// recovery window while never lingering indefinitely on the device.
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface PendingTransferParams {
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: string;
  currency: string;
  narration: string;
}

export interface PendingTransferIntent extends PendingTransferParams {
  customerId: string;
  idempotencyKey: string;
  createdAt: string;
}

function isPendingTransferIntent(value: unknown): value is PendingTransferIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.customerId === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.sourceWalletId === 'string' &&
    typeof v.destinationWalletId === 'string' &&
    typeof v.amountMinor === 'string' &&
    typeof v.currency === 'string' &&
    typeof v.narration === 'string' &&
    typeof v.createdAt === 'string'
  );
}

/**
 * Loads the persisted pending transfer intent, but ONLY if it belongs to the given customer
 * and has not exceeded the staleness window. Any mismatch, parse failure, or staleness causes
 * this to return null (and, for staleness, also clears the stale record) — never leaks a prior
 * customer's intent to a different one, and never resurrects a long-abandoned attempt.
 */
export async function loadPendingTransferIntent(customerId: string): Promise<PendingTransferIntent | null> {
  const raw = await SecureStorage.get(storageKeyFor(customerId));
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Defense in depth: the storage key is already customer-scoped, but a stored value whose own
  // customerId field somehow disagreed with the key it was read from must never be trusted.
  if (!isPendingTransferIntent(parsed)) return null;
  if (parsed.customerId !== customerId) return null;

  const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_PENDING_AGE_MS) {
    await clearPendingTransferIntent(customerId);
    return null;
  }

  return parsed;
}

/** True only if every business-meaning field matches exactly — the two represent the same logical transfer. */
export function matchesPendingIntent(intent: PendingTransferIntent, candidate: PendingTransferParams): boolean {
  return (
    intent.sourceWalletId === candidate.sourceWalletId &&
    intent.destinationWalletId === candidate.destinationWalletId &&
    intent.amountMinor === candidate.amountMinor &&
    intent.currency === candidate.currency &&
    intent.narration === candidate.narration
  );
}

/** Persisted immediately before the request is sent, so an app kill right after send is still covered. */
export async function savePendingTransferIntent(intent: PendingTransferIntent): Promise<void> {
  await SecureStorage.set(storageKeyFor(intent.customerId), JSON.stringify(intent));
}

/** Called after a DEFINITIVE outcome (success or a definitive rejection) and on logout. */
export async function clearPendingTransferIntent(customerId: string): Promise<void> {
  await SecureStorage.remove(storageKeyFor(customerId));
}
