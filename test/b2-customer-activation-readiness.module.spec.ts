import { B2_CUSTOMER_ACTIVATION_READINESS_PROVIDERS } from '../src/policy/b2-customer-activation-readiness.module';

describe('B2 customer activation-readiness module (B2T03)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_CUSTOMER_ACTIVATION_READINESS_PROVIDERS)).toBe(true);
    expect(B2_CUSTOMER_ACTIVATION_READINESS_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
