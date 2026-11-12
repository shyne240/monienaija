import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { maskCustomerReference } from './customer-masking';

interface SearchCustomer { id: string; reference: string; displayName?: string | null; legalName?: string | null }
interface SearchState { sessionKey: string; query: string; status: 'loading' | 'ready' | 'error'; customers: SearchCustomer[] }
interface Props {
  query: string;
  onQuery: (value: string) => void;
  canSearchCustomers: boolean;
  sessionKey: string;
  workspaces: Array<{ key: string; label: string }>;
  onWorkspace: (key: string) => void;
  onCustomer: (id: string) => void;
}

/** Search only existing, independently authorized endpoints; never infer other entity results. */
export const GlobalSearch: React.FC<Props> = ({ query, onQuery, canSearchCustomers, sessionKey, workspaces, onWorkspace, onCustomer }) => {
  const [state, setState] = useState<SearchState | null>(null);
  const normalized = query.trim().slice(0, 120);
  useEffect(() => {
    let active = true;
    setState(null);
    if (!canSearchCustomers || normalized.length < 2) return () => { active = false; };
    setState({ sessionKey, query: normalized, status: 'loading', customers: [] });
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: '1', limit: '5', search: normalized });
      ApiClient.get<unknown>(`/internal/customers?${params}`).then(value => {
        const response = value as { data?: unknown; total?: unknown; page?: unknown; limit?: unknown } | null;
        if (!response || !Array.isArray(response.data) || response.page !== 1 || response.limit !== 5 ||
          !Number.isSafeInteger(response.total) || (response.total as number) < 0 || response.data.length > 5 ||
          !response.data.every((item: any) => item && typeof item.id === 'string' && item.id.trim() && typeof item.reference === 'string' && (item.displayName == null || typeof item.displayName === 'string') && (item.legalName == null || typeof item.legalName === 'string'))) throw new Error('Invalid search response');
        if (active) setState({ sessionKey, query: normalized, status: 'ready', customers: response.data as SearchCustomer[] });
      }).catch(() => { if (active) setState({ sessionKey, query: normalized, status: 'error', customers: [] }); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [normalized, canSearchCustomers, sessionKey]);
  const matches = workspaces.filter(item => item.label.toLowerCase().includes(normalized.toLowerCase()));
  const results = canSearchCustomers && state?.sessionKey === sessionKey && state.query === normalized ? state : null;
  return <div className="one-command-search"><span aria-hidden="true">⌕</span>
    <input type="search" aria-label="Search navigation" placeholder="Search customers and workspaces..." maxLength={120} value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onQuery(''); }} />
    {normalized && <div className="one-command-results" role="group" aria-label="Navigation search results">
      <p className="one-search-heading">Workspaces</p>
      {matches.map(item => <button type="button" key={item.key} onClick={() => onWorkspace(item.key)}>{item.label}</button>)}
      {!matches.length && <p>No matching workspaces</p>}
      {canSearchCustomers && <><p className="one-search-heading">Customers</p>{normalized.length < 2 ? <p>Enter at least two characters.</p> : results?.status === 'loading' || !results ? <p role="status">Searching customers…</p> : results.status === 'error' ? <p role="status">Customer search unavailable.</p> : results.customers.length ? results.customers.map(customer => <button type="button" key={customer.id} onClick={() => onCustomer(customer.id)}><strong>{customer.displayName?.trim() || customer.legalName?.trim() || 'Name not recorded'}</strong><small>{maskCustomerReference(customer.reference)}</small></button>) : <p>No matching customers.</p>}</>}
      <p className="one-search-note">Search covers authorized customers and workspaces.</p>
    </div>}
  </div>;
};
