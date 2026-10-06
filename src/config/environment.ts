import { z } from 'zod';

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
    CASH_TO_CASH_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(604800),
    // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — approved-decision accounting configuration.
    // All optional; absence means the commercial accounting layer is inert (legacy evidence-only
    // posture). When enabled, treatment/timing must be explicit — the selected values are
    // evaluated at runtime and any decision requiring an absent treatment fails closed.
    COMMERCIAL_ACCOUNTING_ENABLED: booleanFromEnvironment.default(false),
    COMMERCIAL_ACCOUNTING_VAT_TREATMENT: z
      .enum(['EXCLUSIVE_ADD_ON', 'INCLUSIVE_IN_FEE'])
      .optional(),
    COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: z
      .enum(['EXPENSE_PAYABLE', 'AGENT_WALLET_NETTING', 'CONTRA_REVENUE'])
      .optional(),
    COMMERCIAL_COMMISSION_RECOGNITION_TIMING: z
      .enum(['AT_COMPLETION', 'ACCRUE_NOW_SETTLE_LATER'])
      .optional(),
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
    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SSL: booleanFromEnvironment.default(false),
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnvironment.default(true),
    // SMS-V1-01 — provider-neutral SMS production configuration.
    // Provider selection: 'console' (default, keeps dev/test provider-neutral) or 'robase'.
    NOTIFICATION_SMS_PROVIDER: z.enum(['console', 'robase']).default('console'),
    // Robase verified contract: POST {base}/v1/sms/send with Bearer robe_* key (docs.robase.dev).
    ROBASE_API_BASE_URL: z.string().trim().url().max(2048).default('https://api.robase.dev'),
    ROBASE_API_KEY: optionalEnvironmentSecret,
    ROBASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    // Background delivery worker (provider-neutral). Disabled by default; enable per environment.
    NOTIFICATION_WORKER_ENABLED: booleanFromEnvironment.default(false),
    NOTIFICATION_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(5_000),
    NOTIFICATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    // Bounded SMS retry semantics (delivery level, never reversed into finance).
    SMS_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    SMS_RETRY_BASE_DELAY_SECONDS: z.coerce.number().int().min(5).max(86_400).default(60),
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

    // V1-RELEASE-01: a production deployment must never silently fall back to the
    // 'console' SMS provider. 'console' only ever writes the message (including live OTP
    // codes — see customer-registration.service.ts) to process stdout; it never reaches a
    // real phone. Because NOTIFICATION_SMS_PROVIDER defaults to 'console' and is absent from
    // the shipped .env.example, an operator who does not know this knob exists would deploy
    // a production instance that accepts registrations and logs in-progress OTPs in
    // plaintext to server logs while never actually delivering them — silently breaking the
    // core registration/login flow for every real customer with no error anywhere. Failing
    // configuration validation fast forces an explicit, informed choice of a real provider
    // for the production tier specifically; development/test/staging keep defaulting to
    // 'console' unchanged.
    if (config.NODE_ENV === 'production' && config.NOTIFICATION_SMS_PROVIDER !== 'robase') {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_SMS_PROVIDER'],
        message:
          'A production deployment must set NOTIFICATION_SMS_PROVIDER=robase (with a valid ' +
          'ROBASE_API_KEY) — the default "console" provider never delivers real SMS and would ' +
          'silently break OTP-gated customer flows while logging live OTP codes to server stdout.',
      });
    }

    // SMS-V1-01: when the Robase provider is selected, credentials must be present at startup.
    // Safety property: fail configuration validation fast instead of silently degrading to no delivery.
    if (config.NOTIFICATION_SMS_PROVIDER === 'robase') {
      if (!config.ROBASE_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['ROBASE_API_KEY'],
          message: 'ROBASE_API_KEY is required when NOTIFICATION_SMS_PROVIDER=robase',
        });
      } else if (!config.ROBASE_API_KEY.startsWith('robe_')) {
        context.addIssue({
          code: 'custom',
          path: ['ROBASE_API_KEY'],
          message: 'ROBASE_API_KEY must be a Robase live key (robe_ prefix, see docs.robase.dev)',
        });
      }
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
  });

export type Environment = z.infer<typeof environmentSchema>;

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
