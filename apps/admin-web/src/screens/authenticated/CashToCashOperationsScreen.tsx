import './operational-surfaces.css';
import './cash-to-cash-workspace.css';
import React, { useEffect, useRef, useState } from 'react';

import { PageHeader, ScrollRegion } from '../../design-system/primitives';
import { WorkspaceDrawer, WorkspaceFilterTabs } from '../../design-system/WorkspaceDrawer';
import { formatMinorUnits } from '../../utils/financial-display';
import { ApiClient } from '../../services/api-client';
import {
  fetchCashToCashExpiryStatus,
  type CashToCashExpiryStatusView,
} from '../../services/ordinary-agent-admin-api';
import { useAuthStore } from '../../store/auth-store';

interface CashToCashOperation {
  id: string;
  agentId: string;
  agentReference: string | null;
  beneficiaryPhoneMasked: string;
  principalMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
  currency: string;
  status: 'UNCLAIMED' | 'CLAIMED' | 'EXPIRED' | string;
  journalId: string;
  reference: string | null;
  claimantCustomerId: string | null;
  claimJournalId: string | null;
  claimReference: string | null;
  redemptionMethod: 'CUSTOMER_WALLET' | 'AGENT_CASH' | null;
  claimedAt: string | null;
  expiresAt: string;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CashToCashResponse {
  data: CashToCashOperation[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  status: string;
  agentId: string;
  transferId: string;
  reference: string;
}

const PAGE_SIZE = 20;
const EMPTY_FILTERS: Filters = { status: '', agentId: '', transferId: '', reference: '' };

function formatMinor(value: string, currency: string): string {
  if (!currency) return `${formatMinorUnits(value, '').trim()} (currency unavailable)`;
  if (currency !== 'NGN') return formatMinorUnits(value, currency);
  try {
    const minor = BigInt(value);
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const whole = (absolute / 100n).toLocaleString('en-NG');
    const fraction = String(absolute % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${currency} ${whole}.${fraction}`;
  } catch {
    return `${currency} ${value}`;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

interface LedgerJournalLineView {
  id: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
}

interface LedgerJournalView {
  id: string;
  status: string;
  currency: string;
  accountingUnit: string;
  reference?: string;
  description?: string;
  createdAt: string;
  lines: LedgerJournalLineView[];
}

const validTransfer = (row: any): boolean => row && typeof row.id === 'string' && typeof row.agentId === 'string' && typeof row.beneficiaryPhoneMasked === 'string' && typeof row.currency === 'string' && typeof row.status === 'string' && ['principalMinor', 'feeMinor', 'vatMinor', 'totalMinor'].every(key => typeof row[key] === 'string' && /^\d+$/.test(row[key]));
export const CashToCashOperationsScreen: React.FC = () => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <CashToCashWorkspace key={key} />;
};
const CashToCashWorkspace: React.FC = () => {
  const { principal } = useAuthStore();
  const expiryRequest = useRef(0);
  useEffect(() => () => { expiryRequest.current++; }, []);
  const canView = Boolean(principal && ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type) && principal.scopes.includes('transaction.view'));
  const canViewLedger = principal?.scopes.includes('ledger.view') ?? false;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchRevision, setSearchRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CashToCashResponse | null>(null);
  const [selected, setSelected] = useState<CashToCashOperation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inspectedJournal, setInspectedJournal] = useState<LedgerJournalView | null>(null);
  const [inspectedJournalLabel, setInspectedJournalLabel] = useState('');
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState('');
  const receiptTitle = useRef<HTMLHeadingElement>(null);
  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  const receiptFocusPending = useRef(false);
  const restoreReceiptFocus = useRef(false);
  useEffect(() => {
    if (selected && !loading && receiptFocusPending.current) { receiptFocusPending.current = false; receiptTitle.current?.focus(); }
    if (!selected && restoreReceiptFocus.current) { restoreReceiptFocus.current = false; receiptTrigger.current?.focus(); }
  }, [selected, loading]);

  // Read-only Cash-to-Cash expiry worker & backlog status (Arena 1 integration boundary)
  const [expiryStatus, setExpiryStatus] = useState<CashToCashExpiryStatusView | null>(null);
  const [expiryBoundaryMsg, setExpiryBoundaryMsg] = useState('');
  const [expiryError, setExpiryError] = useState('');
  const [expiryLoading, setExpiryLoading] = useState(false);

  const loadExpiryStatus = async () => {
    if (!canView || expiryLoading) return;
    const request = ++expiryRequest.current;
    setExpiryStatus(null);
    setExpiryLoading(true);
    setExpiryError('');
    setExpiryBoundaryMsg('');
    try {
      const outcome = await fetchCashToCashExpiryStatus();
      if (request !== expiryRequest.current) return;
      if (outcome.status === 'BLOCKED') {
        setExpiryStatus(null);
        setExpiryBoundaryMsg(outcome.message);
      } else if (outcome.data.recognized) {
        setExpiryStatus(outcome.data);
      } else {
        setExpiryStatus(null);
        setExpiryError('Expiry status could not be confirmed from the response.');
      }
    } catch (err) {
      if (request !== expiryRequest.current) return;
      setExpiryStatus(null);
      setExpiryError(
        err instanceof Error ? err.message : 'Unable to load Cash-to-Cash expiry status.',
      );
    } finally {
      if (request === expiryRequest.current) setExpiryLoading(false);
    }
  };

  const listRequest = useRef(0);

  const load = async (targetPage: number, selectedFilters: Filters) => {
    if (!canView) return;
    const request = ++listRequest.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE) });
      Object.entries(selectedFilters).forEach(([key, value]) => {
        if (value.trim()) query.set(key, value.trim());
      });
      const response = await ApiClient.get<CashToCashResponse>(
        `/internal/admin/cash-to-cash/transfers?${query.toString()}`,
      );
      if (request !== listRequest.current) return;
      if (!Array.isArray(response?.data) || !response.data.every(validTransfer) || !Number.isSafeInteger(response.total) || response.total < 0 || response.page !== targetPage || !Number.isSafeInteger(response.limit) || response.limit !== PAGE_SIZE || response.data.length > response.limit || !Number.isSafeInteger(response.totalPages) || response.totalPages !== Math.ceil(response.total / response.limit) || response.data.some(row => (selectedFilters.status && row.status !== selectedFilters.status.trim().toUpperCase()) || (selectedFilters.agentId.trim() && row.agentId !== selectedFilters.agentId.trim()) || (selectedFilters.transferId.trim() && row.id !== selectedFilters.transferId.trim()) || (selectedFilters.reference.trim() && row.reference !== selectedFilters.reference.trim()))) throw new Error('Cash-to-Cash list returned an invalid or mismatched response.');
      setResult(response);
      setSelected((current) => response.data.find((item) => item.id === current?.id) ?? null);
    } catch (loadError) {
      if (request !== listRequest.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Cash-to-Cash operations.');
      setResult(null);
      setSelected(null);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) void load(page, appliedFilters);
    return () => { listRequest.current += 1; };
  }, [canView, page, searchRevision]);

  useEffect(() => {
    if (canView) void loadExpiryStatus();
  }, [canView]);

  const journalRequest = useRef(0);
  const journalContext = useRef({ selectedId: selected?.id, initiation: selected?.journalId, claim: selected?.claimJournalId, canViewLedger });
  journalContext.current = { selectedId: selected?.id, initiation: selected?.journalId, claim: selected?.claimJournalId, canViewLedger };
  useEffect(() => {
    setInspectedJournal(null);
    setInspectedJournalLabel('');
    setJournalError('');
    setJournalLoading(false);
    return () => { journalRequest.current += 1; };
  }, [selected?.id, selected?.journalId, selected?.claimJournalId, canViewLedger]);

  const inspectJournal = async (journalId: string, label: string) => {
    if (!canViewLedger || !journalId || journalLoading || !selected) return;
    const selectedId = selected.id;
    const initiation = selected.journalId;
    const claim = selected.claimJournalId;
    const request = ++journalRequest.current;
    const valid = () => request === journalRequest.current && journalContext.current.selectedId === selectedId && journalContext.current.initiation === initiation && journalContext.current.claim === claim && journalContext.current.canViewLedger;
    setInspectedJournal(null);
    setJournalLoading(true);
    setJournalError('');
    setInspectedJournalLabel(label);
    try {
      const journal = await ApiClient.get<LedgerJournalView>(
        `/ledger/journals/${encodeURIComponent(journalId)}`,
      );
      if (!valid()) return;
      if (!journal || journal.id !== journalId || typeof journal.currency !== 'string' || typeof journal.status !== 'string' || !Array.isArray(journal.lines) || journal.lines.some(line => !line || typeof line.id !== 'string' || typeof line.accountId !== 'string' || typeof line.direction !== 'string' || typeof line.amountMinor !== 'string')) throw new Error('Ledger journal response is invalid or does not match the requested journal.');
      setInspectedJournal(journal);
    } catch (err) {
      if (!valid()) return;
      setInspectedJournal(null);
      setJournalError(err instanceof Error ? err.message : 'Unable to load ledger journal.');
    } finally {
      if (valid()) setJournalLoading(false);
    }
  };

  const changeFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    listRequest.current++;
    setResult(null);
    setSelected(null);
    setAppliedFilters({ ...filters });
    setPage(1);
    setSearchRevision((current) => current + 1);
  };

  const resetFilters = () => {
    listRequest.current++;
    setResult(null);
    setSelected(null);
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setSearchRevision((current) => current + 1);
  };

  const statusStyle = (status: string): React.CSSProperties => ({
    ...styles.status,
    ...(status === 'CLAIMED' ? styles.claimed : status === 'EXPIRED' ? styles.expired : styles.unclaimed),
  });

  if (!canView) {
    return (
      <div className="mn-operational" style={styles.wrap} role="alert">
        <div style={styles.error}>
          Cash-to-Cash operations require <code>transaction.view</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-c2c" style={styles.wrap}>
      <PageHeader eyebrow="Money movement" title="Cash-to-Cash Operations" description="Paginated, read-only investigation and receipt references for Agent V1 transfers." actions={<div className="mn-c2c__actions">
          <button type="button" style={styles.button} onClick={() => void loadExpiryStatus()} disabled={expiryLoading}>{expiryLoading ? 'Checking expiry…' : 'Refresh expiry status'}</button>
          <button type="button" style={styles.button} onClick={() => void load(page, appliedFilters)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>} />
      <div style={styles.notice} role="note">
        This surface does not reveal transfer codes or internal idempotency/fingerprint data and cannot claim, refund, release, or manually expire a transfer. Cash handover and unresolved KYC/expiry policies remain separate operational decisions.
      </div>

      {(expiryStatus || expiryBoundaryMsg || expiryError) && (
        <section style={styles.expiryPanel} aria-label="Cash-to-Cash expiry status">
          <div style={styles.detailHeader}>
            <strong style={{ fontSize: 13, color: 'var(--mn-nav-surface-deep, #082f23)' }}>
              Expiry Worker &amp; Unclaimed Backlog Status (Read-Only)
            </strong>
          </div>
          {expiryBoundaryMsg && (
            <div
              style={styles.boundaryNote}
              role="note"
              data-testid="c2c-expiry-arena1-boundary"
            >
              <strong>Cross-Arena Integration Boundary:</strong> {expiryBoundaryMsg}
            </div>
          )}
          {expiryError && (
            <div style={{ ...styles.error, marginTop: 8, marginBottom: 0 }} role="alert">
              {expiryError}
            </div>
          )}
          {expiryStatus && (
            <div style={styles.expiryMetrics} data-testid="c2c-expiry-live-status">
              {expiryStatus.workerEnabled !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Expiry worker</span>
                  <span
                    style={
                      expiryStatus.workerEnabled
                        ? { ...styles.status, ...styles.claimed }
                        : { ...styles.status, ...styles.unclaimed }
                    }
                  >
                    {expiryStatus.workerEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              )}
              {expiryStatus.dueUnclaimedCount !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Overdue unclaimed backlog</span>
                  <strong style={styles.metricValue}>{expiryStatus.dueUnclaimedCount}</strong>
                </div>
              )}
              {expiryStatus.totalUnclaimedCount !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Total unclaimed</span>
                  <strong style={styles.metricValue}>{expiryStatus.totalUnclaimedCount}</strong>
                </div>
              )}
              {expiryStatus.expiredTotalCount !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Total expired</span>
                  <strong style={styles.metricValue}>{expiryStatus.expiredTotalCount}</strong>
                </div>
              )}
              {expiryStatus.oldestDueExpiresAt !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Oldest due deadline</span>
                  <strong style={styles.metricValue}>
                    {formatDate(expiryStatus.oldestDueExpiresAt)}
                  </strong>
                </div>
              )}
              {expiryStatus.lastSweepAt !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Last worker sweep</span>
                  <strong style={styles.metricValue}>{formatDate(expiryStatus.lastSweepAt)}</strong>
                </div>
              )}
              {expiryStatus.batchSize !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Batch size</span>
                  <strong style={styles.metricValue}>{expiryStatus.batchSize}</strong>
                </div>
              )}
              {expiryStatus.pollIntervalMs !== undefined && (
                <div style={styles.metricTile}>
                  <span style={styles.metricLabel}>Poll interval</span>
                  <strong style={styles.metricValue}>{expiryStatus.pollIntervalMs} ms</strong>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mn-c2c__investigation" aria-label="Transfer investigation">
      <header className="mn-c2c__section-header"><div><p>TRANSFER INVESTIGATION</p><h2>Find a transfer</h2><span>Search exact references or IDs, then inspect the recorded receipt and journal links.</span></div></header>
      <WorkspaceFilterTabs label="Draft transfer status" value={filters.status} disabled={loading} options={[
        {value:'',label:'All transfers'}, {value:'UNCLAIMED',label:'Unclaimed'}, {value:'CLAIMED',label:'Claimed'}, {value:'EXPIRED',label:'Expired'},
      ]} onChange={value => changeFilter('status', value)} />
      <form onSubmit={search} style={styles.filters} aria-label="Cash-to-Cash filters">
        <label style={styles.label}>
          Agent UUID
          <input
            aria-label="Agent UUID"
            style={styles.input}
            value={filters.agentId}
            onChange={(event) => changeFilter('agentId', event.target.value)}
            placeholder="Filter by Agent"
          />
        </label>
        <label style={styles.label}>
          Transfer UUID
          <input
            aria-label="Transfer UUID"
            style={styles.input}
            value={filters.transferId}
            onChange={(event) => changeFilter('transferId', event.target.value)}
            placeholder="Exact transfer ID"
          />
        </label>
        <label style={styles.label}>
          Reference
          <input
            aria-label="Reference"
            style={styles.input}
            value={filters.reference}
            onChange={(event) => changeFilter('reference', event.target.value)}
            placeholder="Exact reference"
          />
        </label>
        <button type="submit" style={styles.primaryButton} disabled={loading}>
          Search
        </button>
        <button type="button" style={styles.button} disabled={loading} onClick={resetFilters}>
          Reset
        </button>
      </form>

      <p className="mn-c2c__hint">Filter edits are applied when you select Search.</p>
      <p className="mn-c2c__applied">Applied: {Object.entries(appliedFilters).filter(([, value]) => value.trim()).map(([key, value]) => `${key}: ${value.trim()}`).join(' · ') || 'All transfers'}</p>
      {error && (
        <div style={styles.error} role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div style={styles.empty}>Loading transfers…</div>
      ) : error ? null : !result ? (
        <div style={styles.empty}>Loading transfers…</div>
      ) : result.data.length ? (
        <div style={styles.tableWrap} role="region" aria-label="Cash-to-cash transfers" tabIndex={0}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Created</th>
                <th>Transfer / Agent</th>
                <th>Beneficiary</th>
                <th>Status</th>
                <th>Principal</th>
                <th>Redemption</th>
                <th>Expires / claimed</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <code>{item.id}</code>
                    <br />
                    <span>{item.agentReference || item.agentId}</span>
                  </td>
                  <td>{item.beneficiaryPhoneMasked}</td>
                  <td>
                    <span style={statusStyle(item.status)}>{item.status}</span>
                  </td>
                  <td>{formatMinor(item.principalMinor, item.currency)}</td>
                  <td>{item.redemptionMethod ?? '—'}</td>
                  <td>
                    {formatDate(item.expiresAt)}
                    <br />
                    {formatDate(item.claimedAt)}
                  </td>
                  <td>
                    <button
                      type="button"
                      style={styles.smallButton}
                      onClick={(event) => { receiptTrigger.current = event.currentTarget; if (selected === item) receiptTitle.current?.focus(); else { receiptFocusPending.current = true; setSelected(item); } }}
                    >
                      Inspect receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={styles.empty}>
          {loading ? 'Loading transfers…' : 'No Cash-to-Cash transfers match these filters.'}
        </div>
      )}

      {!loading && !error && result && <footer style={styles.pager}>
        <span>
          {result?.total ?? 0} transfer{result?.total === 1 ? '' : 's'} · Page {result?.page ?? page}
          {result?.totalPages ? ` of ${result.totalPages}` : ''}
        </span>
        <button
          type="button"
          style={styles.button}
          disabled={loading || page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          style={styles.button}
          disabled={loading || !result || page >= result.totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </button>
      </footer>}

      </section>
      {selected && !loading && (
        <WorkspaceDrawer label="Cash-to-Cash receipt details" onDismiss={() => { restoreReceiptFocus.current = true; setSelected(null); }}>
        <div className="mn-c2c__receipt" style={styles.detail}>
          <div className="mn-c2c__receipt-header" style={styles.detailHeader}>
            <h3 ref={receiptTitle} tabIndex={-1} style={styles.detailTitle}>Transfer receipt and ledger references</h3>
            <button type="button" style={styles.button} onClick={() => { restoreReceiptFocus.current = true; setSelected(null); }}>
              Close
            </button>
          </div>
          <dl style={styles.details}>
            <div>
              <dt>Transfer ID</dt>
              <dd>
                <code>{selected.id}</code>
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{selected.status}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>
                {selected.agentReference || selected.agentId} · <code>{selected.agentId}</code>
              </dd>
            </div>
            <div>
              <dt>Beneficiary</dt>
              <dd>{selected.beneficiaryPhoneMasked} (masked)</dd>
            </div>
            <div>
              <dt>Principal / fee / VAT / total</dt>
              <dd>
                {formatMinor(selected.principalMinor, selected.currency)} /{' '}
                {formatMinor(selected.feeMinor, selected.currency)} /{' '}
                {formatMinor(selected.vatMinor, selected.currency)} /{' '}
                {formatMinor(selected.totalMinor, selected.currency)}
              </dd>
            </div>
            <div>
              <dt>Redemption method</dt>
              <dd>{selected.redemptionMethod ?? 'Not recorded / legacy'}</dd>
            </div>
            <div>
              <dt>Initiation journal</dt>
              <dd>
                <code>{selected.journalId}</code>
                {canViewLedger && (
                  <>
                    {' '}
                    <button
                      type="button"
                      style={styles.smallButton}
                      disabled={journalLoading}
                      onClick={() => void inspectJournal(selected.journalId, 'Initiation journal')}
                    >
                      Inspect initiation journal
                    </button>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Claim journal</dt>
              <dd>
                {selected.claimJournalId ? (
                  <>
                    <code>{selected.claimJournalId}</code>
                    {canViewLedger && (
                      <>
                        {' '}
                        <button
                          type="button"
                          style={styles.smallButton}
                          disabled={journalLoading}
                          onClick={() =>
                            void inspectJournal(selected.claimJournalId!, 'Claim journal')
                          }
                        >
                          Inspect claim journal
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Claimant customer</dt>
              <dd>{selected.claimantCustomerId ? <code>{selected.claimantCustomerId}</code> : '—'}</dd>
            </div>
            <div>
              <dt>Reference / claim reference</dt>
              <dd>
                {selected.reference || '—'} / {selected.claimReference || '—'}
              </dd>
            </div>
            <div>
              <dt>Created / claimed / expired</dt>
              <dd>
                {formatDate(selected.createdAt)} / {formatDate(selected.claimedAt)} /{' '}
                {formatDate(selected.expiredAt)}
              </dd>
            </div>
            <div>
              <dt>Expiry deadline</dt>
              <dd>{formatDate(selected.expiresAt)}</dd>
            </div>
          </dl>
          {canViewLedger && (journalLoading || journalError || inspectedJournal) && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                border: '1px solid var(--mn-border-subtle, #dde7e2)',
                borderRadius: 6,
                background: 'var(--mn-surface-canvas, #f5f8f6)',
              }}
              data-testid="c2c-inspected-journal"
            >
              {journalLoading && <div>Loading ledger journal…</div>}
              {journalError && (
                <div style={styles.error} role="alert">
                  {journalError}
                </div>
              )}
              {inspectedJournal &&
                (() => {
                  const validLines = inspectedJournal.lines.some((line) => line.direction === 'DEBIT') &&
                    inspectedJournal.lines.some((line) => line.direction === 'CREDIT') && inspectedJournal.lines.every((line) =>
                    (line.direction === 'DEBIT' || line.direction === 'CREDIT') && /^\d+$/.test(line.amountMinor));
                  const totalDebits = inspectedJournal.lines
                    .filter((l) => l.direction === 'DEBIT')
                    .reduce((acc, l) => acc + (/^\d+$/.test(l.amountMinor) ? BigInt(l.amountMinor) : 0n), 0n);
                  const totalCredits = inspectedJournal.lines
                    .filter((l) => l.direction === 'CREDIT')
                    .reduce((acc, l) => acc + (/^\d+$/.test(l.amountMinor) ? BigInt(l.amountMinor) : 0n), 0n);
                  const balanced = validLines && totalDebits === totalCredits;
                  return (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginBottom: 8,
                          fontSize: 12,
                        }}
                      >
                        <strong>
                          {inspectedJournalLabel}: <code>{inspectedJournal.id}</code>
                        </strong>
                        <span>
                          Status: <strong>{inspectedJournal.status}</strong> ·{' '}
                          <span style={!validLines ? styles.unknown : balanced ? styles.claimed : styles.expired}>
                            {!validLines ? 'BALANCE UNKNOWN' : balanced ? 'BALANCED' : 'UNBALANCED'}
                          </span>
                        </span>
                      </div>
                      <ScrollRegion label="Journal lines" hint="Scroll horizontally to see all columns."><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Direction</th>
                            <th style={{ textAlign: 'left' }}>Ledger Account</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectedJournal.lines.map((line) => (
                            <tr key={line.id}>
                              <td>
                                <strong>{line.direction}</strong>
                              </td>
                              <td>
                                <code>{line.accountId}</code>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {formatMinor(line.amountMinor, inspectedJournal.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></ScrollRegion>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
        </WorkspaceDrawer>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: 24, maxWidth: 1400, color: 'var(--mn-text-primary, #132b25)', fontFamily: 'var(--mn-font-sans)' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { margin: '0 0 6px', color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 22 },
  subtitle: { margin: 0, color: 'var(--mn-text-secondary, #52655f)', fontSize: 13 },
  notice: { margin: '18px 0', padding: 12, border: '1px solid #CBD5E1', borderRadius: 8, background: 'var(--mn-surface-canvas, #f5f8f6)', color: 'var(--mn-text-secondary, #52655f)', fontSize: 13, lineHeight: 1.5 },
  expiryPanel: { padding: 14, marginBottom: 14, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8 },
  boundaryNote: { marginTop: 8, padding: 10, border: '1px solid #FCD34D', borderRadius: 6, background: '#FFFBEB', color: '#78350F', fontSize: 12 },
  expiryMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10, marginTop: 10 },
  metricTile: { padding: 10, background: 'var(--mn-surface-canvas, #f5f8f6)', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  metricLabel: { fontSize: 11, color: 'var(--mn-text-secondary, #52655f)' },
  metricValue: { fontSize: 14, color: 'var(--mn-text-primary, #132b25)' },
  filters: { display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap', padding: 14, marginBottom: 14, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160, color: 'var(--mn-text-primary, #132b25)', fontSize: 12, fontWeight: 600 },
  input: { padding: '8px 9px', border: '1px solid #CBD5E1', borderRadius: 5, font: 'inherit', fontWeight: 400 },
  button: { padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', color: 'var(--mn-text-primary, #132b25)', cursor: 'pointer' },
  primaryButton: { padding: '8px 14px', border: '1px solid var(--mn-action-primary, #0b624a)', borderRadius: 5, background: 'var(--mn-action-primary, #0b624a)', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  smallButton: { padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' },
  error: { padding: 11, marginBottom: 12, border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#991B1B', fontSize: 13 },
  empty: { padding: 24, background: '#fff', border: '1px dashed #CBD5E1', borderRadius: 8, color: 'var(--mn-text-secondary, #52655f)', textAlign: 'center' },
  tableWrap: { overflowX: 'auto', background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8 },
  table: { width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 12 },
  status: { display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontWeight: 700, fontSize: 10 },
  claimed: { background: '#ECFDF5', color: '#065F46' },
  expired: { background: '#FEF2F2', color: '#991B1B' },
  unclaimed: { background: '#FFFBEB', color: '#92400E' },
  unknown: { background: 'var(--mn-surface-canvas, #f5f8f6)', color: 'var(--mn-text-secondary, #52655f)' },
  pager: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12, color: 'var(--mn-text-secondary, #52655f)', fontSize: 13 },
  detail: { padding: 24, background: '#fff' },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailTitle: { margin: 0, color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 16 },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12, marginTop: 14, alignItems: 'start' },
};
