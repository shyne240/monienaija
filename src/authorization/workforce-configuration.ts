import { isIP } from 'node:net';
import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { A2WorkforceConfigurationV1 } from './workforce-authentication.types';

const key = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9][A-Z0-9_.:-]*$/),
  scope = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/),
  action = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Z0-9][A-Z0-9_.:-]*$/),
  unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const roleSchema = z
  .object({
    roleKey: key,
    displayName: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    enabled: z.boolean(),
    scopes: z.array(scope).max(100),
    applicableActions: z.array(action).max(100),
    mfaRequired: z.boolean(),
    approvalCapability: z.boolean(),
    makerEligible: z.boolean(),
    checkerEligible: z.boolean(),
    administrativeCapability: z.boolean(),
  })
  .strict()
  .superRefine((role, context) => {
    if (!unique(role.scopes))
      context.addIssue({ code: 'custom', path: ['scopes'], message: 'must be unique' });
    if (!unique(role.applicableActions))
      context.addIssue({ code: 'custom', path: ['applicableActions'], message: 'must be unique' });
    if (role.approvalCapability && (!role.checkerEligible || !role.mfaRequired))
      context.addIssue({
        code: 'custom',
        message: 'approval-capable roles must be MFA-required and checker-eligible',
      });
    if (role.administrativeCapability && role.roleKey !== 'FINANCE_ADMIN')
      context.addIssue({
        code: 'custom',
        path: ['administrativeCapability'],
        message: 'is reserved for FINANCE_ADMIN in A2T11',
      });
  });
const ruleSchema = z
  .object({
    action,
    initiatingRoles: z.array(key).min(1).max(20),
    approvingRoles: z.array(key).min(1).max(20),
    minimumApprovals: z.number().int().min(1).max(10),
    separationRequired: z.boolean(),
    selfApprovalProhibited: z.boolean(),
    mfaRequired: z.boolean(),
    minimumAssurance: z.enum(['PASSWORD', 'MFA']),
    materialityRequired: z.boolean(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (!unique(rule.initiatingRoles))
      context.addIssue({ code: 'custom', path: ['initiatingRoles'], message: 'must be unique' });
    if (!unique(rule.approvingRoles))
      context.addIssue({ code: 'custom', path: ['approvingRoles'], message: 'must be unique' });
    if (rule.separationRequired && !rule.selfApprovalProhibited)
      context.addIssue({
        code: 'custom',
        path: ['selfApprovalProhibited'],
        message: 'must be true when separationRequired is true',
      });
    if (rule.mfaRequired && rule.minimumAssurance !== 'MFA')
      context.addIssue({
        code: 'custom',
        path: ['minimumAssurance'],
        message: 'must be MFA when mfaRequired is true',
      });
  });
const rateSchema = z
  .object({
    category: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9-]*$/),
    capacity: z.number().int().min(1).max(1_000_000),
    refillRatePerSecond: z.number().finite().positive().max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();
const instant = z.string().datetime({ offset: true }),
  jwkSchema = z
    .object({
      kid: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/),
      kty: z.literal('RSA'),
      n: z
        .string()
        .min(64)
        .max(2048)
        .regex(/^[A-Za-z0-9_-]+$/),
      e: z
        .string()
        .min(2)
        .max(16)
        .regex(/^[A-Za-z0-9_-]+$/),
      alg: z.literal('RS256'),
      use: z.literal('sig'),
      validFrom: instant.nullable().optional(),
      validTo: instant.nullable().optional(),
      revoked: z.boolean().optional(),
      environment: z.string().trim().min(1).max(80),
    })
    .strict()
    .superRefine((item, context) => {
      if (item.validFrom && item.validTo && Date.parse(item.validTo) <= Date.parse(item.validFrom))
        context.addIssue({ code: 'custom', path: ['validTo'], message: 'must be after validFrom' });
    });
const proxySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => {
    const [address, prefix, extra] = value.split('/');
    if (extra !== undefined || !isIP(address ?? '')) return false;
    if (prefix === undefined) return true;
    if (!/^\d+$/.test(prefix)) return false;
    const bits = Number(prefix),
      family = isIP(address ?? '');
    return bits >= 0 && bits <= (family === 4 ? 32 : 128);
  }, 'must be an IP address or CIDR');
const REQUIRED_ROLES = [
    'FINANCE_ADMIN',
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'FINANCE_AUDITOR',
  ] as const,
  REQUIRED_RULES = [
    'FINANCE_ROLE_ASSIGN',
    'FINANCE_ROLE_REVOKE',
    'FINANCE_CONTROL_POLICY_ACTIVATE',
  ] as const,
  REQUIRED_RATES = [
    'workforce-authentication',
    'workforce-bootstrap',
    'finance-role-administration',
    'privileged-approval',
  ] as const;

function parseJson<T>(
  field: string,
  value: string | undefined,
  schema: z.ZodType<T>,
  fallback: unknown,
): T {
  let parsed: unknown = fallback;
  if (value) {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw invalid(`${field}: malformed JSON`);
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw invalid(
      result.error.issues
        .map(
          (issue) =>
            `${field}${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
        )
        .join('; '),
    );
  return result.data;
}
function invalid(detail: string): ServiceUnavailableException {
  return new ServiceUnavailableException(`Invalid A2 workforce configuration: ${detail}`);
}
function requiredText(env: Record<string, string | undefined>, field: string, max = 2048): string {
  const value = env[field]?.trim();
  if (!value || value.length > max) throw invalid(`${field}: required`);
  return value;
}
function httpsUrl(value: string, field: string, production: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid(`${field}: invalid URL`);
  }
  if (production && parsed.protocol !== 'https:')
    throw invalid(`${field}: HTTPS required in production`);
  return parsed.toString();
}

export function workforceConfiguration(
  env: Record<string, string | undefined>,
): A2WorkforceConfigurationV1 {
  const enabled = env.A2_WORKFORCE_ENABLED === 'true',
    production = env.NODE_ENV === 'production';
  if (!enabled)
    return {
      enabled: false,
      environment: env.NODE_ENV ?? 'development',
      oidcIssuer: '',
      oidcJwksUri: '',
      oidcAudience: '',
      oidcClientId: '',
      internalAudience: env.A2_WORKFORCE_INTERNAL_AUDIENCE?.trim() || 'workforce-admin',
      sessionTtlSeconds: 900,
      mfaFreshnessSeconds: 300,
      oidcJwksCacheSeconds: 900,
      oidcJwksMaxStalenessSeconds: 3600,
      bootstrapEnabled: false,
      bootstrapIssuer: '',
      bootstrapAudience: '',
      bootstrapKeys: [],
      bootstrapFinanceAdminScopes: [],
      roles: [],
      makerCheckerRules: [],
      rateLimits: [],
      trustedProxyAddresses: [],
    };
  const roleList = parseJson(
      'A2_FINANCE_ROLES_JSON',
      env.A2_FINANCE_ROLES_JSON,
      z.array(roleSchema).min(4).max(4),
      [],
    ),
    roleKeys = roleList.map((role) => role.roleKey);
  if (!unique(roleKeys)) throw invalid('A2_FINANCE_ROLES_JSON.roleKey: duplicate role key');
  if (
    REQUIRED_ROLES.some((role) => !roleKeys.includes(role)) ||
    roleKeys.some((role) => !REQUIRED_ROLES.includes(role as (typeof REQUIRED_ROLES)[number]))
  )
    throw invalid('A2_FINANCE_ROLES_JSON: exact A2T11 Finance role vocabulary required');
  const roleMap = new Map(roleList.map((role) => [role.roleKey, role])),
    rules = parseJson(
      'A2_MAKER_CHECKER_RULES_JSON',
      env.A2_MAKER_CHECKER_RULES_JSON,
      z.array(ruleSchema).min(3).max(100),
      [],
    );
  if (!unique(rules.map((rule) => rule.action)))
    throw invalid('A2_MAKER_CHECKER_RULES_JSON.action: duplicate action rule');
  if (REQUIRED_RULES.some((actionKey) => !rules.some((rule) => rule.action === actionKey)))
    throw invalid('A2_MAKER_CHECKER_RULES_JSON: required action rule missing');
  for (const rule of rules) {
    for (const role of [...rule.initiatingRoles, ...rule.approvingRoles]) {
      const definition = roleMap.get(role);
      if (!definition)
        throw invalid(`A2_MAKER_CHECKER_RULES_JSON.${rule.action}: undefined role ${role}`);
      if (!definition.enabled)
        throw invalid(`A2_MAKER_CHECKER_RULES_JSON.${rule.action}: disabled role ${role}`);
      if (!definition.applicableActions.includes(rule.action))
        throw invalid(
          `A2_MAKER_CHECKER_RULES_JSON.${rule.action}: role ${role} does not allow action`,
        );
    }
    for (const role of rule.initiatingRoles) {
      const definition = roleMap.get(role)!;
      if (!definition.makerEligible && !definition.administrativeCapability)
        throw invalid(
          `A2_MAKER_CHECKER_RULES_JSON.${rule.action}: initiating role ${role} is not maker-eligible`,
        );
    }
    for (const role of rule.approvingRoles) {
      const definition = roleMap.get(role)!;
      if (!definition.checkerEligible || !definition.approvalCapability)
        throw invalid(
          `A2_MAKER_CHECKER_RULES_JSON.${rule.action}: approving role ${role} is not approval-capable`,
        );
      if (rule.mfaRequired && !definition.mfaRequired)
        throw invalid(
          `A2_MAKER_CHECKER_RULES_JSON.${rule.action}: approving role ${role} must require MFA`,
        );
    }
  }
  const rates = parseJson(
    'A2_WORKFORCE_RATE_LIMITS_JSON',
    env.A2_WORKFORCE_RATE_LIMITS_JSON,
    z.array(rateSchema).min(4).max(100),
    [],
  );
  if (!unique(rates.map((rate) => rate.category)))
    throw invalid('A2_WORKFORCE_RATE_LIMITS_JSON.category: duplicate category');
  if (
    REQUIRED_RATES.some(
      (category) => !rates.some((rate) => rate.category === category && rate.enabled),
    )
  )
    throw invalid('A2_WORKFORCE_RATE_LIMITS_JSON: required enabled category missing');
  const proxies = parseJson(
    'A2_TRUSTED_PROXY_ADDRESSES_JSON',
    env.A2_TRUSTED_PROXY_ADDRESSES_JSON,
    z.array(proxySchema).max(100),
    [],
  );
  if (!unique(proxies)) throw invalid('A2_TRUSTED_PROXY_ADDRESSES_JSON: duplicate address');
  const bootstrapEnabled = env.A2_BOOTSTRAP_ENABLED === 'true',
    bootstrapKeys = parseJson(
      'A2_BOOTSTRAP_JWKS_JSON',
      env.A2_BOOTSTRAP_JWKS_JSON,
      z.array(jwkSchema).max(32),
      [],
    ),
    bootstrapScopes = parseJson(
      'A2_BOOTSTRAP_ADMIN_SCOPES_JSON',
      env.A2_BOOTSTRAP_ADMIN_SCOPES_JSON,
      z.array(scope).min(1).max(100),
      [],
    );
  if (!unique(bootstrapKeys.map((item) => item.kid)))
    throw invalid('A2_BOOTSTRAP_JWKS_JSON.kid: duplicate key ID');
  if (!unique(bootstrapScopes)) throw invalid('A2_BOOTSTRAP_ADMIN_SCOPES_JSON: duplicate scope');
  if (bootstrapKeys.some((item) => item.environment !== (env.NODE_ENV ?? 'development')))
    throw invalid('A2_BOOTSTRAP_JWKS_JSON.environment: environment mismatch');
  const admin = roleMap.get('FINANCE_ADMIN')!;
  if ([...admin.scopes].sort().join('\0') !== [...bootstrapScopes].sort().join('\0'))
    throw invalid('A2_BOOTSTRAP_ADMIN_SCOPES_JSON: must exactly match FINANCE_ADMIN scopes');
  const bootstrapIssuer = bootstrapEnabled
      ? requiredText(env, 'A2_BOOTSTRAP_ISSUER', 2048)
      : (env.A2_BOOTSTRAP_ISSUER?.trim() ?? ''),
    bootstrapAudience = bootstrapEnabled
      ? requiredText(env, 'A2_BOOTSTRAP_AUDIENCE', 255)
      : (env.A2_BOOTSTRAP_AUDIENCE?.trim() ?? '');
  if (bootstrapEnabled && !bootstrapKeys.length)
    throw invalid(
      'A2_BOOTSTRAP_JWKS_JSON: at least one trusted key required when bootstrap enabled',
    );
  const ttl = Number(env.A2_WORKFORCE_SESSION_TTL_SECONDS ?? 900);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 3600)
    throw invalid('A2_WORKFORCE_SESSION_TTL_SECONDS: must be an integer from 60 through 3600');
  const issuer = httpsUrl(
      requiredText(env, 'A2_WORKFORCE_OIDC_ISSUER'),
      'A2_WORKFORCE_OIDC_ISSUER',
      production,
    ),
    jwks = httpsUrl(
      requiredText(env, 'A2_WORKFORCE_OIDC_JWKS_URI'),
      'A2_WORKFORCE_OIDC_JWKS_URI',
      production,
    );
  return {
    enabled: true,
    environment: env.NODE_ENV ?? 'development',
    oidcIssuer: issuer.replace(/\/$/, ''),
    oidcJwksUri: jwks,
    oidcAudience: requiredText(env, 'A2_WORKFORCE_OIDC_AUDIENCE', 255),
    oidcClientId: requiredText(env, 'A2_WORKFORCE_OIDC_CLIENT_ID', 255),
    internalAudience: requiredText(env, 'A2_WORKFORCE_INTERNAL_AUDIENCE', 80),
    sessionTtlSeconds: ttl,
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled,
    bootstrapIssuer,
    bootstrapAudience,
    bootstrapKeys,
    bootstrapFinanceAdminScopes: bootstrapScopes,
    roles: roleList,
    makerCheckerRules: rules,
    rateLimits: rates,
    trustedProxyAddresses: proxies,
  };
}
