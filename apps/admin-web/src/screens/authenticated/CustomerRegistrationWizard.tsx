import React, { FormEvent, useMemo, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

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

interface CustomerRegistrationWizardProps {
  onClose: () => void;
  onCustomerCreated: (customer: CreatedCustomer) => void;
  onOpenCustomer: (customerId: string) => void;
}

const STEPS = ['Customer details', 'Contact & verification', 'Residential address', 'Identity document'];
const IDENTITY_TYPES: IdentityType[] = [
  'BVN',
  'NIN',
  'INTERNATIONAL_PASSPORT',
  'DRIVERS_LICENSE',
  'VOTERS_CARD',
  'BUSINESS_REGISTRATION',
];

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
  if (status === 409) return 'A conflicting record already exists. Review the saved customer details before retrying.';
  if (status === 400) return 'Some details are invalid. Check the required fields and try again.';
  return 'The information could not be saved. Your draft data is still on this screen; retry safely.';
}

function canonicalUiPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return digits.slice(3);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
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
  const [customerType, setCustomerType] = useState<CustomerType>('INDIVIDUAL');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameEdited, setDisplayNameEdited] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('NG');

  const [phone, setPhone] = useState('');
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

  const [identityType, setIdentityType] = useState<IdentityType>('NIN');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuingCountry, setIssuingCountry] = useState('NG');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [identityDocument, setIdentityDocument] = useState<IdentityRecord | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const progress = useMemo(() => (step >= STEPS.length ? 'Complete' : `${step + 1} of ${STEPS.length}`), [step]);
  const derivedDisplayName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
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

      const profile = {
        displayName: displayName.trim() || derivedDisplayName,
        firstName: firstName.trim() || undefined,
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        legalName: legalName.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        nationality: nationality.trim().toUpperCase() || undefined,
      };
      if (!profile.displayName) {
        setError('Enter a display name, or enter a first or last name to create one automatically.');
        return;
      }

      try {
        await ApiClient.patch(`/customers/${encodeURIComponent(savedCustomer.id)}/profile`, profile);
      } catch (updateError) {
        if (requestStatus(updateError) !== 404) throw updateError;
        try {
          await ApiClient.post(`/customers/${encodeURIComponent(savedCustomer.id)}/profile`, profile);
        } catch (createError) {
          if (requestStatus(createError) !== 409) throw createError;
          await ApiClient.patch(`/customers/${encodeURIComponent(savedCustomer.id)}/profile`, profile);
        }
      }
      setDisplayName(profile.displayName);
      setDisplayNameEdited(true);
      setNotice('Customer profile saved. The record remains DRAFT.');
      setStep(1);
    } catch (saveError) {
      setError(safeSaveError(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const recoverContacts = async (customerId: string): Promise<ContactRecord[]> => {
    try {
      const records = await ApiClient.get<ContactRecord[]>(`/customers/${encodeURIComponent(customerId)}/contact-methods`);
      return records.map((contact) => {
        const rawValue = contact.value ?? '';
        const digits = rawValue.replace(/\\D/g, '');
        const maskedValue = contact.type === 'PHONE'
          ? `+234*****${digits.slice(-4)}`
          : (() => {
              const [local, domain] = rawValue.split('@');
              return local && domain ? `${local[0] ?? ''}•••@${domain}` : '••••';
            })();
        return { ...contact, maskedValue, value: rawValue };
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
  ): Promise<ContactRecord> => {
    const body = { value: value.trim(), isPrimary };
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
        const normalized = type === 'PHONE' ? canonicalUiPhone(value) : value.trim().toLowerCase();
        const matched = existing.find((contact) => {
          if (contact.type !== type) return false;
          const stored = type === 'PHONE'
            ? canonicalUiPhone(contact.value ?? '')
            : (contact.value ?? '').trim().toLowerCase();
          return stored === normalized;
        });
        if (matched) return matched;
      }
      throw saveError;
    }
  };

  const saveContacts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer || isSaving) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const phoneChanged = persistedPhone !== phone.trim();
      const savedPhone = phoneContact && !phoneChanged && phoneContact.isPrimary
        ? phoneContact
        : await saveContact(customer.id, 'PHONE', phone, true, phoneContact);
      setPhoneContact(savedPhone);
      setPersistedPhone(phone.trim());
      if (email.trim()) {
        const savedEmail = emailContact && persistedEmail === email.trim()
          ? emailContact
          : await saveContact(customer.id, 'EMAIL', email, false, emailContact);
        setEmailContact(savedEmail);
        setPersistedEmail(email.trim());
      }
      if (phoneChanged) {
        setOtpRequested(false);
        setOtpCode('');
        setVerificationToken('');
      }
      setNotice('Contact details saved. Phone verification is separate from customer activation.');
    } catch (saveError) {
      setError(safeSaveError(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const requestPhoneOtp = async () => {
    if (!customer || !phoneContact || persistedPhone !== phone.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await ApiClient.post('/customers/registration/otp', { phone: phone.trim() });
      setOtpRequested(true);
      setOtpCode('');
      setVerificationToken('');
      setNotice('OTP request accepted. Enter the code sent to the saved phone number.');
    } catch (otpError) {
      setError(safeSaveError(otpError));
    } finally {
      setIsSaving(false);
    }
  };

  const verifyPhone = async () => {
    if (!customer || !phoneContact || isSaving || !otpRequested) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      let token = verificationToken;
      if (!token) {
        const verified = await ApiClient.post<{ verificationToken: string }>(
          '/customers/registration/otp/verify',
          { phone: phone.trim(), code: otpCode.trim() },
        );
        token = verified.verificationToken;
        setVerificationToken(token);
      }
      const updated = await ApiClient.patch<ContactRecord>(
        `/customers/${encodeURIComponent(customer.id)}/contact-methods/${encodeURIComponent(phoneContact.id)}`,
        { value: phone.trim(), isPrimary: true, verificationToken: token },
      );
      setPhoneContact(updated);
      setPersistedPhone(phone.trim());
      setOtpRequested(false);
      setOtpCode('');
      setVerificationToken('');
      setNotice('Primary phone verified. The customer is still DRAFT and is not activated.');
    } catch (verifyError) {
      setError(safeSaveError(verifyError));
    } finally {
      setIsSaving(false);
    }
  };

  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer || isSaving) return;
    const anyAddressField = [lineOne, lineTwo, city, stateOrProvince, postalCode].some((value) => value.trim());
    if (!anyAddressField) {
      setStep(3);
      setNotice('Residential address skipped. You can continue the draft later from Customer 360°.');
      setError(null);
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        type: addressType,
        lineOne: lineOne.trim(),
        lineTwo: lineTwo.trim() || undefined,
        city: city.trim(),
        state: stateOrProvince.trim(),
        country: country.trim().toUpperCase(),
        postalCode: postalCode.trim() || undefined,
        isPrimary: true,
      };
      const saved = address
        ? await ApiClient.patch<AddressRecord>(
            `/customers/${encodeURIComponent(customer.id)}/addresses/${encodeURIComponent(address.id)}`,
            body,
          )
        : await ApiClient.post<AddressRecord>(`/customers/${encodeURIComponent(customer.id)}/address`, body);
      setAddress(saved);
      setNotice('Address saved.');
      setStep(3);
    } catch (saveError) {
      setError(safeSaveError(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const saveIdentityDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customer || isSaving) return;
    if (!documentNumber.trim() && !identityDocument) {
      setStep(4);
      setNotice('Identity document skipped. You can add it later from Customer 360° if authorized.');
      setError(null);
      return;
    }
    if (
      identityDocument &&
      !documentNumber.trim() &&
      identityType === identityDocument.type &&
      issuingCountry.trim().toUpperCase() === identityDocument.issuingCountry &&
      issuedAt === (identityDocument.issuedAt ?? '') &&
      expiresAt === (identityDocument.expiresAt ?? '')
    ) {
      setStep(4);
      setNotice('No identity-document changes were needed.');
      setError(null);
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        type: identityType,
        ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
        issuingCountry: issuingCountry.trim().toUpperCase(),
        issuedAt: issuedAt || undefined,
        expiresAt: expiresAt || undefined,
      };
      const saved = identityDocument
        ? await ApiClient.patch<IdentityRecord>(
            `/customers/${encodeURIComponent(customer.id)}/identity-documents/${encodeURIComponent(identityDocument.id)}`,
            body,
          )
        : await ApiClient.post<IdentityRecord>(
            `/customers/${encodeURIComponent(customer.id)}/identity-document`,
            body,
          );
      setIdentityDocument(saved);
      setDocumentNumber('');
      setNotice('Identity document metadata saved. The document number is masked in the result.');
      setStep(4);
    } catch (saveError) {
      setError(safeSaveError(saveError));
    } finally {
      setIsSaving(false);
    }
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
        <form className="cm-wizard-form" onSubmit={saveProfile}>
          <div className="cm-wizard-field-grid">
            <label>Customer type <span className="cm-required-indicator">Required</span>
              <select value={customerType} onChange={(event) => setCustomerType(event.target.value as CustomerType)} disabled={Boolean(customer)}>
                <option value="INDIVIDUAL">Individual</option>
                <option value="BUSINESS">Business</option>
              </select>
            </label>
            <label>First name <span className="cm-optional-indicator">Optional</span>
              <input maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
            </label>
            <label>Middle name <span className="cm-optional-indicator">Optional</span>
              <input maxLength={100} value={middleName} onChange={(event) => setMiddleName(event.target.value)} autoComplete="additional-name" />
            </label>
            <label>Last name <span className="cm-optional-indicator">Optional</span>
              <input maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
            </label>
            <label>Display name <span className="cm-required-indicator">Required</span>
              <input
                maxLength={200}
                value={displayName}
                onChange={(event) => { setDisplayNameEdited(true); setDisplayName(event.target.value); }}
                onBlur={() => { if (!displayNameEdited && derivedDisplayName) setDisplayName(derivedDisplayName); }}
                autoComplete="name"
                required={!derivedDisplayName}
              />
            </label>
            <label>Legal name <span className="cm-optional-indicator">Optional</span>
              <input maxLength={200} value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            </label>
            <label>Date of birth <span className="cm-optional-indicator">Optional</span>
              <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
            </label>
            <label>Nationality (ISO 2–3 letters) <span className="cm-optional-indicator">Optional</span>
              <input maxLength={3} value={nationality} onChange={(event) => setNationality(event.target.value.toUpperCase())} />
            </label>
          </div>
          <p className="cm-form-help">Customer reference is generated automatically. Display name is required by the existing profile API; structured name parts, date of birth and nationality are optional.</p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : customer ? 'Save profile & continue' : 'Create DRAFT & continue'}
            </button>
            {customer && <button className="cm-button cm-button-secondary" type="button" onClick={finishLater} disabled={isSaving}>Save and finish later</button>}
          </div>
        </form>
      );
    }

    if (step === 1) {
      return (
        <form className="cm-wizard-form" onSubmit={saveContacts}>
          <div className="cm-wizard-field-grid">
            <label>Primary phone number <span className="cm-required-indicator">Required to save contact</span>
              <input type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setOtpRequested(false); setOtpCode(''); setVerificationToken(''); }} autoComplete="tel" placeholder="080… or +234…" required />
            </label>
            <label>Email address <span className="cm-optional-indicator">Optional</span>
              <input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
          </div>
          <p className="cm-form-help">The phone is saved as unverified until an OTP is checked. Verification can never activate a customer or create a wallet by itself.</p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving || !customer}>
              {isSaving ? 'Saving…' : 'Save contact details'}
            </button>
            {customer && phoneContact && persistedPhone === phone.trim() && phoneContact.verifiedAt ? (
              <span className="cm-status cm-status-active">Primary phone verified</span>
            ) : (
              <button className="cm-button cm-button-secondary" type="button" onClick={requestPhoneOtp} disabled={isSaving || !phoneContact || persistedPhone !== phone.trim()}>
                {isSaving ? 'Please wait…' : 'Send phone OTP'}
              </button>
            )}
            <button className="cm-button cm-button-secondary" type="button" onClick={() => { setError(null); setStep(2); }} disabled={isSaving || !phoneContact}>Continue to address</button>
          </div>
          {otpRequested && (
            <div className="cm-otp-form">
              <label>One-time code
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))} />
              </label>
              <button className="cm-button cm-button-primary" type="button" onClick={() => void verifyPhone()} disabled={isSaving || otpCode.length < 4}>
                {isSaving ? 'Verifying…' : verificationToken ? 'Retry verification save' : 'Verify primary phone'}
              </button>
            </div>
          )}
          {customer && <p className="cm-muted">Draft reference: <code>{customer.reference}</code> · No customer status or financial action is performed on this step.</p>}
          {customer && <button className="cm-text-button" type="button" onClick={finishLater} disabled={isSaving}>Save and finish later</button>}
        </form>
      );
    }

    if (step === 2) {
      return (
        <form className="cm-wizard-form" onSubmit={saveAddress}>
          <div className="cm-wizard-field-grid">
            <label>Address type
              <select value={addressType} onChange={(event) => setAddressType(event.target.value as AddressType)}>
                <option value="RESIDENTIAL">Residential</option>
                <option value="BUSINESS">Business</option>
                <option value="MAILING">Mailing</option>
              </select>
            </label>
            <label>Address line 1 <span className="cm-required-indicator">Required if saving</span>
              <input maxLength={200} value={lineOne} onChange={(event) => setLineOne(event.target.value)} autoComplete="address-line1" />
            </label>
            <label>Address line 2 <span className="cm-optional-indicator">Optional</span>
              <input maxLength={200} value={lineTwo} onChange={(event) => setLineTwo(event.target.value)} autoComplete="address-line2" />
            </label>
            <label>City <span className="cm-required-indicator">Required if saving</span>
              <input maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" />
            </label>
            <label>State / province <span className="cm-required-indicator">Required if saving</span>
              <input maxLength={100} value={stateOrProvince} onChange={(event) => setStateOrProvince(event.target.value)} autoComplete="address-level1" />
            </label>
            <label>Country (ISO 2–3 letters) <span className="cm-required-indicator">Required if saving</span>
              <input maxLength={3} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} autoComplete="country" />
            </label>
            <label>Postal code <span className="cm-optional-indicator">Optional</span>
              <input maxLength={20} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} autoComplete="postal-code" />
            </label>
          </div>
          <p className="cm-form-help">When supplied, address type, line 1, city, state and country follow the existing address API requirements. The saved address is marked primary.</p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : address ? 'Save address & continue' : 'Save address & continue'}</button>
            <button className="cm-button cm-button-secondary" type="button" onClick={advanceWithoutAddress} disabled={isSaving}>Skip address</button>
            <button className="cm-button cm-button-secondary" type="button" onClick={() => setStep(1)} disabled={isSaving}>Back</button>
            {customer && <button className="cm-text-button" type="button" onClick={finishLater} disabled={isSaving}>Save and finish later</button>}
          </div>
        </form>
      );
    }

    if (step === 3) {
      if (!canManageIdentity) {
        return (
          <div className="cm-wizard-form">
            <div className="cm-empty-state">
              Identity-document entry is restricted to roles with both <code>customer.view_identity_documents</code> and <code>kyc.review</code>. No document value is requested or exposed for this session.
            </div>
            <div className="cm-actions-row">
              <button className="cm-button cm-button-secondary" type="button" onClick={() => setStep(2)}>Back</button>
              <button className="cm-button cm-button-primary" type="button" onClick={() => { setError(null); setStep(4); }}>Finish registration</button>
            </div>
          </div>
        );
      }
      return (
        <form className="cm-wizard-form" onSubmit={saveIdentityDocument}>
          <div className="cm-wizard-field-grid">
            <label>Identity document type
              <select value={identityType} onChange={(event) => setIdentityType(event.target.value as IdentityType)}>
                {IDENTITY_TYPES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
            <label>Document number <span className="cm-required-indicator">Required if adding</span>
              <input type="password" autoComplete="off" maxLength={160} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} aria-describedby="cm-document-number-note" />
            </label>
            <label>Issuing country (ISO 2–3 letters)
              <input maxLength={3} value={issuingCountry} onChange={(event) => setIssuingCountry(event.target.value.toUpperCase())} />
            </label>
            <label>Issue date <span className="cm-optional-indicator">Optional</span>
              <input type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
            </label>
            <label>Expiry date <span className="cm-optional-indicator">Optional</span>
              <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </label>
          </div>
          <p id="cm-document-number-note" className="cm-form-help">Document numbers are sent only to the authorized API, are never placed in audit metadata, and are masked in all read and save responses.</p>
          <div className="cm-actions-row">
            <button className="cm-button cm-button-primary" type="submit" disabled={isSaving || (!identityDocument && !documentNumber.trim())}>{isSaving ? 'Saving…' : identityDocument ? 'Save identity details' : 'Save identity details & finish'}</button>
            <button className="cm-button cm-button-secondary" type="button" onClick={() => { setError(null); setStep(4); }}>Skip identity document</button>
            <button className="cm-button cm-button-secondary" type="button" onClick={() => setStep(2)} disabled={isSaving}>Back</button>
            {customer && <button className="cm-text-button" type="button" onClick={finishLater} disabled={isSaving}>Save and finish later</button>}
          </div>
        </form>
      );
    }

    return (
      <div className="cm-registration-summary">
        <div className="cm-summary-success" aria-label="Draft customer saved">
          <span className="cm-summary-check" aria-hidden="true">✓</span>
          <div>
            <p className="cm-eyebrow">REGISTRATION SAVED</p>
            <h3>{displayName || derivedDisplayName || 'Customer profile saved'}</h3>
            <p className="cm-muted">The customer remains <strong>DRAFT</strong>. No activation or ledger wallet creation was requested.</p>
          </div>
        </div>
        <dl className="cm-summary-grid">
          <div><dt>Customer reference</dt><dd>{customer?.reference ?? 'Not available'}</dd></div>
          <div><dt>Customer type</dt><dd>{customerType}</dd></div>
          <div><dt>Primary phone</dt><dd>{phoneContact?.maskedValue ?? 'Not saved'} · {phoneContact?.verifiedAt ? 'Verified' : 'Unverified'}</dd></div>
          <div><dt>Email</dt><dd>{emailContact?.maskedValue ?? (email.trim() ? 'Saved' : 'Not recorded')}</dd></div>
          <div><dt>Address</dt><dd>{address ? 'Saved as primary' : 'Not recorded'}</dd></div>
          <div><dt>Identity document</dt><dd>{identityDocument ? `${identityDocument.type.replaceAll('_', ' ')} · ${identityDocument.maskedDocumentNumber}` : canManageIdentity ? 'Not recorded' : 'Restricted for this role'}</dd></div>
        </dl>
        {!phoneContact?.verifiedAt && <p className="cm-summary-warning">Activation stays blocked until an authorized workflow verifies a primary phone. Continue later in Customer 360°.</p>}
        <div className="cm-actions-row">
          {customer && <button className="cm-button cm-button-primary" type="button" onClick={() => onOpenCustomer(customer.id)}>Open Customer 360°</button>}
          <button className="cm-button cm-button-secondary" type="button" onClick={onClose}>Return to directory</button>
        </div>
      </div>
    );
  };

  return (
    <section className="cm-create-panel cm-registration-wizard" aria-label="New customer registration">
      <div className="cm-wizard-heading">
        <div>
          <p className="cm-eyebrow">DRAFT REGISTRATION · {progress}</p>
          <h2>{step < 4 ? STEPS[step] : 'Registration summary'}</h2>
          <p>Personal information is saved incrementally so an incomplete DRAFT can be continued in Customer 360°.</p>
        </div>
        <button className="cm-button cm-button-secondary" type="button" onClick={onClose} disabled={isSaving}>Close</button>
      </div>
      <ol className="cm-wizard-stepper" aria-label="Registration progress">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}>
            <span>{index + 1}</span><small>{label}</small>
          </li>
        ))}
      </ol>
      {error && <div className="cm-error cm-wizard-message" role="alert">{error}</div>}
      {notice && <div className="cm-notice cm-wizard-message" role="status">{notice}</div>}
      {stepForm()}
    </section>
  );
};
