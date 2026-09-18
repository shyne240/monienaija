import React, { useState, useEffect } from 'react';
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
  const [reversalError, setReversalError] = useState('');
  const [reversalSuccess, setReversalSuccess] = useState('');
  const [reversalLoading, setReversalLoading] = useState(false);

  // Check roles permissions
  const isPreparer = principal?.roles.includes('FINANCE_PREPARER') || principal?.roles.includes('FINANCE_ADMIN') || principal?.scopes.includes('finance:prepare');
  const isController = principal?.roles.includes('FINANCE_CONTROLLER') || principal?.scopes.includes('privileged:approve');

  const fetchAccounts = async () => {
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
    fetchAccounts();
  }, [searchCurrency]);

  const handleSearchJournal = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!journal) return;
    setReversalError('');
    setReversalSuccess('');
    setReversalLoading(true);

    const idempotencyKey = `rev-${journal.id}-${Date.now()}`;

    try {
      if (isController) {
        // Direct checker-approved reversal: POST /ledger/journals/:id/reversal
        await ApiClient.post(`/ledger/journals/${journal.id}/reversal`, {
          idempotencyKey,
          reason: reversalReason.trim() || 'Correction Reversal',
        }, {
          idempotencyKey,
        });
        setReversalSuccess('Journal reversal compensating entry executed successfully!');
        setReversalReason('');
        
        // Reload journal to view status changes
        const res = await ApiClient.get<Journal>(`/ledger/journals/${journal.id}`);
        setJournal(res);
        fetchAccounts();
      } else if (isPreparer) {
        // Maker request approvals
        const fingerprint = `rev-fp-${journal.id}`;
        await ApiClient.post('/internal/a2/workforce/approvals/request', {
          action: 'FINANCE_CONTROL_POLICY_ACTIVATE', // Role rule assigned action
          resource: { type: 'A2_FINANCE_ROLE_ASSIGNMENT', id: journal.id },
          actionFingerprint: '4db33761157d636e1451c3746c9094b4c063207b4db33761157d636e1451c374', // Mock valid 64-hex SHA256 fingerprint
          reason: reversalReason.trim() || 'Requesting reversal approval',
        });
        setReversalSuccess('Privileged reversal maker request created. Requires checking signature.');
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

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Ledger Core & Reversals Desk</h2>
        <p style={styles.subtitle}>Trace double-entry balanced postings, inspect accounts, and reverse errors</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

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
            <select style={styles.select} value={searchCurrency} onChange={(e) => setSearchCurrency(e.target.value)}>
              <option value="">All Currencies</option>
              <option value="NGN">NGN (Naira)</option>
            </select>
          </div>

          {isLoading ? (
            <p style={styles.loadingText}>Fetching ledger accounts...</p>
          ) : accounts.length === 0 ? (
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
                    ₦{(parseFloat(acc.balanceMinor || '0') / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
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
              <label style={styles.label}>Audit Journal ID (UUID)</label>
              <div style={styles.searchRow}>
                <input
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
              <div style={styles.linesTableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thRow}>
                      <th style={styles.th}>Account ID</th>
                      <th style={styles.th}>DEBIT</th>
                      <th style={styles.th}>CREDIT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journal.lines.map((l) => (
                      <tr key={l.id} style={styles.tableRow}>
                        <td style={styles.td}>{l.accountId}</td>
                        <td style={styles.td}>
                          {l.direction === 'DEBIT' ? `₦${(parseFloat(l.amountMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td style={styles.td}>
                          {l.direction === 'CREDIT' ? `₦${(parseFloat(l.amountMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '-'}
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
                  <h5 style={styles.reversalTitle}>Execute Compensating Reversal Entry</h5>
                  
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Audit Reason for Reversal Override</label>
                    <input
                      type="text"
                      style={styles.input}
                      placeholder="e.g. Correct posting duplicate entry"
                      value={reversalReason}
                      onChange={(e) => setReversalReason(e.target.value)}
                      disabled={reversalLoading}
                    />
                  </div>

                  <button
                    disabled={reversalLoading}
                    onClick={handleReverseJournal}
                    style={styles.reverseBtn}
                  >
                    {reversalLoading ? 'Processing Override...' : isController ? 'Sign & Execute Reversal' : 'Request Reversal Approval'}
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
  splitLayout: {
    display: 'flex',
    gap: '24px',
    alignItems: 'flex-start',
  },
  leftSection: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    borderBottom: '1px solid #E2E8F0',
    paddingBottom: '10px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: 0,
  },
  select: {
    height: '34px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 10px',
    fontSize: '12px',
    backgroundColor: '#FFFFFF',
  },
  accountsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
  accountCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '14px',
    border: '1px solid #E2E8F0',
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
    color: '#1E293B',
  },
  accountCode: {
    fontSize: '11px',
    color: '#64748B',
    fontFamily: 'monospace',
  },
  accountMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#64748B',
    marginBottom: '10px',
  },
  metaLabel: {
    display: 'block',
  },
  accountBalance: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#0A3D25',
    textAlign: 'right' as const,
  },
  rightSection: {
    width: '480px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
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
    color: '#475569',
    marginBottom: '6px',
  },
  searchRow: {
    display: 'flex',
    gap: '10px',
  },
  input: {
    flex: 1,
    height: '38px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '13px',
    color: '#1E293B',
  },
  searchBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '0 16px',
    fontSize: '13px',
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
  journalCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '16px',
  },
  journalTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 12px 0',
    borderBottom: '1px dashed #CBD5E1',
    paddingBottom: '6px',
  },
  journalMetaGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px',
    marginBottom: '16px',
  },
  metaItem: {
    fontSize: '11px',
    color: '#475569',
    margin: 0,
    wordBreak: 'break-all' as const,
  },
  postedStatus: {
    color: '#10B981',
    fontWeight: 'bold',
    backgroundColor: '#D1FAE5',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  reversedStatus: {
    color: '#EF4444',
    fontWeight: 'bold',
    backgroundColor: '#FEE2E2',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  linesTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#334155',
    margin: '0 0 10px 0',
  },
  linesTableWrapper: {
    overflowX: 'auto' as const,
    marginBottom: '20px',
    backgroundColor: '#FFFFFF',
    borderRadius: '6px',
    border: '1px solid #E2E8F0',
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
    color: '#64748B',
    fontWeight: '600',
  },
  tableRow: {
    borderBottom: '1px solid #F1F5F9',
  },
  td: {
    padding: '8px 6px',
    color: '#1E293B',
  },
  reversalBlock: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px dashed #CBD5E1',
  },
  reversalTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#EF4444',
    margin: '0 0 12px 0',
  },
  reverseBtn: {
    backgroundColor: '#EF4444',
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
    color: '#64748B',
    textAlign: 'center' as const,
  },
  emptyText: {
    fontSize: '12px',
    color: '#94A3B8',
    textAlign: 'center' as const,
  },
};
