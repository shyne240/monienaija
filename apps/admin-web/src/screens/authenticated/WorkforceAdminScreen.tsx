import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const WorkforceAdminScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('workforce.user.view') || hasFn('workforce.dashboard.view') || hasFn('workforce.role.view') || principal?.roles.includes('ADMINISTRATOR') || principal?.roles.includes('SUPER_ADMIN') || hasFn('privileged:execute');
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createRole, setCreateRole] = useState('OPERATIONS');
  const [createRes, setCreateRes] = useState(''); const [createErr, setCreateErr] = useState('');

  const fetchOverview = async () => {
    setLoading(true); setError('');
    try {
      // Reuse dashboard widget workforce-overview endpoint (direct)
      const data: any = await ApiClient.get('/internal/a2/workforce/dashboard/widgets/workforce-overview');
      setOverview(data);
    } catch(e:any){ setError(e?.message||'Failed to load workforce overview'); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{ if(canView) fetchOverview(); else setLoading(false); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setCreateRes(''); setCreateErr('');
    try {
      const res: any = await ApiClient.post('/internal/admin/support/workforce-users', { email: createEmail, role: createRole, displayName: createEmail.split('@')[0] });
      setCreateRes(`Created workforce user ${res.id || createEmail} — check response for credentials`);
      fetchOverview();
    } catch(e:any){ setCreateErr(e?.message||'Create failed'); }
  };

  if(!canView) return <div style={wrap}><div style={denied}>Requires <code>workforce.user.view</code> or <code>ADMINISTRATOR / SUPER_ADMIN</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>👷 Workforce Administration</h2>
      <p style={sub}>Workforce headcount, role distribution, and SUPPORT provisioning. Read via dashboard workforce-overview widget; mutate via admin workforce user endpoint.</p>
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading workforce overview…</div> :
        overview ? <div style={grid}>
          <div style={card}><strong>Headcount</strong><div style={big}>{overview.totalUsers ?? overview.headcount ?? '-'}</div><div style={muted}>Active workforce principals</div></div>
          <div style={card}><strong>By Role</strong><pre style={pre}>{JSON.stringify(overview.byRole ?? overview.distribution ?? overview, null, 2)}</pre></div>
        </div> : <div style={empty}>No overview data — ensure at least one workforce assignment exists (seed 11 roles).</div>
      }
      <div style={formCard}>
        <h4 style={h4}>Provision SUPPORT workforce user (OPERATOR-only)</h4>
        <p style={sub}>Creates a SUPPORT-type identity. SUPPORT cannot self-provision — this action requires <code>workforce.user.create</code> (OPERATOR/PRIVILEGED).</p>
        <form onSubmit={handleCreate} style={form}>
          <input value={createEmail} onChange={e=>setCreateEmail(e.target.value)} placeholder="email@monienaija.test" style={input}/>
          <select value={createRole} onChange={e=>setCreateRole(e.target.value)} style={input}><option>OPERATIONS</option><option>CUSTOMER_SERVICE</option><option>COMPLIANCE</option><option>TREASURY</option><option>AGENT_NETWORK_MANAGER</option><option>RISK_FRAUD</option></select>
          <button type="submit" style={btn}>Create</button>
        </form>
        {createRes && <div style={successBox}>{createRes}</div>}
        {createErr && <div style={errBox}>{createErr}</div>}
      </div>
      <div style={note}>SUPPORT provisioning is intentionally operator-gated; a SUPPORT bearer token attempting <code>POST /internal/admin/support/workforce-users</code> receives 403 (defense in depth — see route-policy and controller checks).</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const successBox: React.CSSProperties={background:'#ECFDF5',border:'1px solid #6EE7B7',color:'#065F46',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const grid: React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}; const card: React.CSSProperties={padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8};
const big: React.CSSProperties={fontSize:28,fontWeight:800,color:'#032B14'}; const muted: React.CSSProperties={color:'#64748B',fontSize:12}; const pre: React.CSSProperties={fontSize:11,background:'#F8FAFC',padding:8,borderRadius:6,overflow:'auto'};
const formCard: React.CSSProperties={marginTop:16,padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8}; const h4: React.CSSProperties={margin:'0 0 8px'}; const form: React.CSSProperties={display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'};
const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0',minWidth:180}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
