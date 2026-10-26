import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { AgentFundingPanel } from './AgentFundingPanel';
import { AgentCredentialPanel } from './AgentCredentialPanel';

interface Agent {
  id: string;
  reference: string;
  status: string;
  agentClassId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentFinancialPosition {
  agentId: string;
  currency: string;
  balanceMinor: string;
  walletExists: boolean;
  walletId: string | null;
}

export const AgentNetworkScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canView = hasFn('agent.view');
  const canManageFunding =
    (principal?.roles.includes('AGENT_NETWORK_MANAGER') === true ||
      principal?.roles.includes('FINANCE_CONTROLLER') === true) &&
    (hasFn('agent.fund') || hasFn('agent.defund'));
  const canSuspend = hasFn('agent.suspend');
  const canTerminate = hasFn('agent.terminate');
  const canReactivate = hasFn('agent.reactivate');
  const canActivate = hasFn('agent.activate');
  const canLifecycle = canSuspend || canTerminate || canReactivate || canActivate;
  const canManageCredentials = hasFn('agent.manage_credentials');

  const lifecycleFunctions = {
    suspend: 'agent.suspend',
    terminate: 'agent.terminate',
    reactivate: 'agent.reactivate',
    activate: 'agent.activate',
  } as const;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Agent | null>(null);
  const [position, setPosition] = useState<AgentFinancialPosition | null>(null);
  const [detailError, setDetailError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const fetchAgents = async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true); setError('');
    try {
      const params: string[] = [`page=${page}`, `limit=20`];
      if (statusFilter) params.push(`status=${statusFilter}`);
      const res: any = await ApiClient.get(`/internal/agents?${params.join('&')}`);
      setAgents(res.data || res || []);
      setTotal(res.total ?? (res.data?.length ?? 0));
    } catch (e: any) { setError(e?.message || 'Failed to load agents'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (canView) fetchAgents(); else setLoading(false); }, [page, statusFilter, canView]);

  const openDetail = async (a: Agent) => {
    if (!canView) return;
    setSelected(a); setPosition(null); setDetailError(''); setActionMsg(''); setActionErr('');
    try {
      const pos: any = await ApiClient.get(`/internal/agents/${a.id}/financial-position`);
      setPosition(pos);
    } catch (e: any) { setDetailError(e?.message || 'Failed to load financial position'); }
  };

  const doLifecycle = async (action: keyof typeof lifecycleFunctions, id: string) => {
    if (!hasFn(lifecycleFunctions[action])) return;
    setActionErr(''); setActionMsg('');
    try {
      await ApiClient.post(`/internal/admin/agents/${id}/${action}`, { reason: `${action} via Admin Web` });
      setActionMsg(`Agent ${action} succeeded`);
      fetchAgents();
    } catch (e: any) { setActionErr(e?.message || `${action} failed`); }
  };

  if (!canView) {
    return (
      <div style={wrap}>
        <div style={denied}>Agent directory access requires <code>agent.view</code>. Your roles: {principal?.roles.join(', ')}</div>
        {canManageFunding && <AgentFundingPanel />}
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h2 style={h2}>🏪 Agent Network Management</h2>
      <p style={sub}>Browse agents, inspect ledger-derived financial positions, and perform only lifecycle actions granted to this principal.</p>
      {canManageFunding && <AgentFundingPanel />}

      <div style={filters}>
        <label>Status: <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value); setPage(1);}}><option value="">All</option><option value="PENDING">PENDING</option><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option><option value="TERMINATED">TERMINATED</option></select></label>
        <button onClick={fetchAgents} style={btn}>Refresh</button>
      </div>

      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading agents…</div> :
        agents.length === 0 ? <div style={empty}>No agents found for this filter.</div> :
        <table style={table}><thead><tr><th>Reference</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>{agents.map(a=><tr key={a.id}><td>{a.reference}</td><td><span style={badge(a.status)}>{a.status}</span></td><td>{new Date(a.createdAt).toLocaleString()}</td><td><button onClick={()=>openDetail(a)} style={smallBtn}>View</button></td></tr>)}</tbody></table>
      }
      <div style={pager}>Total: {total} — Page {page} <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} style={smallBtn}>Prev</button> <button onClick={()=>setPage(p=>p+1)} style={smallBtn}>Next</button></div>

      {selected && (
        <div style={drawer}>
          <div style={drawerHead}><strong>{selected.reference}</strong> — {selected.status} <button onClick={()=>setSelected(null)} style={smallBtn}>Close</button></div>
          <div style={drawerBody}>
            <div><strong>ID:</strong> {selected.id}</div>
            <div><strong>Class:</strong> {selected.agentClassId}</div>
            {detailError && <div style={errBox}>{detailError}</div>}
            {position ? <div style={card}><strong>Financial Position (NGN ledger-derived)</strong><div>Wallet: {position.walletExists ? position.walletId : 'none'} — Balance: {(Number(position.balanceMinor)/100).toLocaleString()} NGN</div></div> : <div style={loadingBox}>Loading position…</div>}
            {canLifecycle && <div style={actionRow} aria-label="Granted agent lifecycle actions">
              {canSuspend && <button onClick={()=>doLifecycle('suspend', selected.id)} style={warnBtn}>Suspend</button>}
              {canTerminate && <button onClick={()=>doLifecycle('terminate', selected.id)} style={dangerBtn}>Terminate</button>}
              {canReactivate && <button onClick={()=>doLifecycle('reactivate', selected.id)} style={successBtn}>Reactivate</button>}
              {canActivate && <button onClick={()=>doLifecycle('activate', selected.id)} style={successBtn}>Activate</button>}
            </div>}
            {actionMsg && <div style={successBox}>{actionMsg}</div>}
            {actionErr && <div style={errBox}>{actionErr}</div>}
            {!canLifecycle && <div style={denied}>Lifecycle actions require <code>agent.suspend / terminate / reactivate / activate</code>.</div>}
            {canManageCredentials && <AgentCredentialPanel agentId={selected.id} agentStatus={selected.status} canManage={canManageCredentials} />}
          </div>
        </div>
      )}
    </div>
  );
};

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1100 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 16 };
const filters: React.CSSProperties = { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer' };
const smallBtn: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 12 };
const warnBtn: React.CSSProperties = { ...smallBtn, background: '#FFF7ED', borderColor: '#FDBA74' };
const dangerBtn: React.CSSProperties = { ...smallBtn, background: '#FEF2F2', borderColor: '#FCA5A5' };
const successBtn: React.CSSProperties = { ...smallBtn, background: '#ECFDF5', borderColor: '#6EE7B7' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' };
const badge = (s: string): React.CSSProperties => ({ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: s==='ACTIVE'?'#ECFDF5': s==='SUSPENDED'?'#FFF7ED':'#F1F5F9', color: s==='ACTIVE'?'#065F46': s==='SUSPENDED'?'#92400E':'#334155' });
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const successBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B', background: '#fff', borderRadius: 8, border: '1px dashed #E2E8F0' };
const pager: React.CSSProperties = { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#64748B' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const drawer: React.CSSProperties = { marginTop: 16, border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', overflow: 'hidden' };
const drawerHead: React.CSSProperties = { padding: 12, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const drawerBody: React.CSSProperties = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 };
const card: React.CSSProperties = { padding: 12, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' as const };
