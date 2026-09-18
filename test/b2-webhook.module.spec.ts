import { B2_WEBHOOK_PROVIDERS } from '../src/policy/b2-webhook.module';

describe('B2 webhook module (B2T09)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_WEBHOOK_PROVIDERS)).toBe(true);
    expect(B2_WEBHOOK_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
