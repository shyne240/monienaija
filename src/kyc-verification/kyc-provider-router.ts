import { KycFoundationError, type IdentityKind, type KycProvider } from './kyc.types';

/** Read-only routing primitive. The supplied snapshot must eventually come from an approved governance service. */
export interface KycRoutingSnapshot {
  version: string;
  enabled: boolean;
  routes: Partial<Record<IdentityKind, string>>;
}
export interface KycProviderRegistration {
  provider: KycProvider;
  enabled: boolean;
  capabilities: readonly IdentityKind[];
}
/** No fallback after any failure or ambiguity: all billable requests require a new governed decision. */
export function selectKycProvider(
  config: KycRoutingSnapshot | undefined,
  kind: IdentityKind,
  registry: readonly KycProviderRegistration[],
): KycProvider {
  if (!config || config.enabled !== true) throw new KycFoundationError('DISABLED');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.version) || !['BVN', 'NIN'].includes(kind))
    throw new KycFoundationError('INVALID');
  const code = config.routes[kind];
  if (!code || !/^[A-Z][A-Z0-9_]{0,31}$/.test(code)) throw new KycFoundationError('BLOCKED');
  const candidates = registry.filter((r) => r.provider.code === code);
  if (
    candidates.length !== 1 ||
    candidates[0]?.enabled !== true ||
    !candidates[0].capabilities.includes(kind)
  )
    throw new KycFoundationError('BLOCKED');
  return candidates[0].provider;
}
