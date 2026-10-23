import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const LimitAssignmentScreen: React.FC<{ initialCustomerId?: string; onBackToCustomer?: () => void }> = ({ initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canAssignAgent = hasFn('agent.assign_limit');
  const canView = canAssignAgent || hasFn('limit.view');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentId, setAgentId] = useState('');
  const [profileCode, setProfileCode] = useState('');
  const [result, setResult] = useState(''); const [resultErr, setResultErr] = useState('');

  const fetchAssignments = async () => {
    setLoading(true); setError('');
    try {
      const endpoint = initialCustomerId
        ? `/internal/limit-assignments/customer/${encodeURIComponent(initialCustomerId)}`
        : '/internal/limit-assignments';
      const res: any = await ApiClient.get(endpoint);
      setAssignments(res.data || res.items || (Array.isArray(res) ? res : []));
    } catch (e: any) { setError(e?.message || 'Failed to load limit assignments'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (canView) fetchAssignments(); else setLoading(false); }, [canView, initialCustomerId]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAssignAgent) return;
    setResult(''); setResultErr('');
    if (!agentId.trim() || !profileCode.trim()) { setResultErr('Agent ID and profile code required'); return; }
    try {
      await ApiClient.post('/internal/limit-assignments', {
        limitProfileCode: profileCode.trim().toUpperCase(),
        subjectType: 'AGENT',
        subjectId: agentId.trim(),
      });
      setResult(`Assigned profile ${profileCode.trim().toUpperCase()} to agent ${agentId.trim()}`);
      fetchAssignments();
    } catch (e: any) { setResultErr(e?.message || 'Assign failed — requires agent.assign_limit (AGENT_NETWORK_MANAGER)'); }
  };

  if (!canView) return <div style={wrap} role="alert"><div style={denied}>Viewing limit assignments requires <code>limit.view</code> or <code>agent.assign_limit</code>.</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>📏 Limit Assignments</h2>
      <p style={sub}>View existing assignments. Creating an agent assignment is available only with <code>agent.assign_limit</code>; catalogue definitions are managed separately.</p>
      {initialCustomerId && <div style={note}>Showing assignments for customer <code>{initialCustomerId}</code>.{onBackToCustomer && <> <button type="button" onClick={onBackToCustomer} style={smallLink}>Back to Customer 360°</button></>}</div>}
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading assignments…</div> :
        assignments.length === 0 ? <div style={empty}>No matching limit assignments.</div> :
          <table style={table}><thead><tr><th>Subject</th><th>Profile</th><th>Active</th><th>Effective</th></tr></thead><tbody>{assignments.map((a:any)=><tr key={a.id}><td style={mono}>{a.subjectType}: {a.subjectId?.slice(0,8) || a.segmentCode || '-'}</td><td>{a.limitProfileCode || '-'}</td><td><span style={badge(a.isActive ? 'ACTIVE' : 'INACTIVE')}>{a.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td><td>{a.effectiveFrom ? new Date(a.effectiveFrom).toLocaleString() : '-'}</td></tr>)}</tbody></table>
      }
      {!initialCustomerId && canAssignAgent && <div style={formCard}>
        <h4 style={h4}>Assign Limit Profile to Agent</h4>
        <form onSubmit={handleAssign} style={form}>
          <input value={agentId} onChange={e=>setAgentId(e.target.value)} placeholder="Agent UUID" style={input} />
          <input value={profileCode} onChange={e=>setProfileCode(e.target.value)} placeholder="Profile code (e.g. AGENT_STANDARD)" style={input} />
          <button type="submit" style={btn}>Assign</button>
        </form>
        {result && <div style={successBox}>{result}</div>}
        {resultErr && <div style={errBox}>{resultErr}</div>}
      </div>}
      <div style={note}>Usage and reservation diagnostics are available through <code>GET /internal/limit-usages</code> and <code>GET /internal/limit-reservations</code>; this screen does not query them. See Commercial → Limit Catalogue for profile definitions.</div>
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
const smallLink: React.CSSProperties={marginLeft:8,padding:'4px 7px',borderRadius:5,border:'1px solid #CBD5E1',background:'#FFFFFF',color:'#334155',cursor:'pointer',fontSize:11};
const note: React.CSSProperties={marginTop:12,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
