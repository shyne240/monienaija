import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const SystemHealthScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('metrics.view') || hasFn('diagnostics.view') || hasFn('outbox.view') || principal?.roles.includes('OPERATIONS') || principal?.roles.includes('SUPER_ADMIN') || hasFn('privileged:execute') || principal?.roles.includes('ADMINISTRATOR');
  const [metrics, setMetrics] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [outbox, setOutbox] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = async () => {
    setLoading(true); setError('');
    try {
      const [m,d,o]: any = await Promise.all([
        ApiClient.get('/internal/metrics').catch((e:any)=>({ error: e.message })),
        ApiClient.get('/internal/diagnostics').catch((e:any)=>({ error: e.message })),
        ApiClient.get('/internal/outbox').catch((e:any)=>({ error: e.message })),
      ]);
      setMetrics(m); setDiagnostics(d); setOutbox(o);
    } catch(e:any){ setError(e?.message||'Failed to load system health'); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{ if(canView) fetchAll(); else setLoading(false); }, []);

  if(!canView) return <div style={wrap}><div style={denied}>Requires <code>metrics.view / diagnostics.view</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🩺 System Health & Ops</h2>
      <p style={sub}>Metrics, diagnostics, outbox — live internal surfaces. All require workforce session via <code>/internal/*</code> (generic internal admin surface).</p>
      <button onClick={fetchAll} style={btn} disabled={loading}>{loading?'Loading…':'Refresh'}</button>
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading health data…</div> : <>
        <div style={grid}>
          <div style={card}><h4 style={h4}>Metrics</h4><pre style={pre}>{JSON.stringify(metrics, null, 2)}</pre></div>
          <div style={card}><h4 style={h4}>Diagnostics</h4><pre style={pre}>{JSON.stringify(diagnostics, null, 2)}</pre></div>
        </div>
        <div style={card}><h4 style={h4}>Outbox (recent events)</h4><pre style={pre}>{JSON.stringify(outbox, null, 2)}</pre></div>
      </>}
      <div style={note}>If metrics show <code>reconciliation.duration_ms</code> that feed is from the reconciliation run; outbox pending count should be 0 on healthy system (deliveries + inbox cover notifications).</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer',marginBottom:12};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'}; const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const grid: React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}; const card: React.CSSProperties={padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8,marginBottom:12};
const h4: React.CSSProperties={margin:'0 0 8px'}; const pre: React.CSSProperties={fontSize:11,background:'#F8FAFC',padding:8,borderRadius:6,overflow:'auto',maxHeight:400}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
