import { randomUUID } from 'node:crypto';

import { B2MerchantAgentActivationReadinessRepository } from '../src/policy/b2-merchant-agent-activation-readiness.repository';
import { B2MerchantAgentActivationReadinessService } from '../src/policy/b2-merchant-agent-activation-readiness.service';
import {
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT,
} from '../src/policy/b2-merchant-agent-activation-readiness.constants';

import type { B2MerchantActivationReadinessRequestV1 } from '../src/policy/b2-merchant-agent-activation-readiness.types';

const buildMerchant = (
  overrides: Partial<B2MerchantActivationReadinessRequestV1> = {},
): B2MerchantActivationReadinessRequestV1 => ({
  kind: 'MERCHANT',
  merchantId: randomUUID(),
  beneficialOwnerCustomerId: randomUUID(),
  businessType: 'LIMITED_LIABILITY',
  registrationReference: 'RC-123',
  taxIdentifierReference: 'TIN-123',
  settlementAccountReference: 'SETTLE-1',
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

describe('B2 merchant/agent activation-readiness service (B2T04)', () => {
  let service: B2MerchantAgentActivationReadinessService;

  beforeEach(() => {
    service = new B2MerchantAgentActivationReadinessService(
      new B2MerchantAgentActivationReadinessRepository(),
    );
  });

  it('exposes the contract and consumer ports', () => {
    expect(service.getContractName()).toBe(B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(1);
    const ports = service.getConsumerPorts();
    expect(ports.cohortKey).toBe(B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY);
    expect(ports.idempotencyScopeMerchant).toBe(
      B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT,
    );
    expect(ports.idempotencyScopeAgent).toBe(
      B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT,
    );
  });

  it('generates a merchant attestation', () => {
    const d = service.generateAttestationDecision(buildMerchant());
    expect(d.outcome).toBe('ATTESTED_READY');
  });

  it('checks compatibility', () => {
    expect(service.compatibilityCheck(buildMerchant()).compatible).toBe(true);
  });

  it('is replay-safe', () => {
    const req = buildMerchant();
    const first = service.replaySafeGenerateAttestationDecision(req, null);
    const replay = service.replaySafeGenerateAttestationDecision(req, {
      decision: first.decision!,
      requestHash: service.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
  });
});
