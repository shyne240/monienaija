import {
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT,
} from '../src/policy/b2-merchant-agent-activation-readiness.constants';

describe('B2 merchant/agent activation-readiness types (B2T04)', () => {
  it('freezes the contract identity', () => {
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME).toBe(
      'B2-MERCHANT-AGENT-ACTIVATION-READINESS',
    );
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION).toBe(1);
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY).toBe(
      'b2.activation.cohort.inbound-funding',
    );
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT).toBe(
      'b2.merchant-activation-readiness.idempotency.v1',
    );
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT).toBe(
      'b2.agent-activation-readiness.idempotency.v1',
    );
  });
});
