import { validateA7Obligations } from '../src/policy/a7-product-persistence.service';
import { A7_PRODUCT_POLICY_PROFILES } from '../src/policy/a7-product-policy.profiles';

describe('A7 issued obligation identity', () => {
  const expected = A7_PRODUCT_POLICY_PROFILES[1]!.obligations;
  const now = Date.parse('2026-11-06T00:00:00Z');
  it('accepts the exact A4 templates for identity validation, without treating them as fulfilled', () => {
    expect(() => validateA7Obligations(expected, expected, now)).not.toThrow();
  });
  it('rejects missing, duplicated, substituted and weakened obligations', () => {
    expect(() => validateA7Obligations(expected.slice(1), expected, now)).toThrow();
    expect(() =>
      validateA7Obligations([expected[0]!, expected[0]!, ...expected.slice(2)], expected, now),
    ).toThrow();
    expect(() =>
      validateA7Obligations(
        [{ ...expected[0]!, required: false }, ...expected.slice(1)],
        expected,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateA7Obligations(
        expected.map((x) => (x.reference ? { ...x, reference: 'other' } : x)),
        expected,
        now,
      ),
    ).toThrow();
  });
  it('rejects expired or malformed obligation deadlines', () => {
    expect(() =>
      validateA7Obligations(
        [{ ...expected[0]!, expiresAt: '2026-11-05T00:00:00Z' }, ...expected.slice(1)],
        expected,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateA7Obligations(
        [{ ...expected[0]!, dueAt: 'invalid' }, ...expected.slice(1)],
        expected,
        now,
      ),
    ).toThrow();
  });
});
