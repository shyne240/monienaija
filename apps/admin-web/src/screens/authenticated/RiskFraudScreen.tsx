import './operational-surfaces.css';
import React, { useState, useEffect, useRef } from 'react';
import './compliance-workspace.css';
import './compliance-redesign.css';
import { Button, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { CustomerComplianceCaseRow, validCustomerCase } from '../../utils/compliance-case';
import { ComplianceCaseDrawer } from '../../components/ComplianceCaseDrawer';

interface RiskFraudScreenProps {
  initialCustomerId?: string;
  onBackToCustomer?: () => void;
}

export const RiskFraudScreen: React.FC<RiskFraudScreenProps> = ({ initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('risk_fraud.manage_fraud_case') ?? false;
  const key = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.roles, canView, initialCustomerId]);
  return <FraudWorkspace key={key} canView={canView} initialCustomerId={initialCustomerId} onBackToCustomer={onBackToCustomer} />;
};
const FraudWorkspace: React.FC<RiskFraudScreenProps & {canView: boolean}> = ({canView, initialCustomerId, onBackToCustomer}) => {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [cases, setCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<CustomerComplianceCaseRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const fetchFraud = async (requestedId = customerId) => {
    if (!canView) return;
    if(!requestedId.trim()) { setError('Enter customer UUID'); return; }
    const id = requestedId.trim(); const request = ++generation.current;
    setLoading(true); setError(''); setCases([]); setSelectedCase(null); setSearched(false);
    try {
      // The server limits categories by current grants; this screen displays only FRAUD rows.
      const res: any = await ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`);
      const all = Array.isArray(res) ? res : res?.data ?? res?.items;
      if (!Array.isArray(all) || all.some((row: unknown) => !validCustomerCase(row, id))) throw new Error('Fraud case lookup returned an invalid response.');
      if (request !== generation.current) return;
      setCases(all.filter((c:any)=>(c.category||c.type)==='FRAUD'));
      setSearched(true);
    } catch(e:any){ if (request === generation.current) setError(e?.message||'Failed to load fraud cases'); }
    finally{ if (request === generation.current) setLoading(false); }
  };

  useEffect(() => { if(initialCustomerId && canView) void fetchFraud(initialCustomerId); }, [initialCustomerId, canView]);

  if(!canView) return <div className="mn-operational" style={wrap} role="alert"><div style={denied}>Fraud case lookup requires <code>risk_fraud.manage_fraud_case</code>.</div></div>;

  return (
    <div className="mn-operational mn-compliance compliance-workspace" style={wrap}>
      <PageHeader eyebrow="Compliance and risk" title="Fraud case lookup" description={`This screen displays FRAUD-category compliance cases for a customer. ${initialCustomerId ? 'Customer ID pre-filled from Customer 360°.' : 'Search by customer UUID.'}`} />
      {initialCustomerId && onBackToCustomer && <Button onClick={onBackToCustomer}>← Back to Customer 360°</Button>}
      <div className="compliance-workspace__boundary" role="note"><strong>Authorized case categories</strong><span>The server returns cases in categories authorized by your active role grants. This view displays FRAUD cases from those results; the server remains authoritative.</span></div>
      <section className="compliance-workspace__panel" aria-labelledby="fraud-search-heading">
        <div className="compliance-workspace__heading"><div><p className="compliance-workspace__eyebrow">CUSTOMER LOOKUP</p><h2 id="fraud-search-heading">Find a customer</h2><p>Use a customer UUID to search authorized FRAUD cases.</p></div></div>
        <form className="compliance-workspace__lookup" onSubmit={event=>{event.preventDefault();void fetchFraud();}}>
          <label>Customer UUID<input value={customerId} onChange={e=>{generation.current += 1;setCustomerId(e.target.value);setCases([]);setSelectedCase(null);setSearched(false);setError('');setLoading(false);}} placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0,8)}…` : 'Customer UUID'} /></label>
          <Button type="submit" variant="primary" disabled={loading}>{loading?'Loading…':'Search FRAUD cases'}</Button>
        </form>
        {initialCustomerId && <p className="compliance-workspace__hint">Customer context carried from Customer 360°.</p>}
      </section>
      <section className="compliance-workspace__panel" aria-labelledby="fraud-results-heading">
        <div className="compliance-workspace__heading"><div><p className="compliance-workspace__eyebrow">AUTHORIZED RECORDS</p><h2 id="fraud-results-heading">Fraud cases</h2><p>Only FRAUD-category cases in the returned results are shown.</p></div>{searched && !error && <span className="compliance-workspace__count">{cases.length} shown</span>}</div>
        {error && <div className="compliance-workspace__state compliance-workspace__state--error" role="alert">{error}</div>}
        {loading && <div className="compliance-workspace__state" role="status">Loading fraud cases…</div>}
        {!loading && !searched && !error && <div className="compliance-workspace__state">Search for a customer to view records.</div>}
        {!loading && !error && cases.length > 0 ? <ScrollRegion label="Fraud cases" hint="Scroll horizontally to see all columns."><table className="compliance-workspace__table"><thead><tr><th scope="col">Case number</th><th scope="col">Status</th><th scope="col">Severity</th><th scope="col">Opened</th><th scope="col">Details</th></tr></thead><tbody>{cases.map((c:any)=><tr key={c.id}><td><code>{c.caseNumber}</code></td><td><span className="compliance-workspace__badge">{c.status}</span></td><td>{c.severity}</td><td>{c.openedAt && Number.isFinite(Date.parse(c.openedAt)) ? new Date(c.openedAt).toLocaleString() : '—'}</td><td><button type="button" className="compliance-case-detail" aria-label={`View case ${c.caseNumber}`} onClick={() => setSelectedCase(c)}>View details</button></td></tr>)}</tbody></table></ScrollRegion> : !loading && searched && !error && <div className="compliance-workspace__state">No FRAUD cases were returned for this customer.</div>}
      </section>
      {selectedCase && <ComplianceCaseDrawer record={selectedCase} onClose={() => setSelectedCase(null)} />}
    </div>
  );
};
const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
