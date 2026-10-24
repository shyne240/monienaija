import React, { FormEvent, useEffect, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { maskContactValue } from './customer-masking';
import { CountrySelect, countryNameForCode, isNigeriaIdentityType, normalizeCountryCode } from './CountrySelect';

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
  value: string;
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
  return type !== 'NIN' && type !== 'BVN';
}

interface CustomerPersonalInformationPanelProps {
  customerId: string;
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

const IDENTITY_TYPES: IdentityType[] = [
  'BVN',
  'NIN',
  'INTERNATIONAL_PASSPORT',
  'DRIVERS_LICENSE',
  'VOTERS_CARD',
  'BUSINESS_REGISTRATION',
];

function emptyProfile(): ProfileFormState {
  return { displayName: '', legalName: '', firstName: '', middleName: '', lastName: '', dateOfBirth: '', nationality: 'NG' };
}

function emptyAddress(): AddressFormState {
  return { type: 'RESIDENTIAL', lineOne: '', lineTwo: '', city: '', state: '', country: 'NG', postalCode: '', isPrimary: true };
}

function messageFor(error: unknown): string {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  if (status === 401) return 'Your workforce session has expired. Sign in again.';
  if (status === 403) return 'This action is not allowed for your current workforce role.';
  if (status === 400) return 'The API rejected one or more fields. Review the form and retry.';
  if (status === 404) return 'The requested customer data is no longer available.';
  if (status === 409) return 'A conflicting record already exists. Refresh the customer data and review it.';
  return 'The change could not be saved. Retry without leaving this page.';
}

async function safeGet<T>(path: string): Promise<ReadResult<T>> {
  try {
    return { value: await ApiClient.get<T>(path) };
  } catch (error) {
    return { value: null, status: error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : undefined };
  }
}

function normalizedPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return digits.slice(3);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

function profileFormFrom(profile: ProfileRecord | null): ProfileFormState {
  if (!profile) return emptyProfile();
  return {
    displayName: profile.displayName,
    legalName: profile.legalName ?? '',
    firstName: profile.firstName ?? '',
    middleName: profile.middleName ?? '',
    lastName: profile.lastName ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    nationality: normalizeCountryCode(profile.nationality),
  };
}

export const CustomerPersonalInformationPanel: React.FC<CustomerPersonalInformationPanelProps> = ({
  customerId,
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
  const [notice, setNotice] = useState<string | null>(null);
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
    setShowContactValues(false);
    const id = encodeURIComponent(customerId);
    const requests = Promise.all([
      canViewProfile ? safeGet<ProfileRecord>(`/customers/${id}/profile`) : Promise.resolve(null),
      canViewAddress ? safeGet<AddressRecord[]>(`/customers/${id}/addresses`) : Promise.resolve(null),
      canViewContacts ? safeGet<ContactRecord[]>(`/customers/${id}/contact-methods`) : Promise.resolve(null),
      canViewIdentity ? safeGet<IdentityRecord[]>(`/customers/${id}/identity-documents`) : Promise.resolve(null),
    ]);
    requests.then(([profileResult, addressResult, contactResult, identityResult]) => {
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
    }).catch(() => {
      if (!active) return;
      setError('Authorized personal-information sections could not be loaded.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [customerId, scopesKey, reloadVersion]);

  const refresh = () => setReloadVersion((value) => value + 1);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canWriteProfile || !canViewProfile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body = {
      displayName: profileForm.displayName.trim(),
      legalName: profileForm.legalName.trim() || null,
      firstName: profileForm.firstName.trim() || null,
      middleName: profileForm.middleName.trim() || null,
      lastName: profileForm.lastName.trim() || null,
      dateOfBirth: profileForm.dateOfBirth || null,
      nationality: normalizeCountryCode(profileForm.nationality) || null,
    };
    try {
      let saved: ProfileRecord;
      if (profile) {
        saved = await ApiClient.patch<ProfileRecord>(`/customers/${encodeURIComponent(customerId)}/profile`, body);
      } else {
        saved = await ApiClient.post<ProfileRecord>(`/customers/${encodeURIComponent(customerId)}/profile`, body);
      }
      setProfile(saved);
      setProfileForm(profileFormFrom(saved));
      setProfileEditing(false);
      onProfileUpdated({ displayName: saved.displayName, legalName: saved.legalName });
      setNotice('Personal information saved. Changes are audited without storing the submitted values in audit metadata.');
      refresh();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!addressForm || busy || !canWriteAddress) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body = {
      ...addressForm,
      lineOne: addressForm.lineOne.trim(),
      lineTwo: addressForm.lineTwo.trim() || null,
      city: addressForm.city.trim(),
      state: addressForm.state.trim(),
      country: normalizeCountryCode(addressForm.country),
      postalCode: addressForm.postalCode.trim() || null,
    };
    try {
      if (addressId) {
        await ApiClient.patch(`/customers/${encodeURIComponent(customerId)}/addresses/${encodeURIComponent(addressId)}`, body);
      } else {
        await ApiClient.post(`/customers/${encodeURIComponent(customerId)}/address`, body);
      }
      setAddressForm(null);
      setAddressId(null);
      setNotice('Address correction saved. Primary designation is enforced across this customer’s addresses.');
      refresh();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  };

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactForm || busy || !canWriteContacts) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = { value: contactForm.value.trim(), isPrimary: contactForm.isPrimary };
      const original = contacts?.find((contact) => contact.id === contactForm.id);
      const valuesMatch = original && (contactForm.type === 'PHONE'
        ? normalizedPhone(original.value) === normalizedPhone(body.value)
        : original.value.trim().toLowerCase() === body.value.toLowerCase());
      if (original && valuesMatch && original.isPrimary === contactForm.isPrimary) {
        setContactForm(null);
        setNotice('No contact changes were needed.');
        return;
      }
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
      setNotice('Contact correction saved. Changing a phone number clears its old verification status.');
      refresh();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = async (contact: ContactRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await ApiClient.post('/customers/registration/otp', { phone: contact.value });
      setVerifyContactId(contact.id);
      setVerifyPhoneValue(contact.value);
      setOtpRequested(true);
      setOtpCode('');
      setVerificationToken('');
      setNotice('OTP request accepted. Enter the one-time code sent to the phone number.');
    } catch (otpError) {
      setError(messageFor(otpError));
    } finally {
      setBusy(false);
    }
  };

  const verifyPhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verifyContactId || busy || !otpRequested) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let token = verificationToken;
      if (!token) {
        const result = await ApiClient.post<{ verificationToken: string }>(
          '/customers/registration/otp/verify',
          { phone: verifyPhoneValue, code: otpCode.trim() },
        );
        token = result.verificationToken;
        setVerificationToken(token);
      }
      const contact = contacts?.find((item) => item.id === verifyContactId);
      await ApiClient.patch(
        `/customers/${encodeURIComponent(customerId)}/contact-methods/${encodeURIComponent(verifyContactId)}`,
        { value: verifyPhoneValue, isPrimary: Boolean(contact?.isPrimary), verificationToken: token },
      );
      setOtpRequested(false);
      setOtpCode('');
      setVerificationToken('');
      setVerifyContactId(null);
      setNotice('Phone verified. The customer remains in its current lifecycle status.');
      onVerificationUpdated?.();
      refresh();
    } catch (verifyError) {
      setError(messageFor(verifyError));
    } finally {
      setBusy(false);
    }
  };

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identityForm || busy || !canWriteIdentity) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        type: identityForm.type,
        ...(identityForm.documentNumber.trim() ? { documentNumber: identityForm.documentNumber.trim() } : {}),
        issuingCountry: isNigeriaIdentityType(identityForm.type) ? 'NG' : normalizeCountryCode(identityForm.issuingCountry),
        ...(supportsIdentityDates(identityForm.type)
          ? { issuedAt: identityForm.issuedAt || null, expiresAt: identityForm.expiresAt || null }
          : {}),
      };
      if (identityForm.id) {
        await ApiClient.patch(
          `/customers/${encodeURIComponent(customerId)}/identity-documents/${encodeURIComponent(identityForm.id)}`,
          body,
        );
      } else {
        await ApiClient.post(`/customers/${encodeURIComponent(customerId)}/identity-document`, body);
      }
      setIdentityForm(null);
      setNotice('Identity metadata saved. The document number remains masked and is not included in audit metadata.');
      refresh();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  };

  const startAddressEdit = (address?: AddressRecord) => {
    setAddressId(address?.id ?? null);
    setAddressForm(address ? {
      type: address.type,
      lineOne: address.lineOne,
      lineTwo: address.lineTwo ?? '',
      city: address.city,
      state: address.state,
      country: normalizeCountryCode(address.country),
      postalCode: address.postalCode ?? '',
      isPrimary: address.isPrimary,
    } : emptyAddress());
  };

  const startContactEdit = (contact?: ContactRecord) => {
    setContactForm(contact
      ? { id: contact.id, type: contact.type, value: contact.value, isPrimary: contact.isPrimary }
      : { type: 'PHONE', value: '', isPrimary: true });
  };

  const startIdentityEdit = (document?: IdentityRecord) => {
    setIdentityForm(document
      ? {
          id: document.id,
          type: document.type,
          documentNumber: '',
          issuingCountry: isNigeriaIdentityType(document.type) ? 'NG' : normalizeCountryCode(document.issuingCountry),
          issuedAt: supportsIdentityDates(document.type) ? document.issuedAt ?? '' : '',
          expiresAt: supportsIdentityDates(document.type) ? document.expiresAt ?? '' : '',
        }
      : { id: undefined, type: 'NIN', documentNumber: '', issuingCountry: 'NG', issuedAt: '', expiresAt: '' });
  };

  if (loading) return <div className="cm-panel cm-loading-panel">Loading authorized personal-information sections…</div>;

  return (
    <div className="cm-personal-grid">
      {error && <div className="cm-error cm-card-wide" role="alert">{error}</div>}
      {notice && <div className="cm-notice cm-card-wide" role="status">{notice}</div>}

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div><p className="cm-eyebrow">PROFILE</p><h2>Personal information</h2></div>
          {canViewProfile && canWriteProfile && !profileEditing && (
            <button className="cm-button cm-button-secondary" type="button" onClick={() => { setProfileForm(profileFormFrom(profile)); setProfileEditing(true); }}>
              {profile ? 'Edit profile' : 'Add profile'}
            </button>
          )}
        </div>
        {!canViewProfile ? <p className="cm-muted">Profile fields are restricted to authorized customer viewers.</p>
          : profileEditing ? (
            <form className="cm-editor-form" onSubmit={saveProfile}>
              <div className="cm-wizard-field-grid">
                <label>Display name <span className="cm-required-indicator">Required</span><input maxLength={200} value={profileForm.displayName} onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })} required /></label>
                <label>Legal name <span className="cm-optional-indicator">Optional</span><input maxLength={200} value={profileForm.legalName} onChange={(event) => setProfileForm({ ...profileForm, legalName: event.target.value })} /></label>
                <label>First name <span className="cm-optional-indicator">Optional</span><input maxLength={100} value={profileForm.firstName} onChange={(event) => setProfileForm({ ...profileForm, firstName: event.target.value })} /></label>
                <label>Middle name <span className="cm-optional-indicator">Optional</span><input maxLength={100} value={profileForm.middleName} onChange={(event) => setProfileForm({ ...profileForm, middleName: event.target.value })} /></label>
                <label>Last name <span className="cm-optional-indicator">Optional</span><input maxLength={100} value={profileForm.lastName} onChange={(event) => setProfileForm({ ...profileForm, lastName: event.target.value })} /></label>
                <label>Date of birth <span className="cm-optional-indicator">Optional</span><input type="date" value={profileForm.dateOfBirth} onChange={(event) => setProfileForm({ ...profileForm, dateOfBirth: event.target.value })} /></label>
                <label htmlFor="c360-profile-nationality">
                  Nationality <span className="cm-optional-indicator">Optional</span>
                  <CountrySelect
                    inputId="c360-profile-nationality"
                    name="nationality"
                    value={profileForm.nationality}
                    onChange={(nationality) => setProfileForm({ ...profileForm, nationality })}
                    clearable
                    ariaLabel="Nationality"
                  />
                </label>
              </div>
              {!canWriteProfile && <p className="cm-muted">This role may view but cannot correct profile information.</p>}
              <div className="cm-actions-row"><button className="cm-button cm-button-primary" type="submit" disabled={busy || !canWriteProfile}>{busy ? 'Saving…' : 'Save profile'}</button><button className="cm-button cm-button-secondary" type="button" onClick={() => setProfileEditing(false)} disabled={busy}>Cancel</button></div>
            </form>
          ) : profile ? (
            <dl className="cm-detail-grid">
              <div><dt>Display name</dt><dd>{profile.displayName || 'Not recorded'}</dd></div>
              <div><dt>Legal name</dt><dd>{profile.legalName || 'Not recorded'}</dd></div>
              <div><dt>First name</dt><dd>{profile.firstName || 'Not recorded'}</dd></div>
              <div><dt>Middle name</dt><dd>{profile.middleName || 'Not recorded'}</dd></div>
              <div><dt>Last name</dt><dd>{profile.lastName || 'Not recorded'}</dd></div>
              <div><dt>Date of birth</dt><dd>{profile.dateOfBirth || 'Not recorded'}</dd></div>
              <div><dt>Nationality</dt><dd>{countryNameForCode(profile.nationality)}</dd></div>
            </dl>
          ) : profileStatus === 404 ? <p className="cm-empty-state">No profile is recorded yet.</p>
            : <p className="cm-muted">Profile information could not be loaded.</p>}
        {!canWriteProfile && canViewProfile && <p className="cm-muted">Profile corrections require <code>customer.create</code>.</p>}
      </article>

      <article className="cm-card">
        <div className="cm-card-heading">
          <div><p className="cm-eyebrow">CONTACT METHODS</p><h2>Phones and email</h2></div>
          <div className="cm-editor-actions">
            {canViewContacts && contacts?.length ? <button className="cm-text-button" type="button" aria-pressed={showContactValues} onClick={() => setShowContactValues((value) => !value)}>{showContactValues ? 'Mask values' : 'Show values'}</button> : null}
            {canWriteContacts && <button className="cm-button cm-button-secondary" type="button" onClick={() => startContactEdit()}>Add contact</button>}
          </div>
        </div>
        {!canViewContacts ? <p className="cm-muted">Contact details are restricted to authorized contact-method viewers.</p>
          : contacts?.length ? (
            <ul className="cm-record-list">
              {contacts.map((contact) => (
                <li className="cm-managed-record" key={contact.id}>
                  <div>
                    <strong>{contact.type}</strong>
                    <span className="cm-secondary-line">{contact.isPrimary ? 'Primary' : 'Additional'} · {contact.verifiedAt ? 'Verified' : 'Not verified'}</span>
                    <span className="cm-managed-value">{showContactValues ? contact.value : maskContactValue(contact.value)}</span>
                  </div>
                  <div className="cm-record-actions">
                    {canWriteContacts && <button className="cm-text-button" type="button" onClick={() => startContactEdit(contact)}>Edit</button>}
                    {canWriteContacts && contact.type === 'PHONE' && !contact.verifiedAt && verifyContactId !== contact.id && <button className="cm-text-button" type="button" onClick={() => void requestOtp(contact)} disabled={busy}>Verify phone</button>}
                  </div>
                  {verifyContactId === contact.id && otpRequested && (
                    <form className="cm-otp-form cm-contact-otp" onSubmit={verifyPhone}>
                      <label>One-time code<input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))} /></label>
                      <button className="cm-button cm-button-primary" type="submit" disabled={busy || otpCode.length < 4}>{busy ? 'Verifying…' : verificationToken ? 'Retry verification save' : 'Verify phone'}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : contactStatus === 404 || contacts?.length === 0 ? <p className="cm-empty-state">No phone number or email is recorded.</p>
            : <p className="cm-muted">Contact information could not be loaded.</p>}
        {canViewContacts && !canWriteContacts && <p className="cm-muted">Contact corrections require <code>customer.create</code>.</p>}
        {contactForm && canWriteContacts && (
          <form className="cm-editor-form" onSubmit={saveContact}>
            <h3>{contactForm.id ? 'Edit contact method' : 'Add contact method'}</h3>
            <div className="cm-wizard-field-grid">
              <label>Type<select value={contactForm.type} onChange={(event) => setContactForm({ ...contactForm, type: event.target.value as ContactType })} disabled={Boolean(contactForm.id)}><option value="PHONE">Phone</option><option value="EMAIL">Email</option></select></label>
              <label>{contactForm.type === 'PHONE' ? 'Phone number' : 'Email address'}<input type={contactForm.type === 'PHONE' ? 'tel' : 'email'} autoComplete={contactForm.type === 'PHONE' ? 'tel' : 'email'} maxLength={255} value={contactForm.value} onChange={(event) => setContactForm({ ...contactForm, value: event.target.value })} required /></label>
              <label className="cm-checkbox-label"><input type="checkbox" checked={contactForm.isPrimary} onChange={(event) => setContactForm({ ...contactForm, isPrimary: event.target.checked })} /> Mark as primary</label>
            </div>
            {contactForm.type === 'PHONE' && <p className="cm-form-help">A changed phone loses its previous verification proof. Save it first, then request an OTP to verify the new number.</p>}
            <div className="cm-actions-row"><button className="cm-button cm-button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button><button className="cm-button cm-button-secondary" type="button" onClick={() => setContactForm(null)} disabled={busy}>Cancel</button></div>
          </form>
        )}
      </article>

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div><p className="cm-eyebrow">ADDRESSES</p><h2>Residential and mailing addresses</h2></div>
          {canWriteAddress && <button className="cm-button cm-button-secondary" type="button" onClick={() => startAddressEdit()}>Add address</button>}
        </div>
        {!canViewAddress ? <p className="cm-muted">Address details are restricted to authorized address viewers.</p>
          : addresses?.length ? (
            <div className="cm-address-grid">
              {addresses.map((address) => (
                <div className="cm-address-item" key={address.id}>
                  <div className="cm-address-title"><strong>{address.type}</strong>{address.isPrimary && <span className="cm-chip">Primary</span>}{canWriteAddress && <button className="cm-text-button" type="button" onClick={() => startAddressEdit(address)}>Edit</button>}</div>
                  <p>{address.lineOne}{address.lineTwo ? `, ${address.lineTwo}` : ''}</p>
                  <p>{address.city}, {address.state} {address.postalCode || ''}</p>
                  <p>{countryNameForCode(address.country)}</p>
                </div>
              ))}
            </div>
          ) : addressStatus === 404 || addresses?.length === 0 ? <p className="cm-empty-state">No address is recorded.</p>
            : <p className="cm-muted">Address information could not be loaded.</p>}
        {canViewAddress && !canWriteAddress && <p className="cm-muted">Address corrections require <code>customer.create</code>.</p>}
        {addressForm && canWriteAddress && (
          <form className="cm-editor-form" onSubmit={saveAddress}>
            <h3>{addressId ? 'Edit address' : 'Add address'}</h3>
            <div className="cm-wizard-field-grid">
              <label>Address type<select value={addressForm.type} onChange={(event) => setAddressForm({ ...addressForm, type: event.target.value as AddressType })}><option value="RESIDENTIAL">Residential</option><option value="BUSINESS">Business</option><option value="MAILING">Mailing</option></select></label>
              <label>Address line 1<input maxLength={200} value={addressForm.lineOne} onChange={(event) => setAddressForm({ ...addressForm, lineOne: event.target.value })} required /></label>
              <label>Address line 2<input maxLength={200} value={addressForm.lineTwo} onChange={(event) => setAddressForm({ ...addressForm, lineTwo: event.target.value })} /></label>
              <label>City<input maxLength={100} value={addressForm.city} onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })} required /></label>
              <label>State / province<input maxLength={100} value={addressForm.state} onChange={(event) => setAddressForm({ ...addressForm, state: event.target.value })} required /></label>
              <label htmlFor="c360-address-country">
                Country <span className="cm-required-indicator">Required</span>
                <CountrySelect
                  inputId="c360-address-country"
                  name="country"
                  value={addressForm.country}
                  onChange={(country) => setAddressForm({ ...addressForm, country })}
                  required
                  ariaLabel="Country"
                />
              </label>
              <label>Postal code<input maxLength={20} value={addressForm.postalCode} onChange={(event) => setAddressForm({ ...addressForm, postalCode: event.target.value })} /></label>
              <label className="cm-checkbox-label"><input type="checkbox" checked={addressForm.isPrimary} onChange={(event) => setAddressForm({ ...addressForm, isPrimary: event.target.checked })} /> Mark as primary</label>
            </div>
            <div className="cm-actions-row"><button className="cm-button cm-button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button><button className="cm-button cm-button-secondary" type="button" onClick={() => { setAddressForm(null); setAddressId(null); }} disabled={busy}>Cancel</button></div>
          </form>
        )}
      </article>

      <article className="cm-card cm-card-wide">
        <div className="cm-card-heading">
          <div><p className="cm-eyebrow">IDENTITY DOCUMENTS</p><h2>Supported identity metadata</h2></div>
          {canWriteIdentity && <button className="cm-button cm-button-secondary" type="button" onClick={() => startIdentityEdit()}>Add document</button>}
        </div>
        {!canViewIdentity ? <p className="cm-muted">Identity data is restricted to roles with <code>customer.view_identity_documents</code>.</p>
          : identityDocuments?.length ? (
            <ul className="cm-record-list">
              {identityDocuments.map((document) => (
                <li key={document.id}>
                  <div>
                    <strong>{document.type.replaceAll('_', ' ')}</strong>
                    <span className="cm-secondary-line">
                      Issuing country: {countryNameForCode(document.issuingCountry)}
                      {supportsIdentityDates(document.type)
                        ? ` · ${document.issuedAt ? `Issued ${document.issuedAt}` : 'Issue date not recorded'} · ${document.expiresAt ? `Expires ${document.expiresAt}` : 'No expiry recorded'}`
                        : ' · Issue and expiry dates are not applicable'}
                    </span>
                  </div>
                  <div className="cm-record-actions"><span className="cm-record-value">{document.maskedDocumentNumber}</span>{canWriteIdentity && <button className="cm-text-button" type="button" onClick={() => startIdentityEdit(document)}>Edit</button>}</div>
                </li>
              ))}
            </ul>
          ) : identityStatus === 404 || identityDocuments?.length === 0 ? <p className="cm-empty-state">No identity document is recorded.</p>
            : <p className="cm-muted">Identity documents could not be loaded.</p>}
        {canViewIdentity && !canWriteIdentity && <p className="cm-muted">Identity corrections require <code>kyc.review</code>.</p>}
        {identityForm && canWriteIdentity && (
          <form className="cm-editor-form" onSubmit={saveIdentity}>
            <h3>{identityForm.id ? 'Correct identity metadata' : 'Add identity metadata'}</h3>
            <div className="cm-wizard-field-grid">
              <label>Document type<select value={identityForm.type} onChange={(event) => {
                const type = event.target.value as IdentityType;
                setIdentityForm({
                  ...identityForm,
                  type,
                  issuingCountry: isNigeriaIdentityType(type) ? 'NG' : identityForm.issuingCountry || 'NG',
                  issuedAt: supportsIdentityDates(type) ? identityForm.issuedAt : '',
                  expiresAt: supportsIdentityDates(type) ? identityForm.expiresAt : '',
                });
              }}>{IDENTITY_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
              <label>Document number {identityForm.id ? <span className="cm-optional-indicator">Leave blank to keep current</span> : <span className="cm-required-indicator">Required</span>}<input type="password" autoComplete="off" maxLength={160} value={identityForm.documentNumber} onChange={(event) => setIdentityForm({ ...identityForm, documentNumber: event.target.value })} required={!identityForm.id} /></label>
              <label htmlFor="c360-identity-country">
                Issuing country
                {isNigeriaIdentityType(identityForm.type)
                  ? <span className="cm-optional-indicator">Read-only · Nigeria (NG) for NIN/BVN</span>
                  : <span className="cm-required-indicator">Required</span>}
                <CountrySelect
                  inputId="c360-identity-country"
                  name="issuingCountry"
                  value={isNigeriaIdentityType(identityForm.type) ? 'NG' : identityForm.issuingCountry}
                  ariaLabel="Issuing country"
                  onChange={(issuingCountry) => setIdentityForm({ ...identityForm, issuingCountry })}
                  required
                  disabled={isNigeriaIdentityType(identityForm.type)}
                />
              </label>
              {supportsIdentityDates(identityForm.type) && <>
                <label>Issue date <span className="cm-optional-indicator">Optional</span><input type="date" value={identityForm.issuedAt} onChange={(event) => setIdentityForm({ ...identityForm, issuedAt: event.target.value })} /></label>
                <label>Expiry date <span className="cm-optional-indicator">Optional</span><input type="date" value={identityForm.expiresAt} onChange={(event) => setIdentityForm({ ...identityForm, expiresAt: event.target.value })} /></label>
              </>}
            </div>
            <p className="cm-form-help">Existing identity values are never returned to this form. A new value is optional during correction and will be masked in responses and audit records.</p>
            <div className="cm-actions-row"><button className="cm-button cm-button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save identity details'}</button><button className="cm-button cm-button-secondary" type="button" onClick={() => setIdentityForm(null)} disabled={busy}>Cancel</button></div>
          </form>
        )}
      </article>
    </div>
  );
};
