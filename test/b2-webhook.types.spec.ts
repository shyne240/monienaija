import {
  B2_WEBHOOK_COHORT_KEY,
  B2_WEBHOOK_CONTRACT_NAME,
  B2_WEBHOOK_CONTRACT_VERSION,
  B2_WEBHOOK_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-webhook.constants';

describe('B2 webhook types (B2T09)', () => {
  it('freezes the contract identity', () => {
    expect(B2_WEBHOOK_CONTRACT_NAME).toBe('B2-WEBHOOK-AUTHORITY');
    expect(B2_WEBHOOK_CONTRACT_VERSION).toBe(1);
    expect(B2_WEBHOOK_COHORT_KEY).toBe('b2.activation.cohort.inbound-funding');
    expect(B2_WEBHOOK_IDEMPOTENCY_SCOPE).toBe('b2.webhook.idempotency.v1');
  });
});
