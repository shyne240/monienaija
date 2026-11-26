import './operational-surfaces.css';
import React, { useState, useEffect, useRef } from 'react';
import './compliance-workspace.css';
import './compliance-redesign.css';
import { Button, PageHeader, ScrollRegion } from '../../design-system/primitives';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import {
  CustomerComplianceCaseRow,
  validCustomerCase,
  validQueueComplianceCase,
} from '../../utils/compliance-case';
import { ComplianceCaseDrawer } from '../../components/ComplianceCaseDrawer';

interface RiskFraudScreenProps {
  initialCustomerId?: string;
  liveWorkspace?: boolean;
  onBackToCustomer?: () => void;
  onNavigateToCustomer?: (customerId: string) => void;
  onNavigateToSupport?: (customerId?: string) => void;
}

const CUSTOMER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmtShortDate(val?: string | null): string {
  if (typeof val === 'string' && Number.isFinite(Date.parse(val))) {
    return new Date(val).toLocaleString();
  }
  return '—';
}

export const RiskFraudScreen: React.FC<RiskFraudScreenProps> = ({
  initialCustomerId,
  liveWorkspace = false,
  onBackToCustomer,
  onNavigateToCustomer,
  onNavigateToSupport,
}) => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('risk_fraud.manage_fraud_case') ?? false;
  const canMutate = canView && !principal?.readOnlyPrincipal;
  const key = JSON.stringify([
    principal?.principalId,
    principal?.sessionId,
    principal?.type,
    principal?.assuranceLevel,
    principal?.roles,
    principal?.readOnlyPrincipal,
    canView,
    initialCustomerId,
  ]);
  return (
    <FraudWorkspace
      key={key}
      canView={canView}
      canMutate={canMutate}
      principalId={principal?.principalId}
      initialCustomerId={initialCustomerId}
      liveWorkspace={liveWorkspace}
      onBackToCustomer={onBackToCustomer}
      onNavigateToCustomer={onNavigateToCustomer}
      onNavigateToSupport={onNavigateToSupport}
    />
  );
};

const FraudWorkspace: React.FC<
  RiskFraudScreenProps & { canView: boolean; canMutate: boolean; principalId?: string }
> = ({
  canView,
  canMutate,
  principalId,
  initialCustomerId,
  liveWorkspace = false,
  onBackToCustomer,
  onNavigateToCustomer,
  onNavigateToSupport,
}) => {
  const generation = useRef(0);
  const queueGen = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      queueGen.current += 1;
    },
    [],
  );
  const [customerId, setCustomerId] = useState(initialCustomerId || '');
  const [cases, setCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<CustomerComplianceCaseRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  // Operational FRAUD Queue state
  const [queueCases, setQueueCases] = useState<CustomerComplianceCaseRow[]>([]);
  const [queueCounts, setQueueCounts] = useState<{
    total: number;
    open: number;
    escalated: number;
    underReview: number;
    pendingCustomer: number;
    unassigned: number;
    criticalOrHigh: number;
  } | null>(null);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueStatus, setQueueStatus] = useState('ALL');
  const [queueSeverity, setQueueSeverity] = useState('ALL');
  const [queueAssigned, setQueueAssigned] = useState('ALL');
  const [queueSearch, setQueueSearch] = useState('');
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotalPages, setQueueTotalPages] = useState(1);

  // Create FRAUD Case state
  const [showCreate, setShowCreate] = useState(false);
  const [newFraudCustomerId, setNewFraudCustomerId] = useState(initialCustomerId || '');
  const [newFraudCaseNumber, setNewFraudCaseNumber] = useState('');
  const [newFraudSeverity, setNewFraudSeverity] = useState('CRITICAL');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [createErr, setCreateErr] = useState('');

  const loadFraudQueue = async (
    overrides?: Partial<{
      status: string;
      severity: string;
      assignedTo: string;
      search: string;
      page: number;
    }>,
  ) => {
    if (!canView) return;
    const req = ++queueGen.current;
    setQueueLoading(true);
    setQueueError('');
    const st = overrides?.status ?? queueStatus;
    const sev = overrides?.severity ?? queueSeverity;
    const asgn = overrides?.assignedTo ?? queueAssigned;
    const srch = overrides?.search ?? queueSearch;
    const pg = overrides?.page ?? queuePage;
    try {
      const qs = new URLSearchParams({
        scope: 'FRAUD',
        status: st,
        severity: sev,
        assignedTo: asgn,
        page: String(pg),
        limit: '20',
      });
      if (srch.trim()) qs.set('search', srch.trim());
      const res: any = await Promise.resolve(
        ApiClient.get(`/internal/compliance-cases?${qs.toString()}`),
      );
      if (req !== queueGen.current) return;
      if (res && Array.isArray(res.items) && res.items.every(validQueueComplianceCase)) {
        setQueueCases(res.items.filter((r: CustomerComplianceCaseRow) => r.category === 'FRAUD'));
        setQueueCounts(res.counts ?? null);
        setQueueTotalPages(Math.max(1, Number(res.pagination?.totalPages ?? 1)));
        setQueueLoaded(true);
      }
    } catch (err: any) {
      if (req === queueGen.current) {
        setQueueError(err?.message || 'Fraud case queue is unavailable.');
      }
    } finally {
      if (req === queueGen.current) setQueueLoading(false);
    }
  };

  const fetchFraud = async (requestedId = customerId) => {
    if (!canView) return;
    if (!requestedId.trim()) {
      setError('Enter customer UUID');
      return;
    }
    const id = requestedId.trim();
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setCases([]);
    setSelectedCase(null);
    setSearched(false);
    try {
      const res: any = await Promise.resolve(
        ApiClient.get(`/customers/${encodeURIComponent(id)}/compliance-cases`),
      );
      const all = Array.isArray(res) ? res : (res?.data ?? res?.items);
      if (!Array.isArray(all) || all.some((row: unknown) => !validCustomerCase(row, id)))
        throw new Error('Fraud case lookup returned an invalid response.');
      if (request !== generation.current) return;
      setCases(all.filter((c: any) => (c.category || c.type) === 'FRAUD'));
      setSearched(true);
    } catch (e: any) {
      if (request === generation.current) setError(e?.message || 'Failed to load fraud cases');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (liveWorkspace && canView) {
      void loadFraudQueue();
    }
    if (initialCustomerId && canView) {
      setNewFraudCustomerId(initialCustomerId);
      void fetchFraud(initialCustomerId);
    }
  }, [initialCustomerId, canView, liveWorkspace]);

  const handleCreateFraudCase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canMutate || creating) return;
    const targetCust = newFraudCustomerId.trim() || customerId.trim();
    const normalizedNum = newFraudCaseNumber.trim().toLowerCase();
    if (!CUSTOMER_UUID.test(targetCust)) {
      setCreateErr('Enter a valid Customer UUID to open a FRAUD case.');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_.:-]{0,99}$/.test(normalizedNum)) {
      setCreateErr(
        'Case number must start with lowercase alphanumeric and contain only a-z, 0-9, -, _, ., :.',
      );
      return;
    }
    setCreating(true);
    setCreateErr('');
    setCreateMsg('');
    try {
      const created = await ApiClient.post<CustomerComplianceCaseRow>(
        `/customers/${encodeURIComponent(targetCust)}/compliance-cases`,
        {
          caseNumber: normalizedNum,
          category: 'FRAUD',
          severity: newFraudSeverity,
        },
      );
      if (!created || typeof created.id !== 'string') {
        throw new Error('Fraud case creation response was invalid.');
      }
      setCreateMsg(`Opened FRAUD case ${created.caseNumber}.`);
      setNewFraudCaseNumber('');
      setShowCreate(false);
      if (customerId.trim() === targetCust) {
        void fetchFraud(targetCust);
      }
      if (liveWorkspace || queueLoaded) {
        void loadFraudQueue();
      }
      setSelectedCase(created);
    } catch (err: any) {
      setCreateErr(err?.message || 'Failed to open FRAUD case.');
    } finally {
      setCreating(false);
    }
  };

  const syncUpdatedCase = (updated: CustomerComplianceCaseRow) => {
    setSelectedCase(updated);
    setCases((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    setQueueCases((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  };

  if (!canView)
    return (
      <div className="mn-operational" style={wrap} role="alert">
        <div style={denied}>
          Fraud case lookup requires <code>risk_fraud.manage_fraud_case</code>.
        </div>
      </div>
    );

  return (
    <div className="mn-operational mn-compliance compliance-workspace" style={wrap}>
      <PageHeader
        eyebrow="Compliance and risk"
        title="Fraud case lookup"
        description={`Triage the FRAUD investigation queue, open new FRAUD cases, or inspect customer FRAUD records. ${initialCustomerId ? 'Customer ID pre-filled from Customer 360°.' : 'Search by customer UUID or browse the queue.'}`}
      />
      {initialCustomerId && onBackToCustomer && (
        <Button onClick={onBackToCustomer}>← Back to Customer 360°</Button>
      )}

      <section
        className="compliance-workspace__panel"
        aria-labelledby="fraud-queue-heading"
        data-testid="fraud-case-queue-panel"
      >
        <div className="compliance-workspace__heading">
          <div>
            <p className="compliance-workspace__eyebrow">FRAUD INVESTIGATION QUEUE</p>
            <h2 id="fraud-queue-heading">Active FRAUD case triage</h2>
            <p>
              Institution-scoped queue strictly bounded to <code>FRAUD</code>-category cases.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canMutate && (
              <Button
                variant="primary"
                onClick={() => {
                  setShowCreate((open) => !open);
                  setCreateErr('');
                  setCreateMsg('');
                }}
              >
                {showCreate ? 'Close new case form' : '+ Open FRAUD case'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void loadFraudQueue()}
              disabled={queueLoading}
            >
              {queueLoading
                ? 'Loading queue…'
                : queueLoaded
                  ? 'Refresh FRAUD queue'
                  : 'Load FRAUD queue'}
            </Button>
          </div>
        </div>

        {createMsg && (
          <div className="compliance-workspace__state compliance-workspace__state--success" role="status">
            {createMsg}
          </div>
        )}

        {showCreate && canMutate && (
          <form
            onSubmit={handleCreateFraudCase}
            style={{ ...subPanelStyle, marginBottom: 14 }}
            aria-label="Create FRAUD case"
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Open new FRAUD investigation case</h3>
            {createErr && (
              <div
                className="compliance-workspace__state compliance-workspace__state--error"
                role="alert"
                style={{ marginBottom: 8 }}
              >
                {createErr}
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 10,
              }}
            >
              <label style={inlineFilterLabel}>
                Target customer UUID
                <input
                  aria-label="New FRAUD case customer UUID"
                  value={newFraudCustomerId}
                  onChange={(e) => setNewFraudCustomerId(e.target.value)}
                  placeholder="Customer UUID"
                />
              </label>
              <label style={inlineFilterLabel}>
                Case number (lowercase)
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    aria-label="New FRAUD case number"
                    value={newFraudCaseNumber}
                    onChange={(e) => setNewFraudCaseNumber(e.target.value)}
                    placeholder="fraud-2026-0091"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="compliance-case-detail"
                    onClick={() => setNewFraudCaseNumber(`fraud-${Date.now().toString(36)}`)}
                  >
                    Generate
                  </button>
                </div>
              </label>
              <label style={inlineFilterLabel}>
                Severity
                <select
                  aria-label="New FRAUD case severity"
                  value={newFraudSeverity}
                  onChange={(e) => setNewFraudSeverity(e.target.value)}
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? 'Opening…' : 'Create FRAUD case'}
              </Button>
            </div>
          </form>
        )}

        {queueCounts && (
          <div style={kpiGridStyle} data-testid="fraud-case-kpis">
            <div style={kpiCardStyle}>
              <span>Total FRAUD Cases</span>
              <strong>{queueCounts.total}</strong>
            </div>
            <div style={kpiCardStyle}>
              <span>Escalated</span>
              <strong>{queueCounts.escalated}</strong>
            </div>
            <div style={kpiCardStyle}>
              <span>Open</span>
              <strong>{queueCounts.open}</strong>
            </div>
            <div style={kpiCardStyle}>
              <span>Under Review</span>
              <strong>{queueCounts.underReview}</strong>
            </div>
            <div style={kpiCardStyle}>
              <span>Unassigned</span>
              <strong>{queueCounts.unassigned}</strong>
            </div>
            <div style={kpiCardStyle}>
              <span>Critical / High</span>
              <strong>{queueCounts.criticalOrHigh}</strong>
            </div>
          </div>
        )}

        <div style={filterBarStyle}>
          <label style={inlineFilterLabel}>
            Queue status
            <select
              aria-label="FRAUD queue status"
              value={queueStatus}
              onChange={(e) => {
                const next = e.target.value;
                setQueueStatus(next);
                setQueuePage(1);
                void loadFraudQueue({ status: next, page: 1 });
              }}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active (Unresolved)</option>
              <option value="ESCALATED">ESCALATED</option>
              <option value="OPEN">OPEN</option>
              <option value="UNDER_REVIEW">UNDER_REVIEW</option>
              <option value="PENDING_CUSTOMER">PENDING_CUSTOMER</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </label>
          <label style={inlineFilterLabel}>
            Queue severity
            <select
              aria-label="FRAUD queue severity"
              value={queueSeverity}
              onChange={(e) => {
                const next = e.target.value;
                setQueueSeverity(next);
                setQueuePage(1);
                void loadFraudQueue({ severity: next, page: 1 });
              }}
            >
              <option value="ALL">All severities</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
          <label style={inlineFilterLabel}>
            Assignment
            <select
              aria-label="FRAUD queue assignment"
              value={queueAssigned}
              onChange={(e) => {
                const next = e.target.value;
                setQueueAssigned(next);
                setQueuePage(1);
                void loadFraudQueue({ assignedTo: next, page: 1 });
              }}
            >
              <option value="ALL">All</option>
              <option value="UNASSIGNED">Unassigned</option>
              <option value="ME">Assigned to me</option>
            </select>
          </label>
          <label style={inlineFilterLabel}>
            Search FRAUD queue
            <input
              aria-label="Search FRAUD queue"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Case #, customer ref or UUID"
            />
          </label>
          <button
            type="button"
            className="compliance-case-detail"
            disabled={queueLoading}
            onClick={() => {
              setQueuePage(1);
              void loadFraudQueue({ page: 1 });
            }}
          >
            Filter queue
          </button>
        </div>

        {queueError && (
          <div className="compliance-workspace__state compliance-workspace__state--error" role="alert">
            {queueError}
          </div>
        )}
        {queueLoaded && !queueError && queueCases.length === 0 && (
          <div className="compliance-workspace__state">
            No FRAUD cases match the active queue filters.
          </div>
        )}
        {queueCases.length > 0 && !queueError && (
          <>
            <ScrollRegion label="FRAUD case queue" hint="Scroll horizontally to see all columns.">
              <table className="compliance-workspace__table">
                <thead>
                  <tr>
                    <th scope="col">Case number</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Assigned</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queueCases.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.caseNumber}</code>
                      </td>
                      <td>
                        <div>
                          {item.customerDisplayName ||
                            item.customerReference ||
                            item.customerId.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          <code>{item.customerId.slice(0, 8)}…</code>
                        </div>
                      </td>
                      <td>
                        <span className="compliance-workspace__badge">{item.status}</span>
                      </td>
                      <td>{item.severity}</td>
                      <td>{item.assignedTo || 'Unassigned'}</td>
                      <td>{fmtShortDate(item.openedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="compliance-case-detail"
                          aria-label={`Investigate fraud case ${item.caseNumber}`}
                          onClick={() => setSelectedCase(item)}
                        >
                          Investigate case
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            {queueTotalPages > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 12, color: '#475569' }}>
                  Page {queuePage} of {queueTotalPages}
                </span>
                <button
                  type="button"
                  className="compliance-case-detail"
                  disabled={queuePage <= 1 || queueLoading}
                  onClick={() => {
                    const prev = Math.max(1, queuePage - 1);
                    setQueuePage(prev);
                    void loadFraudQueue({ page: prev });
                  }}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="compliance-case-detail"
                  disabled={queuePage >= queueTotalPages || queueLoading}
                  onClick={() => {
                    const next = queuePage + 1;
                    setQueuePage(next);
                    void loadFraudQueue({ page: next });
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <div className="compliance-workspace__boundary" role="note">
        <strong>Authorized case categories</strong>
        <span>
          The server returns cases in categories authorized by your active role grants. This view
          displays FRAUD cases from those results; the server remains authoritative.
        </span>
      </div>
      <section className="compliance-workspace__panel" aria-labelledby="fraud-search-heading">
        <div className="compliance-workspace__heading">
          <div>
            <p className="compliance-workspace__eyebrow">CUSTOMER LOOKUP</p>
            <h2 id="fraud-search-heading">Find a customer</h2>
            <p>Use a customer UUID to search authorized FRAUD cases.</p>
          </div>
        </div>
        <form
          className="compliance-workspace__lookup"
          onSubmit={(event) => {
            event.preventDefault();
            void fetchFraud();
          }}
        >
          <label>
            Customer UUID
            <input
              value={customerId}
              onChange={(e) => {
                generation.current += 1;
                setCustomerId(e.target.value);
                setCases([]);
                setSelectedCase(null);
                setSearched(false);
                setError('');
                setLoading(false);
              }}
              placeholder={
                initialCustomerId ? `Customer ${initialCustomerId.slice(0, 8)}…` : 'Customer UUID'
              }
            />
          </label>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Loading…' : 'Search FRAUD cases'}
          </Button>
        </form>
        {initialCustomerId && (
          <p className="compliance-workspace__hint">Customer context carried from Customer 360°.</p>
        )}
      </section>
      <section className="compliance-workspace__panel" aria-labelledby="fraud-results-heading">
        <div className="compliance-workspace__heading">
          <div>
            <p className="compliance-workspace__eyebrow">AUTHORIZED RECORDS</p>
            <h2 id="fraud-results-heading">Fraud cases</h2>
            <p>Only FRAUD-category cases in the returned results are shown.</p>
          </div>
          {searched && !error && (
            <span className="compliance-workspace__count">{cases.length} shown</span>
          )}
        </div>
        {error && (
          <div
            className="compliance-workspace__state compliance-workspace__state--error"
            role="alert"
          >
            {error}
          </div>
        )}
        {loading && (
          <div className="compliance-workspace__state" role="status">
            Loading fraud cases…
          </div>
        )}
        {!loading && !searched && !error && (
          <div className="compliance-workspace__state">Search for a customer to view records.</div>
        )}
        {!loading && !error && cases.length > 0 ? (
          <ScrollRegion label="Fraud cases" hint="Scroll horizontally to see all columns.">
            <table className="compliance-workspace__table">
              <thead>
                <tr>
                  <th scope="col">Case number</th>
                  <th scope="col">Status</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.caseNumber}</code>
                    </td>
                    <td>
                      <span className="compliance-workspace__badge">{c.status}</span>
                    </td>
                    <td>{c.severity}</td>
                    <td>
                      {c.openedAt && Number.isFinite(Date.parse(c.openedAt))
                        ? new Date(c.openedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="compliance-case-detail"
                        aria-label={`View case ${c.caseNumber}`}
                        onClick={() => setSelectedCase(c)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          !loading &&
          searched &&
          !error && (
            <div className="compliance-workspace__state">
              No FRAUD cases were returned for this customer.
            </div>
          )
        )}
      </section>
      {selectedCase && (
        <ComplianceCaseDrawer
          record={selectedCase}
          onClose={() => setSelectedCase(null)}
          canMutate={canMutate}
          principalId={principalId}
          onCaseUpdated={syncUpdatedCase}
          onNavigateToCustomer={onNavigateToCustomer}
          onNavigateToSupport={onNavigateToSupport}
        />
      )}
    </div>
  );
};
const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = {
  background: '#FFF7ED',
  border: '1px solid #FDBA74',
  color: '#92400E',
  padding: 12,
  borderRadius: 8,
  fontSize: 13,
};
const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
  gap: 10,
  marginBottom: 12,
};
const kpiCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  display: 'grid',
  gap: 2,
  fontSize: 12,
};
const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'flex-end',
  marginBottom: 12,
};
const inlineFilterLabel: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
};
const subPanelStyle: React.CSSProperties = {
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  padding: 12,
  background: '#F8FAFC',
};
