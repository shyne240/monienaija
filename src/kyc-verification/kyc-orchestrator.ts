import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertPolicy } from './kyc-policy';
import {
  KycFoundationError,
  type Attempt,
  type IdentityDetails,
  type KycPolicy,
  type KycProvider,
  type KycStore,
  type VerificationInput,
} from './kyc.types';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function constantTimeMacEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function validIsoDate(date: unknown): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day || year < 1900) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
function validInput(input: VerificationInput): boolean {
  if (
    !input ||
    !['BVN', 'NIN'].includes(input.kind) ||
    typeof input.identifier !== 'string' ||
    !/^\d{11}$/.test(input.identifier) ||
    !input.identity
  )
    return false;
  const { firstName, lastName, dateOfBirth, phone } = input.identity;
  return (
    [firstName, lastName].every(
      (x) =>
        typeof x === 'string' &&
        x.trim().length > 0 &&
        x.length <= 100 &&
        ![...x].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127),
    ) &&
    validIsoDate(dateOfBirth) &&
    typeof phone === 'string' &&
    /^\+?\d{7,15}$/.test(phone)
  );
}

export function identityBindingMac(
  customerId: string,
  identity: IdentityDetails,
  key: Buffer,
): string {
  if (
    !UUID.test(customerId) ||
    !Buffer.isBuffer(key) ||
    key.length < 32 ||
    !validInput({ kind: 'BVN', identifier: '00000000000', identity })
  )
    throw new KycFoundationError('INVALID');
  return createHmac('sha256', key)
    .update('kyc-identity-binding-v1')
    .update('\0')
    .update(
      JSON.stringify([
        customerId,
        identity.firstName,
        identity.lastName,
        identity.dateOfBirth,
        identity.phone,
      ]),
    )
    .digest('hex');
}

/** Internal building block only; caller must authenticate, authorize, and supply authoritative identity data. */
export class KycOrchestrator {
  constructor(
    private readonly store: KycStore,
    private readonly provider: KycProvider,
    private readonly policy: KycPolicy,
    private readonly macKey: Buffer,
    private readonly macKeyVersion: string,
    private readonly ownershipKey: Buffer,
    private readonly ownershipKeyVersion: string,
  ) {}
  async verify(command: {
    customerId: string;
    consentId: string;
    requestId: string;
    sessionToken: string;
    input: VerificationInput;
  }): Promise<Attempt> {
    const policy = { ...this.policy };
    assertPolicy(policy);
    if (!policy.enabled) throw new KycFoundationError('DISABLED');
    if (
      !UUID.test(command.customerId) ||
      !UUID.test(command.consentId) ||
      !UUID.test(command.requestId) ||
      !validInput(command.input) ||
      !/^[A-Z][A-Z0-9_]{0,31}$/.test(this.provider.code) ||
      !Buffer.isBuffer(this.macKey) ||
      this.macKey.length < 32 ||
      !Buffer.isBuffer(this.ownershipKey) ||
      this.ownershipKey.length < 32 ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(this.ownershipKeyVersion) ||
      typeof command.sessionToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(command.sessionToken) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(this.macKeyVersion)
    )
      throw new KycFoundationError('INVALID');
    const macKey = Buffer.from(this.macKey);
    const { kind, identifier } = command.input;
    const identity = { ...command.input.identity };
    const input: VerificationInput = { kind, identifier, identity };
    const mac = (purpose: string, value: string) =>
      createHmac('sha256', macKey).update(purpose).update('\0').update(value).digest('hex');
    // Fixed field order; the server controls the trusted identity values, not a free-form payload.
    const requestMac = mac(
      'kyc-request-v1',
      JSON.stringify([
        command.customerId,
        command.consentId,
        this.provider.code,
        kind,
        identifier,
        identity.firstName,
        identity.lastName,
        identity.dateOfBirth,
        identity.phone,
      ]),
    );
    const reserved = await this.store.reserve({
      customerId: command.customerId,
      consentId: command.consentId,
      requestId: command.requestId,
      kind,
      provider: this.provider.code,
      sessionToken: command.sessionToken,
      identifierMac: createHmac('sha256', this.ownershipKey)
        .update('kyc-identifier-v1\0')
        .update(kind)
        .update('\0')
        .update(identifier)
        .digest('hex'),
      ownershipKeyProof: createHmac('sha256', this.ownershipKey)
        .update('kyc-ownership-key-proof-v1')
        .digest('hex'),
      ownershipKeyVersion: this.ownershipKeyVersion,
      requestMac,
      identityMac: identityBindingMac(command.customerId, identity, macKey),
      macKeyVersion: this.macKeyVersion,
      policy,
    });
    if (!reserved.isNew) return reserved.attempt;
    let result: { outcome: 'MATCH' | 'REVIEW'; reference?: string } | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        this.provider.verify(input, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('deadline'));
          }, policy.timeoutMs);
        }),
      ]);
    } catch {
      /* Ambiguous: never classify outage/timeout as a mismatch or retry. */
    } finally {
      if (timer) clearTimeout(timer);
    }
    const outcome =
      result?.outcome === 'MATCH' || result?.outcome === 'REVIEW' ? result.outcome : 'UNKNOWN';
    const referenceMac =
      typeof result?.reference === 'string' &&
      result.reference.length > 0 &&
      result.reference.length <= 512
        ? mac('kyc-provider-reference-v1', result.reference)
        : null;
    return this.store.finish(
      reserved.attempt,
      outcome,
      policy.evidenceValiditySeconds,
      referenceMac,
    );
  }
}
