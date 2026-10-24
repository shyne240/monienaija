import { BadRequestException } from '@nestjs/common';

export interface NormalizedNigerianPhone {
  /** Canonical 10-digit Nigerian national significant number, e.g. 8012345678. */
  canonical: string;
  /** E.164 rendering, e.g. +2348012345678. */
  e164: string;
}

/** Accepts +234/234/0-prefixed or bare Nigerian mobile numbers. */
export function normalizeNigerianPhone(raw: string): NormalizedNigerianPhone {
  const compact = raw.replace(/[\s()-]/g, '');
  let local: string;
  if (/^\+234\d{10}$/.test(compact)) local = compact.slice(4);
  else if (/^234\d{10}$/.test(compact)) local = compact.slice(3);
  else if (/^0\d{10}$/.test(compact)) local = compact.slice(1);
  else if (/^\d{10}$/.test(compact)) local = compact;
  else throw new BadRequestException('phone must be a valid Nigerian mobile number');
  if (!/^[789]\d{9}$/.test(local)) {
    throw new BadRequestException('phone must be a valid Nigerian mobile number');
  }
  return { canonical: local, e164: `+234${local}` };
}
