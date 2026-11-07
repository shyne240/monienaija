import React, { useEffect, useRef, useState } from 'react';
import { Button, PageHeader } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { StructuredColumn, StructuredRecordTable, DataRecord } from '../../components/StructuredData';
import './operational-surfaces.css';
import './commercial-catalogue.css';

type Tab = 'fees' | 'commissions' | 'rewards' | 'products' | 'limits';
const TAB_FUNCTIONS: Record<Tab, string> = {
  fees: 'fee_rule.view', commissions: 'commission_rule.view', rewards: 'reward_rule.view',
  products: 'product.view', limits: 'limit.view',
};
const TAB_LABELS: Record<Tab, string> = {
  fees: 'Fees', commissions: 'Commissions', rewards: 'Rewards', products: 'Products', limits: 'Limits',
};
const TAB_ORDER: Tab[] = ['fees', 'commissions', 'rewards', 'products', 'limits'];
const TAB_DESCRIPTION: Record<Tab, string> = {
  fees: 'Review configured fee rules, their currency, rate and effective dates.',
  commissions: 'Review configured commission rules and who may receive them.',
  rewards: 'Review configured reward rules and their beneficiary and calculation model.',
  products: 'Review product configuration, status and scope across the catalogue.',
  limits: 'Review limit profiles and rules independently. Assignment and usage are separate workflows.',
};
const COLUMNS: Record<Exclude<Tab, 'limits'>, StructuredColumn[]> = {
  fees: [
    { key: 'id', label: 'Rule ID' }, { key: 'productCode', label: 'Product' },
    { key: 'currency', label: 'Currency' }, { key: 'flatFeeMinor', label: 'Flat fee (minor)' },
    { key: 'percentageBps', label: 'Rate (bps)' }, { key: 'vatBps', label: 'VAT (bps)' },
    { key: 'isActive', label: 'Active' }, { key: 'effectiveFrom', label: 'Effective from' },
    { key: 'version', label: 'Version' },
  ],
  commissions: [
    { key: 'id', label: 'Rule ID' }, { key: 'productCode', label: 'Product' },
    { key: 'recipientType', label: 'Recipient' }, { key: 'currency', label: 'Currency' },
    { key: 'calculationModel', label: 'Model' }, { key: 'calculationBasis', label: 'Basis' },
    { key: 'isActive', label: 'Active' }, { key: 'effectiveFrom', label: 'Effective from' },
    { key: 'version', label: 'Version' },
  ],
  rewards: [
    { key: 'id', label: 'Rule ID' }, { key: 'productCode', label: 'Product' },
    { key: 'beneficiaryType', label: 'Beneficiary' }, { key: 'rewardType', label: 'Reward type' },
    { key: 'currency', label: 'Currency' }, { key: 'calculationModel', label: 'Model' },
    { key: 'isActive', label: 'Active' }, { key: 'effectiveFrom', label: 'Effective from' },
    { key: 'version', label: 'Version' },
  ],
  products: [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' },
    { key: 'domain', label: 'Domain' }, { key: 'currency', label: 'Currency' },
    { key: 'productScope', label: 'Scope' }, { key: 'status', label: 'Status' },
    { key: 'enabled', label: 'Enabled' }, { key: 'configurationStatus', label: 'Configuration' },
    { key: 'version', label: 'Version' },
  ],
};
const ENDPOINTS: Record<Exclude<Tab, 'limits'>, string> = {
  fees: '/internal/fee-rules', commissions: '/internal/commission-rules',
  rewards: '/internal/reward-rules', products: '/internal/products',
};
const PROFILE_COLUMNS: StructuredColumn[] = [
  { key: 'code', label: 'Profile code' }, { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' },
  { key: 'enabled', label: 'Enabled' }, { key: 'configurationStatus', label: 'Configuration' },
  { key: 'version', label: 'Version' },
];
const LIMIT_RULE_COLUMNS: StructuredColumn[] = [
  { key: 'id', label: 'Rule ID' }, { key: 'limitProfileCode', label: 'Profile' },
  { key: 'product', label: 'Product' }, { key: 'direction', label: 'Direction' },
  { key: 'channel', label: 'Channel' }, { key: 'currency', label: 'Currency' },
  { key: 'dimension', label: 'Dimension' }, { key: 'limitValueMinor', label: 'Limit (minor)' },
  { key: 'limitValueCount', label: 'Count limit' }, { key: 'isActive', label: 'Active' },
  { key: 'priority', label: 'Priority' },
];

interface Page { rows: DataRecord[]; page: number; total: number | null; totalPages: number | null; hasNextPage: boolean }
const PAGE_SIZE = 20;
function parsePage(value: unknown, requestedPage: number): Page | null {
  // Retain compatibility with legacy unpaginated responses without inventing totals or further pages.
  if (Array.isArray(value)) {
    if (requestedPage !== 1 || !value.every(row => row && typeof row === 'object' && !Array.isArray(row))) return null;
    return { rows: value, page: 1, total: null, totalPages: null, hasNextPage: false };
  }
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const rows = p.data;
  if (!Array.isArray(rows) || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row)) ||
      !Number.isSafeInteger(p.total) || (p.total as number) < 0 ||
      p.page !== requestedPage || p.limit !== PAGE_SIZE || !Number.isSafeInteger(p.totalPages) ||
      p.totalPages !== Math.ceil((p.total as number) / PAGE_SIZE) || typeof p.hasNextPage !== 'boolean' ||
      p.hasNextPage !== (requestedPage < (p.totalPages as number)) ||
      rows.length > PAGE_SIZE || rows.length > (p.total as number)) return null;
  return { rows, page: requestedPage, total: p.total as number, totalPages: p.totalPages as number, hasNextPage: p.hasNextPage };
}

/** Each registry owns its request, paging and error state; a failed rules read does not hide profiles. */
const RegistrySection: React.FC<{ title: string; endpoint: string; columns: StructuredColumn[]; description: string }> = ({ title, endpoint, columns, description }) => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const load = async () => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setData(null);
    try {
      const result = await ApiClient.get(`${endpoint}?page=${page}&limit=${PAGE_SIZE}`);
      const parsed = parsePage(result, page);
      if (!parsed) throw new Error(`${title} returned an invalid page.`);
      if (id === requestId.current) setData(parsed);
    } catch (err: any) {
      if (id === requestId.current) setError(err?.message || `Could not load ${title.toLowerCase()}.`);
    } finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [endpoint, page]);
  const search = query.trim().toLocaleLowerCase();
  const rows = data?.rows.filter(row => !search || columns.some(column => {
    const value = row[column.key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false;
    const variants = [String(value)];
    if (typeof value === 'boolean') variants.push(value ? 'Yes' : 'No');
    if (typeof value === 'number' && Number.isFinite(value)) variants.push(value.toLocaleString());
    if (typeof value === 'string' && /(?:At|Date|Timestamp)$/i.test(column.key)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) variants.push(date.toLocaleString());
    }
    return variants.some(item => item.toLocaleLowerCase().includes(search));
  })) ?? [];
  const headingId = `registry-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="commercial-registry" aria-labelledby={headingId}>
      <div className="commercial-registry__heading">
        <div><p className="commercial-kicker">READ-ONLY REGISTRY</p><h2 id={headingId}>{title}</h2><p>{description}</p></div>
        <Button size="sm" onClick={() => void load()} disabled={loading} aria-label={`Refresh ${title}`}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      <div className="commercial-registry__toolbar">
        <label className="commercial-search">Search this page <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={`Search ${title} on this page`} placeholder="Search visible columns" /></label>
        <p>Search applies only to the current page and visible columns.</p>
      </div>
      {error && <div className="commercial-state commercial-state--error" role="alert">{error} Use Refresh to try again.</div>}
      {loading ? <div className="commercial-state" role="status">Loading {title.toLowerCase()}…</div> : data && <>
        <div className="commercial-registry__summary" role="status">
          {data.total === null ? `${data.rows.length} record${data.rows.length === 1 ? '' : 's'} returned · Total and pagination unavailable` : `${data.total} total records · Page ${data.page} of ${Math.max(1, data.totalPages ?? 0)}`}
          {search && ` · ${rows.length} matching on this page`}
        </div>
        <StructuredRecordTable rows={rows} columns={columns} emptyMessage={search ? 'No records match this search on the current page.' : `No ${title.toLowerCase()} were returned by the API.`} />
        {data.total !== null && <div className="commercial-registry__pager" aria-label={`${title} pagination`}>
          <span>Showing {data.rows.length} on this page</span>
          <div><Button size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label={`Previous ${title} page`}>Previous</Button>
            <Button size="sm" disabled={!data.hasNextPage} onClick={() => setPage(p => p + 1)} aria-label={`Next ${title} page`}>Next</Button></div>
        </div>}
      </>}
    </section>
  );
};

export const CommercialRulesScreen: React.FC<{ initialTab?: Tab }> = (props) => {
  const principal = useAuthStore(state => state.principal);
  const key = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <CommercialRulesWorkspace key={key} {...props} />;
};
const CommercialRulesWorkspace: React.FC<{ initialTab?: Tab }> = ({ initialTab }) => {
  const { principal } = useAuthStore();
  const availableTabs = TAB_ORDER.filter(candidate => principal?.scopes.includes(TAB_FUNCTIONS[candidate]));
  const [tab, setTab] = useState<Tab>(() => initialTab && availableTabs.includes(initialTab) ? initialTab : availableTabs[0] ?? 'fees');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  useEffect(() => {
    if (initialTab && availableTabs.includes(initialTab)) setTab(initialTab);
    else if (!availableTabs.includes(tab) && availableTabs[0]) setTab(availableTabs[0]);
  }, [initialTab]);
  if (!availableTabs.length) return <div className="commercial-workspace"><div className="commercial-state commercial-state--error" role="alert">This screen requires at least one matching read function: <code>fee_rule.view</code>, <code>commission_rule.view</code>, <code>reward_rule.view</code>, <code>product.view</code>, or <code>limit.view</code>.</div></div>;
  return (
    <div className="mn-operational commercial-workspace">
      <PageHeader eyebrow="Commercial administration" title="Commercial Rule Registries" description="Explore the fee, commission, reward, product and limit catalogues available to your role." />
      <div className="commercial-boundary" role="note"><strong>Read-only workspace</strong><span>These registries show configuration, not transaction decisions. No rule, product or limit changes can be made here.</span></div>
      <div className="commercial-tabs" role="tablist" aria-label="Commercial registries">
        {availableTabs.map(candidate => <button key={candidate} type="button" role="tab" id={`commercial-tab-${candidate}`} aria-controls="commercial-panel" aria-selected={tab === candidate} tabIndex={tab === candidate ? 0 : -1} ref={element => { tabRefs.current[candidate] = element; }}
          onKeyDown={event => {
            const index = availableTabs.indexOf(candidate); let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % availableTabs.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + availableTabs.length) % availableTabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = availableTabs.length - 1;
            else return;
            event.preventDefault(); setTab(availableTabs[next]); tabRefs.current[availableTabs[next]]?.focus();
          }} onClick={() => setTab(candidate)}>{TAB_LABELS[candidate]}</button>)}
      </div>
      <div id="commercial-panel" role="tabpanel" aria-labelledby={`commercial-tab-${tab}`} className="commercial-panel">
        {tab === 'limits' ? <div className="commercial-sections">
          <RegistrySection title="Limit profiles" endpoint="/internal/limit-profiles" columns={PROFILE_COLUMNS} description="Profile configuration and availability. Profiles are not assignments." />
          <RegistrySection title="Limit rules" endpoint="/internal/limit-rules" columns={LIMIT_RULE_COLUMNS} description="Configured thresholds and dimensions. Rules are not current usage." />
        </div> : <RegistrySection key={tab} title={TAB_LABELS[tab]} endpoint={ENDPOINTS[tab]} columns={COLUMNS[tab]} description={TAB_DESCRIPTION[tab]} />}
      </div>
      <p className="commercial-footnote">Amounts are displayed in the returned currency's minor units; rates remain in basis points. Effective dates and active flags are distinct from a live transaction decision.</p>
    </div>
  );
};
