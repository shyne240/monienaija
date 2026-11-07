import './operational-surfaces.css';
import { PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './workforce-workspace.css';
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

  const key = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, canViewOverview, canCreateSupportUser, canSuspendSupportUser]);
  return <WorkforceWorkspace key={key} canView={canView} canViewOverview={canViewOverview} canCreateSupportUser={canCreateSupportUser} canSuspendSupportUser={canSuspendSupportUser} />;
};

const WorkforceWorkspace: React.FC<{ canView: boolean; canViewOverview: boolean; canCreateSupportUser: boolean; canSuspendSupportUser: boolean }> = ({canView, canViewOverview, canCreateSupportUser, canSuspendSupportUser}) => {
  const overviewRequest = useRef(0);
  const createRequest = useRef(0);
  const disableRequest = useRef(0);
  const [overview, setOverview] = useState<WorkforceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createRes, setCreateRes] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [disableUserId, setDisableUserId] = useState('');
  const [disableReason, setDisableReason] = useState('');
  const [disableRes, setDisableRes] = useState('');
  const [disableErr, setDisableErr] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  const fetchOverview = useCallback(async () => {
    if (!canViewOverview) return;
    const request = ++overviewRequest.current;
    setLoading(true); setError(''); setOverview(null);
    try {
      const data = await ApiClient.get<WorkforceOverview>('/internal/a2/workforce/dashboard/widgets/workforce-overview');
      if (request !== overviewRequest.current) return;
      const validCount = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
      if (!data || !validCount(data.activeWorkforceHeadcount) || !validCount(data.activeSessionCount) || !Array.isArray(data.roleDistribution) || data.roleDistribution.some(item => !item || typeof item.roleKey !== 'string' || typeof item.count !== 'number' || !Number.isSafeInteger(item.count) || item.count < 0)) throw new Error('Invalid workforce overview response.');
      setOverview(data);
    } catch (err: any) {
      if (request === overviewRequest.current) setError(err?.message || 'Failed to load workforce overview');
    } finally {
      if (request === overviewRequest.current) setLoading(false);
    }
  }, [canViewOverview]);

  useEffect(() => {
    if (canViewOverview) void fetchOverview();
    else setLoading(false);
    return () => { overviewRequest.current += 1; createRequest.current += 1; disableRequest.current += 1; };
  }, [canViewOverview, fetchOverview]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateSupportUser || createLoading) return;
    setCreateRes('');
    setCreateErr('');
    if (!createUsername.trim()) {
      setCreateErr('Support username is required.');
      return;
    }

    const request = ++createRequest.current;
    setCreateLoading(true);
    try {
      const result: any = await ApiClient.post('/internal/admin/support/workforce-users', { username: createUsername.trim() });
      if (request !== createRequest.current) return;
      if (!result || typeof result.username !== 'string' || typeof result.supportUserId !== 'string' || typeof result.temporaryPassword !== 'string' || typeof result.passwordExpiresAt !== 'string' || !result.username.trim() || !result.supportUserId.trim() || !result.temporaryPassword.trim() || !result.passwordExpiresAt.trim()) {
        setCreateErr('The provisioning response was incomplete. The outcome and credential are unconfirmed; check an authorized workforce record before retrying.');
        return;
      }
      setCreateRes(`Support user ${result.username} created (ID ${result.supportUserId}). One-time temporary password: ${result.temporaryPassword}. Expires: ${result.passwordExpiresAt}. Deliver this credential out-of-band.`);
      setDisableUserId(result.supportUserId ?? '');
      setCreateUsername('');
      if (canViewOverview) void fetchOverview();
    } catch (err: any) {
      if (request === createRequest.current) setCreateErr(`Provisioning outcome not confirmed; check an authorized workforce record before retrying. ${err?.message || 'Service unavailable.'}`);
    } finally { if (request === createRequest.current) setCreateLoading(false); }
  };

  const handleDisable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSuspendSupportUser || disableLoading) return;
    setDisableRes('');
    setDisableErr('');
    if (!disableUserId.trim()) {
      setDisableErr('Support user ID is required.');
      return;
    }

    const request = ++disableRequest.current;
    setDisableLoading(true);
    try {
      const result: any = await ApiClient.post(`/internal/admin/support/workforce-users/${encodeURIComponent(disableUserId.trim())}/disable`, {
        reason: disableReason.trim() || undefined,
      });
      if (request !== disableRequest.current) return;
      if (!result || result.id !== disableUserId.trim() || result.status !== 'DISABLED') {
        setDisableErr('Disable outcome not confirmed; check an authorized workforce record before retrying.');
        return;
      }
      setDisableRes(`Support user ${disableUserId.trim()} disabled.`);
      setDisableReason('');
      if (canViewOverview) void fetchOverview();
    } catch (err: any) {
      if (request === disableRequest.current) setDisableErr(`Disable outcome not confirmed; check an authorized workforce record before retrying. ${err?.message || 'Service unavailable.'}`);
    } finally {
      if (request === disableRequest.current) setDisableLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="mn-operational" style={wrap} role="alert">
        <div style={denied}>
          This screen requires <code>workforce.dashboard.view</code>, <code>workforce.user.create</code>, or <code>workforce.user.suspend</code>.
        </div>
      </div>
    );
  }

  const roleRows: DataRecord[] = (overview?.roleDistribution ?? []).map((item) => ({ roleKey: item.roleKey, count: item.count }));

  return (
    <div className="mn-operational mn-workforce" style={wrap}>
      <PageHeader eyebrow="Workforce and governance" title="Workforce Overview & Support Provisioning" description="The available read-only workforce summary and SUPPORT identity actions are shown only when their matching functions are granted." />

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
          ) : !error && <div style={empty}>No overview data was returned by the workforce widget.</div>}
        </section>
      )}

      {canCreateSupportUser && (
        <section style={formCard} aria-label="Provision SUPPORT workforce user">
          <h3 style={h3}>Provision SUPPORT workforce user</h3>
          <p style={sub}>Creates a SUPPORT-type identity. Copy the one-time temporary password from the response and deliver it out-of-band; no credential retrieval flow exists.</p>
          <form onSubmit={handleCreate} style={form}>
            <label style={fieldLabel}>Support username or email
              <input disabled={createLoading} value={createUsername} onChange={(event) => setCreateUsername(event.target.value)} placeholder="Support username or email" style={input} />
            </label>
            <button type="submit" style={btn} disabled={createLoading || !createUsername.trim()}>{createLoading ? 'Creating…' : 'Create SUPPORT User'}</button>
          </form>
          {createRes && <div style={successBox} role="status">{createRes}<div><button type="button" onClick={() => setCreateRes('')}>Dismiss credential</button></div></div>}
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
              <input disabled={disableLoading} value={disableUserId} onChange={(event) => setDisableUserId(event.target.value)} placeholder="SUPPORT user ID" style={input} />
            </label>
            <label style={fieldLabel}>Reason (optional)
              <input disabled={disableLoading} value={disableReason} onChange={(event) => setDisableReason(event.target.value)} placeholder="Reason for disabling access" style={input} />
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

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: 'var(--mn-nav-surface-deep, #082f23)' };
const h3: React.CSSProperties = { margin: 0, color: 'var(--mn-text-primary, #132b25)', fontSize: 16 };
const h4: React.CSSProperties = { margin: '16px 0 10px', color: 'var(--mn-text-primary, #132b25)', fontSize: 14 };
const sub: React.CSSProperties = { color: 'var(--mn-text-secondary, #52655f)', fontSize: 13, margin: '8px 0 12px' };
const overviewCard: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8, marginBottom: 16 };
const sectionHeading: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 };
const summaryGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 };
const summaryCard: React.CSSProperties = { padding: 14, background: 'var(--mn-surface-canvas, #f5f8f6)', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, color: 'var(--mn-text-secondary, #52655f)', fontSize: 13 };
const big: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--mn-nav-surface-deep, #082f23)', marginTop: 6 };
const formCard: React.CSSProperties = { marginTop: 16, padding: 16, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8 };
const form: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 'min(100%, 220px)', color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { ...btn, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, margin: '10px 0', fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, margin: '10px 0', fontSize: 13, overflowWrap: 'anywhere' };
const loadingBox: React.CSSProperties = { padding: 18, textAlign: 'center', color: 'var(--mn-text-secondary, #52655f)' };
const empty: React.CSSProperties = { padding: 16, color: 'var(--mn-text-secondary, #52655f)', background: 'var(--mn-surface-canvas, #f5f8f6)', borderRadius: 6, fontSize: 13 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const note: React.CSSProperties = { marginTop: 12, padding: 10, color: 'var(--mn-text-secondary, #52655f)', background: 'var(--mn-surface-canvas, #f5f8f6)', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, fontSize: 12 };
