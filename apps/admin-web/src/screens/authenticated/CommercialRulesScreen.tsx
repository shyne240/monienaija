import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

type Tab = 'fees'|'commissions'|'rewards'|'products'|'limits';

export const CommercialRulesScreen: React.FC<{ initialTab?: Tab }> = ({ initialTab }) => {
  const { principal } = useAuthStore();
  const hasFn = (c: string) => principal?.scopes.includes(c) ?? false;
  const canView = hasFn('fee_rule.view') || hasFn('commission_rule.view') || hasFn('reward_rule.view') || hasFn('product.view') || hasFn('product.create') || hasFn('limit.view') || principal?.roles.includes('SUPER_ADMIN') || principal?.roles.includes('FINANCE_PREPARER') || hasFn('finance:prepare');
  const [tab, setTab] = useState<Tab>(initialTab || 'fees');
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const endpoints: Record<Tab,string> = {
    fees: '/internal/fee-rules',
    commissions: '/internal/commission-rules',
    rewards: '/internal/reward-rules',
    products: '/internal/products',
    limits: '/internal/limit-catalogue',
  };

  const fetchTab = async (t: Tab) => {
    setLoading(true); setError(''); setData(null);
    try {
      const res: any = await ApiClient.get(endpoints[t]);
      setData(res);
    } catch(e:any){ setError(e?.message||`Failed to load ${t}`); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{ if(canView) fetchTab(tab); }, [tab]);

  if(!canView) return <div style={wrap}><div style={denied}>Requires <code>fee_rule.view / commission_rule.view / reward_rule.view / product.view / limit.view</code>. Roles: {principal?.roles.join(', ')}</div></div>;

  return (
    <div style={wrap}>
      <h2 style={h2}>🏷️ Commercial Rule Registries</h2>
      <p style={sub}>Fee, commission, reward, product, limit registries — workforce configuration surfaces. All are <code>/internal/*</code> (reachable) and maker/checker governed for mutations (FINANCE_PREPARER initiates, FINANCE_CONTROLLER approves).</p>
      <div style={tabRow}>
        {(['fees','commissions','rewards','products','limits'] as Tab[]).map(t=><button key={t} onClick={()=>setTab(t)} style={tab===t?activeTab:tabBtn}>{t}</button>)}
        <button onClick={()=>fetchTab(tab)} style={btn}>Refresh</button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {loading ? <div style={loadingBox}>Loading {tab}…</div> :
        data ? <div style={card}><pre style={pre}>{JSON.stringify(data, null, 2)}</pre></div> :
        <div style={empty}>No {tab} data — registries are foundations (fee calc, commission/reward definitions) with zero seeded production rules in V1 (expected).</div>
      }
      <div style={note}>Commercial decision snapshots (<code>/internal/commercial-decision-snapshots</code>) are read-only evidence for fee/limit resolution — use the same pattern to add a snapshot viewer tab when runtime charging is introduced (V1 runtime charging is not in scope; registries manage definitions + diagnostics only).</div>
    </div>
  );
};
const wrap: React.CSSProperties={padding:'24px',maxWidth:1100}; const h2: React.CSSProperties={margin:'0 0 8px',color:'#032B14'}; const sub: React.CSSProperties={color:'#64748B',fontSize:13,marginBottom:12};
const tabRow: React.CSSProperties={display:'flex',gap:8,marginBottom:12,flexWrap:'wrap' as const}; const tabBtn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer',textTransform:'capitalize' as const};
const activeTab: React.CSSProperties={...tabBtn,background:'#032B14',color:'#fff',borderColor:'#032B14'}; const btn: React.CSSProperties={padding:'8px 14px',borderRadius:6,border:'1px solid #E2E8F0',background:'#fff',cursor:'pointer',marginLeft:'auto'};
const errBox: React.CSSProperties={background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#991B1B',padding:10,borderRadius:6,marginBottom:12,fontSize:13};
const loadingBox: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B'}; const empty: React.CSSProperties={padding:20,textAlign:'center',color:'#64748B',background:'#fff',borderRadius:8,border:'1px dashed #E2E8F0'};
const denied: React.CSSProperties={background:'#FFF7ED',border:'1px solid #FDBA74',color:'#92400E',padding:12,borderRadius:8,fontSize:13}; const card: React.CSSProperties={padding:16,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8};
const pre: React.CSSProperties={fontSize:11,background:'#F8FAFC',padding:8,borderRadius:6,overflow:'auto',maxHeight:500}; const note: React.CSSProperties={marginTop:16,fontSize:12,color:'#64748B',background:'#F8FAFC',padding:10,borderRadius:6,border:'1px solid #E2E8F0'};
