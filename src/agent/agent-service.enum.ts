/**
 * V1 Agent service vocabulary — discovered existing vs additive.
 *
 * Inspection (2026-09-25):
 * - grep -rn "applicableServices" → only JSONB field on AgentClass, no canonical enum/service constants found.
 * - No AgentService / AgentCapability / CASH_IN / AGENT_FUNDING constants exist in src.
 * - Closest pre-existing products are A7 virtual-account.inbound-funding and B2商
 *   `commercial.agent-assisted.inbound-funding` (billing scope), not Agent services.
 * Therefore the repository has NO canonical Agent V1 service identifiers.
 *
 * Smallest additive vocabulary for the V1 scope already established
 * (Cash→Wallet, Wallet→Cash, Cash→Cash, Agent funding/defunding):
 */
export enum AgentService {
  WALLET_TRANSFER = 'WALLET_TRANSFER', // Ordinary wallet-to-wallet transfer
  CASH_IN = 'CASH_IN', // Cash → Wallet (also known as CASH_TO_WALLET)
  CASH_OUT = 'CASH_OUT', // Wallet → Cash (also WALLET_TO_CASH)
  CASH_TO_CASH = 'CASH_TO_CASH',
  AGENT_FUNDING = 'AGENT_FUNDING',
  AGENT_DEFUNDING = 'AGENT_DEFUNDING',
  // ARENA 5 — agent-initiated transfer from the operating wallet to an external bank
  // beneficiary. Governed like every other agent service; the operating wallet is resolved
  // from the authenticated agent's authority, never from request input.
  EXTERNAL_BANK_TRANSFER = 'EXTERNAL_BANK_TRANSFER',
}

/**
 * Aliases that were ambiguous in the ticket — normalized to canonical.
 */
export const AGENT_SERVICE_ALIASES: Readonly<Record<string, AgentService>> = {
  WALLET_TRANSFER: AgentService.WALLET_TRANSFER,
  CASH_TO_WALLET: AgentService.CASH_IN,
  WALLET_TO_CASH: AgentService.CASH_OUT,
  CASH_IN: AgentService.CASH_IN,
  CASH_OUT: AgentService.CASH_OUT,
  CASH_TO_CASH: AgentService.CASH_TO_CASH,
  AGENT_FUNDING: AgentService.AGENT_FUNDING,
  AGENT_DEFUNDING: AgentService.AGENT_DEFUNDING,
  EXTERNAL_BANK_TRANSFER: AgentService.EXTERNAL_BANK_TRANSFER,
  BANK_TRANSFER: AgentService.EXTERNAL_BANK_TRANSFER,
  BANK_TRANSFER_OUT: AgentService.EXTERNAL_BANK_TRANSFER,
} as const;

export const CANONICAL_AGENT_SERVICES = new Set<string>([
  AgentService.WALLET_TRANSFER,
  AgentService.CASH_IN,
  AgentService.CASH_OUT,
  AgentService.CASH_TO_CASH,
  AgentService.AGENT_FUNDING,
  AgentService.AGENT_DEFUNDING,
  AgentService.EXTERNAL_BANK_TRANSFER,
]);

/**
 * Normalizes a raw service string to canonical or null if unknown.
 * Trims, uppercases, then resolves alias.
 */
export function normalizeAgentService(raw: unknown): AgentService | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const mapped = (AGENT_SERVICE_ALIASES as Record<string, AgentService>)[trimmed];
  if (mapped && CANONICAL_AGENT_SERVICES.has(mapped)) return mapped;
  // Also allow direct canonical check (already in alias map)
  return null;
}

export function isKnownAgentService(value: string): boolean {
  return CANONICAL_AGENT_SERVICES.has(value);
}
