import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import {
  isIsoCountryCode,
  isValidCalendarDate,
  isValidCustomerName,
  isValidDateOfBirth,
  isValidDocumentDate,
  isValidEmailAddress,
  isValidNigerianOtpPhone,
  isValidFreeText,
  normalizePhoneNumber,
  validateAddressFields,
  validateContactFields,
  validateIdentityDocumentFields,
  validatePostalCode,
} from './customer-validation';

interface CustomerValidationObject {
  type?: string;
  phoneCountry?: string;
  country?: string;
  documentNumber?: string | null;
  issuingCountry?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  [key: string]: unknown;
}

@ValidatorConstraint({ name: 'customerFieldPolicy', async: false })
export class CustomerFieldPolicyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [kind, limit] = args.constraints as [string, number?];
    const object = args.object as CustomerValidationObject;
    const max = typeof limit === 'number' ? limit : 0;

    switch (kind) {
      case 'name':
        return isValidCustomerName(value, max);
      case 'freeText':
        return isValidFreeText(value, max);
      case 'isoCountry':
        return isIsoCountryCode(value);
      case 'isoAlpha2':
        return isIsoCountryCode(value, false);
      case 'dateOfBirth':
        return isValidDateOfBirth(value);
      case 'calendarDate':
        return isValidCalendarDate(value);
      case 'documentDate':
        return isValidDocumentDate(value);
      case 'postalCode':
        return validatePostalCode(value, object.country).valid;
      case 'contactValue':
        return !validateContactFields(object.type ?? '', value, object.phoneCountry ?? 'NG').value;
      case 'identityDocumentNumber':
        return !validateIdentityDocumentFields(object, { requireDocumentNumber: true }).documentNumber;
      case 'identityDocumentCountry':
        return !validateIdentityDocumentFields(object).issuingCountry;
      case 'identityDocumentDate': {
        const field = args.property;
        return !validateIdentityDocumentFields(object)[field];
      }
      case 'email':
        return isValidEmailAddress(value);
      case 'phone':
        return normalizePhoneNumber(value, object.phoneCountry ?? 'NG').valid;
      case 'nigerianPhone':
        return isValidNigerianOtpPhone(value);
      case 'addressField':
        return !validateAddressFields(object)[args.property];
      default:
        return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const [kind, limit] = args.constraints as [string, number?];
    const max = typeof limit === 'number' ? limit : 0;
    const object = args.object as CustomerValidationObject;

    switch (kind) {
      case 'name':
        return `${args.property} must be a valid Unicode name with at most ${max} characters.`;
      case 'freeText':
        return `${args.property} must be valid text with at most ${max} Unicode characters.`;
      case 'isoCountry':
        return `${args.property} must be a valid ISO 3166-1 alpha-2 or alpha-3 country code.`;
      case 'isoAlpha2':
        return `${args.property} must be a valid ISO 3166-1 alpha-2 country code.`;
      case 'dateOfBirth':
        return 'dateOfBirth must be a calendar-valid YYYY-MM-DD date with a four-digit year that is not in the future.';
      case 'calendarDate':
        return `${args.property} must be a calendar-valid date with a four-digit year.`;
      case 'documentDate':
        return `${args.property} must be a valid ISO calendar date.`;
      case 'postalCode':
        return 'postalCode must match the selected country’s postal-code format.';
      case 'contactValue':
        return object.type === 'EMAIL'
          ? 'value must be a valid email address of at most 254 UTF-8 bytes.'
          : 'value must be a valid phone number for the selected country.';
      case 'identityDocumentNumber': {
        const type = object.type;
        return type === 'BVN' || type === 'NIN'
          ? `${type} must contain exactly 11 digits.`
          : 'documentNumber must contain valid text of at most 160 Unicode characters.';
      }
      case 'identityDocumentCountry':
        return 'issuingCountry must be an ISO country code; BVN and NIN must use NG.';
      case 'identityDocumentDate':
        return `${args.property} must be a valid document date; issue dates cannot be future dates and expiry must not precede issue.`;
      case 'email':
        return `${args.property} must be a valid email address of at most 254 UTF-8 bytes.`;
      case 'phone':
        return normalizePhoneNumber(args.value, object.phoneCountry ?? 'NG').message ??
          `${args.property} must be a valid phone number.`;
      case 'nigerianPhone':
        return `${args.property} must be a valid Nigerian phone number.`;
      case 'addressField':
        return validateAddressFields(object)[args.property] ?? `${args.property} is invalid.`;
      default:
        return `${args.property} is invalid.`;
    }
  }
}
