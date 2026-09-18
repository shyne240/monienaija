import { randomUUID } from 'node:crypto';

import { B2MerchantAgentActivationReadinessRepository } from '../src/policy/b2-merchant-agent-activation-readiness.repository';
import type {
  B2AgentActivationReadinessRequestV1,
  B2MerchantActivationReadinessRequestV1,
} from '../src/policy/b2-merchant-agent-activation-readiness.types';

const buildMerchant = (
  overrides: Partial<B2MerchantActivationReadinessRequestV1> = {},
): B2MerchantActivationReadinessRequestV1 => ({
  kind: 'MERCHANT',
  merchantId: randomUUID(),
  beneficialOwnerCustomerId: randomUUID(),
  businessType: 'LIMITED_LIABILITY',
  registrationReference: 'RC-123456',
  taxIdentifierReference: 'TIN-123456',
  settlementAccountReference: 'SETTLE-REF-1',
  businessIdentityState: 'VERIFIED',
  beneficialOwnerState: 'VERIFIED',
  settlementEligibilityState: 'ELIGIBLE',
  commercialEligibilityState: 'ELIGIBLE',
  a4EligibilityState: 'ELIGIBLE',
  consentState: 'GRANTED',
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  b1ScopeKey: 'commercial.virtual-account.inbound-funding',
  b1ScopeVersion: 1,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  region: 'NG',
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

const buildAgent = (
  overrides: Partial<B2AgentActivationReadinessRequestV1> = {},
): B2AgentActivationReadinessRequestV1 => ({
  kind: 'AGENT',
  agentId: randomUUID(),
  supervisingMerchantId: randomUUID(),
  supervisingCustomerId: randomUUID(),
  agentNetwork: 'NETWORK-A',
  terminalReference: 'TERM-1',
  collectionModeReference: 'CASH',
  businessIdentityState: 'VERIFIED',
  beneficialOwnerState: 'VERIFIED',
  settlementEligibilityState: 'ELIGIBLE',
  commercialEligibilityState: 'ELIGIBLE',
  a4EligibilityState: 'ELIGIBLE',
  consentState: 'GRANTED',
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  b1ScopeKey: 'commercial.virtual-account.inbound-funding',
  b1ScopeVersion: 1,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  region: 'NG',
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

describe('B2 merchant/agent activation-readiness repository (B2T04)', () => {
  let repository: B2MerchantAgentActivationReadinessRepository;

  beforeEach(() => {
    repository = new B2MerchantAgentActivationReadinessRepository();
  });

  it('exposes the contract identity', () => {
    expect(repository.getContractName()).toBe('B2-MERCHANT-AGENT-ACTIVATION-READINESS');
    expect(repository.getIdempotencyScopeMerchant()).toBe(
      'b2.merchant-activation-readiness.idempotency.v1',
    );
    expect(repository.getIdempotencyScopeAgent()).toBe(
      'b2.agent-activation-readiness.idempotency.v1',
    );
  });

  it('marks a fully verified merchant as ready', () => {
    const d = repository.generateAttestationDecision(buildMerchant());
    expect(d.activationReady).toBe(true);
    expect(d.outcome).toBe('ATTESTED_READY');
    expect(d.verificationState).toBe('VERIFIED');
    expect(d.attestationReference.startsWith('b2-merchant-readiness-')).toBe(true);
    expect(d.idempotencyScope).toBe('b2.merchant-activation-readiness.idempotency.v1');
  });

  it('marks a fully verified agent as ready', () => {
    const d = repository.generateAttestationDecision(buildAgent());
    expect(d.activationReady).toBe(true);
    expect(d.outcome).toBe('ATTESTED_READY');
    expect(d.verificationState).toBe('VERIFIED');
    expect(d.attestationReference.startsWith('b2-agent-readiness-')).toBe(true);
  });

  it('requires consent — consent missing yields REQUIRES_CONSENT', () => {
    const d = repository.generateAttestationDecision(
      buildMerchant({ consentState: 'NOT_GRANTED' }),
    );
    expect(d.activationEligibility).toBe('REQUIRES_CONSENT');
    expect(d.outcome).toBe('ATTESTED_REQUIRES_CONSENT');
  });

  it('marks business PENDING as PENDING_VERIFICATION', () => {
    const d = repository.generateAttestationDecision(
      buildMerchant({ businessIdentityState: 'PENDING' }),
    );
    expect(d.verificationState).toBe('PENDING_VERIFICATION');
    expect(d.outcome).toBe('ATTESTED_NOT_READY');
  });

  it('is incompatible on wrong cohort', () => {
    const comp = repository.compatibilityCheck(
      buildMerchant({ cohortKey: 'b2.activation.cohort.other' as never }),
    );
    expect(comp.compatible).toBe(false);
  });

  it('is replay-safe per kind scope — same key+hash replays, different hash conflicts', () => {
    const key = randomUUID();
    const req1 = buildMerchant({ idempotencyKey: key, merchantId: randomUUID() });
    const first = repository.replaySafeGenerateAttestationDecision(req1, null);
    expect(first.replayed).toBe(false);
    const replay = repository.replaySafeGenerateAttestationDecision(req1, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req1),
    });
    expect(replay.replayed).toBe(true);
    const req2 = buildMerchant({ idempotencyKey: key, merchantId: randomUUID() });
    const conflict = repository.replaySafeGenerateAttestationDecision(req2, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req1),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_MERCHANT_AGENT_READINESS_REPLAY_CONFLICT');
  });

  it('computes a deterministic hash excluding reference/createdAt', () => {
    const req = buildAgent({ agentId: randomUUID(), idempotencyKey: randomUUID() });
    const h1 = repository.computeRequestHash(req);
    const h2 = repository.computeRequestHash(req);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});
