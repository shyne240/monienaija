import {
  premblyHttpsTransport,
  type PremblyTransport,
  type PremblyVerificationPath,
} from './prembly-transport';
import type {
  IdentityDetails,
  IdentityKind,
  VerificationInput,
} from '../kyc-verification/kyc.types';

export type PremblyErrorCode =
  | 'CONFIGURATION'
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'OUTCOME_UNKNOWN';

export class PremblyVerificationError extends Error {
  constructor(readonly code: PremblyErrorCode) {
    // Never attach a provider body, credential, or identity number to an error message.
    super(`Prembly verification: ${code}`);
    this.name = 'PremblyVerificationError';
  }
}

export interface PremblyCredentialResolver {
  getApiKey(): Promise<string | null>;
}

export interface PremblyBasicRecord {
  identifier: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface PremblyConnectionTestResult {
  httpStatus: number;
  responseCode: string | null;
  providerStatus: boolean | null;
}

export interface PremblyOptions {
  credentialResolver: PremblyCredentialResolver;
  transport?: PremblyTransport;
  timeoutMs?: number;
}

// eslint-disable-next-line no-control-regex -- Provider identity fields must not contain control bytes.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function pickString(
  value: Record<string, unknown>,
  keys: readonly string[],
  max = 160,
): string | null {
  for (const key of keys) {
    const field = value[key];
    if (
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field.length <= max &&
      !CONTROL_CHARACTERS.test(field)
    )
      return field.trim();
  }
  return null;
}

function responseCode(body: unknown): string | null {
  const raw = asRecord(body)?.response_code;
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw) ? raw : null;
}

function providerStatus(body: unknown): boolean | null {
  const raw = asRecord(body)?.status;
  return typeof raw === 'boolean' ? raw : null;
}

function validInput(input: VerificationInput): boolean {
  const identity = input?.identity as IdentityDetails | undefined;
  return (
    !!input &&
    (input.kind === 'BVN' || input.kind === 'NIN') &&
    /^\d{11}$/.test(input.identifier) &&
    !!identity &&
    typeof identity.firstName === 'string' &&
    identity.firstName.trim().length > 0 &&
    identity.firstName.length <= 150 &&
    typeof identity.lastName === 'string' &&
    identity.lastName.trim().length > 0 &&
    identity.lastName.length <= 150 &&
    typeof identity.dateOfBirth === 'string' &&
    identity.dateOfBirth.length <= 32
  );
}

function pathFor(kind: IdentityKind): PremblyVerificationPath {
  return kind === 'BVN' ? '/verification/bvn_validation' : '/verification/vnin-basic';
}

/**
 * Minimal Prembly BVN Basic / NIN Basic adapter. It discards raw payloads after extracting only
 * the identity fields needed for customer-side matching. Photos, addresses, phone numbers,
 * response messages, provider references and billing metadata are never returned or persisted.
 */
export class PremblyVerificationProvider {
  private readonly transport: PremblyTransport;
  private readonly timeoutMs: number;

  constructor(private readonly options: PremblyOptions) {
    this.transport = options.transport ?? premblyHttpsTransport;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async verify(input: VerificationInput, signal: AbortSignal): Promise<PremblyBasicRecord | null> {
    if (!validInput(input) || signal.aborted) throw new PremblyVerificationError('INVALID_INPUT');
    const apiKey = await this.safeCredential();
    const result = await this.call(pathFor(input.kind), input.identifier, apiKey, signal);
    if (result.status === 401 || result.status === 403)
      throw new PremblyVerificationError('AUTH_FAILED');
    const body = asRecord(result.body);
    const code = responseCode(result.body);
    if (result.status < 200 || result.status >= 300 || !body)
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');

    // Only the documented success envelope is eligible to supply identity evidence. Error-code
    // meanings are not guessed here; every non-success response remains unknown/fail-closed.
    if (body.status !== true || code !== '00')
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');

    const data = asRecord(body.data);
    if (!data) throw new PremblyVerificationError('OUTCOME_UNKNOWN');
    const identifier = pickString(data, input.kind === 'NIN' ? ['nin', 'number'] : ['bvn'], 32);
    if (identifier !== null && identifier !== input.identifier)
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');

    const firstName = pickString(data, ['firstName', 'firstname', 'first_name']);
    const lastName = pickString(data, ['lastName', 'surname', 'last_name']);
    const dateOfBirth = pickString(data, ['dateOfBirth', 'birthdate', 'date_of_birth', 'dob'], 32);
    if (!firstName || !lastName || !dateOfBirth)
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');

    return { identifier, firstName, lastName, dateOfBirth };
  }

  /**
   * One explicit, read-only-from-the-application's-perspective BVN Basic sandbox request using
   * Prembly's published test record. The provider may still debit sandbox usage; callers must
   * require an authenticated admin action and disclose that consequence.
   */
  async testSandboxConnection(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<PremblyConnectionTestResult> {
    if (signal.aborted) throw new PremblyVerificationError('OUTCOME_UNKNOWN');
    if (typeof apiKey !== 'string' || apiKey.trim().length < 16 || apiKey.length > 512)
      throw new PremblyVerificationError('CONFIGURATION');
    try {
      const response = await this.call(
        '/verification/bvn_validation',
        '54651333604',
        apiKey,
        signal,
      );
      return {
        httpStatus: response.status,
        responseCode: responseCode(response.body),
        providerStatus: providerStatus(response.body),
      };
    } catch {
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');
    }
  }

  private async safeCredential(): Promise<string> {
    try {
      const credential = await this.options.credentialResolver.getApiKey();
      if (
        typeof credential !== 'string' ||
        credential.trim().length < 16 ||
        credential.length > 512
      )
        throw new Error('unavailable');
      return credential;
    } catch {
      throw new PremblyVerificationError('CONFIGURATION');
    }
  }

  private async call(
    path: PremblyVerificationPath,
    number: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    try {
      return await this.transport(path, {
        apiKey,
        number,
        timeoutMs: this.timeoutMs,
        signal,
      });
    } catch {
      throw new PremblyVerificationError('OUTCOME_UNKNOWN');
    }
  }
}
