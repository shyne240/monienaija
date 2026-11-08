import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { formatFinancialAmount } from '../../utils/financial-display';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { useAuthStore } from '../../store/auth-store';
import { CustomerPersonalInformationPanel } from './CustomerPersonalInformationPanel';
import { CustomerProofOfAddressPanel } from './CustomerProofOfAddressPanel';
import { CustomerTier3ReadinessPanel } from './CustomerTier3ReadinessPanel';
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
  onCustomerGuardChange?: (guarded: boolean, busy: boolean) => void;
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

interface SafeResult<T> {
  value: T | null;
  status?: number;
}

interface OverviewData {
  customerId: string;
  phone: SafeResult<PhoneVerificationSummary>;
  readiness: SafeResult<ReadinessSummary>;
  eligibility: SafeResult<EligibilitySummary>;
  transactions: SafeResult<TransactionList>;
  wallets: SafeResult<{ data: Array<Omit<WalletSummary, 'balanceMinor'>> }>;
  balances: Record<string, SafeResult<{ balanceMinor: string | number; currency: string }>>;
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
  // Unsafe numeric payloads have already lost precision and cannot be displayed as exact.
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) return 'Amount unavailable';
  const value = String(amountMinor);
  if (!/^-?\d+$/.test(value) || !currency) return 'Amount unavailable';
  return formatFinancialAmount(value, currency);
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

export const Customer360Workspace: React.FC<Customer360WorkspaceProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([props.customer.id, sessionId, principal?.principalId, principal?.sessionId,
    principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel,
    principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <Customer360WorkspaceContent key={key} {...props} />;
};

const Customer360WorkspaceContent: React.FC<Customer360WorkspaceProps> = ({
  customer,
  onBack,
  onCustomerUpdated,
  onNavigate,
  onCustomerGuardChange,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const hasFunction = (code: string) => scopes.includes(code);
  const scopesKey = scopes.join('|');
  const [activeTab, setActiveTab] = useState<'overview' | 'personal' | 'proof'>('overview');
  const [personalGuard, setPersonalGuard] = useState(false);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [proofGuard, setProofGuard] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [pendingExit, setPendingExit] = useState<'overview' | 'personal' | 'proof' | 'back' | null>(null);
  const exitDialogRef = useRef<HTMLElement>(null);
  const reportPersonalGuard = useCallback((guarded: boolean, busy: boolean) => { setPersonalGuard(guarded); setPersonalBusy(busy); }, []);
  const reportProofGuard = useCallback((guarded: boolean, busy: boolean) => { setProofGuard(guarded); setProofBusy(busy); }, []);
  useEffect(() => () => onCustomerGuardChange?.(false, false), [onCustomerGuardChange]);
  useDialogFocus(exitDialogRef, Boolean(pendingExit), () => setPendingExit(null));
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewReloadVersion, setOverviewReloadVersion] = useState(0);
  const statusLock = useRef(false);
  const [statusUnconfirmed, setStatusUnconfirmed] = useState(false);
  const [statusReviewLoaded, setStatusReviewLoaded] = useState(false);
  const [statusReviewStatus, setStatusReviewStatus] = useState<string | null>(null);
  const [statusReviewBusy, setStatusReviewBusy] = useState(false);
  const statusReviewLock = useRef(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useDialogFocus(dialogRef, Boolean(pendingStatus), () => { if (!isUpdatingStatus) setPendingStatus(null); });
  useEffect(() => { onCustomerGuardChange?.(personalGuard || proofGuard || statusUnconfirmed || isUpdatingStatus || Boolean(pendingStatus), personalBusy || proofBusy || isUpdatingStatus || statusReviewBusy || Boolean(pendingStatus)); }, [onCustomerGuardChange, personalGuard, proofGuard, statusUnconfirmed, isUpdatingStatus, pendingStatus, personalBusy, proofBusy, statusReviewBusy]);
  useEffect(() => {
    if (!statusUnconfirmed && !isUpdatingStatus) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [statusUnconfirmed, isUpdatingStatus]);

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
      const walletItems = Array.isArray(wallets.value?.data) ? wallets.value.data : [];
      const balancePairs = await Promise.all(walletItems.map(async (wallet) => [
        wallet.id,
        await safeGet<{ balanceMinor: string | number; currency: string }>(
          `/internal/customers/${customerPath}/wallets/${encodeURIComponent(wallet.id)}/balance`,
        ),
      ] as const));
      const balances = Object.fromEntries(balancePairs) as OverviewData['balances'];
      if (!active) return;
      setOverview({ customerId: customer.id, phone, readiness, eligibility, transactions, wallets, balances });
      setOverviewLoading(false);
    }).catch(() => {
      if (!active) return;
      setOverview({
        customerId: customer.id,
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
  }, [customer.id, scopesKey, overviewReloadVersion]);

  const customerName = displayName(customer);
  const visibleOverview = overview?.customerId === customer.id ? overview : null;
  const phoneData = visibleOverview?.phone.value;
  const phone = phoneData && phoneData.customerId === customer.id && Array.isArray(phoneData.phones) && typeof phoneData.activationGate?.verifiedPrimaryPhone === 'boolean' ? phoneData : null;
  const readinessData = visibleOverview?.readiness.value;
  const readiness = readinessData && ['READY', 'NOT_READY'].includes(readinessData.status) && Array.isArray(readinessData.missing) ? readinessData : null;
  const eligibilityData = visibleOverview?.eligibility.value;
  const eligibility = eligibilityData && typeof eligibilityData.status === 'string' && eligibilityData.status ? eligibilityData : null;
  const primaryPhone = phone?.phones?.find((item) => item.isPrimary) ?? null;
  const transactionItems = Array.isArray(visibleOverview?.transactions.value?.items) ? visibleOverview.transactions.value.items : [];
  const walletItems = Array.isArray(visibleOverview?.wallets.value?.data) ? visibleOverview.wallets.value.data : [];
  const walletsAvailable = Array.isArray(visibleOverview?.wallets.value?.data);
  const transactionsAvailable = Array.isArray(visibleOverview?.transactions.value?.items);
  const walletCountLabel = walletItems.length === 1 ? '1 wallet' : `${walletItems.length} wallets`;
  const awaitingOverview = overviewLoading || !visibleOverview;
  const tabs = ['overview', 'personal', 'proof'] as const;
  const tabIds = ['customer-overview-tab', 'customer-personal-tab', 'customer-proof-address-tab'];
  const requestTab = (tab: 'overview' | 'personal' | 'proof') => {
    const guarded = activeTab === 'personal' ? personalGuard : activeTab === 'proof' ? proofGuard : false;
    const busy = activeTab === 'personal' ? personalBusy : activeTab === 'proof' ? proofBusy : false;
    if (tab !== activeTab && guarded) { if (!busy) setPendingExit(tab); return false; }
    setActiveTab(tab); return true;
  };
  const requestBack = () => {
    const guarded = statusUnconfirmed || (activeTab === 'personal' ? personalGuard : activeTab === 'proof' ? proofGuard : false);
    const busy = isUpdatingStatus || statusReviewBusy || (activeTab === 'personal' ? personalBusy : activeTab === 'proof' ? proofBusy : false);
    if (guarded) { if (!busy) setPendingExit('back'); return; }
    onBack();
  };
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    if (requestTab(tabs[next])) document.getElementById(tabIds[next])?.focus();
  };

  const availableStatusActions = useMemo(() => {
    const actions: Array<{ status: string; label: string; tone?: string }> = [];
    if (principal?.readOnlyPrincipal) return actions;
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
  }, [customer.status, scopesKey, principal?.readOnlyPrincipal]);

  const confirmStatusChange = async () => {
    if (!pendingStatus || !principal || principal.readOnlyPrincipal || statusUnconfirmed || isUpdatingStatus || statusLock.current) return;
    statusLock.current = true;
    setIsUpdatingStatus(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await ApiClient.patch<DirectoryCustomer>(`/customers/${encodeURIComponent(customer.id)}`, {
        status: pendingStatus,
      });
      if (!mounted.current) return;
      if (!updated || updated.id !== customer.id || updated.status !== pendingStatus) throw new Error('Unconfirmed lifecycle receipt');
      onCustomerUpdated({ ...customer, ...updated });
      setActionMessage(`Customer status updated to ${pendingStatus}.`);
      setPendingStatus(null);
    } catch (error) {
      if (!mounted.current) return;
      const status = error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
      if (![400, 401, 403, 404].includes(status ?? 0)) { setStatusUnconfirmed(true); setStatusReviewLoaded(false); }
      setActionError(status === 409
        ? 'The status change conflicted with the current lifecycle state. Refresh and review the customer before another action.'
        : status === 400
        ? 'The status change was blocked by a customer lifecycle rule.'
        : status === 401 || status === 403 || status === 404
          ? 'The customer status change was rejected or the customer is unavailable.'
          : 'The customer status change could not be confirmed. Return to the directory, refresh and review the customer record before any later action. This safeguard is local to this workspace.');
    } finally {
      statusLock.current = false;
      if (mounted.current) setIsUpdatingStatus(false);
    }
  };

  const refreshStatusForReview = async () => {
    if (!statusUnconfirmed || statusReviewLock.current || isUpdatingStatus) return;
    statusReviewLock.current = true;
    setStatusReviewBusy(true);
    setStatusReviewLoaded(false);
    setStatusReviewStatus(null);
    try {
      const fresh = await ApiClient.get<DirectoryCustomer>(`/internal/customers/${encodeURIComponent(customer.id)}`);
      if (!mounted.current) return;
      if (!fresh || fresh.id !== customer.id || typeof fresh.reference !== 'string' || !['INDIVIDUAL', 'BUSINESS'].includes(fresh.type) ||
          !['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'].includes(fresh.status) || typeof fresh.kycLevel !== 'string' || typeof fresh.kycStatus !== 'string' ||
          (typeof fresh.createdAt !== 'string' && !(fresh.createdAt instanceof Date)) ||
          (fresh.displayName != null && typeof fresh.displayName !== 'string') || (fresh.legalName != null && typeof fresh.legalName !== 'string')) throw new Error('Invalid customer record');
      onCustomerUpdated({ ...customer, ...fresh, primaryContact: null });
      setStatusReviewStatus(fresh.status);
      setStatusReviewLoaded(true);
      setActionError(null);
    } catch {
      if (mounted.current) setActionError('Customer status review could not be loaded. Actions remain locked.');
    } finally {
      statusReviewLock.current = false;
      if (mounted.current) setStatusReviewBusy(false);
    }
  };

  return (
    <main className="customer-management cm-workspace">
      <div className="cm-workspace-topline">
        <button className="cm-back-button" type="button" onClick={requestBack} disabled={isUpdatingStatus || statusReviewBusy || (activeTab === 'personal' && personalBusy) || (activeTab === 'proof' && proofBusy)}>← Back to directory</button>
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
          tabIndex={activeTab === 'overview' ? 0 : -1}
          onKeyDown={(event) => handleTabKey(event, 0)}
          aria-controls="customer-overview-panel"
          onClick={() => requestTab('overview')}
        >
          Overview
        </button>
        <button
          id="customer-personal-tab"
          className={`cm-tab ${activeTab === 'personal' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'personal'}
          tabIndex={activeTab === 'personal' ? 0 : -1}
          onKeyDown={(event) => handleTabKey(event, 1)}
          aria-controls="customer-personal-panel"
          onClick={() => requestTab('personal')}
        >
          Personal information & contact
        </button>
        <button
          id="customer-proof-address-tab"
          className={`cm-tab ${activeTab === 'proof' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'proof'}
          tabIndex={activeTab === 'proof' ? 0 : -1}
          onKeyDown={(event) => handleTabKey(event, 2)}
          aria-controls="customer-proof-address-panel"
          onClick={() => requestTab('proof')}
        >
          Proof of Address & physical verification
        </button>
      </div>

      {actionMessage && <div className="cm-notice" role="status">{actionMessage}</div>}
      {actionError && !pendingStatus && <div className="cm-error" role="alert">{actionError}</div>}
      {statusUnconfirmed && !pendingStatus && <section className="cm-policy-notice cm-policy-notice-warning" aria-labelledby="cm-status-review-title">
        <h2 id="cm-status-review-title">Customer lifecycle review required</h2>
        <p>The previous action may have taken effect or conflicted. Refresh the customer and inspect its current status and available audit history before another action. A refresh cannot rule out a late commit. This lock is local and is lost on exit or session change.</p>
        <button type="button" className="cm-button cm-button-secondary" disabled={statusReviewBusy} onClick={() => void refreshStatusForReview()}>{statusReviewBusy ? 'Refreshing…' : 'Refresh customer for lifecycle review'}</button>
        {statusReviewLoaded && <p>Current returned status: <strong>{statusReviewStatus}</strong>. <button type="button" className="cm-button cm-button-secondary" onClick={() => { setStatusUnconfirmed(false); setStatusReviewLoaded(false); setActionMessage('Review acknowledged. Check the current status and audit history before a new action.'); }}>I reviewed customer status and audit history</button></p>}
      </section>}

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
                      disabled={statusUnconfirmed}
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
              {awaitingOverview ? <p className="cm-muted">Loading readiness…</p> : readiness ? (
                <>
                  <p className={`cm-large-value ${readiness.status === 'READY' ? 'cm-positive' : 'cm-warning'}`}>
                    {readiness.status === 'READY' ? 'Ready' : 'Not ready'}
                  </p>
                  <p className="cm-supporting-text">Onboarding state: {readiness.onboardingStatus ?? 'Not started'}</p>
                  <p className="cm-muted">{readiness.missing.length} outstanding readiness item{readiness.missing.length === 1 ? '' : 's'}</p>
                </>
              ) : <p className="cm-muted">{hasFunction('customer.view') ? 'Readiness summary is unavailable.' : 'Readiness is restricted.'}</p>}
            </article>

            <article className="cm-card">
              <div className="cm-card-heading"><div><p className="cm-eyebrow">ELIGIBILITY</p><h2>Operating decision</h2></div></div>
              {awaitingOverview ? <p className="cm-muted">Loading eligibility…</p> : eligibility ? (
                <>
                  <p className="cm-large-value">{eligibility.status}</p>
                  <p className="cm-muted">Updated {formatDateTime(eligibility.statusChangedAt)}</p>
                </>
              ) : <p className="cm-muted">{visibleOverview?.eligibility.status === 404 ? 'No eligibility decision recorded.' : hasFunction('customer.view') ? 'Eligibility summary is unavailable.' : 'Eligibility is restricted.'}</p>}
            </article>

            <CustomerTier3ReadinessPanel
              customerType={customer.type}
              customerStatus={customer.status}
              phoneVerified={phone ? Boolean(phone.activationGate?.verifiedPrimaryPhone) : null}
              kycLevel={customer.kycLevel}
              kycStatus={customer.kycStatus}
              financialEligibility={eligibility?.status ?? null}
              signalsLoading={awaitingOverview}
            />

            <article className="cm-card cm-card-wide">
              <div className="cm-card-heading">
                <div><p className="cm-eyebrow">WALLET</p><h2>Wallet summary</h2></div>
                {hasFunction('customer.view_wallets') && !awaitingOverview && walletsAvailable && <span className="cm-chip">{walletCountLabel}</span>}
              </div>
              {!hasFunction('customer.view_wallets') ? <p className="cm-muted">Wallet information is restricted to authorized wallet viewers.</p>
                : awaitingOverview ? <p className="cm-muted">Loading ledger balances…</p>
                  : !walletsAvailable ? <p className="cm-muted" role="status">Wallet information is unavailable.</p>
                  : walletItems.length === 0 ? <p className="cm-empty-state">No financial wallets are recorded for this customer.</p>
                    : (
                      <div className="cm-wallet-grid">
                        {walletItems.map((wallet) => {
                          const balanceResult = visibleOverview?.balances[wallet.id];
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
                : awaitingOverview ? <p className="cm-muted">Loading recent transactions…</p>
                  : !transactionsAvailable ? <p className="cm-muted" role="status">Recent transactions are unavailable.</p>
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
      ) : activeTab === 'personal' ? (
        <section id="customer-personal-panel" role="tabpanel" aria-labelledby="customer-personal-tab" className="cm-workspace-content">
          <CustomerPersonalInformationPanel
            customerId={customer.id}
            customerType={customer.type}
            onGuardChange={reportPersonalGuard}
            onProfileUpdated={(profile) => onCustomerUpdated({
              ...customer,
              displayName: profile.displayName,
              legalName: profile.legalName,
            })}
            onVerificationUpdated={() => setOverviewReloadVersion((version) => version + 1)}
          />
        </section>
      ) : (
        <section id="customer-proof-address-panel" role="tabpanel" aria-labelledby="customer-proof-address-tab" className="cm-workspace-content">
          <CustomerProofOfAddressPanel customerId={customer.id} onGuardChange={reportProofGuard} />
        </section>
      )}

      {pendingExit && (
        <div className="cm-modal-backdrop" role="presentation">
          <section ref={exitDialogRef} tabIndex={-1} className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cm-personal-exit-title">
            <h2 id="cm-personal-exit-title">Leave {activeTab === 'proof' ? 'Proof of Address' : activeTab === 'personal' ? 'personal information' : 'customer review'}?</h2>
            <p>Leaving discards the local draft, any one-time proof or upload retry key, and local uncertain-outcome locks. An earlier action may already have occurred. Inspect current records and audit history before acting again.</p>
            <div className="cm-actions-row">
              <button type="button" className="cm-button cm-button-secondary" onClick={() => setPendingExit(null)}>Keep working</button>
              <button type="button" className="cm-button cm-button-danger" onClick={() => { const destination = pendingExit; setPendingExit(null); if (activeTab === 'proof') reportProofGuard(false, false); else reportPersonalGuard(false, false); if (destination === 'back') onBack(); else setActiveTab(destination); }}>Discard and leave</button>
            </div>
          </section>
        </div>
      )}
      {pendingStatus && (
        <div className="cm-modal-backdrop" role="presentation">
          <section ref={dialogRef} tabIndex={-1} className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cm-confirm-title">
            <p className="cm-eyebrow">LIFECYCLE CHANGE</p>
            <h2 id="cm-confirm-title">Confirm {pendingStatus === 'CLOSED' ? 'customer closure' : pendingStatus.toLowerCase()}</h2>
            <p>Change <strong>{customerName}</strong> from {customer.status} to {pendingStatus}?</p>
            {pendingStatus === 'ACTIVE' && (
              <p className="cm-confirm-note">Activation will be rejected unless the customer has a verified primary phone.</p>
            )}
            {actionError && <div className="cm-error" role="alert">{actionError}</div>}
            <div className="cm-actions-row">
              <button className="cm-button cm-button-secondary" type="button" disabled={isUpdatingStatus} onClick={() => setPendingStatus(null)}>Cancel</button>
              <button className="cm-button cm-button-primary" type="button" disabled={isUpdatingStatus || statusUnconfirmed} onClick={confirmStatusChange}>
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
