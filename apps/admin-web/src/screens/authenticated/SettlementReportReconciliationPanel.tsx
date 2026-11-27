import './settlement-reconciliation.css';
import React, { useCallback, useEffect, useState } from 'react';
import { WorkspaceFilterTabs } from '../../design-system/WorkspaceDrawer';
import { useAuthStore } from '../../store/auth-store';
import { formatFinancialAmount } from '../../utils/financial-display';
import {
  SettlementReconciliationApi,
  type ImportPreviewResponse,
  type ReturnDisputeCaseDetail,
  type ReturnDisputeCaseItem,
  type SettlementBatchDetail,
  type SettlementBatchReconciliationItem,
  type SettlementImportDetail,
  type SettlementImportSummary,
  type SettlementReportType,
  type SettlementTransactionMatchItem,
  type StatementDestination,
  type WorkspaceOverviewResponse,
} from '../../services/settlement-reconciliation-api';

interface Props {
  initialInstitutionId?: string;
  onOpenJournal?: (journalId: string) => void;
}

type SubWorkflow = 'imports' | 'matches' | 'settlements' | 'returns' | 'formats';

const REPORT_TYPES: Array<{ value: SettlementReportType; label: string }> = [
  { value: 'COLLECTIONS', label: 'Collections (Inbound Bank → Wallet)' },
  { value: 'PAYOUTS', label: 'Payouts / Transfers (Outbound Wallet → Bank)' },
  { value: 'SETTLEMENTS', label: 'Settlements (Batch Settlement Reports)' },
  { value: 'WALLET_STATEMENT', label: 'Monnify Wallet Statement' },
  { value: 'BANK_STATEMENT', label: 'Commercial Bank Settlement Statement' },
  { value: 'REFUNDS_DISPUTES', label: 'Refunds, Reversals & Chargebacks' },
];

const TX_DECISIONS = [
  { value: 'SELECT_CANDIDATE', label: 'Select Unique Candidate (Ambiguous Match)' },
  { value: 'CONFIRM_TIMING_DIFFERENCE', label: 'Confirm Cutoff / Value-Date Timing Difference' },
  { value: 'CONFIRM_FEE_VARIANCE', label: 'Confirm Verified Provider Fee Variance' },
  { value: 'LINK_EXISTING_JOURNAL', label: 'Link Existing Ledger Journal Evidence' },
  { value: 'ESCALATE_MISSING_INTERNAL', label: 'Escalate Missing Internal Record' },
  { value: 'ESCALATE_MISSING_IN_PROVIDER', label: 'Escalate Missing Provider Report Entry' },
  { value: 'ESCALATE_STATUS_CONFLICT', label: 'Escalate Provider vs Internal Status Conflict' },
];

const SETTLEMENT_DECISIONS = [
  { value: 'CONFIRM_RECONCILED', label: 'Confirm Reconciled Settlement Batch' },
  { value: 'LINK_STATEMENT_ENTRY', label: 'Link Imported Statement Credit Row' },
  { value: 'CONFIRM_TIMING_IN_TRANSIT', label: 'Confirm Settlement In-Transit Timing Difference' },
  { value: 'ESCALATE_VARIANCE', label: 'Escalate Net / Fee Variance to Provider' },
];

const RETURN_DECISIONS = [
  { value: 'CONFIRM_RECONCILED', label: 'Confirm Return / Reversal Reconciled' },
  { value: 'AWAIT_PROVIDER_COMPLETION', label: 'Record Pending Provider Return Completion' },
  { value: 'LINK_REVERSAL_JOURNAL', label: 'Link Existing Reversal Ledger Journal' },
  { value: 'LINK_INTERNAL_DISPUTE', label: 'Link Internal Customer Dispute Record' },
  { value: 'ESCALATE_UNMATCHED_CHARGEBACK', label: 'Escalate Unmatched Chargeback / Lien' },
];

function fmtMoney(minor: string | null | undefined, currency = 'NGN'): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  if (!/^-?\d+$/.test(minor)) return minor;
  const neg = minor.startsWith('-');
  const abs = neg ? minor.slice(1) : minor;
  const formatted = formatFinancialAmount(abs, currency);
  return neg ? `-${formatted}` : formatted;
}

function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'MATCHED' || s === 'RECONCILED' || s === 'APPROVED' || s === 'VERIFIED_OFFICIAL_API_JSON') {
    return 'mn-sr__badge mn-sr__badge--ok';
  }
  if (
    s.includes('AWAITING') ||
    s.includes('UNMATCHED') ||
    s.includes('DATE_WINDOW') ||
    s === 'PROPOSED' ||
    s.includes('UNVERIFIED')
  ) {
    return 'mn-sr__badge mn-sr__badge--warn';
  }
  if (s === 'NONE') {
    return 'mn-sr__badge mn-sr__badge--neutral';
  }
  return 'mn-sr__badge mn-sr__badge--err';
}

export const SettlementReportReconciliationPanel: React.FC<Props> = ({
  initialInstitutionId,
  onOpenJournal,
}) => {
  const principal = useAuthStore((s) => s.principal);
  const canViewTransactionHistory = Boolean(principal?.scopes?.includes('transaction.view'));

  const [institutionId, setInstitutionId] = useState<string>(initialInstitutionId ?? '');
  const [subTab, setSubTab] = useState<SubWorkflow>('imports');

  const [overview, setOverview] = useState<WorkspaceOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Workflow 1: Import form & list
  const [providerKey, setProviderKey] = useState('MONNIFY');
  const [reportType, setReportType] = useState<SettlementReportType>('COLLECTIONS');
  const [statementDestination, setStatementDestination] =
    useState<StatementDestination>('UNSPECIFIED');
  const [fileName, setFileName] = useState('monnify-collections.json');
  const [reportContent, setReportContent] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [importNote, setImportNote] = useState('');
  const [previewResult, setPreviewResult] = useState<ImportPreviewResponse | null>(null);
  const [busyImport, setBusyImport] = useState(false);
  const [importsList, setImportsList] = useState<SettlementImportSummary[]>([]);
  const [selectedImport, setSelectedImport] = useState<SettlementImportDetail | null>(null);

  // Workflow 2: Transaction matches
  const [txStatusFilter, setTxStatusFilter] = useState<string>('');
  const [txSearch, setTxSearch] = useState('');
  const [txItems, setTxItems] = useState<SettlementTransactionMatchItem[]>([]);
  const [selectedTx, setSelectedTx] = useState<SettlementTransactionMatchItem | null>(null);
  const [txDecision, setTxDecision] = useState('CONFIRM_TIMING_DIFFERENCE');
  const [txCandidateId, setTxCandidateId] = useState('');
  const [txJournalId, setTxJournalId] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txReviewNote, setTxReviewNote] = useState('');

  // Workflow 3: Settlement batches
  const [batchStatusFilter, setBatchStatusFilter] = useState<string>('');
  const [batchSearch, setBatchSearch] = useState('');
  const [batchItems, setBatchItems] = useState<SettlementBatchReconciliationItem[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<SettlementBatchDetail | null>(null);
  const [batchDecision, setBatchDecision] = useState('CONFIRM_RECONCILED');
  const [batchStatementRowId, setBatchStatementRowId] = useState('');
  const [batchJournalId, setBatchJournalId] = useState('');
  const [batchComparisonId, setBatchComparisonId] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [batchReviewNote, setBatchReviewNote] = useState('');

  // Workflow 4: Return & dispute cases
  const [caseStatusFilter, setCaseStatusFilter] = useState<string>('');
  const [caseSearch, setCaseSearch] = useState('');
  const [caseItems, setCaseItems] = useState<ReturnDisputeCaseItem[]>([]);
  const [selectedCase, setSelectedCase] = useState<ReturnDisputeCaseDetail | null>(null);
  const [caseDecision, setCaseDecision] = useState('CONFIRM_RECONCILED');
  const [caseJournalId, setCaseJournalId] = useState('');
  const [caseDisputeId, setCaseDisputeId] = useState('');
  const [caseNote, setCaseNote] = useState('');
  const [caseReviewNote, setCaseReviewNote] = useState('');

  const [busyAction, setBusyAction] = useState(false);

  const loadOverviewAndActiveTab = useCallback(async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const ov = await SettlementReconciliationApi.overview({
        institutionId: institutionId || undefined,
      });
      setOverview(ov);
      if (
        !ov.capabilities.hasPlatformAuthority &&
        !institutionId &&
        ov.selectableInstitutions.length === 1
      ) {
        setInstitutionId(ov.selectableInstitutions[0]!.id);
      }

      const effectiveInst =
        institutionId ||
        (!ov.capabilities.hasPlatformAuthority && ov.selectableInstitutions.length === 1
          ? ov.selectableInstitutions[0]!.id
          : undefined);

      if (subTab === 'imports') {
        const list = await SettlementReconciliationApi.listImports({
          institutionId: effectiveInst,
        });
        setImportsList(list.items);
      } else if (subTab === 'matches') {
        const list = await SettlementReconciliationApi.listTransactionMatches({
          institutionId: effectiveInst,
          status: txStatusFilter || undefined,
          search: txSearch.trim() || undefined,
        });
        setTxItems(list.items);
      } else if (subTab === 'settlements') {
        const list = await SettlementReconciliationApi.listSettlementBatches({
          institutionId: effectiveInst,
          status: batchStatusFilter || undefined,
          search: batchSearch.trim() || undefined,
        });
        setBatchItems(list.items);
      } else if (subTab === 'returns') {
        const list = await SettlementReconciliationApi.listReturnDisputeCases({
          institutionId: effectiveInst,
          status: caseStatusFilter || undefined,
          search: caseSearch.trim() || undefined,
        });
        setCaseItems(list.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOverview(false);
    }
  }, [
    institutionId,
    subTab,
    txStatusFilter,
    txSearch,
    batchStatusFilter,
    batchSearch,
    caseStatusFilter,
    caseSearch,
  ]);

  useEffect(() => {
    void loadOverviewAndActiveTab();
  }, [loadOverviewAndActiveTab]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setReportContent(typeof reader.result === 'string' ? reader.result : '');
      setPreviewResult(null);
    };
    reader.readAsText(file);
  };

  const buildImportPayload = () => ({
    institutionId: institutionId || undefined,
    providerKey,
    reportType,
    fileName: fileName.trim() || 'report.json',
    content: reportContent,
    periodStart: periodStart ? new Date(periodStart).toISOString() : undefined,
    periodEnd: periodEnd ? new Date(periodEnd).toISOString() : undefined,
    statementDestination: statementDestination !== 'UNSPECIFIED' ? statementDestination : undefined,
    note: importNote.trim() || undefined,
  });

  const handlePreviewImport = async () => {
    setBusyImport(true);
    setError(null);
    setBannerMsg(null);
    try {
      const res = await SettlementReconciliationApi.previewImport(buildImportPayload());
      setPreviewResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyImport(false);
    }
  };

  const handleConfirmImport = async () => {
    setBusyImport(true);
    setError(null);
    setBannerMsg(null);
    try {
      const res = await SettlementReconciliationApi.importReport(buildImportPayload());
      setSelectedImport(res.importRecord);
      setPreviewResult(null);
      setBannerMsg(
        res.idempotentReplay
          ? `Idempotent replay: exact report SHA-256 was already imported (${res.importRecord.sourceFilename}). No duplicate rows or matches were created.`
          : `Imported ${res.importRecord.validRows} normalized row(s) from ${res.importRecord.sourceFilename}${
              res.priorImportDuplicateRowsSkipped > 0
                ? ` (${res.priorImportDuplicateRowsSkipped} overlapping prior row(s) skipped)`
                : ''
            }.`,
      );
      await loadOverviewAndActiveTab();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyImport(false);
    }
  };

  const canImportOrPropose = Boolean(
    overview?.capabilities.canImportAndPropose && overview?.capabilities.mfaVerified,
  );
  const canReview = Boolean(
    overview?.capabilities.canReview && overview?.capabilities.mfaVerified,
  );

  const renderJournalLinks = (ids: string[]) => {
    if (!ids.length) return <span>None recorded</span>;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ids.map((jid) =>
          onOpenJournal ? (
            <button
              key={jid}
              type="button"
              className="mn-sr__btn mn-sr__btn--secondary"
              style={{ padding: '3px 8px', fontSize: 11.5 }}
              onClick={() => onOpenJournal(jid)}
            >
              Open Journal {jid.slice(0, 8)}…
            </button>
          ) : (
            <code key={jid} className="mn-sr__mono">
              {jid}
            </code>
          ),
        )}
      </div>
    );
  };

  return (
    <div className="mn-sr" data-testid="settlement-report-reconciliation-panel">
      <div className="mn-sr__banner">
        <strong>Non-Posting Settlement Report & Statement Reconciliation</strong>
        <span>
          Imports external provider settlement reports and account statements, matches gross
          collections, provider deductions, merchant settlement net, MonieNaija platform charges,
          customer wallet credits, payouts, and returns/disputes, and records governed{' '}
          <code>FINANCE_PREPARER</code> → <code>FINANCE_CONTROLLER</code> review decisions. Nothing
          in this workspace posts journals or moves money.
        </span>
        {overview ? (
          <span>
            <strong>Session role posture:</strong>{' '}
            {overview.capabilities.canImportAndPropose
              ? 'Maker (FINANCE_PREPARER)'
              : overview.capabilities.canReview
                ? 'Checker (FINANCE_CONTROLLER)'
                : 'Read-only Finance Viewer'}{' '}
            · MFA: <strong>{overview.capabilities.mfaVerified ? 'VERIFIED' : 'REQUIRED FOR WRITES'}</strong>
          </span>
        ) : null}
      </div>

      {/* Scope Bar */}
      <div className="mn-sr__toolbar">
        <div className="mn-sr__toolbar-group">
          <label htmlFor="mn-sr-institution-select" style={{ fontSize: 13, fontWeight: 600 }}>
            Reconciliation Scope:
          </label>
          <select
            id="mn-sr-institution-select"
            data-testid="sr-institution-select"
            className="mn-sr__select"
            value={institutionId}
            onChange={(e) => {
              setInstitutionId(e.target.value);
              setSelectedImport(null);
              setSelectedTx(null);
              setSelectedBatch(null);
              setSelectedCase(null);
            }}
          >
            {overview?.capabilities.hasPlatformAuthority ? (
              <option value="">All Scopes / Platform Settlement</option>
            ) : (
              <option value="">Select Assigned Institution</option>
            )}
            {(overview?.selectableInstitutions ?? []).map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.code} — {inst.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mn-sr__btn mn-sr__btn--secondary"
            disabled={loadingOverview}
            onClick={() => void loadOverviewAndActiveTab()}
          >
            {loadingOverview ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <WorkspaceFilterTabs
          label="Settlement reconciliation workflows"
          value={subTab}
          options={[
            { value: 'imports', label: '1. Import & Validate' },
            { value: 'matches', label: '2. Transaction Matching' },
            { value: 'settlements', label: '3. Settlement & Statement' },
            { value: 'returns', label: '4. Returns & Disputes' },
            { value: 'formats', label: 'Format Verification Matrix' },
          ]}
          onChange={(val) => setSubTab(val as SubWorkflow)}
        />
      </div>

      {/* Summary KPIs */}
      {overview ? (
        <div className="mn-sr__kpis" data-testid="sr-summary-kpis">
          <div className="mn-sr__kpi">
            <div className="mn-sr__kpi-label">Imported Reports</div>
            <div className="mn-sr__kpi-value">{overview.summary.importsCount}</div>
            <div className="mn-sr__kpi-sub">
              {overview.summary.unverifiedFormatImportsCount} unverified CSV layout(s)
            </div>
          </div>
          <div
            className={`mn-sr__kpi${
              overview.summary.exceptionTransactionsCount > 0 ? ' mn-sr__kpi--alert' : ''
            }`}
          >
            <div className="mn-sr__kpi-label">Transaction Exceptions</div>
            <div className="mn-sr__kpi-value">{overview.summary.exceptionTransactionsCount}</div>
            <div className="mn-sr__kpi-sub">
              {overview.summary.matchedTransactionsCount} clean ·{' '}
              {overview.summary.pendingTransactionReviewsCount} awaiting checker
            </div>
          </div>
          <div
            className={`mn-sr__kpi${
              overview.summary.openSettlementBreaksCount > 0 ? ' mn-sr__kpi--alert' : ''
            }`}
          >
            <div className="mn-sr__kpi-label">Settlement Batch Breaks</div>
            <div className="mn-sr__kpi-value">{overview.summary.openSettlementBreaksCount}</div>
            <div className="mn-sr__kpi-sub">
              {overview.summary.reconciledSettlementsCount} reconciled ·{' '}
              {overview.summary.pendingSettlementReviewsCount} awaiting checker
            </div>
          </div>
          <div
            className={`mn-sr__kpi${
              overview.summary.openReturnDisputeCasesCount > 0 ? ' mn-sr__kpi--alert' : ''
            }`}
          >
            <div className="mn-sr__kpi-label">Open Return / Dispute Cases</div>
            <div className="mn-sr__kpi-value">{overview.summary.openReturnDisputeCasesCount}</div>
            <div className="mn-sr__kpi-sub">
              {overview.summary.reconciledReturnDisputeCasesCount} reconciled ·{' '}
              {overview.summary.pendingReturnDisputeReviewsCount} awaiting checker
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mn-sr__error" role="alert" data-testid="sr-error-banner">
          {error}
        </div>
      ) : null}
      {bannerMsg ? (
        <div className="mn-sr__success" role="status" data-testid="sr-success-banner">
          {bannerMsg}
        </div>
      ) : null}

      {/* WORKFLOW 1: IMPORT & VALIDATE */}
      {subTab === 'imports' ? (
        <div className="mn-sr__split">
          <div className="mn-sr__card">
            <h3>Import Provider Settlement Report or Statement</h3>
            <p style={{ fontSize: 12.5, color: '#475569', marginTop: 0 }}>
              Upload a CSV or JSON file (or paste payload below). Run dry-run validation first to
              inspect row counts, rejected lines, masked account numbers, and format verification
              status before persisting.
            </p>

            <div className="mn-sr__form-grid">
              <div className="mn-sr__field">
                <label htmlFor="sr-provider-key">Provider Adapter</label>
                <select
                  id="sr-provider-key"
                  data-testid="sr-provider-select"
                  className="mn-sr__select"
                  value={providerKey}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProviderKey(next);
                    if (next === 'COMMERCIAL_BANK_STATEMENT') setReportType('BANK_STATEMENT');
                    setPreviewResult(null);
                  }}
                >
                  <option value="MONNIFY">MONNIFY — Monnify Gateway</option>
                  <option value="COMMERCIAL_BANK_STATEMENT">
                    COMMERCIAL_BANK_STATEMENT — Corporate Bank Statement
                  </option>
                  <option value="NIBSS_NIP">NIBSS_NIP — NIBSS NIP (Planned Adapter)</option>
                </select>
              </div>

              <div className="mn-sr__field">
                <label htmlFor="sr-report-type">Report Type</label>
                <select
                  id="sr-report-type"
                  data-testid="sr-report-type-select"
                  className="mn-sr__select"
                  value={reportType}
                  onChange={(e) => {
                    setReportType(e.target.value as SettlementReportType);
                    setPreviewResult(null);
                  }}
                >
                  {REPORT_TYPES.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mn-sr__field">
                <label htmlFor="sr-destination">Settlement Destination Policy</label>
                <select
                  id="sr-destination"
                  className="mn-sr__select"
                  value={statementDestination}
                  onChange={(e) =>
                    setStatementDestination(e.target.value as StatementDestination)
                  }
                >
                  <option value="UNSPECIFIED">Unspecified / Auto-detect</option>
                  <option value="MONNIFY_WALLET">Monnify Disbursement Wallet</option>
                  <option value="BANK_ACCOUNT">Commercial Settlement Bank Account</option>
                </select>
              </div>

              <div className="mn-sr__field">
                <label htmlFor="sr-file-name">Source Filename</label>
                <input
                  id="sr-file-name"
                  data-testid="sr-file-name-input"
                  className="mn-sr__input"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                />
              </div>

              <div className="mn-sr__field">
                <label htmlFor="sr-period-start">Window Start (optional, detects missing in provider)</label>
                <input
                  id="sr-period-start"
                  type="datetime-local"
                  className="mn-sr__input"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>

              <div className="mn-sr__field">
                <label htmlFor="sr-period-end">Window End (optional)</label>
                <input
                  id="sr-period-end"
                  type="datetime-local"
                  className="mn-sr__input"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="mn-sr__field" style={{ marginBottom: 10 }}>
              <label htmlFor="sr-file-upload">Load CSV or JSON File</label>
              <input
                id="sr-file-upload"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={handleFileUpload}
              />
            </div>

            <div className="mn-sr__field" style={{ marginBottom: 10 }}>
              <label htmlFor="sr-content">Report Payload (CSV or JSON)</label>
              <textarea
                id="sr-content"
                data-testid="sr-report-content-textarea"
                className="mn-sr__textarea"
                placeholder='Paste official Monnify JSON responseBody/content[] or CSV export rows here...'
                value={reportContent}
                onChange={(e) => {
                  setReportContent(e.target.value);
                  setPreviewResult(null);
                }}
              />
            </div>

            <div className="mn-sr__field">
              <label htmlFor="sr-import-note">Importer Evidence Note (optional)</label>
              <input
                id="sr-import-note"
                className="mn-sr__input"
                placeholder="e.g. Monnify daily settlement export for 2026-11-26"
                value={importNote}
                onChange={(e) => setImportNote(e.target.value)}
              />
            </div>

            <div className="mn-sr__actions">
              <button
                type="button"
                data-testid="sr-preview-btn"
                className="mn-sr__btn mn-sr__btn--secondary"
                disabled={busyImport || !reportContent.trim()}
                onClick={() => void handlePreviewImport()}
              >
                {busyImport ? 'Validating…' : 'Preview & Validate (Dry Run)'}
              </button>
              <button
                type="button"
                data-testid="sr-import-btn"
                className="mn-sr__btn"
                disabled={busyImport || !reportContent.trim() || !canImportOrPropose}
                title={
                  canImportOrPropose
                    ? 'Persist report and run reconciliation matching'
                    : 'Requires FINANCE_PREPARER with an MFA-verified session'
                }
                onClick={() => void handleConfirmImport()}
              >
                {busyImport ? 'Importing…' : 'Confirm & Import Evidence'}
              </button>
              {!canImportOrPropose ? (
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Persisting imports requires <code>FINANCE_PREPARER</code> + MFA.
                </span>
              ) : null}
            </div>

            {previewResult ? (
              <div
                style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}
                data-testid="sr-preview-summary"
              >
                <h4>Dry-Run Validation Result</h4>
                {previewResult.verificationStatus === 'UNVERIFIED_MISSING_REDACTED_EXPORT' ? (
                  <div className="mn-sr__banner mn-sr__banner--warn" style={{ marginBottom: 10 }}>
                    <strong>UNVERIFIED EXPORT FORMAT</strong>
                    <span>{previewResult.verificationNote}</span>
                    {previewResult.missingSampleNeeded ? (
                      <span>
                        <strong>Missing sample needed:</strong> {previewResult.missingSampleNeeded}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mn-sr__banner" style={{ marginBottom: 10 }}>
                    <strong>VERIFIED OFFICIAL API JSON SCHEMA</strong>
                    <span>{previewResult.verificationNote}</span>
                  </div>
                )}

                {previewResult.alreadyImportedFileId ? (
                  <div className="mn-sr__banner mn-sr__banner--warn" style={{ marginBottom: 10 }}>
                    <strong>Duplicate File Detected (SHA-256 Match):</strong> This exact file was
                    already imported (ID <code>{previewResult.alreadyImportedFileId}</code>).
                    Re-submitting will replay idempotently with zero duplicate rows.
                  </div>
                ) : null}

                <div className="mn-sr__table-wrap">
                  <table className="mn-sr__table">
                    <tbody>
                      <tr>
                        <th>Total Rows</th>
                        <td>{previewResult.totalRows}</td>
                        <th>Valid Fresh Rows</th>
                        <td>{previewResult.validRowsCount}</td>
                        <th>Rejected / Skipped Rows</th>
                        <td>
                          {previewResult.rejectedRowsCount} (intra-file dupes:{' '}
                          {previewResult.intraFileDuplicateRowsCount}, prior-batch dupes:{' '}
                          {previewResult.priorImportDuplicateRowsCount})
                        </td>
                      </tr>
                      <tr>
                        <th>Gross Total</th>
                        <td>{fmtMoney(previewResult.grossTotalMinor, previewResult.currency)}</td>
                        <th>Provider Fee Total</th>
                        <td>
                          {fmtMoney(previewResult.providerFeeTotalMinor, previewResult.currency)}
                        </td>
                        <th>Merchant Settlement Total</th>
                        <td>{fmtMoney(previewResult.netTotalMinor, previewResult.currency)}</td>
                      </tr>
                      <tr>
                        <th>MonieNaija Fee Total</th>
                        <td>
                          {fmtMoney(
                            previewResult.internalPlatformFeeTotalMinor ?? '0',
                            previewResult.currency,
                          )}
                        </td>
                        <th>Customer Wallet Credit Total</th>
                        <td>
                          {fmtMoney(
                            previewResult.internalCustomerCreditTotalMinor ?? '0',
                            previewResult.currency,
                          )}
                        </td>
                        <th>Flagged for Finance Review</th>
                        <td data-testid="sr-preview-review-count">
                          {previewResult.financeReviewRowsCount ?? 0} row(s)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {previewResult.sampleValidRows.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <strong>
                      Preview Row Evaluation — Merchant Settlement vs Customer Wallet Credit (
                      {previewResult.sampleValidRows.length})
                    </strong>
                    <div className="mn-sr__table-wrap">
                      <table className="mn-sr__table" data-testid="sr-preview-rows-table">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Provider / Platform Ref</th>
                            <th className="num">Merchant Settlement</th>
                            <th className="num">MonieNaija Fee</th>
                            <th className="num">Customer Wallet Credit</th>
                            <th>Preview Match &amp; Review Flag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.sampleValidRows.map((pr) => (
                            <tr key={`prev-${pr.rowNumber}`}>
                              <td>{pr.rowNumber}</td>
                              <td className="mn-sr__mono">
                                {pr.providerTransactionReference ??
                                  pr.settlementReference ??
                                  pr.platformReference ??
                                  '—'}
                              </td>
                              <td className="num">
                                {fmtMoney(pr.netAmountMinor, previewResult.currency)}
                              </td>
                              <td className="num">
                                {pr.internalPlatformFeeMinor != null
                                  ? fmtMoney(pr.internalPlatformFeeMinor, previewResult.currency)
                                  : '—'}
                              </td>
                              <td className="num">
                                {pr.internalCustomerCreditMinor != null
                                  ? fmtMoney(pr.internalCustomerCreditMinor, previewResult.currency)
                                  : '—'}
                              </td>
                              <td>
                                {pr.predictedStatus ? (
                                  <span className={statusBadgeClass(pr.predictedStatus)}>
                                    {pr.predictedStatus}
                                  </span>
                                ) : null}{' '}
                                {pr.requiresFinanceReview ? (
                                  <span
                                    className="mn-sr__badge mn-sr__badge--warn"
                                    data-testid={`sr-preview-review-flag-${pr.rowNumber}`}
                                  >
                                    FINANCE_REVIEW_REQUIRED
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {previewResult.rejectedRows.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <strong>Rejected / Duplicate Rows ({previewResult.rejectedRows.length})</strong>
                    <div className="mn-sr__table-wrap">
                      <table className="mn-sr__table">
                        <thead>
                          <tr>
                            <th>Row #</th>
                            <th>Reason Code</th>
                            <th>Explanation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.rejectedRows.map((rej) => (
                            <tr key={`${rej.rowNumber}-${rej.reasonCode}`}>
                              <td>{rej.rowNumber}</td>
                              <td>
                                <code>{rej.reasonCode}</code>
                              </td>
                              <td>{rej.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mn-sr__card">
            <h3>Imported Batches ({importsList.length})</h3>
            {importsList.length === 0 ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                No settlement reports or statements have been imported in this scope yet.
              </p>
            ) : (
              <div className="mn-sr__table-wrap">
                <table className="mn-sr__table" data-testid="sr-imports-table">
                  <thead>
                    <tr>
                      <th>File & Type</th>
                      <th>Format Status</th>
                      <th className="num">Rows (Valid/Rej)</th>
                      <th className="num">Net Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importsList.map((imp) => (
                      <tr key={imp.id}>
                        <td>
                          <div>
                            <strong>{imp.sourceFilename}</strong>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#64748b' }}>
                            {imp.providerKey} · {imp.reportType} ({imp.fileFormat}) ·{' '}
                            {imp.institutionCode ?? 'PLATFORM'}
                          </div>
                        </td>
                        <td>
                          <span className={statusBadgeClass(imp.verificationStatus)}>
                            {imp.verificationStatus === 'VERIFIED_OFFICIAL_API_JSON'
                              ? 'VERIFIED JSON'
                              : 'UNVERIFIED EXPORT'}
                          </span>
                        </td>
                        <td className="num">
                          {imp.validRows} / {imp.rejectedRows}
                        </td>
                        <td className="num">{fmtMoney(imp.netTotalMinor, imp.currency)}</td>
                        <td>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--secondary"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={async () => {
                              const d = await SettlementReconciliationApi.getImportDetail(imp.id);
                              setSelectedImport(d);
                            }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedImport ? (
              <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <h4>
                  Import Detail: {selectedImport.sourceFilename} ({selectedImport.reportType})
                </h4>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                  SHA-256: <code className="mn-sr__mono">{selectedImport.contentSha256.slice(0, 20)}…</code>{' '}
                  · Imported by <code>{selectedImport.importedBy}</code> at{' '}
                  {fmtUtc(selectedImport.importedAt)}
                  {selectedImport.maskedStatementAccount ? (
                    <>
                      {' '}
                      · Masked Account: <code>{selectedImport.maskedStatementAccount}</code>
                    </>
                  ) : null}
                </div>
                <div className="mn-sr__table-wrap">
                  <table className="mn-sr__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Reference</th>
                        <th className="num">Gross</th>
                        <th className="num">Fee</th>
                        <th className="num">Net</th>
                        <th>Masked Acct</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedImport.rows.slice(0, 20).map((r) => (
                        <tr key={r.id}>
                          <td>{r.rowNumber}</td>
                          <td className="mn-sr__mono">
                            {r.providerTransactionReference ??
                              r.settlementReference ??
                              r.platformReference ??
                              '—'}
                          </td>
                          <td className="num">{fmtMoney(r.grossAmountMinor, r.currency)}</td>
                          <td className="num">{fmtMoney(r.providerFeeMinor, r.currency)}</td>
                          <td className="num">{fmtMoney(r.netAmountMinor, r.currency)}</td>
                          <td className="mn-sr__mono">
                            {r.maskedDestinationAccount ?? r.maskedCounterpartyAccount ?? '—'}
                          </td>
                          <td>{r.providerStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* WORKFLOW 2: TRANSACTION MATCHING */}
      {subTab === 'matches' ? (
        <div className="mn-sr__split">
          <div className="mn-sr__card">
            <div className="mn-sr__toolbar" style={{ marginBottom: 12 }}>
              <div className="mn-sr__toolbar-group">
                <select
                  aria-label="Filter transaction matches by status"
                  className="mn-sr__select"
                  value={txStatusFilter}
                  onChange={(e) => setTxStatusFilter(e.target.value)}
                >
                  <option value="">All Rows</option>
                  <option value="EXCEPTIONS_ONLY">All Unmatched / Exceptions</option>
                  <option value="PENDING_REVIEW">Pending Controller Review</option>
                  <option value="MATCHED">MATCHED</option>
                  <option value="MISSING_INTERNAL">MISSING_INTERNAL</option>
                  <option value="MISSING_IN_PROVIDER">MISSING_IN_PROVIDER</option>
                  <option value="AMOUNT_MISMATCH">AMOUNT_MISMATCH</option>
                  <option value="FEE_MISMATCH">FEE_MISMATCH</option>
                  <option value="STATUS_MISMATCH">STATUS_MISMATCH</option>
                  <option value="DATE_WINDOW_MISMATCH">DATE_WINDOW_MISMATCH</option>
                  <option value="DUPLICATE_PROVIDER_ROW">DUPLICATE_PROVIDER_ROW</option>
                  <option value="AMBIGUOUS_CANDIDATES">AMBIGUOUS_CANDIDATES</option>
                </select>
                <input
                  aria-label="Search transaction matches"
                  className="mn-sr__input"
                  placeholder="Search business/provider/NIP ref…"
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                />
              </div>
            </div>

            {txItems.length === 0 ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                No transaction match records match the current filter.
              </p>
            ) : (
              <div className="mn-sr__table-wrap">
                <table className="mn-sr__table" data-testid="sr-tx-matches-table">
                  <thead>
                    <tr>
                      <th>Provider / NIP Ref</th>
                      <th>Internal Ref</th>
                      <th className="num">Provider Gross / Fee / Net</th>
                      <th className="num">Internal Gross / Fee / Net</th>
                      <th>Status</th>
                      <th>Review</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txItems.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <div className="mn-sr__mono">
                            {m.providerReference ?? m.providerPlatformReference ?? '—'}
                          </div>
                          {m.nipSessionId ? (
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              NIP: <code>{m.nipSessionId}</code>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div className="mn-sr__mono">
                            {m.internalBusinessReference ?? m.internalProviderReference ?? '—'}
                          </div>
                          {m.internalPlatformFeeMinor && m.internalPlatformFeeMinor !== '0' ? (
                            <div style={{ fontSize: 11, color: '#475569' }}>
                              MonieNaija fee: {fmtMoney(m.internalPlatformFeeMinor, m.currency)} ·
                              Wallet credit: {fmtMoney(m.internalCustomerCreditMinor, m.currency)}
                            </div>
                          ) : null}
                        </td>
                        <td className="num">
                          <div>{fmtMoney(m.providerGrossMinor, m.currency)}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            fee {fmtMoney(m.providerFeeMinor, m.currency)} → net{' '}
                            {fmtMoney(m.providerNetMinor, m.currency)}
                          </div>
                        </td>
                        <td className="num">
                          <div>{fmtMoney(m.internalGrossMinor, m.currency)}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            fee {fmtMoney(m.internalProviderFeeMinor, m.currency)} → net{' '}
                            {fmtMoney(m.internalNetMinor, m.currency)}
                          </div>
                        </td>
                        <td>
                          <span className={statusBadgeClass(m.matchStatus)}>{m.matchStatus}</span>
                        </td>
                        <td>
                          <span className={statusBadgeClass(m.reviewState)}>{m.reviewState}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--secondary"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={() => {
                              setSelectedTx(m);
                              setTxDecision(
                                m.matchStatus === 'AMBIGUOUS_CANDIDATES'
                                  ? 'SELECT_CANDIDATE'
                                  : 'CONFIRM_TIMING_DIFFERENCE',
                              );
                              setTxCandidateId(m.ambiguousCandidates[0]?.sourceId ?? '');
                              setTxNote('');
                              setTxReviewNote('');
                            }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mn-sr__card" data-testid="sr-tx-detail-card">
            {!selectedTx ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                Select a transaction match row to inspect full evidence, Ledger Journal links,
                ambiguous candidates, or record a governed Maker-Checker resolution.
              </p>
            ) : (
              <>
                <h3>Transaction Match Evidence</h3>
                <p style={{ fontSize: 13 }}>{selectedTx.explanation}</p>
                <div style={{ fontSize: 12.5, display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div>
                    <strong>Match Status:</strong>{' '}
                    <span className={statusBadgeClass(selectedTx.matchStatus)}>
                      {selectedTx.matchStatus}
                    </span>{' '}
                    · <strong>Matched Keys:</strong>{' '}
                    {selectedTx.matchedKeys.length ? selectedTx.matchedKeys.join(', ') : 'None'}
                  </div>
                  <div>
                    <strong>Variance:</strong> {fmtMoney(selectedTx.varianceMinor, selectedTx.currency)}{' '}
                    · <strong>Provider Fee Variance:</strong>{' '}
                    {fmtMoney(selectedTx.feeVarianceMinor, selectedTx.currency)}
                  </div>
                  <div>
                    <strong>Provider Timestamp:</strong> {fmtUtc(selectedTx.providerOccurredAt)} (
                    {selectedTx.providerStatus ?? '—'}) · <strong>Internal Timestamp:</strong>{' '}
                    {fmtUtc(selectedTx.internalOccurredAt)} ({selectedTx.internalStatus ?? '—'})
                  </div>
                  <div>
                    <strong>Masked Account:</strong>{' '}
                    <code className="mn-sr__mono">{selectedTx.maskedAccount ?? '—'}</code>
                  </div>
                  <div>
                    <strong>Linked Ledger Journals:</strong>{' '}
                    {renderJournalLinks(
                      selectedTx.linkedJournalId
                        ? Array.from(
                            new Set([...selectedTx.internalJournalIds, selectedTx.linkedJournalId]),
                          )
                        : selectedTx.internalJournalIds,
                    )}
                  </div>
                  <div>
                    <strong>Unified Transaction History:</strong>{' '}
                    {selectedTx.internalTransactionHistoryPath ? (
                      canViewTransactionHistory ? (
                        <a href={selectedTx.internalTransactionHistoryPath}>
                          Open {selectedTx.internalTransactionHistoryPath}
                        </a>
                      ) : (
                        <span style={{ color: '#64748b' }}>
                          Available ({selectedTx.internalTransactionHistoryPath}), requires{' '}
                          <code>transaction.view</code>; use Ledger Journal link above.
                        </span>
                      )
                    ) : (
                      <span>No internal history record linked</span>
                    )}
                  </div>
                </div>

                {selectedTx.ambiguousCandidates.length > 0 ? (
                  <div style={{ marginBottom: 12 }}>
                    <strong>Ambiguous Internal Candidates ({selectedTx.ambiguousCandidates.length})</strong>
                    <div className="mn-sr__table-wrap">
                      <table className="mn-sr__table">
                        <thead>
                          <tr>
                            <th>Pick</th>
                            <th>Reference</th>
                            <th className="num">Gross / Net</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTx.ambiguousCandidates.map((cand) => (
                            <tr key={cand.sourceId}>
                              <td>
                                <input
                                  type="radio"
                                  name="tx-ambiguous-candidate"
                                  checked={txCandidateId === cand.sourceId}
                                  onChange={() => setTxCandidateId(cand.sourceId)}
                                />
                              </td>
                              <td className="mn-sr__mono">
                                {cand.businessReference ?? cand.providerReference ?? cand.sourceId}
                              </td>
                              <td className="num">
                                {fmtMoney(cand.grossAmountMinor, selectedTx.currency)} /{' '}
                                {fmtMoney(cand.netAmountMinor, selectedTx.currency)}
                              </td>
                              <td>{cand.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {selectedTx.reviewState !== 'NONE' ? (
                  <div className="mn-sr__banner" style={{ marginBottom: 12 }}>
                    <strong>Proposal ({selectedTx.reviewState}):</strong>{' '}
                    <code>{selectedTx.proposedDecision}</code> by <code>{selectedTx.proposedBy}</code>{' '}
                    — {selectedTx.proposedNote}
                    {selectedTx.reviewedBy ? (
                      <span>
                        Reviewed by <code>{selectedTx.reviewedBy}</code>:{' '}
                        {selectedTx.reviewNote}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {selectedTx.matchStatus !== 'MATCHED' && selectedTx.reviewState !== 'APPROVED' ? (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                    {canImportOrPropose ? (
                      <div style={{ marginBottom: 12 }}>
                        <h4>Maker Proposal (FINANCE_PREPARER)</h4>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="tx-decision-select">Proposed Disposition</label>
                          <select
                            id="tx-decision-select"
                            data-testid="sr-tx-decision-select"
                            className="mn-sr__select"
                            value={txDecision}
                            onChange={(e) => setTxDecision(e.target.value)}
                          >
                            {TX_DECISIONS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="tx-journal-id">Linked Ledger Journal UUID (optional)</label>
                          <input
                            id="tx-journal-id"
                            className="mn-sr__input"
                            placeholder="Optional posted ledger journal UUID"
                            value={txJournalId}
                            onChange={(e) => setTxJournalId(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__field">
                          <label htmlFor="tx-propose-note">Maker Explanation (min 5 chars)</label>
                          <input
                            id="tx-propose-note"
                            data-testid="sr-tx-propose-note"
                            className="mn-sr__input"
                            value={txNote}
                            onChange={(e) => setTxNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-tx-propose-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || txNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.proposeTransactionMatch(
                                    selectedTx.id,
                                    {
                                      decision: txDecision,
                                      selectedCandidateId:
                                        txDecision === 'SELECT_CANDIDATE'
                                          ? txCandidateId || undefined
                                          : undefined,
                                      linkedJournalId: txJournalId.trim() || undefined,
                                      note: txNote.trim(),
                                    },
                                  );
                                setSelectedTx(updated);
                                setBannerMsg('Transaction match resolution proposal recorded.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Submit Maker Proposal
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {canReview && selectedTx.reviewState === 'PROPOSED' ? (
                      <div>
                        <h4>Controller Review (FINANCE_CONTROLLER)</h4>
                        <div className="mn-sr__field">
                          <label htmlFor="tx-review-note">Controller Decision Note</label>
                          <input
                            id="tx-review-note"
                            data-testid="sr-tx-review-note"
                            className="mn-sr__input"
                            value={txReviewNote}
                            onChange={(e) => setTxReviewNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-tx-approve-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || txReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewTransactionMatch(
                                    selectedTx.id,
                                    { decision: 'APPROVE', note: txReviewNote.trim() },
                                  );
                                setSelectedTx(updated);
                                setBannerMsg('Transaction match resolution approved.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Approve Resolution
                          </button>
                          <button
                            type="button"
                            data-testid="sr-tx-reject-btn"
                            className="mn-sr__btn mn-sr__btn--danger"
                            disabled={busyAction || txReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewTransactionMatch(
                                    selectedTx.id,
                                    { decision: 'REJECT', note: txReviewNote.trim() },
                                  );
                                setSelectedTx(updated);
                                setBannerMsg('Transaction match resolution rejected.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Reject Proposal
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* WORKFLOW 3: SETTLEMENT-TO-COLLECTION & STATEMENT MATCHING */}
      {subTab === 'settlements' ? (
        <div className="mn-sr__split">
          <div className="mn-sr__card">
            <div className="mn-sr__toolbar" style={{ marginBottom: 12 }}>
              <div className="mn-sr__toolbar-group">
                <select
                  aria-label="Filter settlement batches"
                  className="mn-sr__select"
                  value={batchStatusFilter}
                  onChange={(e) => setBatchStatusFilter(e.target.value)}
                >
                  <option value="">All Settlement Batches</option>
                  <option value="OPEN_BREAKS">Open Settlement Breaks</option>
                  <option value="PENDING_REVIEW">Pending Controller Review</option>
                  <option value="RECONCILED">RECONCILED</option>
                  <option value="STATEMENT_UNMATCHED">STATEMENT_UNMATCHED</option>
                  <option value="MISSING_COLLECTION_DETAIL">MISSING_COLLECTION_DETAIL</option>
                  <option value="NET_AMOUNT_MISMATCH">NET_AMOUNT_MISMATCH</option>
                  <option value="FEE_MISMATCH">FEE_MISMATCH</option>
                  <option value="PAYOUT_FAILED_OR_PENDING">PAYOUT_FAILED_OR_PENDING</option>
                  <option value="AMBIGUOUS">AMBIGUOUS</option>
                </select>
                <input
                  aria-label="Search settlement reference"
                  className="mn-sr__input"
                  placeholder="Search settlementReference…"
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                />
              </div>
            </div>

            {batchItems.length === 0 ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                No settlement batches recorded yet. Import a Monnify Settlements report to reconcile
                gross collections, Monnify deductions, merchant settlement, platform charges,
                customer wallet credits, and statement credits.
              </p>
            ) : (
              <div className="mn-sr__table-wrap">
                <table className="mn-sr__table" data-testid="sr-settlement-batches-table">
                  <thead>
                    <tr>
                      <th>Settlement Ref & Dest</th>
                      <th className="num">Gross / Monnify Fee</th>
                      <th className="num">Expected Merchant Net</th>
                      <th className="num">Platform Fee / Wallet Credit</th>
                      <th className="num">Reported / Statement Credit</th>
                      <th>Status</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchItems.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <div className="mn-sr__mono">
                            <strong>{b.settlementReference}</strong>
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {b.statementDestination} · {b.maskedDestinationAccount ?? '—'} ·{' '}
                            {b.matchedCollectionCount} matched
                          </div>
                        </td>
                        <td className="num">
                          <div>{fmtMoney(b.grossCollectionsMinor, b.currency)}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            − {fmtMoney(b.providerFeeTotalMinor, b.currency)}
                          </div>
                        </td>
                        <td className="num">
                          {fmtMoney(b.expectedNetSettlementMinor, b.currency)}
                        </td>
                        <td className="num">
                          <div>{fmtMoney(b.platformFeeTotalMinor, b.currency)}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            credit {fmtMoney(b.customerWalletCreditTotalMinor, b.currency)}
                          </div>
                        </td>
                        <td className="num">
                          <div>{fmtMoney(b.reportedNetSettlementMinor, b.currency)}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            stmt: {fmtMoney(b.statementCreditMinor, b.currency)}
                          </div>
                        </td>
                        <td>
                          <span className={statusBadgeClass(b.batchStatus)}>{b.batchStatus}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--secondary"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={async () => {
                              const d = await SettlementReconciliationApi.getSettlementBatchDetail(
                                b.id,
                              );
                              setSelectedBatch(d);
                              setBatchNote('');
                              setBatchReviewNote('');
                            }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mn-sr__card" data-testid="sr-batch-detail-card">
            {!selectedBatch ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                Select a settlement batch to inspect collection breakdown, statement credit
                matching, and Maker-Checker sign-off.
              </p>
            ) : (
              <>
                <h3>Settlement Batch: {selectedBatch.settlementReference}</h3>
                <p style={{ fontSize: 13 }}>{selectedBatch.explanation}</p>
                <div style={{ fontSize: 12.5, display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div>
                    <strong>Gross Payer Collections:</strong>{' '}
                    {fmtMoney(selectedBatch.grossCollectionsMinor, selectedBatch.currency)}
                  </div>
                  <div>
                    <strong>Monnify Deduction:</strong>{' '}
                    {fmtMoney(selectedBatch.providerFeeTotalMinor, selectedBatch.currency)}
                  </div>
                  <div>
                    <strong>Expected Merchant Settlement (Gross − Monnify Fee):</strong>{' '}
                    <strong>
                      {fmtMoney(selectedBatch.expectedNetSettlementMinor, selectedBatch.currency)}
                    </strong>
                  </div>
                  <div>
                    <strong>MonieNaija Platform Charge (separate):</strong>{' '}
                    {fmtMoney(selectedBatch.platformFeeTotalMinor, selectedBatch.currency)} ·{' '}
                    <strong>Customer Wallet Credits:</strong>{' '}
                    {fmtMoney(selectedBatch.customerWalletCreditTotalMinor, selectedBatch.currency)}
                  </div>
                  <div>
                    <strong>Reported Settlement Net:</strong>{' '}
                    {fmtMoney(selectedBatch.reportedNetSettlementMinor, selectedBatch.currency)} ·{' '}
                    <strong>Statement Credit Arrived:</strong>{' '}
                    {fmtMoney(selectedBatch.statementCreditMinor, selectedBatch.currency)} ·{' '}
                    <strong>Variance:</strong>{' '}
                    {fmtMoney(selectedBatch.varianceMinor, selectedBatch.currency)}
                  </div>
                  {selectedBatch.linkedJournalId ? (
                    <div>
                      <strong>Linked Journal:</strong>{' '}
                      {renderJournalLinks([selectedBatch.linkedJournalId])}
                    </div>
                  ) : null}
                </div>

                {selectedBatch.reviewState !== 'NONE' ? (
                  <div className="mn-sr__banner" style={{ marginBottom: 12 }}>
                    <strong>Proposal ({selectedBatch.reviewState}):</strong>{' '}
                    <code>{selectedBatch.proposedDecision}</code> by{' '}
                    <code>{selectedBatch.proposedBy}</code> — {selectedBatch.proposedNote}
                    {selectedBatch.reviewedBy ? (
                      <span>
                        Reviewed by <code>{selectedBatch.reviewedBy}</code>:{' '}
                        {selectedBatch.reviewNote}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {selectedBatch.reviewState !== 'APPROVED' ? (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                    {canImportOrPropose ? (
                      <div style={{ marginBottom: 12 }}>
                        <h4>Maker Settlement Proposal (FINANCE_PREPARER)</h4>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="batch-decision">Decision</label>
                          <select
                            id="batch-decision"
                            className="mn-sr__select"
                            value={batchDecision}
                            onChange={(e) => setBatchDecision(e.target.value)}
                          >
                            {SETTLEMENT_DECISIONS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {batchDecision === 'LINK_STATEMENT_ENTRY' ? (
                          <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                            <label htmlFor="batch-stmt-row">Candidate Statement Credit Row</label>
                            <select
                              id="batch-stmt-row"
                              className="mn-sr__select"
                              value={batchStatementRowId}
                              onChange={(e) => setBatchStatementRowId(e.target.value)}
                            >
                              <option value="">Select imported statement credit row…</option>
                              {selectedBatch.candidateStatementCredits.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.reportType} · {fmtMoney(c.amountMinor, selectedBatch.currency)}{' '}
                                  · {c.settlementReference ?? c.reference ?? c.id.slice(0, 8)} (
                                  {c.maskedAccount ?? '—'})
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="batch-journal">Linked Ledger Journal UUID (optional)</label>
                          <input
                            id="batch-journal"
                            className="mn-sr__input"
                            value={batchJournalId}
                            onChange={(e) => setBatchJournalId(e.target.value)}
                          />
                        </div>

                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="batch-comp">
                            Linked Cutoff Bank Comparison UUID (optional)
                          </label>
                          <input
                            id="batch-comp"
                            className="mn-sr__input"
                            value={batchComparisonId}
                            onChange={(e) => setBatchComparisonId(e.target.value)}
                          />
                        </div>

                        <div className="mn-sr__field">
                          <label htmlFor="batch-note">Maker Note</label>
                          <input
                            id="batch-note"
                            data-testid="sr-batch-propose-note"
                            className="mn-sr__input"
                            value={batchNote}
                            onChange={(e) => setBatchNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-batch-propose-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || batchNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.proposeSettlementBatch(
                                    selectedBatch.id,
                                    {
                                      decision: batchDecision,
                                      linkedStatementRowId:
                                        batchDecision === 'LINK_STATEMENT_ENTRY'
                                          ? batchStatementRowId || undefined
                                          : undefined,
                                      linkedJournalId: batchJournalId.trim() || undefined,
                                      linkedComparisonId: batchComparisonId.trim() || undefined,
                                      note: batchNote.trim(),
                                    },
                                  );
                                setSelectedBatch(updated);
                                setBannerMsg('Settlement batch proposal recorded.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Submit Settlement Proposal
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {canReview && selectedBatch.reviewState === 'PROPOSED' ? (
                      <div>
                        <h4>Controller Review (FINANCE_CONTROLLER)</h4>
                        <div className="mn-sr__field">
                          <label htmlFor="batch-rev-note">Controller Note</label>
                          <input
                            id="batch-rev-note"
                            data-testid="sr-batch-review-note"
                            className="mn-sr__input"
                            value={batchReviewNote}
                            onChange={(e) => setBatchReviewNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-batch-approve-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || batchReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewSettlementBatch(
                                    selectedBatch.id,
                                    { decision: 'APPROVE', note: batchReviewNote.trim() },
                                  );
                                setSelectedBatch(updated);
                                setBannerMsg('Settlement batch resolution approved.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Approve Settlement Batch
                          </button>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--danger"
                            disabled={busyAction || batchReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewSettlementBatch(
                                    selectedBatch.id,
                                    { decision: 'REJECT', note: batchReviewNote.trim() },
                                  );
                                setSelectedBatch(updated);
                                setBannerMsg('Settlement batch proposal rejected.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* WORKFLOW 4: RETURNS, REVERSALS & DISPUTES */}
      {subTab === 'returns' ? (
        <div className="mn-sr__split">
          <div className="mn-sr__card">
            <div className="mn-sr__toolbar" style={{ marginBottom: 12 }}>
              <div className="mn-sr__toolbar-group">
                <select
                  aria-label="Filter return and dispute cases"
                  className="mn-sr__select"
                  value={caseStatusFilter}
                  onChange={(e) => setCaseStatusFilter(e.target.value)}
                >
                  <option value="">All Return / Dispute Cases</option>
                  <option value="OPEN_CASES">Open Unreconciled Cases</option>
                  <option value="PENDING_REVIEW">Pending Controller Review</option>
                  <option value="AWAITING_PROVIDER_CONFIRMATION">
                    AWAITING_PROVIDER_CONFIRMATION
                  </option>
                  <option value="PROVIDER_CONFIRMED_UNMATCHED_INTERNAL">
                    PROVIDER_CONFIRMED_UNMATCHED_INTERNAL
                  </option>
                  <option value="AMOUNT_OR_FEE_VARIANCE">AMOUNT_OR_FEE_VARIANCE</option>
                  <option value="AMBIGUOUS">AMBIGUOUS</option>
                  <option value="RECONCILED">RECONCILED</option>
                </select>
                <input
                  aria-label="Search return and dispute cases"
                  className="mn-sr__input"
                  placeholder="Search case, original ref, refund ref…"
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                />
              </div>
            </div>

            {caseItems.length === 0 ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                No return, reversal, refund, or chargeback cases in this scope yet.
              </p>
            ) : (
              <div className="mn-sr__table-wrap">
                <table className="mn-sr__table" data-testid="sr-return-cases-table">
                  <thead>
                    <tr>
                      <th>Case & Kind</th>
                      <th className="num">Original Frozen Gross</th>
                      <th className="num">Return / Event Amount</th>
                      <th>Lifecycle Status</th>
                      <th>Review</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseItems.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="mn-sr__mono">
                            <strong>{c.returnOrDisputeReference ?? c.caseKey}</strong>
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {c.caseKind} · orig:{' '}
                            {c.originalBusinessReference ?? c.originalProviderReference ?? '—'}
                          </div>
                        </td>
                        <td className="num">
                          {fmtMoney(c.originalGrossMinor, c.originalCurrency)}
                        </td>
                        <td className="num">{fmtMoney(c.eventAmountMinor, c.originalCurrency)}</td>
                        <td>
                          <span className={statusBadgeClass(c.lifecycleStatus)}>
                            {c.lifecycleStatus}
                          </span>
                        </td>
                        <td>
                          <span className={statusBadgeClass(c.reviewState)}>{c.reviewState}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--secondary"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={async () => {
                              const d =
                                await SettlementReconciliationApi.getReturnDisputeCaseDetail(c.id);
                              setSelectedCase(d);
                              setCaseNote('');
                              setCaseReviewNote('');
                            }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mn-sr__card" data-testid="sr-case-detail-card">
            {!selectedCase ? (
              <p style={{ fontSize: 13, color: '#64748b' }}>
                Select a return, reversal, refund, or chargeback case to inspect frozen original
                transaction figures, the append-only lifecycle timeline, and Maker-Checker review.
              </p>
            ) : (
              <>
                <h3>Case: {selectedCase.caseKind}</h3>
                <p style={{ fontSize: 13 }}>{selectedCase.explanation}</p>
                <div style={{ fontSize: 12.5, display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div>
                    <strong>Frozen Original Transaction (Immutable):</strong>{' '}
                    {selectedCase.originalBusinessReference ??
                      selectedCase.originalProviderReference ??
                      'Unmatched'}{' '}
                    · Gross: {fmtMoney(selectedCase.originalGrossMinor, selectedCase.originalCurrency)}{' '}
                    · Monnify Fee:{' '}
                    {fmtMoney(selectedCase.originalProviderFeeMinor, selectedCase.originalCurrency)}{' '}
                    · Merchant Net:{' '}
                    {fmtMoney(selectedCase.originalNetMinor, selectedCase.originalCurrency)}
                  </div>
                  <div>
                    <strong>Return / Dispute Event:</strong> Ref{' '}
                    <code>{selectedCase.returnOrDisputeReference ?? '—'}</code> · Amount:{' '}
                    {fmtMoney(selectedCase.eventAmountMinor, selectedCase.originalCurrency)} ·
                    Provider Status: <code>{selectedCase.providerEventStatus ?? '—'}</code>
                  </div>
                  <div>
                    <strong>Original Journals:</strong>{' '}
                    {renderJournalLinks(selectedCase.originalJournalIds)}
                  </div>
                  {selectedCase.linkedReversalJournalId ? (
                    <div>
                      <strong>Linked Reversal Journal:</strong>{' '}
                      {renderJournalLinks([selectedCase.linkedReversalJournalId])}
                    </div>
                  ) : null}
                </div>

                <h4>Append-Only Lifecycle Events ({selectedCase.events.length})</h4>
                <div className="mn-sr__timeline" style={{ marginBottom: 12 }}>
                  {selectedCase.events.map((ev) => (
                    <div key={ev.id} className="mn-sr__timeline-item">
                      <div>
                        <strong>{ev.eventSource}</strong> · <code>{ev.eventType}</code> (
                        {ev.statusLabel}) · {fmtUtc(ev.occurredAt)}
                      </div>
                      <div>{ev.detail}</div>
                    </div>
                  ))}
                </div>

                {selectedCase.reviewState !== 'APPROVED' ? (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                    {canImportOrPropose ? (
                      <div style={{ marginBottom: 12 }}>
                        <h4>Maker Case Proposal (FINANCE_PREPARER)</h4>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="case-decision">Decision</label>
                          <select
                            id="case-decision"
                            className="mn-sr__select"
                            value={caseDecision}
                            onChange={(e) => setCaseDecision(e.target.value)}
                          >
                            {RETURN_DECISIONS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="case-rev-journal">
                            Linked Reversal Ledger Journal UUID (optional)
                          </label>
                          <input
                            id="case-rev-journal"
                            className="mn-sr__input"
                            value={caseJournalId}
                            onChange={(e) => setCaseJournalId(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__field" style={{ marginBottom: 8 }}>
                          <label htmlFor="case-disp-id">
                            Linked Customer Dispute UUID (optional)
                          </label>
                          <input
                            id="case-disp-id"
                            className="mn-sr__input"
                            value={caseDisputeId}
                            onChange={(e) => setCaseDisputeId(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__field">
                          <label htmlFor="case-note">Maker Note</label>
                          <input
                            id="case-note"
                            data-testid="sr-case-propose-note"
                            className="mn-sr__input"
                            value={caseNote}
                            onChange={(e) => setCaseNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-case-propose-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || caseNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.proposeReturnDisputeCase(
                                    selectedCase.id,
                                    {
                                      decision: caseDecision,
                                      linkedJournalId: caseJournalId.trim() || undefined,
                                      linkedInternalDisputeId: caseDisputeId.trim() || undefined,
                                      note: caseNote.trim(),
                                    },
                                  );
                                setSelectedCase(updated);
                                setBannerMsg('Return/dispute resolution proposal recorded.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Submit Case Proposal
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {canReview && selectedCase.reviewState === 'PROPOSED' ? (
                      <div>
                        <h4>Controller Review (FINANCE_CONTROLLER)</h4>
                        <div className="mn-sr__field">
                          <label htmlFor="case-review-note">Controller Note</label>
                          <input
                            id="case-review-note"
                            data-testid="sr-case-review-note"
                            className="mn-sr__input"
                            value={caseReviewNote}
                            onChange={(e) => setCaseReviewNote(e.target.value)}
                          />
                        </div>
                        <div className="mn-sr__actions">
                          <button
                            type="button"
                            data-testid="sr-case-approve-btn"
                            className="mn-sr__btn"
                            disabled={busyAction || caseReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewReturnDisputeCase(
                                    selectedCase.id,
                                    { decision: 'APPROVE', note: caseReviewNote.trim() },
                                  );
                                setSelectedCase(updated);
                                setBannerMsg('Return/dispute case resolution approved.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Approve Case Resolution
                          </button>
                          <button
                            type="button"
                            className="mn-sr__btn mn-sr__btn--danger"
                            disabled={busyAction || caseReviewNote.trim().length < 5}
                            onClick={async () => {
                              setBusyAction(true);
                              setError(null);
                              try {
                                const updated =
                                  await SettlementReconciliationApi.reviewReturnDisputeCase(
                                    selectedCase.id,
                                    { decision: 'REJECT', note: caseReviewNote.trim() },
                                  );
                                setSelectedCase(updated);
                                setBannerMsg('Return/dispute case proposal rejected.');
                                await loadOverviewAndActiveTab();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setBusyAction(false);
                              }
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* FORMAT VERIFICATION MATRIX */}
      {subTab === 'formats' ? (
        <div className="mn-sr__card" data-testid="sr-format-matrix">
          <h3>Provider Report & Statement Format Verification Matrix</h3>
          <p style={{ fontSize: 13, color: '#475569' }}>
            Every supported and planned report adapter explicitly states whether its schema is
            verified against official provider documentation or awaiting a redacted dashboard/bank
            export sample. Unverified CSV exports are never presented as production-verified
            formats. Adapter specifications are synthetic pending validation against production
            exports; official API JSON verification refers to documentation, not export samples.
          </p>
          <div className="mn-sr__table-wrap">
            <table className="mn-sr__table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Report Type</th>
                  <th>Format</th>
                  <th>Verification Status</th>
                  <th>Documented Source</th>
                  <th>Missing Redacted Sample Needed</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.formatDescriptors ?? []).map((fd, idx) => (
                  <tr key={`${fd.providerKey}-${fd.reportType}-${fd.fileFormat}-${idx}`}>
                    <td>
                      <strong>{fd.providerKey}</strong>
                    </td>
                    <td>{fd.reportType}</td>
                    <td>{fd.fileFormat}</td>
                    <td>
                      <span className={statusBadgeClass(fd.verificationStatus)}>
                        {fd.verificationStatus}
                      </span>
                      {!fd.supported ? (
                        <div style={{ fontSize: 11, color: '#64748b' }}>Adapter stub (disabled)</div>
                      ) : null}
                    </td>
                    <td>
                      <div>{fd.adapterSpecProvenance}</div>
                      {fd.documentedSource}
                    </td>
                    <td>{fd.missingSampleNeeded ?? 'None — verified against official API JSON'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
