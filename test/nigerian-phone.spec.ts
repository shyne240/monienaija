import { BadRequestException } from '@nestjs/common';

import {
  canonicalizeNigerianPhone,
  isCanonicalNigerianPhone,
  isNigerianShaped,
  nationalSignificantNumber,
  normalizeNigerianPhone,
} from '../src/customer/nigerian-phone';

describe('Nigerian phone canonicalization (V1)', () => {
  it('canonicalizes all accepted representations to +234##########', () => {
    const variants = [
      '07065111760',
      '2347065111760',
      '+2347065111760',
      '070 6511 1760',
      '070-6511-1760',
      '(070) 6511 1760',
      '+234 706 511 1760',
    ];
    for (const variant of variants) {
      expect(normalizeNigerianPhone(variant)).toBe('+2347065111760');
      expect(canonicalizeNigerianPhone(variant)).toBe('+2347065111760');
    }
    expect(normalizeNigerianPhone('08012345678')).toBe('+2348012345678');
    expect(normalizeNigerianPhone('08123456789')).toBe('+2348123456789');
    expect(normalizeNigerianPhone('09023456789')).toBe('+2349023456789');
    expect(normalizeNigerianPhone('09145678901')).toBe('+2349145678901');
  });

  it('recognizes Nigerian shapes and rejects invalid/mobile-less prefixes', () => {
    expect(normalizeNigerianPhone('06098765432')).toBeNull(); // Nigerian-shaped, not mobile
    expect(normalizeNigerianPhone('0146 32011')).toBeNull();
    expect(isNigerianShaped('06098765432')).toBe(true);
    expect(() => canonicalizeNigerianPhone('06098765432')).toThrow(BadRequestException);
    expect(() => canonicalizeNigerianPhone('07065')).toThrow(BadRequestException);
    expect(() => canonicalizeNigerianPhone('not-a-phone')).toThrow(BadRequestException);
    expect(() => canonicalizeNigerianPhone('+233244123456')).toThrow(BadRequestException);
  });

  it('non-Nigerian international numbers are not Nigerian-shaped (generic rule applies elsewhere)', () => {
    expect(isNigerianShaped('+14155552671')).toBe(false);
    expect(normalizeNigerianPhone('+14155552671')).toBeNull();
  });

  it('national significant number derivation matches the V1 receiving-number rule', () => {
    expect(nationalSignificantNumber('+2347065111760')).toBe('7065111760');
    expect(nationalSignificantNumber('+14155552671')).toBeNull();
    expect(isCanonicalNigerianPhone('+2347065111760')).toBe(true);
    expect(isCanonicalNigerianPhone('7065111760')).toBe(false);
    expect(isCanonicalNigerianPhone('+23406098765432')).toBe(false);
  });
});
