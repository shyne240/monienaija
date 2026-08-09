import {
  B2_API_CONSUMER_COHORT_KEY,
  B2_API_CONSUMER_CONTRACT_NAME,
  B2_API_CONSUMER_CONTRACT_VERSION,
  B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
  B2_API_CONSUMER_TYPES,
} from '../src/policy/b2-api-consumer.constants';

describe('B2 API consumer types (B2T08)', () => {
  it('freezes the contract identity', () => {
    expect(B2_API_CONSUMER_CONTRACT_NAME).toBe('B2-API-CONSUMER');
    expect(B2_API_CONSUMER_CONTRACT_VERSION).toBe(1);
    expect(B2_API_CONSUMER_COHORT_KEY).toBe('b2.activation.cohort.inbound-funding');
    expect(B2_API_CONSUMER_IDEMPOTENCY_SCOPE).toBe('b2.api-consumer.idempotency.v1');
    expect(B2_API_CONSUMER_TYPES).toEqual(['DEVELOPER', 'MERCHANT', 'AGENT', 'PARTNER']);
  });
});
