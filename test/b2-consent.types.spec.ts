import {
  B2_CONSENT_COHORT_KEY,
  B2_CONSENT_CONTRACT_NAME,
  B2_CONSENT_CONTRACT_VERSION,
  B2_CONSENT_IDEMPOTENCY_SCOPE,
  B2_CONSENT_PURPOSES,
  B2_CONSENT_STATES,
} from '../src/policy/b2-consent.constants';

describe('B2 consent types (B2T06)', () => {
  it('freezes the contract identity and vocabularies', () => {
    expect(B2_CONSENT_CONTRACT_NAME).toBe('B2-CONSENT-AUTHORITY');
    expect(B2_CONSENT_CONTRACT_VERSION).toBe(1);
    expect(B2_CONSENT_COHORT_KEY).toBe('b2.activation.cohort.inbound-funding');
    expect(B2_CONSENT_IDEMPOTENCY_SCOPE).toBe('b2.consent.idempotency.v1');
    expect(B2_CONSENT_PURPOSES).toEqual([
      'B2_ACTIVATION',
      'B2_COMMERCIAL',
      'B2_SELF_SERVICE',
      'MARKETING_COMMERCIAL_OFFER',
    ]);
    expect(B2_CONSENT_STATES).toEqual(['PENDING', 'GRANTED', 'REVOKED', 'EXPIRED']);
  });
});
