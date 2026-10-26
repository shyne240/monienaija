import React, { useEffect, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface CashToCashOperation {
  id: string;
  agentId: string;
  agentReference: string | null;
  beneficiaryPhoneMasked: string;
  principalMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
  currency: string;
  status: 'UNCLAIMED' | 'CLAIMED' | 'EXPIRED' | string;
  journalId: string;
  reference: string | null;
  claimantCustomerId: string | null;
  claimJournalId: string | null;
  claimReference: string | null;
  redemptionMethod: 'CUSTOMER_WALLET' | 'AGENT_CASH' | null;
  claimedAt: string | null;
  expiresAt: string;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CashToCashResponse {
  data: CashToCashOperation[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  status: string;
  agentId: string;
  transferId: string;
  reference: string;
}

const PAGE_SIZE = 20;
const EMPTY_FILTERS: Filters = { status: '', agentId: '', transferId: '', reference: '' };

function formatMinor(value: string, currency: string): string {
  try {
    const minor = BigInt(value);
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const whole = (absolute / 100n).toLocaleString('en-NG');
    const fraction = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${currency} ${whole}.${fraction}`;
  } catch {
    return `${currency} ${value}`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export const CashToCashOperationsScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('transaction.view') ?? false;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CashToCashResponse | null>(null);
  const [selected, setSelected] = useState<CashToCashOperation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (targetPage: number, selectedFilters: Filters) => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) });
      Object.entries(selectedFilters).forEach(([key, value]) => {
        if (value.trim()) query.set(key, value.trim());
      });
      const response = await ApiClient.get<CashToCashResponse>(
        `/internal/admin/cash-to-cash/transfers?${query.toString()}`,
      );
      setResult(response);
      setSelected((current) => response.data.find((item) => item.id === current?.id) ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Cash-to-Cash operations.');
      setResult(null);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void load(page, filters);
  }, [canView, page]);

  const changeFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    if (page !== 1) setPage(1);
    void load(1, filters);
  };

  const statusStyle = (status: string): React.CSSProperties => ({
    ...styles.status,
    ...(status === 'CLAIMED' ? styles.claimed : status === 'EXPIRED' ? styles.expired : styles.unclaimed),
  });

  if (!canView) {
    return <div style={styles.wrap} role="alert"><div style={styles.error}>Cash-to-Cash operations require <code>transaction.view</code>.</div></div>;
  }

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.title}>Cash-to-Cash Operations</h2>
          <p style={styles.subtitle}>Paginated, read-only investigation and receipt references for Agent V1 transfers.</p>
        </div>
        <button type="button" style={styles.button} onClick={() => void load(page, filters)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>
      <div style={styles.notice} role="note">
        This surface does not reveal transfer codes or internal idempotency/fingerprint data and cannot claim, refund, release, or manually expire a transfer. Cash handover and unresolved KYC/expiry policies remain separate operational decisions.
      </div>

      <form onSubmit={search} style={styles.filters} aria-label="Cash-to-Cash filters">
        <label style={styles.label}>Status
          <select aria-label="Status" style={styles.input} value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}>
            <option value="">All statuses</option>
            <option value="UNCLAIMED">UNCLAIMED</option>
            <option value="CLAIMED">CLAIMED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </label>
        <label style={styles.label}>Agent UUID
          <input aria-label="Agent UUID" style={styles.input} value={filters.agentId} onChange={(event) => changeFilter('agentId', event.target.value)} placeholder="Filter by Agent" />
        </label>
        <label style={styles.label}>Transfer UUID
          <input aria-label="Transfer UUID" style={styles.input} value={filters.transferId} onChange={(event) => changeFilter('transferId', event.target.value)} placeholder="Exact transfer ID" />
        </label>
        <label style={styles.label}>Reference
          <input aria-label="Reference" style={styles.input} value={filters.reference} onChange={(event) => changeFilter('reference', event.target.value)} placeholder="Exact reference" />
        </label>
        <button type="submit" style={styles.primaryButton} disabled={loading}>Search</button>
      </form>

      {error && <div style={styles.error} role="alert">{error}</div>}
      {loading && !result ? <div style={styles.empty}>Loading transfers…</div> : result?.data.length ? (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr><th>Created</th><th>Transfer / Agent</th><th>Beneficiary</th><th>Status</th><th>Principal</th><th>Redemption</th><th>Expires / claimed</th><th>Receipt</th></tr></thead>
            <tbody>
              {result.data.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td><code>{item.id}</code><br /><span>{item.agentReference || item.agentId}</span></td>
                  <td>{item.beneficiaryPhoneMasked}</td>
                  <td><span style={statusStyle(item.status)}>{item.status}</span></td>
                  <td>{formatMinor(item.principalMinor, item.currency)}</td>
                  <td>{item.redemptionMethod ?? '—'}</td>
                  <td>{formatDate(item.expiresAt)}<br />{formatDate(item.claimedAt)}</td>
                  <td><button type="button" style={styles.smallButton} onClick={() => setSelected(item)}>Inspect receipt</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={styles.empty}>{loading ? 'Loading transfers…' : 'No Cash-to-Cash transfers match these filters.'}</div>
      )}

      <footer style={styles.pager}>
        <span>{result?.total ?? 0} transfer{result?.total === 1 ? '' : 's'} · Page {result?.page ?? page}{result?.totalPages ? ` of ${result.totalPages}` : ''}</span>
        <button type="button" style={styles.button} disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <button type="button" style={styles.button} disabled={loading || !result || page >= result.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
      </footer>

      {selected && (
        <section style={styles.detail} aria-label="Cash-to-Cash receipt details">
          <div style={styles.detailHeader}>
            <h3 style={styles.detailTitle}>Transfer receipt and ledger references</h3>
            <button type="button" style={styles.button} onClick={() => setSelected(null)}>Close</button>
          </div>
          <dl style={styles.details}>
            <div><dt>Transfer ID</dt><dd><code>{selected.id}</code></dd></div>
            <div><dt>State</dt><dd>{selected.status}</dd></div>
            <div><dt>Agent</dt><dd>{selected.agentReference || selected.agentId} · <code>{selected.agentId}</code></dd></div>
            <div><dt>Beneficiary</dt><dd>{selected.beneficiaryPhoneMasked} (masked)</dd></div>
            <div><dt>Principal / fee / VAT / total</dt><dd>{formatMinor(selected.principalMinor, selected.currency)} / {formatMinor(selected.feeMinor, selected.currency)} / {formatMinor(selected.vatMinor, selected.currency)} / {formatMinor(selected.totalMinor, selected.currency)}</dd></div>
            <div><dt>Redemption method</dt><dd>{selected.redemptionMethod ?? 'Not recorded / legacy'}</dd></div>
            <div><dt>Initiation journal</dt><dd><code>{selected.journalId}</code></dd></div>
            <div><dt>Claim journal</dt><dd>{selected.claimJournalId ? <code>{selected.claimJournalId}</code> : '—'}</dd></div>
            <div><dt>Claimant customer</dt><dd>{selected.claimantCustomerId ? <code>{selected.claimantCustomerId}</code> : '—'}</dd></div>
            <div><dt>Reference / claim reference</dt><dd>{selected.reference || '—'} / {selected.claimReference || '—'}</dd></div>
            <div><dt>Created / claimed / expired</dt><dd>{formatDate(selected.createdAt)} / {formatDate(selected.claimedAt)} / {formatDate(selected.expiredAt)}</dd></div>
            <div><dt>Expiry deadline</dt><dd>{formatDate(selected.expiresAt)}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: 24, maxWidth: 1400, color: '#0F172A', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { margin: '0 0 6px', color: '#032B14', fontSize: 22 },
  subtitle: { margin: 0, color: '#64748B', fontSize: 13 },
  notice: { margin: '18px 0', padding: 12, border: '1px solid #CBD5E1', borderRadius: 8, background: '#F8FAFC', color: '#475569', fontSize: 13, lineHeight: 1.5 },
  filters: { display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap', padding: 14, marginBottom: 14, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160, color: '#334155', fontSize: 12, fontWeight: 600 },
  input: { padding: '8px 9px', border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400 },
  button: { padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', color: '#1E293B', cursor: 'pointer' },
  primaryButton: { padding: '8px 14px', border: '1px solid #0A3D25', borderRadius: 5, background: '#0A3D25', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  smallButton: { padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' },
  error: { padding: 11, marginBottom: 12, border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#991B1B', fontSize: 13 },
  empty: { padding: 24, background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 8, color: '#64748B', textAlign: 'center' },
  tableWrap: { overflowX: 'auto', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 },
  table: { width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 12 },
  status: { display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontWeight: 700, fontSize: 10 },
  claimed: { background: '#ECFDF5', color: '#065F46' },
  expired: { background: '#FEF2F2', color: '#991B1B' },
  unclaimed: { background: '#FFFBEB', color: '#92400E' },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12, color: '#64748B', fontSize: 13 },
  detail: { marginTop: 20, padding: 16, border: '1px solid #CBD5E1', borderRadius: 8, background: '#fff' },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailTitle: { margin: 0, color: '#032B14', fontSize: 16 },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 14, alignItems: 'start' },
};
