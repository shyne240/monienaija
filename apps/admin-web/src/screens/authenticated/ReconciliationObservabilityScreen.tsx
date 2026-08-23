import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

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

export const ReconciliationObservabilityScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'runs' | 'trial-balance'>('runs');

  // Reconciliation Runs State
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');

  // Trial Balance State
  const [tbReport, setTbReport] = useState<TrialBalanceReport | null>(null);
  const [tbLoading, setTbLoading] = useState(false);
  const [tbError, setTbError] = useState('');

  // Check roles
  const isOperator = (principal?.roles?.length ?? 0) > 0;

  const handleRunReconciliation = async () => {
    setRunError('');
    setReport(null);
    setRunLoading(true);

    try {
      // GET /internal/reconciliation/report (triggers dynamic PG matching runs)
      const res = await ApiClient.get<ReconciliationReport>('/internal/reconciliation/report');
      setReport(res);
    } catch (err: any) {
      setRunError(err?.message || 'Reconciliation run failed.');
    } finally {
      setRunLoading(false);
    }
  };

  const handleLoadTrialBalance = async () => {
    setTbError('');
    setTbReport(null);
    setTbLoading(true);

    try {
      // GET /internal/reconciliation/trial-balance
      const res = await ApiClient.get<TrialBalanceReport>('/internal/reconciliation/trial-balance');
      setTbReport(res);
    } catch (err: any) {
      setTbError(err?.message || 'Trial balance query failed.');
    } finally {
      setTbLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Independent Reconciliation & Breaks Desk</h2>
        <p style={styles.subtitle}>Audit double-entry ledger balance conservation, check trial balances, and manage breaks</p>
      </div>

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>⚠️ In-House Simulated Settlement Boundaries</span>
        <p style={styles.gapText}>
          Reconciliation executes internal PostgreSQL matching algorithms comparing wallet metadata balances against double-entry lines. No external bank statements are consumed in this phase.
        </p>
      </div>

      <div style={styles.tabHeader}>
        <button
          style={activeTab === 'runs' ? styles.activeTabBtn : styles.tabBtn}
          onClick={() => { setActiveTab('runs'); setRunError(''); }}
        >
          ⚙️ Run Verification Audits
        </button>
        <button
          style={activeTab === 'trial-balance' ? styles.activeTabBtn : styles.tabBtn}
          onClick={() => { setActiveTab('trial-balance'); setTbError(''); handleLoadTrialBalance(); }}
        >
          ⚖️ General Trial Balance
        </button>
      </div>

      {activeTab === 'runs' ? (
        <div style={styles.content}>
          <div style={styles.actionRow}>
            <button
              disabled={runLoading}
              onClick={handleRunReconciliation}
              style={styles.actionBtn}
            >
              {runLoading ? 'Running Verification...' : 'Execute In-House Reconciliation Match'}
            </button>
          </div>

          {runError && <div style={styles.errorBox}>{runError}</div>}

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
                  <span style={styles.metaLabel}>Active Breaks:</span>
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
                      <div style={styles.checkHeader}>
                        <span style={styles.checkName}>{c.name}</span>
                        <span style={c.status === 'PASS' ? styles.passBadge : styles.failBadge}>{c.status}</span>
                      </div>
                      <p style={styles.checkMsg}>{c.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Binding Breaks / Discrepancies */}
              <div style={styles.breaksCard}>
                <h4 style={styles.cardTitle}>Binding Breaks & Discrepancies</h4>
                {report.binding.discrepancies.length === 0 ? (
                  <p style={styles.emptyText}>🎉 No active ledger or mapping breaks found. Books are balanced.</p>
                ) : (
                  <div style={styles.breaksList}>
                    {report.binding.discrepancies.map((d) => (
                      <div key={d.key} style={styles.breakItem}>
                        <div style={styles.breakHeader}>
                          <span style={styles.breakName}>{d.type}</span>
                          <span style={d.severity === 'ERROR' ? styles.errorBadge : styles.warnBadge}>{d.severity}</span>
                        </div>
                        <p style={styles.breakMsg}>{d.message}</p>
                        <div style={styles.breakMeta}>
                          {d.bindingId && <span>Binding: {d.bindingId}</span>}
                          {d.customerId && <span>Customer: {d.customerId}</span>}
                          <span>Owner: {d.owner}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={styles.content}>
          {tbError && <div style={styles.errorBox}>{tbError}</div>}

          {tbLoading ? (
            <p style={styles.loadingText}>Fetching Trial Balance...</p>
          ) : tbReport && (
            <div style={styles.tbContainer}>
              <div style={styles.tbSummary}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Trial Balance Integrity:</span>
                  <span style={tbReport.balanced ? styles.passStatus : styles.failStatus}>
                    {tbReport.balanced ? 'BALANCED FACT' : 'UNBALANCED DISCREPANCY'}
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Generated At:</span>
                  <span style={styles.metaValue}>{new Date(tbReport.generatedAt).toLocaleString()}</span>
                </div>
              </div>

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
                      <span style={styles.metaValue}>₦{(parseFloat(dim.totalDebitsMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={styles.metaRow}>
                      <span style={styles.metaLabel}>Total Credits:</span>
                      <span style={styles.metaValue}>₦{(parseFloat(dim.totalCreditsMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
              </div>

              <h4 style={styles.sectionTitle}>Chart of Accounts Trial Balance</h4>
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thRow}>
                      <th style={styles.th}>Code</th>
                      <th style={styles.th}>Account Name</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Total Debits</th>
                      <th style={styles.th}>Total Credits</th>
                      <th style={styles.th}>Closing Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tbReport.rows.map((r) => (
                      <tr key={r.accountId} style={styles.tableRow}>
                        <td style={styles.tdCode}>{r.accountCode}</td>
                        <td style={styles.td}>{r.accountName}</td>
                        <td style={styles.td}>{r.accountType}</td>
                        <td style={styles.td}>₦{(parseFloat(r.totalDebitsMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                        <td style={styles.td}>₦{(parseFloat(r.totalCreditsMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                        <td style={{ ...styles.td, fontWeight: 'bold', color: '#0A3D25' }}>
                          ₦{(parseFloat(r.balanceMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
  },
  gapWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '24px',
  },
  gapTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#D97706',
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
    borderBottom: '1px solid #E2E8F0',
    marginBottom: '24px',
    maxWidth: '600px',
  },
  tabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#64748B',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  activeTabBtn: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#0A3D25',
    border: 'none',
    borderBottom: '2px solid #0A3D25',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  actionRow: {
    marginBottom: '20px',
  },
  actionBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#EF4444',
  },
  successBox: {
    backgroundColor: '#D1FAE5',
    color: '#10B981',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#10B981',
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '20px',
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    alignSelf: 'flex-start' as const,
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 16px 0',
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: '8px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    marginBottom: '10px',
  },
  metaLabel: {
    color: '#64748B',
    fontWeight: '500',
  },
  metaValue: {
    color: '#0F172A',
    fontWeight: '600',
  },
  passStatus: {
    color: '#10B981',
    fontWeight: 'bold',
    backgroundColor: '#D1FAE5',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  failStatus: {
    color: '#EF4444',
    fontWeight: 'bold',
    backgroundColor: '#FEE2E2',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
  },
  discrepancyCount: {
    color: '#F59E0B',
    fontWeight: 'bold',
  },
  checksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
  },
  checksList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  },
  checkItem: {
    borderBottom: '1px solid #F1F5F9',
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
    color: '#1E293B',
  },
  passBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#10B981',
    backgroundColor: '#D1FAE5',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  failBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#EF4444',
    backgroundColor: '#FEE2E2',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  checkMsg: {
    fontSize: '12px',
    color: '#64748B',
    margin: 0,
    lineHeight: '16px',
  },
  breaksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
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
    color: '#EF4444',
    backgroundColor: '#FEE2E2',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  warnBadge: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: '#F59E0B',
    backgroundColor: '#FEF3C7',
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
    border: '1px solid #E2E8F0',
    padding: '24px',
  },
  content: {
    marginTop: '20px',
  },
  tbSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '16px',
    border: '1px solid #E2E8F0',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 16px 0',
    borderBottom: '1px solid #E2E8F0',
    paddingBottom: '8px',
  },
  dimensionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
    marginBottom: '28px',
  },
  dimensionCard: {
    backgroundColor: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '14px',
  },
  dimHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
    borderBottom: '1px solid #E2E8F0',
    paddingBottom: '6px',
  },
  dimName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#1E293B',
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
    borderBottom: '2px solid #E2E8F0',
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px',
    color: '#64748B',
    fontWeight: '600',
  },
  tableRow: {
    borderBottom: '1px solid #F1F5F9',
  },
  td: {
    padding: '12px 10px',
    color: '#334155',
  },
  tdCode: {
    padding: '12px 10px',
    color: '#64748B',
    fontFamily: 'monospace',
  },
  loadingText: {
    fontSize: '13px',
    color: '#64748B',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '13px',
    color: '#94A3B8',
    textAlign: 'center' as const,
  },
};
