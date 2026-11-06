import './operational-surfaces.css';
import { PageHeader } from '../../design-system/primitives';
import React, { useState, useEffect } from 'react';
import { formatFinancialAmount } from '../../utils/financial-display';
import { ApiClient, ApiError } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  accountingUnit: string;
  status: string;
  balanceMinor: string;
}

interface JournalLine {
  id: string;
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
}

interface Journal {
  id: string;
  status: string;
  currency: string;
  accountingUnit: string;
  reference?: string;
  description?: string;
  createdAt: string;
  lines: JournalLine[];
}

export const LedgerOperationsScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [searchCurrency, setSearchCurrency] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Journal Search & Detail State
  const [searchJournalId, setSearchJournalId] = useState('');
  const [journal, setJournal] = useState<Journal | null>(null);
  const [journalError, setJournalError] = useState('');
  const [journalLoading, setJournalLoading] = useState(false);

  // Reversal Form State
  const [reversalReason, setReversalReason] = useState('');
  const [reversalApprovalId, setReversalApprovalId] = useState('');
  const [reversalError, setReversalError] = useState('');
  const [reversalSuccess, setReversalSuccess] = useState('');
  const [reversalLoading, setReversalLoading] = useState(false);

  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  // The account/journal read endpoints require ledger.view; a role label or write grant does not
  // substitute for that route function.
  const canViewLedger = hasFn('ledger.view');
  // Maker request endpoint requires ledger.reverse (legacy finance:prepare/ledger.post alone do
  // not authorize this route).
  const isPreparer = hasFn('ledger.reverse');
  // The backend reversal executor explicitly accepts a FINANCE_CONTROLLER role or
  // privileged:execute; keep this UI condition in lockstep with that source policy.
  const isController =
    principal?.roles.includes('FINANCE_CONTROLLER') === true || hasFn('privileged:execute');

  const fetchAccounts = async () => {
    if (!canViewLedger) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      // GET /ledger/accounts
      const query = searchCurrency ? `?currency=${searchCurrency}` : '';
      const list = await ApiClient.get<LedgerAccount[]>(`/ledger/accounts${query}`);
      setAccounts(list || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch ledger accounts.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canViewLedger) fetchAccounts();
    else setIsLoading(false);
  }, [searchCurrency, canViewLedger]);

  const handleSearchJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewLedger) return;
    if (!searchJournalId.trim()) {
      setJournalError('Journal ID is required');
      return;
    }
    setJournalError('');
    setJournal(null);
    setJournalLoading(true);
    setReversalSuccess('');
    setReversalError('');

    try {
      // GET /ledger/journals/:id
      const res = await ApiClient.get<Journal>(`/ledger/journals/${searchJournalId.trim()}`);
      setJournal(res);
    } catch (err: any) {
      setJournalError(err?.message || 'Journal entry not found.');
    } finally {
      setJournalLoading(false);
    }
  };

  const handleReverseJournal = async () => {
    if (!canViewLedger || !journal || (!isPreparer && !isController)) return;
    setReversalError('');
    setReversalSuccess('');
    setReversalLoading(true);

    const idempotencyKey = `rev-${journal.id}-${Date.now()}`;

    try {
      if (isController) {
        // Checker-execution (P0-B): consumes the APPROVED maker-checker request. The reason
        // must match the approved maker request exactly — it is fingerprint-bound server-side.
        if (!reversalApprovalId.trim()) {
          throw new Error('Approved maker-checker request ID (approvalId) is required.');
        }
        await ApiClient.post(`/ledger/journals/${journal.id}/reversal`, {
          idempotencyKey,
          reason: reversalReason.trim(),
          approvalId: reversalApprovalId.trim(),
        }, {
          idempotencyKey,
        });
        setReversalSuccess('Governed journal reversal executed from the approved request.');
        setReversalReason('');
        setReversalApprovalId('');

        // Reload journal to view status changes
        const res = await ApiClient.get<Journal>(`/ledger/journals/${journal.id}`);
        setJournal(res);
        fetchAccounts();
      } else if (isPreparer) {
        // Maker request (P0-B): the backend computes the deterministic action fingerprint of the
        // ACTUAL reversal request (LEDGER_JOURNAL_REVERSAL / LEDGER_JOURNAL) — the client never
        // supplies one. The result is a PENDING maker-checker request a FINANCE_CONTROLLER must
        // independently approve before it can be executed.
        const request = await ApiClient.post<{ approvalId: string; actionFingerprint: string }>(
          `/ledger/journals/${journal.id}/reversal-request`,
          { reason: reversalReason.trim() },
        );
        setReversalSuccess(
          `Reversal maker request created (request ID ${request.approvalId}). Awaiting independent FINANCE_CONTROLLER approval.`,
        );
        setReversalReason('');
      } else {
        throw new Error('Unauthorized operational action.');
      }
    } catch (err: any) {
      setReversalError(err?.message || 'Journal reversal command rejected.');
    } finally {
      setReversalLoading(false);
    }
  };

  if (!canViewLedger) {
    return (
      <div className="mn-operational" style={styles.container} role="alert">
        <div style={styles.errorBox}>Ledger account and journal lookup requires <code>ledger.view</code>.</div>
      </div>
    );
  }

  return (
    <div className="mn-operational" style={styles.container}>
      <PageHeader eyebrow="Finance and ledger" title="Ledger Core & Reversals Desk" description="Inspect accounts and journal postings, and use the existing governed reversal workflow." />

      {error && <div style={styles.errorBox} role="alert">{error}</div>}

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>⚠️ ADMIN API GAP: Journal Listing & Backlog Search Unavailable</span>
        <p style={styles.gapText}>
          The ledger controller does not expose a GET `/ledger/journals` search listing route. Audit lookups require the explicit Journal UUID reference to query double-entry balances.
        </p>
      </div>

      <div style={styles.splitLayout}>
        {/* Chart of Accounts */}
        <div style={styles.leftSection}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Chart of Accounts</h3>
            <select aria-label="Account currency" style={styles.select} value={searchCurrency} onChange={(e) => setSearchCurrency(e.target.value)}>
              <option value="">All Currencies</option>
              <option value="NGN">NGN (Naira)</option>
            </select>
          </div>

          {isLoading ? (
            <p style={styles.loadingText}>Fetching ledger accounts...</p>
          ) : error ? null : accounts.length === 0 ? (
            <p style={styles.emptyText}>No ledger accounts found.</p>
          ) : (
            <div style={styles.accountsGrid}>
              {accounts.map((acc) => (
                <div key={acc.id} style={styles.accountCard}>
                  <div style={styles.accountHeader}>
                    <span style={styles.accountName}>{acc.name}</span>
                    <span style={styles.accountCode}>{acc.code}</span>
                  </div>
                  <div style={styles.accountMeta}>
                    <span style={styles.metaLabel}>Type: {acc.accountType}</span>
                    <span style={styles.metaLabel}>Normal: {acc.normalBalance}</span>
                  </div>
                  <div style={styles.accountBalance}>
                    {formatFinancialAmount(acc.balanceMinor, acc.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Journal Inspection & Reversals */}
        <div style={styles.rightSection}>
          <h3 style={styles.sectionTitle}>Journal Audit & Compensations</h3>
          
          <form onSubmit={handleSearchJournal} style={styles.searchForm}>
            <div style={styles.inputGroup}>
              <label htmlFor="ledger-journal-id" style={styles.label}>Audit Journal ID (UUID)</label>
              <div style={styles.searchRow}>
                <input
                  id="ledger-journal-id"
                  type="text"
                  style={styles.input}
                  placeholder="e.g. ecd61345-..."
                  value={searchJournalId}
                  onChange={(e) => setSearchJournalId(e.target.value)}
                  disabled={journalLoading}
                />
                <button type="submit" disabled={journalLoading} style={styles.searchBtn}>
                  {journalLoading ? 'Loading...' : 'Audit Journal'}
                </button>
              </div>
            </div>
          </form>

          {journalError && <div style={styles.errorBox}>{journalError}</div>}

          {journal && (
            <div style={styles.journalCard}>
              <h4 style={styles.journalTitle}>Journal Entry Details</h4>
              <div style={styles.journalMetaGrid}>
                <p style={styles.metaItem}><strong>ID:</strong> {journal.id}</p>
                <p style={styles.metaItem}><strong>Status:</strong> <span style={journal.status === 'POSTED' ? styles.postedStatus : styles.reversedStatus}>{journal.status}</span></p>
                <p style={styles.metaItem}><strong>Description:</strong> {journal.description || 'N/A'}</p>
                <p style={styles.metaItem}><strong>Accounting Unit:</strong> {journal.accountingUnit}</p>
              </div>

              <h5 style={styles.linesTitle}>Double-Entry Postings Lines</h5>
              <div style={styles.linesTableWrapper} role="region" aria-label="Journal posting lines" tabIndex={0}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thRow}>
                      <th style={styles.th}>Account ID</th>
                      <th style={styles.th}>DEBIT</th>
                      <th style={styles.th}>CREDIT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(journal.lines || []).map((l) => (
                      <tr key={l.id} style={styles.tableRow}>
                        <td style={styles.td}>{l.accountId}</td>
                        <td style={styles.td}>
                          {l.direction === 'DEBIT' ? formatFinancialAmount(l.amountMinor, journal.currency) : '-'}
                        </td>
                        <td style={styles.td}>
                          {l.direction === 'CREDIT' ? formatFinancialAmount(l.amountMinor, journal.currency) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {reversalError && <div style={styles.errorBox}>{reversalError}</div>}
              {reversalSuccess && <div style={styles.successBox}>{reversalSuccess}</div>}

              {journal.status === 'POSTED' && (isPreparer || isController) && (
                <div style={styles.reversalBlock}>
                  <h5 style={styles.reversalTitle}>Governed Journal Reversal (Maker / Checker)</h5>
                  
                  <div style={styles.inputGroup}>
                    <label htmlFor="ledger-reversal-reason" style={styles.label}>Audit Reason for Reversal {isController ? '(must match the approved request exactly)' : ''}</label>
                    <input
                      id="ledger-reversal-reason"
                      type="text"
                      style={styles.input}
                      placeholder="e.g. Correct posting duplicate entry"
                      value={reversalReason}
                      onChange={(e) => setReversalReason(e.target.value)}
                      disabled={reversalLoading}
                    />
                  </div>

                  {isController && (
                    <div style={styles.inputGroup}>
                      <label htmlFor="ledger-approval-id" style={styles.label}>Approved Maker-Checker Request ID</label>
                      <input
                        id="ledger-approval-id"
                        type="text"
                        style={styles.input}
                        placeholder="e.g. 3f2c1a00-... (from the approved reversal request)"
                        value={reversalApprovalId}
                        onChange={(e) => setReversalApprovalId(e.target.value)}
                        disabled={reversalLoading}
                      />
                    </div>
                  )}

                  <button
                    disabled={reversalLoading}
                    onClick={handleReverseJournal}
                    style={styles.reverseBtn}
                  >
                    {reversalLoading ? 'Processing...' : isController ? 'Execute Approved Reversal' : 'Request Reversal Approval'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: 'clamp(16px, 3vw, 32px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
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
  splitLayout: {
    display: 'flex',
    gap: '24px',
    alignItems: 'flex-start',
    flexWrap: 'wrap' as const,
  },
  leftSection: {
    flex: '1 1 340px',
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '8px',
    padding: '20px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    paddingBottom: '10px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: 0,
  },
  select: {
    height: '34px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 10px',
    fontSize: '12px',
    backgroundColor: '#FFFFFF',
  },
  accountsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
    gap: '16px',
  },
  accountCard: {
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '6px',
    padding: '14px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
  },
  accountHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  accountName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
  },
  accountCode: {
    fontSize: '11px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontFamily: 'monospace',
  },
  accountMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--mn-text-secondary, #52655f)',
    marginBottom: '10px',
  },
  metaLabel: {
    display: 'block',
  },
  accountBalance: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    textAlign: 'right' as const,
  },
  rightSection: {
    flex: '1 1 340px',
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '8px',
    padding: '20px',
  },
  searchForm: {
    marginBottom: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    marginBottom: '14px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '500',
    color: 'var(--mn-text-secondary, #52655f)',
    marginBottom: '6px',
  },
  searchRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '10px',
  },
  input: {
    flex: '1 1 150px',
    minWidth: 0,
    height: '38px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '13px',
    color: 'var(--mn-text-primary, #132b25)',
  },
  searchBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '13px',
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
  journalCard: {
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '16px',
  },
  journalTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 12px 0',
    borderBottom: '1px dashed #CBD5E1',
    paddingBottom: '6px',
  },
  journalMetaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
    gap: '8px',
    marginBottom: '16px',
  },
  metaItem: {
    fontSize: '11px',
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
    wordBreak: 'break-all' as const,
  },
  postedStatus: {
    color: 'var(--mn-status-success, #146348)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  reversedStatus: {
    color: 'var(--mn-status-danger, #b3261e)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  linesTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 10px 0',
  },
  linesTableWrapper: {
    overflowX: 'auto' as const,
    marginBottom: '20px',
    backgroundColor: '#FFFFFF',
    borderRadius: '6px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
  },
  thRow: {
    borderBottom: '1px solid #CBD5E1',
  },
  th: {
    textAlign: 'left' as const,
    padding: '6px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontWeight: '600',
  },
  tableRow: {
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
  },
  td: {
    padding: '8px 6px',
    color: 'var(--mn-text-primary, #132b25)',
  },
  reversalBlock: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px dashed #CBD5E1',
  },
  reversalTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: 'var(--mn-status-danger, #b3261e)',
    margin: '0 0 12px 0',
  },
  reverseBtn: {
    backgroundColor: 'var(--mn-status-danger, #b3261e)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  loadingText: {
    fontSize: '12px',
    color: 'var(--mn-text-secondary, #52655f)',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '12px',
    color: 'var(--mn-text-muted, #5b6b66)',
    textAlign: 'center' as const,
  },
};
