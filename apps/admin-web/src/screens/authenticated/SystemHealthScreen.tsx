import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const SystemHealthScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const canViewMetrics = principal?.scopes.includes('metrics.view') ?? false;
  const canViewDiagnostics = principal?.scopes.includes('diagnostics.view') ?? false;
  const canViewOutbox = principal?.scopes.includes('outbox.view') ?? false;
  const canViewAny = canViewMetrics || canViewDiagnostics || canViewOutbox;
  const [metrics, setMetrics] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [outbox, setOutbox] = useState<any>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadErrors({});
    const requests: Promise<void>[] = [];
    if (canViewMetrics) {
      requests.push(ApiClient.get('/internal/metrics').then(setMetrics).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, metrics: err?.message || 'Metrics unavailable' }));
      }));
    }
    if (canViewDiagnostics) {
      requests.push(ApiClient.get('/internal/diagnostics').then(setDiagnostics).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, diagnostics: err?.message || 'Diagnostics unavailable' }));
      }));
    }
    if (canViewOutbox) {
      requests.push(ApiClient.get('/internal/outbox').then(setOutbox).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, outbox: err?.message || 'Outbox unavailable' }));
      }));
    }
    await Promise.all(requests);
    setLoading(false);
  }, [canViewMetrics, canViewDiagnostics, canViewOutbox]);

  useEffect(() => {
    if (canViewAny) fetchAll();
    else setLoading(false);
  }, [canViewAny, fetchAll]);

  if(!canViewAny) return <div style={wrap} role="alert"><div style={denied}>This screen requires at least one of <code>metrics.view</code>, <code>diagnostics.view</code>, or <code>outbox.view</code>.</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🩺 System Health</h2>
      <p style={sub}>Read-only operational data. Each panel is loaded only when the corresponding function is granted.</p>
      <button onClick={fetchAll} style={btn} disabled={loading}>{loading?'Loading…':'Refresh'}</button>
      {loading ? <div style={loadingBox}>Loading health data…</div> : <>
        <div style={grid}>
          {canViewMetrics && <div style={card}><h4 style={h4}>Metrics</h4>{loadErrors.metrics ? <div style={errBox}>{loadErrors.metrics}</div> : <pre style={pre}>{JSON.stringify(metrics, null, 2)}</pre>}</div>}
          {canViewDiagnostics && <div style={card}><h4 style={h4}>Diagnostics</h4>{loadErrors.diagnostics ? <div style={errBox}>{loadErrors.diagnostics}</div> : <pre style={pre}>{JSON.stringify(diagnostics, null, 2)}</pre>}</div>}
        </div>
        {canViewOutbox && <div style={card}><h4 style={h4}>Outbox (recent events)</h4>{loadErrors.outbox ? <div style={errBox}>{loadErrors.outbox}</div> : <pre style={pre}>{JSON.stringify(outbox, null, 2)}</pre>}</div>}
      </>}
      <div style={note}>Outbox pending count and diagnostics are read-only operational signals; this screen does not mutate delivery, reconciliation, or ledger state.</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer',marginBottom:12};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'}; const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const grid: React.CSSProperties={display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}; const card: React.CSSProperties={padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8,marginBottom:12};
const h4: React.CSSProperties={margin:'0 0 8px'}; const pre: React.CSSProperties={fontSize:11,background:'#F8FAFC',padding:8,borderRadius:6,overflow:'auto',maxHeight:400}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
