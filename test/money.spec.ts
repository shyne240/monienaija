import {
  normalizeAccountingUnit,
  normalizeCurrency,
  parseMinorUnits,
  parsePositiveMinorUnits,
} from '../src/common/money';

describe('money representation', () => {
  it('keeps large minor-unit values exact', () => {
    expect(parseMinorUnits('9007199254740993')).toBe(9007199254740993n);
    expect(parsePositiveMinorUnits(125000)).toBe(125000n);
  });

  it('rejects floating-point and zero ledger line amounts', () => {
    expect(() => parseMinorUnits(12.5)).toThrow('safe non-negative integer');
    expect(() => parsePositiveMinorUnits('0')).toThrow('greater than zero');
  });

  it('normalizes and validates accounting dimensions', () => {
    expect(normalizeCurrency(' ngn ')).toBe('NGN');
    expect(normalizeAccountingUnit('customer_funds')).toBe('CUSTOMER_FUNDS');
    expect(() => normalizeCurrency('naira')).toThrow('three-letter ISO 4217');
  });
});
