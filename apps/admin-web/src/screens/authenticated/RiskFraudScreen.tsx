import React, { useState, useEffect } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface RiskFraudScreenProps {
  initialCustomerId?: string;
  onBackToCustomer?: () => void;
}

export const RiskFraudScreen: React.FC<RiskFraudScreenProps> = ({ initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('risk_fraud.manage_fraud_case') ?? false;
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchFraud = async () => {
    if (!canView) return;
    if(!customerId.trim()) { setError('Enter customer UUID'); return; }
    setLoading(true); setError(''); setCases([]);
    try {
      // The controller does not implement a category query; the screen filters the returned list.
      const res: any = await ApiClient.get(`/customers/${encodeURIComponent(customerId.trim())}/compliance-cases`);
      const all = res.data || res.items || (Array.isArray(res)?res:[]);
      setCases(all.filter((c:any)=>(c.category||c.type)==='FRAUD'));
      if(all.length===0) setError('No FRAUD cases for this customer, or no access — RISK_FRAUD role owns FRAUD exclusively.');
    } catch(e:any){ setError(e?.message||'Failed to load fraud cases'); }
    finally{ setLoading(false); }
  };

  useEffect(() => { if(initialCustomerId && canView) fetchFraud(); }, [initialCustomerId, canView]);

  if(!canView) return <div style={wrap} role="alert"><div style={denied}>Fraud case lookup requires <code>risk_fraud.manage_fraud_case</code>.</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🚨 Fraud Case Lookup</h2>
      <p style={sub}>This screen displays FRAUD-category compliance cases for a customer. {initialCustomerId ? 'Customer ID pre-filled from Customer 360°.' : 'Search by customer UUID.'}</p>
      {initialCustomerId && onBackToCustomer && <button type="button" onClick={onBackToCustomer} style={btn}>← Back to Customer 360°</button>}
      <div style={row}><input value={customerId} onChange={e=>setCustomerId(e.target.value)} placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0,8)}…` : "Customer UUID"} style={input}/><button onClick={fetchFraud} style={btn} disabled={loading}>{loading?'Loading…':'Search FRAUD cases'}</button></div>
      {initialCustomerId && <div style={note}>🔗 Customer pre-filled — no manual UUID paste.</div>}
      {error && <div style={errBox}>{error}</div>}
      {cases.length>0 ? <table style={table}><thead><tr><th>ID</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead><tbody>{cases.map((c:any)=><tr key={c.id}><td style={mono}>{c.id.slice(0,8)}…</td><td><span style={badge(c.status)}>{c.status}</span></td><td>{c.reason||'-'}</td><td>{c.createdAt? new Date(c.createdAt).toLocaleString(): '-'}</td></tr>)}</tbody></table> : !loading && customerId && !error && <div style={empty}>No FRAUD cases — empty is expected unless risk events were created.</div>}
      <div style={note}>The current compliance-case list endpoint returns all categories and has no catalogue function check. FRAUD filtering happens in this UI only; backend category isolation is a documented authorization gap and is not replaced by this screen guard.</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:16};
const row: React.CSSProperties={display:'flex',gap:8,marginBottom:12}; const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'}; const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:'#FEF2F2',color:'#991B1B'});
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
