import { BadRequestException } from '@nestjs/common';

/**
 * V1 Nigerian phone canonicalization.
 *
 * One canonical representation per Nigerian mobile number:
 *
 *     07065111760  =  2347065111760  =  +2347065111760
 *
 * Canonical stored form: E.164 `+234` followed by the 10-digit national
 * significant number (NSN). The NSN is also the deterministic basis of the
 * customer's primary MonieNaija receiving number (Phase 2).
 *
 * This module deliberately does NOT become an international phone project:
 * inputs that are clearly Nigerian-shaped (leading 0, `234`, or `+234`) are
 * validated against the V1 Nigerian mobile rules and REJECTED when invalid;
 * other inputs are left to the caller's generic contact rules.
 */

/** V1 mobile prefixes: 070x, 080x, 081x, 090x, 091x. */
export const NIGERIAN_MOBILE_NSN_PATTERN = /^(70|80|81|90|91)\d{8}$/;

/** Canonical form: +234 followed by a 10-digit mobile NSN. */
export const NIGERIAN_CANONICAL_PHONE_PATTERN = /^\+234(70|80|81|90|91)\d{8}$/;

/** Formatting characters tolerated on input. */
const PHONE_STRIP_PATTERN = /[\s()-]/g;

/**
 * Extracts the 10-digit NSN from a Nigerian-shaped input, or null when the
 * input is not recognisably Nigerian (in which case Nigerian rules do not
 * apply to it at all).
 */
export function nigerianNationalSignificantNumberCandidate(value: string): string | null {
  const cleaned = value.replace(PHONE_STRIP_PATTERN, '');
  const localMatch = /^0(\d{10})$/.exec(cleaned);
  if (localMatch) {
    return localMatch[1] ?? null;
  }
  const intlMatch = /^(?:\+?234)(\d{10})$/.exec(cleaned);
  return intlMatch ? (intlMatch[1] ?? null) : null;
}

/**
 * Normalizes a Nigerian-shaped input to the canonical `+234##########` form,
 * or returns null when the input is not a valid V1 Nigerian mobile number.
 * Non-Nigerian-shaped inputs also return null; callers must distinguish
 * "not Nigerian" from "Nigerian but invalid".
 */
export function normalizeNigerianPhone(value: string): string | null {
  const candidate = nigerianNationalSignificantNumberCandidate(value);
  if (candidate === null) {
    return null;
  }
  if (!NIGERIAN_MOBILE_NSN_PATTERN.test(candidate)) {
    return null;
  }
  return `+234${candidate}`;
}

/** True when the input carries an explicit Nigerian shape (0…, 234…, +234…). */
export function isNigerianShaped(value: string): boolean {
  const cleaned = value.replace(PHONE_STRIP_PATTERN, '');
  return /^0\d{10}$/.test(cleaned) || /^\+?234\d{10}$/.test(cleaned) || /^0\d+$/.test(cleaned);
}

/**
 * Canonicalizes a Nigerian phone or throws with a precise reason. Used where
 * a Nigerian number is mandatory (contact-method PHONE with Nigerian shape,
 * phone-based recipient resolution, registration).
 */
export function canonicalizeNigerianPhone(value: string): string {
  const cleaned = value.replace(PHONE_STRIP_PATTERN, '');
  if (nigerianNationalSignificantNumberCandidate(cleaned) === null) {
    if (!/^[+0-9]/.test(cleaned) || cleaned.length < 8 || cleaned.length > 15) {
      throw new BadRequestException(
        'Nigerian phone number is malformed; expected 11-digit local (07065111760) or +234 (+2347065111760) form',
      );
    }
    throw new BadRequestException(
      'Phone number is not a recognizable Nigerian number; V1 individual customers require a Nigerian mobile number',
    );
  }
  const candidate = nigerianNationalSignificantNumberCandidate(cleaned);
  if (candidate === null || !NIGERIAN_MOBILE_NSN_PATTERN.test(candidate)) {
    throw new BadRequestException(
      'Nigerian phone number is not a valid V1 mobile number (accepted prefixes: 070, 080, 081, 090, 091)',
    );
  }
  return `+234${candidate}`;
}

/** True when value is already the canonical Nigerian stored form. */
export function isCanonicalNigerianPhone(value: string): boolean {
  return NIGERIAN_CANONICAL_PHONE_PATTERN.test(value);
}

/** The national significant number (10 digits) of a canonical phone: +2347065111760 → 7065111760. */
export function nationalSignificantNumber(canonicalPhone: string): string | null {
  if (!isCanonicalNigerianPhone(canonicalPhone)) {
    return null;
  }
  return canonicalPhone.slice(4);
}
