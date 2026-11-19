import { SecureStorage } from './secure-storage';

const STORAGE_KEY_PREFIX = 'pending_agent_bank_withdrawal_intent';

function storageKeyFor(agentId: string): string {
  return `${STORAGE_KEY_PREFIX}:${agentId}`;
}

const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingAgentBankWithdrawalParams {
  walletAccountId?: string;
  beneficiaryId: string;
  amountMinor: string;
  currency: string;
}

export interface PendingAgentBankWithdrawalIntent extends PendingAgentBankWithdrawalParams {
  agentId: string;
  idempotencyKey: string;
  createdAt: string;
}

function isPendingIntent(value: unknown): value is PendingAgentBankWithdrawalIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.agentId === 'string' &&
    typeof v.idempotencyKey === 'string' &&
    typeof v.beneficiaryId === 'string' &&
    typeof v.amountMinor === 'string' &&
    typeof v.currency === 'string' &&
    typeof v.createdAt === 'string'
  );
}

export async function loadPendingAgentBankWithdrawalIntent(agentId: string): Promise<PendingAgentBankWithdrawalIntent | null> {
  const raw = await SecureStorage.getDurable(storageKeyFor(agentId));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPendingIntent(parsed) || parsed.agentId !== agentId) return null;
  const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_PENDING_AGE_MS) {
    await clearPendingAgentBankWithdrawalIntent(agentId);
    return null;
  }
  return parsed;
}

export function matchesPendingAgentBankIntent(intent: PendingAgentBankWithdrawalIntent, candidate: PendingAgentBankWithdrawalParams): boolean {
  return (
    (intent.walletAccountId ?? null) === (candidate.walletAccountId ?? null) &&
    intent.beneficiaryId === candidate.beneficiaryId &&
    intent.amountMinor === candidate.amountMinor &&
    intent.currency === candidate.currency
  );
}

export async function savePendingAgentBankWithdrawalIntent(intent: PendingAgentBankWithdrawalIntent): Promise<void> {
  await SecureStorage.setDurable(storageKeyFor(intent.agentId), JSON.stringify(intent));
}

export async function clearPendingAgentBankWithdrawalIntent(agentId: string): Promise<void> {
  await SecureStorage.removeDurable(storageKeyFor(agentId));
}
