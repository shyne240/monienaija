import React, { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  addressSignature,
  countryCodesMatch,
  getCustomerCalendarDate,
  getIdentityDocumentTypes,
  getPhoneCountry,
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
import {
  CustomerCountrySelect,
  CustomerFieldError,
  CustomerPhoneField,
} from './CustomerFormFields';
import { countryNameForCode, isNigeriaIdentityType } from './CountrySelect';

interface ProfileRecord {
  displayName: string;
  legalName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
}

interface AddressRecord {
  id: string;
  type: 'RESIDENTIAL' | 'BUSINESS' | 'MAILING';
  lineOne: string;
  lineTwo: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  isPrimary: boolean;
}

interface ContactRecord {
  id: string;
  type: 'PHONE' | 'EMAIL';
  /** May be omitted by the API, which deliberately returns only maskedValue. */
  value?: string;
  maskedValue?: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

interface IdentityRecord {
  id: string;
  type: IdentityType;
  maskedDocumentNumber: string;
  issuingCountry: string;
  issuedAt: string | null;
  expiresAt: string | null;
}

type IdentityType =
  | 'BVN'
  | 'NIN'
  | 'INTERNATIONAL_PASSPORT'
  | 'DRIVERS_LICENSE'
  | 'VOTERS_CARD'
  | 'BUSINESS_REGISTRATION';

type AddressType = AddressRecord['type'];
type ContactType = ContactRecord['type'];

function supportsIdentityDates(type: IdentityType): boolean {
  return !isNigeriaIdentityType(type);
}

interface CustomerPersonalInformationPanelProps {
  customerId: string;
  customerType?: string;
  onProfileUpdated: (profile: Pick<ProfileRecord, 'displayName' | 'legalName'>) => void;
  onVerificationUpdated?: () => void;
}

interface ProfileFormState {
  displayName: string;
  legalName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
}

interface AddressFormState {
  type: AddressType;
  lineOne: string;
  lineTwo: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  isPrimary: boolean;
}

interface ContactFormState {
  id?: string;
  type: ContactType;
  value: string;
  phoneCountry: string;
  isPrimary: boolean;
}

interface IdentityFormState {
  id?: string;
  type: IdentityType;
  documentNumber: string;
  issuingCountry: string;
  issuedAt: string;
  expiresAt: string;
}

interface ReadResult<T> {
  value: T | null;
  status?: number;
}

function emptyProfile(): ProfileFormState {
  return {
    displayName: '',
    legalName: '',
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: 'NG',
  };
}

function emptyAddress(): AddressFormState {
  return {
    type: 'RESIDENTIAL',
    lineOne: '',
    lineTwo: '',
    city: '',
    state: '',
    country: 'NG',
    postalCode: '',
    isPrimary: true,
  };
}

function messageFor(error: unknown): string {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401) return 'Your workforce session has expired. Sign in again.';
  if (status === 403) return 'This action is not allowed for your current workforce role.';
  if (status === 400) return 'The API rejected one or more fields. Review the form and retry.';
  if (status === 404) return 'The requested customer data is no longer available.';
  if (status === 409)
    return 'A conflicting record already exists. Refresh the customer data and review it.';
  return 'The change could not be saved. Retry without leaving this page.';
}

async function safeGet<T>(path: string): Promise<ReadResult<T>> {
  try {
    return { value: await ApiClient.get<T>(path) };
  } catch (error) {
    return {
      value: null,
      status:
        error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined,
    };
  }
}

function fieldErrorsFrom(error: unknown, valueField = 'value'): Record<string, string> {
  if (!error || typeof error !== 'object' || !('validationErrors' in error)) return {};
  const source = (error as { validationErrors?: unknown }).validationErrors;
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).flatMap(([field, value]) => {
      const message = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value;
      const name = field === 'value' ? valueField : field;
      return typeof message === 'string' ? [[name, message]] : [];
    }),
  );
}

function profileFormFrom(profile: ProfileRecord | null): ProfileFormState {
  if (!profile) return emptyProfile();
  return {
    displayName: profile.displayName,
    legalName: profile.legalName ?? '',
    firstName: profile.firstName ?? '',
    middleName: profile.middleName ?? '',
    lastName: profile.lastName ?? '',
    dateOfBirth: profile.dateOfBirth?.slice(0, 10) ?? '',
    nationality: profile.nationality ?? 'NG',
  };
}

export const CustomerPersonalInformationPanel: React.FC<CustomerPersonalInformationPanelProps> = ({
  customerId,
  customerType = 'INDIVIDUAL',
  onProfileUpdated,
  onVerificationUpdated,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const hasFunction = (code: string) => scopes.includes(code);
  const canWriteProfile = hasFunction('customer.create');
  const canViewProfile = hasFunction('customer.view');
  const canViewAddress = hasFunction('customer.view_address');
  const canWriteAddress = canViewAddress && canWriteProfile;
  const canViewContacts = hasFunction('customer.view_contact_methods');
  const canWriteContacts = canViewContacts && canWriteProfile;
  const canViewIdentity = hasFunction('customer.view_identity_documents');
  const canWriteIdentity = canViewIdentity && hasFunction('kyc.review');
  const scopesKey = scopes.join('|');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [profileStatus, setProfileStatus] = useState<number | undefined>();
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfile);

  const [addresses, setAddresses] = useState<AddressRecord[] | null>(null);
  const [addressStatus, setAddressStatus] = useState<number | undefined>();
  const [addressForm, setAddressForm] = useState<AddressFormState | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ContactRecord[] | null>(null);
  const [contactStatus, setContactStatus] = useState<number | undefined>();
  const [contactForm, setContactForm] = useState<ContactFormState | null>(null);
  const [showContactValues, setShowContactValues] = useState(false);
  const [verifyContactId, setVerifyContactId] = useState<string | null>(null);
  const [verifyPhoneValue, setVerifyPhoneValue] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  const [identityDocuments, setIdentityDocuments] = useState<IdentityRecord[] | null>(null);
  const [identityStatus, setIdentityStatus] = useState<number | undefined>();
  const [identityForm, setIdentityForm] = useState<IdentityFormState | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);
    setProfileEditing(false);
    setProfileForm(emptyProfile());
    setAddressForm(null);
    setAddressId(null);
    setContactForm(null);
    setIdentityForm(null);
    setVerifyContactId(null);
    setOtpRequested(false);
    setOtpCode('');
    setVerificationToken('');
    setShowContactValues(false);
    const id = encodeURIComponent(customerId);
    const requests = Promise.all([
      canViewProfile ? safeGet<ProfileRecord>(`/customers/${id}/profile`) : Promise.resolve(null),
      canViewAddress
        ? safeGet<AddressRecord[]>(`/customers/${id}/addresses`)
        : Promise.resolve(null),
      canViewContacts
        ? safeGet<ContactRecord[]>(`/customers/${id}/contact-methods`)
        : Promise.resolve(null),
      canViewIdentity
        ? safeGet<IdentityRecord[]>(`/customers/${id}/identity-documents`)
        : Promise.resolve(null),
    ]);
    requests
      .then(([profileResult, addressResult, contactResult, identityResult]) => {
        if (!active) return;
        setProfile(profileResult?.value ?? null);
        setProfileStatus(profileResult?.status);
        setAddresses(addressResult?.value ?? null);
        setAddressStatus(addressResult?.status);
        setContacts(contactResult?.value ?? null);
        setContactStatus(contactResult?.status);
        setIdentityDocuments(identityResult?.value ?? null);
        setIdentityStatus(identityResult?.status);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Authorized personal-information sections could not be loaded.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId, scopesKey, reloadVersion]);

  const refresh = () => setReloadVersion((value) => value + 1);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || !canWriteProfile || !canViewProfile) return;
    const displayNameChanged = !profile || profileForm.displayName !== profile.displayName;
    const legalNameChanged = !profile || profileForm.legalName !== (profile.legalName ?? '');
    const firstNameChanged = !profile || profileForm.firstName !== (profile.firstName ?? '');
    const middleNameChanged = !profile || profileForm.middleName !== (profile.middleName ?? '');
    const lastNameChanged = !profile || profileForm.lastName !== (profile.lastName ?? '');
    const dateOfBirthChanged =
      !profile || profileForm.dateOfBirth !== (profile.dateOfBirth?.slice(0, 10) ?? '');
    const nationalityChanged =
      !profile || !countryCodesMatch(profile.nationality ?? '', profileForm.nationality);
    const validationErrors = validateProfileFields(
      {
        customerType,
        displayName: displayNameChanged ? profileForm.displayName : undefined,
        legalName: legalNameChanged ? profileForm.legalName : undefined,
        firstName:
          customerType === 'INDIVIDUAL' && firstNameChanged ? profileForm.firstName : undefined,
        middleName:
          customerType === 'INDIVIDUAL' && middleNameChanged ? profileForm.middleName : undefined,
        lastName:
          customerType === 'INDIVIDUAL' && lastNameChanged ? profileForm.lastName : undefined,
        dateOfBirth:
          customerType === 'INDIVIDUAL' && dateOfBirthChanged ? profileForm.dateOfBirth : undefined,
        nationality:
          customerType === 'INDIVIDUAL' && nationalityChanged ? profileForm.nationality : undefined,
      },
      {
        requireDisplayName: !profile,
        requireBusinessLegalName: customerType === 'BUSINESS' && !profile,
      },
    );
    if (
      customerType === 'BUSINESS' &&
      profile &&
      legalNameChanged &&
      !normalizeCustomerText(profileForm.legalName)
    ) {
      validationErrors.legalName = 'A business legal name cannot be cleared.';
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted profile fields before saving.');
      return;
    }

    const body: Record<string, unknown> = {};
    const displayName = normalizeCustomerText(profileForm.displayName);
    const legalName = normalizeCustomerText(profileForm.legalName);
    if (!profile || profileForm.displayName !== profile.displayName) body.displayName = displayName;
    if (!profile) {
      if (legalName) body.legalName = legalName;
      if (customerType === 'INDIVIDUAL') {
        if (normalizeCustomerText(profileForm.firstName))
          body.firstName = normalizeCustomerText(profileForm.firstName);
        if (normalizeCustomerText(profileForm.middleName))
          body.middleName = normalizeCustomerText(profileForm.middleName);
        if (normalizeCustomerText(profileForm.lastName))
          body.lastName = normalizeCustomerText(profileForm.lastName);
        if (profileForm.dateOfBirth) body.dateOfBirth = profileForm.dateOfBirth;
        const nationality = normalizeIsoCountryCode(profileForm.nationality);
        if (nationality) body.nationality = nationality;
      }
    } else {
      if (profileForm.legalName !== (profile.legalName ?? '')) body.legalName = legalName || null;
      if (customerType === 'INDIVIDUAL') {
        for (const [field, value, previous] of [
          ['firstName', profileForm.firstName, profile.firstName],
          ['middleName', profileForm.middleName, profile.middleName],
          ['lastName', profileForm.lastName, profile.lastName],
        ] as Array<[string, string, string | null]>) {
          const normalized = normalizeCustomerText(value);
          if (value !== (previous ?? '')) body[field] = normalized || null;
        }
        const dateOfBirth = profileForm.dateOfBirth || null;
        if (profileForm.dateOfBirth !== (profile.dateOfBirth?.slice(0, 10) ?? ''))
          body.dateOfBirth = dateOfBirth;
        const oldNationality = normalizeIsoCountryCode(profile.nationality);
        const nextNationality = normalizeIsoCountryCode(profileForm.nationality);
        if (oldNationality !== nextNationality) body.nationality = nextNationality;
      }
    }

    if (Object.keys(body).length === 0) {
      setProfileEditing(false);
      setFieldErrors({});
      setNotice('No profile changes were needed.');
      setError(null);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = profile
        ? await ApiClient.patch<ProfileRecord>(
            `/customers/${encodeURIComponent(customerId)}/profile`,
            body,
          )
        : await ApiClient.post<ProfileRecord>(
            `/customers/${encodeURIComponent(customerId)}/profile`,
            body,
          );
      setProfile(saved);
      setProfileForm(profileFormFrom(saved));
      setProfileEditing(false);
      setFieldErrors({});
      onProfileUpdated({ displayName: saved.displayName, legalName: saved.legalName });
      setNotice(
        'Personal information saved. Changes are audited without storing the submitted values in audit metadata.',
      );
      refresh();
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError));
      setError(messageFor(saveError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addressForm || busyRef.current || !canWriteAddress) return;
    const normalizedForm = {
      ...addressForm,
      lineOne: normalizeCustomerText(addressForm.lineOne),
      lineTwo: normalizeCustomerText(addressForm.lineTwo) || null,
      city: normalizeCustomerText(addressForm.city),
      state: normalizeCustomerText(addressForm.state),
      country: normalizeIsoCountryCode(addressForm.country) ?? addressForm.country,
      postalCode: normalizeCustomerText(addressForm.postalCode) || null,
    };
    const original = addressId ? addresses?.find((address) => address.id === addressId) : undefined;
    if (addressId && !original) {
      setError('The address could not be reloaded. Refresh the customer data before editing it.');
      return;
    }
    const allValidationErrors = validateAddressFields(normalizedForm);
    const submittedFields = new Set<string>();
    if (original) {
      if (addressForm.type !== original.type) submittedFields.add('type');
      if (addressForm.lineOne !== original.lineOne) submittedFields.add('lineOne');
      if (addressForm.lineTwo !== (original.lineTwo ?? '')) submittedFields.add('lineTwo');
      if (addressForm.city !== original.city) submittedFields.add('city');
      if (addressForm.state !== original.state) submittedFields.add('state');
      if (!countryCodesMatch(addressForm.country, original.country)) {
        submittedFields.add('country');
        submittedFields.add('postalCode');
      }
      if (addressForm.postalCode !== (original.postalCode ?? '')) submittedFields.add('postalCode');
    }
    const validationErrors = original
      ? Object.fromEntries(
          Object.entries(allValidationErrors).filter(([field]) => submittedFields.has(field)),
        )
      : allValidationErrors;
    const identityFieldEdited = [
      'type',
      'lineOne',
      'lineTwo',
      'city',
      'state',
      'country',
      'postalCode',
    ].some((field) => submittedFields.has(field));
    const identityChanged =
      !original ||
      (identityFieldEdited && addressSignature(normalizedForm) !== addressSignature(original));
    if (identityChanged) {
      const duplicate = addresses?.some(
        (address) =>
          address.id !== addressId &&
          addressSignature(address) === addressSignature(normalizedForm),
      );
      if (duplicate)
        validationErrors.lineOne = 'An identical address of this type is already recorded.';
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted address fields before saving.');
      return;
    }
    const alpha2Country = normalizeIsoCountryCode(normalizedForm.country);
    if (!alpha2Country) return;

    const body: Record<string, unknown> = {};
    if (!original) {
      Object.assign(body, {
        type: normalizedForm.type,
        lineOne: normalizedForm.lineOne,
        lineTwo: normalizedForm.lineTwo,
        city: normalizedForm.city,
        state: normalizedForm.state,
        country: alpha2Country,
        postalCode: normalizedForm.postalCode,
        isPrimary: normalizedForm.isPrimary,
      });
    } else {
      if (addressForm.type !== original.type) body.type = normalizedForm.type;
      if (addressForm.lineOne !== original.lineOne && normalizedForm.lineOne !== original.lineOne)
        body.lineOne = normalizedForm.lineOne;
      if (
        addressForm.lineTwo !== (original.lineTwo ?? '') &&
        normalizedForm.lineTwo !== original.lineTwo
      )
        body.lineTwo = normalizedForm.lineTwo;
      if (addressForm.city !== original.city && normalizedForm.city !== original.city)
        body.city = normalizedForm.city;
      if (addressForm.state !== original.state && normalizedForm.state !== original.state)
        body.state = normalizedForm.state;
      if (!countryCodesMatch(addressForm.country, original.country)) body.country = alpha2Country;
      if (addressForm.postalCode !== (original.postalCode ?? ''))
        body.postalCode = normalizedForm.postalCode;
      if (normalizedForm.isPrimary !== original.isPrimary)
        body.isPrimary = normalizedForm.isPrimary;
    }
    if (Object.keys(body).length === 0) {
      setAddressForm(null);
      setAddressId(null);
      setFieldErrors({});
      setNotice('No address changes were needed.');
      setError(null);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (addressId) {
        await ApiClient.patch(
          `/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`,
          body,
        );
      } else {
        await ApiClient.post(`/customers/${encodeURIComponent(customerId)}/address`, body);
      }
      setAddressForm(null);
      setAddressId(null);
      setFieldErrors({});
      setNotice(
        'Address correction saved. Primary designation is enforced across this customer’s addresses.',
      );
      refresh();
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError));
      setError(messageFor(saveError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactForm || busyRef.current || !canWriteContacts) return;
    const original = contacts?.find((contact) => contact.id === contactForm.id);
    const hasValueInput = Boolean(normalizeCustomerText(contactForm.value));
    const requiresValue = !contactForm.id;
    const validation =
      hasValueInput || requiresValue
        ? validateContactFields(contactForm.type, contactForm.value, contactForm.phoneCountry)
        : {};
    const validationErrors = validation.value
      ? { [contactForm.type === 'PHONE' ? 'phone' : 'email']: validation.value }
      : {};
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted contact field before saving.');
      return;
    }

    const body: Record<string, unknown> = { isPrimary: contactForm.isPrimary };
    if (hasValueInput || !contactForm.id) {
      const normalizedValue =
        contactForm.type === 'PHONE'
          ? (normalizePhoneNumber(contactForm.value, contactForm.phoneCountry).e164 ?? '')
          : normalizeEmailAddress(contactForm.value);
      body.value = normalizedValue;
      if (contactForm.type === 'PHONE') body.phoneCountry = contactForm.phoneCountry;
    }
    const isPrimaryUnchanged = original?.isPrimary === contactForm.isPrimary;
    if (original && !hasValueInput && isPrimaryUnchanged) {
      setContactForm(null);
      setFieldErrors({});
      setNotice('No contact changes were needed.');
      setError(null);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (contactForm.id) {
        await ApiClient.patch(
          `/customers/${encodeURIComponent(customerId)}/contact-methods/${encodeURIComponent(contactForm.id)}`,
          body,
        );
      } else {
        await ApiClient.post(`/customers/${encodeURIComponent(customerId)}/contact-method`, {
          type: contactForm.type,
          ...body,
        });
      }
      setContactForm(null);
      setFieldErrors({});
      setNotice(
        'Contact correction saved. Leave an existing value blank to retain it; replacing a phone clears its prior verification proof.',
      );
      refresh();
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError, contactForm.type === 'PHONE' ? 'phone' : 'email'));
      setError(messageFor(saveError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const requestOtp = async (contact: ContactRecord) => {
    if (busyRef.current) return;
    if (!contact.value) {
      setError(
        'The contact value is masked by the API, so it cannot be submitted to the existing OTP flow.',
      );
      return;
    }
    const normalized = normalizePhoneNumber(contact.value, getPhoneCountry(contact.value));
    if (!normalized.valid || !normalized.e164 || normalized.country !== 'NG') {
      setError('The current OTP flow supports valid Nigerian phone numbers only.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);
    try {
      await ApiClient.post('/customers/registration/otp', { phone: normalized.e164 });
      setVerifyContactId(contact.id);
      setVerifyPhoneValue(normalized.e164);
      setOtpRequested(true);
      setOtpCode('');
      setVerificationToken('');
      setNotice('OTP request accepted. Enter the one-time code sent to the phone number.');
    } catch (otpError) {
      setFieldErrors(fieldErrorsFrom(otpError));
      setError(messageFor(otpError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const verifyPhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verifyContactId || busyRef.current || !otpRequested) return;
    const normalized = normalizePhoneNumber(verifyPhoneValue, 'NG');
    if (!normalized.valid || !normalized.e164 || normalized.country !== 'NG') {
      setError('The existing OTP flow can verify Nigerian phone numbers only.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setNotice(null);
    try {
      let token = verificationToken;
      if (!token) {
        const result = await ApiClient.post<{ verificationToken: string }>(
          '/customers/registration/otp/verify',
          { phone: normalized.e164, code: otpCode.trim() },
        );
        token = result.verificationToken;
        setVerificationToken(token);
      }
      const contact = contacts?.find((item) => item.id === verifyContactId);
      await ApiClient.patch(
        `/customers/${encodeURIComponent(customerId)}/contact-methods/${encodeURIComponent(verifyContactId)}`,
        {
          value: normalized.e164,
          phoneCountry: 'NG',
          isPrimary: Boolean(contact?.isPrimary),
          verificationToken: token,
        },
      );
      setOtpRequested(false);
      setOtpCode('');
      setVerificationToken('');
      setVerifyContactId(null);
      setNotice('Phone verified. The customer remains in its current lifecycle status.');
      onVerificationUpdated?.();
      refresh();
    } catch (verifyError) {
      setFieldErrors(fieldErrorsFrom(verifyError));
      setError(messageFor(verifyError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identityForm || busyRef.current || !canWriteIdentity) return;
    const original = identityDocuments?.find((document) => document.id === identityForm.id);
    const typeChanged = Boolean(original) && identityForm.type !== original?.type;
    const countryChanged =
      Boolean(original) &&
      !countryCodesMatch(identityForm.issuingCountry, original?.issuingCountry);
    const numberProvided = Boolean(normalizeCustomerText(identityForm.documentNumber));
    const datesSupported = supportsIdentityDates(identityForm.type);
    const validationErrors = validateIdentityDocumentFields(
      {
        type: identityForm.type,
        documentNumber: numberProvided
          ? normalizeCustomerText(identityForm.documentNumber)
          : undefined,
        issuingCountry: identityForm.issuingCountry,
        issuedAt: datesSupported ? identityForm.issuedAt || undefined : undefined,
        expiresAt: datesSupported ? identityForm.expiresAt || undefined : undefined,
      },
      {
        requireDocumentNumber: !identityForm.id || typeChanged,
        requireIssuingCountry: !identityForm.id || typeChanged || countryChanged || numberProvided,
      },
    );
    if (
      typeChanged &&
      isNigeriaIdentityType(identityForm.type) &&
      (original?.issuedAt || original?.expiresAt)
    ) {
      validationErrors.type =
        'Remove existing issue and expiry dates in a separate correction before switching to BVN or NIN.';
    }
    if (!getIdentityDocumentTypes(customerType).some((type) => type === identityForm.type)) {
      validationErrors.type = 'Choose a document type supported for this customer type.';
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('Correct the highlighted identity-document fields before saving.');
      return;
    }

    const body: Record<string, unknown> = {};
    if (!identityForm.id) {
      Object.assign(body, {
        type: identityForm.type,
        documentNumber: normalizeCustomerText(identityForm.documentNumber),
        issuingCountry: normalizeIsoCountryCode(identityForm.issuingCountry),
      });
      if (datesSupported) {
        body.issuedAt = identityForm.issuedAt || null;
        body.expiresAt = identityForm.expiresAt || null;
      }
    } else {
      if (typeChanged) body.type = identityForm.type;
      if (numberProvided) body.documentNumber = normalizeCustomerText(identityForm.documentNumber);
      if (countryChanged)
        body.issuingCountry = normalizeIsoCountryCode(identityForm.issuingCountry);
      if (datesSupported && identityForm.issuedAt !== (original?.issuedAt?.slice(0, 10) ?? '')) {
        body.issuedAt = identityForm.issuedAt || null;
      }
      if (datesSupported && identityForm.expiresAt !== (original?.expiresAt?.slice(0, 10) ?? '')) {
        body.expiresAt = identityForm.expiresAt || null;
      }
    }
    if (Object.keys(body).length === 0) {
      setIdentityForm(null);
      setFieldErrors({});
      setNotice('No identity-document changes were needed.');
      setError(null);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (identityForm.id) {
        await ApiClient.patch(
          `/customers/${encodeURIComponent(customerId)}/identity-documents/${encodeURIComponent(identityForm.id)}`,
          body,
        );
      } else {
        await ApiClient.post(
          `/customers/${encodeURIComponent(customerId)}/identity-document`,
          body,
        );
      }
      setIdentityForm(null);
      setFieldErrors({});
      setNotice(
        'Identity metadata saved. The document number remains masked and is not included in audit metadata.',
      );
      refresh();
    } catch (saveError) {
      setFieldErrors(fieldErrorsFrom(saveError, 'documentNumber'));
      setError(messageFor(saveError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const startAddressEdit = (address?: AddressRecord) => {
    setFieldErrors({});
    setAddressId(address?.id ?? null);
    setAddressForm(
      address
        ? {
            type: address.type,
            lineOne: address.lineOne,
            lineTwo: address.lineTwo ?? '',
            city: address.city,
            state: address.state,
            country: address.country,
            postalCode: address.postalCode ?? '',
            isPrimary: address.isPrimary,
          }
        : emptyAddress(),
    );
  };

  const startContactEdit = (contact?: ContactRecord) => {
    setFieldErrors({});
    setContactForm(
      contact
        ? {
            id: contact.id,
            type: contact.type,
            value: '',
            phoneCountry:
              contact.type === 'PHONE' && contact.value ? getPhoneCountry(contact.value) : 'NG',
            isPrimary: contact.isPrimary,
          }
        : { type: 'PHONE', value: '', phoneCountry: 'NG', isPrimary: true },
    );
  };

  const startIdentityEdit = (document?: IdentityRecord) => {
    setFieldErrors({});
    setIdentityForm(
      document
        ? {
            id: document.id,
            type: document.type,
            documentNumber: '',
            issuingCountry: isNigeriaIdentityType(document.type)
              ? 'NG'
              : (normalizeIsoCountryCode(document.issuingCountry) ?? document.issuingCountry),
            issuedAt: document.issuedAt?.slice(0, 10) ?? '',
            expiresAt: document.expiresAt?.slice(0, 10) ?? '',
          }
        : {
            id: undefined,
            type: customerType === 'BUSINESS' ? 'BUSINESS_REGISTRATION' : 'NIN',
            documentNumber: '',
            issuingCountry: 'NG',
            issuedAt: '',
            expiresAt: '',
          },
    );
  };

  if (loading)
    return (
      <div className="cm-panel cm-loading-panel">
        Loading authorized personal-information sections…
      </div>
    );

  return (
    <div className="cm-personal-grid">
      {error && (
        <div className="cm-error cm-card-wide" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="cm-notice cm-card-wide" role="status">
          {notice}
        </div>
      )}

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">PROFILE</p>
            <h2>Personal information</h2>
          </div>
          {canViewProfile && canWriteProfile && !profileEditing && (
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => {
                setProfileForm(profileFormFrom(profile));
                setFieldErrors({});
                setProfileEditing(true);
              }}
            >
              {profile ? 'Edit profile' : 'Add profile'}
            </button>
          )}
        </div>
        {!canViewProfile ? (
          <p className="cm-muted">Profile fields are restricted to authorized customer viewers.</p>
        ) : profileEditing ? (
          <form className="cm-editor-form" noValidate onSubmit={saveProfile}>
            <div className="cm-wizard-field-grid">
              <label htmlFor="c360-display-name">
                Display name <span className="cm-required-indicator">Required</span>
                <input
                  id="c360-display-name"
                  value={profileForm.displayName}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, displayName: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  aria-describedby={fieldErrors.displayName ? 'c360-display-name-error' : undefined}
                />
                <CustomerFieldError
                  id="c360-display-name-error"
                  message={fieldErrors.displayName}
                />
              </label>
              <label htmlFor="c360-legal-name">
                Legal name{' '}
                {customerType === 'BUSINESS' && !profile ? (
                  <span className="cm-required-indicator">Required for a new business profile</span>
                ) : (
                  <span className="cm-optional-indicator">Optional</span>
                )}
                <input
                  id="c360-legal-name"
                  value={profileForm.legalName}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, legalName: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.legalName)}
                  aria-describedby={fieldErrors.legalName ? 'c360-legal-name-error' : undefined}
                />
                <CustomerFieldError id="c360-legal-name-error" message={fieldErrors.legalName} />
              </label>
              {customerType === 'INDIVIDUAL' && (
                <>
                  <label htmlFor="c360-first-name">
                    First name <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-first-name"
                      value={profileForm.firstName}
                      onChange={(event) =>
                        setProfileForm({ ...profileForm, firstName: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.firstName)}
                      aria-describedby={fieldErrors.firstName ? 'c360-first-name-error' : undefined}
                    />
                    <CustomerFieldError
                      id="c360-first-name-error"
                      message={fieldErrors.firstName}
                    />
                  </label>
                  <label htmlFor="c360-middle-name">
                    Middle name <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-middle-name"
                      value={profileForm.middleName}
                      onChange={(event) =>
                        setProfileForm({ ...profileForm, middleName: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.middleName)}
                      aria-describedby={
                        fieldErrors.middleName ? 'c360-middle-name-error' : undefined
                      }
                    />
                    <CustomerFieldError
                      id="c360-middle-name-error"
                      message={fieldErrors.middleName}
                    />
                  </label>
                  <label htmlFor="c360-last-name">
                    Last name <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-last-name"
                      value={profileForm.lastName}
                      onChange={(event) =>
                        setProfileForm({ ...profileForm, lastName: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.lastName)}
                      aria-describedby={fieldErrors.lastName ? 'c360-last-name-error' : undefined}
                    />
                    <CustomerFieldError id="c360-last-name-error" message={fieldErrors.lastName} />
                  </label>
                  <label htmlFor="c360-date-of-birth">
                    Date of birth <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-date-of-birth"
                      type="date"
                      max={getCustomerCalendarDate()}
                      value={profileForm.dateOfBirth}
                      onChange={(event) =>
                        setProfileForm({ ...profileForm, dateOfBirth: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.dateOfBirth)}
                      aria-describedby={
                        fieldErrors.dateOfBirth ? 'c360-date-of-birth-error' : undefined
                      }
                    />
                    <CustomerFieldError
                      id="c360-date-of-birth-error"
                      message={fieldErrors.dateOfBirth}
                    />
                  </label>
                  <CustomerCountrySelect
                    id="c360-nationality"
                    label="Nationality"
                    value={profileForm.nationality}
                    onChange={(value) => setProfileForm({ ...profileForm, nationality: value })}
                    allowEmpty
                    error={fieldErrors.nationality}
                  />
                </>
              )}
            </div>
            {customerType === 'BUSINESS' && (
              <p className="cm-form-help">
                Individual name, date-of-birth, and nationality fields are not edited on a business
                profile. Existing legacy values are left unchanged.
              </p>
            )}
            {!canWriteProfile && (
              <p className="cm-muted">This role may view but cannot correct profile information.</p>
            )}
            <div className="cm-actions-row">
              <button
                className="cm-button cm-button-primary"
                type="submit"
                disabled={busy || !canWriteProfile}
              >
                {busy ? 'Saving…' : 'Save profile'}
              </button>
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => {
                  setProfileEditing(false);
                  setFieldErrors({});
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : profile ? (
          <dl className="cm-detail-grid">
            <div>
              <dt>Display name</dt>
              <dd>{profile.displayName || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Legal name</dt>
              <dd>{profile.legalName || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>First name</dt>
              <dd>{profile.firstName || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Middle name</dt>
              <dd>{profile.middleName || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Last name</dt>
              <dd>{profile.lastName || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{profile.dateOfBirth || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Nationality</dt>
              <dd>{countryNameForCode(profile.nationality)}</dd>
            </div>
          </dl>
        ) : profileStatus === 404 ? (
          <p className="cm-empty-state">No profile is recorded yet.</p>
        ) : (
          <p className="cm-muted">Profile information could not be loaded.</p>
        )}
        {!canWriteProfile && canViewProfile && (
          <p className="cm-muted">
            Profile corrections require <code>customer.create</code>.
          </p>
        )}
      </article>

      <article className="cm-card">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">CONTACT METHODS</p>
            <h2>Phones and email</h2>
          </div>
          <div className="cm-editor-actions">
            {canViewContacts && contacts?.some((contact) => Boolean(contact.value)) ? (
              <button
                className="cm-text-button"
                type="button"
                aria-pressed={showContactValues}
                onClick={() => setShowContactValues((value) => !value)}
              >
                {showContactValues ? 'Mask values' : 'Show values'}
              </button>
            ) : null}
            {canWriteContacts && (
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => startContactEdit()}
              >
                Add contact
              </button>
            )}
          </div>
        </div>
        {!canViewContacts ? (
          <p className="cm-muted">
            Contact details are restricted to authorized contact-method viewers.
          </p>
        ) : contacts?.length ? (
          <ul className="cm-record-list">
            {contacts.map((contact) => (
              <li className="cm-managed-record" key={contact.id}>
                <div>
                  <strong>{contact.type}</strong>
                  <span className="cm-secondary-line">
                    {contact.isPrimary ? 'Primary' : 'Additional'} ·{' '}
                    {contact.verifiedAt ? 'Verified' : 'Not verified'}
                  </span>
                  <span className="cm-managed-value">
                    {showContactValues && contact.value
                      ? contact.value
                      : (contact.maskedValue ?? maskContactValue(contact.value ?? ''))}
                  </span>
                </div>
                <div className="cm-record-actions">
                  {canWriteContacts && (
                    <button
                      className="cm-text-button"
                      type="button"
                      onClick={() => startContactEdit(contact)}
                    >
                      Edit
                    </button>
                  )}
                  {canWriteContacts &&
                    contact.type === 'PHONE' &&
                    !contact.verifiedAt &&
                    verifyContactId !== contact.id &&
                    (!contact.value ? (
                      <span className="cm-secondary-line">
                        Phone value is masked; OTP cannot be requested from this view.
                      </span>
                    ) : getPhoneCountry(contact.value) === 'NG' ? (
                      <button
                        className="cm-text-button"
                        type="button"
                        onClick={() => void requestOtp(contact)}
                        disabled={busy}
                      >
                        Verify phone
                      </button>
                    ) : (
                      <span className="cm-secondary-line">Current OTP flow is Nigeria-only</span>
                    ))}
                </div>
                {verifyContactId === contact.id && otpRequested && (
                  <form className="cm-otp-form cm-contact-otp" noValidate onSubmit={verifyPhone}>
                    <label htmlFor="c360-otp-code">
                      One-time code
                      <input
                        id="c360-otp-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={8}
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))}
                        aria-invalid={Boolean(fieldErrors.code)}
                        aria-describedby={fieldErrors.code ? 'c360-otp-code-error' : undefined}
                      />
                      <CustomerFieldError id="c360-otp-code-error" message={fieldErrors.code} />
                    </label>
                    <button
                      className="cm-button cm-button-primary"
                      type="submit"
                      disabled={busy || otpCode.length < 4}
                    >
                      {busy
                        ? 'Verifying…'
                        : verificationToken
                          ? 'Retry verification save'
                          : 'Verify phone'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : contactStatus === 404 || contacts?.length === 0 ? (
          <p className="cm-empty-state">No phone number or email is recorded.</p>
        ) : (
          <p className="cm-muted">Contact information could not be loaded.</p>
        )}
        {canViewContacts && !canWriteContacts && (
          <p className="cm-muted">
            Contact corrections require <code>customer.create</code>.
          </p>
        )}
        {contactForm && canWriteContacts && (
          <form className="cm-editor-form" noValidate onSubmit={saveContact}>
            <h3>{contactForm.id ? 'Edit contact method' : 'Add contact method'}</h3>
            <div className="cm-wizard-field-grid">
              <label htmlFor="c360-contact-type">
                Type
                <select
                  id="c360-contact-type"
                  value={contactForm.type}
                  onChange={(event) =>
                    setContactForm({ ...contactForm, type: event.target.value as ContactType })
                  }
                  disabled={Boolean(contactForm.id)}
                  aria-invalid={Boolean(fieldErrors.type)}
                  aria-describedby={fieldErrors.type ? 'c360-contact-type-error' : undefined}
                >
                  <option value="PHONE">Phone</option>
                  <option value="EMAIL">Email</option>
                </select>
                <CustomerFieldError id="c360-contact-type-error" message={fieldErrors.type} />
              </label>
              {contactForm.type === 'PHONE' ? (
                <CustomerPhoneField
                  id="c360-contact-phone"
                  label="Phone number"
                  value={contactForm.value}
                  country={contactForm.phoneCountry}
                  onChange={(value) => setContactForm({ ...contactForm, value })}
                  onCountryChange={(value) =>
                    setContactForm({ ...contactForm, phoneCountry: value })
                  }
                  error={fieldErrors.phone ?? fieldErrors.value}
                  required
                  helpText={
                    contactForm.id
                      ? 'The API masks saved values. Leave this blank to retain the current number; enter a replacement only when changing it. A replacement clears old verification proof. The existing OTP flow is Nigerian-phone only.'
                      : 'The existing OTP flow is Nigerian-phone only; an international phone can be recorded but not verified through this flow.'
                  }
                />
              ) : (
                <label htmlFor="c360-contact-email">
                  Email address{' '}
                  {contactForm.id && (
                    <span className="cm-optional-indicator">Leave blank to retain current</span>
                  )}
                  <input
                    id="c360-contact-email"
                    type="email"
                    autoComplete="email"
                    value={contactForm.value}
                    onChange={(event) =>
                      setContactForm({ ...contactForm, value: event.target.value })
                    }
                    aria-invalid={Boolean(fieldErrors.email ?? fieldErrors.value)}
                    aria-describedby={
                      fieldErrors.email || fieldErrors.value
                        ? 'c360-contact-email-error'
                        : undefined
                    }
                  />
                  <CustomerFieldError
                    id="c360-contact-email-error"
                    message={fieldErrors.email ?? fieldErrors.value}
                  />
                </label>
              )}
              <label className="cm-checkbox-label">
                <input
                  type="checkbox"
                  checked={contactForm.isPrimary}
                  onChange={(event) =>
                    setContactForm({ ...contactForm, isPrimary: event.target.checked })
                  }
                />{' '}
                Mark as primary
              </label>
            </div>
            <div className="cm-actions-row">
              <button className="cm-button cm-button-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save contact'}
              </button>
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => {
                  setContactForm(null);
                  setFieldErrors({});
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </article>

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">ADDRESSES</p>
            <h2>Residential and mailing addresses</h2>
          </div>
          {canWriteAddress && (
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => startAddressEdit()}
            >
              Add address
            </button>
          )}
        </div>
        {!canViewAddress ? (
          <p className="cm-muted">Address details are restricted to authorized address viewers.</p>
        ) : addresses?.length ? (
          <div className="cm-address-grid">
            {addresses.map((address) => (
              <div className="cm-address-item" key={address.id}>
                <div className="cm-address-title">
                  <strong>{address.type}</strong>
                  {address.isPrimary && <span className="cm-chip">Primary</span>}
                  {canWriteAddress && (
                    <button
                      className="cm-text-button"
                      type="button"
                      onClick={() => startAddressEdit(address)}
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p>
                  {address.lineOne}
                  {address.lineTwo ? `, ${address.lineTwo}` : ''}
                </p>
                <p>
                  {address.city}, {address.state} {address.postalCode || ''}
                </p>
                <p>{countryNameForCode(address.country)}</p>
              </div>
            ))}
          </div>
        ) : addressStatus === 404 || addresses?.length === 0 ? (
          <p className="cm-empty-state">No address is recorded.</p>
        ) : (
          <p className="cm-muted">Address information could not be loaded.</p>
        )}
        {canViewAddress && !canWriteAddress && (
          <p className="cm-muted">
            Address corrections require <code>customer.create</code>.
          </p>
        )}
        {addressForm && canWriteAddress && (
          <form className="cm-editor-form" noValidate onSubmit={saveAddress}>
            <h3>{addressId ? 'Edit address' : 'Add address'}</h3>
            <div className="cm-wizard-field-grid">
              <label htmlFor="c360-address-type">
                Address type
                <select
                  id="c360-address-type"
                  value={addressForm.type}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, type: event.target.value as AddressType })
                  }
                  aria-invalid={Boolean(fieldErrors.type)}
                  aria-describedby={fieldErrors.type ? 'c360-address-type-error' : undefined}
                >
                  <option value="RESIDENTIAL">Residential</option>
                  <option value="BUSINESS">Business</option>
                  <option value="MAILING">Mailing</option>
                </select>
                <CustomerFieldError id="c360-address-type-error" message={fieldErrors.type} />
              </label>
              <label htmlFor="c360-address-line-one">
                Address line 1
                <input
                  id="c360-address-line-one"
                  value={addressForm.lineOne}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, lineOne: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.lineOne)}
                  aria-describedby={fieldErrors.lineOne ? 'c360-address-line-one-error' : undefined}
                />
                <CustomerFieldError
                  id="c360-address-line-one-error"
                  message={fieldErrors.lineOne}
                />
              </label>
              <label htmlFor="c360-address-line-two">
                Address line 2
                <input
                  id="c360-address-line-two"
                  value={addressForm.lineTwo}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, lineTwo: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.lineTwo)}
                  aria-describedby={fieldErrors.lineTwo ? 'c360-address-line-two-error' : undefined}
                />
                <CustomerFieldError
                  id="c360-address-line-two-error"
                  message={fieldErrors.lineTwo}
                />
              </label>
              <label htmlFor="c360-address-city">
                City
                <input
                  id="c360-address-city"
                  value={addressForm.city}
                  onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })}
                  aria-invalid={Boolean(fieldErrors.city)}
                  aria-describedby={fieldErrors.city ? 'c360-address-city-error' : undefined}
                />
                <CustomerFieldError id="c360-address-city-error" message={fieldErrors.city} />
              </label>
              <label htmlFor="c360-address-state">
                State / province
                <input
                  id="c360-address-state"
                  value={addressForm.state}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, state: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.state)}
                  aria-describedby={fieldErrors.state ? 'c360-address-state-error' : undefined}
                />
                <CustomerFieldError id="c360-address-state-error" message={fieldErrors.state} />
              </label>
              <CustomerCountrySelect
                id="c360-address-country"
                label="Country"
                value={addressForm.country}
                onChange={(value) => setAddressForm({ ...addressForm, country: value })}
                required
                error={fieldErrors.country}
              />
              <label htmlFor="c360-address-postal-code">
                Postal code <span className="cm-optional-indicator">Optional</span>
                <input
                  id="c360-address-postal-code"
                  value={addressForm.postalCode}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, postalCode: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.postalCode)}
                  aria-describedby={
                    fieldErrors.postalCode ? 'c360-address-postal-code-error' : undefined
                  }
                />
                <CustomerFieldError
                  id="c360-address-postal-code-error"
                  message={fieldErrors.postalCode}
                />
              </label>
              <label className="cm-checkbox-label">
                <input
                  type="checkbox"
                  checked={addressForm.isPrimary}
                  onChange={(event) =>
                    setAddressForm({ ...addressForm, isPrimary: event.target.checked })
                  }
                />{' '}
                Mark as primary
              </label>
            </div>
            <p className="cm-form-help">
              Equivalent duplicate addresses of the same type are rejected. Postal-code validation
              uses the selected country’s rule where available.
            </p>
            <div className="cm-actions-row">
              <button className="cm-button cm-button-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save address'}
              </button>
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => {
                  setAddressForm(null);
                  setAddressId(null);
                  setFieldErrors({});
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </article>

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div>
            <p className="cm-eyebrow">IDENTITY DOCUMENTS</p>
            <h2>Supported identity metadata</h2>
          </div>
          {canWriteIdentity && (
            <button
              className="cm-button cm-button-secondary"
              type="button"
              onClick={() => startIdentityEdit()}
            >
              Add document
            </button>
          )}
        </div>
        {!canViewIdentity ? (
          <p className="cm-muted">
            Identity data is restricted to roles with <code>customer.view_identity_documents</code>.
          </p>
        ) : identityDocuments?.length ? (
          <ul className="cm-record-list">
            {identityDocuments.map((document) => (
              <li key={document.id}>
                <div>
                  <strong>{document.type.replaceAll('_', ' ')}</strong>
                  <span className="cm-secondary-line">
                    Issuing country: {countryNameForCode(document.issuingCountry)}
                    {supportsIdentityDates(document.type) && (
                      <>
                        {' · '}
                        {document.issuedAt
                          ? `Issued ${document.issuedAt}`
                          : 'Issue date not recorded'}
                        {' · '}
                        {document.expiresAt
                          ? `Expires ${document.expiresAt}`
                          : 'No expiry recorded'}
                      </>
                    )}
                  </span>
                </div>
                <div className="cm-record-actions">
                  <span className="cm-record-value">{document.maskedDocumentNumber}</span>
                  {canWriteIdentity && (
                    <button
                      className="cm-text-button"
                      type="button"
                      onClick={() => startIdentityEdit(document)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : identityStatus === 404 || identityDocuments?.length === 0 ? (
          <p className="cm-empty-state">No identity document is recorded.</p>
        ) : (
          <p className="cm-muted">Identity documents could not be loaded.</p>
        )}
        {canViewIdentity && !canWriteIdentity && (
          <p className="cm-muted">
            Identity corrections require <code>kyc.review</code>.
          </p>
        )}
        {identityForm && canWriteIdentity && (
          <form className="cm-editor-form" noValidate onSubmit={saveIdentity}>
            <h3>{identityForm.id ? 'Correct identity metadata' : 'Add identity metadata'}</h3>
            <div className="cm-wizard-field-grid">
              <label htmlFor="c360-identity-type">
                Document type
                <select
                  id="c360-identity-type"
                  value={identityForm.type}
                  onChange={(event) => {
                    const type = event.target.value as IdentityType;
                    setIdentityForm((current) =>
                      current
                        ? {
                            ...current,
                            type,
                            issuingCountry: isNigeriaIdentityType(type)
                              ? 'NG'
                              : current.issuingCountry,
                          }
                        : current,
                    );
                    setFieldErrors((current) => {
                      const remaining = { ...current };
                      delete remaining.type;
                      return remaining;
                    });
                  }}
                  aria-invalid={Boolean(fieldErrors.type)}
                  aria-describedby={fieldErrors.type ? 'c360-identity-type-error' : undefined}
                >
                  {getIdentityDocumentTypes(customerType).map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <CustomerFieldError id="c360-identity-type-error" message={fieldErrors.type} />
              </label>
              <label htmlFor="c360-document-number">
                Document number{' '}
                {identityForm.id ? (
                  <span className="cm-optional-indicator">Leave blank to keep current</span>
                ) : (
                  <span className="cm-required-indicator">Required</span>
                )}
                <input
                  id="c360-document-number"
                  type="password"
                  autoComplete="off"
                  value={identityForm.documentNumber}
                  onChange={(event) =>
                    setIdentityForm({ ...identityForm, documentNumber: event.target.value })
                  }
                  required={!identityForm.id}
                  aria-invalid={Boolean(fieldErrors.documentNumber)}
                  aria-describedby={
                    fieldErrors.documentNumber ? 'c360-document-number-error' : undefined
                  }
                />
                <CustomerFieldError
                  id="c360-document-number-error"
                  message={fieldErrors.documentNumber}
                />
              </label>
              <CustomerCountrySelect
                id="c360-identity-country"
                label="Issuing country"
                value={identityForm.issuingCountry}
                onChange={(value) => setIdentityForm({ ...identityForm, issuingCountry: value })}
                required
                disabled={isNigeriaIdentityType(identityForm.type)}
                error={fieldErrors.issuingCountry}
              />
              {supportsIdentityDates(identityForm.type) && (
                <>
                  <label htmlFor="c360-identity-issued-at">
                    Issue date <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-identity-issued-at"
                      type="date"
                      max={getCustomerCalendarDate()}
                      value={identityForm.issuedAt}
                      onChange={(event) =>
                        setIdentityForm({ ...identityForm, issuedAt: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.issuedAt)}
                      aria-describedby={
                        fieldErrors.issuedAt ? 'c360-identity-issued-at-error' : undefined
                      }
                    />
                    <CustomerFieldError
                      id="c360-identity-issued-at-error"
                      message={fieldErrors.issuedAt}
                    />
                  </label>
                  <label htmlFor="c360-identity-expires-at">
                    Expiry date <span className="cm-optional-indicator">Optional</span>
                    <input
                      id="c360-identity-expires-at"
                      type="date"
                      min={identityForm.issuedAt || undefined}
                      value={identityForm.expiresAt}
                      onChange={(event) =>
                        setIdentityForm({ ...identityForm, expiresAt: event.target.value })
                      }
                      aria-invalid={Boolean(fieldErrors.expiresAt)}
                      aria-describedby={
                        fieldErrors.expiresAt ? 'c360-identity-expires-at-error' : undefined
                      }
                    />
                    <CustomerFieldError
                      id="c360-identity-expires-at-error"
                      message={fieldErrors.expiresAt}
                    />
                  </label>
                </>
              )}
            </div>
            <p className="cm-form-help">
              Existing identity values are never returned to this form. A new value is optional
              during correction and will be masked in responses and audit records. Metadata entry
              does not verify an identity against an official source. BVN/NIN require exactly 11
              digits, Nigeria as issuing country, and no issue/expiry dates.
            </p>
            <div className="cm-actions-row">
              <button className="cm-button cm-button-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save identity details'}
              </button>
              <button
                className="cm-button cm-button-secondary"
                type="button"
                onClick={() => {
                  setIdentityForm(null);
                  setFieldErrors({});
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
};
