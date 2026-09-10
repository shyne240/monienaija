import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiClient, ApiError } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

// ── Types ──────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  reference: string;
  type: string;
  status: string;
  kycLevel: string;
  kycStatus: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerProfile {
  id: string;
  customerId: string;
  displayName: string;
  legalName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ContactMethod {
  id: string;
  type: 'EMAIL' | 'PHONE';
  value: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

interface Address {
  id: string;
  type: string;
  lineOne: string;
  lineTwo: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  isPrimary: boolean;
}

interface IdentityDocument {
  id: string;
  type: string;
  documentNumber: string;
  issuingCountry: string;
  issuedAt: string | null;
  expiresAt: string | null;
}

interface KycRecord {
  id: string;
  level: string;
  status: string;
  reason?: string;
  assessedBy: string;
  expiresAt?: string;
  createdAt: string;
}

interface Wallet {
  id: string;
  customerId: string;
  type: string;
  currency: string;
  status: string;
  balanceMinor: number;
}

interface OnboardingRecord {
  id: string;
  customerId: string;
  status: string;
  version: number;
  startedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
}

interface RiskProfile {
  id: string;
  customerId: string;
  status: string;
  overallRiskLevel: string;
  assessmentDate: string;
  assessedBy: string;
  assessmentMethod: string;
  reviewDueDate: string;
  notes: string | null;
}

interface ComplianceCase {
  id: string;
  customerId: string;
  caseNumber: string;
  category: string;
  severity: string;
  status: string;
  version: number;
}

interface Eligibility {
  id: string;
  customerId: string;
  status: string;
  reason: string | null;
  reviewedBy: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const formatKobo = (minor: number) =>
  `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
};

const statusColor = (s: string) => {
  const m: Record<string, string> = {
    ACTIVE: '#10B981', COMPLETED: '#10B981', APPROVED: '#10B981', ELIGIBLE: '#10B981', RESOLVED: '#10B981', LOW: '#10B981',
    PENDING: '#F59E0B', IN_PROGRESS: '#F59E0B', AWAITING_REVIEW: '#F59E0B', UNDER_REVIEW: '#F59E0B', MEDIUM: '#F59E0B',
    SUSPENDED: '#EF4444', FAILED: '#EF4444', REJECTED: '#EF4444', CLOSED: '#EF4444', HIGH: '#EF4444', CRITICAL: '#EF4444',
    DRAFT: '#94A3B8', NOT_STARTED: '#94A3B8', NONE: '#94A3B8',
  };
  return m[s] || '#64748B';
};

const StatusBadge: React.FC<{ value: string }> = ({ value }) => (
  <span style={{
    display: 'inline-block', fontSize: '11px', fontWeight: 700, padding: '2px 8px',
    borderRadius: '4px', color: '#fff', backgroundColor: statusColor(value),
  }}>{value}</span>
);

const SectionCard: React.FC<{ title: string; icon: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, icon, children, action }) => (
  <div style={S.sectionCard}>
    <div style={S.sectionHeader}>
      <span style={S.sectionTitle}>{icon} {title}</span>
      {action}
    </div>
    {children}
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <p style={{ fontSize: '13px', color: '#94A3B8', textAlign: 'center', padding: '16px 0', margin: 0 }}>{message}</p>
);

const FieldRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={S.fieldRow}>
    <span style={S.fieldLabel}>{label}</span>
    <span style={S.fieldValue}>{value ?? '—'}</span>
  </div>
);

const ErrorBanner: React.FC<{ error: string | null; onDismiss?: () => void }> = ({ error, onDismiss }) => {
  if (!error) return null;
  return (
    <div style={S.errorBox}>
      <span>{error}</span>
      {onDismiss && <button onClick={onDismiss} style={S.dismissBtn}>✕</button>}
    </div>
  );
};

const SuccessBanner: React.FC<{ message: string | null }> = ({ message }) => {
  if (!message) return null;
  return <div style={S.successBox}>{message}</div>;
};

// ── Registration Form ──────────────────────────────────────────────────────
interface RegFormProps {
  onClose: () => void;
  onCreated: (c: Customer) => void;
  principalId: string;
}

const RegistrationForm: React.FC<RegFormProps> = ({ onClose, onCreated, principalId }) => {
  const [step, setStep] = useState(0); // 0=identity, 1=contact, 2=address
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Identity
  const [reference, setReference] = useState('');
  const [custType, setCustType] = useState('INDIVIDUAL');
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('NG');

  // Contact
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Address
  const [lineOne, setLineOne] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('NG');
  const [postalCode, setPostalCode] = useState('');

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!reference.trim()) return 'Customer reference is required';
      if (!displayName.trim()) return 'Display name is required';
    }
    if (s === 1) {
      if (phone && !/^\+?[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ''))) return 'Invalid phone number format';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Invalid email address';
      if (!phone && !email) return 'At least one contact method (phone or email) is required';
    }
    if (s === 2) {
      if (lineOne.trim() && (!city.trim() || !state.trim())) return 'City and state are required when providing an address';
    }
    return null;
  };

  const next = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError('');
    setStep(step + 1);
  };

  const handleSubmit = async () => {
    const err = validateStep(2);
    if (err) { setError(err); return; }
    setError('');
    setSubmitting(true);
    try {
      // Step 1: Create customer
      const customer = await ApiClient.post<Customer>('/customers', {
        reference: reference.trim().toLowerCase(),
        type: custType,
        status: 'ACTIVE',
        actor: principalId,
      });

      // Step 2: Create profile
      const profilePayload: Record<string, unknown> = {
        displayName: displayName.trim(),
        actor: principalId,
      };
      if (legalName.trim()) profilePayload.legalName = legalName.trim();
      if (dateOfBirth) profilePayload.dateOfBirth = new Date(dateOfBirth).toISOString();
      if (nationality.trim()) profilePayload.nationality = nationality.trim().toUpperCase();
      try {
        await ApiClient.post(`/customers/${customer.id}/profile`, profilePayload);
      } catch (e: unknown) {
        console.warn('Profile creation failed:', e instanceof ApiError ? e.message : e);
      }

      // Step 3: Contact methods
      if (phone.trim()) {
        try {
          await ApiClient.post(`/customers/${customer.id}/contact-method`, {
            type: 'PHONE', value: phone.trim(), isPrimary: true, actor: principalId,
          });
        } catch (e: unknown) {
          console.warn('Phone creation failed:', e instanceof ApiError ? e.message : e);
        }
      }
      if (email.trim()) {
        try {
          await ApiClient.post(`/customers/${customer.id}/contact-method`, {
            type: 'EMAIL', value: email.trim(), isPrimary: !phone.trim(), actor: principalId,
          });
        } catch (e: unknown) {
          console.warn('Email creation failed:', e instanceof ApiError ? e.message : e);
        }
      }

      // Step 4: Address
      if (lineOne.trim() && city.trim() && state.trim()) {
        const addrPayload: Record<string, unknown> = {
          type: 'RESIDENTIAL',
          lineOne: lineOne.trim(),
          city: city.trim(),
          state: state.trim(),
          country: country.trim().toUpperCase(),
          isPrimary: true,
          actor: principalId,
        };
        if (postalCode.trim()) addrPayload.postalCode = postalCode.trim();
        try {
          await ApiClient.post(`/customers/${customer.id}/address`, addrPayload);
        } catch (e: unknown) {
          console.warn('Address creation failed:', e instanceof ApiError ? e.message : e);
        }
      }

      onCreated(customer);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'Registration failed');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={S.formCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={S.cardTitle}>Register New Customer</h3>
        <button onClick={onClose} style={S.closeBtn}>✕</button>
      </div>

      {/* Stepper */}
      <div style={S.stepper}>
        {['Identity', 'Contact', 'Address'].map((label, i) => (
          <div key={label} style={{ ...S.stepItem, ...(i === step ? S.stepActive : i < step ? S.stepDone : {}) }}>
            <span style={S.stepNumber}>{i < step ? '✓' : i + 1}</span>
            <span style={S.stepLabel}>{label}</span>
          </div>
        ))}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {step === 0 && (
        <div style={S.formGrid}>
          <div style={S.inputGroup}>
            <label style={S.label}>Customer Reference *</label>
            <input style={S.input} placeholder="e.g. MN-08012345678" value={reference} onChange={e => setReference(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Customer Segment</label>
            <select style={S.select} value={custType} onChange={e => setCustType(e.target.value)}>
              <option value="INDIVIDUAL">INDIVIDUAL</option>
              <option value="BUSINESS">BUSINESS</option>
            </select>
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Display Name *</label>
            <input style={S.input} placeholder="e.g. Adaeze Okafor" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Legal Name</label>
            <input style={S.input} placeholder="Full legal name (if different)" value={legalName} onChange={e => setLegalName(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Date of Birth</label>
            <input style={S.input} type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Nationality</label>
            <input style={S.input} placeholder="e.g. NG" maxLength={3} value={nationality} onChange={e => setNationality(e.target.value.toUpperCase())} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={S.formGrid}>
          <div style={S.inputGroup}>
            <label style={S.label}>Phone Number {phone ? '*' : ''}</label>
            <input style={S.input} placeholder="e.g. +2348012345678" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Email Address {email ? '*' : ''}</label>
            <input style={S.input} type="email" placeholder="e.g. customer@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', gridColumn: '1 / -1', margin: '4px 0 0' }}>
            At least one contact method is required. Both are recommended.
          </p>
        </div>
      )}

      {step === 2 && (
        <div style={S.formGrid}>
          <div style={{ ...S.inputGroup, gridColumn: '1 / -1' }}>
            <label style={S.label}>Street Address</label>
            <input style={S.input} placeholder="e.g. 15 Broad Street" value={lineOne} onChange={e => setLineOne(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>City</label>
            <input style={S.input} placeholder="e.g. Lagos" value={city} onChange={e => setCity(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>State</label>
            <input style={S.input} placeholder="e.g. Lagos" value={state} onChange={e => setState(e.target.value)} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Country</label>
            <input style={S.input} placeholder="NG" maxLength={3} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} />
          </div>
          <div style={S.inputGroup}>
            <label style={S.label}>Postal Code</label>
            <input style={S.input} placeholder="e.g. 100001" value={postalCode} onChange={e => setPostalCode(e.target.value)} />
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', gridColumn: '1 / -1', margin: '4px 0 0' }}>
            Address is optional during registration. Leave blank to skip.
          </p>
        </div>
      )}

      <div style={S.formActions}>
        {step > 0 && <button style={S.secondaryBtn} onClick={() => { setError(''); setStep(step - 1); }}>← Back</button>}
        <div style={{ flex: 1 }} />
        {step < 2 ? (
          <button style={S.primaryBtn} onClick={next}>Continue →</button>
        ) : (
          <button style={S.primaryBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Customer Profile'}
          </button>
        )}
      </div>
    </div>
  );
};

// ── Customer Detail Panel ──────────────────────────────────────────────────
type DetailTab = 'profile' | 'identity' | 'onboarding' | 'risk' | 'compliance' | 'eligibility' | 'wallet' | 'activity';

interface DetailProps {
  customer: Customer;
  principalId: string;
  principalRoles: string[];
  onStatusChange: (updated: Customer) => void;
}

const CustomerDetail: React.FC<DetailProps> = ({ customer, principalId, principalRoles, onStatusChange }) => {
  const [tab, setTab] = useState<DetailTab>('profile');
  const [loading, setLoading] = useState(true);

  // Data
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [contacts, setContacts] = useState<ContactMethod[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [kyc, setKyc] = useState<KycRecord | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingRecord | null>(null);
  const [risk, setRisk] = useState<RiskProfile | null>(null);
  const [compliance, setCompliance] = useState<ComplianceCase[]>([]);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);

  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  // KYC form
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('PENDING');
  const [kycReason, setKycReason] = useState('');

  // ID document form
  const [showIdForm, setShowIdForm] = useState(false);
  const [idType, setIdType] = useState('BVN');
  const [idNumber, setIdNumber] = useState('');
  const [idCountry, setIdCountry] = useState('NG');

  const isPreparer = principalRoles.includes('FINANCE_PREPARER') || principalRoles.includes('FINANCE_ADMIN');

  const loadAll = useCallback(async () => {
    setLoading(true);
    const id = customer.id;
    const results = await Promise.allSettled([
      ApiClient.get<CustomerProfile>(`/customers/${id}/profile`),
      ApiClient.get<ContactMethod[]>(`/customers/${id}/contact-methods`),
      ApiClient.get<Address[]>(`/customers/${id}/addresses`),
      ApiClient.get<IdentityDocument[]>(`/customers/${id}/identity-documents`),
      ApiClient.get<KycRecord>(`/customers/${id}/kyc`),
      ApiClient.get<Wallet[]>(`/customers/${id}/wallets`),
      ApiClient.get<OnboardingRecord>(`/customers/${id}/onboarding`),
      ApiClient.get<RiskProfile>(`/customers/${id}/risk-profile`),
      ApiClient.get<ComplianceCase[]>(`/customers/${id}/compliance-cases`),
      ApiClient.get<Eligibility>(`/customers/${id}/eligibility`),
    ]);
    const getVal = (i: number): unknown =>
      results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value : null;
    setProfile(getVal(0) as CustomerProfile | null);
    setContacts((getVal(1) as ContactMethod[]) || []);
    setAddresses((getVal(2) as Address[]) || []);
    setDocuments((getVal(3) as IdentityDocument[]) || []);
    setKyc(getVal(4) as KycRecord | null);
    setWallets((getVal(5) as Wallet[]) || []);
    setOnboarding(getVal(6) as OnboardingRecord | null);
    setRisk(getVal(7) as RiskProfile | null);
    setCompliance((getVal(8) as ComplianceCase[]) || []);
    setEligibility(getVal(9) as Eligibility | null);
    setLoading(false);
  }, [customer.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleStatusUpdate = async (newStatus: string) => {
    setActionErr(''); setActionMsg('');
    try {
      const res = await ApiClient.patch<Customer>(`/customers/${customer.id}`, { status: newStatus, actor: principalId });
      setActionMsg(`Status updated to ${newStatus}`);
      onStatusChange(res);
    } catch (e: unknown) {
      setActionErr(e instanceof ApiError ? e.message : 'Status update failed');
    }
  };

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionErr(''); setActionMsg('');
    try {
      const payload: Record<string, unknown> = { level: kycLevel, status: kycStatus, assessedBy: principalId };
      if (kycReason.trim()) payload.reason = kycReason.trim();
      const record = await ApiClient.post<KycRecord>(`/customers/${customer.id}/kyc-assessment`, payload);
      setKyc(record);
      setActionMsg('KYC Assessment recorded');
      setKycReason('');
    } catch (e: unknown) {
      setActionErr(e instanceof ApiError ? e.message : 'KYC submission failed');
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionErr(''); setActionMsg('');
    try {
      await ApiClient.post(`/customers/${customer.id}/identity-document`, {
        type: idType, documentNumber: idNumber.trim(), issuingCountry: idCountry.trim().toUpperCase(), actor: principalId,
      });
      setActionMsg('Identity document recorded');
      setShowIdForm(false); setIdNumber('');
      const docs = await ApiClient.get<IdentityDocument[]>(`/customers/${customer.id}/identity-documents`);
      setDocuments(docs || []);
    } catch (e: unknown) {
      setActionErr(e instanceof ApiError ? e.message : 'Failed to add document');
    }
  };

  const tabs: { key: DetailTab; label: string; icon: string }[] = [
    { key: 'profile', label: 'Profile', icon: '👤' },
    { key: 'identity', label: 'Identity & KYC', icon: '🪪' },
    { key: 'onboarding', label: 'Onboarding', icon: '📋' },
    { key: 'risk', label: 'Risk', icon: '⚠️' },
    { key: 'compliance', label: 'Compliance', icon: '🛡️' },
    { key: 'eligibility', label: 'Eligibility', icon: '✅' },
    { key: 'wallet', label: 'Wallets', icon: '👛' },
    { key: 'activity', label: 'Status', icon: '🔄' },
  ];

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Loading customer details...</div>;
  }

  const phoneContact = contacts.find(c => c.type === 'PHONE');
  const emailContact = contacts.find(c => c.type === 'EMAIL');
  const primaryAddress = addresses.find(a => a.isPrimary) || addresses[0];

  return (
    <div style={S.detailPanel}>
      {/* Header */}
      <div style={S.detailHeader}>
        <div style={S.detailAvatar}>
          {(profile?.displayName || customer.reference).charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1E293B' }}>
            {profile?.displayName || customer.reference}
          </h3>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            <StatusBadge value={customer.status} />
            <StatusBadge value={customer.kycStatus || 'NOT_STARTED'} />
            <span style={{ fontSize: '11px', color: '#64748B' }}>{customer.reference}</span>
          </div>
        </div>
      </div>

      <ErrorBanner error={actionErr} onDismiss={() => setActionErr('')} />
      <SuccessBanner message={actionMsg} />

      {/* Tabs */}
      <div style={S.tabBar}>
        {tabs.map(t => (
          <button key={t.key} style={tab === t.key ? S.tabActive : S.tab} onClick={() => { setTab(t.key); setActionMsg(''); setActionErr(''); }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={S.tabContent}>
        {tab === 'profile' && (
          <>
            <SectionCard title="Personal Information" icon="👤">
              <FieldRow label="Display Name" value={profile?.displayName} />
              <FieldRow label="Legal Name" value={profile?.legalName} />
              <FieldRow label="Date of Birth" value={formatDate(profile?.dateOfBirth)} />
              <FieldRow label="Nationality" value={profile?.nationality} />
              <FieldRow label="Customer Type" value={customer.type} />
              <FieldRow label="Customer Since" value={formatDate(customer.createdAt)} />
            </SectionCard>

            <SectionCard title="Contact Information" icon="📞">
              {contacts.length === 0 ? <EmptyState message="No contact methods recorded" /> : contacts.map(c => (
                <FieldRow key={c.id} label={`${c.type}${c.isPrimary ? ' (Primary)' : ''}`}
                  value={<span>{c.value} {c.verifiedAt ? <StatusBadge value="VERIFIED" /> : <span style={{ fontSize: '10px', color: '#94A3B8' }}>unverified</span>}</span>} />
              ))}
            </SectionCard>

            <SectionCard title="Address" icon="🏠">
              {!primaryAddress ? <EmptyState message="No address recorded" /> : (
                <>
                  <FieldRow label="Street" value={primaryAddress.lineOne} />
                  {primaryAddress.lineTwo && <FieldRow label="Line 2" value={primaryAddress.lineTwo} />}
                  <FieldRow label="City" value={primaryAddress.city} />
                  <FieldRow label="State" value={primaryAddress.state} />
                  <FieldRow label="Country" value={primaryAddress.country} />
                  {primaryAddress.postalCode && <FieldRow label="Postal Code" value={primaryAddress.postalCode} />}
                </>
              )}
            </SectionCard>
          </>
        )}

        {tab === 'identity' && (
          <>
            <SectionCard title="Identity Documents" icon="🪪"
              action={isPreparer && !showIdForm ? <button style={S.smallBtn} onClick={() => setShowIdForm(true)}>+ Add Document</button> : undefined}>
              {documents.length === 0 ? <EmptyState message="No identity documents recorded" /> : documents.map(d => (
                <div key={d.id} style={S.listItem}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '13px' }}>{d.type}</strong>
                    <StatusBadge value={d.expiresAt && new Date(d.expiresAt) < new Date() ? 'EXPIRED' : 'RECORDED'} />
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                    {d.documentNumber} · {d.issuingCountry}
                    {d.issuedAt && ` · Issued ${formatDate(d.issuedAt)}`}
                    {d.expiresAt && ` · Expires ${formatDate(d.expiresAt)}`}
                  </div>
                </div>
              ))}
              {showIdForm && (
                <form onSubmit={handleAddDocument} style={{ ...S.inlineForm, marginTop: '12px' }}>
                  <div style={S.formGrid}>
                    <div style={S.inputGroup}>
                      <label style={S.label}>Document Type</label>
                      <select style={S.select} value={idType} onChange={e => setIdType(e.target.value)}>
                        <option value="BVN">BVN</option>
                        <option value="NIN">NIN</option>
                        <option value="INTERNATIONAL_PASSPORT">International Passport</option>
                        <option value="DRIVERS_LICENSE">Driver's License</option>
                        <option value="VOTERS_CARD">Voter's Card</option>
                        <option value="BUSINESS_REGISTRATION">Business Registration</option>
                      </select>
                    </div>
                    <div style={S.inputGroup}>
                      <label style={S.label}>Document Number *</label>
                      <input style={S.input} value={idNumber} onChange={e => setIdNumber(e.target.value)} required />
                    </div>
                    <div style={S.inputGroup}>
                      <label style={S.label}>Issuing Country</label>
                      <input style={S.input} value={idCountry} onChange={e => setIdCountry(e.target.value.toUpperCase())} maxLength={3} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button type="submit" style={S.smallBtn}>Save</button>
                    <button type="button" style={S.smallSecondaryBtn} onClick={() => setShowIdForm(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </SectionCard>

            <SectionCard title="KYC Assessment" icon="🔍">
              {kyc ? (
                <>
                  <FieldRow label="KYC Level" value={<StatusBadge value={kyc.level} />} />
                  <FieldRow label="Status" value={<StatusBadge value={kyc.status} />} />
                  <FieldRow label="Reason" value={kyc.reason} />
                  <FieldRow label="Assessed By" value={kyc.assessedBy} />
                  <FieldRow label="Assessed On" value={formatDate(kyc.createdAt)} />
                </>
              ) : <EmptyState message="No KYC assessment recorded" />}

              {isPreparer && (
                <form onSubmit={handleKycSubmit} style={{ ...S.inlineForm, marginTop: '12px' }}>
                  <h5 style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>Record KYC Assessment</h5>
                  <div style={S.formGrid}>
                    <select style={S.select} value={kycLevel} onChange={e => setKycLevel(e.target.value)}>
                      <option value="LEVEL_1">Level 1</option>
                      <option value="LEVEL_2">Level 2</option>
                      <option value="LEVEL_3">Level 3</option>
                    </select>
                    <select style={S.select} value={kycStatus} onChange={e => setKycStatus(e.target.value)}>
                      <option value="PENDING">PENDING</option>
                      <option value="APPROVED">APPROVED</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>
                  <input style={{ ...S.input, marginTop: '8px', width: '100%' }} placeholder="Assessment reason / notes"
                    value={kycReason} onChange={e => setKycReason(e.target.value)} />
                  <button type="submit" style={{ ...S.smallBtn, marginTop: '8px' }}>Submit Assessment</button>
                </form>
              )}
            </SectionCard>
          </>
        )}

        {tab === 'onboarding' && (
          <SectionCard title="Onboarding Lifecycle" icon="📋">
            {!onboarding ? <EmptyState message="No onboarding record. Customer has not started the onboarding process." /> : (
              <>
                <FieldRow label="Status" value={<StatusBadge value={onboarding.status} />} />
                <FieldRow label="Version" value={onboarding.version} />
                <FieldRow label="Started" value={formatDate(onboarding.startedAt)} />
                <FieldRow label="Approved" value={formatDate(onboarding.approvedAt)} />
                <FieldRow label="Completed" value={formatDate(onboarding.completedAt)} />
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#475569', margin: '0 0 8px' }}>ONBOARDING PIPELINE</p>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'APPROVED', 'COMPLETED'].map(s => (
                      <span key={s} style={{
                        fontSize: '10px', padding: '3px 8px', borderRadius: '4px',
                        backgroundColor: onboarding.status === s ? statusColor(s) : '#E2E8F0',
                        color: onboarding.status === s ? '#fff' : '#94A3B8',
                        fontWeight: onboarding.status === s ? 700 : 400,
                      }}>{s}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        )}

        {tab === 'risk' && (
          <SectionCard title="Risk Assessment" icon="⚠️">
            {!risk ? <EmptyState message="No risk assessment recorded" /> : (
              <>
                <FieldRow label="Overall Risk" value={<StatusBadge value={risk.overallRiskLevel} />} />
                <FieldRow label="Status" value={<StatusBadge value={risk.status} />} />
                <FieldRow label="Assessment Method" value={risk.assessmentMethod} />
                <FieldRow label="Assessed By" value={risk.assessedBy} />
                <FieldRow label="Assessment Date" value={formatDate(risk.assessmentDate)} />
                <FieldRow label="Review Due" value={formatDate(risk.reviewDueDate)} />
                {risk.notes && <FieldRow label="Notes" value={risk.notes} />}
              </>
            )}
          </SectionCard>
        )}

        {tab === 'compliance' && (
          <SectionCard title="Compliance Cases" icon="🛡️">
            {compliance.length === 0 ? <EmptyState message="No compliance cases" /> : compliance.map(c => (
              <div key={c.id} style={S.listItem}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px' }}>{c.caseNumber}</strong>
                  <StatusBadge value={c.status} />
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                  {c.category} · <StatusBadge value={c.severity} />
                </div>
              </div>
            ))}
          </SectionCard>
        )}

        {tab === 'eligibility' && (
          <SectionCard title="Financial Eligibility" icon="✅">
            {!eligibility ? <EmptyState message="No eligibility determination recorded" /> : (
              <>
                <FieldRow label="Status" value={<StatusBadge value={eligibility.status} />} />
                <FieldRow label="Reviewed By" value={eligibility.reviewedBy} />
                {eligibility.reason && <FieldRow label="Reason" value={eligibility.reason} />}
              </>
            )}
          </SectionCard>
        )}

        {tab === 'wallet' && (
          <SectionCard title="Wallets & Accounts" icon="👛">
            {wallets.length === 0 ? <EmptyState message="No wallets provisioned" /> : wallets.map(w => (
              <div key={w.id} style={S.walletCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>{w.type} · {w.currency}</span>
                    <div style={{ fontSize: '10px', color: '#64748B', fontFamily: 'monospace' }}>{w.id}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A3D25' }}>{formatKobo(w.balanceMinor)}</div>
                    <StatusBadge value={w.status} />
                  </div>
                </div>
              </div>
            ))}
          </SectionCard>
        )}

        {tab === 'activity' && (
          <SectionCard title="Customer Status Management" icon="🔄">
            <FieldRow label="Current Status" value={<StatusBadge value={customer.status} />} />
            <FieldRow label="Version" value={customer.version} />
            <FieldRow label="Created" value={formatDate(customer.createdAt)} />
            <FieldRow label="Updated" value={formatDate(customer.updatedAt)} />

            {customer.status !== 'CLOSED' && (
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#475569', margin: '0 0 8px' }}>STATUS TRANSITIONS</p>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {customer.status === 'DRAFT' && <button style={S.statusBtnActive} onClick={() => handleStatusUpdate('ACTIVE')}>→ ACTIVATE</button>}
                  {customer.status === 'ACTIVE' && <button style={S.statusBtnSuspend} onClick={() => handleStatusUpdate('SUSPENDED')}>⏸ SUSPEND</button>}
                  {customer.status === 'SUSPENDED' && <button style={S.statusBtnActive} onClick={() => handleStatusUpdate('ACTIVE')}>▶ REACTIVATE</button>}
                  {customer.status !== 'CLOSED' && <button style={S.statusBtnClose} onClick={() => handleStatusUpdate('CLOSED')}>✕ CLOSE</button>}
                </div>
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
};

// ── Main Screen ────────────────────────────────────────────────────────────
export const CustomerDirectoryScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [createSuccess, setCreateSuccess] = useState('');

  const isPreparer = principal?.roles.includes('FINANCE_PREPARER') || principal?.roles.includes('FINANCE_ADMIN') || principal?.scopes.includes('finance:prepare');

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true); setError('');
    try {
      const params = [];
      if (filterStatus) params.push(`status=${filterStatus}`);
      if (filterType) params.push(`type=${filterType}`);
      const query = params.length > 0 ? `?${params.join('&')}&limit=100` : '?limit=100';
      const list = await ApiClient.get<Customer[]>(`/customers${query}`);
      setCustomers(list || []);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to load customer directory');
    } finally {
      setIsLoading(false);
    }
  }, [filterStatus, filterType]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Client-side search across loaded data
  const filteredCustomers = useMemo(() => {
    if (!searchText.trim()) return customers;
    const q = searchText.toLowerCase();
    return customers.filter(c =>
      c.reference.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    );
  }, [customers, searchText]);

  const handleCustomerCreated = (c: Customer) => {
    setShowCreate(false);
    setCreateSuccess(`Customer "${c.reference}" created with full profile`);
    setTimeout(() => setCreateSuccess(''), 5000);
    fetchCustomers();
  };

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div>
          <h2 style={S.title}>Customer Management</h2>
          <p style={S.subtitle}>Customer profiles, KYC, onboarding, risk, and servicing</p>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <SuccessBanner message={createSuccess} />

      {showCreate && (
        <RegistrationForm
          onClose={() => setShowCreate(false)}
          onCreated={handleCustomerCreated}
          principalId={principal?.principalId || 'operator'}
        />
      )}

      <div style={S.toolbar}>
        <div style={S.searchBar}>
          <input style={S.searchInput} placeholder="Search by reference, ID, type, status..."
            value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <div style={S.filterGroup}>
          <select style={S.select} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select style={S.select} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="BUSINESS">Business</option>
          </select>
          {isPreparer && (
            <button style={S.primaryBtn} onClick={() => { setShowCreate(!showCreate); setCreateSuccess(''); }}>
              {showCreate ? '✕ Close' : '+ New Customer'}
            </button>
          )}
        </div>
      </div>

      <div style={S.mainLayout}>
        {/* Customer List */}
        <div style={S.listPanel}>
          <div style={S.listHeader}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#1E293B' }}>
              {filteredCustomers.length} Customer{filteredCustomers.length !== 1 ? 's' : ''}
            </span>
            {searchText && <span style={{ fontSize: '11px', color: '#64748B' }}>filtered from {customers.length}</span>}
          </div>

          {isLoading ? (
            <EmptyState message="Loading..." />
          ) : filteredCustomers.length === 0 ? (
            <EmptyState message={searchText ? 'No customers match your search' : 'No customers found'} />
          ) : (
            <div style={S.customerList}>
              {filteredCustomers.map(c => (
                <div key={c.id}
                  style={{
                    ...S.customerRow,
                    ...(selectedCustomer?.id === c.id ? S.customerRowSelected : {}),
                  }}
                  onClick={() => setSelectedCustomer(c)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1E293B' }}>{c.reference}</div>
                      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                        {c.type} · Created {formatDate(c.createdAt)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                      <StatusBadge value={c.status} />
                      {c.kycStatus && c.kycStatus !== 'NOT_STARTED' && <StatusBadge value={c.kycStatus} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div style={S.detailSection}>
          {selectedCustomer ? (
            <CustomerDetail
              customer={selectedCustomer}
              principalId={principal?.principalId || 'operator'}
              principalRoles={principal?.roles || []}
              onStatusChange={(updated) => {
                setSelectedCustomer(updated);
                setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
              }}
            />
          ) : (
            <div style={S.emptyDetail}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👥</div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', margin: '0 0 8px' }}>Select a Customer</h3>
              <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
                Click on a customer from the list to view their profile, KYC status, onboarding progress, and servicing options.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  container: { padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: '22px', fontWeight: 700, color: '#0A3D25', margin: 0 },
  subtitle: { fontSize: '13px', color: '#64748B', margin: '4px 0 0' },

  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const },
  searchBar: { flex: 1, minWidth: '200px', maxWidth: '400px' },
  searchInput: { width: '100%', height: '36px', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0 12px', fontSize: '13px', color: '#1E293B', boxSizing: 'border-box' as const },
  filterGroup: { display: 'flex', gap: '8px', alignItems: 'center' },
  select: { height: '36px', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '0 12px', fontSize: '12px', backgroundColor: '#fff', color: '#334155', minWidth: '110px' },
  primaryBtn: { backgroundColor: '#0A3D25', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  secondaryBtn: { backgroundColor: '#fff', color: '#334155', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' },
  smallBtn: { backgroundColor: '#0A3D25', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },
  smallSecondaryBtn: { backgroundColor: '#fff', color: '#334155', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer' },

  mainLayout: { display: 'flex', gap: '20px', alignItems: 'flex-start' },
  listPanel: { width: '380px', minHeight: '500px', backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' },
  listHeader: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  customerList: { maxHeight: '70vh', overflowY: 'auto' as const },
  customerRow: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', cursor: 'pointer', transition: 'background 0.15s' },
  customerRowSelected: { backgroundColor: '#F0FDF4', borderLeft: '3px solid #0A3D25' },

  detailSection: { flex: 1, minWidth: 0 },
  emptyDetail: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '40px' },

  detailPanel: { backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  detailAvatar: { width: '44px', height: '44px', borderRadius: '22px', backgroundColor: '#0A3D25', color: '#FFB703', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 700, fontSize: '18px', flexShrink: 0 },

  tabBar: { display: 'flex', overflowX: 'auto' as const, borderBottom: '1px solid #E2E8F0', padding: '0 12px', gap: '2px', backgroundColor: '#FAFAFA' },
  tab: { padding: '10px 12px', fontSize: '11px', fontWeight: 500, color: '#64748B', backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tabActive: { padding: '10px 12px', fontSize: '11px', fontWeight: 700, color: '#0A3D25', backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid #0A3D25', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tabContent: { padding: '16px 20px', maxHeight: '65vh', overflowY: 'auto' as const },

  sectionCard: { marginBottom: '16px', padding: '14px', backgroundColor: '#FAFAFA', borderRadius: '6px', border: '1px solid #E2E8F0' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  sectionTitle: { fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },

  fieldRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #F1F5F9' },
  fieldLabel: { fontSize: '12px', color: '#64748B', flexShrink: 0, marginRight: '12px' },
  fieldValue: { fontSize: '12px', color: '#1E293B', fontWeight: 500, textAlign: 'right' as const, wordBreak: 'break-word' as const },

  listItem: { padding: '10px', backgroundColor: '#fff', borderRadius: '4px', border: '1px solid #E2E8F0', marginBottom: '6px' },
  walletCard: { padding: '12px', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '8px' },

  formCard: { backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' },
  cardTitle: { fontSize: '15px', fontWeight: 700, color: '#1E293B', margin: 0 },
  closeBtn: { background: 'none', border: 'none', fontSize: '18px', color: '#94A3B8', cursor: 'pointer', padding: '4px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  inputGroup: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  label: { fontSize: '11px', fontWeight: 600, color: '#475569' },
  input: { height: '34px', border: '1px solid #E2E8F0', borderRadius: '5px', padding: '0 10px', fontSize: '13px', color: '#1E293B' },
  formActions: { display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center' },
  inlineForm: { padding: '12px', backgroundColor: '#fff', borderRadius: '6px', border: '1px dashed #CBD5E1' },

  stepper: { display: 'flex', gap: '8px', marginBottom: '16px' },
  stepItem: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', backgroundColor: '#F1F5F9', fontSize: '12px', color: '#94A3B8' },
  stepActive: { backgroundColor: '#0A3D25', color: '#fff' },
  stepDone: { backgroundColor: '#D1FAE5', color: '#10B981' },
  stepNumber: { width: '20px', height: '20px', borderRadius: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(255,255,255,0.2)' },
  stepLabel: { fontWeight: 600, fontSize: '11px' },

  errorBox: { backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: '12px', fontWeight: 500, padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', border: '1px solid #FECACA', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  successBox: { backgroundColor: '#F0FDF4', color: '#16A34A', fontSize: '12px', fontWeight: 500, padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', border: '1px solid #BBF7D0' },
  dismissBtn: { background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '14px', padding: '0 4px' },

  statusBtnActive: { backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },
  statusBtnSuspend: { backgroundColor: '#F59E0B', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },
  statusBtnClose: { backgroundColor: '#EF4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },
};
