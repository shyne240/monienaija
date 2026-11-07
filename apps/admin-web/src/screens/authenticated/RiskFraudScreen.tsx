import './operational-surfaces.css';
import React, { useState, useEffect, useRef } from 'react';
import './compliance-workspace.css';
import { PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface RiskFraudScreenProps {
  initialCustomerId?: string;
  onBackToCustomer?: () => void;
}

export const RiskFraudScreen: React.FC<RiskFraudScreenProps> = ({ initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('risk_fraud.manage_fraud_case') ?? false;
  const key = `${principal?.principalId ?? ''}:${canView}:${initialCustomerId ?? ''}`;
  return <FraudWorkspace key={key} canView={canView} initialCustomerId={initialCustomerId} onBackToCustomer={onBackToCustomer} />;
};
const FraudWorkspace: React.FC<RiskFraudScreenProps & {canView: boolean}> = ({canView, initialCustomerId, onBackToCustomer}) => {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const fetchFraud = async (requestedId = customerId) => {
    if (!canView) return;
    if(!requestedId.trim()) { setError('Enter customer UUID'); return; }
    const id = requestedId.trim(); const request = ++generation.current;
    setLoading(true); setError(''); setCases([]); setSearched(false);
    try {
      // The controller does not implement a category query; the screen filters the returned list.
      const res: any = await ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`);
      const all = Array.isArray(res) ? res : res?.data ?? res?.items;
      if (!Array.isArray(all) || all.some((row: any) => !row || typeof row.id !== 'string')) throw new Error('Fraud case lookup returned an invalid response.');
      if (request !== generation.current) return;
      setCases(all.filter((c:any)=>(c.category||c.type)==='FRAUD'));
      setSearched(true);
    } catch(e:any){ if (request === generation.current) setError(e?.message||'Failed to load fraud cases'); }
    finally{ if (request === generation.current) setLoading(false); }
  };

  useEffect(() => { if(initialCustomerId && canView) void fetchFraud(initialCustomerId); }, [initialCustomerId, canView]);

  if(!canView) return <div className="mn-operational" style={wrap} role="alert"><div style={denied}>Fraud case lookup requires <code>risk_fraud.manage_fraud_case</code>.</div></div>;

  return (
    <div className="mn-operational mn-compliance" style={wrap}>
      <PageHeader eyebrow="Compliance and risk" title="Fraud case lookup" description={`This screen displays FRAUD-category compliance cases for a customer. ${initialCustomerId ? 'Customer ID pre-filled from Customer 360°.' : 'Search by customer UUID.'}`} />
      {initialCustomerId && onBackToCustomer && <button type="button" onClick={onBackToCustomer} style={btn}>← Back to Customer 360°</button>}
      <div style={row}><input aria-label="Customer UUID" value={customerId} onChange={e=>{generation.current += 1;setCustomerId(e.target.value);setCases([]);setSearched(false);setError('');setLoading(false);}} placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0,8)}…` : "Customer UUID"} style={input}/><button onClick={()=>void fetchFraud()} style={btn} disabled={loading}>{loading?'Loading…':'Search FRAUD cases'}</button></div>
      {initialCustomerId && <div style={note}>🔗 Customer pre-filled — no manual UUID paste.</div>}
      {error && <div style={errBox} role="alert">{error}</div>}
      {cases.length>0 ? <ScrollRegion label="Fraud cases" hint="Scroll horizontally to see all columns."><table style={table}><thead><tr><th>ID</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead><tbody>{cases.map((c:any)=><tr key={c.id}><td style={mono}>{c.id.slice(0,8)}…</td><td><span style={badge(c.status)}>{c.status}</span></td><td>{c.reason||'-'}</td><td>{c.createdAt? new Date(c.createdAt).toLocaleString(): '-'}</td></tr>)}</tbody></table></ScrollRegion> : !loading && searched && !error && <div style={empty}>No FRAUD cases — empty is expected unless risk events were created.</div>}
      <div style={note}>The current compliance-case list endpoint returns all categories and has no catalogue function check. FRAUD filtering happens in this UI only; backend category isolation is a documented authorization gap and is not replaced by this screen guard.</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'clamp(16px, 3vw, 32px)',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'var(--mn-nav-surface-deep, #082f23)'}; const sub: React.CSSProperties={color:'var(--mn-text-secondary, #52655f)',fontSize:13,marginBottom:16};
const row: React.CSSProperties={display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}; const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid var(--mn-border-subtle, #dde7e2)'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid var(--mn-border-subtle, #dde7e2)',background:'#fff',cursor:'pointer'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'}; const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:'#FEF2F2',color:'#991B1B'});
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'var(--mn-text-secondary, #52655f)',background:'#fff',borderRadius:8,border:'1px dashed var(--mn-border-subtle, #dde7e2)'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'var(--mn-text-secondary, #52655f)',background:'var(--mn-surface-canvas, #f5f8f6)',padding:10,borderRadius:6,border:'1px solid var(--mn-border-subtle, #dde7e2)'};
