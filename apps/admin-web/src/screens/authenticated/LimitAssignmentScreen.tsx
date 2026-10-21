import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const LimitAssignmentScreen: React.FC<{ initialCustomerId?: string }> = ({ initialCustomerId }) => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('agent.assign_limit') || hasFn('limit.view') || hasFn('limit.modify') || principal?.roles.includes('AGENT_NETWORK_MANAGER') || principal?.roles.includes('SUPER_ADMIN');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentId, setAgentId] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [result, setResult] = useState(''); const [resultErr, setResultErr] = useState('');

  const fetchAssignments = async () => {
    setLoading(true); setError('');
    try {
      const res: any = await ApiClient.get('/internal/limit-assignments');
      setAssignments(res.data || res.items || (Array.isArray(res) ? res : []));
    } catch (e: any) { setError(e?.message || 'Failed to load limit assignments'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (canView) fetchAssignments(); else setLoading(false); }, []);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault(); setResult(''); setResultErr('');
    if (!agentId.trim() || !profileCode.trim()) { setResultErr('Agent ID and profile code required'); return; }
    try {
      await ApiClient.post(`/internal/agents/${agentId.trim()}/limit-assignment`, { profileCode: profileCode.trim() });
      setResult(`Assigned profile ${profileCode} to agent ${agentId}`);
      fetchAssignments();
    } catch (e: any) { setResultErr(e?.message || 'Assign failed — requires agent.assign_limit (AGENT_NETWORK_MANAGER)'); }
  };

  if (!canView) return <div style={wrap}><div style={denied}>Requires <code>agent.assign_limit / limit.view</code> (AGENT_NETWORK_MANAGER / SUPER_ADMIN). Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>📏 Limit Assignments & Usage</h2>
      <p style={sub}>Assign an existing limit profile to an agent/customer and monitor usage. Catalogue definitions (<code>limit.modify</code>) vs ordinary assignments (<code>agent.assign_limit</code>) are distinct per Decision 2.</p>
      {initialCustomerId && <div style={note}>Pre-filled from Customer 360° customer {initialCustomerId.slice(0,8)}… — use Agent ID field below for agent assignment.</div>}
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading assignments…</div> :
        assignments.length === 0 ? <div style={empty}>No limit assignments — assign a profile below. Catalogue definitions live in Commercial → Limit Catalogue.</div> :
          <table style={table}><thead><tr><th>Subject</th><th>Profile</th><th>Status</th><th>Effective</th></tr></thead><tbody>{assignments.map((a:any)=><tr key={a.id}><td style={mono}>{a.subjectId?.slice(0,8) || a.agentId?.slice(0,8) || '-'}</td><td>{a.profileCode || a.profile || '-'}</td><td><span style={badge(a.status)}>{a.status || 'ACTIVE'}</span></td><td>{a.effectiveFrom ? new Date(a.effectiveFrom).toLocaleString() : '-'}</td></tr>)}</tbody></table>
      }
      <div style={formCard}>
        <h4 style={h4}>Assign Limit Profile to Agent</h4>
        <form onSubmit={handleAssign} style={form}>
          <input value={agentId} onChange={e=>setAgentId(e.target.value)} placeholder="Agent UUID" style={input} />
          <input value={profileCode} onChange={e=>setProfileCode(e.target.value)} placeholder="Profile code (e.g. AGENT_STANDARD)" style={input} />
          <button type="submit" style={btn}>Assign</button>
        </form>
        {result && <div style={successBox}>{result}</div>}
        {resultErr && <div style={errBox}>{resultErr}</div>}
      </div>
      <div style={note}>Usage and reservations (<code>/limit-operations/:id</code>) are read-only diagnostics — see Commercial → Limit Catalogue for profile definitions.</div>
    </div>
  );
};

const wrap: React.CSSProperties={padding:'24px',maxWidth:1100};
const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'};
const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const successBox: React.CSSProperties={background:'#ECFDF5',border:'1px solid #6EE7B7',color:'#065F46',padding:10,borderRadius:6,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'};
const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'};
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12};
const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:'#ECFDF5',color:'#334155'});
const formCard: React.CSSProperties={marginTop:16,padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8};
const h4: React.CSSProperties={margin:'0 0 8px'};
const form: React.CSSProperties={display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'};
const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0',minWidth:160};
const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const note: React.CSSProperties={marginTop:12,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
