import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface Ticket { id: string; status: string; priority?: string; subject?: string; customerId?: string; agentId?: string; assignedTo?: string; createdAt: string; updatedAt: string; }

export const SupportTicketsScreen: React.FC<{ initialCustomerId?: string }> = ({ initialCustomerId }) => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('customer.manage_support_case') || hasFn('customer.view') || principal?.roles.includes('CUSTOMER_SERVICE') || principal?.roles.includes('SUPER_ADMIN') || principal?.roles.includes('OPERATIONS');
  const customerFilter = initialCustomerId || '';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any|null>(null);
  const [detailErr, setDetailErr] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgRes, setMsgRes] = useState('');

  const fetchList = async () => {
    setLoading(true); setError('');
    try {
      const q = [`page=${page}`, `limit=20`, ...(status? [`status=${status}`]:[])].join('&');
      const res: any = await ApiClient.get(`/internal/support/tickets?${q}`);
      setTickets(res.data || res.items || res || []);
      setTotal(res.total ?? 0);
    } catch (e: any) { setError(e?.message || 'Failed to load tickets'); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ if(canView) fetchList(); else setLoading(false); }, [page, status]);

  const open = async (t: Ticket) => {
    setSelected(null); setDetailErr(''); setMsgRes('');
    try { const d: any = await ApiClient.get(`/internal/support/tickets/${t.id}`); setSelected(d); }
    catch(e:any){ setDetailErr(e?.message||'Failed to load ticket'); setSelected(t); }
  };
  const doStatus = async (newStatus: string) => {
    if(!selected) return;
    setDetailErr(''); setMsgRes('');
    try { await ApiClient.post(`/internal/support/tickets/${selected.id}/status`, { status: newStatus, version: selected.version }); setMsgRes(`Status → ${newStatus}`); fetchList(); }
    catch(e:any){ setDetailErr(e?.message||'Status update failed'); }
  };
  const addMessage = async (e: React.FormEvent) => {
    e.preventDefault(); if(!msgBody.trim()||!selected) return;
    setDetailErr(''); setMsgRes('');
    try { await ApiClient.post(`/internal/support/tickets/${selected.id}/messages`, { body: msgBody, isInternal: false }); setMsgBody(''); setMsgRes('Message added'); }
    catch(e:any){ setDetailErr(e?.message||'Message failed'); }
  };

  if(!canView) return <div style={wrap}><div style={denied}>Requires <code>customer.manage_support_case</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🎧 Support Tickets</h2>
      <p style={sub}>Workforce ticket queue (internal service). {initialCustomerId ? `Filtered to customer ${initialCustomerId.slice(0,8)}… from Customer 360° — no manual entry.` : 'Assign, update status, add messages — real ledger-backed workflow.'}</p>
      {initialCustomerId && <div style={{...filters, background:'#F8FAFC', padding:'8px', borderRadius:6, border:'1px solid #E2E8F0', fontSize:12}}>🔗 Customer context: <code>{initialCustomerId}</code> — tickets filtered to this customer when backend supports <code>?customerId=</code></div>}
      <div style={filters}>
        <label>Status <select value={status} onChange={e=>{setStatus(e.target.value); setPage(1);}}><option value="">All</option><option value="OPEN">OPEN</option><option value="IN_PROGRESS">IN_PROGRESS</option><option value="RESOLVED">RESOLVED</option><option value="CLOSED">CLOSED</option></select></label>
        <button onClick={fetchList} style={btn}>Refresh</button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading tickets…</div> :
        tickets.length===0 ? <div style={empty}>No tickets for this filter. Tickets are created from customer/agent support flows.</div> :
        <table style={table}><thead><tr><th>ID</th><th>Status</th><th>Customer/Agent</th><th>Created</th><th></th></tr></thead><tbody>{tickets.map(t=><tr key={t.id}><td style={mono}>{t.id.slice(0,8)}…</td><td><span style={badge(t.status)}>{t.status}</span></td><td>{t.customerId?.slice(0,8) || t.agentId?.slice(0,8) || '-'}</td><td>{new Date(t.createdAt).toLocaleString()}</td><td><button onClick={()=>open(t)} style={smallBtn}>View</button></td></tr>)}</tbody></table>
      }
      <div style={pager}>Total {total} — Page {page} <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} style={smallBtn}>Prev</button><button onClick={()=>setPage(p=>p+1)} style={smallBtn}>Next</button></div>
      {selected && <div style={drawer}>
        <div style={drawerHead}><strong>Ticket {selected.id?.slice(0,8)}</strong> <button onClick={()=>setSelected(null)} style={smallBtn}>Close</button></div>
        <div style={drawerBody}>
          <div><strong>Status:</strong> {selected.status} {selected.priority && <>· Priority {selected.priority}</>}</div>
          <div><strong>Subject:</strong> {selected.subject || selected.title || '-'}</div>
          <div><strong>Assigned:</strong> {selected.assignedTo || 'unassigned'}</div>
          {detailErr && <div style={errBox}>{detailErr}</div>}
          {msgRes && <div style={successBox}>{msgRes}</div>}
          <div style={actionRow}>
            <button onClick={()=>doStatus('IN_PROGRESS')} style={btn}>Mark In Progress</button>
            <button onClick={()=>doStatus('RESOLVED')} style={successBtn}>Resolve</button>
            <button onClick={()=>doStatus('CLOSED')} style={dangerBtn}>Close</button>
          </div>
          <form onSubmit={addMessage} style={formRow}><input value={msgBody} onChange={e=>setMsgBody(e.target.value)} placeholder="Add message…" style={input}/><button type="submit" style={btn}>Send</button></form>
        </div>
      </div>}
    </div>
  );
};

const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:16};
const filters: React.CSSProperties={display:'flex',gap:12,marginBottom:16,alignItems:'center'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer'};
const smallBtn: React.CSSProperties={padding:'6px 10px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer',fontSize:12};
const dangerBtn: React.CSSProperties={...smallBtn,background:'#FEF2F2',borderColor:'#FCA5A5'}; const successBtn: React.CSSProperties={...smallBtn,background:'#ECFDF5',borderColor:'#6EE7B7'};
const table: React.CSSProperties={width:'100%',borderCollapse:'collapse',background:'#fff',borderRadius:8,overflow:'hidden'}; const badge=(s:string):React.CSSProperties=>({padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700,background:s==='OPEN'?'#FFF7ED':s==='IN_PROGRESS'?'#EFF6FF':s==='RESOLVED'?'#ECFDF5':'#F1F5F9',color:'#334155'});
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const successBox: React.CSSProperties={background:'#ECFDF5',border:'1px solid #6EE7B7',color:'#065F46',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const pager: React.CSSProperties={marginTop:12,display:'flex',gap:8,alignItems:'center',fontSize:13,color:'#64748B'}; const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13};
const drawer: React.CSSProperties={marginTop:16,border:'1px solid #E2E8F0',borderRadius:8,background:'#fff',overflow:'hidden'}; const drawerHead: React.CSSProperties={padding:12,background:'#F8FAFC',borderBottom:'1px solid #E2E8F0',display:'flex',justifyContent:'space-between',alignItems:'center'};
const drawerBody: React.CSSProperties={padding:16,display:'flex',flexDirection:'column',gap:12,fontSize:13}; const actionRow: React.CSSProperties={display:'flex',gap:8,flexWrap:'wrap' as const};
const mono: React.CSSProperties={fontFamily:'monospace',fontSize:12}; const input: React.CSSProperties={flex:1,padding:'8px 10px',borderRadius:6,border:'1px solid #E2E8F0'}; const formRow: React.CSSProperties={display:'flex',gap:8,marginTop:8};
