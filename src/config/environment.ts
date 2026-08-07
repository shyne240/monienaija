import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_VERSION: z.string().trim().min(1).max(64).default('0.1.0'),
  API_VERSION: z.literal('v1').default('v1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  IDEMPOTENCY_RETENTION_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(86_400),
  OUTBOX_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  METRICS_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(2_592_000),
  AUDIT_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(31_536_000),
  OUTBOX_RETENTION_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(2_592_000),
  BUILD_TIMESTAMP: z.string().trim().min(1).max(64).default('unknown'),
  SHUTDOWN_DRAIN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
  A5_PILOT_EMERGENCY_STOP: booleanFromEnvironment.default(false),
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().trim().min(1),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL: booleanFromEnvironment.default(false),
  DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnvironment.default(true),
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
