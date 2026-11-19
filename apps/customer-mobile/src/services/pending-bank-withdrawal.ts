import { SecureStorage } from './secure-storage';

/**
 * Durable interrupted-submission recovery for bank withdrawals (G10).
 *
 * Mirrors `pending-transfer.ts` but for the wallet→bank commitment. The idempotency key
 * must survive process termination and lost responses, not merely in-screen resubmission.
 * The backend's own idempotency + request-hash mechanism remains the sole financial authority;
 * this module only makes the client reliably reuse the correct key.
 *
 * Storage is customer-scoped and beneficiary/amount-aware so a stale key for a different
 * amount or beneficiary is never reused.
 */

const STORAGE_KEY_PREFIX = 'pending_bank_withdrawal_intent';

function storageKeyFor(customerId: string): string {
  return `${STORAGE_KEY_PREFIX}:${customerId}`;
}

const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000; // 24h — exceeds any ambiguous-window recovery

export interface PendingBankWithdrawalParams {
  walletAccountId: string;
  beneficiaryId: string;
  amountMinor: string;
  currency: string;
}

export interface PendingBankWithdrawalIntent extends PendingBankWithdrawalParams {
  customerId: string;
  idempotencyKey: string;
  createdAt: string;
}

function isPendingIntent(value: unknown): value is PendingBankWithdrawalIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.customerId === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.walletAccountId === 'string' &&
    typeof v.beneficiaryId === 'string' &&
    typeof v.amountMinor === 'string' &&
    typeof v.currency === 'string' &&
    typeof v.createdAt === 'string'
  );
}

export async function loadPendingBankWithdrawalIntent(customerId: string): Promise<PendingBankWithdrawalIntent | null> {
  const raw = await SecureStorage.getDurable(storageKeyFor(customerId));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPendingIntent(parsed)) return null;
  if (parsed.customerId !== customerId) return null;
  const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    await clearPendingBankWithdrawalIntent(customerId);
    return null;
  }
  if (ageMs > MAX_PENDING_AGE_MS) {
    // TTL expiry does NOT silently discard recovery identity. Return the stale intent so the
    // caller can reconcile it against authoritative server state (history/receipt) and either
    // resume with the same idempotencyKey or explicitly discard after confirming terminal outcome.
    return parsed;
  }
  return parsed;
}

/** True if a persisted intent is stale (TTL-expired) but still durable for reconciliation. */
export async function hasStalePendingBankWithdrawal(customerId: string): Promise<boolean> {
  const raw = await SecureStorage.getDurable(storageKeyFor(customerId));
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingIntent(parsed) || parsed.customerId !== customerId) return false;
    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    return Number.isFinite(ageMs) && ageMs > MAX_PENDING_AGE_MS;
  } catch { return false; }
}

/** Load the stale intent for explicit reconciliation, regardless of TTL. Returns null only if no durable record exists. */
export async function loadStalePendingBankWithdrawalIntent(customerId: string): Promise<PendingBankWithdrawalIntent | null> {
  const raw = await SecureStorage.getDurable(storageKeyFor(customerId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingIntent(parsed) || parsed.customerId !== customerId) return null;
    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) return null;
    if (ageMs > MAX_PENDING_AGE_MS) return parsed;
    return null;
  } catch { return null; }
}

/** Whether the persisted intent is stale (expired). Pure helper for UI. */
export function isStaleIntent(intent: PendingBankWithdrawalIntent): boolean {
  const ageMs = Date.now() - new Date(intent.createdAt).getTime();
  return Number.isFinite(ageMs) && ageMs > MAX_PENDING_AGE_MS;
}

export function matchesPendingIntent(intent: PendingBankWithdrawalIntent, candidate: PendingBankWithdrawalParams): boolean {
  const walletOk = !intent.walletAccountId || !candidate.walletAccountId || intent.walletAccountId === candidate.walletAccountId;
  return (
    walletOk &&
    intent.beneficiaryId === candidate.beneficiaryId &&
    intent.amountMinor === candidate.amountMinor &&
    intent.currency === candidate.currency
  );
}

export async function savePendingBankWithdrawalIntent(intent: PendingBankWithdrawalIntent): Promise<void> {
  await SecureStorage.setDurable(storageKeyFor(intent.customerId), JSON.stringify(intent));
}

export async function clearPendingBankWithdrawalIntent(customerId: string): Promise<void> {
  await SecureStorage.removeDurable(storageKeyFor(customerId));
}
