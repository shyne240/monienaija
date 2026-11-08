import './operational-surfaces.css';
import { Button, PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './workforce-workspace.css';
import { ApiClient } from '../../services/api-client';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import './workforce-redesign.css';
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
  const [pendingDisable, setPendingDisable] = useState<{id:string; reason:string} | null>(null);
  const disableInFlight = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, Boolean(pendingDisable), () => { if (!disableInFlight.current) setPendingDisable(null); }, triggerRef);
  useEffect(() => { if (disableLoading) dialogRef.current?.focus(); }, [disableLoading]);

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

  const handleDisable = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSuspendSupportUser || disableLoading || disableInFlight.current) return;
    setDisableRes(''); setDisableErr('');
    if (!disableUserId.trim()) { setDisableErr('Support user ID is required.'); return; }
    setPendingDisable({ id: disableUserId.trim(), reason: disableReason.trim() });
  };

  const confirmDisable = async () => {
    if (!canSuspendSupportUser || !pendingDisable || disableInFlight.current) return;
    const { id, reason } = pendingDisable;
    const request = ++disableRequest.current;
    disableInFlight.current = true; setDisableLoading(true);
    try {
      const result: any = await ApiClient.post(`/internal/admin/support/workforce-users/${encodeURIComponent(id)}/disable`, { reason: reason || undefined });
      if (request !== disableRequest.current) return;
      if (!result || result.id !== id || result.status !== 'DISABLED') {
        setDisableErr('Disable outcome not confirmed; check an authorized workforce record before retrying.');
        return;
      }
      setDisableRes(`Support user ${id} disabled.`); setDisableReason('');
      if (canViewOverview) void fetchOverview();
    } catch (err: any) {
      if (request === disableRequest.current) setDisableErr(`Disable outcome not confirmed; check an authorized workforce record before retrying. ${err?.message || 'Service unavailable.'}`);
    } finally {
      disableInFlight.current = false;
      if (request === disableRequest.current) { setDisableLoading(false); setPendingDisable(null); }
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
    <div className="mn-operational mn-workforce workforce-redesign" style={wrap}>
      <PageHeader eyebrow="Workforce and governance" title="Workforce Overview & Support Provisioning" description="Review the workforce summary and manage SUPPORT identities according to your function grants." />
      <div className="workforce-redesign__boundary" role="note"><strong>Access controls</strong><span>Workforce metrics are read-only. SUPPORT provisioning and disabling are separate permission-gated actions; no enable action is available here.</span></div>
      {canViewOverview && <section className="workforce-redesign__panel" aria-label="Workforce overview">
        <div className="workforce-redesign__heading"><div><p className="workforce-redesign__eyebrow">READ-ONLY SUMMARY</p><h2>Workforce Overview</h2><p>Current workforce dashboard figures returned by the service.</p></div><Button size="sm" onClick={() => void fetchOverview()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button></div>
        {error && <div className="workforce-redesign__state workforce-redesign__state--error" role="alert">{error}</div>}
        {loading ? <div className="workforce-redesign__state" role="status">Loading workforce overview…</div> : overview ? <>
          <div className="workforce-redesign__stats"><div><span>Active workforce headcount</span><strong>{overview.activeWorkforceHeadcount ?? '—'}</strong></div><div><span>Active sessions</span><strong>{overview.activeSessionCount ?? '—'}</strong></div></div>
          <h3 className="workforce-redesign__subheading">Active role distribution</h3><StructuredRecordTable rows={roleRows} columns={ROLE_COLUMNS} showDetails={false} emptyMessage="No active role assignments were returned." />
        </> : !error && <div className="workforce-redesign__state">No overview data was returned by the workforce widget.</div>}
      </section>}
      <div className="workforce-redesign__actions-grid">
        {canCreateSupportUser && <section className="workforce-redesign__panel" aria-label="Provision SUPPORT workforce user">
          <div className="workforce-redesign__heading"><div><p className="workforce-redesign__eyebrow">PROVISIONING</p><h2>Provision SUPPORT workforce user</h2><p>Creates a SUPPORT-type identity. The temporary password is shown once and must be delivered out-of-band.</p></div></div>
          <form onSubmit={handleCreate} className="workforce-redesign__form">
            <label>Support username or email<input disabled={createLoading} value={createUsername} onChange={event => setCreateUsername(event.target.value)} placeholder="Support username or email" /></label>
            <Button type="submit" variant="primary" disabled={createLoading || !createUsername.trim()}>{createLoading ? 'Creating…' : 'Create SUPPORT User'}</Button>
          </form>
          {createRes && <div className="workforce-redesign__credential" role="status"><strong>One-time credential</strong><p>{createRes}</p><p>There is no credential retrieval flow. Dismiss only after recording it securely.</p><Button size="sm" onClick={() => setCreateRes('')}>Dismiss credential</Button></div>}
          {createErr && <div className="workforce-redesign__state workforce-redesign__state--error" role="alert">{createErr}</div>}
          <p className="workforce-redesign__hint">SUPPORT cannot self-provision; the backend requires <code>workforce.user.create</code>.</p>
        </section>}
        {canSuspendSupportUser && <section className="workforce-redesign__panel" aria-label="Disable SUPPORT workforce user">
          <div className="workforce-redesign__heading"><div><p className="workforce-redesign__eyebrow">ACCESS CONTROL</p><h2>Disable SUPPORT workforce user</h2><p>Use the ID returned during provisioning or from an authorized workforce record. There is no workforce-user list route here.</p></div></div>
          <form onSubmit={handleDisable} className="workforce-redesign__form">
            <label>Support user ID<input disabled={disableLoading} value={disableUserId} onChange={event => setDisableUserId(event.target.value)} placeholder="SUPPORT user ID" /></label>
            <label>Reason (optional)<input disabled={disableLoading} value={disableReason} onChange={event => setDisableReason(event.target.value)} placeholder="Reason for disabling access" /></label>
            <Button ref={triggerRef} type="submit" variant="danger" disabled={disableLoading || !disableUserId.trim()}>{disableLoading ? 'Disabling…' : 'Disable SUPPORT User'}</Button>
          </form>
          {disableRes && <div className="workforce-redesign__state workforce-redesign__state--success" role="status">{disableRes}</div>}
          {disableErr && <div className="workforce-redesign__state workforce-redesign__state--error" role="alert">{disableErr}</div>}
          <p className="workforce-redesign__hint">No enable action is shown: the existing enable endpoint has no matching catalogue function. The screen does not add a guessed permission.</p>
        </section>}
      </div>
      {pendingDisable && <div className="workforce-redesign__overlay"><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="disable-support-title" aria-describedby="disable-support-description" tabIndex={-1} className="workforce-redesign__dialog">
        <p className="workforce-redesign__eyebrow">REVIEW ACCESS CHANGE</p><h2 id="disable-support-title">Disable SUPPORT user?</h2>
        <p id="disable-support-description">This disables the selected SUPPORT user. No enable action is available in this console. Review the identity before confirming.</p>
        <dl><div><dt>Support user ID</dt><dd><code>{pendingDisable.id}</code></dd></div><div><dt>Reason</dt><dd>{pendingDisable.reason || 'Not provided'}</dd></div></dl>
        <div className="workforce-redesign__dialog-actions"><Button onClick={() => setPendingDisable(null)} disabled={disableLoading}>Cancel</Button><Button variant="danger" onClick={() => void confirmDisable()} disabled={disableLoading}>{disableLoading ? 'Disabling…' : 'Confirm disable'}</Button></div>
      </section></div>}
    </div>
  );
};
const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
