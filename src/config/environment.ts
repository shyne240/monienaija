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
    A6_PARTNER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    A6_PARTNER_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(3_000),
    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SSL: booleanFromEnvironment.default(false),
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnvironment.default(true),
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
