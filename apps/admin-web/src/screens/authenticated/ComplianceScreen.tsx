import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const ComplianceScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('kyc.view') || hasFn('compliance.manage_case') || hasFn('compliance.manage_risk_profile') || principal?.roles.includes('COMPLIANCE') || principal?.roles.includes('SUPER_ADMIN') || hasFn('privileged:execute');
  const [customerId, setCustomerId] = useState('');
  const [kyc, setKyc] = useState<any>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('APPROVED');
  const [kycReason, setKycReason] = useState('');
  const [assessMsg, setAssessMsg] = useState(''); const [assessErr, setAssessErr] = useState('');

  const fetchForCustomer = async () => {
    if(!customerId.trim()) { setError('Enter a customer UUID'); return; }
    setLoading(true); setError(''); setKyc(null); setCases([]); setAssessMsg(''); setAssessErr('');
    try {
      const [k, c]: any = await Promise.all([
        ApiClient.get(`/customers/${customerId.trim()}/kyc`).catch((e:any)=>{ throw new Error(e.message||'KYC fetch failed'); }),
        ApiClient.get(`/customers/${customerId.trim()}/compliance-cases`).catch(()=>({ data: [] })),
      ]);
      setKyc(k);
      setCases((c as any).data || (c as any).items || (Array.isArray(c)?c:[]));
    } catch(e:any){ setError(e?.message||'Failed to load compliance data'); }
    finally{ setLoading(false); }
  };

  const submitAssessment = async (e: React.FormEvent) => {
    e.preventDefault(); setAssessErr(''); setAssessMsg('');
    try {
      await ApiClient.post(`/customers/${customerId.trim()}/kyc-assessment`, { level: kycLevel, status: kycStatus, reason: kycReason || undefined });
      setAssessMsg('Assessment submitted'); fetchForCustomer();
    } catch(e:any){ setAssessErr(e?.message||'Assessment failed'); }
  };

  if(!canView) return <div style={wrap}><div style={denied}>Requires <code>kyc.view / compliance.manage_case</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🛡️ Compliance & KYC</h2>
      <p style={sub}>KYC queue, compliance cases, risk profiles — per customer investigation. Search by customer UUID (from Customer directory).</p>
      <div style={searchRow}>
        <input value={customerId} onChange={e=>setCustomerId(e.target.value)} placeholder="Customer UUID" style={input} />
        <button onClick={fetchForCustomer} style={btn} disabled={loading}>{loading?'Loading…':'Search'}</button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {kyc && <div style={card}><strong>KYC:</strong> Level {kyc.level ?? kyc.kycLevel} — Status {kyc.status ?? kyc.kycStatus} {kyc.assessedBy && <>by {kyc.assessedBy}</>} {kyc.reason && <> — {kyc.reason}</>}</div>}
      {cases.length>0 ? <table style={table}><thead><tr><th>ID</th><th>Category</th><th>Status</th><th>Reason</th></tr></thead><tbody>{cases.map((c:any)=><tr key={c.id}><td style={mono}>{c.id.slice(0,8)}…</td><td>{c.category||c.type}</td><td><span style={badge(c.status)}>{c.status}</span></td><td>{c.reason||c.description||'-'}</td></tr>)}</tbody></table> : !loading && customerId && <div style={empty}>No compliance cases for this customer, or customer not found.</div>}

      <div style={formCard}>
        <h4 style={h4}>Submit KYC assessment</h4>
        <form onSubmit={submitAssessment} style={form}>
          <label>Level <select value={kycLevel} onChange={e=>setKycLevel(e.target.value)}><option>LEVEL_1</option><option>LEVEL_2</option><option>LEVEL_3</option></select></label>
          <label>Status <select value={kycStatus} onChange={e=>setKycStatus(e.target.value)}><option>APPROVED</option><option>REJECTED</option><option>PENDING_REVIEW</option></select></label>
          <input value={kycReason} onChange={e=>setKycReason(e.target.value)} placeholder="Reason (optional)" style={input}/>
          <button type="submit" style={btn}>Submit</button>
        </form>
        {assessMsg && <div style={successBox}>{assessMsg}</div>}
        {assessErr && <div style={errBox}>{assessErr}</div>}
      </div>

      <div style={note}>Non-FRAUD cases are owned by <code>COMPLIANCE</code>; FRAUD-category cases are isolated to <code>RISK_FRAUD</code> — see Risk & Fraud screen for FRAUD-filtered view. This screen respects that split via function checks in the backend (kyc/compliance resource returns 403 for unauthorized fraud access).</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:16};
const searchRow: React.CSSProperties={display:'flex',gap:8,marginBottom:12}; const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const successBox: React.CSSProperties={background:'#ECFDF5',border:'1px solid #6EE7B7',color:'#065F46',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const card: React.CSSProperties={padding:12,background:'#F8FAFC',borderRadius:8,border:'1px solid #E2E8F0',marginBottom:12,fontSize:13}; const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden',marginBottom:12};
const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:s==='OPEN'?'#FFF7ED':'#ECFDF5',color:'#334155'}); const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12};
const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0',marginBottom:12}; const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const formCard: React.CSSProperties={marginTop:16,padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8}; const h4: React.CSSProperties={margin:'0 0 12px'}; const form: React.CSSProperties={display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
