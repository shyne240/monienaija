import './operational-surfaces.css';
import React, { useEffect, useRef, useState } from 'react';
import './compliance-workspace.css';
import './compliance-redesign.css';
import { Button, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { useAuthStore } from '../../store/auth-store';
import { CustomerComplianceCaseRow, validCustomerCase } from '../../utils/compliance-case';
import { ComplianceCaseDrawer } from '../../components/ComplianceCaseDrawer';

interface ComplianceScreenProps {
  initialCustomerId?: string;
  initialCategory?: string;
  mode?: 'kyc' | 'cases';
  onBackToCustomer?: () => void;
  onComplianceGuardChange?: (guarded: boolean, busy: boolean) => void;
}

export const ComplianceScreen: React.FC<ComplianceScreenProps> = ({
  initialCustomerId,
  initialCategory,
  mode = 'kyc',
  onBackToCustomer,
  onComplianceGuardChange,
}) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.scopes, principal?.roles, principal?.customerAccess, principal?.readOnlyPrincipal, mode, initialCustomerId, initialCategory]);
  return <ComplianceWorkspace key={key} principal={principal} initialCustomerId={initialCustomerId} initialCategory={initialCategory} mode={mode} onBackToCustomer={onBackToCustomer} onComplianceGuardChange={onComplianceGuardChange} />;
};

const ComplianceWorkspace: React.FC<ComplianceScreenProps & {principal: ReturnType<typeof useAuthStore.getState>['principal']}> = ({principal, initialCustomerId, initialCategory, mode = 'kyc', onBackToCustomer, onComplianceGuardChange}) => {
  const lookupGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  useEffect(() => () => { lookupGeneration.current += 1; mutationGeneration.current += 1; }, []);
  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  const canViewKyc = hasFn('kyc.view');
  const availableKycStatuses = [
    ...(hasFn('kyc.review') ? ['NOT_STARTED', 'PENDING'] : []),
    ...(hasFn('kyc.approve') ? ['APPROVED'] : []),
    ...(hasFn('kyc.reject') ? ['REJECTED'] : []),
  ];
  const canSubmitKyc = availableKycStatuses.length > 0 && !principal?.readOnlyPrincipal;
  const canManageCases = hasFn('compliance.manage_case');
  const canAccess = mode === 'cases' ? canManageCases : canViewKyc || availableKycStatuses.length > 0;
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [kyc, setKyc] = useState<any>(null);
  const [cases, setCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<CustomerComplianceCaseRow | null>(null);
  const [caseCategory, setCaseCategory] = useState(initialCategory || 'ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('APPROVED');
  const [kycReason, setKycReason] = useState('');
  const [assessMsg, setAssessMsg] = useState('');
  const [assessErr, setAssessErr] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [decisionDirty, setDecisionDirty] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<{id: string; level: string; status: string; reason: string} | null>(null);
  const [uncertain, setUncertain] = useState<{id: string; level: string; status: string} | null>(null);
  const [completedDecision, setCompletedDecision] = useState<{id: string; level: string; status: string} | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const mutationInFlight = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, Boolean(pendingDecision), () => { if (!mutationInFlight.current) setPendingDecision(null); }, triggerRef);
  useEffect(() => { if (assessing) dialogRef.current?.focus(); }, [assessing]);
  const complianceGuard = mode === 'kyc' && (decisionDirty || assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision));
  useEffect(() => { onComplianceGuardChange?.(complianceGuard, assessing); }, [onComplianceGuardChange, complianceGuard, assessing]);
  useEffect(() => () => onComplianceGuardChange?.(false, false), [onComplianceGuardChange]);
  useEffect(() => {
    if (!complianceGuard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [complianceGuard]);


  useEffect(() => {
    if (availableKycStatuses.length > 0 && !availableKycStatuses.includes(kycStatus)) {
      setKycStatus(availableKycStatuses[0]);
    }
  }, [availableKycStatuses.join('|'), kycStatus]);

  const fetchForCustomer = async (requestedCustomerId = customerId) => {
    const id = requestedCustomerId.trim();
    if (!id) { setError('Enter a customer UUID'); return; }
    if (!canAccess) return;
    const request = ++lookupGeneration.current;
    const valid = () => request === lookupGeneration.current;
    setLoading(true);
    setError('');
    setSearched(false);
    setKyc(null);
    setCases([]); setSelectedCase(null);
    const errors: string[] = [];

    const requests: Promise<void>[] = [];
    if (mode === 'kyc' && canViewKyc) {
      requests.push(
        ApiClient.get(`/customers/${encodeURIComponent(id)}/kyc`)
          .then((record: any) => {
            if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.level !== 'string' || typeof record.status !== 'string' || record.customerId !== id) throw new Error('KYC lookup returned an invalid response.');
            if (valid()) setKyc(record);
          })
          .catch((err: any) => { errors.push(err?.status === 404 ? 'Customer or current KYC assessment not found.' : err?.message || 'KYC assessment lookup failed'); }),
      );
    }
    if (mode === 'cases' && canManageCases) {
      requests.push(
        ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`)
          .then((response: any) => {
            const rows = Array.isArray(response) ? response : response?.data ?? response?.items;
            if (!Array.isArray(rows) || rows.some((row: unknown) => !validCustomerCase(row, id))) throw new Error('Compliance lookup returned an invalid response.');
            if (valid()) setCases(rows);
          })
          .catch((err: any) => { errors.push(err?.message || 'Compliance case lookup failed'); }),
      );
    }

    await Promise.all(requests);
    if (!valid()) return;
    if (errors.length > 0) setError(errors.join('; '));
    else setSearched(requests.length > 0);
    setLoading(false);
  };

  useEffect(() => {
    if (!initialCustomerId || !canAccess) return;
    setCustomerId(initialCustomerId);
    fetchForCustomer(initialCustomerId);
  }, [initialCustomerId, canAccess, mode]);

  const beginAssessment = (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || assessing || mutationInFlight.current || pendingDecision || uncertain || completedDecision || !canSubmitKyc || !availableKycStatuses.includes(kycStatus) || !customerId.trim() || !principal?.principalId) return;
    setPendingDecision({id: customerId.trim(), level: kycLevel, status: kycStatus, reason: kycReason.trim()});
  };

  const reviewAssessment = async () => {
    if (!uncertain || !canViewKyc || assessing || loading) return;
    const request = ++lookupGeneration.current;
    setLoading(true); setReviewReady(false); setError(''); setKyc(null); setSearched(false);
    try {
      const record: any = await ApiClient.get(`/customers/${encodeURIComponent(uncertain.id)}/kyc`);
      if (request !== lookupGeneration.current) return;
      if (!record || record.customerId !== uncertain.id || !['NONE','LEVEL_1','LEVEL_2','LEVEL_3'].includes(record.level) || !['NOT_STARTED','PENDING','APPROVED','REJECTED'].includes(record.status)) throw new Error('KYC review response did not match the customer.');
      setKyc(record); setSearched(true); setReviewReady(true);
    } catch (err: any) {
      if (request === lookupGeneration.current) setError(err?.status === 404 ? 'Customer or current KYC assessment not found; review remains required.' : err?.message || 'KYC review failed.');
    } finally { if (request === lookupGeneration.current) setLoading(false); }
  };

  const submitAssessment = async () => {
    if (!pendingDecision || assessing || mutationInFlight.current || uncertain || completedDecision || !canSubmitKyc || !availableKycStatuses.includes(pendingDecision.status) || !principal?.principalId) return;
    const decision = pendingDecision;
    const request = ++mutationGeneration.current;
    mutationInFlight.current = true; setAssessErr(''); setAssessMsg(''); setAssessing(true);
    try {
      const receipt: any = await ApiClient.post(`/customers/${encodeURIComponent(decision.id)}/kyc-assessment`, {
        level: decision.level, status: decision.status, reason: decision.reason || undefined, assessedBy: principal.principalId,
      });
      if (request !== mutationGeneration.current) return;
      if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim() || receipt.customerId !== decision.id || receipt.level !== decision.level || receipt.status !== decision.status || receipt.assessedBy !== principal.principalId || (receipt.reason ?? '') !== decision.reason || receipt.isCurrent !== true) throw new Error('Assessment receipt did not match the decision.');
      setDecisionDirty(false); setKycReason(''); setCompletedDecision({id:decision.id,level:decision.level,status:decision.status}); setAssessMsg('KYC assessment submitted.');
      if (canViewKyc) await fetchForCustomer(decision.id);
    } catch (err: any) {
      if (request === mutationGeneration.current) { lookupGeneration.current++; setLoading(false); setReviewReady(false); setUncertain({id:decision.id,level:decision.level,status:decision.status}); setAssessErr(`Assessment outcome not confirmed. Check the customer assessment and audit trail before retrying. ${err?.message || 'Service unavailable.'}`); }
    } finally { mutationInFlight.current = false; if (request === mutationGeneration.current) { setAssessing(false); setPendingDecision(null); } }
  };

  if (!canAccess) {
    return (
      <div className="mn-operational" style={wrap} role="alert">
        <div style={denied}>
          {mode === 'cases'
            ? 'Compliance case lookup requires compliance.manage_case.'
            : 'KYC assessment lookup or action requires kyc.view, kyc.review, kyc.approve, or kyc.reject.'}
        </div>
      </div>
    );
  }

  const visibleCases = cases.filter((item) =>
    item.category !== 'FRAUD' &&
    (caseCategory === 'ALL' || item.category === caseCategory),
  );

  const nonFraudCases = cases.filter(item => item.category !== 'FRAUD');
  return (
    <div className="mn-operational mn-compliance compliance-workspace" style={wrap}>
      <PageHeader eyebrow="Compliance and risk" title={mode === 'cases' ? 'Compliance case lookup' : 'KYC assessment lookup & review'} description={mode === 'cases' ? 'Look up compliance cases for a customer. FRAUD-category rows are excluded from this display.' : 'Look up an existing customer KYC assessment and perform only the review decision allowed by your function grants.'} />
      {initialCustomerId && onBackToCustomer && <Button onClick={onBackToCustomer}>← Back to Customer 360°</Button>}
      {completedDecision && <div className="compliance-workspace__boundary" role="status"><strong>Assessment submitted</strong><span>A matching receipt was received for customer {completedDecision.id}, level {completedDecision.level}, status {completedDecision.status}. Review the assessment and audit history before submitting another decision.</span><button type="button" disabled={loading || assessing} onClick={() => setCompletedDecision(null)}>I reviewed the submitted assessment</button></div>}
      {uncertain && <div className="compliance-workspace__boundary" role="status"><strong>KYC review required</strong><span>The {uncertain.status} decision for customer {uncertain.id} may have occurred. Independently inspect the assessment and available audit history. A missing record or fresh read cannot exclude a late commit. This local review lock is lost on confirmed exit or session change.</span>{canViewKyc ? <button type="button" disabled={loading || assessing} onClick={() => void reviewAssessment()}>Reload assessment for review</button> : <span>Assessment read permission is unavailable; use an independently authorized source.</span>}{(!canViewKyc || reviewReady) && <button type="button" disabled={loading || assessing} onClick={() => { setUncertain(null); setReviewReady(false); setAssessErr(''); }}>I reviewed the assessment and audit history</button>}</div>}
      <div className="compliance-workspace__boundary" role="note"><strong>{mode === 'cases' ? 'Authorized case categories' : 'Customer-scoped assessment'}</strong><span>{mode === 'cases' ? 'The server returns cases in categories authorized by your active role grants. This view excludes FRAUD and filters the returned records locally.' : 'Assessment visibility and decisions are governed by separate function grants. A lookup does not itself change customer status.'}</span></div>
      <section className="compliance-workspace__panel" aria-labelledby="compliance-search-heading">
        <div className="compliance-workspace__heading"><div><p className="compliance-workspace__eyebrow">CUSTOMER LOOKUP</p><h2 id="compliance-search-heading">Find a customer</h2><p>Use a customer UUID to load this workspace.</p></div></div>
        <form className="compliance-workspace__lookup" onSubmit={event => { event.preventDefault(); void fetchForCustomer(); }}>
          <label>Customer UUID<input value={customerId} onChange={(event) => { if (decisionDirty && !window.confirm('Change customer and discard the current KYC decision draft?')) return; lookupGeneration.current += 1; setLoading(false); setCustomerId(event.target.value); setKyc(null); setCases([]); setSelectedCase(null); setSearched(false); setError(''); setAssessMsg(''); setAssessErr(''); setKycReason(''); if (mode === 'kyc') { setKycLevel('LEVEL_1'); setKycStatus(availableKycStatuses.includes('APPROVED') ? 'APPROVED' : availableKycStatuses[0] ?? 'APPROVED'); } setDecisionDirty(false); }} disabled={assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision)} placeholder={initialCustomerId ? `Customer ${initialCustomerId.slice(0, 8)}…` : 'Customer UUID'} /></label>
          <Button type="submit" variant="primary" disabled={loading || assessing || Boolean(pendingDecision) || Boolean(uncertain)}>{loading ? 'Loading…' : 'Search'}</Button>
        </form>
        {initialCustomerId && <p className="compliance-workspace__hint">Customer context carried from Customer 360°; the customer ID is passed to the scoped lookup endpoint.</p>}
      </section>
      <section className="compliance-workspace__panel" aria-labelledby="compliance-results-heading">
        <div className="compliance-workspace__heading"><div><p className="compliance-workspace__eyebrow">{mode === 'cases' ? 'AUTHORIZED RECORDS' : 'CURRENT RECORD'}</p><h2 id="compliance-results-heading">{mode === 'cases' ? 'Compliance cases' : 'KYC assessment'}</h2><p>{mode === 'cases' ? 'Category selection filters the records returned for this customer.' : 'The current assessment is shown when you have permission to view it.'}</p></div>{mode === 'cases' && searched && !error && <span className="compliance-workspace__count">{visibleCases.length} shown</span>}</div>
        {error && <div className="compliance-workspace__state compliance-workspace__state--error" role="alert">{error}</div>}
        {loading && <div className="compliance-workspace__state" role="status">Loading customer records…</div>}
        {!loading && !error && !searched && (mode === 'cases' || canViewKyc) && <div className="compliance-workspace__state">Search for a customer to view records.</div>}
        {mode === 'kyc' && !canViewKyc && <div className="compliance-workspace__state">Assessment lookup requires <code>kyc.view</code>. {canSubmitKyc ? 'Your decision permissions are shown below.' : 'Decision actions are unavailable for this session.'}</div>}
        {mode === 'kyc' && canViewKyc && !loading && !error && kyc && <div className="compliance-workspace__assessment">
          <div><span>Assessment</span><strong>KYC: Level {kyc.level} — Status {kyc.status}</strong></div>
          <div><span>Assessed by</span><strong>{kyc.assessedBy || 'Not recorded'}</strong></div>
          <div><span>Reason</span><strong>{kyc.reason || 'Not recorded'}</strong></div>
        </div>}
        {mode === 'kyc' && canViewKyc && !loading && searched && !error && !kyc && <div className="compliance-workspace__state">No KYC assessment found for this customer.</div>}
        {mode === 'cases' && <>
          <div className="compliance-workspace__filter"><label>Category<select value={caseCategory} onChange={(event) => { setCaseCategory(event.target.value); setSelectedCase(null); }}><option value="ALL">All non-FRAUD compliance cases</option><option value="AML">AML</option><option value="KYC">KYC</option><option value="SANCTIONS">SANCTIONS</option><option value="PEP">PEP</option><option value="DOCUMENT">DOCUMENT</option><option value="ACCOUNT_REVIEW">ACCOUNT_REVIEW</option><option value="MANUAL_REVIEW">MANUAL_REVIEW</option><option value="OTHER">OTHER</option></select></label></div>
          {!loading && !error && searched && <p className="compliance-workspace__summary">{visibleCases.length} shown · {nonFraudCases.length} non-FRAUD records returned</p>}
          {!loading && !error && visibleCases.length > 0 ? <ScrollRegion label="Compliance cases" hint="Scroll horizontally to see all columns."><table className="compliance-workspace__table"><thead><tr><th scope="col">Case number</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Severity</th><th scope="col">Details</th></tr></thead><tbody>{visibleCases.map((item: CustomerComplianceCaseRow) => <tr key={item.id}><td><code>{item.caseNumber}</code></td><td>{item.category}</td><td><span className="compliance-workspace__badge">{item.status}</span></td><td>{item.severity}</td><td><button type="button" className="compliance-case-detail" aria-label={`View case ${item.caseNumber}`} onClick={() => setSelectedCase(item)}>View details</button></td></tr>)}</tbody></table></ScrollRegion> : !loading && searched && !error && <div className="compliance-workspace__state">No compliance cases match this customer and category filter.</div>}
        </>}
      </section>
      {mode === 'kyc' && canSubmitKyc && <section className="compliance-workspace__panel" aria-labelledby="kyc-decision-heading">
        <div className="compliance-workspace__heading"><div><p className="compliance-workspace__eyebrow">REVIEW DECISION</p><h2 id="kyc-decision-heading">Submit KYC assessment decision</h2><p>Available statuses reflect your function grants. Confirm the customer and decision before submitting.</p></div></div>
        <p className="compliance-workspace__target">Decision customer: <code>{customerId.trim() || 'Enter a customer UUID above'}</code></p>
        <form onSubmit={beginAssessment} className="compliance-workspace__decision">
          <label>Level<select disabled={assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision)} value={kycLevel} onChange={(event) => { setKycLevel(event.target.value); setDecisionDirty(true); }}><option>LEVEL_1</option><option>LEVEL_2</option><option>LEVEL_3</option></select></label>
          <label>Status<select disabled={assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision)} value={kycStatus} onChange={(event) => { setKycStatus(event.target.value); setDecisionDirty(true); }}>{availableKycStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label>Assessment reason (optional)<input disabled={assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision)} value={kycReason} onChange={(event) => { setKycReason(event.target.value); setDecisionDirty(true); }} placeholder="Reason (optional)" /></label>
          <div className="compliance-workspace__decision-action"><Button ref={triggerRef} type="submit" variant="primary" disabled={loading || assessing || Boolean(pendingDecision) || Boolean(uncertain) || Boolean(completedDecision) || !customerId.trim()}>{assessing ? 'Submitting…' : 'Submit Assessment'}</Button></div>
        </form>
        {assessMsg && <div className="compliance-workspace__state compliance-workspace__state--success" role="status">{assessMsg}</div>}
        {assessErr && <div className="compliance-workspace__state compliance-workspace__state--error" role="alert">{assessErr}</div>}
      </section>}
      {selectedCase && <ComplianceCaseDrawer record={selectedCase} onClose={() => setSelectedCase(null)} />}
      {pendingDecision && <div className="cm-modal-backdrop"><section ref={dialogRef} tabIndex={-1} className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="kyc-confirm-title"><h2 id="kyc-confirm-title">Confirm KYC decision?</h2><p>Customer <code>{pendingDecision.id}</code> · Level {pendingDecision.level} · Status {pendingDecision.status}</p><p>Reason: {pendingDecision.reason || 'Not provided'}</p><div className="cm-actions-row"><button type="button" disabled={assessing} onClick={() => setPendingDecision(null)}>Keep editing</button><button type="button" disabled={assessing} onClick={() => void submitAssessment()}>{assessing ? 'Submitting…' : 'Confirm KYC decision'}</button></div></section></div>}
    </div>
  );
};
const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
