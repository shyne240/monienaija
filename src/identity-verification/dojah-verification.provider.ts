import {
  dojahAddressHttpsTransport,
  dojahHttpsTransport,
  type DojahAddressSubmission,
  type DojahAddressTransport,
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

export interface DojahAddressInput {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string;
  gender?: string;
  mobile: string;
  street: string;
  landmark?: string;
  lga: string;
  state: string;
}

/**
 * Async address verification. `referenceId` is an opaque provider handle; `collected` is present
 * only once the provider has finished a visit, and `null` fields are never invented. Photographs,
 * coordinates and neighbour references the provider may return are intentionally NOT surfaced:
 * this service does not persist address imagery.
 */
export interface DojahAddressStatus {
  referenceId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  verified: boolean;
  collected: {
    address?: string;
    lga?: string;
    state?: string;
  } | null;
}

export interface DojahOptions {
  enabled?: boolean;
  environment?: DojahEnvironment;
  secretKey?: string;
  appId?: string;
  timeoutMs?: number;
  transport?: DojahTransport;
  addressTransport?: DojahAddressTransport;
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

  private readonly addressTransport: DojahAddressTransport;

  constructor(private readonly options: DojahOptions = {}) {
    this.transport = options.transport ?? dojahHttpsTransport;
    this.addressTransport = options.addressTransport ?? dojahAddressHttpsTransport;
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

  /**
   * Submits a documented address-verification request. Dojah resolves these asynchronously, so a
   * successful submit yields a reference to poll — it is never a verification result by itself.
   */
  async submitAddressVerification(
    input: DojahAddressInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ referenceId: string }> {
    if (
      !input ||
      !bounded(input.firstName, 100) ||
      !bounded(input.lastName, 100) ||
      !/^[0-9+][0-9]{6,19}$/.test(input.mobile) ||
      !bounded(input.street, 200) ||
      !bounded(input.lga, 200) ||
      !bounded(input.state, 200) ||
      (input.middleName !== undefined && !bounded(input.middleName, 100)) ||
      (input.gender !== undefined && !bounded(input.gender, 20)) ||
      (input.landmark !== undefined && !bounded(input.landmark, 200)) ||
      (input.dateOfBirth !== undefined && !validDate(input.dateOfBirth))
    )
      throw new DojahVerificationError('INVALID_INPUT');

    const submission: DojahAddressSubmission = {
      firstName: input.firstName,
      lastName: input.lastName,
      mobile: input.mobile,
      street: input.street,
      lga: input.lga,
      state: input.state,
      ...(input.middleName === undefined ? {} : { middleName: input.middleName }),
      ...(input.dateOfBirth === undefined ? {} : { dob: input.dateOfBirth }),
      ...(input.gender === undefined ? {} : { gender: input.gender }),
      ...(input.landmark === undefined ? {} : { landmark: input.landmark }),
    };

    const response = await this.callAddress('POST', submission, null, signal);
    if (response.status === 401 || response.status === 403)
      throw new DojahVerificationError('AUTH_FAILED');
    if (response.status < 200 || response.status >= 300)
      throw new DojahVerificationError('OUTCOME_UNKNOWN');
    const entity = record(record(response.body)?.entity);
    const referenceId = entity?.reference_id;
    // An accepted submission MUST carry a pollable reference; anything else is an unknown outcome.
    if (typeof referenceId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(referenceId))
      throw new DojahVerificationError('OUTCOME_UNKNOWN');
    return { referenceId };
  }

  /**
   * Polls a submitted address verification. Only `COMPLETED` with an explicit provider success
   * indication is reported as verified; every other shape (including a missing status) stays
   * non-verified so the caller cannot treat an unknown provider response as evidence.
   */
  async getAddressVerificationStatus(
    referenceId: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<DojahAddressStatus> {
    if (typeof referenceId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(referenceId))
      throw new DojahVerificationError('INVALID_INPUT');

    const response = await this.callAddress('GET', null, referenceId, signal);
    if (response.status === 401 || response.status === 403)
      throw new DojahVerificationError('AUTH_FAILED');
    if (response.status === 404) throw new DojahVerificationError('INVALID_INPUT');
    if (response.status < 200 || response.status >= 300)
      throw new DojahVerificationError('OUTCOME_UNKNOWN');

    const entity = record(record(response.body)?.entity);
    if (!entity) throw new DojahVerificationError('OUTCOME_UNKNOWN');
    const status = typeof entity.status === 'string' ? entity.status.toLowerCase() : '';
    if (status !== 'pending' && status !== 'completed' && status !== 'failed')
      throw new DojahVerificationError('OUTCOME_UNKNOWN');

    if (status !== 'completed') {
      return {
        referenceId,
        status: status === 'pending' ? 'PENDING' : 'FAILED',
        verified: false,
        collected: null,
      };
    }
    // `completed` alone is not authority: the provider must positively indicate success and return
    // the address it actually collected, otherwise the visit result is indeterminate.
    const succeeded =
      entity.verified === true ||
      entity.verification_status === 'verified' ||
      entity.status_of_verification === 'verified';
    const collectedRaw = record(entity.address) ?? record(entity.collected_address) ?? entity;
    const address = bounded(collectedRaw?.address, 300) ? collectedRaw.address : undefined;
    const lga = bounded(collectedRaw?.lga, 200) ? collectedRaw.lga : undefined;
    const state = bounded(collectedRaw?.state, 200) ? collectedRaw.state : undefined;
    if (!succeeded || !address) {
      return { referenceId, status: 'COMPLETED', verified: false, collected: null };
    }
    return {
      referenceId,
      status: 'COMPLETED',
      verified: true,
      collected: { address, ...(lga ? { lga } : {}), ...(state ? { state } : {}) },
    };
  }

  private async callAddress(
    method: 'POST' | 'GET',
    submission: DojahAddressSubmission | null,
    referenceId: string | null,
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
    const context = {
      environment: environment!,
      authorization: secretKey,
      appId,
      signal: controller.signal,
    };
    try {
      return await Promise.race([
        method === 'POST'
          ? this.addressTransport.submit(submission!, context)
          : this.addressTransport.poll(referenceId!, context),
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
