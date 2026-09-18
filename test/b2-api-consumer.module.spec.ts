import { B2_API_CONSUMER_PROVIDERS } from '../src/policy/b2-api-consumer.module';

describe('B2 API consumer module (B2T08)', () => {
  it('exposes the expected providers', () => {
    expect(Array.isArray(B2_API_CONSUMER_PROVIDERS)).toBe(true);
    expect(B2_API_CONSUMER_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });
});
