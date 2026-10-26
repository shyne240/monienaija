import React, { type FormEvent, useMemo, useRef, useState } from 'react';

import {
  getCustomerCalendarDate,
  getIdentityDocumentTypes,
  normalizeCustomerText,
  normalizeEmailAddress,
  normalizeIsoCountryCode,
  normalizePhoneNumber,
  validateAddressFields,
  validateContactFields,
  validateIdentityDocumentFields,
  validateProfileFields,
} from '../../../../../src/customer/customer-validation';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { maskContactValue } from './customer-masking';
import { countryNameForCode, isNigeriaIdentityType } from './CountrySelect';
import {
  CustomerCountrySelect,
  CustomerFieldError,
  CustomerPhoneField,
} from './CustomerFormFields';

type CustomerType = 'INDIVIDUAL' | 'BUSINESS';
type ContactType = 'PHONE' | 'EMAIL';
type AddressType = 'RESIDENTIAL' | 'BUSINESS' | 'MAILING';
type IdentityType =
  | 'BVN'
  | 'NIN'
  | 'INTERNATIONAL_PASSPORT'
  | 'DRIVERS_LICENSE'
  | 'VOTERS_CARD'
  | 'BUSINESS_REGISTRATION';

interface CreatedCustomer {
  id: string;
  reference: string;
  type: CustomerType;
  status: 'DRAFT';
  kycLevel: string;
  kycStatus: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ContactRecord {
  id: string;
  type: ContactType;
  value?: string;
  maskedValue?: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

interface AddressRecord {
  id: string;
  type: AddressType;
  isPrimary: boolean;
}

interface IdentityRecord {
  id: string;
  type: IdentityType;
  maskedDocumentNumber: string;
  issuingCountry: string;
  issuedAt: string | null;
  expiresAt: string | null;
}

interface IdentityDraft {
  localId: string;
  type: IdentityType;
  documentNumber: string;
  issuingCountry: string;
  issuedAt: string;
  expiresAt: string;
  saved: IdentityRecord | null;
  errors: Record<string, string>;
  outcome: { kind: 'success' | 'error'; message: string } | null;
}

interface CustomerRegistrationWizardProps {
  onClose: () => void;
  onCustomerCreated: (customer: CreatedCustomer) => void;
  onOpenCustomer: (customerId: string) => void;
}

const STEPS = [
  'Customer details',
  'Contact & verification',
  'Residential address',
  'Identity documents',
];

function supportsIdentityDates(type: IdentityType): boolean {
  return type !== 'NIN' && type !== 'BVN';
}

function identityDocumentNumberKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

function requestStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function safeSaveError(error: unknown): string {
  const status = requestStatus(error);
  if (status === 401) return 'Your session has expired. Sign in again before continuing.';
  if (status === 403) return 'Your current workforce permissions do not allow this save.';
  if (status === 409)
    return 'A conflicting record already exists. Review the saved customer details before retrying.';
  if (status === 400) return 'Some details are invalid. Check the required fields and try again.';
  return 'The information could not be saved. Your draft data is still on this screen; retry safely.';
}

function canonicalUiPhone(value: string, country = 'NG'): string {
  const parsed = normalizePhoneNumber(value, country);
  return parsed.valid ? (parsed.e164 ?? '') : '';
}

function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object' || !('validationErrors' in error)) return {};
  const source = (error as { validationErrors?: unknown }).validationErrors;
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).flatMap(([field, value]) => {
      const message = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value;
      return typeof message === 'string' ? [[field, message]] : [];
    }),
  );
}

export const CustomerRegistrationWizard: React.FC<CustomerRegistrationWizardProps> = ({
  onClose,
  onCustomerCreated,
  onOpenCustomer,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canManageIdentity =
    scopes.includes('customer.view_identity_documents') && scopes.includes('kyc.review');

  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<CreatedCustomer | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [customerType, setCustomerType] = useState<CustomerType>('INDIVIDUAL');
  const [businessName, setBusinessName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('NG');

  const [phone, setPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('NG');
  const [phoneContact, setPhoneContact] = useState<ContactRecord | null>(null);
  const [persistedPhone, setPersistedPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emailContact, setEmailContact] = useState<ContactRecord | null>(null);
  const [persistedEmail, setPersistedEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');

  const [addressType, setAddressType] = useState<AddressType>('RESIDENTIAL');
  const [lineOne, setLineOne] = useState('');
  const [lineTwo, setLineTwo] = useState('');
  const [city, setCity] = useState('');
  const [stateOrProvince, setStateOrProvince] = useState('');
  const [country, setCountry] = useState('NG');
  const [postalCode, setPostalCode] = useState('');
  const [address, setAddress] = useState<AddressRecord | null>(null);

  const [identityDocuments, setIdentityDocuments] = useState<IdentityDraft[]>([
    {
      localId: 'identity-0',
      type: 'NIN',
      documentNumber: '',
      issuingCountry: 'NG',
      issuedAt: '',
      expiresAt: '',
      saved: null,
      errors: {},
      outcome: null,
    },
  ]);
  const nextIdentityDraftId = useRef(1);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef(false);

  const progress = useMemo(
    () => (step >= STEPS.length ? 'Complete' : `${step + 1} of ${STEPS.length}`),
    [step],
  );
  const derivedDisplayName = [firstName, middleName, lastName]
    .map((value) => normalizeCustomerText(value))
    .filter(Boolean)
    .join(' ');
  const displayName =
    customerType === 'BUSINESS' ? normalizeCustomerText(businessName) : derivedDisplayName;
  const currentPhone = normalizePhoneNumber(phone, phoneCountry);
  const currentPhoneIsNigerian = currentPhone.valid && currentPhone.country === 'NG';

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    const errors = validateProfileFields(
      {
        customerType,
        displayName,
        legalName: displayName,
        firstName: customerType === 'INDIVIDUAL' ? firstName : undefined,
        middleName: customerType === 'INDIVIDUAL' ? middleName : undefined,
        lastName: customerType === 'INDIVIDUAL' ? lastName : undefined,
        dateOfBirth: customerType === 'INDIVIDUAL' ? dateOfBirth : undefined,
        nationality: customerType === 'INDIVIDUAL' ? nationality : undefined,
      },
      { requireDisplayName: true, requireBusinessLegalName: customerType === 'BUSINESS' },
    );
    if (customerType === 'INDIVIDUAL') {
      if (!normalizeCustomerText(firstName)) errors.firstName = 'First name is required.';
      if (!normalizeCustomerText(lastName)) errors.lastName = 'Last name is required.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Correct the highlighted profile fields before continuing.');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      let savedCustomer = customer;
      if (!savedCustomer) {
        savedCustomer = await ApiClient.post<CreatedCustomer>('/customers', { type: customerType });
        setCustomer(savedCustomer);
        onCustomerCreated(savedCustomer);
      }

      const profile =
        customerType === 'BUSINESS'
          ? { displayName, legalName: displayName }
          : {
              displayName,
              legalName: displayName,
              firstName: normalizeCustomerText(firstName),
              middleName: normalizeCustomerText(middleName) || undefined,
              lastName: normalizeCustomerText(lastName),
              dateOfBirth: dateOfBirth || undefined,
              nationality: normalizeIsoCountryCode(nationality) ?? undefined,
            };
      const registrationProfile =
        customerType === 'BUSINESS'
          ? { businessName: normalizeCustomerText(businessName) }
          : {
              firstName: normalizeCustomerText(firstName),
              middleName: normalizeCustomerText(middleName) || undefined,
              lastName: normalizeCustomerText(lastName),
              dateOfBirth: dateOfBirth || undefined,
              nationality: normalizeIsoCountryCode(nationality) ?? undefined,
            };

      if (profileSaved) {
        await ApiClient.patch(
          `/customers/${encodeURIComponent(savedCustomer.id)}/profile`,
          profile,
        );
      } else {
        try {
          await ApiClient.post(
            `/customers/${encodeURIComponent(savedCustomer.id)}/registration-profile`,
            registrationProfile,
          );
        } catch (createError) {
          // Recover a retry after a committed create whose response was lost.
          if (requestStatus(createError) !== 409) throw createError;
          await ApiClient.patch(
            `/customers/${encodeURIComponent(savedCustomer.id)}/profile`,
            profile,
          );
        }
      }
      setProfileSaved(true);
      setFieldErrors({});
      onCustomerCreated(savedCustomer);
      setNotice('Customer profile saved. The record remains DRAFT.');
      setStep(1);
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError));
      setError(safeSaveError(saveError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const recoverContacts = async (customerId: string): Promise<ContactRecord[]> => {
    try {
      const records = await ApiClient.get<ContactRecord[]>(
        `/customers/${encodeURIComponent(customerId)}/contact-methods`,
      );
      return records.map((contact) => {
        const rawValue = contact.value ?? '';
        const maskedValue = contact.maskedValue ?? maskContactValue(rawValue);
        return { ...contact, maskedValue, value: rawValue || undefined };
      });
    } catch {
      return [];
    }
  };

  const saveContact = async (
    customerId: string,
    type: ContactType,
    value: string,
    isPrimary: boolean,
    previous: ContactRecord | null,
    countryCode = 'NG',
  ): Promise<ContactRecord> => {
    const normalizedValue =
      type === 'PHONE'
        ? (normalizePhoneNumber(value, countryCode).e164 ?? value.trim())
        : normalizeEmailAddress(value);
    const body = {
      value: normalizedValue,
      isPrimary,
      ...(type === 'PHONE' ? { phoneCountry: countryCode } : {}),
    };
    if (previous) {
      return ApiClient.patch<ContactRecord>(
        `/customers/${encodeURIComponent(customerId)}/contact-methods/${encodeURIComponent(previous.id)}`,
        body,
      );
    }
    try {
      return await ApiClient.post<ContactRecord>(
        `/customers/${encodeURIComponent(customerId)}/contact-method`,
        { type, ...body },
      );
    } catch (saveError) {
      if (requestStatus(saveError) === 409) {
        const existing = await recoverContacts(customerId);
        const normalized =
          type === 'PHONE' ? canonicalUiPhone(value, countryCode) : normalizeEmailAddress(value);
        const matched = existing.find((contact) => {
          if (contact.type !== type) return false;
          const stored =
            type === 'PHONE'
              ? canonicalUiPhone(contact.value ?? '', countryCode)
              : normalizeEmailAddress(contact.value ?? '');
          return stored === normalized;
        });
        if (matched) return matched;
      }
      throw saveError;
    }
  };

  const saveContacts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer || savingRef.current) return;
    const validationErrors = {
      ...validateContactFields('PHONE', phone, phoneCountry),
      ...(email.trim() ? validateContactFields('EMAIL', email) : {}),
    };
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted contact fields before continuing.');
      return;
    }
    const normalizedPhone = normalizePhoneNumber(phone, phoneCountry);
    if (!normalizedPhone.valid || !normalizedPhone.e164) {
      setError('Enter a valid phone number for the selected country.');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const normalizedEmail = normalizeEmailAddress(email);
      const phoneChanged = persistedPhone !== normalizedPhone.e164;
      const savedPhone =
        phoneContact && !phoneChanged && phoneContact.isPrimary
          ? phoneContact
          : await saveContact(
              customer.id,
              'PHONE',
              normalizedPhone.e164,
              true,
              phoneContact,
              phoneCountry,
            );
      setPhoneContact(savedPhone);
      setPersistedPhone(normalizedPhone.e164);
      if (email.trim()) {
        const savedEmail =
          emailContact && persistedEmail === normalizedEmail
            ? emailContact
            : await saveContact(customer.id, 'EMAIL', normalizedEmail, false, emailContact);
        setEmailContact(savedEmail);
        setPersistedEmail(normalizedEmail);
      }
      if (phoneChanged) {
        setOtpRequested(false);
        setOtpCode('');
        setVerificationToken('');
      }
      setNotice('Contact details saved. Phone verification is separate from customer activation.');
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError));
      setError(safeSaveError(saveError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const requestPhoneOtp = async () => {
    const normalizedPhone = normalizePhoneNumber(phone, phoneCountry);
    if (!customer || !phoneContact || savingRef.current) return;
    if (!normalizedPhone.valid || !normalizedPhone.e164 || normalizedPhone.country !== 'NG') {
      setError(
        'The current OTP flow supports valid Nigerian phone numbers only. Other countries can be saved unverified.',
      );
      setFieldErrors({
        phone: 'Only a valid Nigerian phone number can use the existing OTP flow.',
      });
      return;
    }
    if (persistedPhone !== normalizedPhone.e164) {
      setError('Save the current phone number before requesting an OTP.');
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);
    try {
      await ApiClient.post('/customers/registration/otp', { phone: normalizedPhone.e164 });
      setOtpRequested(true);
      setOtpCode('');
      setVerificationToken('');
      setNotice('OTP request accepted. Enter the code sent to the saved Nigerian phone number.');
    } catch (otpError) {
      setFieldErrors(fieldErrorsFrom(otpError));
      setError(safeSaveError(otpError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const verifyPhone = async () => {
    const normalizedPhone = normalizePhoneNumber(phone, phoneCountry);
    if (!customer || !phoneContact || savingRef.current || !otpRequested) return;
    if (!normalizedPhone.valid || !normalizedPhone.e164 || normalizedPhone.country !== 'NG') {
      setError('The current OTP flow supports valid Nigerian phone numbers only.');
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);
    try {
      let token = verificationToken;
      if (!token) {
        const verified = await ApiClient.post<{ verificationToken: string }>(
          '/customers/registration/otp/verify',
          { phone: normalizedPhone.e164, code: otpCode.trim() },
        );
        token = verified.verificationToken;
        setVerificationToken(token);
      }
      const updated = await ApiClient.patch<ContactRecord>(
        `/customers/${encodeURIComponent(customer.id)}/contact-methods/${encodeURIComponent(phoneContact.id)}`,
        {
          value: normalizedPhone.e164,
          phoneCountry: 'NG',
          isPrimary: true,
          verificationToken: token,
        },
      );
      setPhoneContact(updated);
      setPersistedPhone(normalizedPhone.e164);
      setOtpRequested(false);
      setOtpCode('');
      setVerificationToken('');
      setNotice('Primary phone verified. The customer is still DRAFT and is not activated.');
    } catch (verifyError) {
      setFieldErrors(fieldErrorsFrom(verifyError));
      setError(safeSaveError(verifyError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer || savingRef.current) return;
    const anyAddressField = [lineOne, lineTwo, city, stateOrProvince, postalCode].some((value) =>
      normalizeCustomerText(value),
    );
    if (!anyAddressField) {
      setFieldErrors({});
      setStep(3);
      setNotice(
        'Residential address skipped. You can continue the draft later from Customer 360°.',
      );
      setError(null);
      return;
    }
    const validationErrors = validateAddressFields({
      type: addressType,
      lineOne,
      lineTwo,
      city,
      state: stateOrProvince,
      country,
      postalCode,
    });
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted address fields before continuing.');
      return;
    }
    const alpha2Country = normalizeIsoCountryCode(country);
    if (!alpha2Country) return;

    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        type: addressType,
        lineOne: normalizeCustomerText(lineOne),
        lineTwo: normalizeCustomerText(lineTwo) || undefined,
        city: normalizeCustomerText(city),
        state: normalizeCustomerText(stateOrProvince),
        country: alpha2Country,
        postalCode: normalizeCustomerText(postalCode) || undefined,
        isPrimary: true,
      };
      const saved = address
        ? await ApiClient.patch<AddressRecord>(
            `/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(address.id)}`,
            body,
          )
        : await ApiClient.post<AddressRecord>(
            `/customers/${encodeURIComponent(customer.id)}/address`,
            body,
          );
      setAddress(saved);
      setFieldErrors({});
      setNotice('Address saved.');
      setStep(3);
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError));
      setError(safeSaveError(saveError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const addIdentityDocument = () => {
    const sequence = nextIdentityDraftId.current++;
    const defaultType = customerType === 'BUSINESS' ? 'BUSINESS_REGISTRATION' : 'NIN';
    setIdentityDocuments((current) => [
      ...current,
      {
        localId: `identity-${sequence}`,
        type: defaultType,
        documentNumber: '',
        issuingCountry: 'NG',
        issuedAt: '',
        expiresAt: '',
        saved: null,
        errors: {},
        outcome: null,
      },
    ]);
  };

  const removeUnsavedIdentityDocument = (localId: string) => {
    setIdentityDocuments((current) =>
      current.filter((item) => item.localId !== localId || item.saved),
    );
  };

  const saveIdentityDocument = async (localId: string) => {
    const document = identityDocuments.find((item) => item.localId === localId);
    if (!customer || savingRef.current || !document || document.saved) return;
    const documentNumber = normalizeCustomerText(document.documentNumber);
    const duplicateDraft = identityDocuments.some(
      (item) =>
        item.localId !== localId &&
        !item.saved &&
        item.type === document.type &&
        Boolean(item.documentNumber.trim()) &&
        identityDocumentNumberKey(item.documentNumber) ===
          identityDocumentNumberKey(documentNumber),
    );
    if (duplicateDraft) {
      setIdentityDocuments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                errors: {
                  documentNumber: 'This document type and number is already entered above.',
                },
                outcome: {
                  kind: 'error',
                  message: 'This document type and number is already entered above.',
                },
              }
            : item,
        ),
      );
      return;
    }

    const validationErrors = validateIdentityDocumentFields(
      {
        type: document.type,
        documentNumber,
        issuingCountry: document.issuingCountry,
        issuedAt: supportsIdentityDates(document.type) ? document.issuedAt || undefined : undefined,
        expiresAt: supportsIdentityDates(document.type)
          ? document.expiresAt || undefined
          : undefined,
      },
      { requireDocumentNumber: true, requireIssuingCountry: true },
    );
    const allowedIdentityTypes = getIdentityDocumentTypes(customerType) as IdentityType[];
    if (!allowedIdentityTypes.includes(document.type)) {
      validationErrors.type = 'Choose a document type supported for this customer type.';
    }
    if (Object.keys(validationErrors).length > 0) {
      setIdentityDocuments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                errors: validationErrors,
                outcome: { kind: 'error', message: Object.values(validationErrors).join(' ') },
              }
            : item,
        ),
      );
      return;
    }

    const issuingCountry = isNigeriaIdentityType(document.type)
      ? 'NG'
      : normalizeIsoCountryCode(document.issuingCountry);
    if (!issuingCountry) {
      setIdentityDocuments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                errors: { issuingCountry: 'Choose a valid ISO 3166-1 issuing country.' },
                outcome: { kind: 'error', message: 'Choose a valid ISO 3166-1 issuing country.' },
              }
            : item,
        ),
      );
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    setIdentityDocuments((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, errors: {}, outcome: null } : item,
      ),
    );
    try {
      const saved = await ApiClient.post<IdentityRecord>(
        `/customers/${encodeURIComponent(customer.id)}/identity-document`,
        {
          type: document.type,
          documentNumber,
          issuingCountry,
          ...(supportsIdentityDates(document.type)
            ? {
                issuedAt: document.issuedAt || undefined,
                expiresAt: document.expiresAt || undefined,
              }
            : {}),
        },
      );
      setIdentityDocuments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                documentNumber: '',
                saved,
                errors: {},
                outcome: { kind: 'success', message: `Saved · ${saved.maskedDocumentNumber}` },
              }
            : item,
        ),
      );
      setNotice('Identity document saved independently. Its number is masked in the result.');
      setFieldErrors({});
    } catch (saveError) {
      const serverErrors = fieldErrorsFrom(saveError);
      setIdentityDocuments((current) =>
        current.map((item) =>
          item.localId === localId
            ? {
                ...item,
                errors: serverErrors,
                outcome: {
                  kind: 'error',
                  message: Object.values(serverErrors).join(' ') || safeSaveError(saveError),
                },
              }
            : item,
        ),
      );
      setError(safeSaveError(saveError));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const skipRemainingIdentityDocuments = () => {
    const unsavedCount = identityDocuments.filter(
      (item) => !item.saved && item.documentNumber.trim(),
    ).length;
    setError(null);
    setFieldErrors({});
    setNotice(
      unsavedCount
        ? `${unsavedCount} unsaved document entr${unsavedCount === 1 ? 'y was' : 'ies were'} not sent. You can return to review them.`
        : identityDocuments.some((item) => item.saved)
          ? 'No additional identity documents were added.'
          : 'Identity documents skipped. You can add them later from Customer 360° if authorized.',
    );
    setStep(4);
  };

  const advanceWithoutAddress = () => {
    setError(null);
    setNotice('Address skipped. You can continue the draft later from Customer 360°.');
    setStep(3);
  };

  const finishLater = () => {
    onClose();
  };

  const stepForm = () => {
    if (step === 0) {
      return (
        <form
          className="cm-wizard-form"
          noValidate
          onSubmit={(event) => {
            void saveProfile(event);
          }}
        >
          <div className="cm-wizard-field-grid">
            <label htmlFor="registration-customer-type">
              Customer type <span className="cm-required-indicator">Required</span>
              <select
                id="registration-customer-type"
                value={customerType}
                onChange={(event) => {
                  const nextType = event.target.value as CustomerType;
                  setCustomerType(nextType);
                  const defaultIdentityType =
                    nextType === 'BUSINESS' ? 'BUSINESS_REGISTRATION' : 'NIN';
                  setIdentityDocuments((current) =>
                    current.map((item) =>
                      item.saved
                        ? item
                        : {
                            ...item,
                            type: defaultIdentityType,
                            issuingCountry: 'NG',
                            issuedAt: '',
                            expiresAt: '',
                            outcome: null,
                          },
                    ),
                  );
                  setFieldErrors({});
                }}
                disabled={Boolean(customer)}
              >
                <option value="INDIVIDUAL">Individual</option>
                <option value="BUSINESS">Business</option>
              </select>
            </label>
            {customerType === 'INDIVIDUAL' && (
              <>
                <label htmlFor="registration-first-name">
                  First name <span className="cm-required-indicator">Required</span>
                  <input
                    id="registration-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                    aria-invalid={Boolean(fieldErrors.firstName)}
                    aria-describedby={
                      fieldErrors.firstName ? 'registration-first-name-error' : undefined
                    }
                  />
                  <CustomerFieldError
                    id="registration-first-name-error"
                    message={fieldErrors.firstName}
                  />
                </label>
                <label htmlFor="registration-middle-name">
                  Middle name <span className="cm-optional-indicator">Optional</span>
                  <input
                    id="registration-middle-name"
                    value={middleName}
                    onChange={(event) => setMiddleName(event.target.value)}
                    autoComplete="additional-name"
                    aria-invalid={Boolean(fieldErrors.middleName)}
                    aria-describedby={
                      fieldErrors.middleName ? 'registration-middle-name-error' : undefined
                    }
                  />
                  <CustomerFieldError
                    id="registration-middle-name-error"
                    message={fieldErrors.middleName}
                  />
                </label>
                <label htmlFor="registration-last-name">
                  Last name <span className="cm-required-indicator">Required</span>
                  <input
                    id="registration-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                    aria-invalid={Boolean(fieldErrors.lastName)}
                    aria-describedby={
                      fieldErrors.lastName ? 'registration-last-name-error' : undefined
                    }
                  />
                  <CustomerFieldError
                    id="registration-last-name-error"
                    message={fieldErrors.lastName}
                  />
                </label>
              </>
            )}
            {customerType === 'BUSINESS' && (
              <label htmlFor="registration-business-name">
                Business name <span className="cm-required-indicator">Required</span>
                <input
                  id="registration-business-name"
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  autoComplete="organization"
                  required
                  aria-invalid={Boolean(fieldErrors.displayName || fieldErrors.legalName)}
                  aria-describedby={
                    fieldErrors.displayName || fieldErrors.legalName
                      ? 'registration-business-name-error'
                      : undefined
                  }
                />
                <CustomerFieldError
                  id="registration-business-name-error"
                  message={fieldErrors.displayName ?? fieldErrors.legalName}
                />
              </label>
            )}
            {customerType === 'INDIVIDUAL' && (
              <>
                <label htmlFor="registration-date-of-birth">
                  Date of birth <span className="cm-optional-indicator">Optional</span>
                  <input
                    id="registration-date-of-birth"
                    type="date"
                    max={getCustomerCalendarDate()}
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.dateOfBirth)}
                    aria-describedby={
                      fieldErrors.dateOfBirth ? 'registration-date-of-birth-error' : undefined
                    }
                  />
                  <CustomerFieldError
                    id="registration-date-of-birth-error"
                    message={fieldErrors.dateOfBirth}
                  />
                </label>
                <CustomerCountrySelect
                  id="registration-nationality"
                  label="Nationality"
                  value={nationality}
                  onChange={setNationality}
                  allowEmpty
                  error={fieldErrors.nationality}
                />
              </>
            )}
          </div>
          <p className="cm-form-help">
            Customer reference is generated automatically. Individual display and legal names are
            generated from the structured name fields; business registration uses the business
            name. Date of birth is optional and must be a real calendar date.
          </p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving…'
                : customer
                  ? 'Save profile & continue'
                  : 'Create DRAFT & continue'}
            </button>
            {customer && (
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={finishLater}
                disabled={isSaving}
              >
                Save and finish later
              </button>
            )}
          </div>
        </form>
      );
    }

    if (step === 1) {
      const phoneIsPersisted = Boolean(phoneContact) && persistedPhone === currentPhone.e164;
      return (
        <form
          className="cm-wizard-form"
          noValidate
          onSubmit={(event) => {
            void saveContacts(event);
          }}
        >
          <div className="cm-wizard-field-grid">
            <CustomerPhoneField
              id="registration-phone"
              label="Primary phone number"
              value={phone}
              country={phoneCountry}
              onChange={(value) => {
                setPhone(value);
                setOtpRequested(false);
                setOtpCode('');
                setVerificationToken('');
              }}
              onCountryChange={(value) => {
                setPhoneCountry(value);
                setOtpRequested(false);
                setOtpCode('');
                setVerificationToken('');
              }}
              error={fieldErrors.phone ?? fieldErrors.value}
              required
              helpText="Phone validation uses the selected country. The current one-time-code endpoint is Nigerian-phone only."
            />
            <label htmlFor="registration-email">
              Email address <span className="cm-optional-indicator">Optional</span>
              <input
                id="registration-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'registration-email-error' : undefined}
              />
              <CustomerFieldError id="registration-email-error" message={fieldErrors.email} />
            </label>
          </div>
          <p className="cm-form-help">
            The phone is saved in international format as an unverified contact until the existing
            OTP flow verifies it. Phone verification does not activate a customer or create a
            wallet.
          </p>
          <div className="cm-actions-row">
            <button
              className="cm-button cm-button-primary"
              type="submit"
              disabled={isSaving || !customer}
            >
              {isSaving ? 'Saving…' : 'Save contact details'}
            </button>
            {phoneIsPersisted && phoneContact?.verifiedAt ? (
              <span className="cm-status cm-status-active">Primary phone verified</span>
            ) : currentPhoneIsNigerian ? (
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => {
                  void requestPhoneOtp();
                }}
                disabled={isSaving || !phoneIsPersisted}
              >
                {isSaving ? 'Please wait…' : 'Send phone OTP'}
              </button>
            ) : (
              <span className="cm-muted">
                Only a valid Nigerian number can use the current OTP flow; other country numbers
                remain unverified.
              </span>
            )}
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setStep(2);
              }}
              disabled={isSaving || !phoneContact}
            >
              Continue to address
            </button>
          </div>
          {otpRequested && (
            <div className="cm-otp-form">
              <label htmlFor="registration-otp-code">
                One-time code
                <input
                  id="registration-otp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))}
                  aria-invalid={Boolean(fieldErrors.code)}
                  aria-describedby={fieldErrors.code ? 'registration-otp-code-error' : undefined}
                />
                <CustomerFieldError id="registration-otp-code-error" message={fieldErrors.code} />
              </label>
              <button
                className="cm-button cm-button-primary"
                type="button"
                onClick={() => void verifyPhone()}
                disabled={isSaving || otpCode.length < 4}
              >
                {isSaving
                  ? 'Verifying…'
                  : verificationToken
                    ? 'Retry verification save'
                    : 'Verify primary phone'}
              </button>
            </div>
          )}
          {customer && (
            <p className="cm-muted">
              Draft reference: <code>{customer.reference}</code> · No customer status or financial
              action is performed on this step.
            </p>
          )}
          {customer && (
            <button
              className="cm-text-button"
              type="button"
              onClick={finishLater}
              disabled={isSaving}
            >
              Save and finish later
            </button>
          )}
        </form>
      );
    }

    if (step === 2) {
      return (
        <form
          className="cm-wizard-form"
          noValidate
          onSubmit={(event) => {
            void saveAddress(event);
          }}
        >
          <div className="cm-wizard-field-grid">
            <label htmlFor="registration-address-type">
              Address type
              <select
                id="registration-address-type"
                value={addressType}
                onChange={(event) => setAddressType(event.target.value as AddressType)}
              >
                <option value="RESIDENTIAL">Residential</option>
                <option value="BUSINESS">Business</option>
                <option value="MAILING">Mailing</option>
              </select>
            </label>
            <label htmlFor="registration-address-line-one">
              Address line 1 <span className="cm-required-indicator">Required if saving</span>
              <input
                id="registration-address-line-one"
                value={lineOne}
                onChange={(event) => setLineOne(event.target.value)}
                autoComplete="address-line1"
                aria-invalid={Boolean(fieldErrors.lineOne)}
                aria-describedby={
                  fieldErrors.lineOne ? 'registration-address-line-one-error' : undefined
                }
              />
              <CustomerFieldError
                id="registration-address-line-one-error"
                message={fieldErrors.lineOne}
              />
            </label>
            <label htmlFor="registration-address-line-two">
              Address line 2 <span className="cm-optional-indicator">Optional</span>
              <input
                id="registration-address-line-two"
                value={lineTwo}
                onChange={(event) => setLineTwo(event.target.value)}
                autoComplete="address-line2"
                aria-invalid={Boolean(fieldErrors.lineTwo)}
                aria-describedby={
                  fieldErrors.lineTwo ? 'registration-address-line-two-error' : undefined
                }
              />
              <CustomerFieldError
                id="registration-address-line-two-error"
                message={fieldErrors.lineTwo}
              />
            </label>
            <label htmlFor="registration-address-city">
              City <span className="cm-required-indicator">Required if saving</span>
              <input
                id="registration-address-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoComplete="address-level2"
                aria-invalid={Boolean(fieldErrors.city)}
                aria-describedby={fieldErrors.city ? 'registration-address-city-error' : undefined}
              />
              <CustomerFieldError id="registration-address-city-error" message={fieldErrors.city} />
            </label>
            <label htmlFor="registration-address-state">
              State / province <span className="cm-required-indicator">Required if saving</span>
              <input
                id="registration-address-state"
                value={stateOrProvince}
                onChange={(event) => setStateOrProvince(event.target.value)}
                autoComplete="address-level1"
                aria-invalid={Boolean(fieldErrors.state)}
                aria-describedby={
                  fieldErrors.state ? 'registration-address-state-error' : undefined
                }
              />
              <CustomerFieldError
                id="registration-address-state-error"
                message={fieldErrors.state}
              />
            </label>
            <CustomerCountrySelect
              id="registration-address-country"
              label="Country"
              value={country}
              onChange={setCountry}
              required
              error={fieldErrors.country}
            />
            <label htmlFor="registration-postal-code">
              Postal code <span className="cm-optional-indicator">Optional</span>
              <input
                id="registration-postal-code"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                autoComplete="postal-code"
                aria-invalid={Boolean(fieldErrors.postalCode)}
                aria-describedby={
                  fieldErrors.postalCode ? 'registration-postal-code-error' : undefined
                }
              />
              <CustomerFieldError
                id="registration-postal-code-error"
                message={fieldErrors.postalCode}
              />
            </label>
          </div>
          <p className="cm-form-help">
            Postal-code format is checked for countries with a maintained country-specific rule; an
            unsupported country uses a safe length/character fallback. The saved address is marked
            primary.
          </p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save address & continue'}
            </button>
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={advanceWithoutAddress}
              disabled={isSaving}
            >
              Skip address
            </button>
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => setStep(1)}
              disabled={isSaving}
            >
              Back
            </button>
            {customer && (
              <button
                className="cm-text-button"
                type="button"
                onClick={finishLater}
                disabled={isSaving}
              >
                Save and finish later
              </button>
            )}
          </div>
        </form>
      );
    }

    if (step === 3) {
      if (!canManageIdentity) {
        return (
          <div className="cm-wizard-form">
            <div className="cm-empty-state">
              Identity-document entry is restricted to roles with both{' '}
              <code>customer.view_identity_documents</code> and <code>kyc.review</code>. No document
              value is requested or exposed for this session.
            </div>
            <div className="cm-actions-row">
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => setStep(2)}
              >
                Back
              </button>
              <button
                className="cm-button cm-button-primary"
                type="button"
                onClick={() => {
                  setError(null);
                  setFieldErrors({});
                  setStep(4);
                }}
              >
                Finish registration
              </button>
            </div>
          </div>
        );
      }
      const identityTypes = getIdentityDocumentTypes(customerType) as IdentityType[];
      return (
        <div className="cm-wizard-form">
          <p className="cm-form-help">
            Identity documents are optional and save independently. NIN and BVN do not use issue or
            expiry dates; other document dates are optional.
          </p>
          <div className="cm-identity-draft-list">
            {identityDocuments.map((document, index) => (
              <fieldset className="cm-card cm-identity-draft" key={document.localId}>
                <legend>Identity document {index + 1}</legend>
                {document.saved ? (
                  <div className="cm-identity-saved-result" role="status">
                    <strong>{document.saved.type.replaceAll('_', ' ')}</strong>
                    <span>{document.saved.maskedDocumentNumber} · Saved</span>
                    <span className="cm-secondary-line">
                      Issuing country: {countryNameForCode(document.saved.issuingCountry)}
                    </span>
                    {supportsIdentityDates(document.saved.type) &&
                      (document.saved.issuedAt || document.saved.expiresAt) && (
                        <span className="cm-secondary-line">
                          {document.saved.issuedAt ? `Issued ${document.saved.issuedAt}` : ''}
                          {document.saved.issuedAt && document.saved.expiresAt ? ' · ' : ''}
                          {document.saved.expiresAt ? `Expires ${document.saved.expiresAt}` : ''}
                        </span>
                      )}
                    <p className="cm-form-help">
                      Saved documents cannot be removed here. Authorized corrections are available
                      in Customer 360°.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="cm-wizard-field-grid">
                      <label htmlFor={`identity-type-${document.localId}`}>
                        Identity document type
                        <select
                          id={`identity-type-${document.localId}`}
                          value={document.type}
                          aria-invalid={Boolean(document.errors.type)}
                          aria-describedby={
                            document.errors.type
                              ? `identity-type-error-${document.localId}`
                              : undefined
                          }
                          onChange={(event) => {
                            const type = event.target.value as IdentityType;
                            setIdentityDocuments((current) =>
                              current.map((item) =>
                                item.localId === document.localId
                                  ? {
                                      ...item,
                                      type,
                                      issuingCountry: isNigeriaIdentityType(type)
                                        ? 'NG'
                                        : item.issuingCountry || 'NG',
                                      issuedAt: supportsIdentityDates(type) ? item.issuedAt : '',
                                      expiresAt: supportsIdentityDates(type) ? item.expiresAt : '',
                                      errors: {},
                                      outcome: null,
                                    }
                                  : item,
                              ),
                            );
                          }}
                        >
                          {identityTypes.map((value) => (
                            <option key={value} value={value}>
                              {value.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                        <CustomerFieldError
                          id={`identity-type-error-${document.localId}`}
                          message={document.errors.type}
                        />
                      </label>
                      <label htmlFor={`identity-number-${document.localId}`}>
                        Document number{' '}
                        <span className="cm-required-indicator">Required to save</span>
                        <input
                          id={`identity-number-${document.localId}`}
                          type="password"
                          autoComplete="off"
                          maxLength={160}
                          value={document.documentNumber}
                          aria-invalid={Boolean(document.errors.documentNumber)}
                          aria-describedby={[
                            `cm-document-number-note-${document.localId}`,
                            document.errors.documentNumber
                              ? `identity-number-error-${document.localId}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onChange={(event) =>
                            setIdentityDocuments((current) =>
                              current.map((item) =>
                                item.localId === document.localId
                                  ? {
                                      ...item,
                                      documentNumber: event.target.value,
                                      errors: { ...item.errors, documentNumber: '' },
                                      outcome: null,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <CustomerFieldError
                          id={`identity-number-error-${document.localId}`}
                          message={document.errors.documentNumber}
                        />
                      </label>
                      <CustomerCountrySelect
                        id={`identity-country-${document.localId}`}
                        label={
                          isNigeriaIdentityType(document.type)
                            ? 'Issuing country · Nigeria (NG)'
                            : 'Issuing country'
                        }
                        value={
                          isNigeriaIdentityType(document.type) ? 'NG' : document.issuingCountry
                        }
                        onChange={(issuingCountry) =>
                          setIdentityDocuments((current) =>
                            current.map((item) =>
                              item.localId === document.localId
                                ? {
                                    ...item,
                                    issuingCountry,
                                    errors: { ...item.errors, issuingCountry: '' },
                                    outcome: null,
                                  }
                                : item,
                            ),
                          )
                        }
                        required
                        disabled={isNigeriaIdentityType(document.type)}
                        error={document.errors.issuingCountry}
                      />
                      {supportsIdentityDates(document.type) && (
                        <>
                          <label htmlFor={`identity-issued-at-${document.localId}`}>
                            Issue date <span className="cm-optional-indicator">Optional</span>
                            <input
                              id={`identity-issued-at-${document.localId}`}
                              type="date"
                              max={getCustomerCalendarDate()}
                              value={document.issuedAt}
                              aria-invalid={Boolean(document.errors.issuedAt)}
                              aria-describedby={
                                document.errors.issuedAt
                                  ? `identity-issued-at-error-${document.localId}`
                                  : undefined
                              }
                              onChange={(event) =>
                                setIdentityDocuments((current) =>
                                  current.map((item) =>
                                    item.localId === document.localId
                                      ? {
                                          ...item,
                                          issuedAt: event.target.value,
                                          errors: { ...item.errors, issuedAt: '' },
                                          outcome: null,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <CustomerFieldError
                              id={`identity-issued-at-error-${document.localId}`}
                              message={document.errors.issuedAt}
                            />
                          </label>
                          <label htmlFor={`identity-expires-at-${document.localId}`}>
                            Expiry date <span className="cm-optional-indicator">Optional</span>
                            <input
                              id={`identity-expires-at-${document.localId}`}
                              type="date"
                              min={document.issuedAt || undefined}
                              value={document.expiresAt}
                              aria-invalid={Boolean(document.errors.expiresAt)}
                              aria-describedby={
                                document.errors.expiresAt
                                  ? `identity-expires-at-error-${document.localId}`
                                  : undefined
                              }
                              onChange={(event) =>
                                setIdentityDocuments((current) =>
                                  current.map((item) =>
                                    item.localId === document.localId
                                      ? {
                                          ...item,
                                          expiresAt: event.target.value,
                                          errors: { ...item.errors, expiresAt: '' },
                                          outcome: null,
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <CustomerFieldError
                              id={`identity-expires-at-error-${document.localId}`}
                              message={document.errors.expiresAt}
                            />
                          </label>
                        </>
                      )}
                    </div>
                    <p id={`cm-document-number-note-${document.localId}`} className="cm-form-help">
                      Document numbers are sent only to the authorized API, are never placed in
                      audit metadata, and are masked in all read and save responses. Metadata entry
                      does not verify an identity against an official source.
                    </p>
                    {document.outcome && (
                      <p
                        className={document.outcome.kind === 'success' ? 'cm-notice' : 'cm-error'}
                        role={document.outcome.kind === 'success' ? 'status' : 'alert'}
                      >
                        {document.outcome.message}
                      </p>
                    )}
                    <div className="cm-actions-row">
                      <button
                        className="cm-button cm-button-primary"
                        type="button"
                        onClick={() => void saveIdentityDocument(document.localId)}
                        disabled={isSaving || !document.documentNumber.trim()}
                      >
                        {isSaving ? 'Saving…' : 'Save this document'}
                      </button>
                      <button
                        className="cm-button cm-button-secondary"
                        type="button"
                        onClick={() => removeUnsavedIdentityDocument(document.localId)}
                        disabled={isSaving}
                      >
                        Remove unsaved entry
                      </button>
                    </div>
                  </>
                )}
              </fieldset>
            ))}
          </div>
          <div className="cm-actions-row">
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={addIdentityDocument}
              disabled={isSaving}
            >
              Add another identity document
            </button>
            <button
              className="cm-button cm-button-primary"
              type="button"
              onClick={skipRemainingIdentityDocuments}
              disabled={isSaving}
            >
              {identityDocuments.some((item) => item.saved)
                ? 'Continue to registration summary'
                : 'Skip identity documents'}
            </button>
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => setStep(2)}
              disabled={isSaving}
            >
              Back
            </button>
            {customer && (
              <button
                className="cm-text-button"
                type="button"
                onClick={finishLater}
                disabled={isSaving}
              >
                Save and finish later
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="cm-registration-summary">
        <div className="cm-summary-success" aria-label="Draft customer saved">
          <span className="cm-summary-check" aria-hidden="true">
            ✓
          </span>
          <div>
            <p className="cm-eyebrow">REGISTRATION SAVED</p>
            <h3>{displayName || derivedDisplayName || 'Customer profile saved'}</h3>
            <p className="cm-muted">
              The customer remains <strong>DRAFT</strong>. No activation or ledger wallet creation
              was requested.
            </p>
          </div>
        </div>
        <dl className="cm-summary-grid">
          <div>
            <dt>Customer reference</dt>
            <dd>{customer?.reference ?? 'Not available'}</dd>
          </div>
          <div>
            <dt>Customer type</dt>
            <dd>{customerType}</dd>
          </div>
          <div>
            <dt>Primary phone</dt>
            <dd>
              {phoneContact?.maskedValue ?? 'Not saved'} ·{' '}
              {phoneContact?.verifiedAt ? 'Verified' : 'Unverified'}
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{emailContact?.maskedValue ?? (email.trim() ? 'Saved' : 'Not recorded')}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{address ? 'Saved as primary' : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Identity documents</dt>
            <dd>
              {canManageIdentity
                ? identityDocuments.filter((item) => item.saved).length
                  ? identityDocuments
                      .filter((item) => item.saved)
                      .map(
                        (item) =>
                          `${item.saved?.type.replaceAll('_', ' ')} · ${item.saved?.maskedDocumentNumber}`,
                      )
                      .join(', ')
                  : 'Not recorded'
                : 'Restricted for this role'}
            </dd>
          </div>
        </dl>
        {canManageIdentity &&
          identityDocuments.some((item) => !item.saved && item.documentNumber.trim()) && (
            <div className="cm-summary-warning" role="status">
              Unsaved identity-document entries were not sent. Review, save, or remove them before
              closing if needed.
              <button className="cm-text-button" type="button" onClick={() => setStep(3)}>
                Review identity documents
              </button>
            </div>
          )}
        {!phoneContact?.verifiedAt && (
          <p className="cm-summary-warning">
            Activation stays blocked until an authorized workflow verifies a primary phone. Continue
            later in Customer 360°.
          </p>
        )}
        <div className="cm-actions-row">
          {customer && (
            <button
              className="cm-button cm-button-primary"
              type="button"
              onClick={() => onOpenCustomer(customer.id)}
            >
              Open Customer 360°
            </button>
          )}
          <button className="cm-button cm-button-secondary" type="button" onClick={onClose}>
            Return to directory
          </button>
        </div>
      </div>
    );
  };

  return (
    <section
      className="cm-create-panel cm-registration-wizard"
      aria-label="New customer registration"
    >
      <div className="cm-wizard-heading">
        <div>
          <p className="cm-eyebrow">DRAFT REGISTRATION · {progress}</p>
          <h2>{step < 4 ? STEPS[step] : 'Registration summary'}</h2>
          <p>
            Personal information is saved incrementally so an incomplete DRAFT can be continued in
            Customer 360°.
          </p>
        </div>
        <button
          className="cm-button cm-button-secondary"
          type="button"
          onClick={onClose}
          disabled={isSaving}
        >
          Close
        </button>
      </div>
      <ol className="cm-wizard-stepper" aria-label="Registration progress">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
          >
            <span>{index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>
      {error && (
        <div className="cm-error cm-wizard-message" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="cm-notice cm-wizard-message" role="status">
          {notice}
        </div>
      )}
      {stepForm()}
    </section>
  );
};
