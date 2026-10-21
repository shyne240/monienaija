import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const RiskFraudScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('compliance.manage_case') || hasFn('kyc.view') || principal?.roles.includes('RISK_FRAUD') || principal?.roles.includes('SUPER_ADMIN') || hasFn('privileged:execute');
  const [customerId, setCustomerId] = useState('');
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchFraud = async () => {
    if(!customerId.trim()) { setError('Enter customer UUID'); return; }
    setLoading(true); setError(''); setCases([]);
    try {
      const res: any = await ApiClient.get(`/customers/${customerId.trim()}/compliance-cases?category=FRAUD`);
      const all = res.data || res.items || (Array.isArray(res)?res:[]);
      setCases(all.filter((c:any)=>(c.category||c.type)==='FRAUD'));
      if(all.length===0) setError('No FRAUD cases for this customer, or no access — RISK_FRAUD role owns FRAUD exclusively.');
    } catch(e:any){ setError(e?.message||'Failed to load fraud cases'); }
    finally{ setLoading(false); }
  };

  if(!canView) return <div style={wrap}><div style={denied}>Requires FRAUD case access — <code>RISK_FRAUD</code> or <code>compliance.manage_case + FRAUD</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🚨 Risk & Fraud</h2>
      <p style={sub}>FRAUD-category compliance cases only — isolated to <code>RISK_FRAUD</code> per V1 isolation rule. COMPLIANCE owns non-FRAUD; this screen filters FRAUD exclusively.</p>
      <div style={row}><input value={customerId} onChange={e=>setCustomerId(e.target.value)} placeholder="Customer UUID" style={input}/><button onClick={fetchFraud} style={btn} disabled={loading}>{loading?'Loading…':'Search FRAUD cases'}</button></div>
      {error && <div style={errBox}>{error}</div>}
      {cases.length>0 ? <table style={table}><thead><tr><th>ID</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead><tbody>{cases.map((c:any)=><tr key={c.id}><td style={mono}>{c.id.slice(0,8)}…</td><td><span style={badge(c.status)}>{c.status}</span></td><td>{c.reason||'-'}</td><td>{c.createdAt? new Date(c.createdAt).toLocaleString(): '-'}</td></tr>)}</tbody></table> : !loading && customerId && !error && <div style={empty}>No FRAUD cases — empty is expected unless risk events were created.</div>}
      <div style={note}>This is a filtered view of the same <code>/customers/:id/compliance-cases</code> resource, constrained to <code>category=FRAUD</code> at the service layer. Backend enforces that COMPLIANCE principals cannot read FRAUD cases and RISK_FRAUD cannot read non-FRAUD.</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:16};
const row: React.CSSProperties={display:'flex',gap:8,marginBottom:12}; const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'}; const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:'#FEF2F2',color:'#991B1B'});
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
