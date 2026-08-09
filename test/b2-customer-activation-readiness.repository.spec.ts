import { randomUUID } from 'node:crypto';

import { B2CustomerActivationReadinessRepository } from '../src/policy/b2-customer-activation-readiness.repository';
import type { B2CustomerActivationReadinessRequestV1 } from '../src/policy/b2-customer-activation-readiness.types';

const buildRequest = (
  overrides: Partial<B2CustomerActivationReadinessRequestV1> = {},
): B2CustomerActivationReadinessRequestV1 => ({
  customerId: randomUUID(),
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  b1ScopeKey: 'commercial.virtual-account.inbound-funding',
  b1ScopeVersion: 1,
  a7ProductKey: 'VIRTUAL_ACCOUNT',
  a7ProductVersion: 1,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  region: 'NG',
  consentPurpose: 'B2_ACTIVATION',
  kycVerificationState: 'VERIFIED',
  a3BindingState: 'VERIFIED',
  a4EligibilityState: 'ELIGIBLE',
  a4CurrentnessState: 'CURRENT',
  a7CompatibilityState: 'COMPATIBLE',
  b1TierState: 'COMPATIBLE',
  b1EntitlementState: 'COMPATIBLE',
  customerConsentState: 'GRANTED',
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

describe('B2 customer activation-readiness repository (B2T03)', () => {
  let repository: B2CustomerActivationReadinessRepository;

  beforeEach(() => {
    repository = new B2CustomerActivationReadinessRepository();
  });

  it('exposes the contract identity', () => {
    expect(repository.getContractName()).toBe('B2-CUSTOMER-ACTIVATION-READINESS');
    expect(repository.getContractVersion()).toBe(1);
    expect(repository.getIdempotencyScope()).toBe(
      'b2.customer-activation-readiness.idempotency.v1',
    );
  });

  it('marks a fully verified customer as ready', () => {
    const decision = repository.generateAttestationDecision(buildRequest());
    expect(decision.activationReady).toBe(true);
    expect(decision.outcome).toBe('ATTESTED_READY');
    expect(decision.verificationState).toBe('VERIFIED');
    expect(decision.activationEligibility).toBe('ELIGIBLE');
    expect(decision.attestationReference.startsWith('b2-activation-readiness-')).toBe(true);
    expect(decision.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.decisionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.decisionReplayHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires consent — single consent failure yields REQUIRES_CONSENT', () => {
    const decision = repository.generateAttestationDecision(
      buildRequest({ customerConsentState: 'NOT_GRANTED' }),
    );
    expect(decision.activationReady).toBe(false);
    expect(decision.outcome).toBe('ATTESTED_REQUIRES_CONSENT');
    expect(decision.activationEligibility).toBe('REQUIRES_CONSENT');
  });

  it('marks KYC pending as PENDING / not ready', () => {
    const decision = repository.generateAttestationDecision(
      buildRequest({ kycVerificationState: 'PENDING' }),
    );
    expect(decision.verificationState).toBe('PENDING');
    expect(decision.outcome).toBe('ATTESTED_NOT_READY');
  });

  it('marks A3 invalid as not ready', () => {
    const decision = repository.generateAttestationDecision(
      buildRequest({ a3BindingState: 'INVALID' }),
    );
    expect(decision.activationReady).toBe(false);
    expect(decision.outcome).toBe('ATTESTED_NOT_READY');
  });

  it('is incompatible on wrong cohort', () => {
    const comp = repository.compatibilityCheck(
      buildRequest({ cohortKey: 'b2.activation.cohort.other' as never }),
    );
    expect(comp.compatible).toBe(false);
    expect(comp.failure?.code).toBe('B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE');
  });

  it('computes a deterministic request hash excluding reference/createdAt', () => {
    const id = randomUUID();
    const base = buildRequest({ customerId: id, idempotencyKey: randomUUID() });
    const h1 = repository.computeRequestHash(base);
    const h2 = repository.computeRequestHash(base);
    expect(h1).toBe(h2);
  });

  it('is replay-safe — same key+hash replays, different hash conflicts', () => {
    const key = randomUUID();
    const req1 = buildRequest({ idempotencyKey: key, customerId: randomUUID() });
    const first = repository.replaySafeGenerateAttestationDecision(req1, null);
    expect(first.replayed).toBe(false);
    expect(first.conflict).toBe(false);
    const decision = first.decision!;
    const req2Same = { ...req1 };
    const replay = repository.replaySafeGenerateAttestationDecision(req2Same, {
      decision,
      requestHash: repository.computeRequestHash(req1),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.decision?.attestationReference).toBe(decision.attestationReference);

    const req3Diff = buildRequest({ idempotencyKey: key, customerId: randomUUID() });
    const conflict = repository.replaySafeGenerateAttestationDecision(req3Diff, {
      decision,
      requestHash: repository.computeRequestHash(req1),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT');
  });
});
