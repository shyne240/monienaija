import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { DataRecord, StructuredKeyValueList } from '../../components/StructuredData';

export const SuperAdminRecoveryScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('workforce.super_admin.recover');
  const [statement, setStatement] = useState('');
  const [result, setResult] = useState<DataRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canView) return;
    setError(''); setResult(null); setLoading(true);
    try {
      const res = await ApiClient.post<DataRecord>('/internal/a2/workforce/super-admin/recovery', { statement });
      setResult(res);
    } catch (err: any) {
      setError(err?.message || 'Recovery failed — requires RS256-signed A2RecoveryStatementV1 and ADMINISTRATOR role');
    } finally { setLoading(false); }
  };

  if (!canView) return <div style={wrap}><div style={denied}>Requires <code>workforce.super_admin.recover</code> (ADMINISTRATOR only, RS256). Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🔐 Super-Admin Recovery</h2>
      <p style={sub}>Consume an externally-signed <code>A2RecoveryStatementV1</code> to revoke a compromised SUPER_ADMIN — ADMINISTRATOR only, RS256 via <code>A2_RECOVERY_JWKS_JSON</code>. This is the sole privileged recovery surface.</p>
      <form onSubmit={handleRecover} style={form}>
        <label style={label}>Recovery Statement (JWT)</label>
        <textarea value={statement} onChange={e => setStatement(e.target.value)} placeholder="Paste RS256-signed recovery statement…" style={textarea} rows={6} />
        <button type="submit" disabled={loading || !statement.trim()} style={btn}>{loading ? 'Executing…' : 'Execute Recovery'}</button>
      </form>
      {error && <div style={errBox}>{error}</div>}
      {result && <section style={successBox} role="status"><h3 style={resultTitle}>Recovery executed</h3><StructuredKeyValueList data={result} /></section>}
      <div style={note}>This endpoint is intentionally restricted to ADMINISTRATOR and requires a valid RS256 signature — SUPER_ADMIN itself cannot self-recover (separation of duties).</div>
    </div>
  );
};

const wrap: React.CSSProperties={padding:'24px',maxWidth:900};
const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'};
const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:16};
const form: React.CSSProperties={display:'flex',flexDirection:'column',gap:12,marginBottom:16};
const label: React.CSSProperties={fontSize:12,fontWeight:600,color:'#475569'};
const textarea: React.CSSProperties={padding:'10px',border:'1px solid #E2E8F0',borderRadius:6,fontSize:12,fontFamily:'monospace'};
const btn: React.CSSProperties={padding:'10px 16px',background:'#032B14',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:600,alignSelf:'flex-start'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,fontSize:13};
const successBox: React.CSSProperties={background:'#ECFDF5',border:'1px solid #6EE7B7',color:'#065F46',padding:10,borderRadius:6,fontSize:13};
const resultTitle: React.CSSProperties={margin:'0 0 8px',fontSize:14};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
