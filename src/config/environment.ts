import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
