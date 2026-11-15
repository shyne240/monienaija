import {
  dojahHttpsTransport,
  type DojahEnvironment,
  type DojahPath,
  type DojahTransport,
} from './dojah-transport';

export type DojahErrorCode =
  | 'DISABLED'
  | 'CONFIGURATION'
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'OUTCOME_UNKNOWN';

export class DojahVerificationError extends Error {
  constructor(readonly code: DojahErrorCode) {
    super(`Dojah verification: ${code}`);
    this.name = 'DojahVerificationError';
  }
}

export interface DojahBvnValidationInput {
  bvn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface DojahNinRecord {
  nin: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface DojahOptions {
  enabled?: boolean;
  environment?: DojahEnvironment;
  secretKey?: string;
  appId?: string;
  timeoutMs?: number;
  transport?: DojahTransport;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day || year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};
const fieldStatus = (value: unknown): boolean | undefined => {
  const field = record(value);
  return typeof field?.status === 'boolean' ? field.status : undefined;
};

/**
 * Documented Dojah endpoints behind a disabled-by-default, injectable transport. No retries,
 * response persistence, logging, or fallback are performed. BVN Validate must return the status
 * for every supplied field (including `dob`) before it can produce a positive match; the public
 * example omits the DOB result, so that documented example deliberately remains non-authoritative.
 */
export class DojahVerificationProvider {
  private readonly transport: DojahTransport;
  private readonly timeoutMs: number;

  constructor(private readonly options: DojahOptions = {}) {
    this.transport = options.transport ?? dojahHttpsTransport;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async validateBvn(
    input: DojahBvnValidationInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ match: boolean }> {
    if (
      !input ||
      !/^\d{11}$/.test(input.bvn) ||
      !bounded(input.firstName, 100) ||
      !bounded(input.lastName, 100) ||
      !validDate(input.dateOfBirth)
    )
      throw new DojahVerificationError('INVALID_INPUT');

    const response = await this.request(
      '/api/v1/kyc/bvn',
      {
        bvn: input.bvn,
        first_name: input.firstName,
        last_name: input.lastName,
        dob: input.dateOfBirth,
      },
      signal,
    );
    const error = record(response.body)?.error;
    if (response.status === 400 && error === 'BVN not found') return { match: false };
    if (response.status === 401 || response.status === 403)
      throw new DojahVerificationError('AUTH_FAILED');
    if (response.status < 200 || response.status >= 300)
      throw new DojahVerificationError('OUTCOME_UNKNOWN');

    const entity = record(record(response.body)?.entity);
    const statuses = [
      fieldStatus(entity?.bvn),
      fieldStatus(entity?.first_name),
      fieldStatus(entity?.last_name),
      fieldStatus(entity?.dob),
    ];
    if (statuses.some((status) => status === undefined))
      throw new DojahVerificationError('OUTCOME_UNKNOWN');
    return { match: statuses.every((status) => status === true) };
  }

  async getNinAdvanced(
    nin: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<DojahNinRecord> {
    if (!/^\d{11}$/.test(nin)) throw new DojahVerificationError('INVALID_INPUT');
    const response = await this.request('/api/v1/kyc/nin/advance', { nin }, signal);
    if (response.status === 401 || response.status === 403)
      throw new DojahVerificationError('AUTH_FAILED');
    if (response.status < 200 || response.status >= 300)
      throw new DojahVerificationError('OUTCOME_UNKNOWN');
    const entity = record(record(response.body)?.entity);
    if (
      !entity ||
      entity.nin !== nin ||
      !bounded(entity.first_name, 150) ||
      !bounded(entity.last_name, 150) ||
      !validDate(entity.date_of_birth)
    )
      throw new DojahVerificationError('OUTCOME_UNKNOWN');

    // Photo, address, tax and next-of-kin fields are intentionally neither returned nor persisted.
    return {
      nin: entity.nin,
      firstName: entity.first_name,
      lastName: entity.last_name,
      dateOfBirth: entity.date_of_birth,
    };
  }

  private async request(
    path: DojahPath,
    query: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    if (this.options.enabled !== true) throw new DojahVerificationError('DISABLED');
    const { environment, secretKey, appId } = this.options;
    if (
      !['production', 'sandbox'].includes(environment ?? '') ||
      !bounded(secretKey, 512) ||
      !bounded(appId, 256) ||
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 100 ||
      this.timeoutMs > 30000
    )
      throw new DojahVerificationError('CONFIGURATION');

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.transport(path, {
          environment: environment!,
          authorization: secretKey,
          appId,
          query,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('deadline'));
          }, this.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (signal.aborted) throw new DojahVerificationError('OUTCOME_UNKNOWN');
      if (error instanceof DojahVerificationError) throw error;
      throw new DojahVerificationError('OUTCOME_UNKNOWN');
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
}

/** Caller provides a secret-manager/env snapshot; this module never reads process.env itself. */
export function dojahOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): DojahOptions {
  if (env.DOJAH_VERIFICATION_ENABLED === undefined || env.DOJAH_VERIFICATION_ENABLED === 'false')
    return {};
  if (
    env.DOJAH_VERIFICATION_ENABLED !== 'true' ||
    (env.DOJAH_VERIFICATION_ENV !== 'production' && env.DOJAH_VERIFICATION_ENV !== 'sandbox')
  )
    throw new DojahVerificationError('CONFIGURATION');
  return {
    enabled: true,
    environment: env.DOJAH_VERIFICATION_ENV,
    secretKey: env.DOJAH_SECRET_KEY,
    appId: env.DOJAH_APP_ID,
  };
}
