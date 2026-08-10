import { ServiceUnavailableException } from '@nestjs/common';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';
const json = <T>(v: string | undefined, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    throw new ServiceUnavailableException('Invalid A2 workforce JSON configuration');
  }
};
export function workforceConfiguration(
  env: Record<string, string | undefined>,
): A2WorkforceConfigurationV1 {
  const enabled = env.A2_WORKFORCE_ENABLED === 'true',
    roles = json(env.A2_FINANCE_ROLES_JSON, []),
    keys = json(env.A2_BOOTSTRAP_JWKS_JSON, []),
    scopes = json(env.A2_BOOTSTRAP_ADMIN_SCOPES_JSON, []),
    rules = json(env.A2_MAKER_CHECKER_RULES_JSON, []);
  const c = {
    enabled,
    environment: env.NODE_ENV ?? 'development',
    oidcIssuer: env.A2_WORKFORCE_OIDC_ISSUER ?? '',
    oidcJwksUri: env.A2_WORKFORCE_OIDC_JWKS_URI ?? '',
    oidcAudience: env.A2_WORKFORCE_OIDC_AUDIENCE ?? '',
    oidcClientId: env.A2_WORKFORCE_OIDC_CLIENT_ID ?? '',
    internalAudience: env.A2_WORKFORCE_INTERNAL_AUDIENCE ?? 'workforce-admin',
    sessionTtlSeconds: Number(env.A2_WORKFORCE_SESSION_TTL_SECONDS ?? 900),
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled: env.A2_BOOTSTRAP_ENABLED === 'true',
    bootstrapIssuer: env.A2_BOOTSTRAP_ISSUER ?? '',
    bootstrapAudience: env.A2_BOOTSTRAP_AUDIENCE ?? '',
    bootstrapKeys: keys,
    bootstrapFinanceAdminScopes: scopes,
    roles,
    makerCheckerRules: rules,
    rateLimits: json(env.A2_WORKFORCE_RATE_LIMITS_JSON, []),
    trustedProxyAddresses: json(env.A2_TRUSTED_PROXY_ADDRESSES_JSON, []),
  } satisfies A2WorkforceConfigurationV1;
  if (
    enabled &&
    (!c.oidcIssuer ||
      !c.oidcJwksUri ||
      !c.oidcAudience ||
      !c.oidcClientId ||
      !c.internalAudience ||
      roles.length < 4)
  )
    throw new ServiceUnavailableException('A2 workforce configuration incomplete');
  return c;
}
