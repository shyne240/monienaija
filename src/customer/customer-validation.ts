import { alpha3ToAlpha2, getAlpha2Codes } from 'i18n-iso-countries';
import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
import { postcodeValidator, postcodeValidatorExistsForCountry } from 'postcode-validator';

import { AddressType, ContactMethodType, IdentityDocumentType } from './customer.enums';
import type { CustomerType } from './customer.enums';

export type CustomerFieldErrors = Record<string, string>;

export interface PhoneNumberResult {
  valid: boolean;
  e164?: string;
  country?: string;
  nationalNumber?: string;
  type?: string;
  message?: string;
}

export interface PostalCodeResult {
  valid: boolean;
  /** False means a safe fallback was used because no maintained rule is available for the country. */
  supported: boolean;
}

const ISO_ALPHA2_CODES = getAlpha2Codes();
const CONTROL_OR_BIDI_CHARACTERS = /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/u;
// ZWNJ and ZWJ are separately admitted so Unicode-name scripts can retain meaningful joiners.
const NAME_CHARACTERS = /^(?:[\p{L}\p{M}\p{N}\p{Zs}.'’‘`\-‐‑‒–—(),/&+]|\u200C|\u200D)+$/u;
const NAME_HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const EMAIL_LOCAL_ATOM = /^[\p{L}\p{M}\p{N}!#$%&'*+/=?^_`{|}~-]+$/u;
const SAFE_POSTAL_FALLBACK = /^[\p{L}\p{N}][\p{L}\p{N} .,'’()\-/]{0,19}$/u;
const PHONE_INPUT_CHARACTERS = /^\+?[0-9().\-\s]+$/u;
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

export function normalizeCustomerText(value: string): string {
  return value.normalize('NFC').trim();
}

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function isValidFreeText(value: unknown, maxCodePoints: number): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeCustomerText(value);
  return Boolean(
    normalized &&
      countUnicodeCodePoints(normalized) <= maxCodePoints &&
      !CONTROL_OR_BIDI_CHARACTERS.test(normalized),
  );
}

export function isValidCustomerName(value: unknown, maxCodePoints: number): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeCustomerText(value);
  return Boolean(
    isValidFreeText(normalized, maxCodePoints) &&
      NAME_CHARACTERS.test(normalized) &&
      NAME_HAS_LETTER_OR_NUMBER.test(normalized),
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizeEmailAddress(value: string): string {
  return normalizeCustomerText(value).toLowerCase();
}

export function isValidEmailAddress(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const value = normalizeEmailAddress(input);
  if (!value || utf8ByteLength(value) > 254 || CONTROL_OR_BIDI_CHARACTERS.test(value)) return false;

  const atIndex = value.indexOf('@');
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) return false;
  const localPart = value.slice(0, atIndex);
  const domainPart = value.slice(atIndex + 1);
  if (
    !localPart ||
    utf8ByteLength(localPart) > 64 ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    domainPart.length > 253 ||
    domainPart.startsWith('.') ||
    domainPart.endsWith('.') ||
    domainPart.includes('..') ||
    /[\s:/?#@\\\x5B\x5D]/u.test(domainPart)
  ) {
    return false;
  }

  const localAtoms = localPart.split('.');
  if (localAtoms.some((atom) => !EMAIL_LOCAL_ATOM.test(atom))) return false;

  let asciiDomain: string;
  try {
    asciiDomain = new URL(`http://${domainPart}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!asciiDomain || asciiDomain.length > 253 || asciiDomain.endsWith('.')) return false;
  const labels = asciiDomain.split('.');
  if (labels.length < 2) return false;
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    )
  ) {
    return false;
  }
  const topLevelDomain = labels.at(-1);
  if (!topLevelDomain) return false;
  return /^[a-z]{2,63}$/i.test(topLevelDomain);
}

export function normalizeIsoCountryCode(value: unknown, allowAlpha3 = true): string | null {
  if (typeof value !== 'string') return null;
  const code = normalizeCustomerText(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(code) && ISO_ALPHA2_CODES[code]) return code;
  if (allowAlpha3 && /^[A-Z]{3}$/.test(code)) return alpha3ToAlpha2(code) ?? null;
  return null;
}

export function isIsoCountryCode(value: unknown, allowAlpha3 = true): boolean {
  return normalizeIsoCountryCode(value, allowAlpha3) !== null;
}

export function countryCodesMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeIsoCountryCode(left);
  const normalizedRight = normalizeIsoCountryCode(right);
  if (normalizedLeft && normalizedRight) return normalizedLeft === normalizedRight;
  return typeof left === 'string' && typeof right === 'string' &&
    normalizeCustomerText(left).toUpperCase() === normalizeCustomerText(right).toUpperCase();
}

export interface CountryOption {
  code: string;
  name: string;
  callingCode: string | null;
}

const regionNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const ISO_COUNTRY_OPTIONS: CountryOption[] = Object.keys(ISO_ALPHA2_CODES)
  .map((code) => {
    const countryCode = code as CountryCode;
    return {
      code,
      name: regionNames?.of(code) ?? code,
      callingCode: isSupportedCountry(code) ? `+${getCountryCallingCode(countryCode)}` : null,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));

export function getCountryName(value: unknown): string | null {
  const alpha2 = normalizeIsoCountryCode(value);
  if (!alpha2) return null;
  return regionNames?.of(alpha2) ?? alpha2;
}

export function normalizeDocumentDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeCustomerText(value);
  return isValidDocumentDate(normalized) ? normalized.slice(0, 10) : null;
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_ONLY.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

export function getCustomerCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isNonFutureCalendarDate(value: unknown, today = getCustomerCalendarDate()): boolean {
  return isValidCalendarDate(value) && isValidCalendarDate(today) && value <= today;
}

export function isValidDateOfBirth(value: unknown, today = getCustomerCalendarDate()): boolean {
  return isNonFutureCalendarDate(value, today);
}

export function isValidDocumentDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (ISO_DATE_ONLY.test(value)) return isValidCalendarDate(value);
  if (!ISO_DATE_TIME.test(value)) return false;
  const datePart = value.slice(0, 10);
  return isValidCalendarDate(datePart) && Number.isFinite(Date.parse(value));
}

export function isFutureDocumentIssueDate(value: string, today = getCustomerCalendarDate()): boolean {
  const datePart = value.slice(0, 10);
  return isValidCalendarDate(datePart) && datePart > today;
}

export function normalizePhoneNumber(value: unknown, country = 'NG'): PhoneNumberResult {
  if (typeof value !== 'string') return { valid: false, message: 'Enter a valid phone number.' };
  const input = normalizeCustomerText(value);
  const defaultCountry = normalizeIsoCountryCode(country, false);
  if (!input || input.length > 40 || !PHONE_INPUT_CHARACTERS.test(input)) {
    return { valid: false, message: 'Enter a valid phone number.' };
  }
  if (!defaultCountry || !isSupportedCountry(defaultCountry)) {
    return { valid: false, message: 'Choose a supported phone country.' };
  }

  try {
    const parsed = parsePhoneNumberFromString(input, defaultCountry);
    if (!parsed || !parsed.isValid() || !parsed.country || parsed.ext) {
      return { valid: false, message: 'Enter a valid phone number for the selected country.' };
    }
    return {
      valid: true,
      e164: parsed.number,
      country: parsed.country,
      nationalNumber: parsed.nationalNumber,
      type: parsed.getType(),
    };
  } catch {
    return { valid: false, message: 'Enter a valid phone number for the selected country.' };
  }
}

export function getPhoneCountry(value: string, fallback = 'NG'): string {
  const parsed = normalizePhoneNumber(value, fallback);
  return parsed.valid && parsed.country ? parsed.country : normalizeIsoCountryCode(fallback, false) ?? 'NG';
}

export function isValidNigerianOtpPhone(value: unknown): boolean {
  const parsed = normalizePhoneNumber(value, 'NG');
  return parsed.valid && parsed.country === 'NG';
}

export function validatePostalCode(value: unknown, country: unknown): PostalCodeResult {
  if (value === null || value === undefined || value === '') return { valid: true, supported: true };
  if (typeof value !== 'string') return { valid: false, supported: true };
  const postalCode = normalizeCustomerText(value);
  if (!postalCode) return { valid: true, supported: true };
  if (countUnicodeCodePoints(postalCode) > 20 || CONTROL_OR_BIDI_CHARACTERS.test(postalCode)) {
    return { valid: false, supported: true };
  }

  const alpha2 = normalizeIsoCountryCode(country);
  if (!alpha2) return { valid: false, supported: true };
  if (!postcodeValidatorExistsForCountry(alpha2)) {
    return { valid: SAFE_POSTAL_FALLBACK.test(postalCode), supported: false };
  }
  try {
    return { valid: postcodeValidator(postalCode, alpha2), supported: true };
  } catch {
    return { valid: SAFE_POSTAL_FALLBACK.test(postalCode), supported: false };
  }
}

export function validateProfileFields(
  input: {
    customerType: CustomerType | string;
    displayName?: string | null;
    legalName?: string | null;
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
    dateOfBirth?: string | null;
    nationality?: string | null;
  },
  options: { requireDisplayName?: boolean; requireBusinessLegalName?: boolean } = {},
): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};
  const requireDisplayName = options.requireDisplayName ?? false;
  const requireBusinessLegalName = options.requireBusinessLegalName ?? false;
  const customerType = String(input.customerType);

  if (input.displayName && !isValidCustomerName(input.displayName, 200)) {
    errors.displayName = 'Use a name with up to 200 Unicode characters; omit control characters.';
  } else if (requireDisplayName && !normalizeCustomerText(input.displayName ?? '')) {
    errors.displayName = 'Display name is required.';
  }
  if (input.legalName && !isValidCustomerName(input.legalName, 200)) {
    errors.legalName = 'Use a legal name with up to 200 Unicode characters.';
  } else if (
    customerType === 'BUSINESS' &&
    requireBusinessLegalName &&
    !normalizeCustomerText(input.legalName ?? '')
  ) {
    errors.legalName = 'Legal business name is required for a new business profile.';
  }

  const personalValues: Array<[string, string | null | undefined, number]> = [
    ['firstName', input.firstName, 100],
    ['middleName', input.middleName, 100],
    ['lastName', input.lastName, 100],
  ];
  for (const [field, value, max] of personalValues) {
    if (value && !isValidCustomerName(value, max)) {
      errors[field] = `Use a valid Unicode name with up to ${max} characters.`;
    }
  }

  const hasIndividualData = personalValues.some(([, value]) => Boolean(normalizeCustomerText(value ?? ''))) ||
    Boolean(input.dateOfBirth) || Boolean(input.nationality);
  if (customerType === 'BUSINESS' && hasIndividualData) {
    errors.dateOfBirth = 'Individual-only personal fields cannot be entered on a business profile.';
    if (personalValues.some(([, value]) => Boolean(normalizeCustomerText(value ?? '')))) {
      errors.firstName ??= errors.dateOfBirth;
      errors.middleName ??= errors.dateOfBirth;
      errors.lastName ??= errors.dateOfBirth;
    }
    if (input.nationality) errors.nationality = errors.dateOfBirth;
  } else if (input.dateOfBirth && !isValidDateOfBirth(input.dateOfBirth)) {
    errors.dateOfBirth = 'Enter a real calendar date with a four-digit year that is not in the future.';
  }

  if (input.nationality && !isIsoCountryCode(input.nationality)) {
    errors.nationality = 'Choose a valid ISO 3166-1 country code.';
  }
  return errors;
}

export function validateAddressFields(input: {
  type?: string;
  lineOne?: string | null;
  lineTwo?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
}): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};
  const validAddressTypes: readonly string[] = Object.values(AddressType);
  if (input.type && !validAddressTypes.includes(input.type)) {
    errors.type = 'Choose a valid address type.';
  }
  for (const [field, value, max] of [
    ['lineOne', input.lineOne, 200],
    ['lineTwo', input.lineTwo, 200],
    ['city', input.city, 100],
    ['state', input.state, 100],
  ] as Array<[string, string | null | undefined, number]>) {
    if (value && !isValidFreeText(value, max)) {
      errors[field] = `Use valid text with up to ${max} Unicode characters.`;
    }
  }
  if (!normalizeCustomerText(input.lineOne ?? '')) errors.lineOne = 'Address line 1 is required.';
  if (!normalizeCustomerText(input.city ?? '')) errors.city = 'City is required.';
  if (!normalizeCustomerText(input.state ?? '')) errors.state = 'State or province is required.';
  if (!isIsoCountryCode(input.country)) errors.country = 'Choose a valid ISO 3166-1 country code.';
  if (input.postalCode && !validatePostalCode(input.postalCode, input.country).valid) {
    errors.postalCode = 'Enter a postal code in the selected country’s format.';
  }
  return errors;
}

export function validateContactFields(
  type: ContactMethodType | string,
  value: unknown,
  phoneCountry = 'NG',
): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};
  const contactType = String(type);
  const validContactTypes: readonly string[] = Object.values(ContactMethodType);
  if (!validContactTypes.includes(contactType)) {
    errors.type = 'Choose a valid contact method.';
    return errors;
  }
  if (contactType === 'EMAIL') {
    if (!isValidEmailAddress(value)) errors.value = 'Enter a valid email address of at most 254 UTF-8 bytes.';
  } else if (!normalizePhoneNumber(value, phoneCountry).valid) {
    errors.value = normalizePhoneNumber(value, phoneCountry).message ?? 'Enter a valid phone number.';
  }
  return errors;
}

export function validateIdentityDocumentFields(input: {
  type?: string;
  documentNumber?: string | null;
  issuingCountry?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
}, options: { requireDocumentNumber?: boolean; requireIssuingCountry?: boolean } = {}): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};
  const type = input.type;
  const validTypes: readonly string[] = Object.values(IdentityDocumentType);
  if (!type || !validTypes.includes(type)) {
    errors.type = 'Choose a valid identity document type.';
    return errors;
  }

  const documentNumber = input.documentNumber === null || input.documentNumber === undefined
    ? ''
    : normalizeCustomerText(input.documentNumber);
  if (!documentNumber && options.requireDocumentNumber) {
    errors.documentNumber = 'Document number is required.';
  } else if (documentNumber) {
    if (type === 'BVN' || type === 'NIN') {
      if (!/^\d{11}$/.test(documentNumber)) {
        errors.documentNumber = `${type} must contain exactly 11 digits.`;
      }
    } else if (!isValidFreeText(documentNumber, 160)) {
      errors.documentNumber = 'Use a document number with up to 160 Unicode characters.';
    }
  }

  const alpha2 = normalizeIsoCountryCode(input.issuingCountry);
  if (!alpha2) {
    if (input.issuingCountry || options.requireIssuingCountry !== false) {
      errors.issuingCountry = 'Choose a valid ISO 3166-1 country code.';
    }
  } else if (
    (type === 'BVN' || type === 'NIN') &&
    alpha2 !== 'NG'
  ) {
    errors.issuingCountry = `${type} must have Nigeria as the issuing country.`;
  }

  const issuedAt = input.issuedAt ? normalizeCustomerText(input.issuedAt) : '';
  const expiresAt = input.expiresAt ? normalizeCustomerText(input.expiresAt) : '';
  const nigeriaIdentifier = type === 'BVN' || type === 'NIN';
  if (nigeriaIdentifier && (issuedAt || expiresAt)) {
    errors.issuedAt = `${type} records do not accept issue or expiry dates.`;
    errors.expiresAt = errors.issuedAt;
  } else {
    if (issuedAt && !isValidDocumentDate(issuedAt)) {
      errors.issuedAt = 'Enter a valid calendar issue date.';
    } else if (issuedAt && isFutureDocumentIssueDate(issuedAt)) {
      errors.issuedAt = 'Issue date cannot be in the future.';
    }
    if (expiresAt && !isValidDocumentDate(expiresAt)) {
      errors.expiresAt = 'Enter a valid calendar expiry date.';
    }
    if (
      issuedAt &&
      expiresAt &&
      isValidDocumentDate(issuedAt) &&
      isValidDocumentDate(expiresAt) &&
      expiresAt.slice(0, 10) < issuedAt.slice(0, 10)
    ) {
      errors.expiresAt = 'Expiry date must be on or after issue date.';
    }
  }
  return errors;
}

export function getIdentityDocumentTypes(customerType: CustomerType | string): IdentityDocumentType[] {
  const isBusiness = String(customerType) === 'BUSINESS';
  return Object.values(IdentityDocumentType).filter((type) =>
    isBusiness
      ? type === IdentityDocumentType.BUSINESS_REGISTRATION
      : type !== IdentityDocumentType.BUSINESS_REGISTRATION,
  );
}

export function addressSignature(input: {
  type?: string;
  lineOne?: string | null;
  lineTwo?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
}): string {
  const normalizePart = (value: string | null | undefined) =>
    normalizeCustomerText(value ?? '').replace(/\s+/gu, ' ').toLowerCase();
  const country = normalizeIsoCountryCode(input.country) ?? normalizePart(input.country);
  return [
    normalizePart(input.type),
    normalizePart(input.lineOne),
    normalizePart(input.lineTwo),
    normalizePart(input.city),
    normalizePart(input.state),
    country,
    normalizePart(input.postalCode),
  ].join('\u001f');
}
