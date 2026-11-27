import React, { useEffect, useState } from 'react';
import { PageHeader } from '../../design-system/primitives';
import { WorkspaceDrawer } from '../../design-system/WorkspaceDrawer';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { formatFinancialAmount } from '../../utils/financial-display';
import './transaction-history.css';

const types = {
  WALLET_TRANSFER: 'Wallet transfer',
  CASH_IN: 'Cash to Wallet',
  CASH_OUT: 'Wallet to Cash',
  CASH_TO_CASH: 'Cash to Cash',
  WALLET_TO_BANK: 'Wallet to Bank',
  BANK_TO_WALLET: 'Bank to Wallet',
  CUSTOMER_FUNDING: 'Customer Funding',
  AGENT_FUNDING: 'Agent Funding',
  AGENT_DEFUNDING: 'Agent Defunding',
};
type Row = {
  id: string;
  type: string;
  reference: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  amountMinor: string;
  feeMinor: string | null;
  vatMinor?: string | null;
  currency: string;
  institutionId?: string;
  investigation?: Record<string, string | null>;
  journals?: (string | null)[];
};
type Result = { items: Row[]; nextCursor: string | null };
const empty = { from: '', to: '', type: '', status: '', reference: '' };
const date = (v: string) =>
  new Date(v).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
const endpoint = '/internal/admin/transaction-history';
export function transactionDetailLink(type: string, id: string) {
  return `#transaction-history/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}
/**
 * Export URL for a set of applied filters.
 *
 * Built from the SAME `query` state the list uses, so "the filters on screen" and "the filters in
 * the file" cannot drift. Only the four supported filters are forwarded: paging belongs to the
 * export itself and the server rejects `limit`/`cursor` on this route.
 */
export function exportUrl(query: {
  from: string;
  to: string;
  type: string;
  status: string;
  reference: string;
}) {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'type', 'status', 'reference'] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  const qs = params.toString();
  return `${endpoint}/export.csv${qs ? `?${qs}` : ''}`;
}
export const TransactionHistoryScreen: React.FC<{
  onOpenJournal?: (journalId: string) => void;
}> = ({ onOpenJournal }) => {
  const { principal, sessionId } = useAuthStore();
  return (
    <History
      key={JSON.stringify([sessionId, principal])}
      allowed={!!principal?.scopes.includes('transaction.view')}
      canViewLedger={!!principal?.scopes.includes('ledger.view')}
      onOpenJournal={onOpenJournal}
    />
  );
};
function History({
  allowed,
  canViewLedger,
  onOpenJournal,
}: {
  allowed: boolean;
  canViewLedger: boolean;
  onOpenJournal?: (journalId: string) => void;
}) {
  const [draft, setDraft] = useState(empty);
  const [query, setQuery] = useState(empty);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [key, setKey] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailError, setDetailError] = useState('');
  // Export state is deliberately separate from list loading: a slow export must not make the
  // table look like it is reloading, and a list reload must not cancel a running export.
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    const sync = () => {
      const match = /^#transaction-history\/([A-Z_]+)\/([0-9a-f-]+)$/i.exec(window.location.hash);
      setKey(match ? `${match[1]}/${match[2]}` : '');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    const params = new URLSearchParams({
      ...query,
      limit: '20',
      cursor: cursors[cursors.length - 1],
    });
    ApiClient.get<Result>(`${endpoint}?${params}`)
      .then((r) => {
        if (
          !Array.isArray(r?.items) ||
          !r.items.every((x) => x.id && x.reference && /^\d+$/.test(x.amountMinor))
        )
          throw new Error('Invalid transaction history response');
        if (active) setResult(r);
      })
      .catch((e) => {
        if (active) setError(e.message || 'Unable to load history');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [allowed, query, cursors, revision]);
  useEffect(() => {
    setDetail(null);
    setDetailError('');
    if (!key || !allowed) return;
    let active = true;
    ApiClient.get<Row>(`${endpoint}/${key}`)
      .then((r) => {
        if (`${r.type}/${r.id}` !== key) throw new Error('Mismatched transaction');
        if (active) setDetail(r);
      })
      .catch((e) => {
        if (active) setDetailError(e.message || 'Transaction unavailable or outside your scope');
      });
    return () => {
      active = false;
    };
  }, [key, allowed]);
  const runExport = async () => {
    setExporting(true);
    setExportError('');
    setExportMessage('Preparing export… this can take a moment for a wide date range.');
    try {
      const file = await ApiClient.getFile(exportUrl(query));
      // The browser owns the save dialog; we only hand it a correctly named object URL.
      const objectUrl = URL.createObjectURL(file.blob);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = file.fileName;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setExportMessage(
        file.rowCount === null
          ? `Exported ${file.fileName}.`
          : `Exported ${file.rowCount.toLocaleString('en-NG')} ${
              file.rowCount === 1 ? 'transaction' : 'transactions'
            } to ${file.fileName}. These are all records matching the applied filters, not just this page.`,
      );
    } catch (e) {
      setExportMessage('');
      // The server's message for a size refusal already tells the operator what to do.
      setExportError(
        (e as Error).message ||
          'Export failed. No file was produced. Try again, or narrow the date range.',
      );
    } finally {
      setExporting(false);
    }
  };

  if (!allowed)
    return (
      <div className="th-workspace" role="alert">
        Permission required: transaction.view. Contact your workforce administrator.
      </div>
    );
  const close = () => {
    window.location.hash = '';
    setKey('');
  };
  return (
    <div className="th-workspace">
      <PageHeader
        eyebrow="MONEY MOVEMENT · READ ONLY"
        title="Transaction History"
        description="One history for business transactions. Investigate recorded activity without moving money."
        actions={
          <div className="th-actions">
            <button onClick={() => setRevision((x) => x + 1)}>Refresh history</button>
            <button
              className="th-primary"
              type="button"
              onClick={() => void runExport()}
              disabled={exporting}
              aria-describedby="th-export-note"
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        }
      />
      <div className="th-export" aria-live="polite">
        {exporting && (
          <p role="status" className="th-export-progress">
            <span className="th-spinner" aria-hidden="true" />
            {exportMessage}
          </p>
        )}
        {!exporting && exportMessage && (
          <p role="status" className="th-export-success">
            {exportMessage}
          </p>
        )}
        {exportError && (
          <div role="alert" className="th-export-error">
            <strong>Export CSV failed</strong>
            <p>{exportError}</p>
            <p className="th-muted">
              No file was produced. The export covers every record matching the applied filters,
              across all pages; if the result set is above the supported size, narrow the date
              range or add a product, status or reference filter.
            </p>
          </div>
        )}
        <p className="th-muted" id="th-export-note">
          Export CSV writes every record matching the applied filters — all pages, not just the
          page on screen — using the same Lagos date boundaries and institution scope as the list.
          Only CSV is supported.
        </p>
      </div>
      <p className="th-muted" role="note">
        Customer Funding includes pending and rejected requests with captured historical custody
        evidence. Requests without trustworthy institution evidence remain hidden from institution
        staff; platform funding is not institution funding.
      </p>
      <section className="th-card">
        <form
          aria-label="Transaction history filters"
          className="th-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ ...draft });
            setCursors(['']);
          }}
        >
          <label>
            From date
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              min={draft.from}
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <label>
            Transaction type
            <select
              aria-label="Transaction type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              <option value="">All supported types</option>
              {Object.entries(types).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {[
                'PENDING',
                'PROCESSING',
                'COMPLETED',
                'FAILED',
                'UNKNOWN',
                'PENDING_RECOVERY',
                'CANCELLED',
                'UNCLAIMED',
                'CLAIMED',
                'EXPIRED',
                'POSTED',
                'REVERSED',
                'RESERVED',
                'SETTLED',
                'RELEASED',
                'APPROVED',
                'REJECTED',
                'EXECUTED',
                'CREDITED',
                'UNVERIFIED',
                'VERIFIED',
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="th-reference">
            Exact reference
            <input
              placeholder="Enter a transaction reference"
              maxLength={255}
              value={draft.reference}
              onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
            />
          </label>
          <button className="th-primary" type="submit">
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(empty);
              setQuery(empty);
              setCursors(['']);
            }}
          >
            Reset
          </button>
        </form>
        <p className="th-muted">
          Dates include the entire selected day in Africa/Lagos (UTC+01:00). Reference search is
          exact. Only authorized institutions are included.
        </p>
      </section>
      <section className="th-card" aria-label="History results" aria-busy={loading}>
        <header className="th-results-heading">
          <h2>Transactions</h2>
          <span className="th-muted">Page {cursors.length} · newest first</span>
        </header>
        {loading ? (
          <p role="status">Loading transaction history…</p>
        ) : error ? (
          <div role="alert">
            <h3>History could not be loaded</h3>
            <p>{error}</p>
            <button onClick={() => setRevision((x) => x + 1)}>Try again</button>
          </div>
        ) : !result?.items.length ? (
          <div className="th-empty">
            <h3>No matching transactions</h3>
            <p>
              Try a wider date range or reset filters. Institution assignments may limit your
              results.
            </p>
          </div>
        ) : (
          <div className="th-table" tabIndex={0} role="region" aria-label="Transaction results">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created · Lagos</th>
                  <th>Amount</th>
                  <th>Fee</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={`${row.type}/${row.id}`}>
                    <td>
                      <code>{row.reference}</code>
                    </td>
                    <td>{types[row.type as keyof typeof types] || row.type}</td>
                    <td>
                      <span className={`th-status th-status--${row.status.toLowerCase()}`}>
                        {row.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td>{date(row.createdAt)}</td>
                    <td>{formatFinancialAmount(row.amountMinor, row.currency)}</td>
                    <td>
                      {row.feeMinor == null
                        ? 'Not recorded'
                        : formatFinancialAmount(row.feeMinor, row.currency)}
                    </td>
                    <td>
                      <a href={transactionDetailLink(row.type, row.id)}>View details</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="th-pager">
          <button
            disabled={loading || cursors.length === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </button>
          <button
            disabled={loading || !result?.nextCursor}
            onClick={() => setCursors((c) => [...c, result!.nextCursor!])}
          >
            Next
          </button>
        </footer>
      </section>
      {key && (
        <WorkspaceDrawer label="Transaction details" onDismiss={close}>
          <div className="th-detail">
            <header className="th-results-heading">
              <div>
                <p className="th-muted">READ-ONLY INVESTIGATION</p>
                <h2>Transaction details</h2>
              </div>
              <button onClick={close}>Close</button>
            </header>
            {detailError ? (
              <p role="alert">{detailError}</p>
            ) : !detail ? (
              <p role="status">Loading transaction details…</p>
            ) : (
              <>
                <h3>{detail.reference}</h3>
                <dl>
                  {Object.entries({
                    'Business transaction ID': detail.id,
                    Type: types[detail.type as keyof typeof types],
                    Status: detail.status,
                    'Created · Lagos': date(detail.createdAt),
                    'Completed · Lagos': detail.completedAt
                      ? date(detail.completedAt)
                      : 'Not recorded',
                    Amount: formatFinancialAmount(detail.amountMinor, detail.currency),
                    Fee:
                      detail.feeMinor == null
                        ? 'Not recorded'
                        : formatFinancialAmount(detail.feeMinor, detail.currency),
                    VAT:
                      detail.vatMinor == null
                        ? 'Not recorded'
                        : formatFinancialAmount(detail.vatMinor, detail.currency),
                    Institution: detail.institutionId || 'Unattributed',
                    ...detail.investigation,
                  }).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
                      <dd>{value || 'Not recorded'}</dd>
                    </div>
                  ))}
                </dl>
                <h3>Receipt & ledger references</h3>
                <p>
                  Reference: <code>{detail.reference}</code>
                </p>
                {canViewLedger && detail.journals ? (
                  detail.journals.filter(Boolean).length ? (
                    detail.journals.filter(Boolean).map((id) => (
                      <p key={id}>
                        <code>{id}</code>
                        {onOpenJournal && (
                          <button type="button" onClick={() => onOpenJournal(id!)}>
                            Open journal
                          </button>
                        )}
                      </p>
                    ))
                  ) : (
                    <p>No journal recorded.</p>
                  )
                ) : (
                  <p>Ledger information requires ledger.view.</p>
                )}
                <p className="th-muted">
                  A recorded lifecycle state is not proof of external settlement. Transfer codes and
                  security credentials are never displayed.
                </p>
              </>
            )}
          </div>
        </WorkspaceDrawer>
      )}
    </div>
  );
}
