import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RequestRegistrationOtpDto } from '../src/customer-registration/dto/request-registration-otp.dto';
import { CreateProfileDto } from '../src/customer/dto/create-profile.dto';
import {
  addressSignature,
  getIdentityDocumentTypes,
  isValidCalendarDate,
  isValidCustomerName,
  isValidDateOfBirth,
  isValidEmailAddress,
  isValidNigerianOtpPhone,
  normalizeCustomerText,
  normalizeEmailAddress,
  normalizeIsoCountryCode,
  normalizePhoneNumber,
  validateAddressFields,
  validateIdentityDocumentFields,
  validatePostalCode,
  validateProfileFields,
} from '../src/customer/customer-validation';

describe('shared customer-field policy', () => {
  describe('names and normalized text', () => {
    it('normalizes Unicode to NFC, trims whitespace, and counts Unicode code points', () => {
      expect(normalizeCustomerText('  e\u0301   ')).toBe('é');
      expect(isValidCustomerName('  José O’Connor  ', 20)).toBe(true);
      expect(isValidCustomerName('A'.repeat(101), 100)).toBe(false);
      expect(isValidCustomerName('Name\u202E', 100)).toBe(false);
    });

    it('allows optional ages without adding an arbitrary minimum age to date validation', () => {
      expect(isValidDateOfBirth('0001-01-01', '2026-10-24')).toBe(true);
    });
  });

  describe('email and country-aware phone values', () => {
    it('normalizes valid internationalized email addresses and enforces syntax/byte limits', () => {
      expect(normalizeEmailAddress('  Test.User+one@Example.COM  ')).toBe('test.user+one@example.com');
      expect(isValidEmailAddress('test.user+one@example.com')).toBe(true);
      expect(isValidEmailAddress('élise@example.com')).toBe(true);
      expect(isValidEmailAddress('missing-at.example.com')).toBe(false);
      expect(isValidEmailAddress('x@localhost')).toBe(false);
      expect(isValidEmailAddress(`${'a'.repeat(65)}@example.com`)).toBe(false);
      expect(isValidEmailAddress(`${'é'.repeat(33)}@example.com`)).toBe(false);
    });

    it('normalizes local/international numbers with their selected region and restricts the current OTP flow to Nigeria', () => {
      expect(normalizePhoneNumber('08012345678', 'NG')).toMatchObject({
        valid: true,
        e164: '+2348012345678',
        country: 'NG',
      });
      expect(normalizePhoneNumber('+442079460018', 'NG')).toMatchObject({
        valid: true,
        country: 'GB',
      });
      expect(normalizePhoneNumber('08012345678', 'GB').valid).toBe(false);
      expect(isValidNigerianOtpPhone('+2348012345678')).toBe(true);
      expect(isValidNigerianOtpPhone('+442079460018')).toBe(false);
    });

    it('maps ISO alpha-3 input to alpha-2 and rejects non-ISO country tokens', () => {
      expect(normalizeIsoCountryCode('nga')).toBe('NG');
      expect(normalizeIsoCountryCode('NG', false)).toBe('NG');
      expect(normalizeIsoCountryCode('ZZ')).toBeNull();
    });
  });

  describe('calendar and identity-document policy', () => {
    it('requires real four-digit calendar dates and prevents future DOBs without imposing an age floor', () => {
      expect(isValidCalendarDate('2000-02-29')).toBe(true);
      expect(isValidCalendarDate('1900-02-29')).toBe(false);
      expect(isValidCalendarDate('2024-13-01')).toBe(false);
      expect(isValidCalendarDate('24-01-01')).toBe(false);
      expect(isValidDateOfBirth('2026-10-25', '2026-10-24')).toBe(false);
      expect(isValidDateOfBirth('2026-10-24', '2026-10-24')).toBe(true);
      expect(isValidDateOfBirth('0001-01-01', '2026-10-24')).toBe(true);
    });

    it('enforces exact Nigerian BVN/NIN shape and excludes their issue/expiry dates', () => {
      expect(validateIdentityDocumentFields({
        type: 'NIN',
        documentNumber: '12345678901',
        issuingCountry: 'NG',
      }, { requireDocumentNumber: true })).toEqual({});
      expect(validateIdentityDocumentFields({
        type: 'BVN',
        documentNumber: '1234567890',
        issuingCountry: 'NG',
      }, { requireDocumentNumber: true }).documentNumber).toMatch(/exactly 11 digits/);
      expect(validateIdentityDocumentFields({
        type: 'NIN',
        documentNumber: '12345678901',
        issuingCountry: 'GB',
      }).issuingCountry).toMatch(/Nigeria/);
      const datedNin = validateIdentityDocumentFields({
        type: 'NIN',
        documentNumber: '12345678901',
        issuingCountry: 'NG',
        issuedAt: '2020-01-01',
      });
      expect(datedNin.issuedAt).toMatch(/do not accept/);
      expect(datedNin.expiresAt).toMatch(/do not accept/);
    });

    it('validates non-national-document dates and customer-specific document categories without claiming official verification', () => {
      expect(validateIdentityDocumentFields({
        type: 'INTERNATIONAL_PASSPORT',
        documentNumber: 'P1234567',
        issuingCountry: 'NG',
        issuedAt: '2020-02-29',
        expiresAt: '2030-02-28',
      })).toEqual({});
      expect(validateIdentityDocumentFields({
        type: 'INTERNATIONAL_PASSPORT',
        documentNumber: 'P1234567',
        issuingCountry: 'NG',
        issuedAt: '2030-02-28',
      }).issuedAt).toMatch(/future/);
      expect(validateIdentityDocumentFields({
        type: 'DRIVERS_LICENSE',
        documentNumber: 'DL-0001',
        issuingCountry: 'NG',
        issuedAt: '2020-04-31',
      }).issuedAt).toMatch(/calendar/);
      expect(validateIdentityDocumentFields({
        type: 'INTERNATIONAL_PASSPORT',
        documentNumber: 'P1234567',
        issuingCountry: 'NG',
        issuedAt: '2020-01-01',
        expiresAt: '2019-12-31',
      }).expiresAt).toMatch(/on or after/);
      expect(getIdentityDocumentTypes('BUSINESS')).toEqual(['BUSINESS_REGISTRATION']);
      expect(getIdentityDocumentTypes('INDIVIDUAL')).not.toContain('BUSINESS_REGISTRATION');
    });
  });

  describe('country-specific address policy and duplicate detection', () => {
    it('validates country postal codes and required address fields', () => {
      expect(validatePostalCode('90210', 'US').valid).toBe(true);
      expect(validatePostalCode('not a postal code?', 'US').valid).toBe(false);
      expect(validateAddressFields({
        type: 'RESIDENTIAL',
        lineOne: '  1 Example Road ',
        city: 'Abuja',
        state: 'FCT',
        country: 'NG',
        postalCode: '900001',
      })).toEqual({});
      expect(validateAddressFields({ lineOne: '', city: '', state: '', country: 'ZZ' })).toMatchObject({
        lineOne: 'Address line 1 is required.',
        city: 'City is required.',
        state: 'State or province is required.',
        country: 'Choose a valid ISO 3166-1 country code.',
      });
    });

    it('computes stable, country-code-normalized duplicate signatures', () => {
      expect(addressSignature({
        type: 'RESIDENTIAL',
        lineOne: '  1 Example ROAD ',
        lineTwo: '',
        city: 'Abuja',
        state: 'FCT',
        country: 'NGA',
        postalCode: '900001',
      })).toBe(addressSignature({
        type: 'RESIDENTIAL',
        lineOne: '1 example road',
        city: 'ABUJA',
        state: 'fct',
        country: 'NG',
        postalCode: '900001',
      }));
    });
  });

  it('applies the shared policy at DTO boundaries, including Nigerian-only OTP requests', async () => {
    const validOtp = plainToInstance(RequestRegistrationOtpDto, { phone: '08012345678' });
    const foreignOtp = plainToInstance(RequestRegistrationOtpDto, { phone: '+442079460018' });
    expect(await validate(validOtp)).toHaveLength(0);
    expect((await validate(foreignOtp)).map((error) => error.property)).toContain('phone');

    const invalidDob = plainToInstance(CreateProfileDto, {
      displayName: 'Example Customer',
      dateOfBirth: '1900-02-29',
    });
    expect((await validate(invalidDob)).map((error) => error.property)).toContain('dateOfBirth');
  });

  it('rejects individual-only profile fields on a business customer', () => {
    expect(validateProfileFields({
      customerType: 'BUSINESS',
      displayName: 'Example Limited',
      legalName: 'Example Limited',
      firstName: 'Jane',
    }).firstName).toMatch(/business profile/);
  });
});
