import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { maskCustomerReference } from './customer-masking';
import { Customer360Workspace, type DirectoryCustomer } from './Customer360Workspace';
import './customer-management.css';

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

export const CustomerDirectoryScreen: React.FC<CustomerDirectoryScreenProps> = ({
  onNavigate,
  selectedCustomerId,
}) => {
  const { principal } = useAuthStore();
  const scopes = principal?.scopes ?? [];
  const canCreateCustomer = scopes.includes('customer.create');

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [kycLevel, setKycLevel] = useState('');
  const [kycStatus, setKycStatus] = useState('');
  const [directory, setDirectory] = useState<CustomerDirectoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<DirectoryCustomer | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newReference, setNewReference] = useState('');
  const [newType, setNewType] = useState('INDIVIDUAL');
  const [isCreating, setIsCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);

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
    let active = true;
    setIsLoading(true);
    setError(null);
    ApiClient.get<CustomerDirectoryResponse>(`/internal/customers?${queryString}`)
      .then((response) => {
        if (active) setDirectory(response);
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
  }, [queryString, reloadVersion]);

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!selectedCustomerId) {
      setSelectionError(null);
      return;
    }

    const listedCustomer = directory?.data?.find((customer) => customer.id === selectedCustomerId);
    if (listedCustomer) {
      setSelectedCustomer(listedCustomer);
      setSelectionError(null);
      return;
    }

    let active = true;
    setSelectionError(null);
    ApiClient.get<DirectoryCustomer>(`/internal/customers/${encodeURIComponent(selectedCustomerId)}`)
      .then((customer) => {
        if (active && version === requestVersion.current) {
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
  }, [selectedCustomerId, directory]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!principal || !canCreateCustomer || isCreating) return;
    setIsCreating(true);
    setCreateMessage(null);
    try {
      const created = await ApiClient.post<DirectoryCustomer>('/customers', {
        reference: newReference.trim(),
        type: newType,
        status: 'DRAFT',
      });
      setCreateMessage(`Draft customer created. Reference: ${maskCustomerReference(created.reference)}`);
      setNewReference('');
      setCreateOpen(false);
      setPage(1);
      setSearch('');
      setSearchInput('');
      setReloadVersion((value) => value + 1);
    } catch {
      setCreateMessage('The draft customer could not be created. Check the reference and try again.');
    } finally {
      setIsCreating(false);
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

  if (selectedCustomer) {
    return (
      <Customer360Workspace
        customer={selectedCustomer}
        onBack={() => setSelectedCustomer(null)}
        onCustomerUpdated={handleCustomerUpdated}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <main className="customer-management">
      <header className="cm-page-header">
        <div>
          <p className="cm-eyebrow">CUSTOMER SERVICING</p>
          <h1>Customer directory</h1>
          <p className="cm-subtitle">Search authorized customer records and open a read-first Customer 360° workspace.</p>
        </div>
        {canCreateCustomer && (
          <button
            className="cm-button cm-button-primary"
            type="button"
            onClick={() => {
              setCreateOpen((value) => !value);
              setCreateMessage(null);
            }}
            aria-expanded={createOpen}
          >
            {createOpen ? 'Cancel draft' : 'New draft customer'}
          </button>
        )}
      </header>

      {createMessage && <div className="cm-notice" role="status">{createMessage}</div>}

      {createOpen && canCreateCustomer && (
        <form className="cm-create-panel" onSubmit={handleCreate}>
          <div>
            <h2>Create a draft customer</h2>
            <p>Manual records start in DRAFT. Activation remains subject to the verified-primary-phone gate.</p>
          </div>
          <label>
            Customer reference
            <input
              required
              maxLength={160}
              value={newReference}
              onChange={(event) => setNewReference(event.target.value)}
              placeholder="Enter an approved customer reference"
            />
          </label>
          <label>
            Customer type
            <select value={newType} onChange={(event) => setNewType(event.target.value)}>
              {CUSTOMER_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button className="cm-button cm-button-primary" type="submit" disabled={isCreating}>
            {isCreating ? 'Creating…' : 'Create draft'}
          </button>
        </form>
      )}

      <section className="cm-panel" aria-label="Customer search and results">
        <div className="cm-filter-grid">
          <label className="cm-search-field">
            Search
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Name, reference or authorized contact"
              aria-label="Search customers"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {CUSTOMER_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Type
            <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">All types</option>
              {CUSTOMER_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            KYC level
            <select value={kycLevel} onChange={(event) => { setKycLevel(event.target.value); setPage(1); }}>
              <option value="">All levels</option>
              {KYC_LEVELS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            KYC status
            <select value={kycStatus} onChange={(event) => { setKycStatus(event.target.value); setPage(1); }}>
              <option value="">All KYC statuses</option>
              {KYC_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>

        {error && (
          <div className="cm-error" role="alert">
            <span>{error}</span>
            <button className="cm-button cm-button-secondary" type="button" onClick={() => setReloadVersion((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}
        {selectionError && <div className="cm-error" role="alert">{selectionError}</div>}

        <div className="cm-table-meta">
          <span>{isLoading ? 'Loading customers…' : `${directory?.total ?? 0} customer${directory?.total === 1 ? '' : 's'}`}</span>
          <span>Page {directory?.page ?? page} of {Math.max(directory?.totalPages ?? 0, 1)}</span>
        </div>

        <div className="cm-table-wrap">
          <table className="cm-customer-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Reference</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">KYC</th>
                <th scope="col">Primary contact</th>
                <th scope="col">Registered</th>
                <th scope="col"><span className="cm-visually-hidden">Customer actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && !error && directory?.data?.length === 0 && (
                <tr><td colSpan={8} className="cm-empty-row">No customer records match these search criteria.</td></tr>
              )}
              {(directory?.data ?? []).map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{displayName(customer)}</strong>
                    {customer.legalName && customer.legalName !== customer.displayName && (
                      <span className="cm-secondary-line">Legal name: {customer.legalName}</span>
                    )}
                  </td>
                  <td><span className="cm-reference">{maskCustomerReference(customer.reference) || 'Reference unavailable'}</span></td>
                  <td>{customer.type}</td>
                  <td><span className={`cm-status cm-status-${customer.status.toLowerCase()}`}>{customer.status}</span></td>
                  <td>
                    <span className="cm-kyc-level">{customer.kycLevel}</span>
                    <span className="cm-secondary-line">{customer.kycStatus}</span>
                  </td>
                  <td>
                    {customer.primaryContact
                      ? <><span>{customer.primaryContact.maskedValue}</span><span className="cm-secondary-line">{customer.primaryContact.isVerified ? 'Verified' : 'Not verified'}</span></>
                      : scopes.includes('customer.view_contact_methods')
                        ? 'Not recorded'
                        : 'Restricted'}
                  </td>
                  <td>{formatDate(customer.createdAt)}</td>
                  <td>
                    <button
                      className="cm-button cm-button-secondary cm-open-button"
                      type="button"
                      onClick={() => setSelectedCustomer(customer)}
                      aria-label={`Open Customer 360° for ${displayName(customer)}`}
                    >
                      Open Customer 360°
                    </button>
                  </td>
                </tr>
              ))}
              {isLoading && !directory && <tr><td colSpan={8} className="cm-empty-row">Loading customer records…</td></tr>}
            </tbody>
          </table>
        </div>

        <nav className="cm-pagination" aria-label="Customer directory pages">
          <button
            className="cm-button cm-button-secondary"
            type="button"
            disabled={isLoading || !directory?.hasPreviousPage}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span>Showing page {directory?.page ?? page} of {Math.max(directory?.totalPages ?? 0, 1)}</span>
          <button
            className="cm-button cm-button-secondary"
            type="button"
            disabled={isLoading || !directory?.hasNextPage}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </nav>
      </section>
    </main>
  );
};
