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
    // Clock skew — treat as invalid and clear (no safe retry age can be determined)
    await clearPendingBankWithdrawalIntent(customerId);
    return null;
  }
  if (ageMs > MAX_PENDING_AGE_MS) {
    // TTL expiry must NOT silently authorize a new submission while prior may still be unresolved.
    // Keep the stale intent durable for operator/history inspection; return null to prevent silent
    // auto-reuse, but do NOT clear — the caller must explicitly confirm resolution (history check)
    // before minting a fresh idempotency key. This preserves the 24h staleness bound without
    // opening a duplicate-debit window.
    return null;
  }
  return parsed;
}

/** Returns true if a stale (TTL-expired) pending intent still exists durably — i.e. the prior
 * may still be unresolved. Used to block silent new submission after TTL expiry. */
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

export function matchesPendingIntent(intent: PendingBankWithdrawalIntent, candidate: PendingBankWithdrawalParams): boolean {
  return (
    intent.walletAccountId === candidate.walletAccountId &&
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
