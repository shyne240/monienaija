import { B2_CONSENT_PROVIDERS } from '../src/policy/b2-consent.module';

describe('B2 consent module (B2T06)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_CONSENT_PROVIDERS)).toBe(true);
    expect(B2_CONSENT_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
