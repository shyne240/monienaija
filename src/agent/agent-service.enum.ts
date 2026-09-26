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
  CASH_IN = 'CASH_IN', // Cash → Wallet (also known as CASH_TO_WALLET)
  CASH_OUT = 'CASH_OUT', // Wallet → Cash (also WALLET_TO_CASH)
  CASH_TO_CASH = 'CASH_TO_CASH',
  AGENT_FUNDING = 'AGENT_FUNDING',
  AGENT_DEFUNDING = 'AGENT_DEFUNDING',
}

/**
 * Aliases that were ambiguous in the ticket — normalized to canonical.
 */
export const AGENT_SERVICE_ALIASES: Readonly<Record<string, AgentService>> = {
  CASH_TO_WALLET: AgentService.CASH_IN,
  WALLET_TO_CASH: AgentService.CASH_OUT,
  CASH_IN: AgentService.CASH_IN,
  CASH_OUT: AgentService.CASH_OUT,
  CASH_TO_CASH: AgentService.CASH_TO_CASH,
  AGENT_FUNDING: AgentService.AGENT_FUNDING,
  AGENT_DEFUNDING: AgentService.AGENT_DEFUNDING,
} as const;

export const CANONICAL_AGENT_SERVICES = new Set<string>([
  AgentService.CASH_IN,
  AgentService.CASH_OUT,
  AgentService.CASH_TO_CASH,
  AgentService.AGENT_FUNDING,
  AgentService.AGENT_DEFUNDING,
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
