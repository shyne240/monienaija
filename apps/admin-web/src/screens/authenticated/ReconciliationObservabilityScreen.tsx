import './operational-surfaces.css';
import React, { useEffect, useRef, useState } from 'react';
import { PageHeader, ScrollRegion } from '../../design-system/primitives';
import { WorkspaceDrawer, WorkspaceFilterTabs } from '../../design-system/WorkspaceDrawer';
import './reconciliation-workspace.css';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { formatMinorUnits } from '../../utils/financial-display';

interface ReconciliationCheck {
  name: string;
  status: 'PASS' | 'WARNING' | 'ERROR';
  message: string;
  details: Record<string, string | number | boolean | null>;
}

interface BindingDiscrepancy {
  key: string;
  type: string;
  severity: 'WARNING' | 'ERROR';
  owner: string;
  recoveryState: string;
  bindingId?: string;
  customerId?: string;
  customerWalletId?: string;
  walletAccountId?: string;
  ledgerAccountId?: string;
  currency?: string;
  message: string;
}

interface ReconciliationReport {
  status: 'PASS' | 'WARNING' | 'ERROR';
  generatedAt: string;
  checks: ReconciliationCheck[];
  binding: {
    summary: {
      bindingsChecked: number;
      activeBindingsChecked: number;
      customerWalletsChecked: number;
      financialWalletsChecked: number;
      discrepancies: number;
      errors: number;
      warnings: number;
    };
    discrepancies: BindingDiscrepancy[];
  };
}

interface TrialBalanceDimension {
  currency: string;
  accountingUnit: string;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanced: boolean;
}

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  currency: string;
  accountingUnit: string;
  entryCount: number;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanceMinor: string;
}

interface TrialBalanceReport {
  generatedAt: string;
  balanced: boolean;
  dimensions: TrialBalanceDimension[];
  rows: TrialBalanceRow[];
}

interface AccountTypeTotal {
  accountType: 'ASSET' | 'LIABILITY';
  currency: string;
  accountingUnit: string;
  totalBalanceMinor: string;
}

interface JournalIntegrityReport {
  generatedAt: string;
  totalJournals: number;
  invalidJournals: number;
  totalLines: number;
  orphanLines: number;
  balanced: boolean;
}

interface AccountActivitySummary {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  currency: string;
  accountingUnit: string;
  entryCount: number;
  totalDebitsMinor: string;
  totalCreditsMinor: string;
  balanceMinor: string;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

interface FinanceVerificationReport {
  generatedAt: string;
  trialBalance: TrialBalanceReport;
  totalAssets: AccountTypeTotal[];
  totalLiabilities: AccountTypeTotal[];
  journalIntegrity: JournalIntegrityReport;
  balanceConservation: TrialBalanceDimension[];
  accountActivity: AccountActivitySummary[];
}

const minor = (value: unknown) => typeof value === 'string' && /^-?\d+$/.test(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isDimension = (row: any) => row && typeof row.currency === 'string' && typeof row.accountingUnit === 'string' && minor(row.totalDebitsMinor) && minor(row.totalCreditsMinor) && typeof row.balanced === 'boolean' && (row.balanced === (BigInt(row.totalDebitsMinor) === BigInt(row.totalCreditsMinor)));
const isAccountRow = (row: any) => row && count(row.entryCount) && typeof row.accountType === 'string' && typeof row.accountId === 'string' && typeof row.accountCode === 'string' && typeof row.accountName === 'string' && typeof row.currency === 'string' && typeof row.accountingUnit === 'string' && minor(row.totalDebitsMinor) && minor(row.totalCreditsMinor) && minor(row.balanceMinor);
const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validRun = (r: any) => r && ['PASS','WARNING','ERROR'].includes(r.status) && validDate(r.generatedAt) && Array.isArray(r.checks) && r.checks.length > 0 && r.checks.every((c: any) => c && typeof c.name === 'string' && ['PASS','WARNING','ERROR'].includes(c.status) && typeof c.message === 'string') && r.status === (r.checks.some((c: any) => c.status === 'ERROR') ? 'ERROR' : r.checks.some((c: any) => c.status === 'WARNING') ? 'WARNING' : 'PASS') && r.binding && count(r.binding.summary?.bindingsChecked) && count(r.binding.summary?.discrepancies) && count(r.binding.summary?.errors) && count(r.binding.summary?.warnings) && Array.isArray(r.binding.discrepancies) && r.binding.summary.discrepancies === r.binding.discrepancies.length && r.binding.discrepancies.every((d: any) => d && typeof d.key === 'string' && typeof d.type === 'string' && typeof d.message === 'string' && ['WARNING','ERROR'].includes(d.severity) && typeof d.owner === 'string') && r.binding.summary.errors === r.binding.discrepancies.filter((d: any) => d.severity === 'ERROR').length && r.binding.summary.warnings === r.binding.discrepancies.filter((d: any) => d.severity === 'WARNING').length && (r.status !== 'PASS' || r.binding.discrepancies.length === 0) && (r.status !== 'WARNING' || r.binding.summary.errors === 0);
const validTrial = (r: any) => r && validDate(r.generatedAt) && typeof r.balanced === 'boolean' && Array.isArray(r.dimensions) && r.dimensions.every(isDimension) && (r.balanced === r.dimensions.every((d: any) => d.balanced)) && Array.isArray(r.rows) && r.rows.every(isAccountRow);
const validFinance = (r: any) => r && validDate(r.generatedAt) && r.journalIntegrity && typeof r.journalIntegrity.balanced === 'boolean' && count(r.journalIntegrity.totalJournals) && count(r.journalIntegrity.invalidJournals) && count(r.journalIntegrity.orphanLines) && (!r.journalIntegrity.balanced || (r.journalIntegrity.invalidJournals === 0 && r.journalIntegrity.orphanLines === 0)) && [r.totalAssets, r.totalLiabilities].every(rows => Array.isArray(rows) && rows.every((row: any) => row && typeof row.currency === 'string' && typeof row.accountingUnit === 'string' && minor(row.totalBalanceMinor)));

export const ReconciliationObservabilityScreen: React.FC = () => {
  const { principal, sessionId } = useAuthStore();
  const canView = principal?.scopes.includes('reconciliation.view') ?? false;
  return <ReconciliationWorkspace key={JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal])} canView={canView} />;
};
const ReconciliationWorkspace: React.FC<{canView: boolean}> = ({canView}) => {
  const generations = useRef({run:0, trial:0, finance:0, activity:0});
  useEffect(() => () => { generations.current.run++; generations.current.trial++; generations.current.finance++; generations.current.activity++; }, []);
  const [activeTab, setActiveTab] = useState<'runs' | 'trial-balance' | 'finance'>('runs');
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const focusActivity = useRef(false);
  useEffect(() => { if (activeTab === 'finance' && focusActivity.current) { focusActivity.current = false; activityHeading.current?.focus(); } }, [activeTab]);

  // Reconciliation Runs State
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [selectedBreak, setSelectedBreak] = useState<BindingDiscrepancy | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');

  // Trial Balance State
  const [tbReport, setTbReport] = useState<TrialBalanceReport | null>(null);
  const [tbLoading, setTbLoading] = useState(false);
  const [tbError, setTbError] = useState('');

  // Finance Verification & Account Activity State
  const [financeReport, setFinanceReport] = useState<FinanceVerificationReport | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState('');
  const [accountActivityId, setAccountActivityId] = useState('');
  const [accountActivityRows, setAccountActivityRows] = useState<AccountActivitySummary[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');

  const handleRunReconciliation = async () => {
    if (!canView) return;
    const request = ++generations.current.run;
    setRunError('');
    setSelectedBreak(null);
    setReport(null);
    setRunLoading(true);

    try {
      // GET /internal/reconciliation/report (triggers dynamic PG matching runs)
      const res = await ApiClient.get<ReconciliationReport>('/internal/reconciliation/report');
      if (request !== generations.current.run) return;
      if (!validRun(res)) throw new Error('Reconciliation report returned an invalid response.');
      setReport(res);
    } catch (err: any) {
      if (request === generations.current.run) setRunError(err?.message || 'Reconciliation run failed.');
    } finally {
      if (request === generations.current.run) setRunLoading(false);
    }
  };

  const handleLoadTrialBalance = async () => {
    if (!canView) return;
    const request = ++generations.current.trial;
    setTbError('');
    setTbReport(null);
    setTbLoading(true);

    try {
      // GET /internal/reconciliation/trial-balance
      const res = await ApiClient.get<TrialBalanceReport>('/internal/reconciliation/trial-balance');
      if (request !== generations.current.trial) return;
      if (!validTrial(res)) throw new Error('Trial balance returned an invalid or inconsistent response.');
      setTbReport(res);
    } catch (err: any) {
      if (request === generations.current.trial) setTbError(err?.message || 'Trial balance query failed.');
    } finally {
      if (request === generations.current.trial) setTbLoading(false);
    }
  };

  const handleLoadFinanceVerification = async () => {
    if (!canView) return;
    const request = ++generations.current.finance;
    setFinanceError('');
    setFinanceLoading(true);
    try {
      const res = await ApiClient.get<FinanceVerificationReport>('/internal/reconciliation/finance');
      if (request !== generations.current.finance) return;
      if (!validFinance(res)) throw new Error('Finance verification returned an invalid or inconsistent response.');
      setFinanceReport(res);
    } catch (err: any) {
      if (request === generations.current.finance) setFinanceError(err?.message || 'Finance verification query failed.');
    } finally {
      if (request === generations.current.finance) setFinanceLoading(false);
    }
  };

  const handleInspectAccountActivity = async (targetAccountId?: string) => {
    if (!canView) return;
    const id = (targetAccountId ?? accountActivityId).trim();
    if (!id) {
      setActivityError('Ledger Account UUID is required.');
      return;
    }
    const request = ++generations.current.activity;
    setAccountActivityId(id);
    setActivityError('');
    setAccountActivityRows(null);
    setActivityLoading(true);
    try {
      const rows = await ApiClient.get<AccountActivitySummary[]>(
        `/internal/reconciliation/accounts/${encodeURIComponent(id)}/activity`,
      );
      if (!Array.isArray(rows) || rows.some(row => !isAccountRow(row) || row.accountId !== id || !count(row.entryCount))) throw new Error('Account activity returned an invalid or mismatched response.');
      if (request !== generations.current.activity) return;
      setAccountActivityRows(rows);
    } catch (err: any) {
      if (request === generations.current.activity) { setAccountActivityRows(null); setActivityError(err?.message || 'Account activity lookup failed.'); }
    } finally {
      if (request === generations.current.activity) setActivityLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="mn-operational" style={styles.container} role="alert">
        <div style={styles.errorBox}>This screen requires <code>reconciliation.view</code>.</div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-reconciliation" style={styles.container}>
      <PageHeader eyebrow="Finance and ledger" title="Independent Reconciliation & Breaks Desk" description="Review reported ledger balance conservation, trial balances and reconciliation breaks." />

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>Internal verification boundaries</span>
        <p style={styles.gapText}>
          These reports check internal ledger and wallet relationships. They do not compare external bank statements or establish settlement with an external provider.
        </p>
      </div>

      <WorkspaceFilterTabs label="Reconciliation workspaces" value={activeTab} options={[
        {value:'runs',label:'Run Verification Audits'}, {value:'trial-balance',label:'General Trial Balance'}, {value:'finance',label:'Finance Verification & Activity'},
      ]} onChange={value => {
        setSelectedBreak(null);
        if (value === 'runs') { setActiveTab('runs'); setRunError(''); }
        else if (value === 'trial-balance') { setActiveTab('trial-balance'); setTbError(''); void handleLoadTrialBalance(); }
        else if (value === 'finance') { setActiveTab('finance'); setFinanceError(''); void handleLoadFinanceVerification(); }
      }} />

      {activeTab === 'runs' ? (
        <div className="mn-reconciliation__workspace" style={styles.content}>
          <p className="mn-reconciliation__eyebrow">INTERNAL MATCHING</p>
          <h2>Verification checks</h2>
          <p>Generate a point-in-time report of internal checks and binding discrepancies.</p>
          <div style={styles.actionRow}>
            <button
              disabled={runLoading}
              onClick={handleRunReconciliation}
              style={styles.actionBtn}
            >
              {runLoading ? 'Running Verification...' : 'Execute In-House Reconciliation Match'}
            </button>
          </div>

          {runError && <div style={styles.errorBox} role="alert">{runError}</div>}

          {report && (
            <div style={styles.resultsGrid}>
              {/* Report Summary */}
              <div style={styles.summaryCard}>
                <h4 style={styles.cardTitle}>Run Result Summary</h4>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Status Outcome:</span>
                  <span style={report.status === 'PASS' ? styles.passStatus : styles.failStatus}>{report.status}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Audited At:</span>
                  <span style={styles.metaValue}>{new Date(report.generatedAt).toLocaleString()}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Bindings Checked:</span>
                  <span style={styles.metaValue}>{report.binding.summary.bindingsChecked}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Binding Discrepancies:</span>
                  <span style={report.binding.summary.discrepancies > 0 ? styles.discrepancyCount : styles.metaValue}>
                    {report.binding.summary.discrepancies}
                  </span>
                </div>
              </div>

              {/* Checks Checklist */}
              <div style={styles.checksCard}>
                <h4 style={styles.cardTitle}>System Postings Integrity Checks</h4>
                <div style={styles.checksList}>
                  {report.checks.map((c) => (
                    <div key={c.name} style={styles.checkItem}>
                      <div className="mn-reconciliation__check-header" style={styles.checkHeader}>
                        <span className="mn-reconciliation__check-name" style={styles.checkName}>{c.name}</span>
                        <span style={c.status === 'PASS' ? styles.passBadge : styles.failBadge}>{c.status}</span>
                      </div>
                      <p style={styles.checkMsg}>{c.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Binding Breaks / Discrepancies */}
              <div className="mn-reconciliation__breaks" style={styles.breaksCard}>
                <h4 style={styles.cardTitle}>Binding Breaks & Discrepancies</h4>
                {report.binding.discrepancies.length === 0 ? (
                  <p style={styles.emptyText}>No binding discrepancies were returned. This does not establish that the books are balanced; review the reported check statuses and trial balance.</p>
                ) : (
                  <ScrollRegion label="Binding discrepancies" hint="Scroll horizontally to see all discrepancy columns.">
                    <table className="mn-reconciliation__breaks-table"><thead><tr><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Message</th><th scope="col">Owner</th><th scope="col">Details</th></tr></thead><tbody>
                      {report.binding.discrepancies.map(d => <tr key={d.key}><td>{d.type}</td><td><span style={d.severity === 'ERROR' ? styles.errorBadge : styles.warnBadge}>{d.severity}</span></td><td>{d.message}</td><td>{d.owner}</td><td><button type="button" className="mn-reconciliation__detail-button" aria-label={`View discrepancy ${d.key}`} onClick={() => setSelectedBreak(d)}>View details</button></td></tr>)}
                    </tbody></table>
                  </ScrollRegion>
                )}
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'trial-balance' ? (
        <div className="mn-reconciliation__workspace" style={styles.content}>
          <p className="mn-reconciliation__eyebrow">LEDGER TOTALS</p><h2>Trial balance</h2>
          {tbError && <div style={styles.errorBox} role="alert">{tbError}</div>}

          {tbLoading ? (
            <p style={styles.loadingText}>Fetching Trial Balance...</p>
          ) : tbReport && (
            <div style={styles.tbContainer}>
              <div style={styles.tbSummary}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Trial Balance Integrity:</span>
                  <span style={tbReport.balanced ? styles.passStatus : styles.failStatus}>
                    {tbReport.balanced ? 'REPORTED BALANCED' : 'UNBALANCED DISCREPANCY'}
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Generated At:</span>
                  <span style={styles.metaValue}>{new Date(tbReport.generatedAt).toLocaleString()}</span>
                </div>
              </div>

              <p>Reported trial balance compares internal debit and credit totals; it is not external settlement confirmation.{tbReport.dimensions.length === 0 && ' No dimensions were returned, so this does not establish activity.'}</p>
              <h4 style={styles.sectionTitle}>Balance Conservation by Dimension</h4>
              <div style={styles.dimensionsGrid}>
                {tbReport.dimensions.map((dim) => (
                  <div key={`${dim.currency}:${dim.accountingUnit}`} style={styles.dimensionCard}>
                    <div style={styles.dimHeader}>
                      <span style={styles.dimName}>{dim.currency} / {dim.accountingUnit}</span>
                      <span style={dim.balanced ? styles.passBadge : styles.failBadge}>
                        {dim.balanced ? 'BALANCED' : 'BREAK'}
                      </span>
                    </div>
                    <div style={styles.metaRow}>
                      <span style={styles.metaLabel}>Total Debits:</span>
                      <span style={styles.metaValue}>{formatMinorUnits(dim.totalDebitsMinor, dim.currency)}</span>
                    </div>
                    <div style={styles.metaRow}>
                      <span style={styles.metaLabel}>Total Credits:</span>
                      <span style={styles.metaValue}>{formatMinorUnits(dim.totalCreditsMinor, dim.currency)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <h4 style={styles.sectionTitle}>Chart of Accounts Trial Balance</h4>
              <div style={styles.tableWrapper} role="region" aria-label="Financial report table" tabIndex={0}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thRow}>
                      <th style={styles.th}>Code</th>
                      <th style={styles.th}>Account Name</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Currency / accounting unit</th>
                      <th style={styles.th}>Total Debits</th>
                      <th style={styles.th}>Total Credits</th>
                      <th style={styles.th}>Closing Balance</th>
                      <th style={styles.th}>Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tbReport.rows.map((r) => (
                      <tr key={r.accountId} style={styles.tableRow}>
                        <td style={styles.tdCode}>{r.accountCode}</td>
                        <td style={styles.td}>{r.accountName}</td>
                        <td style={styles.td}>{r.accountType}</td>
                        <td style={styles.td}>{r.currency} / {r.accountingUnit}</td>
                        <td style={styles.td}>{formatMinorUnits(r.totalDebitsMinor, r.currency)}</td>
                        <td style={styles.td}>{formatMinorUnits(r.totalCreditsMinor, r.currency)}</td>
                        <td style={{ ...styles.td, fontWeight: 'bold', color: 'var(--mn-action-primary, #0b624a)' }}>
                          {formatMinorUnits(r.balanceMinor, r.currency)}
                        </td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            onClick={() => {
                              focusActivity.current = true;
                              setActiveTab('finance');
                              void handleLoadFinanceVerification();
                              void handleInspectAccountActivity(r.accountId);
                            }}
                            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFF', cursor: 'pointer', fontSize: 12 }}
                          >
                            Inspect activity
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mn-reconciliation__workspace" style={styles.content}>
          <p className="mn-reconciliation__eyebrow">FINANCE SIGNALS</p><h2>Finance verification and activity</h2>
          <div style={styles.actionRow}>
            <button
              disabled={financeLoading}
              onClick={() => void handleLoadFinanceVerification()}
              style={styles.actionBtn}
            >
              {financeLoading ? 'Loading Finance Verification...' : 'Refresh Finance Verification'}
            </button>
          </div>

          {financeError && <div style={styles.errorBox} role="alert">{financeError}{financeReport && ' Previous results are stale; the refresh failed.'}</div>}
          {financeLoading && financeReport && <p role="status">Refreshing; previous finance verification results may be stale.</p>}
          {financeReport && <p>Internal journal integrity and account totals are reported independently; they do not establish external settlement.</p>}
          {financeReport && <p>Report generated at: {new Date(financeReport.generatedAt).toLocaleString()}</p>}

          {financeReport && (
            <div style={styles.resultsGrid} data-testid="finance-verification-summary">
              <div style={styles.summaryCard}>
                <h4 style={styles.cardTitle}>Journal Integrity</h4>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Balanced:</span>
                  <span style={financeReport.journalIntegrity.balanced ? styles.passStatus : styles.failStatus}>
                    {financeReport.journalIntegrity.balanced ? 'BALANCED' : 'UNBALANCED'}
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Total Journals:</span>
                  <span style={styles.metaValue}>{financeReport.journalIntegrity.totalJournals}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Invalid Journals:</span>
                  <span style={styles.metaValue}>{financeReport.journalIntegrity.invalidJournals}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Orphan Lines:</span>
                  <span style={styles.metaValue}>{financeReport.journalIntegrity.orphanLines}</span>
                </div>
              </div>

              <div style={styles.summaryCard}>
                <h4 style={styles.cardTitle}>Assets vs Liabilities</h4>
                {financeReport.totalAssets.map((item) => (
                  <div className="mn-reconciliation__total" key={`asset:${item.currency}:${item.accountingUnit}`} style={styles.metaRow}>
                    <span style={styles.metaLabel}>ASSET ({item.currency}/{item.accountingUnit}):</span>
                    <span style={styles.metaValue}>{formatMinorUnits(item.totalBalanceMinor, item.currency)}</span>
                  </div>
                ))}
                {financeReport.totalLiabilities.map((item) => (
                  <div className="mn-reconciliation__total" key={`liab:${item.currency}:${item.accountingUnit}`} style={styles.metaRow}>
                    <span style={styles.metaLabel}>LIABILITY ({item.currency}/{item.accountingUnit}):</span>
                    <span style={styles.metaValue}>{formatMinorUnits(item.totalBalanceMinor, item.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...styles.summaryCard, marginTop: 20 }}>
            <h4 ref={activityHeading} tabIndex={-1} style={styles.cardTitle}>Account Activity Inspector</h4>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <input
                aria-label="Ledger Account UUID"
                disabled={activityLoading}
                placeholder="Ledger Account UUID"
                value={accountActivityId}
                onChange={(e) => {
                  generations.current.activity += 1;
                  setAccountActivityId(e.target.value);
                  setAccountActivityRows(null);
                  setActivityError('');
                }}
                style={{ flex: '1 1 260px', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
              />
              <button
                type="button"
                disabled={activityLoading || !accountActivityId.trim()}
                onClick={() => void handleInspectAccountActivity()}
                style={styles.actionBtn}
              >
                {activityLoading ? 'Loading Activity...' : 'Load Account Activity'}
              </button>
            </div>
            {activityError && <div style={styles.errorBox} role="alert">{activityError}</div>}
            {accountActivityRows && (
              accountActivityRows.length === 0 ? (
                <p style={styles.emptyText}>No ledger activity returned for this account.</p>
              ) : (
                <div style={styles.tableWrapper} role="region" aria-label="Financial report table" tabIndex={0}>
                  <table style={styles.table} data-testid="account-activity-table">
                    <thead>
                      <tr style={styles.thRow}>
                        <th style={styles.th}>Code</th>
                        <th style={styles.th}>Account</th>
                        <th style={styles.th}>Entries</th>
                        <th style={styles.th}>Currency / accounting unit</th>
                        <th style={styles.th}>Debits</th>
                        <th style={styles.th}>Credits</th>
                        <th style={styles.th}>Balance</th>
                        <th style={styles.th}>Last Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountActivityRows.map((row) => (
                        <tr key={row.accountId} style={styles.tableRow}>
                          <td style={styles.tdCode}>{row.accountCode}</td>
                          <td style={styles.td}>{row.accountName}</td>
                          <td style={styles.td}>{row.entryCount}</td>
                          <td style={styles.td}>{row.currency} / {row.accountingUnit}</td>
                          <td style={styles.td}>{formatMinorUnits(row.totalDebitsMinor, row.currency)}</td>
                          <td style={styles.td}>{formatMinorUnits(row.totalCreditsMinor, row.currency)}</td>
                          <td style={styles.td}>{formatMinorUnits(row.balanceMinor, row.currency)}</td>
                          <td style={styles.td}>{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      )}
      {selectedBreak && <WorkspaceDrawer label="Binding discrepancy details" className="mn-reconciliation__drawer" onDismiss={() => setSelectedBreak(null)}>
        <header className="mn-reconciliation__drawer-header"><div><p className="mn-reconciliation__eyebrow">INTERNAL VERIFICATION</p><h2>Binding discrepancy</h2></div><button type="button" className="mn-reconciliation__detail-button" onClick={() => setSelectedBreak(null)}>Close</button></header>
        <div className="mn-reconciliation__drawer-body"><p>This record is from the generated internal report; it is not external settlement confirmation.</p><dl>
          <dt>Type</dt><dd>{selectedBreak.type}</dd><dt>Severity</dt><dd>{selectedBreak.severity}</dd><dt>Message</dt><dd>{selectedBreak.message}</dd><dt>Owner</dt><dd>{selectedBreak.owner}</dd><dt>Binding</dt><dd>{typeof selectedBreak.bindingId === 'string' ? selectedBreak.bindingId : '—'}</dd><dt>Customer</dt><dd>{typeof selectedBreak.customerId === 'string' ? selectedBreak.customerId : '—'}</dd><dt>Wallet account</dt><dd>{typeof selectedBreak.walletAccountId === 'string' ? selectedBreak.walletAccountId : '—'}</dd><dt>Ledger account</dt><dd>{typeof selectedBreak.ledgerAccountId === 'string' ? selectedBreak.ledgerAccountId : '—'}</dd><dt>Recovery state</dt><dd>{typeof selectedBreak.recoveryState === 'string' ? selectedBreak.recoveryState : '—'}</dd>
        </dl></div>
      </WorkspaceDrawer>}
    </div>
  );
};

const styles = {
  container: {
    padding: 'clamp(16px, 3vw, 32px)',
    fontFamily: 'var(--mn-font-sans)',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
  },
  gapWarning: {
    backgroundColor: 'var(--mn-status-warning-bg, #fff3d9)',
    borderColor: 'var(--mn-status-warning, #8c5600)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '24px',
  },
  gapTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#78350F',
    display: 'block',
    marginBottom: '6px',
  },
  gapText: {
    fontSize: '12px',
    color: '#78350F',
    margin: 0,
    lineHeight: '18px',
  },
  tabHeader: {
    display: 'flex',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    marginBottom: '24px',
    maxWidth: '600px',
    flexWrap: 'wrap' as const,
  },
  tabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--mn-text-secondary, #52655f)',
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  activeTabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--mn-action-primary, #0b624a)',
    border: 'none',
    borderBottom: '2px solid var(--mn-action-primary, #0b624a)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  actionRow: {
    marginBottom: '20px',
  },
  actionBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  errorBox: {
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    color: 'var(--mn-status-danger, #b3261e)',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--mn-status-danger, #b3261e)',
  },
  successBox: {
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    color: 'var(--mn-status-success, #146348)',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--mn-status-success, #146348)',
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: '20px',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    alignSelf: 'flex-start' as const,
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 16px 0',
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    paddingBottom: '8px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    marginBottom: '10px',
  },
  metaLabel: {
    color: 'var(--mn-text-secondary, #52655f)',
    fontWeight: '500',
  },
  metaValue: {
    color: 'var(--mn-text-primary, #132b25)',
    fontWeight: '600',
  },
  passStatus: {
    color: 'var(--mn-status-success, #146348)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  failStatus: {
    color: 'var(--mn-status-danger, #b3261e)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  discrepancyCount: {
    color: 'var(--mn-status-warning, #8c5600)',
    fontWeight: 'bold',
  },
  checksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
  },
  checksList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  },
  checkItem: {
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    paddingBottom: '10px',
  },
  checkHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  checkName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
  },
  passBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: 'var(--mn-status-success, #146348)',
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  failBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: 'var(--mn-status-danger, #b3261e)',
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  checkMsg: {
    fontSize: '12px',
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
    lineHeight: '16px',
  },
  breaksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
  },
  breaksList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  },
  breakItem: {
    backgroundColor: '#FFF8E6',
    border: '1px solid #FFD166',
    borderRadius: '6px',
    padding: '12px',
  },
  breakHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  breakName: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#78350F',
  },
  errorBadge: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: 'var(--mn-status-danger, #b3261e)',
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  warnBadge: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: 'var(--mn-status-warning, #8c5600)',
    backgroundColor: 'var(--mn-status-warning-bg, #fff3d9)',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  breakMsg: {
    fontSize: '12px',
    color: '#78350F',
    margin: '0 0 8px 0',
    lineHeight: '16px',
  },
  breakMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#92400E',
    borderTop: '1px dashed #FFD166',
    paddingTop: '6px',
  },
  tbContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '24px',
  },
  content: {
    marginTop: '20px',
  },
  tbSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: '16px',
    marginBottom: '24px',
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '6px',
    padding: '16px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 16px 0',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    paddingBottom: '8px',
  },
  dimensionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: '16px',
    marginBottom: '28px',
  },
  dimensionCard: {
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '14px',
  },
  dimHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    paddingBottom: '6px',
  },
  dimName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
  },
  tableWrapper: {
    overflowX: 'auto' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  thRow: {
    borderBottom: '2px solid var(--mn-border-subtle, #dde7e2)',
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontWeight: '600',
  },
  tableRow: {
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
  },
  td: {
    padding: '12px 10px',
    color: 'var(--mn-text-primary, #132b25)',
  },
  tdCode: {
    padding: '12px 10px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontFamily: 'monospace',
  },
  loadingText: {
    fontSize: '13px',
    color: 'var(--mn-text-secondary, #52655f)',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--mn-text-muted, #5b6b66)',
    textAlign: 'center' as const,
  },
};
