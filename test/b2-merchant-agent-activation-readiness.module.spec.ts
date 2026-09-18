import { B2_MERCHANT_AGENT_ACTIVATION_READINESS_PROVIDERS } from '../src/policy/b2-merchant-agent-activation-readiness.module';

describe('B2 merchant/agent activation-readiness module (B2T04)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_MERCHANT_AGENT_ACTIVATION_READINESS_PROVIDERS)).toBe(true);
    expect(B2_MERCHANT_AGENT_ACTIVATION_READINESS_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
