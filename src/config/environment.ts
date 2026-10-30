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
const optionalEnvironmentHttpsUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().url().max(2048).refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  }, 'must be an HTTPS URL without embedded credentials').optional(),
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
    CASH_TO_CASH_EXPIRY_WORKER_ENABLED: booleanFromEnvironment.default(false),
    CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
    CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    CASH_TO_CASH_EXPIRY_WORKER_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    CASH_TO_CASH_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(604800),
    // Optional public locator URL; included in beneficiary SMS only when configured.
    CASH_TO_CASH_LOCATOR_URL: optionalEnvironmentHttpsUrl,
    // Secure PoA uploads are inert unless explicitly enabled. Local disk/key-file storage is
    // development/test only; production requires S3-compatible storage and a managed keyring.
    POA_UPLOADS_ENABLED: booleanFromEnvironment.default(false),
    POA_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(10_485_760).default(10_485_760),
    POA_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    POA_LOCAL_STORAGE_ROOT: z.string().trim().min(1).max(2048).default('./data/private-poa/objects'),
    POA_ENCRYPTION_KEY_FILE: z.string().trim().min(1).max(2048).default('./data/private-poa/encryption.key'),
    POA_ENCRYPTION_KEYRING_JSON: optionalEnvironmentJson,
    POA_ENCRYPTION_ACTIVE_KEY_VERSION: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/).default('v1'),
    POA_CLAMAV_HOST: z.string().trim().min(1).max(255).default('127.0.0.1'),
    POA_CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    POA_CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
    POA_S3_BUCKET: optionalEnvironmentString,
    POA_S3_REGION: optionalEnvironmentString,
    POA_S3_ENDPOINT: optionalEnvironmentUrl,
    POA_S3_FORCE_PATH_STYLE: booleanFromEnvironment.default(false),
    // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — approved-decision accounting configuration.
    // All optional; absence means the commercial accounting layer is inert (legacy evidence-only
    // posture). When enabled, treatment/timing must be explicit — the selected values are
    // evaluated at runtime and any decision requiring an absent treatment fails closed.
    COMMERCIAL_ACCOUNTING_ENABLED: booleanFromEnvironment.default(false),
    // V1-GO-LIVE-01: these three fields must tolerate the empty-string value that the
    // shipped .env.example documents for the inert (disabled) posture. Without the same
    // empty-string-to-undefined preprocessing used by optionalEnvironmentString/Url/Secret
    // above, z.enum(...).optional() rejects "" as an invalid enum member (it is not
    // undefined), which made the canonical .env.example reference file fail
    // validateEnvironment() on every boot path (main.ts, data-source.ts, app.module.ts) —
    // a fresh deployer following the repo's own documented configuration could not start
    // the application, run migrations, or load the module tree at all.
    COMMERCIAL_ACCOUNTING_VAT_TREATMENT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.enum(['EXCLUSIVE_ADD_ON', 'INCLUSIVE_IN_FEE']).optional(),
    ),
    COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.enum(['EXPENSE_PAYABLE', 'AGENT_WALLET_NETTING', 'CONTRA_REVENUE']).optional(),
    ),
    COMMERCIAL_COMMISSION_RECOGNITION_TIMING: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.enum(['AT_COMPLETION', 'ACCRUE_NOW_SETTLE_LATER']).optional(),
    ),
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
    // V1-SECURITY-SUPER-ADMIN-RECOVERY-01: structurally independent from the bootstrap
    // (A2_BOOTSTRAP_*) settings above — a separate enable flag, audience, and trusted-key set,
    // so the bootstrap ceremony and the SUPER_ADMIN recovery/revocation ceremony never share a
    // signing-key custody chain. See workforce-configuration.ts and
    // docs/deployment/V1-SUPER-ADMIN-RECOVERY-RUNBOOK-01.md.
    A2_RECOVERY_ENABLED: booleanFromEnvironment.default(false),
    A2_RECOVERY_AUDIENCE: optionalEnvironmentString,
    A2_RECOVERY_JWKS_JSON: optionalEnvironmentJson,
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
    // SMS-V1-01 — provider-neutral SMS production configuration.
    // Provider selection: 'console' (default, keeps dev/test provider-neutral), 'robase'
    // (env-supplied key), or 'managed' (governed DB-encrypted runtime configuration).
    NOTIFICATION_SMS_PROVIDER: z.enum(['console', 'robase', 'managed']).default('console'),
    // Robase verified contract: POST {base}/v1/sms/send with Bearer robe_* key (docs.robase.dev).
    ROBASE_API_BASE_URL: z.string().trim().url().max(2048).default('https://api.robase.dev'),
    ROBASE_API_KEY: optionalEnvironmentSecret,
    ROBASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    // Server-side AES-256-GCM encryption keys for governed provider credentials stored in PostgreSQL.
    NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: optionalEnvironmentJson,
    NOTIFICATION_PROVIDER_ENCRYPTION_KEY: optionalEnvironmentString,
    NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('v1'),
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
    // ARENA3-NOTIFICATION-EMAIL — provider-neutral EMAIL configuration (mirrors the SMS posture).
    // 'none' (default): email DARK — dispatcher generates no EMAIL intents, worker fails closed.
    // 'console': dev/test only (logs + in-memory; rejected in production by refinement below).
    // 'brevo': Brevo v3 Transactional Email API — requires BREVO_API_KEY (xkeysib- prefix) + NOTIFICATION_EMAIL_FROM.
    // 'resend': Resend HTTP API — requires RESEND_API_KEY (re_ prefix) + NOTIFICATION_EMAIL_FROM.
    // 'managed': governed DB-encrypted runtime configuration via Admin Web.
    NOTIFICATION_EMAIL_PROVIDER: z
      .enum(['none', 'console', 'brevo', 'resend', 'managed'])
      .default('none'),
    BREVO_API_BASE_URL: z.string().trim().url().max(2048).default('https://api.brevo.com'),
    BREVO_API_KEY: optionalEnvironmentSecret,
    BREVO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    RESEND_API_BASE_URL: z.string().trim().url().max(2048).default('https://api.resend.com'),
    RESEND_API_KEY: optionalEnvironmentSecret,
    RESEND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    // Verified sender identity, e.g. "notifications@monienaija.ng" or "MonieNaija <notifications@monienaija.ng>".
    NOTIFICATION_EMAIL_FROM: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(3).max(320).optional(),
    ),
    NOTIFICATION_EMAIL_FROM_NAME: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).max(120).optional(),
    ),
    NOTIFICATION_EMAIL_REPLY_TO: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(3).max(320).optional(),
    ),
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
    if (
      config.NODE_ENV === 'production' &&
      config.NOTIFICATION_SMS_PROVIDER !== 'robase' &&
      config.NOTIFICATION_SMS_PROVIDER !== 'managed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_SMS_PROVIDER'],
        message:
          'A production deployment must set NOTIFICATION_SMS_PROVIDER=robase (with a valid ' +
          'ROBASE_API_KEY) or NOTIFICATION_SMS_PROVIDER=managed (governed DB-encrypted runtime ' +
          'configuration) — the default "console" provider never delivers real SMS and would ' +
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

    // Validate optional server-side AES-256-GCM keyring/key for governed provider secrets.
    let hasValidNotificationEncryptionKey = false;
    if (config.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON) {
      try {
        const parsed = JSON.parse(config.NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON must be a JSON object');
        }
        const entries = Object.entries(parsed as Record<string, unknown>);
        if (entries.length === 0) {
          throw new Error(
            'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON must contain at least one key version',
          );
        }
        for (const [version, encoded] of entries) {
          if (!/^[A-Za-z0-9._-]{1,64}$/.test(version) || typeof encoded !== 'string') {
            throw new Error(`Invalid notification encryption key entry for version "${version}"`);
          }
          const normalized = encoded.trim();
          const decoded = Buffer.from(normalized, 'base64');
          if (decoded.length !== 32 || decoded.toString('base64') !== normalized) {
            throw new Error(
              `Notification encryption key version "${version}" must decode to 32 bytes base64`,
            );
          }
        }
        if (
          !(parsed as Record<string, unknown>)[
            config.NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION
          ]
        ) {
          throw new Error(
            `NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION "${config.NOTIFICATION_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION}" is missing from NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON`,
          );
        }
        hasValidNotificationEncryptionKey = true;
      } catch (error) {
        context.addIssue({
          code: 'custom',
          path: ['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'],
          message:
            error instanceof Error
              ? error.message
              : 'Invalid NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON',
        });
      }
    } else if (config.NOTIFICATION_PROVIDER_ENCRYPTION_KEY) {
      const normalized = config.NOTIFICATION_PROVIDER_ENCRYPTION_KEY.trim();
      const decoded = Buffer.from(normalized, 'base64');
      if (decoded.length !== 32 || decoded.toString('base64') !== normalized) {
        context.addIssue({
          code: 'custom',
          path: ['NOTIFICATION_PROVIDER_ENCRYPTION_KEY'],
          message: 'NOTIFICATION_PROVIDER_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
        });
      } else {
        hasValidNotificationEncryptionKey = true;
      }
    }

    if (
      (config.NOTIFICATION_SMS_PROVIDER === 'managed' ||
        config.NOTIFICATION_EMAIL_PROVIDER === 'managed') &&
      !hasValidNotificationEncryptionKey
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON'],
        message:
          'NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON or NOTIFICATION_PROVIDER_ENCRYPTION_KEY is required when NOTIFICATION_SMS_PROVIDER=managed or NOTIFICATION_EMAIL_PROVIDER=managed',
      });
    }

    // ARENA3-NOTIFICATION-EMAIL: production must never run the console email adapter — it
    // writes full message bodies (potentially transaction details) to stdout and delivers
    // nothing. 'none' stays legal in production: email is a dark channel until operations
    // explicitly enable it (unlike SMS, no OTP-gated flow depends on email today).
    if (config.NODE_ENV === 'production' && config.NOTIFICATION_EMAIL_PROVIDER === 'console') {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_EMAIL_PROVIDER'],
        message:
          'NOTIFICATION_EMAIL_PROVIDER=console is restricted to development/test — production ' +
          'must use "brevo", "resend", "managed", or "none" (email dark).',
      });
    }

    // Fail-fast credential validation when Brevo is selected via environment variables.
    if (config.NOTIFICATION_EMAIL_PROVIDER === 'brevo') {
      if (!config.BREVO_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['BREVO_API_KEY'],
          message: 'BREVO_API_KEY is required when NOTIFICATION_EMAIL_PROVIDER=brevo',
        });
      } else if (config.BREVO_API_KEY.startsWith('xsmtpsib-')) {
        context.addIssue({
          code: 'custom',
          path: ['BREVO_API_KEY'],
          message:
            'BREVO_API_KEY appears to be an SMTP relay key (xsmtpsib- prefix); Brevo HTTP v3 transactional email requires a REST API key (xkeysib- prefix)',
        });
      } else if (!config.BREVO_API_KEY.startsWith('xkeysib-')) {
        context.addIssue({
          code: 'custom',
          path: ['BREVO_API_KEY'],
          message: 'BREVO_API_KEY must be a Brevo v3 REST API key (xkeysib- prefix)',
        });
      }
      if (!config.NOTIFICATION_EMAIL_FROM || !config.NOTIFICATION_EMAIL_FROM.includes('@')) {
        context.addIssue({
          code: 'custom',
          path: ['NOTIFICATION_EMAIL_FROM'],
          message:
            'NOTIFICATION_EMAIL_FROM (verified sender identity containing @) is required when ' +
            'NOTIFICATION_EMAIL_PROVIDER=brevo',
        });
      }
    }

    // ARENA3-NOTIFICATION-EMAIL: fail-fast credential validation when Resend is selected —
    // same safety property as the Robase refinement (never silently degrade to no delivery).
    if (config.NOTIFICATION_EMAIL_PROVIDER === 'resend') {
      if (!config.RESEND_API_KEY) {
        context.addIssue({
          code: 'custom',
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required when NOTIFICATION_EMAIL_PROVIDER=resend',
        });
      } else if (!config.RESEND_API_KEY.startsWith('re_')) {
        context.addIssue({
          code: 'custom',
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY must be a Resend live key (re_ prefix)',
        });
      }
      if (!config.NOTIFICATION_EMAIL_FROM || !config.NOTIFICATION_EMAIL_FROM.includes('@')) {
        context.addIssue({
          code: 'custom',
          path: ['NOTIFICATION_EMAIL_FROM'],
          message:
            'NOTIFICATION_EMAIL_FROM (verified sender identity containing @) is required when ' +
            'NOTIFICATION_EMAIL_PROVIDER=resend',
        });
      }
    }
    if (config.NOTIFICATION_EMAIL_REPLY_TO && !config.NOTIFICATION_EMAIL_REPLY_TO.includes('@')) {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_EMAIL_REPLY_TO'],
        message: 'NOTIFICATION_EMAIL_REPLY_TO must contain a valid reply address (@)',
      });
    }

    if (config.POA_UPLOADS_ENABLED) {
      if (config.POA_STORAGE_PROVIDER === 'local' && !['development', 'test'].includes(config.NODE_ENV)) {
        context.addIssue({
          code: 'custom',
          path: ['POA_STORAGE_PROVIDER'],
          message: 'The local Proof of Address storage adapter is restricted to development/test',
        });
      }
      if (config.POA_STORAGE_PROVIDER === 's3') {
        if (!config.POA_S3_BUCKET || !config.POA_S3_REGION) {
          context.addIssue({
            code: 'custom',
            path: ['POA_S3_BUCKET'],
            message: 'POA_S3_BUCKET and POA_S3_REGION are required when S3 storage is enabled',
          });
        }
        if (!config.POA_ENCRYPTION_KEYRING_JSON) {
          context.addIssue({
            code: 'custom',
            path: ['POA_ENCRYPTION_KEYRING_JSON'],
            message: 'An operator-managed POA_ENCRYPTION_KEYRING_JSON is required for S3 storage',
          });
        }
      }
      if (config.NODE_ENV === 'production' && config.POA_STORAGE_PROVIDER !== 's3') {
        context.addIssue({
          code: 'custom',
          path: ['POA_STORAGE_PROVIDER'],
          message: 'Production Proof of Address uploads require the S3-compatible storage adapter',
        });
      }
      if (config.POA_STORAGE_PROVIDER === 'local' && config.POA_ENCRYPTION_KEYRING_JSON) {
        context.addIssue({
          code: 'custom',
          path: ['POA_ENCRYPTION_KEYRING_JSON'],
          message: 'Use the persistent local key file with the development-only local storage adapter',
        });
      }
      if (config.POA_ENCRYPTION_KEYRING_JSON) {
        try {
          const keyring: unknown = JSON.parse(config.POA_ENCRYPTION_KEYRING_JSON);
          if (!keyring || typeof keyring !== 'object' || Array.isArray(keyring)) {
            throw new Error('not a key map');
          }
          const entries = Object.entries(keyring as Record<string, unknown>);
          if (!entries.some(([version]) => version === config.POA_ENCRYPTION_ACTIVE_KEY_VERSION)) {
            context.addIssue({
              code: 'custom',
              path: ['POA_ENCRYPTION_ACTIVE_KEY_VERSION'],
              message: 'The active Proof of Address encryption-key version must exist in the keyring',
            });
          }
          for (const [version, encodedKey] of entries) {
            const decoded = typeof encodedKey === 'string' ? Buffer.from(encodedKey, 'base64') : Buffer.alloc(0);
            if (
              !/^[A-Za-z0-9._-]{1,64}$/.test(version) ||
              decoded.length !== 32 ||
              decoded.toString('base64') !== encodedKey
            ) {
              context.addIssue({
                code: 'custom',
                path: ['POA_ENCRYPTION_KEYRING_JSON'],
                message: 'Every Proof of Address keyring entry must be a versioned, 32-byte base64 key',
              });
              break;
            }
          }
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['POA_ENCRYPTION_KEYRING_JSON'],
            message: 'POA_ENCRYPTION_KEYRING_JSON must be a JSON object of versioned base64 keys',
          });
        }
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
