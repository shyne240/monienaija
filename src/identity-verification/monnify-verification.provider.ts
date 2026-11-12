import {
  monnifyHttpsTransport,
  type MonnifyPath,
  type MonnifyTransport,
} from './monnify-transport';

export type MonnifyErrorCode =
  | 'DISABLED'
  | 'CONFIGURATION'
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'OUTCOME_UNKNOWN';
export class MonnifyVerificationError extends Error {
  constructor(readonly code: MonnifyErrorCode) {
    super(`Monnify verification: ${code}`);
    this.name = 'MonnifyVerificationError';
  }
}
export interface BvnDetailsInput {
  bvn: string;
  name: string;
  dateOfBirth: string;
  mobileNo: string;
}
export interface BvnAccountInput {
  bvn: string;
  bankCode: string;
  accountNumber: string;
  name: string;
}
export interface NinDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: string;
  phoneNumber?: string;
  /** Not proof that this person owns the identifier. */
  ninInformationMatch?: boolean;
}
export interface MonnifyOptions {
  enabled?: boolean;
  apiKey?: string;
  secretKey?: string;
  timeoutMs?: number;
  transport?: MonnifyTransport;
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
const digits = (value: unknown, n: number): boolean =>
  typeof value === 'string' && new RegExp(`^\\d{${n}}$`).test(value);
const validDate = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const m = /^(\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/.exec(value);
  if (!m) return false;
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].indexOf(m[2]!);
  const year = Number(m[3]);
  const day = Number(m[1]);
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
  );
};

/** Unwired provider: no logging, persistence, automatic retries or customer/financial side effects. */
export class MonnifyVerificationProvider {
  private readonly transport: MonnifyTransport;
  private readonly timeoutMs: number;
  constructor(private readonly options: MonnifyOptions = {}) {
    this.transport = options.transport ?? monnifyHttpsTransport;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async matchBvnDetails(input: BvnDetailsInput): Promise<{ match: boolean }> {
    if (
      !input ||
      !digits(input.bvn, 11) ||
      !bounded(input.name, 150) ||
      !validDate(input.dateOfBirth) ||
      typeof input.mobileNo !== 'string' ||
      !/^\+?\d{7,15}$/.test(input.mobileNo)
    )
      throw new MonnifyVerificationError('INVALID_INPUT');
    const body = await this.verify('/api/v1/vas/bvn-details-match', {
      bvn: input.bvn,
      name: input.name,
      dateOfBirth: input.dateOfBirth,
      mobileNo: input.mobileNo,
    });
    if (typeof body.bvnInformationMatch !== 'boolean')
      throw new MonnifyVerificationError('OUTCOME_UNKNOWN');
    return { match: body.bvnInformationMatch };
  }

  async matchBvnAccount(input: BvnAccountInput): Promise<{ match: boolean }> {
    if (
      !input ||
      !digits(input.bvn, 11) ||
      !digits(input.accountNumber, 10) ||
      typeof input.bankCode !== 'string' ||
      !/^\d{3,6}$/.test(input.bankCode) ||
      !bounded(input.name, 150)
    ) {
      throw new MonnifyVerificationError('INVALID_INPUT');
    }
    const body = await this.verify('/api/v1/vas/bvn-account-match', {
      bvn: input.bvn,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      name: input.name,
    });
    if (typeof body.bvnAccountNameMatch !== 'boolean')
      throw new MonnifyVerificationError('OUTCOME_UNKNOWN');
    return { match: body.bvnAccountNameMatch };
  }

  async getNinDetails(nin: string): Promise<NinDetails> {
    if (!digits(nin, 11)) throw new MonnifyVerificationError('INVALID_INPUT');
    const body = await this.verify('/api/v1/vas/nin-details', { nin });
    if (
      !bounded(body.firstName, 150) ||
      !bounded(body.lastName, 150) ||
      !bounded(body.dateOfBirth, 32) ||
      (body.gender !== undefined && !bounded(body.gender, 32)) ||
      (body.phoneNumber !== undefined && !bounded(body.phoneNumber, 32)) ||
      (body.ninInformationMatch !== undefined && typeof body.ninInformationMatch !== 'boolean')
    ) {
      throw new MonnifyVerificationError('OUTCOME_UNKNOWN');
    }
    return {
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth,
      ...(typeof body.gender === 'string' ? { gender: body.gender } : {}),
      ...(typeof body.phoneNumber === 'string' ? { phoneNumber: body.phoneNumber } : {}),
      ...(typeof body.ninInformationMatch === 'boolean'
        ? { ninInformationMatch: body.ninInformationMatch }
        : {}),
    };
  }

  private async verify(
    path: MonnifyPath,
    payload: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    if (this.options.enabled !== true) throw new MonnifyVerificationError('DISABLED');
    const { apiKey, secretKey } = this.options;
    if (
      !bounded(apiKey, 512) ||
      !bounded(secretKey, 512) ||
      apiKey.includes(':') ||
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 100 ||
      this.timeoutMs > 30000
    ) {
      throw new MonnifyVerificationError('CONFIGURATION');
    }
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const auth = await this.request(
      '/api/v1/auth/login',
      `Basic ${basic}`,
      undefined,
      'AUTH_FAILED',
    );
    const authEnvelope = record(auth.body);
    const token = record(authEnvelope?.responseBody)?.accessToken;
    if (
      auth.status < 200 ||
      auth.status >= 300 ||
      authEnvelope?.requestSuccessful !== true ||
      !bounded(token, 8192) ||
      !/^[\x21-\x7e]+$/.test(token)
    )
      throw new MonnifyVerificationError('AUTH_FAILED');
    const response = await this.request(
      path,
      `Bearer ${token}`,
      JSON.stringify(payload),
      'OUTCOME_UNKNOWN',
    );
    const envelope = record(response.body);
    const body = record(envelope?.responseBody);
    // Even a provider-declared failure may have an ambiguous billable outcome; never retry automatically.
    if (
      response.status < 200 ||
      response.status >= 300 ||
      envelope?.requestSuccessful !== true ||
      envelope.responseCode !== '0' ||
      !body
    )
      throw new MonnifyVerificationError('OUTCOME_UNKNOWN');
    return body;
  }

  private async request(
    path: MonnifyPath,
    authorization: string,
    body: string | undefined,
    errorCode: 'AUTH_FAILED' | 'OUTCOME_UNKNOWN',
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.transport(path, { authorization, body, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Timeout'));
          }, this.timeoutMs);
        }),
      ]);
    } catch {
      throw new MonnifyVerificationError(errorCode);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Caller supplies a secret-manager/env snapshot; this module does not read .env or auto-enable. */
export function monnifyOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): MonnifyOptions {
  if (
    env.MONNIFY_VERIFICATION_ENABLED === undefined ||
    env.MONNIFY_VERIFICATION_ENABLED === 'false'
  )
    return {};
  if (env.MONNIFY_VERIFICATION_ENABLED !== 'true')
    throw new MonnifyVerificationError('CONFIGURATION');
  return {
    enabled: true,
    apiKey: env.MONNIFY_API_KEY,
    secretKey: env.MONNIFY_SECRET_KEY,
  };
}
