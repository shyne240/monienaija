import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { DataRecord, StructuredColumn, StructuredRecordTable } from '../../components/StructuredData';

interface WorkforceOverview {
  activeWorkforceHeadcount?: number;
  roleDistribution?: Array<{ roleKey: string; count: number }>;
  activeSessionCount?: number;
}

const ROLE_COLUMNS: StructuredColumn[] = [
  { key: 'roleKey', label: 'Role' },
  { key: 'count', label: 'Active assignments' },
];

export const WorkforceAdminScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canViewOverview = hasFn('workforce.dashboard.view');
  const canCreateSupportUser = hasFn('workforce.user.create');
  const canSuspendSupportUser = hasFn('workforce.user.suspend');
  const canView = canViewOverview || canCreateSupportUser || canSuspendSupportUser;

  const [overview, setOverview] = useState<WorkforceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createRes, setCreateRes] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [disableUserId, setDisableUserId] = useState('');
  const [disableReason, setDisableReason] = useState('');
  const [disableRes, setDisableRes] = useState('');
  const [disableErr, setDisableErr] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  const fetchOverview = async () => {
    if (!canViewOverview) return;
    setLoading(true);
    setError('');
    try {
      const data = await ApiClient.get<WorkforceOverview>('/internal/a2/workforce/dashboard/widgets/workforce-overview');
      setOverview(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load workforce overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canViewOverview) void fetchOverview();
    else setLoading(false);
  }, [canViewOverview]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateSupportUser) return;
    setCreateRes('');
    setCreateErr('');
    if (!createUsername.trim()) {
      setCreateErr('Support username is required.');
      return;
    }

    try {
      const result: any = await ApiClient.post('/internal/admin/support/workforce-users', { username: createUsername.trim() });
      setCreateRes(`Support user ${result.username} created (ID ${result.supportUserId}). One-time temporary password: ${result.temporaryPassword}. Expires: ${result.passwordExpiresAt}. Deliver this credential out-of-band.`);
      setDisableUserId(result.supportUserId ?? '');
      setCreateUsername('');
      if (canViewOverview) void fetchOverview();
    } catch (err: any) {
      setCreateErr(err?.message || 'Create failed');
    }
  };

  const handleDisable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSuspendSupportUser) return;
    setDisableRes('');
    setDisableErr('');
    if (!disableUserId.trim()) {
      setDisableErr('Support user ID is required.');
      return;
    }

    setDisableLoading(true);
    try {
      await ApiClient.post(`/internal/admin/support/workforce-users/${encodeURIComponent(disableUserId.trim())}/disable`, {
        reason: disableReason.trim() || undefined,
      });
      setDisableRes(`Support user ${disableUserId.trim()} disabled.`);
      setDisableReason('');
      if (canViewOverview) void fetchOverview();
    } catch (err: any) {
      setDisableErr(err?.message || 'Disable failed');
    } finally {
      setDisableLoading(false);
    }
  };

  if (!canView) {
    return (
      <div style={wrap} role="alert">
        <div style={denied}>
          This screen requires <code>workforce.dashboard.view</code>, <code>workforce.user.create</code>, or <code>workforce.user.suspend</code>.
        </div>
      </div>
    );
  }

  const roleRows: DataRecord[] = (overview?.roleDistribution ?? []).map((item) => ({ roleKey: item.roleKey, count: item.count }));

  return (
    <div style={wrap}>
      <h2 style={h2}>👷 Workforce Overview & Support Provisioning</h2>
      <p style={sub}>The available read-only workforce summary and SUPPORT identity actions are shown only when their matching functions are granted.</p>

      {canViewOverview && (
        <section style={overviewCard} aria-label="Workforce overview">
          <div style={sectionHeading}>
            <h3 style={h3}>Workforce Overview</h3>
            <button type="button" onClick={() => void fetchOverview()} style={btn} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {error && <div style={errBox} role="alert">{error}</div>}
          {loading ? <div style={loadingBox}>Loading workforce overview…</div> : overview ? (
            <>
              <div style={summaryGrid}>
                <div style={summaryCard}><strong>Active workforce headcount</strong><div style={big}>{overview.activeWorkforceHeadcount ?? '—'}</div></div>
                <div style={summaryCard}><strong>Active sessions</strong><div style={big}>{overview.activeSessionCount ?? '—'}</div></div>
              </div>
              <h4 style={h4}>Active role distribution</h4>
              <StructuredRecordTable
                rows={roleRows}
                columns={ROLE_COLUMNS}
                showDetails={false}
                emptyMessage="No active role assignments were returned."
              />
            </>
          ) : <div style={empty}>No overview data was returned by the workforce widget.</div>}
        </section>
      )}

      {canCreateSupportUser && (
        <section style={formCard} aria-label="Provision SUPPORT workforce user">
          <h3 style={h3}>Provision SUPPORT workforce user</h3>
          <p style={sub}>Creates a SUPPORT-type identity. Copy the one-time temporary password from the response and deliver it out-of-band; no credential retrieval flow exists.</p>
          <form onSubmit={handleCreate} style={form}>
            <label style={fieldLabel}>Support username or email
              <input value={createUsername} onChange={(event) => setCreateUsername(event.target.value)} placeholder="Support username or email" style={input} />
            </label>
            <button type="submit" style={btn}>Create SUPPORT User</button>
          </form>
          {createRes && <div style={successBox} role="status">{createRes}</div>}
          {createErr && <div style={errBox} role="alert">{createErr}</div>}
          <div style={note}>SUPPORT cannot self-provision; the backend requires <code>workforce.user.create</code>.</div>
        </section>
      )}

      {canSuspendSupportUser && (
        <section style={formCard} aria-label="Disable SUPPORT workforce user">
          <h3 style={h3}>Disable SUPPORT workforce user</h3>
          <p style={sub}>The API has no workforce-user list route. Use the ID returned during provisioning or an ID from an authorized workforce record.</p>
          <form onSubmit={handleDisable} style={form}>
            <label style={fieldLabel}>Support user ID
              <input value={disableUserId} onChange={(event) => setDisableUserId(event.target.value)} placeholder="SUPPORT user ID" style={input} />
            </label>
            <label style={fieldLabel}>Reason (optional)
              <input value={disableReason} onChange={(event) => setDisableReason(event.target.value)} placeholder="Reason for disabling access" style={input} />
            </label>
            <button type="submit" style={dangerBtn} disabled={disableLoading || !disableUserId.trim()}>
              {disableLoading ? 'Disabling…' : 'Disable SUPPORT User'}
            </button>
          </form>
          {disableRes && <div style={successBox} role="status">{disableRes}</div>}
          {disableErr && <div style={errBox} role="alert">{disableErr}</div>}
          <div style={note}>No enable action is shown: the existing enable endpoint has no matching catalogue function. The screen does not add a guessed permission.</div>
        </section>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const h3: React.CSSProperties = { margin: 0, color: '#334155', fontSize: 16 };
const h4: React.CSSProperties = { margin: '16px 0 10px', color: '#334155', fontSize: 14 };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, margin: '8px 0 12px' };
const overviewCard: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, marginBottom: 16 };
const sectionHeading: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 };
const summaryGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
const summaryCard: React.CSSProperties = { padding: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, color: '#475569', fontSize: 13 };
const big: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: '#032B14', marginTop: 6 };
const formCard: React.CSSProperties = { marginTop: 16, padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8 };
const form: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 220, color: '#475569', fontSize: 12 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { ...btn, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, margin: '10px 0', fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, margin: '10px 0', fontSize: 13, overflowWrap: 'anywhere' };
const loadingBox: React.CSSProperties = { padding: 18, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 16, color: '#64748B', background: '#F8FAFC', borderRadius: 6, fontSize: 13 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const note: React.CSSProperties = { marginTop: 12, padding: 10, color: '#64748B', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 };
