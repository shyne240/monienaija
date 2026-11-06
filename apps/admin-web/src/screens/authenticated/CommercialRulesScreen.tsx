import React, { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../design-system/primitives';
import './operational-surfaces.css';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { extractRecords, StructuredColumn, StructuredRecordTable, DataRecord } from '../../components/StructuredData';

type Tab = 'fees' | 'commissions' | 'rewards' | 'products' | 'limits';

const TAB_FUNCTIONS: Record<Tab, string> = {
  fees: 'fee_rule.view',
  commissions: 'commission_rule.view',
  rewards: 'reward_rule.view',
  products: 'product.view',
  limits: 'limit.view',
};

const TAB_LABELS: Record<Tab, string> = {
  fees: 'Fees',
  commissions: 'Commissions',
  rewards: 'Rewards',
  products: 'Products',
  limits: 'Limits',
};

const TAB_ORDER: Tab[] = ['fees', 'commissions', 'rewards', 'products', 'limits'];

const TAB_ENDPOINTS: Record<Exclude<Tab, 'limits'>, string> = {
  fees: '/internal/fee-rules',
  commissions: '/internal/commission-rules',
  rewards: '/internal/reward-rules',
  products: '/internal/products',
};

const COLUMNS: Record<Tab, StructuredColumn[]> = {
  fees: [
    { key: 'code', label: 'Code' }, { key: 'productCode', label: 'Product' },
    { key: 'currency', label: 'Currency' }, { key: 'flatFeeMinor', label: 'Flat fee (minor)' },
    { key: 'percentageBps', label: 'Rate (bps)' }, { key: 'vatBps', label: 'VAT (bps)' },
    { key: 'status', label: 'Status' }, { key: 'version', label: 'Version' },
  ],
  commissions: [
    { key: 'code', label: 'Code' }, { key: 'productCode', label: 'Product' },
    { key: 'recipientType', label: 'Recipient' }, { key: 'currency', label: 'Currency' },
    { key: 'calculationModel', label: 'Model' }, { key: 'calculationBasis', label: 'Basis' },
    { key: 'status', label: 'Status' }, { key: 'version', label: 'Version' },
  ],
  rewards: [
    { key: 'code', label: 'Code' }, { key: 'productCode', label: 'Product' },
    { key: 'beneficiaryType', label: 'Beneficiary' }, { key: 'rewardType', label: 'Reward type' },
    { key: 'currency', label: 'Currency' }, { key: 'calculationModel', label: 'Model' },
    { key: 'status', label: 'Status' }, { key: 'version', label: 'Version' },
  ],
  products: [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' },
    { key: 'domain', label: 'Domain' }, { key: 'currency', label: 'Currency' },
    { key: 'status', label: 'Status' }, { key: 'configurationStatus', label: 'Configuration' },
    { key: 'version', label: 'Version' },
  ],
  limits: [],
};

interface LimitRegistryData {
  profiles: DataRecord[];
  rules: DataRecord[];
}

const PROFILE_COLUMNS: StructuredColumn[] = [
  { key: 'code', label: 'Profile code' }, { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' },
  { key: 'enabled', label: 'Enabled' }, { key: 'configurationStatus', label: 'Configuration' },
  { key: 'version', label: 'Version' },
];

const LIMIT_RULE_COLUMNS: StructuredColumn[] = [
  { key: 'limitProfileCode', label: 'Profile' }, { key: 'product', label: 'Product' },
  { key: 'direction', label: 'Direction' }, { key: 'channel', label: 'Channel' },
  { key: 'currency', label: 'Currency' }, { key: 'dimension', label: 'Dimension' },
  { key: 'limitValueMinor', label: 'Limit (minor)' }, { key: 'limitValueCount', label: 'Count limit' },
  { key: 'isActive', label: 'Active' }, { key: 'priority', label: 'Priority' },
];

export const CommercialRulesScreen: React.FC<{ initialTab?: Tab }> = ({ initialTab }) => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canViewTab = (candidate: Tab) => hasFn(TAB_FUNCTIONS[candidate]);
  const availableTabs = TAB_ORDER.filter(canViewTab);
  const canView = availableTabs.length > 0;
  const [tab, setTab] = useState<Tab>(() =>
    initialTab && canViewTab(initialTab) ? initialTab : availableTabs[0] ?? 'fees',
  );
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (initialTab && canViewTab(initialTab)) setTab(initialTab);
    else if (!canViewTab(tab) && availableTabs[0]) setTab(availableTabs[0]);
  }, [initialTab]);

  const fetchTab = async (selectedTab: Tab) => {
    if (!canViewTab(selectedTab)) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      if (selectedTab === 'limits') {
        // These are the actual read routes. There is no /internal/limit-catalogue controller.
        const [profiles, rules] = await Promise.all([
          ApiClient.get('/internal/limit-profiles'),
          ApiClient.get('/internal/limit-rules'),
        ]);
        if (currentRequest === requestId.current) setData({ profiles: extractRecords(profiles), rules: extractRecords(rules) } satisfies LimitRegistryData);
      } else {
        const result = await ApiClient.get(TAB_ENDPOINTS[selectedTab]);
        if (currentRequest === requestId.current) setData(result);
      }
    } catch (err: any) {
      if (currentRequest === requestId.current) setError(err?.message || `Failed to load ${TAB_LABELS[selectedTab].toLowerCase()}`);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (canViewTab(tab)) void fetchTab(tab);
    return () => { requestId.current += 1; };
  }, [tab]);

  if (!canView) {
    return (
      <div style={wrap} role="alert">
        <div style={denied}>
          This screen requires at least one matching read function: <code>fee_rule.view</code>, <code>commission_rule.view</code>, <code>reward_rule.view</code>, <code>product.view</code>, or <code>limit.view</code>.
        </div>
      </div>
    );
  }

  const limitData = data as LimitRegistryData | null;
  const rows = tab !== 'limits' && data !== null ? extractRecords(data) : [];

  return (
    <div className="mn-operational" style={wrap}>
      <PageHeader eyebrow="Commercial administration" title="🏷️ Commercial Rule Registries" description="Read-only registry views. Each tab requires its matching read function; this screen does not create, approve, execute, or modify registry entries." />
      <div style={tabRow} role="tablist" aria-label="Commercial registries">
        {availableTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            id={`commercial-tab-${candidate}`}
            aria-controls="commercial-panel"
            aria-selected={tab === candidate}
            tabIndex={tab === candidate ? 0 : -1}
            ref={(element) => { tabRefs.current[candidate] = element; }}
            onKeyDown={(event) => {
              const index = availableTabs.indexOf(candidate);
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % availableTabs.length;
              else if (event.key === 'ArrowLeft') next = (index - 1 + availableTabs.length) % availableTabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = availableTabs.length - 1;
              else return;
              event.preventDefault();
              setTab(availableTabs[next]);
              tabRefs.current[availableTabs[next]]?.focus();
            }}
            onClick={() => setTab(candidate)}
            style={tab === candidate ? activeTab : tabBtn}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => void fetchTab(tab)} style={btn} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>

      <div id="commercial-panel" role="tabpanel" aria-labelledby={`commercial-tab-${tab}`}>
      {error && <div style={errBox} role="alert">{error}</div>}
      {loading ? <div role="status" style={loadingBox}>Loading {TAB_LABELS[tab].toLowerCase()}…</div> : data !== null ? (
        tab === 'limits' ? (
          <div style={limitSections}>
            <section style={card} aria-label="Limit profiles">
              <h3 style={sectionTitle}>Profiles ({limitData?.profiles?.length ?? 0})</h3>
              <StructuredRecordTable
                rows={limitData?.profiles ?? []}
                columns={PROFILE_COLUMNS}
                emptyMessage="No limit profiles were returned by the API."
              />
            </section>
            <section style={card} aria-label="Limit rules">
              <h3 style={sectionTitle}>Rules ({limitData?.rules?.length ?? 0})</h3>
              <StructuredRecordTable
                rows={limitData?.rules ?? []}
                columns={LIMIT_RULE_COLUMNS}
                emptyMessage="No limit rules were returned by the API."
              />
            </section>
          </div>
        ) : (
          <section style={card} aria-label={`${TAB_LABELS[tab]} registry`}>
            <h3 style={sectionTitle}>{TAB_LABELS[tab]} ({rows.length})</h3>
            <StructuredRecordTable
              rows={rows}
              columns={COLUMNS[tab]}
              emptyMessage={`No ${TAB_LABELS[tab].toLowerCase()} records were returned by the API.`}
            />
          </section>
        )
      ) : !error && (
        <div style={empty}>No {TAB_LABELS[tab].toLowerCase()} data loaded yet. Use Refresh to query the existing registry API.</div>
      )}

      </div>
      <div style={note}>
        Commercial decision snapshots are not part of these registry tables. Fee calculation and any future governed configuration changes remain separate existing workflows.
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1200 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: 'var(--mn-nav-surface-deep, #082f23)' };
const sub: React.CSSProperties = { color: 'var(--mn-text-secondary, #52655f)', fontSize: 13, marginBottom: 12 };
const tabRow: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' };
const tabBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)', background: '#fff', cursor: 'pointer' };
const activeTab: React.CSSProperties = { ...tabBtn, background: 'var(--mn-nav-surface-deep, #082f23)', color: '#fff', border: '1px solid var(--mn-nav-surface-deep, #082f23)' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)', background: '#fff', cursor: 'pointer', marginLeft: 'auto' };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: 'var(--mn-text-secondary, #52655f)' };
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: 'var(--mn-text-secondary, #52655f)', background: '#fff', borderRadius: 8, border: '1px dashed var(--mn-border-subtle, #dde7e2)' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const card: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8, marginBottom: 12 };
const sectionTitle: React.CSSProperties = { margin: '0 0 12px', color: 'var(--mn-text-primary, #132b25)', fontSize: 14 };
const limitSections: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr', gap: 4 };
const note: React.CSSProperties = { marginTop: 16, fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', background: 'var(--mn-surface-canvas, #f5f8f6)', padding: 10, borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)' };
