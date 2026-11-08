import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import {
  Alert,
  Button,
  Field,
  PageHeader,
  ScrollRegion,
  StatusBadge,
  type StatusShape,
  type StatusTone,
} from '../../design-system/primitives';
import { CustomerRegistrationWizard, type CustomerRegistrationWizardHandle } from './CustomerRegistrationWizard';
import { maskCustomerReference } from './customer-masking';
import { Customer360Workspace, type DirectoryCustomer } from './Customer360Workspace';
import '../../design-system/tokens.css';
import './customer-management.css';
import './customer-directory-pilot.css';

interface CustomerDirectoryResponse {
  data: DirectoryCustomer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface CustomerDirectoryScreenProps {
  onNavigate?: (view: string, customerId: string) => void;
  selectedCustomerId?: string;
}

const CUSTOMER_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'];
const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'];
const KYC_LEVELS = ['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
const KYC_STATUSES = ['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED'];

function isDirectoryCustomer(value: any): value is DirectoryCustomer {
  return value && typeof value.id === 'string' && !!value.id.trim() && typeof value.reference === 'string' &&
    typeof value.type === 'string' && typeof value.status === 'string' && typeof value.kycLevel === 'string' &&
    typeof value.kycStatus === 'string' && (typeof value.createdAt === 'string' || value.createdAt instanceof Date) &&
    (value.displayName == null || typeof value.displayName === 'string') && (value.legalName == null || typeof value.legalName === 'string') &&
    (value.primaryContact == null || (typeof value.primaryContact.type === 'string' && typeof value.primaryContact.maskedValue === 'string' && typeof value.primaryContact.isVerified === 'boolean'));
}
function validDirectory(value: any, page: number, limit: number): value is CustomerDirectoryResponse {
  return value && Array.isArray(value.data) && value.data.every(isDirectoryCustomer) && new Set(value.data.map((item: DirectoryCustomer) => item.id)).size === value.data.length &&
    Number.isSafeInteger(value.total) && value.total >= 0 && value.page === page && value.limit === limit &&
    Number.isSafeInteger(value.totalPages) && value.totalPages === Math.ceil(value.total / limit) &&
    value.hasNextPage === (page * limit < value.total) && value.hasPreviousPage === (page > 1) &&
    value.data.length <= Math.min(limit, Math.max(0, value.total - (page - 1) * limit));
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
}

function displayName(customer: DirectoryCustomer): string {
  return customer.displayName?.trim() || customer.legalName?.trim() || 'Name not recorded';
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 401) return 'Your session has expired. Sign in again to continue.';
    if (status === 403) return 'Customer servicing is not available to this workforce role.';
  }
  return 'Customer records could not be loaded. Try again.';
}

/**
 * Presentation-only mapping. The displayed text is always the server-returned
 * value; the tone/shape only adds a redundant non-colour cue.
 */
function statusPresentation(status: string): { tone: StatusTone; shape: StatusShape } {
  switch (status) {
    case 'ACTIVE':
      return { tone: 'success', shape: 'dot' };
    case 'SUSPENDED':
      return { tone: 'warning', shape: 'square' };
    case 'CLOSED':
      return { tone: 'danger', shape: 'square' };
    case 'DRAFT':
      return { tone: 'neutral', shape: 'hollow' };
    default:
      return { tone: 'neutral', shape: 'hollow' };
  }
}

function kycPresentation(kycStatus: string): { tone: StatusTone; shape: StatusShape } {
  switch (kycStatus) {
    case 'APPROVED':
      return { tone: 'success', shape: 'dot' };
    case 'PENDING':
      return { tone: 'warning', shape: 'square' };
    case 'REJECTED':
      return { tone: 'danger', shape: 'square' };
    default:
      return { tone: 'neutral', shape: 'hollow' };
  }
}

export const CustomerDirectoryScreen: React.FC<CustomerDirectoryScreenProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type,
    principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess,
    principal?.readOnlyPrincipal]);
  return <CustomerDirectoryWorkspace key={key} {...props} />;
};

const CustomerDirectoryWorkspace: React.FC<CustomerDirectoryScreenProps> = ({ onNavigate, selectedCustomerId }) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canViewCustomer = scopes.includes('customer.view');
  const canCreateCustomer = canViewCustomer && scopes.includes('customer.create') && !principal?.readOnlyPrincipal;

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [kycLevel, setKycLevel] = useState('');
  const [kycStatus, setKycStatus] = useState('');
  const [directory, setDirectory] = useState<CustomerDirectoryResponse | null>(null);
  const [appliedQuery, setAppliedQuery] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<DirectoryCustomer | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const registrationRef = useRef<CustomerRegistrationWizardHandle>(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const requestVersion = useRef(0);
  const createOpenRef = useRef(createOpen);
  createOpenRef.current = createOpen;
  useEffect(() => () => { requestVersion.current++; }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (kycLevel) params.set('kycLevel', kycLevel);
    if (kycStatus) params.set('kycStatus', kycStatus);
    return params.toString();
  }, [page, pageSize, search, status, type, kycLevel, kycStatus]);

  useEffect(() => {
    if (!canViewCustomer) { setIsLoading(false); return; }
    let active = true;
    setIsLoading(true);
    setError(null);
    ApiClient.get<CustomerDirectoryResponse>(`/internal/customers?${queryString}`)
      .then((response) => {
        if (!validDirectory(response, page, pageSize) || response.data.some(customer => (status && customer.status !== status) || (type && customer.type !== type) || (kycLevel && customer.kycLevel !== kycLevel) || (kycStatus && customer.kycStatus !== kycStatus))) throw new Error('Invalid or mismatched customer directory response');
        if (active) { setDirectory(response); setAppliedQuery(queryString); }
      })
      .catch((loadError: unknown) => {
        if (active) setError(safeErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryString, reloadVersion, canViewCustomer, page, pageSize]);

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!canViewCustomer || !selectedCustomerId) {
      setSelectionError(null);
      return;
    }
    if (createOpenRef.current) {
      setSelectionError('Close registration before opening a different customer.');
      return;
    }

    let active = true;
    setSelectionError(null);
    ApiClient.get<DirectoryCustomer>(`/internal/customers/${encodeURIComponent(selectedCustomerId)}`)
      .then((customer) => {
        if (active && version === requestVersion.current) {
          if (!isDirectoryCustomer(customer) || customer.id !== selectedCustomerId) { setSelectionError('The selected customer response could not be confirmed.'); return; }
          setSelectedCustomer(customer);
        }
      })
      .catch(() => {
        if (active && version === requestVersion.current) {
          setSelectionError('The selected customer is not available to this workforce role.');
        }
      });
    return () => {
      active = false;
    };
  }, [selectedCustomerId, canViewCustomer]);

  const handleCustomerCreated = () => {
    setPage(1);
    setSearch('');
    setSearchInput('');
    setReloadVersion((value) => value + 1);
  };

  const openRegistrationCustomer = async (customerId: string) => {
    const version = ++requestVersion.current;
    setCreateOpen(false);
    setSelectionError(null);
    try {
      const customer = await ApiClient.get<DirectoryCustomer>(
        `/internal/customers/${encodeURIComponent(customerId)}`,
      );
      if (version !== requestVersion.current) return;
      if (!isDirectoryCustomer(customer) || customer.id !== customerId) throw new Error('Mismatched customer');
      setSelectedCustomer(customer);
    } catch {
      if (version !== requestVersion.current) return;
      setSelectionError('The saved customer is not available to this workforce role.');
      setReloadVersion((value) => value + 1);
    }
  };

  const handleCustomerUpdated = (updated: DirectoryCustomer) => {
    setSelectedCustomer(updated);
    setDirectory((current) =>
      current
        ? { ...current, data: current.data.map((item) => (item.id === updated.id ? updated : item)) }
        : current,
    );
    setReloadVersion((value) => value + 1);
  };

  if (!canViewCustomer) return <main className="customer-management"><Alert tone="danger" title="Customer directory unavailable">This session requires customer.view to access customer records.</Alert></main>;

  if (selectedCustomer) {
    return (
      <Customer360Workspace
        customer={selectedCustomer}
        onBack={() => { requestVersion.current++; setIsLoading(true); setSelectedCustomer(null); setReloadVersion(value => value + 1); }}
        onCustomerUpdated={handleCustomerUpdated}
        onNavigate={onNavigate}
      />
    );
  }

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setType('');
    setKycLevel('');
    setKycStatus('');
    setPage(1);
  };

  const retry = () => { setIsLoading(true); setReloadVersion((value) => value + 1); };

  const activeFilterCount = [searchInput, status, type, kycLevel, kycStatus].filter(Boolean).length;
  const filtersPending = searchInput.trim() !== search;
  const previousDataVisible = Boolean(directory) && (isLoading || Boolean(error) || filtersPending || appliedQuery !== queryString);
  const hasRows = (directory?.data ?? []).length > 0;

  // Truthful result text: an unknown total is never presented as zero.
  let countLabel: string;
  if (error) {
    countLabel = directory
      ? 'Customer count unconfirmed — showing previously loaded results'
      : 'Customer count unavailable';
  } else if (previousDataVisible && directory) {
    countLabel = 'Customer count unconfirmed — filters or results are being updated';
  } else if (isLoading && !directory) {
    countLabel = 'Loading customers…';
  } else {
    const total = directory?.total ?? 0;
    countLabel = `${total} customer${total === 1 ? '' : 's'}`;
  }

  const currentPage = directory?.page ?? page;
  const currentLimit = directory?.limit ?? pageSize;
  const totalPages = Math.max(directory?.totalPages ?? 0, 1);
  const totalKnown = !error && !isLoading && !previousDataVisible && typeof directory?.total === 'number';
  const total = directory?.total ?? 0;
  const rangeStart = totalKnown && total > 0 ? (currentPage - 1) * currentLimit + 1 : null;
  const rangeEnd = totalKnown && rangeStart !== null ? Math.min(currentPage * currentLimit, total) : null;

  return (
    <main className="customer-management">
      <PageHeader
        className="mn-dir-header"
        eyebrow="CUSTOMER SERVICING"
        title="Customer directory"
        description="Search authorized customer records and open a read-first Customer 360° workspace."
        actions={
          canCreateCustomer ? (
            <Button
              variant="primary"
              ref={createButtonRef}
              onClick={() => { if (createOpen) registrationRef.current?.requestClose(); else setCreateOpen(true); }}
              disabled={registrationBusy}
              aria-expanded={createOpen}
              aria-controls={createOpen ? 'mn-dir-registration' : undefined}
            >
              {createOpen ? 'Close registration' : 'New Customer'}
            </Button>
          ) : undefined
        }
      />

      {createOpen && <p className="mn-dir-registration-notice" role="status">Finish or close registration before opening another customer. Only confirmed saves are retained.</p>}
      {createOpen && canCreateCustomer && (
        <div className="mn-dir-registration" id="mn-dir-registration">
          <CustomerRegistrationWizard
            ref={registrationRef}
            onBusyChange={setRegistrationBusy}
            onClose={() => { setCreateOpen(false); setRegistrationBusy(false); createButtonRef.current?.focus(); }}
            onCustomerCreated={handleCustomerCreated}
            onOpenCustomer={openRegistrationCustomer}
          />
        </div>
      )}

      <section className="mn-dir-panel" aria-label="Customer search and results">
        <div className="mn-dir-toolbar">
          <div className="mn-dir-toolbar__filters">
            <Field label="Search" htmlFor="mn-dir-search" className="mn-dir-filter mn-dir-filter--search">
              <input
                id="mn-dir-search"
                className="mn-input mn-input--search"
                type="search"
                maxLength={120}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Name, reference or authorized contact"
                aria-label="Search customers"
              />
            </Field>
            <Field label="Status" htmlFor="mn-dir-status" className="mn-dir-filter">
              <select
                id="mn-dir-status"
                className="mn-select"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {CUSTOMER_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type" htmlFor="mn-dir-type" className="mn-dir-filter">
              <select
                id="mn-dir-type"
                className="mn-select"
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All types</option>
                {CUSTOMER_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="KYC level" htmlFor="mn-dir-kyc-level" className="mn-dir-filter">
              <select
                id="mn-dir-kyc-level"
                className="mn-select"
                value={kycLevel}
                onChange={(event) => {
                  setKycLevel(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All levels</option>
                {KYC_LEVELS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="KYC status" htmlFor="mn-dir-kyc-status" className="mn-dir-filter">
              <select
                id="mn-dir-kyc-status"
                className="mn-select"
                value={kycStatus}
                onChange={(event) => {
                  setKycStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All KYC statuses</option>
                {KYC_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mn-dir-toolbar__actions">
            {activeFilterCount > 0 ? (
              <span className="mn-dir-toolbar__status">
                {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
              </span>
            ) : null}
            {activeFilterCount > 0 ? (
              <Button variant="quiet" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={retry} disabled={isLoading}>
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Alert
            className="mn-dir-alert"
            tone="danger"
            title="Customer records unavailable"
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {selectionError && (
          <Alert className="mn-dir-alert" tone="warning" live="assertive">
            {selectionError}
          </Alert>
        )}

        <div className="mn-dir-meta">
          <span className="mn-dir-meta__count" role="status" aria-live="polite">
            {countLabel}
          </span>
          {previousDataVisible ? (
            <span className="mn-dir-meta__flag">
              <span className="mn-dir-meta__flag-dot" aria-hidden="true" />
              Showing previously loaded results — not yet confirmed
            </span>
          ) : null}
        </div>

        <ScrollRegion
          className="mn-dir-scroll-hint"
          label="Customer records table"
          hint="Scroll horizontally to view every column and the row actions."
        >
          <table className="mn-dir-table" aria-busy={isLoading}>
            <caption className="mn-visually-hidden">
              Customer directory results, page {currentPage} of {totalPages}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="mn-dir-table__head-cell mn-dir-table__sticky">Customer</th>
                <th scope="col" className="mn-dir-table__head-cell">Reference</th>
                <th scope="col" className="mn-dir-table__head-cell">Type</th>
                <th scope="col" className="mn-dir-table__head-cell">Status</th>
                <th scope="col" className="mn-dir-table__head-cell">KYC</th>
                <th scope="col" className="mn-dir-table__head-cell">Primary contact</th>
                <th scope="col" className="mn-dir-table__head-cell">Registered</th>
                <th scope="col" className="mn-dir-table__head-cell mn-dir-table__actions">
                  <span className="mn-visually-hidden">Customer actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && !error && directory?.data?.length === 0 && (
                <tr>
                  <td colSpan={8} className="mn-dir-table__empty">
                    <div className="mn-dir-state">
                      <span className="mn-dir-state__glyph" aria-hidden="true">
                        ⌕
                      </span>
                      <p className="mn-dir-state__title">
                        No customer records match these search criteria.
                      </p>
                      <p className="mn-dir-state__hint">
                        Adjust the search or filters to widen the results.
                      </p>
                      {activeFilterCount > 0 ? (
                        <Button variant="secondary" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )}
              {(directory?.data ?? []).map((customer) => {
                const customerStatus = statusPresentation(customer.status);
                const customerKyc = kycPresentation(customer.kycStatus);
                return (
                  <tr key={customer.id} className="mn-dir-table__row">
                    <td className="mn-dir-table__cell mn-dir-table__sticky">
                      <span className="mn-dir-table__identity">{displayName(customer)}</span>
                      {customer.legalName && customer.legalName !== customer.displayName && (
                        <span className="mn-dir-table__secondary">Legal name: {customer.legalName}</span>
                      )}
                    </td>
                    <td className="mn-dir-table__cell">
                      <span className="mn-dir-table__reference">
                        {maskCustomerReference(customer.reference) || 'Reference unavailable'}
                      </span>
                    </td>
                    <td className="mn-dir-table__cell">{customer.type}</td>
                    <td className="mn-dir-table__cell">
                      <StatusBadge tone={customerStatus.tone} shape={customerStatus.shape}>
                        {customer.status}
                      </StatusBadge>
                    </td>
                    <td className="mn-dir-table__cell">
                      <span className="mn-dir-table__kyc">
                        <span className="mn-dir-chip">{customer.kycLevel}</span>
                        <StatusBadge tone={customerKyc.tone} shape={customerKyc.shape}>
                          {customer.kycStatus}
                        </StatusBadge>
                      </span>
                    </td>
                    <td className="mn-dir-table__cell">
                      {customer.primaryContact ? (
                        <>
                          <span>{customer.primaryContact.maskedValue}</span>
                          <span className="mn-dir-table__secondary">
                            {customer.primaryContact.isVerified ? 'Verified' : 'Not verified'}
                          </span>
                        </>
                      ) : scopes.includes('customer.view_contact_methods') ? (
                        'Not recorded'
                      ) : (
                        'Restricted'
                      )}
                    </td>
                    <td className="mn-dir-table__cell">{formatDate(customer.createdAt)}</td>
                    <td className="mn-dir-table__cell mn-dir-table__actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { requestVersion.current++; setSelectedCustomer(customer); }}
                        disabled={createOpen || previousDataVisible}
                        title={createOpen ? 'Close registration before opening another customer.' : previousDataVisible ? 'Wait for current results before opening a customer.' : undefined}
                        aria-label={`Open Customer 360° for ${displayName(customer)}`}
                      >
                        Open Customer 360°
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {isLoading && !directory && (
                <tr>
                  <td colSpan={8} className="mn-dir-table__empty">
                    <span className="mn-dir-loading">
                      <span className="mn-dir-loading__dot" aria-hidden="true" />
                      <span>Loading customer records…</span>
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollRegion>

        <nav className="mn-dir-pagination" aria-label="Customer directory pages">
          <span className="mn-dir-pagination__summary">
            {rangeStart !== null && rangeEnd !== null
              ? `Showing ${rangeStart}–${rangeEnd} of ${total}`
              : error || isLoading || hasRows
                ? 'Result range unconfirmed'
                : 'No matching records'}
          </span>
          <div className="mn-dir-pagination__controls">
            <Button
              variant="secondary"
              disabled={isLoading || previousDataVisible || !directory?.hasPreviousPage}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <span className="mn-dir-pagination__page">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="secondary"
              disabled={isLoading || previousDataVisible || !directory?.hasNextPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      </section>
    </main>
  );
};
