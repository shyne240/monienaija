/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mock functions without invoking them. */
import { randomUUID } from 'node:crypto';
import type { MonnifyVerificationProvider } from '../src/identity-verification/monnify-verification.provider';
import { selectKycProvider } from '../src/kyc-verification/kyc-provider-router';
import { KycOrchestrator } from '../src/kyc-verification/kyc-orchestrator';
import { assertPolicy, evaluateEligibility } from '../src/kyc-verification/kyc-policy';
import { matchNinDetails, MonnifyKycProvider } from '../src/kyc-verification/monnify-kyc.provider';
import type {
  Attempt,
  KycPolicy,
  KycProvider,
  KycStore,
  VerificationInput,
} from '../src/kyc-verification/kyc.types';
const input: VerificationInput = {
  kind: 'NIN',
  identifier: '00000000000',
  identity: {
    firstName: 'Synthetic',
    lastName: 'Person',
    dateOfBirth: '2000-02-29',
    phone: '00000000000',
  },
};
const policy: KycPolicy = {
  version: 'test-v1',
  enabled: true,
  maxAttemptsPerConsent: 2,
  cooldownSeconds: 1,
  customerWindowSeconds: 60,
  customerWindowLimit: 5,
  providerWindowSeconds: 60,
  providerWindowLimit: 50,
  timeoutMs: 100,
  evidenceValiditySeconds: 3600,
};
const command = {
  customerId: randomUUID(),
  consentId: randomUUID(),
  requestId: randomUUID(),
  sessionToken: 'a'.repeat(43),
  input,
};
const attempt: Attempt = {
  id: randomUUID(),
  customerId: command.customerId,
  consentId: command.consentId,
  kind: 'NIN',
  provider: 'SYNTHETIC',
  outcome: 'DISPATCHING',
  createdAt: new Date(),
  completedAt: null,
  expiresAt: null,
};
const store = (): jest.Mocked<KycStore> => ({
  reserve: jest.fn().mockResolvedValue({ attempt, isNew: true }),
  finish: jest
    .fn()
    .mockImplementation((_attempt: Attempt, outcome: Attempt['outcome']) =>
      Promise.resolve({ ...attempt, outcome }),
    ),
});
const provider = (verify: KycProvider['verify']): KycProvider => ({ code: 'SYNTHETIC', verify });

describe('KYC foundation policy and orchestration', () => {
  it('is disabled without a positively enabled policy, with no provider calls or reservations', async () => {
    const db = store();
    const verify = jest.fn();
    await expect(
      new KycOrchestrator(
        db,
        provider(verify),
        { ...policy, enabled: false },
        Buffer.alloc(32, 1),
        'v1',
        Buffer.alloc(32, 2),
        'owner-v1',
      ).verify(command),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    expect(db.reserve).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('fails closed on missing or invalid policy and invalid input, before dispatch', async () => {
    expect(() => assertPolicy({ ...policy, providerWindowLimit: 0 })).toThrow('INVALID');
    const db = store();
    const verify = jest.fn();
    const orchestrator = new KycOrchestrator(
      db,
      provider(verify),
      policy,
      Buffer.alloc(32, 1),
      'v1',
      Buffer.alloc(32, 2),
      'owner-v1',
    );
    await expect(
      orchestrator.verify({
        ...command,
        input: { ...input, identity: { ...input.identity, dateOfBirth: '2001-02-29' } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      orchestrator.verify({ ...command, input: { ...input, identifier: 'oops' } }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(db.reserve).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('does not re-dispatch a replay and does not store raw identity', async () => {
    const db = store();
    db.reserve.mockResolvedValue({ attempt, isNew: false });
    const verify = jest.fn();
    const result = await new KycOrchestrator(
      db,
      provider(verify),
      policy,
      Buffer.alloc(32, 1),
      'v1',
      Buffer.alloc(32, 2),
      'owner-v1',
    ).verify(command);
    expect(result.outcome).toBe('DISPATCHING');
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(db.reserve.mock.calls)).not.toContain(input.identifier);
    expect(JSON.stringify(db.reserve.mock.calls)).not.toContain('Synthetic');
  });
  it('treats timeouts and thrown errors as unknown, never mismatch', async () => {
    const db = store();
    const verify: KycProvider['verify'] = () => new Promise(() => undefined);
    const result = await new KycOrchestrator(
      db,
      provider(verify),
      policy,
      Buffer.alloc(32, 1),
      'v1',
      Buffer.alloc(32, 2),
      'owner-v1',
    ).verify(command);
    expect(result.outcome).toBe('UNKNOWN');
    expect(db.finish).toHaveBeenCalledTimes(1);
    const db2 = store();
    const failing: KycProvider['verify'] = () => Promise.reject(new Error('sensitive error'));
    expect(
      (
        await new KycOrchestrator(
          db2,
          provider(failing),
          policy,
          Buffer.alloc(32, 1),
          'v1',
          Buffer.alloc(32, 2),
          'owner-v1',
        ).verify(command)
      ).outcome,
    ).toBe('UNKNOWN');
  });
  it('snapshots policy and identity before asynchronous reservation', async () => {
    const currentPolicy = { ...policy };
    const mutable = { ...input, identity: { ...input.identity } };
    const db = store();
    db.reserve.mockImplementation(async () => {
      currentPolicy.evidenceValiditySeconds = 1;
      mutable.identity.firstName = 'Other';
      await Promise.resolve();
      return { attempt, isNew: true };
    });
    const verify = jest
      .fn<ReturnType<KycProvider['verify']>, Parameters<KycProvider['verify']>>()
      .mockResolvedValue({ outcome: 'MATCH' });
    await new KycOrchestrator(
      db,
      provider(verify),
      currentPolicy,
      Buffer.alloc(32, 1),
      'v1',
      Buffer.alloc(32, 2),
      'owner-v1',
    ).verify({ ...command, input: mutable });
    expect(verify.mock.calls[0]![0].identity.firstName).toBe('Synthetic');
    expect(db.finish.mock.calls[0]![2]).toBe(3600);
  });
  it('does not infer eligibility from absent, expired, revoked, or unknown evidence', () => {
    const now = new Date('2026-11-06T00:00:00Z');
    const rules = { version: 'v1', all: ['PHONE'] as const, any: [['BVN', 'NIN'] as const] };
    const p = { version: rules.version, all: [...rules.all], any: rules.any.map((g) => [...g]) };
    const validPhone = {
      type: 'PHONE' as const,
      verified: true,
      revoked: false,
      expiresAt: new Date('2027-01-01'),
    };
    const validNin = {
      type: 'NIN' as const,
      verified: true,
      revoked: false,
      expiresAt: new Date('2027-01-01'),
    };
    expect(evaluateEligibility(null, [validPhone, validNin], now)).toBe('NOT_CONFIGURED');
    expect(evaluateEligibility(p, [validPhone], now)).toBe('PENDING');
    expect(evaluateEligibility(p, [validPhone, { ...validNin, revoked: true }], now)).toBe(
      'PENDING',
    );
    expect(evaluateEligibility(p, [validPhone, { ...validNin, expiresAt: null }], now)).toBe(
      'PENDING',
    );
    expect(evaluateEligibility(p, [validPhone, validNin], now)).toBe('SATISFIED');
  });
  it('routes only to a single explicitly enabled capable provider and never falls back', () => {
    const first = provider(jest.fn());
    const backup = { ...provider(jest.fn()), code: 'BACKUP' };
    const config = { version: 'v1', enabled: true, routes: { BVN: 'SYNTHETIC' } };
    const registry = [
      { provider: first, enabled: true, capabilities: ['BVN'] as const },
      { provider: backup, enabled: true, capabilities: ['BVN', 'NIN'] as const },
    ];
    expect(selectKycProvider(config, 'BVN', registry)).toBe(first);
    expect(() => selectKycProvider(undefined, 'BVN', registry)).toThrow('DISABLED');
    expect(() => selectKycProvider(config, 'NIN', registry)).toThrow('BLOCKED');
    expect(() =>
      selectKycProvider(config, 'BVN', [{ ...registry[0]!, enabled: false }, registry[1]!]),
    ).toThrow('BLOCKED');
    expect(() => selectKycProvider(config, 'BVN', [registry[0]!, registry[0]!])).toThrow('BLOCKED');
  });
  it('uses verified NIN names and birth date, not the untrusted provider match flag', async () => {
    expect(
      matchNinDetails(input.identity, {
        firstName: ' synthetic ',
        lastName: 'PERSON',
        dateOfBirth: '29-Feb-2000',
      }),
    ).toBe(true);
    expect(
      matchNinDetails(input.identity, {
        firstName: 'Other',
        lastName: 'Person',
        dateOfBirth: '29-Feb-2000',
      }),
    ).toBe(false);
    expect(
      matchNinDetails(input.identity, {
        firstName: 'Synthetic',
        lastName: 'Person',
        dateOfBirth: '01-Jan-2000',
      }),
    ).toBe(false);
    const adapter = {
      getNinDetails: jest.fn().mockResolvedValue({
        firstName: 'Impostor',
        lastName: 'Person',
        dateOfBirth: '29-Feb-2000',
        ninInformationMatch: true,
      }),
    } as unknown as MonnifyVerificationProvider;
    await expect(
      new MonnifyKycProvider(adapter).verify(input, new AbortController().signal),
    ).resolves.toEqual({ outcome: 'REVIEW' });
  });
  it('uses the existing Monnify BVN details adapter, preserving negative match for review', async () => {
    const matchBvnDetails = jest.fn().mockResolvedValue({ match: false });
    const adapter = { matchBvnDetails } as unknown as MonnifyVerificationProvider;
    await expect(
      new MonnifyKycProvider(adapter).verify(
        { ...input, kind: 'BVN' },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: 'REVIEW' });
    expect(matchBvnDetails).toHaveBeenCalledWith({
      bvn: input.identifier,
      name: 'Synthetic Person',
      dateOfBirth: '29-Feb-2000',
      mobileNo: input.identity.phone,
    });
  });
});
