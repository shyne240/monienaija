import { B2_PUBLIC_API_AUTHENTICATION_PROVIDERS } from '../src/policy/b2-public-api-authentication.module';

describe('B2 public API authentication module (B2T10)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_PUBLIC_API_AUTHENTICATION_PROVIDERS)).toBe(true);
    expect(B2_PUBLIC_API_AUTHENTICATION_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
