import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

export const AuditTrailScreen: React.FC<{ initialCustomerId?: string }> = ({ initialCustomerId }) => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('audit.view') || hasFn('audit.search') || principal?.roles.includes('FINANCE_AUDITOR') || principal?.roles.includes('SUPER_ADMIN');
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchEvents = async () => {
    setLoading(true); setError(''); setEvents([]);
    try {
      const endpoint = customerId.trim() ? `/customers/${customerId.trim()}/audit-events` : '/internal/audit/search';
      const res: any = await ApiClient.get(endpoint);
      setEvents(res.data || res.items || (Array.isArray(res) ? res : []));
    } catch (e: any) { setError(e?.message || 'Failed to load audit trail'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (initialCustomerId && canView) fetchEvents();
  }, [initialCustomerId]);

  if (!canView) return <div style={wrap}><div style={denied}>Requires <code>audit.view / audit.search</code> (FINANCE_AUDITOR / SUPER_ADMIN). Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>📜 Audit & Security Events</h2>
      <p style={sub}>Search audit trail — per-customer or global. Workforce session via <code>/internal/a2/workforce/security-events</code>. Read-only, no mutation.</p>
      <div style={row}>
        <input value={customerId} onChange={e => setCustomerId(e.target.value)} placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0,8)}…` : "Customer UUID (optional — leave empty for global search)"} style={input} />
        <button onClick={fetchEvents} style={btn} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </div>
      {initialCustomerId && <div style={note}>Pre-filled from Customer 360° — no manual UUID paste required.</div>}
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Searching audit events…</div> :
        events.length > 0 ? <table style={table}><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead><tbody>{events.map((ev:any,i)=><tr key={ev.id||i}><td style={mono}>{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '-'}</td><td>{ev.actor || ev.actorId || '-'}</td><td>{ev.action || ev.event || '-'}</td><td style={mono}>{ev.targetId || ev.resourceId || '-'}</td></tr>)}</tbody></table> :
        <div style={empty}>No audit events — try a different customer or global search.</div>
      }
    </div>
  );
};

const wrap: React.CSSProperties={padding:'24px',maxWidth:1100};
const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'};
const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const row: React.CSSProperties={display:'flex',gap:8,marginBottom:12};
const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0'};
const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'};
const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'};
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12};
const note: React.CSSProperties={fontSize:12,color:'#64748B',background:'#F8FAFC',padding:8,borderRadius:6,border:'1px solid #E2E8F0',marginBottom:8};
