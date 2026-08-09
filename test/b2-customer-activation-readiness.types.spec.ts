import {
  B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION,
  B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-customer-activation-readiness.constants';

describe('B2 customer activation-readiness types (B2T03)', () => {
  it('freezes the contract identity', () => {
    expect(B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME).toBe('B2-CUSTOMER-ACTIVATION-READINESS');
    expect(B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION).toBe(1);
    expect(B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY).toBe(
      'b2.activation.cohort.inbound-funding',
    );
    expect(B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE).toBe(
      'b2.customer-activation-readiness.idempotency.v1',
    );
  });
});
