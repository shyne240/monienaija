import React, { useEffect, useMemo, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { maskContactValue, maskCustomerReference } from './customer-masking';

export interface DirectoryCustomer {
  id: string;
  reference: string;
  type: string;
  status: string;
  kycLevel: string;
  kycStatus: string;
  createdAt: string | Date;
  displayName?: string | null;
  legalName?: string | null;
  primaryContact?: {
    type: string;
    maskedValue: string;
    isVerified: boolean;
  } | null;
}

interface Customer360WorkspaceProps {
  customer: DirectoryCustomer;
  onBack: () => void;
  onCustomerUpdated: (customer: DirectoryCustomer) => void;
  onNavigate?: (view: string, customerId: string) => void;
}

interface PhoneVerificationSummary {
  customerId: string;
  customerStatus: string;
  phones: Array<{ isPrimary: boolean; maskedValue: string; verifiedAt: string | null }>;
  activationGate: { verifiedPrimaryPhone: boolean };
}

interface WalletSummary {
  id: string;
  currency: string;
  status: string;
  balanceMinor?: string | number;
}

interface TransactionSummary {
  id: string;
  type: string;
  status: string;
  amountMinor: string;
  currency: string;
  direction: string;
  createdAt: string | Date;
  counterparty?: unknown;
}

interface TransactionList {
  items: TransactionSummary[];
}

interface ReadinessSummary {
  status: 'READY' | 'NOT_READY';
  onboardingStatus: string | null;
  missing: string[];
}

interface EligibilitySummary {
  status: string;
  statusChangedAt: string | Date;
}

interface ProfileSummary {
  displayName: string | null;
  legalName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
}

interface AddressSummary {
  id: string;
  type: string;
  lineOne: string;
  lineTwo?: string | null;
  city: string;
  state: string;
  country: string;
  postalCode?: string | null;
  isPrimary: boolean;
}

interface ContactSummary {
  id: string;
  type: string;
  value: string;
  isPrimary: boolean;
  verifiedAt: string | Date | null;
}

interface SafeResult<T> {
  value: T | null;
  status?: number;
}

interface OverviewData {
  phone: SafeResult<PhoneVerificationSummary>;
  readiness: SafeResult<ReadinessSummary>;
  eligibility: SafeResult<EligibilitySummary>;
  transactions: SafeResult<TransactionList>;
  wallets: SafeResult<{ data: Array<Omit<WalletSummary, 'balanceMinor'>> }>;
  balances: Record<string, SafeResult<{ balanceMinor: string | number; currency: string }>>;
}

interface PersonalData {
  profile: SafeResult<ProfileSummary>;
  addresses: SafeResult<AddressSummary[]> | null;
  contacts: SafeResult<ContactSummary[]> | null;
}

const CUSTOMER_STATUSES: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};

function displayName(customer: DirectoryCustomer): string {
  return customer.displayName?.trim() || customer.legalName?.trim() || 'Name not recorded';
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMinorAmount(amountMinor: string | number, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return 'Balance unavailable';
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

async function safeGet<T>(path: string): Promise<SafeResult<T>> {
  try {
    return { value: await ApiClient.get<T>(path) };
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
    return { value: null, status };
  }
}

export const Customer360Workspace: React.FC<Customer360WorkspaceProps> = ({
  customer,
  onBack,
  onCustomerUpdated,
  onNavigate,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const hasFunction = (code: string) => scopes.includes(code);
  const scopesKey = scopes.join('|');
  const [activeTab, setActiveTab] = useState<'overview' | 'personal'>('overview');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [personal, setPersonal] = useState<PersonalData | null>(null);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [showContactValues, setShowContactValues] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const customerPath = encodeURIComponent(customer.id);
    setOverviewLoading(true);

    const phonePromise = hasFunction('customer.view')
      ? safeGet<PhoneVerificationSummary>(`/internal/customers/${customerPath}/phone-verification`)
      : Promise.resolve({ value: null });
    const readinessPromise = hasFunction('customer.view')
      ? safeGet<ReadinessSummary>(`/customers/${customerPath}/onboarding-readiness`)
      : Promise.resolve({ value: null });
    const eligibilityPromise = hasFunction('customer.view')
      ? safeGet<EligibilitySummary>(`/customers/${customerPath}/eligibility`)
      : Promise.resolve({ value: null });
    const transactionsPromise = hasFunction('customer.view_transactions')
      ? safeGet<TransactionList>(`/internal/customers/${customerPath}/transactions?page=1&limit=5`)
      : Promise.resolve({ value: null });
    const walletsPromise = hasFunction('customer.view_wallets')
      ? safeGet<{ data: Array<Omit<WalletSummary, 'balanceMinor'>> }>(`/internal/customers/${customerPath}/wallets`)
      : Promise.resolve({ value: null });

    Promise.all([
      phonePromise,
      readinessPromise,
      eligibilityPromise,
      transactionsPromise,
      walletsPromise,
    ]).then(async ([phone, readiness, eligibility, transactions, wallets]) => {
      const walletItems = wallets.value?.data ?? [];
      const balancePairs = await Promise.all(walletItems.map(async (wallet) => [
        wallet.id,
        await safeGet<{ balanceMinor: string | number; currency: string }>(
          `/internal/customers/${customerPath}/wallets/${encodeURIComponent(wallet.id)}/balance`,
        ),
      ] as const));
      const balances = Object.fromEntries(balancePairs) as OverviewData['balances'];
      if (!active) return;
      setOverview({ phone, readiness, eligibility, transactions, wallets, balances });
      setOverviewLoading(false);
    }).catch(() => {
      if (!active) return;
      setOverview({
        phone: { value: null },
        readiness: { value: null },
        eligibility: { value: null },
        transactions: { value: null },
        wallets: { value: null },
        balances: {},
      });
      setOverviewLoading(false);
    });

    return () => {
      active = false;
    };
  }, [customer.id, scopesKey]);

  useEffect(() => {
    if (activeTab !== 'personal') return;
    let active = true;
    const customerPath = encodeURIComponent(customer.id);
    setPersonalLoading(true);
    setShowContactValues(false);

    const profilePromise = hasFunction('customer.view')
      ? safeGet<ProfileSummary>(`/customers/${customerPath}/profile`)
      : Promise.resolve({ value: null });
    const addressPromise = hasFunction('customer.view_address')
      ? safeGet<AddressSummary[]>(`/customers/${customerPath}/addresses`)
      : Promise.resolve(null);
    const contactPromise = hasFunction('customer.view_contact_methods')
      ? safeGet<ContactSummary[]>(`/customers/${customerPath}/contact-methods`)
      : Promise.resolve(null);

    Promise.all([profilePromise, addressPromise, contactPromise]).then(([profile, addresses, contacts]) => {
      if (!active) return;
      setPersonal({ profile, addresses, contacts });
      setPersonalLoading(false);
    }).catch(() => {
      if (!active) return;
      setPersonal({
        profile: { value: null },
        addresses: hasFunction('customer.view_address') ? { value: null } : null,
        contacts: hasFunction('customer.view_contact_methods') ? { value: null } : null,
      });
      setPersonalLoading(false);
    });

    return () => {
      active = false;
    };
  }, [activeTab, customer.id, scopesKey]);

  const customerName = displayName(customer);
  const phone = overview?.phone.value;
  const primaryPhone = phone?.phones?.find((item) => item.isPrimary) ?? null;
  const transactionItems = overview?.transactions.value?.items ?? [];
  const walletItems = overview?.wallets.value?.data ?? [];
  const walletCountLabel = walletItems.length === 1 ? '1 wallet' : `${walletItems.length} wallets`;

  const availableStatusActions = useMemo(() => {
    const actions: Array<{ status: string; label: string; tone?: string }> = [];
    if (customer.status === 'DRAFT' && hasFunction('customer.activate')) {
      actions.push({ status: 'ACTIVE', label: 'Activate' });
    }
    if (customer.status === 'ACTIVE' && hasFunction('customer.suspend')) {
      actions.push({ status: 'SUSPENDED', label: 'Suspend', tone: 'danger' });
    }
    if (customer.status === 'SUSPENDED' && hasFunction('customer.activate')) {
      actions.push({ status: 'ACTIVE', label: 'Reactivate' });
    }
    if (customer.status !== 'CLOSED' && hasFunction('customer.close')) {
      actions.push({ status: 'CLOSED', label: 'Close customer', tone: 'danger' });
    }
    return actions;
  }, [customer.status, scopesKey]);

  const confirmStatusChange = async () => {
    if (!pendingStatus || !principal || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await ApiClient.patch<DirectoryCustomer>(`/customers/${encodeURIComponent(customer.id)}`, {
        status: pendingStatus,
      });
      onCustomerUpdated({ ...customer, ...updated });
      setActionMessage(`Customer status updated to ${pendingStatus}.`);
      setPendingStatus(null);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
      setActionError(status === 400 || status === 409
        ? 'The status change was blocked by a customer lifecycle rule.'
        : 'The customer status could not be updated. Try again or contact an administrator.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <main className="customer-management cm-workspace">
      <div className="cm-workspace-topline">
        <button className="cm-back-button" type="button" onClick={onBack}>← Back to directory</button>
        <span className="cm-workspace-label">CUSTOMER 360°</span>
      </div>

      <header className="cm-profile-header">
        <div className="cm-avatar" aria-hidden="true">{customerName.slice(0, 1).toUpperCase()}</div>
        <div className="cm-profile-heading">
          <p className="cm-eyebrow">CUSTOMER PROFILE</p>
          <h1>{customerName}</h1>
          {customer.legalName && customer.displayName && customer.legalName !== customer.displayName && (
            <p className="cm-subtitle">Legal name: {customer.legalName}</p>
          )}
          <div className="cm-profile-chips">
            <span className={`cm-status cm-status-${customer.status.toLowerCase()}`}>{CUSTOMER_STATUSES[customer.status] ?? customer.status}</span>
            <span className="cm-chip">{customer.type}</span>
            <span className="cm-chip">{customer.kycLevel} · {customer.kycStatus}</span>
            <span className="cm-reference">{maskCustomerReference(customer.reference)}</span>
          </div>
        </div>
      </header>

      <div className="cm-tabs" role="tablist" aria-label="Customer 360 sections">
        <button
          id="customer-overview-tab"
          className={`cm-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          aria-controls="customer-overview-panel"
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          id="customer-personal-tab"
          className={`cm-tab ${activeTab === 'personal' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'personal'}
          aria-controls="customer-personal-panel"
          onClick={() => setActiveTab('personal')}
        >
          Personal information & contact
        </button>
      </div>

      {actionMessage && <div className="cm-notice" role="status">{actionMessage}</div>}
      {actionError && <div className="cm-error" role="alert">{actionError}</div>}

      {activeTab === 'overview' ? (
        <section id="customer-overview-panel" role="tabpanel" aria-labelledby="customer-overview-tab" className="cm-workspace-content">
          <div className="cm-overview-grid">
            <article className="cm-card cm-card-wide">
              <div className="cm-card-heading">
                <div>
                  <p className="cm-eyebrow">CUSTOMER SUMMARY</p>
                  <h2>Profile overview</h2>
                </div>
                <span className={`cm-status cm-status-${customer.status.toLowerCase()}`}>{CUSTOMER_STATUSES[customer.status] ?? customer.status}</span>
              </div>
              <dl className="cm-detail-grid">
                <div><dt>Display name</dt><dd>{customer.displayName || 'Not recorded'}</dd></div>
                <div><dt>Legal name</dt><dd>{customer.legalName || 'Not recorded'}</dd></div>
                <div><dt>Customer type</dt><dd>{customer.type}</dd></div>
                <div><dt>Registration date</dt><dd>{formatDate(customer.createdAt)}</dd></div>
                <div><dt>KYC level</dt><dd>{customer.kycLevel}</dd></div>
                <div><dt>KYC status</dt><dd>{customer.kycStatus}</dd></div>
                <div><dt>Primary contact</dt><dd>{primaryPhone?.maskedValue ?? customer.primaryContact?.maskedValue ?? (hasFunction('customer.view') ? 'Not recorded' : 'Restricted')}</dd></div>
                <div><dt>Phone verification</dt><dd>{phone?.activationGate?.verifiedPrimaryPhone ? 'Verified primary phone' : phone ? 'Not verified' : hasFunction('customer.view') ? 'Unavailable' : 'Restricted'}</dd></div>
              </dl>
              <details className="cm-technical-details">
                <summary>Technical details</summary>
                <dl>
                  <div><dt>Customer ID</dt><dd><code>{customer.id}</code></dd></div>
                  <div><dt>Reference</dt><dd><code>{maskCustomerReference(customer.reference)}</code></dd></div>
                </dl>
              </details>
              {availableStatusActions.length > 0 && (
                <div className="cm-actions-row" aria-label="Customer lifecycle actions">
                  {availableStatusActions.map((action) => (
                    <button
                      key={action.status}
                      className={`cm-button ${action.tone === 'danger' ? 'cm-button-danger' : 'cm-button-primary'}`}
                      type="button"
                      onClick={() => { setPendingStatus(action.status); setActionError(null); }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </article>

            <article className="cm-card">
              <div className="cm-card-heading"><div><p className="cm-eyebrow">KYC</p><h2>Verification summary</h2></div></div>
              <p className="cm-large-value">{customer.kycLevel}</p>
              <p className="cm-supporting-text">Current KYC state: <strong>{customer.kycStatus}</strong></p>
              {!hasFunction('kyc.view') && <p className="cm-muted">Assessment details are restricted to authorized KYC roles.</p>}
            </article>

            <article className="cm-card">
              <div className="cm-card-heading"><div><p className="cm-eyebrow">ONBOARDING</p><h2>Readiness</h2></div></div>
              {overviewLoading ? <p className="cm-muted">Loading readiness…</p> : overview?.readiness.value ? (
                <>
                  <p className={`cm-large-value ${overview.readiness.value.status === 'READY' ? 'cm-positive' : 'cm-warning'}`}>
                    {overview.readiness.value.status === 'READY' ? 'Ready' : 'Not ready'}
                  </p>
                  <p className="cm-supporting-text">Onboarding state: {overview.readiness.value.onboardingStatus ?? 'Not started'}</p>
                  <p className="cm-muted">{overview.readiness.value.missing.length} outstanding readiness item{overview.readiness.value.missing.length === 1 ? '' : 's'}</p>
                </>
              ) : <p className="cm-muted">{hasFunction('customer.view') ? 'Readiness summary is unavailable.' : 'Readiness is restricted.'}</p>}
            </article>

            <article className="cm-card">
              <div className="cm-card-heading"><div><p className="cm-eyebrow">ELIGIBILITY</p><h2>Operating decision</h2></div></div>
              {overviewLoading ? <p className="cm-muted">Loading eligibility…</p> : overview?.eligibility.value ? (
                <>
                  <p className="cm-large-value">{overview.eligibility.value.status}</p>
                  <p className="cm-muted">Updated {formatDateTime(overview.eligibility.value.statusChangedAt)}</p>
                </>
              ) : <p className="cm-muted">{overview?.eligibility.status === 404 ? 'No eligibility decision recorded.' : hasFunction('customer.view') ? 'Eligibility summary is unavailable.' : 'Eligibility is restricted.'}</p>}
            </article>

            <article className="cm-card cm-card-wide">
              <div className="cm-card-heading">
                <div><p className="cm-eyebrow">WALLET</p><h2>Wallet summary</h2></div>
                {hasFunction('customer.view_wallets') && <span className="cm-chip">{walletCountLabel}</span>}
              </div>
              {!hasFunction('customer.view_wallets') ? <p className="cm-muted">Wallet information is restricted to authorized wallet viewers.</p>
                : overviewLoading ? <p className="cm-muted">Loading ledger balances…</p>
                  : walletItems.length === 0 ? <p className="cm-empty-state">No financial wallets are recorded for this customer.</p>
                    : (
                      <div className="cm-wallet-grid">
                        {walletItems.map((wallet) => {
                          const balanceResult = overview?.balances[wallet.id];
                          return (
                            <div className="cm-wallet-item" key={wallet.id}>
                              <div><span className="cm-wallet-currency">{wallet.currency}</span><span className="cm-secondary-line">{wallet.status}</span></div>
                              <strong>{balanceResult?.value ? formatMinorAmount(balanceResult.value.balanceMinor, balanceResult.value.currency) : 'Balance unavailable'}</strong>
                              <span className="cm-secondary-line">Ledger-derived balance</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
            </article>

            <article className="cm-card cm-card-wide">
              <div className="cm-card-heading">
                <div><p className="cm-eyebrow">ACTIVITY</p><h2>Recent transactions</h2></div>
                {hasFunction('customer.view_transactions') && onNavigate && (
                  <button className="cm-text-button" type="button" onClick={() => onNavigate('transfers', customer.id)}>
                    Open transaction workspace →
                  </button>
                )}
              </div>
              {!hasFunction('customer.view_transactions') ? <p className="cm-muted">Transaction history is restricted to authorized transaction viewers.</p>
                : overviewLoading ? <p className="cm-muted">Loading recent transactions…</p>
                  : transactionItems.length === 0 ? <p className="cm-empty-state">No recent transactions are available.</p>
                    : (
                      <div className="cm-transaction-list">
                        {transactionItems.map((transaction) => (
                          <div className="cm-transaction-row" key={transaction.id}>
                            <div>
                              <strong>{transaction.type.replace(/_/g, ' ')}</strong>
                              <span className="cm-secondary-line">{formatDateTime(transaction.createdAt)} · {transaction.direction}</span>
                              {safeCounterpartyLabel(transaction.counterparty) && <span className="cm-secondary-line">Counterparty: {safeCounterpartyLabel(transaction.counterparty)}</span>}
                            </div>
                            <div className="cm-transaction-amount">
                              <strong>{formatMinorAmount(transaction.amountMinor, transaction.currency)}</strong>
                              <span className="cm-secondary-line">{transaction.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
            </article>
          </div>
        </section>
      ) : (
        <section id="customer-personal-panel" role="tabpanel" aria-labelledby="customer-personal-tab" className="cm-workspace-content">
          {personalLoading && <div className="cm-panel cm-loading-panel">Loading authorized profile and contact details…</div>}
          {!personalLoading && personal && (
            <div className="cm-personal-grid">
              <article className="cm-card cm-card-wide">
                <div className="cm-card-heading"><div><p className="cm-eyebrow">PROFILE</p><h2>Personal information</h2></div></div>
                {!hasFunction('customer.view') ? <p className="cm-muted">Profile information is restricted to authorized customer viewers.</p>
                  : personal.profile.value ? (
                    <dl className="cm-detail-grid">
                      <div><dt>Display name</dt><dd>{personal.profile.value.displayName || 'Not recorded'}</dd></div>
                      <div><dt>Legal name</dt><dd>{personal.profile.value.legalName || 'Not recorded'}</dd></div>
                      <div><dt>Date of birth</dt><dd>{personal.profile.value.dateOfBirth ? formatDate(personal.profile.value.dateOfBirth) : 'Not recorded'}</dd></div>
                      <div><dt>Nationality</dt><dd>{personal.profile.value.nationality || 'Not recorded'}</dd></div>
                    </dl>
                  ) : personal.profile.status === 404 ? <p className="cm-empty-state">No personal profile has been recorded.</p>
                    : <p className="cm-muted">Personal information is unavailable.</p>}
              </article>

              <article className="cm-card">
                <div className="cm-card-heading">
                  <div><p className="cm-eyebrow">CONTACT METHODS</p><h2>Phones and email</h2></div>
                  {hasFunction('customer.view_contact_methods') && personal.contacts?.value && personal.contacts.value.length > 0 && (
                    <button className="cm-button cm-button-secondary" type="button" aria-pressed={showContactValues} onClick={() => setShowContactValues((value) => !value)}>
                      {showContactValues ? 'Mask values' : 'Show values'}
                    </button>
                  )}
                </div>
                {!hasFunction('customer.view_contact_methods') ? <p className="cm-muted">Contact details are restricted to authorized contact-method viewers.</p>
                  : personal.contacts?.value?.length ? (
                    <ul className="cm-record-list">
                      {personal.contacts.value.map((contact) => (
                        <li key={contact.id}>
                          <div>
                            <strong>{contact.type}</strong>
                            <span className="cm-secondary-line">{contact.isPrimary ? 'Primary' : 'Additional'} · {contact.verifiedAt ? 'Verified' : 'Not verified'}</span>
                          </div>
                          <span className="cm-record-value">{showContactValues ? contact.value : maskContactValue(contact.value)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : personal.contacts?.status === 404 || personal.contacts?.value?.length === 0
                    ? <p className="cm-empty-state">No phone number or email has been recorded.</p>
                    : <p className="cm-muted">Contact information is unavailable.</p>}
              </article>

              <article className="cm-card cm-card-wide">
                <div className="cm-card-heading"><div><p className="cm-eyebrow">ADDRESSES</p><h2>Recorded addresses</h2></div></div>
                {!hasFunction('customer.view_address') ? <p className="cm-muted">Address details are restricted to authorized address viewers.</p>
                  : personal.addresses?.value?.length ? (
                    <div className="cm-address-grid">
                      {personal.addresses.value.map((address) => (
                        <div className="cm-address-item" key={address.id}>
                          <div className="cm-address-title"><strong>{address.type}</strong>{address.isPrimary && <span className="cm-chip">Primary</span>}</div>
                          <p>{address.lineOne}{address.lineTwo ? `, ${address.lineTwo}` : ''}</p>
                          <p>{address.city}, {address.state} {address.postalCode || ''}</p>
                          <p>{address.country}</p>
                        </div>
                      ))}
                    </div>
                  ) : personal.addresses?.status === 404 || personal.addresses?.value?.length === 0
                    ? <p className="cm-empty-state">No address has been recorded.</p>
                    : <p className="cm-muted">Address information is unavailable.</p>}
              </article>
            </div>
          )}
        </section>
      )}

      {pendingStatus && (
        <div className="cm-modal-backdrop" role="presentation">
          <section className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cm-confirm-title">
            <p className="cm-eyebrow">LIFECYCLE CHANGE</p>
            <h2 id="cm-confirm-title">Confirm {pendingStatus === 'CLOSED' ? 'customer closure' : pendingStatus.toLowerCase()}</h2>
            <p>Change <strong>{customerName}</strong> from {customer.status} to {pendingStatus}?</p>
            {pendingStatus === 'ACTIVE' && (
              <p className="cm-confirm-note">Activation will be rejected unless the customer has a verified primary phone.</p>
            )}
            <div className="cm-actions-row">
              <button className="cm-button cm-button-secondary" type="button" disabled={isUpdatingStatus} onClick={() => setPendingStatus(null)}>Cancel</button>
              <button className="cm-button cm-button-primary" type="button" disabled={isUpdatingStatus} onClick={confirmStatusChange}>
                {isUpdatingStatus ? 'Updating…' : 'Confirm change'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};

function safeCounterpartyLabel(counterparty: unknown): string | null {
  if (!counterparty || typeof counterparty !== 'object') return null;
  const value = counterparty as Record<string, unknown>;
  if (typeof value.maskedContact === 'string') return value.maskedContact;
  const candidate = [
    value.phone,
    value.phoneNumber,
    value.contactValue,
    value.receivingNumber,
    value.beneficiaryPhone,
    value.accountNumber,
  ].find((entry) => typeof entry === 'string');
  return typeof candidate === 'string' ? maskContactValue(candidate) : null;
}
