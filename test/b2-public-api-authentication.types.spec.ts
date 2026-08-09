import {
  B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION,
  B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-public-api-authentication.constants';

describe('B2 public API authentication types (B2T10)', () => {
  it('freezes the contract identity', () => {
    expect(B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME).toBe('B2-PUBLIC-API-AUTHENTICATION');
    expect(B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION).toBe(1);
    expect(B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY).toBe('b2.activation.cohort.inbound-funding');
    expect(B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE).toBe(
      'b2.public-api-authentication.idempotency.v1',
    );
  });
});
