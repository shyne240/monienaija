import React, { useEffect, useState } from 'react';
import { StructuredRecordTable, type DataRecord, type StructuredColumn } from '../../components/StructuredData';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface UsageFilters {
  limitProfileCode: string;
  principalType: string;
  principalId: string;
  product: string;
  dimension: string;
  currency: string;
  windowKey: string;
  windowType: string;
  windowFrom: string;
  windowTo: string;
}

interface ReservationFilters extends Omit<UsageFilters, 'windowType' | 'windowFrom' | 'windowTo'> {
  status: string;
  idempotencyKey: string;
  correlationId: string;
  reservedFrom: string;
  reservedTo: string;
  stale: string;
}

interface DiagnosticsResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  data: DataRecord[];
  staleThresholdMinutes?: number;
}

const PAGE_SIZE = 20;
const USAGE_COLUMNS: StructuredColumn[] = [
  { key: 'principalType', label: 'Principal' },
  { key: 'principalId', label: 'Principal ID' },
  { key: 'limitProfileCode', label: 'Profile' },
  { key: 'product', label: 'Product' },
  { key: 'dimension', label: 'Dimension' },
  { key: 'currency', label: 'Currency' },
  { key: 'usedAmountMinor', label: 'Used (minor units)' },
  { key: 'reservedAmountMinor', label: 'Reserved (minor units)' },
  { key: 'usedCount', label: 'Used count' },
  { key: 'reservedCount', label: 'Reserved count' },
];
const RESERVATION_COLUMNS: StructuredColumn[] = [
  { key: 'status', label: 'Status' },
  { key: 'principalType', label: 'Principal' },
  { key: 'principalId', label: 'Principal ID' },
  { key: 'limitProfileCode', label: 'Profile' },
  { key: 'product', label: 'Product' },
  { key: 'amountMinor', label: 'Amount (minor units)' },
  { key: 'currency', label: 'Currency' },
  { key: 'reservedAt', label: 'Reserved at' },
  { key: 'ageSeconds', label: 'Age (seconds)' },
  { key: 'stale', label: 'Stale flag' },
];
const INITIAL_USAGE_FILTERS: UsageFilters = {
  limitProfileCode: '', principalType: '', principalId: '', product: '', dimension: '', currency: '',
  windowKey: '', windowType: '', windowFrom: '', windowTo: '',
};
const INITIAL_RESERVATION_FILTERS: ReservationFilters = {
  limitProfileCode: '', principalType: '', principalId: '', product: '', dimension: '', currency: '',
  windowKey: '', status: '', idempotencyKey: '', correlationId: '', reservedFrom: '', reservedTo: '', stale: '',
};

function buildQuery(filters: object, page: number): string {
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const cleaned = value.trim();
    if (cleaned) query.set(key, cleaned);
  });
  return query.toString();
}

export const LimitAssignmentScreen: React.FC<{ initialCustomerId?: string; onBackToCustomer?: () => void }> = ({ initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canAssignAgent = hasFn('agent.assign_limit');
  const canView = canAssignAgent || hasFn('limit.view');
  const canViewDiagnostics = hasFn('limit.view');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentFilters, setAssignmentFilters] = useState({
    subjectType: '',
    subjectId: '',
    limitProfileCode: '',
    isActive: '',
  });
  const [agentId, setAgentId] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [resultErr, setResultErr] = useState('');
  const [usageFilters, setUsageFilters] = useState<UsageFilters>(INITIAL_USAGE_FILTERS);
  const [reservationFilters, setReservationFilters] = useState<ReservationFilters>(INITIAL_RESERVATION_FILTERS);
  const [usageResult, setUsageResult] = useState<DiagnosticsResult | null>(null);
  const [reservationResult, setReservationResult] = useState<DiagnosticsResult | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [reservationError, setReservationError] = useState('');

  const fetchAssignments = async (overrideFilters?: typeof assignmentFilters) => {
    setLoading(true);
    setError('');
    try {
      let endpoint: string;
      if (initialCustomerId) {
        endpoint = `/internal/limit-assignments/customer/${encodeURIComponent(initialCustomerId)}`;
      } else {
        const activeFilters = overrideFilters ?? assignmentFilters;
        const query = new URLSearchParams();
        Object.entries(activeFilters).forEach(([key, value]) => {
          if (value.trim()) query.set(key, value.trim());
        });
        const qs = query.toString();
        endpoint = qs ? `/internal/limit-assignments?${qs}` : '/internal/limit-assignments';
      }
      const response: any = await ApiClient.get(endpoint);
      setAssignments(response.data || response.items || (Array.isArray(response) ? response : []));
    } catch (err: any) {
      setError(err?.message || 'Failed to load limit assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void fetchAssignments();
    else setLoading(false);
  }, [canView, initialCustomerId]);

  const loadUsages = async (page = 1) => {
    if (!canViewDiagnostics) return;
    setUsageLoading(true);
    setUsageError('');
    setUsageResult(null);
    try {
      const query = buildQuery(usageFilters, page);
      const response = await ApiClient.get<DiagnosticsResult>(`/internal/limit-usages?${query}`);
      setUsageResult(response);
    } catch (err: any) {
      setUsageError(err?.message || 'Failed to load usage diagnostics');
    } finally {
      setUsageLoading(false);
    }
  };

  const loadReservations = async (page = 1) => {
    if (!canViewDiagnostics) return;
    setReservationLoading(true);
    setReservationError('');
    setReservationResult(null);
    try {
      const query = buildQuery(reservationFilters, page);
      const response = await ApiClient.get<DiagnosticsResult>(`/internal/limit-reservations?${query}`);
      setReservationResult(response);
    } catch (err: any) {
      setReservationError(err?.message || 'Failed to load reservation diagnostics');
    } finally {
      setReservationLoading(false);
    }
  };

  const handleAssign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAssignAgent) return;
    setResult('');
    setResultErr('');
    if (!agentId.trim() || !profileCode.trim()) {
      setResultErr('Agent ID and profile code required');
      return;
    }
    try {
      await ApiClient.post('/internal/limit-assignments', {
        limitProfileCode: profileCode.trim().toUpperCase(),
        subjectType: 'AGENT',
        subjectId: agentId.trim(),
      });
      setResult(`Assigned profile ${profileCode.trim().toUpperCase()} to agent ${agentId.trim()}`);
      void fetchAssignments();
    } catch (err: any) {
      setResultErr(err?.message || 'Assign failed — requires agent.assign_limit (AGENT_NETWORK_MANAGER)');
    }
  };

  const handleToggleAgentAssignment = async (assignment: any) => {
    if (!canAssignAgent || assignment.subjectType !== 'AGENT' || toggleBusyId) return;
    setResult('');
    setResultErr('');
    setToggleBusyId(assignment.id);
    try {
      await ApiClient.patch(`/internal/limit-assignments/${encodeURIComponent(assignment.id)}`, {
        subjectType: 'AGENT',
        isActive: !assignment.isActive,
        version: assignment.version ?? 1,
      });
      setResult(
        `Agent limit assignment ${assignment.limitProfileCode} ${assignment.isActive ? 'deactivated' : 'activated'}.`,
      );
      void fetchAssignments();
    } catch (err: any) {
      setResultErr(err?.message || 'Failed to update Agent limit assignment');
    } finally {
      setToggleBusyId(null);
    }
  };

  if (!canView) return <div style={wrap} role="alert"><div style={denied}>Viewing limit assignments requires <code>limit.view</code> or <code>agent.assign_limit</code>.</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>📏 Limit Assignments</h2>
      <p style={sub}>View existing assignments. Creating an agent assignment is available only with <code>agent.assign_limit</code>; catalogue definitions are managed separately.</p>
      {initialCustomerId && <div style={note}>Showing assignments for customer <code>{initialCustomerId}</code>.{onBackToCustomer && <> <button type="button" onClick={onBackToCustomer} style={smallLink}>Back to Customer 360°</button></>}</div>}
      {!initialCustomerId && (
        <form
          aria-label="Assignment filters"
          onSubmit={(event) => { event.preventDefault(); void fetchAssignments(); }}
          style={filterGrid}
        >
          <label style={fieldLabel}>Assignment subject type
            <select
              aria-label="Assignment subject type"
              value={assignmentFilters.subjectType}
              onChange={(event) => setAssignmentFilters((cur) => ({ ...cur, subjectType: event.target.value }))}
              style={input}
            >
              <option value="">All subjects</option>
              <option value="AGENT">AGENT</option>
              <option value="AGENT_CLASS">AGENT_CLASS</option>
              <option value="CUSTOMER">CUSTOMER</option>
              <option value="SEGMENT">SEGMENT</option>
            </select>
          </label>
          <label style={fieldLabel}>Assignment subject UUID
            <input
              aria-label="Assignment subject UUID"
              value={assignmentFilters.subjectId}
              onChange={(event) => setAssignmentFilters((cur) => ({ ...cur, subjectId: event.target.value }))}
              placeholder="Agent or customer UUID"
              style={input}
            />
          </label>
          <label style={fieldLabel}>Assignment profile code
            <input
              aria-label="Assignment profile code"
              value={assignmentFilters.limitProfileCode}
              onChange={(event) => setAssignmentFilters((cur) => ({ ...cur, limitProfileCode: event.target.value }))}
              placeholder="e.g. AGENT_STANDARD"
              style={input}
            />
          </label>
          <label style={fieldLabel}>Assignment active state
            <select
              aria-label="Assignment active state"
              value={assignmentFilters.isActive}
              onChange={(event) => setAssignmentFilters((cur) => ({ ...cur, isActive: event.target.value }))}
              style={input}
            >
              <option value="">All states</option>
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" style={btn} disabled={loading}>Filter assignments</button>
            <button
              type="button"
              style={btn}
              disabled={loading}
              onClick={() => {
                const cleared = { subjectType: '', subjectId: '', limitProfileCode: '', isActive: '' };
                setAssignmentFilters(cleared);
                void fetchAssignments(cleared);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      )}
      {error && <div style={errBox} role="alert">{error}</div>}
      {loading ? <div style={loadingBox}>Loading assignments…</div> : assignments.length === 0 ? (
        <div style={empty}>No matching limit assignments.</div>
      ) : (
        <table style={table}>
          <thead><tr><th>Subject</th><th>Profile</th><th>Active</th><th>Version</th><th>Effective</th>{canAssignAgent && <th>Action</th>}</tr></thead>
          <tbody>{assignments.map((assignment: any) => (
            <tr key={assignment.id}>
              <td style={mono}>{assignment.subjectType}: {assignment.subjectId || assignment.segmentCode || '-'}</td>
              <td>{assignment.limitProfileCode || '-'}</td>
              <td><span style={badge(assignment.isActive ? 'ACTIVE' : 'INACTIVE')}>{assignment.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
              <td>{assignment.version ?? 1}</td>
              <td>{assignment.effectiveFrom ? new Date(assignment.effectiveFrom).toLocaleString() : '-'}</td>
              {canAssignAgent && (
                <td>
                  {assignment.subjectType === 'AGENT' ? (
                    <button
                      type="button"
                      style={smallLink}
                      disabled={toggleBusyId === assignment.id}
                      onClick={() => void handleToggleAgentAssignment(assignment)}
                    >
                      {assignment.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  ) : '—'}
                </td>
              )}
            </tr>
          ))}</tbody>
        </table>
      )}
      {!initialCustomerId && canAssignAgent && <div style={formCard}>
        <h4 style={h4}>Assign Limit Profile to Agent</h4>
        <form onSubmit={handleAssign} style={form}>
          <input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="Agent UUID" style={input} />
          <input value={profileCode} onChange={(event) => setProfileCode(event.target.value)} placeholder="Profile code (e.g. AGENT_STANDARD)" style={input} />
          <button type="submit" style={btn}>Assign</button>
        </form>
        {result && <div style={successBox} role="status">{result}</div>}
        {resultErr && <div style={errBox} role="alert">{resultErr}</div>}
      </div>}

      {canViewDiagnostics ? (
        <>
          <div style={diagnosticNotice}>
            These existing diagnostics are read-only. The API enforces <code>limit.view</code> server-side, AND-combined with the workforce principal-type allowlist (audit F-03/P0-03 correction); this page requests them only when the signed-in principal holds <code>limit.view</code>, matching the backend gate. Stale reservations are flagged for investigation only: age is not proof of an orphan, and this screen does not release reservations.
          </div>
          <section style={diagnosticCard} aria-label="Limit usage diagnostics">
            <h3 style={sectionTitle}>Usage Diagnostics</h3>
            <p style={sectionHelp}>Inspect recorded and reserved usage by principal, profile, product, and window.</p>
            <form onSubmit={(event) => { event.preventDefault(); void loadUsages(1); }} style={filterGrid}>
              {textFilter('Profile code', usageFilters.limitProfileCode, (value) => setUsageFilters((current) => ({ ...current, limitProfileCode: value })))}
              {textFilter('Principal type', usageFilters.principalType, (value) => setUsageFilters((current) => ({ ...current, principalType: value })))}
              {textFilter('Principal ID', usageFilters.principalId, (value) => setUsageFilters((current) => ({ ...current, principalId: value })))}
              {textFilter('Product', usageFilters.product, (value) => setUsageFilters((current) => ({ ...current, product: value })))}
              {textFilter('Dimension', usageFilters.dimension, (value) => setUsageFilters((current) => ({ ...current, dimension: value })))}
              {textFilter('Currency', usageFilters.currency, (value) => setUsageFilters((current) => ({ ...current, currency: value })))}
              {textFilter('Window key', usageFilters.windowKey, (value) => setUsageFilters((current) => ({ ...current, windowKey: value })))}
              {textFilter('Window type', usageFilters.windowType, (value) => setUsageFilters((current) => ({ ...current, windowType: value })))}
              {textFilter('Window from (ISO-8601)', usageFilters.windowFrom, (value) => setUsageFilters((current) => ({ ...current, windowFrom: value })))}
              {textFilter('Window to (ISO-8601)', usageFilters.windowTo, (value) => setUsageFilters((current) => ({ ...current, windowTo: value })))}
              <button type="submit" style={btn} disabled={usageLoading}>{usageLoading ? 'Loading…' : 'Search usage'}</button>
            </form>
            {usageError && <div style={errBox} role="alert">{usageError}</div>}
            {usageLoading ? <div style={loadingBox}>Loading usage diagnostics…</div> : usageResult && (
              <>
                <div style={resultSummary}>Total {usageResult.total} · Page {usageResult.page} of {Math.max(1, usageResult.totalPages)}</div>
                <StructuredRecordTable rows={usageResult.data} columns={USAGE_COLUMNS} emptyMessage="No usage rows match these filters." />
                <div style={pager}>
                  <button type="button" style={smallLink} disabled={usageResult.page <= 1 || usageLoading} onClick={() => void loadUsages(usageResult.page - 1)}>Previous</button>
                  <button type="button" style={smallLink} disabled={usageResult.page >= usageResult.totalPages || usageLoading} onClick={() => void loadUsages(usageResult.page + 1)}>Next</button>
                </div>
              </>
            )}
          </section>

          <section style={diagnosticCard} aria-label="Limit reservation diagnostics">
            <h3 style={sectionTitle}>Reservation Diagnostics</h3>
            <p style={sectionHelp}>Read reservation status, age, and correlation references. No recovery mutation is offered here.</p>
            <form onSubmit={(event) => { event.preventDefault(); void loadReservations(1); }} style={filterGrid}>
              <label style={fieldLabel}>Status
                <select value={reservationFilters.status} onChange={(event) => setReservationFilters((current) => ({ ...current, status: event.target.value }))} style={input}>
                  <option value="">All statuses</option><option value="RESERVED">RESERVED</option><option value="COMMITTED">COMMITTED</option><option value="RELEASED">RELEASED</option>
                </select>
              </label>
              <label style={fieldLabel}>Stale only
                <select value={reservationFilters.stale} onChange={(event) => setReservationFilters((current) => ({ ...current, stale: event.target.value }))} style={input}>
                  <option value="">All reservations</option><option value="true">Stale only</option>
                </select>
              </label>
              {textFilter('Profile code', reservationFilters.limitProfileCode, (value) => setReservationFilters((current) => ({ ...current, limitProfileCode: value })))}
              {textFilter('Principal type', reservationFilters.principalType, (value) => setReservationFilters((current) => ({ ...current, principalType: value })))}
              {textFilter('Principal ID', reservationFilters.principalId, (value) => setReservationFilters((current) => ({ ...current, principalId: value })))}
              {textFilter('Product', reservationFilters.product, (value) => setReservationFilters((current) => ({ ...current, product: value })))}
              {textFilter('Dimension', reservationFilters.dimension, (value) => setReservationFilters((current) => ({ ...current, dimension: value })))}
              {textFilter('Currency', reservationFilters.currency, (value) => setReservationFilters((current) => ({ ...current, currency: value })))}
              {textFilter('Window key', reservationFilters.windowKey, (value) => setReservationFilters((current) => ({ ...current, windowKey: value })))}
              {textFilter('Idempotency key', reservationFilters.idempotencyKey, (value) => setReservationFilters((current) => ({ ...current, idempotencyKey: value })))}
              {textFilter('Correlation ID', reservationFilters.correlationId, (value) => setReservationFilters((current) => ({ ...current, correlationId: value })))}
              {textFilter('Reserved from (ISO-8601)', reservationFilters.reservedFrom, (value) => setReservationFilters((current) => ({ ...current, reservedFrom: value })))}
              {textFilter('Reserved to (ISO-8601)', reservationFilters.reservedTo, (value) => setReservationFilters((current) => ({ ...current, reservedTo: value })))}
              <button type="submit" style={btn} disabled={reservationLoading}>{reservationLoading ? 'Loading…' : 'Search reservations'}</button>
            </form>
            {reservationError && <div style={errBox} role="alert">{reservationError}</div>}
            {reservationLoading ? <div style={loadingBox}>Loading reservation diagnostics…</div> : reservationResult && (
              <>
                <div style={resultSummary}>Total {reservationResult.total} · Page {reservationResult.page} of {Math.max(1, reservationResult.totalPages)}{reservationResult.staleThresholdMinutes !== undefined && <> · Stale threshold {reservationResult.staleThresholdMinutes} min</>}</div>
                <StructuredRecordTable rows={reservationResult.data} columns={RESERVATION_COLUMNS} emptyMessage="No reservations match these filters." />
                <div style={pager}>
                  <button type="button" style={smallLink} disabled={reservationResult.page <= 1 || reservationLoading} onClick={() => void loadReservations(reservationResult.page - 1)}>Previous</button>
                  <button type="button" style={smallLink} disabled={reservationResult.page >= reservationResult.totalPages || reservationLoading} onClick={() => void loadReservations(reservationResult.page + 1)}>Next</button>
                </div>
              </>
            )}
          </section>
        </>
      ) : (
        <div style={note}>Usage and reservation diagnostics are shown only to principals with <code>limit.view</code>. The assignment and agent-profile actions above use their separate functions.</div>
      )}
      <div style={note}>See Commercial → Limit Catalogue for profile definitions. Usage and reservation reads are diagnostics only; no limits or financial state are changed by these panels.</div>
    </div>
  );
};

function textFilter(label: string, value: string, onChange: (next: string) => void) {
  return (
    <label key={label} style={fieldLabel}>{label}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} style={input} />
    </label>
  );
}

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 12 };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B', background: '#fff', borderRadius: 8, border: '1px dashed #E2E8F0' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' };
const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 };
const badge = (status: string): React.CSSProperties => ({ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: status === 'ACTIVE' ? '#ECFDF5' : '#F1F5F9', color: '#334155' });
const formCard: React.CSSProperties = { marginTop: 16, padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 };
const h4: React.CSSProperties = { margin: '0 0 8px' };
const form: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
const filterGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end', marginBottom: 12 };
const input: React.CSSProperties = { boxSizing: 'border-box', width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0', minWidth: 0, background: '#fff' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer' };
const smallLink: React.CSSProperties = { padding: '4px 7px', borderRadius: 5, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#334155', cursor: 'pointer', fontSize: 11 };
const note: React.CSSProperties = { marginTop: 12, fontSize: 12, color: '#64748B', background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' };
const diagnosticNotice: React.CSSProperties = { marginTop: 16, fontSize: 12, color: '#92400E', background: '#FFFBEB', padding: 10, borderRadius: 6, border: '1px solid #FDE68A', lineHeight: 1.5 };
const diagnosticCard: React.CSSProperties = { marginTop: 16, padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 };
const sectionTitle: React.CSSProperties = { margin: '0 0 6px', fontSize: 16, color: '#032B14' };
const sectionHelp: React.CSSProperties = { margin: '0 0 12px', color: '#64748B', fontSize: 12 };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, color: '#475569', fontSize: 12 };
const resultSummary: React.CSSProperties = { marginBottom: 8, fontSize: 12, color: '#475569' };
const pager: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 };
