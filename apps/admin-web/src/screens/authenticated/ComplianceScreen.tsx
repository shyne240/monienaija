import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface ComplianceScreenProps {
  initialCustomerId?: string;
  initialCategory?: string;
  mode?: 'kyc' | 'cases';
  onBackToCustomer?: () => void;
}

export const ComplianceScreen: React.FC<ComplianceScreenProps> = ({
  initialCustomerId,
  initialCategory,
  mode = 'kyc',
  onBackToCustomer,
}) => {
  const { principal } = useAuthStore();
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canViewKyc = hasFn('kyc.view');
  const availableKycStatuses = [
    ...(hasFn('kyc.review') ? ['NOT_STARTED', 'PENDING'] : []),
    ...(hasFn('kyc.approve') ? ['APPROVED'] : []),
    ...(hasFn('kyc.reject') ? ['REJECTED'] : []),
  ];
  const canSubmitKyc = availableKycStatuses.length > 0;
  const canManageCases = hasFn('compliance.manage_case');
  const canAccess = mode === 'cases' ? canManageCases : canViewKyc || canSubmitKyc;
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [kyc, setKyc] = useState<any>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [caseCategory, setCaseCategory] = useState(initialCategory || 'ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('APPROVED');
  const [kycReason, setKycReason] = useState('');
  const [assessMsg, setAssessMsg] = useState('');
  const [assessErr, setAssessErr] = useState('');

  useEffect(() => {
    if (availableKycStatuses.length > 0 && !availableKycStatuses.includes(kycStatus)) {
      setKycStatus(availableKycStatuses[0]);
    }
  }, [availableKycStatuses.join('|'), kycStatus]);

  const fetchForCustomer = async (requestedCustomerId = customerId) => {
    const id = requestedCustomerId.trim();
    if (!id) { setError('Enter a customer UUID'); return; }
    if (!canAccess) return;
    setLoading(true);
    setError('');
    setKyc(null);
    setCases([]);
    setAssessMsg('');
    setAssessErr('');
    const errors: string[] = [];

    const requests: Promise<void>[] = [];
    if (mode === 'kyc' && canViewKyc) {
      requests.push(
        ApiClient.get(`/customers/${encodeURIComponent(id)}/kyc`)
          .then((record: any) => setKyc(record))
          .catch((err: any) => { errors.push(err?.message || 'KYC assessment lookup failed'); }),
      );
    }
    if (mode === 'cases' && canManageCases) {
      requests.push(
        ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`)
          .then((response: any) => setCases(Array.isArray(response) ? response : response?.data || response?.items || []))
          .catch((err: any) => { errors.push(err?.message || 'Compliance case lookup failed'); }),
      );
    }

    await Promise.all(requests);
    if (errors.length > 0) setError(errors.join('; '));
    setLoading(false);
  };

  useEffect(() => {
    if (!initialCustomerId || !canAccess) return;
    setCustomerId(initialCustomerId);
    fetchForCustomer(initialCustomerId);
  }, [initialCustomerId, canAccess, mode]);

  const submitAssessment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmitKyc || !availableKycStatuses.includes(kycStatus) || !customerId.trim() || !principal?.principalId) return;
    setAssessErr('');
    setAssessMsg('');
    try {
      await ApiClient.post(`/customers/${encodeURIComponent(customerId.trim())}/kyc-assessment`, {
        level: kycLevel,
        status: kycStatus,
        reason: kycReason.trim() || undefined,
        assessedBy: principal.principalId,
      });
      setAssessMsg('KYC assessment submitted.');
      await fetchForCustomer(customerId);
    } catch (err: any) {
      setAssessErr(err?.message || 'KYC assessment submission failed');
    }
  };

  if (!canAccess) {
    return (
      <div style={wrap} role="alert">
        <div style={denied}>
          {mode === 'cases'
            ? 'Compliance case lookup requires compliance.manage_case.'
            : 'KYC assessment lookup or action requires kyc.view, kyc.review, kyc.approve, or kyc.reject.'}
        </div>
      </div>
    );
  }

  const visibleCases = cases.filter((item) =>
    (item.category || item.type) !== 'FRAUD' &&
    (caseCategory === 'ALL' || (item.category || item.type) === caseCategory),
  );

  return (
    <div style={wrap}>
      <h2 style={h2}>{mode === 'cases' ? '🛡️ Compliance Case Lookup' : '🪪 KYC Assessment Lookup & Review'}</h2>
      <p style={sub}>
        {mode === 'cases'
          ? 'Look up compliance cases for a customer. The screen excludes FRAUD-category rows from its display.'
          : 'Look up an existing customer KYC assessment and perform only the review decision allowed by your function grants.'}
      </p>
      {initialCustomerId && onBackToCustomer && <button type="button" style={backButton} onClick={onBackToCustomer}>← Back to Customer 360°</button>}
      <div style={searchRow}>
        <input
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0, 8)}…` : 'Customer UUID'}
          style={input}
        />
        <button onClick={() => fetchForCustomer()} style={btn} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
      </div>
      {initialCustomerId && <div style={note}>Customer context carried from Customer 360°; the customer ID is passed to the scoped lookup endpoint.</div>}
      {error && <div style={errBox}>{error}</div>}

      {mode === 'kyc' && canViewKyc && (
        kyc ? (
          <div style={card}>
            <strong>KYC:</strong> Level {kyc.level ?? kyc.kycLevel} — Status {kyc.status ?? kyc.kycStatus}
            {kyc.assessedBy && <> by {kyc.assessedBy}</>}
            {kyc.reason && <> — {kyc.reason}</>}
          </div>
        ) : !loading && customerId && <div style={empty}>No KYC assessment found for this customer.</div>
      )}

      {mode === 'cases' && (
        <>
          <div style={caseFilters}>
            <label>Category
              <select value={caseCategory} onChange={(event) => setCaseCategory(event.target.value)} style={caseSelect}>
                <option value="ALL">All non-FRAUD compliance cases</option>
                <option value="AML">AML</option>
                <option value="KYC">KYC</option>
                <option value="SANCTIONS">SANCTIONS</option>
                <option value="PEP">PEP</option>
                <option value="DOCUMENT">DOCUMENT</option>
                <option value="ACCOUNT_REVIEW">ACCOUNT_REVIEW</option>
                <option value="MANUAL_REVIEW">MANUAL_REVIEW</option>
                <option value="OTHER">OTHER</option>
              </select>
            </label>
          </div>
          {visibleCases.length > 0 ? (
            <table style={table}>
              <thead><tr><th>ID</th><th>Category</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>{visibleCases.map((item: any) => <tr key={item.id}><td style={mono}>{item.id.slice(0, 8)}…</td><td>{item.category || item.type}</td><td><span style={badge(item.status)}>{item.status}</span></td><td>{item.reason || item.description || '—'}</td></tr>)}</tbody>
            </table>
          ) : !loading && customerId && <div style={empty}>No compliance cases match this customer and category filter.</div>}
          <div style={note}>The current customer compliance controller does not accept a category filter or enforce catalogue function checks. This UI filters displayed rows only; backend access remains a documented authorization gap.</div>
        </>
      )}

      {mode === 'kyc' && canSubmitKyc && (
        <div style={formCard}>
          <h4 style={h4}>Submit KYC assessment decision</h4>
          <form onSubmit={submitAssessment} style={form}>
            <label>Level <select value={kycLevel} onChange={(event) => setKycLevel(event.target.value)}><option>LEVEL_1</option><option>LEVEL_2</option><option>LEVEL_3</option></select></label>
            <label>Status <select value={kycStatus} onChange={(event) => setKycStatus(event.target.value)}>{availableKycStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <input value={kycReason} onChange={(event) => setKycReason(event.target.value)} placeholder="Reason (optional)" style={input}/>
            <button type="submit" style={btn}>Submit Assessment</button>
          </form>
          {assessMsg && <div style={successBox} role="status">{assessMsg}</div>}
          {assessErr && <div style={errBox} role="alert">{assessErr}</div>}
        </div>
      )}
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
const backButton: React.CSSProperties={marginBottom:12,padding:'7px 10px',border:'1px solid #CBD5E1',borderRadius:6,background:'#fff',cursor:'pointer',color:'#334155'};
const caseFilters: React.CSSProperties={display:'flex',justifyContent:'flex-end',marginBottom:12,fontSize:12,color:'#475569'};
const caseSelect: React.CSSProperties={marginLeft:8,padding:'7px 10px',border:'1px solid #CBD5E1',borderRadius:6,background:'#fff'};
const formCard: React.CSSProperties={marginTop:16,padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8}; const h4: React.CSSProperties={margin:'0 0 12px'}; const form: React.CSSProperties={display:'flex',gap:8,flexWrap:'wrap' as const,alignItems:'center'}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
