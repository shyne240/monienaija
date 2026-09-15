import { z } from 'zod';

import { customerAuthenticationRateLimits } from '../customer-authentication/customer-authentication-rate-limit.config';
import { corsOriginsFromJson } from '../production/http-security';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');
const optionalEnvironmentString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).max(255).optional(),
);
const optionalEnvironmentUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().url().max(2048).optional(),
);
const optionalEnvironmentSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(16).max(512).optional(),
);
const optionalEnvironmentJson = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(2).max(65_535).optional(),
);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_VERSION: z.string().trim().min(1).max(64).default('0.1.0'),
    API_VERSION: z.literal('v1').default('v1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    IDEMPOTENCY_RETENTION_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(86_400),
    OUTBOX_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    METRICS_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .min(3_600)
      .max(31_536_000)
      .default(2_592_000),
    AUDIT_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(31_536_000),
    OUTBOX_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(2_592_000),
    BUILD_TIMESTAMP: z.string().trim().min(1).max(64).default('unknown'),
    SHUTDOWN_DRAIN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
    A2_WORKFORCE_ENABLED: booleanFromEnvironment.default(false),
    A2_WORKFORCE_OIDC_ISSUER: optionalEnvironmentUrl,
    A2_WORKFORCE_OIDC_JWKS_URI: optionalEnvironmentUrl,
    A2_WORKFORCE_OIDC_AUDIENCE: optionalEnvironmentString,
    A2_WORKFORCE_OIDC_CLIENT_ID: optionalEnvironmentString,
    A2_WORKFORCE_INTERNAL_AUDIENCE: optionalEnvironmentString,
    A2_WORKFORCE_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).optional(),
    A2_BOOTSTRAP_ENABLED: booleanFromEnvironment.default(false),
    A2_BOOTSTRAP_ISSUER: optionalEnvironmentString,
    A2_BOOTSTRAP_AUDIENCE: optionalEnvironmentString,
    A2_BOOTSTRAP_JWKS_JSON: optionalEnvironmentJson,
    A2_BOOTSTRAP_ADMIN_SCOPES_JSON: optionalEnvironmentJson,
    A2_FINANCE_ROLES_JSON: optionalEnvironmentJson,
    A2_MAKER_CHECKER_RULES_JSON: optionalEnvironmentJson,
    A2_WORKFORCE_RATE_LIMITS_JSON: optionalEnvironmentJson,
    A2_TRUSTED_PROXY_ADDRESSES_JSON: optionalEnvironmentJson,
    A5_PILOT_EMERGENCY_STOP: booleanFromEnvironment.default(false),
    A6_PARTNER_ENABLED: booleanFromEnvironment.default(false),
    A6_PARTNER_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    A6_PARTNER_KEY: z.literal('NIBSS_NIP').default('NIBSS_NIP'),
    A6_PARTNER_CAPABILITY: z
      .literal('external.wallet.withdrawal.settlement')
      .default('external.wallet.withdrawal.settlement'),
    A6_PARTNER_OPERATION_TYPE: z
      .literal('OUTBOUND_BANK_SETTLEMENT')
      .default('OUTBOUND_BANK_SETTLEMENT'),
    A6_PARTNER_API_VERSION: z.string().trim().min(1).max(64).default('v1'),
    A6_PARTNER_ADAPTER_VERSION: z.string().trim().min(1).max(64).default('a6-adapter-1'),
    A6_PARTNER_SANDBOX_BASE_URL: optionalEnvironmentUrl,
    A6_PARTNER_PRODUCTION_BASE_URL: optionalEnvironmentUrl,
    A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE: optionalEnvironmentString,
    A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE: optionalEnvironmentString,
    A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE: optionalEnvironmentString,
    A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE: optionalEnvironmentString,
    A6_PARTNER_SIGNING_ALGORITHM: z.enum(['HMAC_SHA256', 'RSA_SHA256']).default('HMAC_SHA256'),
    A6_PARTNER_SANDBOX_CALLBACK_SECRET: optionalEnvironmentSecret,
    A6_PARTNER_PRODUCTION_CALLBACK_SECRET: optionalEnvironmentSecret,
    A6_PARTNER_CALLBACK_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    A6_PARTNER_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
    A6_PARTNER_CIRCUIT_OPEN_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    A6_PARTNER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    A6_PARTNER_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(3_000),
    // Explicit HTTP hardening. Defaults reproduce the previous Fastify behaviour exactly:
    // 1 MiB body limit and no proxy trust. CORS stays disabled until explicit origins are listed.
    HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
    HTTP_TRUST_PROXY: booleanFromEnvironment.default(false),
    // JSON array of exact origins, for example ["https://admin.example.com"]. Never "*".
    HTTP_CORS_ORIGINS_JSON: optionalEnvironmentJson,
    // Security rate limits for POST /customers/:id/authenticate. See
    // src/customer-authentication/customer-authentication-rate-limit.config.ts for the defaults.
    CUSTOMER_AUTH_RATE_LIMITS_JSON: optionalEnvironmentJson,
    // Development-only workforce mock assertion token. Must stay false outside local acceptance
    // testing: production builds reject mock tokens regardless of this flag.
    A2_WORKFORCE_DEV_MOCK_ENABLED: booleanFromEnvironment.default(false),
    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SSL: booleanFromEnvironment.default(false),
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnvironment.default(true),
    // Optional connection-resilience controls. When unset the driver defaults apply unchanged.
    DB_POOL_MAX: z.coerce.number().int().min(1).max(1_000).optional(),
    DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).max(600_000).optional(),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),
  })
  .superRefine((config, context) => {
    if (
      config.A6_PARTNER_SANDBOX_BASE_URL &&
      config.A6_PARTNER_PRODUCTION_BASE_URL &&
      config.A6_PARTNER_SANDBOX_BASE_URL === config.A6_PARTNER_PRODUCTION_BASE_URL
    ) {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_PRODUCTION_BASE_URL'],
        message: 'Sandbox and production partner endpoints must be different',
      });
    }

    if (config.A6_PARTNER_ENVIRONMENT === 'production' && config.NODE_ENV !== 'production') {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_ENVIRONMENT'],
        message: 'Production partner configuration requires NODE_ENV=production',
      });
    }

    if (!config.A6_PARTNER_ENABLED) return;

    const endpoint =
      config.A6_PARTNER_ENVIRONMENT === 'sandbox'
        ? config.A6_PARTNER_SANDBOX_BASE_URL
        : config.A6_PARTNER_PRODUCTION_BASE_URL;
    const credentialReference =
      config.A6_PARTNER_ENVIRONMENT === 'sandbox'
        ? config.A6_PARTNER_SANDBOX_CREDENTIAL_REFERENCE
        : config.A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE;
    const signingKeyReference =
      config.A6_PARTNER_ENVIRONMENT === 'sandbox'
        ? config.A6_PARTNER_SANDBOX_SIGNING_KEY_REFERENCE
        : config.A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE;
    const callbackSecret =
      config.A6_PARTNER_ENVIRONMENT === 'sandbox'
        ? config.A6_PARTNER_SANDBOX_CALLBACK_SECRET
        : config.A6_PARTNER_PRODUCTION_CALLBACK_SECRET;

    if (!endpoint) {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_ENVIRONMENT'],
        message: 'The selected A6 partner environment requires a dedicated endpoint',
      });
    }
    if (!credentialReference) {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_ENVIRONMENT'],
        message: 'The selected A6 partner environment requires a credential reference',
      });
    }
    if (!signingKeyReference) {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_ENVIRONMENT'],
        message: 'The selected A6 partner environment requires a signing-key reference',
      });
    }
    if (!callbackSecret) {
      context.addIssue({
        code: 'custom',
        path: ['A6_PARTNER_ENVIRONMENT'],
        message: 'The selected A6 partner environment requires a callback secret',
      });
    }
  })
  .superRefine((config, context) => {
    // Security controls must fail closed: an unreadable configuration is an error, never a
    // silent "no control" state.
    try {
      corsOriginsFromJson(config.HTTP_CORS_ORIGINS_JSON);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['HTTP_CORS_ORIGINS_JSON'],
        message: error instanceof Error ? error.message : 'invalid CORS configuration',
      });
    }
    try {
      customerAuthenticationRateLimits(config.CUSTOMER_AUTH_RATE_LIMITS_JSON);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['CUSTOMER_AUTH_RATE_LIMITS_JSON'],
        message: error instanceof Error ? error.message : 'invalid rate-limit configuration',
      });
    }

    // The workforce development mock assertion path was removed from the authentication services:
    // no environment can mint a workforce principal from a mock token any more. The flag is kept
    // only so that enabling it fails loudly instead of silently doing nothing.
    if (config.A2_WORKFORCE_DEV_MOCK_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['A2_WORKFORCE_DEV_MOCK_ENABLED'],
        message:
          'The workforce development mock assertion path was removed; A2_WORKFORCE_DEV_MOCK_ENABLED must not be enabled in any environment',
      });
    }

    // Production must never start with a placeholder or trivially weak secret. Development and
    // test profiles keep accepting the documented local-only values so local setup is unchanged.
    if (config.NODE_ENV !== 'production') return;
    for (const [field, value] of [
      ['DB_PASSWORD', config.DB_PASSWORD],
      ['A6_PARTNER_SANDBOX_CALLBACK_SECRET', config.A6_PARTNER_SANDBOX_CALLBACK_SECRET],
      ['A6_PARTNER_PRODUCTION_CALLBACK_SECRET', config.A6_PARTNER_PRODUCTION_CALLBACK_SECRET],
    ] as const) {
      if (value === undefined) continue;
      const issue = productionSecretIssue(value);
      if (issue) {
        context.addIssue({ code: 'custom', path: [field], message: issue });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

const PLACEHOLDER_SECRETS = new Set([
  'change-me-local-only',
  'change-me',
  'changeme',
  'change_me',
  'replace-me',
  'placeholder',
  'password',
  'password1',
  'postgres',
  'admin',
  'secret',
  'monienaija',
  'example',
  'test',
  'local',
  'local-only',
]);

const PLACEHOLDER_SECRET_PREFIXES = [
  'change-me',
  'changeme',
  'replace-me',
  'placeholder',
  'your-',
  'your_',
  'example-',
  'example_',
  'dummy',
  'todo',
  'xxx',
];

const MINIMUM_PRODUCTION_SECRET_LENGTH = 16;

/**
 * Rejects placeholder or trivially weak secrets in the production profile. The check is
 * intentionally conservative: exact placeholder values, documented placeholder prefixes, a minimum
 * length and single-character repetition. Nothing here inspects or logs the secret value.
 */
function productionSecretIssue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    PLACEHOLDER_SECRETS.has(normalized) ||
    PLACEHOLDER_SECRET_PREFIXES.some((p) => normalized.startsWith(p))
  ) {
    return 'Placeholder secrets are not accepted when NODE_ENV=production';
  }
  if (value.length < MINIMUM_PRODUCTION_SECRET_LENGTH) {
    return `Secrets must contain at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters when NODE_ENV=production`;
  }
  if (/^(.)\1+$/.test(value)) {
    return 'Repeated-character secrets are not accepted when NODE_ENV=production';
  }
  return null;
}

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
