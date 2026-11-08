import './operational-surfaces.css';
import { PageHeader } from '../../design-system/primitives';
import React, { useState, useEffect, useRef } from 'react';
import './ledger-workspace.css';
import { formatFinancialAmount } from '../../utils/financial-display';
import { ApiClient } from '../../services/api-client';
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
  reversalOfJournalId?: string | null;
  idempotencyKey?: string;
  lines: JournalLine[];
}

const validJournal = (value: any, id: string): value is Journal => value && value.id === id && typeof value.status === 'string' && typeof value.currency === 'string' && typeof value.accountingUnit === 'string' && Array.isArray(value.lines) && value.lines.every((line: any) => line && typeof line.id === 'string' && typeof line.accountId === 'string' && ['DEBIT','CREDIT'].includes(line.direction) && typeof line.amountMinor === 'string' && /^\d+$/.test(line.amountMinor));

function canVerifyReversal(journal: Journal): boolean {
  return journal.lines.some(line => line.direction === 'DEBIT') && journal.lines.some(line => line.direction === 'CREDIT');
}
function matchesReversedLines(original: JournalLine[], reversed: JournalLine[]): boolean {
  const signature = (line: JournalLine, invert: boolean) => JSON.stringify([line.accountId, invert ? (line.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT') : line.direction, BigInt(line.amountMinor).toString()]);
  const expected = original.map(line => signature(line, true)).sort();
  const actual = reversed.map(line => signature(line, false)).sort();
  return expected.length === actual.length && expected.every((line, index) => line === actual[index]);
}

export const LedgerOperationsScreen: React.FC = () => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <LedgerWorkspace key={key} principal={principal} />;
};
const LedgerWorkspace: React.FC<{principal: ReturnType<typeof useAuthStore.getState>['principal']}> = ({principal}) => {
  const generations = useRef({accounts:0, journal:0, reversal:0});
  useEffect(() => () => { generations.current.accounts++; generations.current.journal++; generations.current.reversal++; }, []);
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
  const reversalLock = useRef(false);
  const [reversalReviews, setReversalReviews] = useState<Record<string, 'uncertain' | 'requested' | 'executed'>>({});
  const [reviewedJournalReads, setReviewedJournalReads] = useState<Record<string, boolean>>({});
  const [reviewReadLoading, setReviewReadLoading] = useState(false);
  const [confirmReversal, setConfirmReversal] = useState(false);
  const [confirmClearDraft, setConfirmClearDraft] = useState(false);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const returnReviewFocus = useRef(false);
  useEffect(() => {
    if (confirmReversal) reviewCancelRef.current?.focus();
    else if (returnReviewFocus.current) { returnReviewFocus.current = false; reviewTriggerRef.current?.focus(); }
  }, [confirmReversal]);

  const hasFn = (code: string) => principal?.scopes.includes(code) ?? false;
  // The account/journal read endpoints require ledger.view; a role label or write grant does not
  // substitute for that route function.
  const canViewLedger = hasFn('ledger.view');
  // Maker request endpoint requires ledger.reverse (legacy finance:prepare/ledger.post alone do
  // not authorize this route).
  const isPreparer = hasFn('ledger.reverse') && !principal?.readOnlyPrincipal;
  // The backend reversal executor explicitly accepts a FINANCE_CONTROLLER role or
  // privileged:execute; keep this UI condition in lockstep with that source policy.
  const isController =
    !principal?.readOnlyPrincipal && (principal?.roles.includes('FINANCE_CONTROLLER') === true || hasFn('privileged:execute'));

  const fetchAccounts = async () => {
    if (!canViewLedger) {
      setIsLoading(false);
      return;
    }
    const request = ++generations.current.accounts;
    setIsLoading(true); setAccounts([]);
    setError('');
    try {
      // GET /ledger/accounts
      const query = searchCurrency ? `?currency=${searchCurrency}` : '';
      const list = await ApiClient.get<LedgerAccount[]>(`/ledger/accounts${query}`);
      if (request !== generations.current.accounts) return;
      if (!Array.isArray(list) || list.some(a => !a || typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.code !== 'string' || typeof a.currency !== 'string' || typeof a.balanceMinor !== 'string' || !/^-?\d+$/.test(a.balanceMinor))) throw new Error('Ledger account list returned an invalid response.');
      setAccounts(list);
    } catch (err: any) {
      if (request === generations.current.accounts) setError(err?.message || 'Failed to fetch ledger accounts.');
    } finally {
      if (request === generations.current.accounts) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canViewLedger) fetchAccounts();
    else setIsLoading(false);
  }, [searchCurrency, canViewLedger]);

  const handleSearchJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewLedger || reversalLoading || reviewReadLoading || reversalLock.current || confirmReversal || confirmClearDraft || Boolean(reversalReason.trim()) || Boolean(reversalApprovalId.trim())) return;
    if (!searchJournalId.trim()) {
      setJournalError('Journal ID is required');
      return;
    }
    const request = ++generations.current.journal;
    const id = searchJournalId.trim();
    setJournalError('');
    setJournal(null);
    setJournalLoading(true);
    setReversalSuccess('');
    setReversalError('');

    try {
      // GET /ledger/journals/:id
      const res = await ApiClient.get<Journal>(`/ledger/journals/${encodeURIComponent(id)}`);
      if (request !== generations.current.journal) return;
      if (!validJournal(res, id)) throw new Error('Journal response is invalid or does not match the requested ID.');
      setJournal(res);
    } catch (err: any) {
      if (request === generations.current.journal) setJournalError(err?.message || 'Journal entry not found.');
    } finally {
      if (request === generations.current.journal) setJournalLoading(false);
    }
  };

  const refreshJournalForReview = async () => {
    if (!journal || !reversalReviews[journal.id] || reviewReadLoading || reversalLock.current) return;
    const id = journal.id;
    const request = ++generations.current.journal;
    setReviewReadLoading(true); setJournalError('');
    try {
      const refreshed = await ApiClient.get<Journal>(`/ledger/journals/${encodeURIComponent(id)}`);
      if (request !== generations.current.journal) return;
      if (!validJournal(refreshed, id)) throw new Error('Journal refresh returned invalid data.');
      setJournal(refreshed); setReviewedJournalReads(current => ({ ...current, [id]: true }));
    } catch (err: any) {
      if (request === generations.current.journal) { setReviewedJournalReads(current => ({ ...current, [id]: false })); setJournalError(`Journal review refresh failed: ${err?.message || 'Service unavailable.'}`); }
    } finally { if (request === generations.current.journal) setReviewReadLoading(false); }
  };

  const handleReverseJournal = async () => {
    if (!canViewLedger || !journal || reversalLoading || reversalLock.current || !confirmReversal || reversalReviews[journal.id] || (!isPreparer && !isController)) return;
    if (!reversalReason.trim() || reversalReason.trim().length > 500 || journal.status !== 'POSTED' || journal.reversalOfJournalId || (isController && !canVerifyReversal(journal))) return;
    if (isController && !reversalApprovalId.trim()) { setReversalSuccess(''); setReversalError('Approved maker-checker request ID (approvalId) is required.'); return; }
    reversalLock.current = true;
    setConfirmReversal(false);
    const generation = ++generations.current.reversal;
    const journalId = journal.id;
    setReversalError('');
    setReversalSuccess('');
    setReversalLoading(true);

    try {
      if (isController && !globalThis.crypto?.getRandomValues) throw new Error('Secure reversal key generation unavailable.');
      const idempotencyKey = isController ? `rev-${journal.id}-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('')}` : '';
      if (isController) {
        // Checker-execution (P0-B): consumes the APPROVED maker-checker request. The reason
        // must match the approved maker request exactly — it is fingerprint-bound server-side.
        const receipt = await ApiClient.post<Journal>(`/ledger/journals/${encodeURIComponent(journalId)}/reversal`, {
          idempotencyKey,
          reason: reversalReason.trim(),
          approvalId: reversalApprovalId.trim(),
        }, {
          idempotencyKey,
        });
        if (generation !== generations.current.reversal) return;
        if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim() || receipt.id === journalId || !validJournal(receipt, receipt.id) || receipt.status !== 'POSTED' || receipt.reversalOfJournalId !== journalId || receipt.idempotencyKey !== idempotencyKey || receipt.currency !== journal.currency || receipt.accountingUnit !== journal.accountingUnit || !matchesReversedLines(journal.lines, receipt.lines)) throw new Error('Reversal receipt was incomplete or mismatched.');
        setReviewedJournalReads(current => ({ ...current, [journalId]: false }));
        setReversalReviews(current => ({ ...current, [journalId]: 'executed' }));
        setReversalSuccess('Governed journal reversal executed from the approved request.');
        setReversalReason('');
        setReversalApprovalId('');

        // Reload journal to view status changes
        try {
          const res = await ApiClient.get<Journal>(`/ledger/journals/${encodeURIComponent(journalId)}`);
          if (generation !== generations.current.reversal) return;
          if (!validJournal(res, journalId)) throw new Error('Journal refresh returned invalid data.');
          setJournal(res);
          void fetchAccounts();
        } catch (refreshError: any) {
          if (generation === generations.current.reversal) { setJournal(null); setJournalError(`Reversal was recorded, but journal refresh failed: ${refreshError?.message || 'Service unavailable.'}`); }
        }
      } else if (isPreparer) {
        // Maker request (P0-B): the backend computes the deterministic action fingerprint of the
        // ACTUAL reversal request (LEDGER_JOURNAL_REVERSAL / LEDGER_JOURNAL) — the client never
        // supplies one. The result is a PENDING maker-checker request a FINANCE_CONTROLLER must
        // independently approve before it can be executed.
        const request = await ApiClient.post<{ approvalId: string; actionFingerprint: string; status: string; resourceId: string; actionType: string; resourceType: string }>(
          `/ledger/journals/${encodeURIComponent(journalId)}/reversal-request`,
          { reason: reversalReason.trim() },
        );
        if (generation !== generations.current.reversal) return;
        if (!request || typeof request.approvalId !== 'string' || !request.approvalId || request.status !== 'REQUESTED' || request.actionType !== 'LEDGER_JOURNAL_REVERSAL' || request.resourceType !== 'LEDGER_JOURNAL' || request.resourceId !== journalId || typeof request.actionFingerprint !== 'string' || !request.actionFingerprint) throw new Error('Reversal request receipt was incomplete or mismatched.');
        setReviewedJournalReads(current => ({ ...current, [journalId]: false }));
        setReversalReviews(current => ({ ...current, [journalId]: 'requested' }));
        setReversalSuccess(
          `Reversal maker request created (request ID ${request.approvalId}). Awaiting independent FINANCE_CONTROLLER approval.`,
        );
        setReversalReason('');
      } else {
        throw new Error('Unauthorized operational action.');
      }
    } catch (err: any) {
      if (generation === generations.current.reversal) { setReviewedJournalReads(current => ({ ...current, [journalId]: false })); setReversalReviews(current => ({ ...current, [journalId]: 'uncertain' })); setReversalError(`Reversal outcome not confirmed. Check the journal and approval/audit records before retrying. ${err?.message || 'Service unavailable.'}`); }
    } finally {
      reversalLock.current = false;
      if (generation === generations.current.reversal) setReversalLoading(false);
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
    <div className="mn-operational mn-ledger" style={styles.container}>
      <PageHeader eyebrow="Finance and ledger" title="Ledger Core & Reversals Desk" description="Inspect accounts and journal postings, and use the existing governed reversal workflow." />

      {error && <div style={styles.errorBox} role="alert">{error}</div>}

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>Journal listing and backlog search unavailable</span>
        <p style={styles.gapText}>
          Search by a known journal UUID. A journal listing or backlog search is not available here.
        </p>
      </div>

      <div style={styles.splitLayout}>
        {/* Chart of Accounts */}
        <section className="mn-ledger__panel" style={styles.leftSection} aria-label="Chart of accounts">
          <p className="mn-ledger__eyebrow">ACCOUNTS</p>
          <div className="mn-ledger__section-head" style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Chart of Accounts</h2>
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
        </section>

        {/* Journal Inspection & Reversals */}
        <section className="mn-ledger__panel" style={styles.rightSection} aria-label="Journal inspection">
          <p className="mn-ledger__eyebrow">JOURNAL INVESTIGATION</p>
          <h2 style={styles.sectionTitle}>Journal Audit & Compensations</h2>
          
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
                  onChange={(e) => { setSearchJournalId(e.target.value); setJournal(null); setJournalError(''); setReversalSuccess(''); setReversalError(''); }}
                  disabled={journalLoading || reversalLoading || reviewReadLoading || confirmReversal || confirmClearDraft || Boolean(reversalReason.trim()) || Boolean(reversalApprovalId.trim())}
                />
                <button type="submit" disabled={journalLoading || reversalLoading || reviewReadLoading || confirmReversal || confirmClearDraft || Boolean(reversalReason.trim()) || Boolean(reversalApprovalId.trim())} style={styles.searchBtn}>
                  {journalLoading ? 'Loading...' : 'Audit Journal'}
                </button>
              </div>
            </div>
          </form>

          {(reversalReason.trim() || reversalApprovalId.trim()) && !reversalLoading && !confirmReversal && <div role="note">Reversal details are local to this journal. Clear them before looking up another journal.{' '}
            {!confirmClearDraft ? <button type="button" onClick={() => setConfirmClearDraft(true)}>Clear reversal details</button> : <span>Discard the local reversal details?{' '}<button type="button" onClick={() => setConfirmClearDraft(false)}>Keep details</button>{' '}<button type="button" onClick={() => { setReversalReason(''); setReversalApprovalId(''); setConfirmClearDraft(false); }}>Discard details</button></span>}
          </div>}
          {journalError && <div style={styles.errorBox} role="alert">{journalError}</div>}
          {reversalError && <div style={styles.errorBox} role="alert">{reversalError}</div>}
          {reversalSuccess && <div style={styles.successBox} role="status">{reversalSuccess}</div>}

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


              {journal.reversalOfJournalId && <div role="note" style={styles.gapWarning}>This journal is itself a reversal and cannot be reversed here.</div>}
              {journal.status === 'POSTED' && !journal.reversalOfJournalId && (isPreparer || isController) && (
                <div style={styles.reversalBlock}>
                  <h5 style={styles.reversalTitle}>Governed Journal Reversal (Maker / Checker)</h5>
                  <p style={styles.gapText}>Reversal details and outcome safeguards are held only in this workspace. Leaving, refreshing or changing session clears them. Check journal, approval and audit records before taking a later action.</p>
                  {isController && !canVerifyReversal(journal) && <div role="note" style={styles.gapWarning}>The posting lines are insufficient to verify a reversal receipt. Execution is unavailable.</div>}
                  {reversalReviews[journal.id] && <div role="status" style={styles.gapWarning}>
                    {reversalReviews[journal.id] === 'executed' ? 'A reversal receipt was confirmed for this journal in this session. Further reversal attempts are unavailable.' : 'Refresh the journal and independently inspect the approval and audit records before any further action. A previous request may exist or an execution may have consumed approval. The original journal can remain POSTED after reversal; its status alone does not establish eligibility.'}
                    {reversalReviews[journal.id] !== 'executed' && <div>
                      <button type="button" disabled={reviewReadLoading} onClick={() => void refreshJournalForReview()}>{reviewReadLoading ? 'Refreshing journal…' : 'Refresh journal for review'}</button>{' '}
                      <button type="button" disabled={reviewReadLoading || !reviewedJournalReads[journal.id]} onClick={() => setReversalReviews(current => { const next = { ...current }; delete next[journal.id]; return next; })}>I reviewed the journal and approval records</button>
                    </div>}
                  </div>}
                  
                  <div style={styles.inputGroup}>
                    <label htmlFor="ledger-reversal-reason" style={styles.label}>Audit Reason for Reversal {isController ? '(must match the approved request exactly)' : ''}</label>
                    <input
                      id="ledger-reversal-reason"
                      type="text"
                      style={{...styles.input, flex: '0 0 40px'}}
                      placeholder="e.g. Correct posting duplicate entry"
                      value={reversalReason}
                      onChange={(e) => setReversalReason(e.target.value)}
                      disabled={reversalLoading || confirmReversal || confirmClearDraft}
                    />
                  </div>

                  {isController && (
                    <div style={styles.inputGroup}>
                      <label htmlFor="ledger-approval-id" style={styles.label}>Approved Maker-Checker Request ID</label>
                      <input
                        id="ledger-approval-id"
                        type="text"
                        style={{...styles.input, flex: '0 0 40px'}}
                        placeholder="e.g. 3f2c1a00-... (from the approved reversal request)"
                        value={reversalApprovalId}
                        onChange={(e) => setReversalApprovalId(e.target.value)}
                        disabled={reversalLoading || confirmReversal || confirmClearDraft}
                      />
                    </div>
                  )}

                  {confirmReversal ? <div role="group" aria-label="Confirm journal reversal" style={styles.gapWarning}>
                    <p>{isController ? 'Execute the approved reversal' : 'Create a reversal approval request'} for journal <code>{journal.id}</code>.</p>
                    <p>Reason: {reversalReason.trim()}</p>{isController && <p>Approval ID: <code>{reversalApprovalId.trim()}</code></p>}
                    <button ref={reviewCancelRef} type="button" onClick={() => { returnReviewFocus.current = true; setConfirmReversal(false); }}>Keep editing</button>{' '}
                    <button type="button" disabled={reversalLoading} onClick={() => void handleReverseJournal()}>{isController ? 'Confirm reversal execution' : 'Confirm reversal request'}</button>
                  </div> : <button
                    ref={reviewTriggerRef}
                    type="button"
                    disabled={reversalLoading || reviewReadLoading || confirmClearDraft || Boolean(reversalReviews[journal.id]) || (isController && !canVerifyReversal(journal))}
                    onClick={() => {
                      if (!reversalReason.trim() || reversalReason.trim().length > 500) { setReversalError('Reversal reason must contain 1–500 characters.'); return; }
                      if (isController && !reversalApprovalId.trim()) { setReversalError('Approved maker-checker request ID (approvalId) is required.'); return; }
                      setReversalError(''); setConfirmReversal(true);
                    }}
                    style={styles.reverseBtn}
                  >
                    {reversalLoading ? 'Processing...' : isController ? 'Execute Approved Reversal' : 'Request Reversal Approval'}
                  </button>}
                </div>
              )}
            </div>
          )}
        </section>
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
