import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (initialTab && canViewTab(initialTab)) setTab(initialTab);
    else if (!canViewTab(tab) && availableTabs[0]) setTab(availableTabs[0]);
  }, [initialTab]);

  const fetchTab = async (selectedTab: Tab) => {
    if (!canViewTab(selectedTab)) return;
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
        setData({ profiles: extractRecords(profiles), rules: extractRecords(rules) } satisfies LimitRegistryData);
      } else {
        setData(await ApiClient.get(TAB_ENDPOINTS[selectedTab]));
      }
    } catch (err: any) {
      setError(err?.message || `Failed to load ${TAB_LABELS[selectedTab].toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canViewTab(tab)) void fetchTab(tab);
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
    <div style={wrap}>
      <h2 style={h2}>🏷️ Commercial Rule Registries</h2>
      <p style={sub}>Read-only registry views. Each tab requires its matching read function; this screen does not create, approve, execute, or modify registry entries.</p>
      <div style={tabRow} role="tablist" aria-label="Commercial registries">
        {availableTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => setTab(candidate)}
            style={tab === candidate ? activeTab : tabBtn}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
        <button type="button" onClick={() => void fetchTab(tab)} style={btn} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div style={errBox} role="alert">{error}</div>}
      {loading ? <div style={loadingBox}>Loading {TAB_LABELS[tab].toLowerCase()}…</div> : data !== null ? (
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
      ) : (
        <div style={empty}>No {TAB_LABELS[tab].toLowerCase()} data loaded yet. Use Refresh to query the existing registry API.</div>
      )}

      <div style={note}>
        Commercial decision snapshots are not part of these registry tables. Fee calculation and any future governed configuration changes remain separate existing workflows.
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 12 };
const tabRow: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' };
const tabBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer' };
const activeTab: React.CSSProperties = { ...tabBtn, background: '#032B14', color: '#fff', border: '1px solid #032B14' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', marginLeft: 'auto' };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B', background: '#fff', borderRadius: 8, border: '1px dashed #E2E8F0' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const card: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, marginBottom: 12 };
const sectionTitle: React.CSSProperties = { margin: '0 0 12px', color: '#334155', fontSize: 14 };
const limitSections: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr', gap: 4 };
const note: React.CSSProperties = { marginTop: 16, fontSize: 12, color: '#64748B', background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' };
