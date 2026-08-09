import { randomUUID } from 'node:crypto';

import { B2CustomerActivationReadinessRepository } from '../src/policy/b2-customer-activation-readiness.repository';
import { B2CustomerActivationReadinessService } from '../src/policy/b2-customer-activation-readiness.service';
import {
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION,
  B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY,
  B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION,
  B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-customer-activation-readiness.constants';
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

describe('B2 customer activation-readiness service (B2T03)', () => {
  let service: B2CustomerActivationReadinessService;

  beforeEach(() => {
    service = new B2CustomerActivationReadinessService(
      new B2CustomerActivationReadinessRepository(),
    );
  });

  it('exposes the contract name and version', () => {
    expect(service.getContractName()).toBe(B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION);
  });

  it('exposes the cohort identity and idempotency scope', () => {
    const ports = service.getConsumerPorts();
    expect(ports.cohortKey).toBe(B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY);
    expect(ports.cohortVersion).toBe(B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION);
    expect(ports.idempotencyScope).toBe(B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE);
  });

  it('generates a deterministic attestation', () => {
    const decision = service.generateAttestationDecision(buildRequest());
    expect(decision.outcome).toBe('ATTESTED_READY');
    expect(decision.activationReady).toBe(true);
  });

  it('checks compatibility', () => {
    expect(service.compatibilityCheck(buildRequest()).compatible).toBe(true);
  });

  it('is replay-safe', () => {
    const req = buildRequest();
    const first = service.replaySafeGenerateAttestationDecision(req, null);
    expect(first.replayed).toBe(false);
    const replay = service.replaySafeGenerateAttestationDecision(req, {
      decision: first.decision!,
      requestHash: service.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
  });

  it('computes a stable request hash', () => {
    const req = buildRequest({ customerId: randomUUID() });
    expect(service.computeRequestHash(req)).toMatch(/^[a-f0-9]{64}$/);
  });
});
