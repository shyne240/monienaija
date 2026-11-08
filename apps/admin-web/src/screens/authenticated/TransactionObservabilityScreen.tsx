import './operational-surfaces.css';
import React, { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../design-system/primitives';
import './transaction-workspace.css';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { formatFinancialAmount, formatMinorUnits } from '../../utils/financial-display';

interface TransactionDetail {
  id: string;
  status: string;
  currency: string;
  amountMinor: string;
  reference?: string;
  narration?: string;
  walletId?: string;
  sourceWalletId?: string;
  destinationWalletId?: string;
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
}

interface FeeResult {
  paymentType: string;
  currency: string;
  amountMinor: string;
  feeMinor: string;
  vatMinor: string;
  totalMinor: string;
}

interface CustomerTransaction {
  id: string;
  type: string;
  status: string;
  amountMinor: string;
  currency: string;
  direction: string;
  createdAt: string;
  completedAt: string | null;
  reference: string | null;
  narration: string | null;
  feeMinor: string;
}

interface CustomerTransactionHistoryResponse {
  items: CustomerTransaction[];
  pagination: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean };
}

interface TransactionObservabilityProps {
  initialType?: string;
  initialCustomerId?: string;
  onBackToCustomer?: () => void;
}

/** Convert naira to kobo exactly, without binary floating-point rounding. */
function parseNaira(value: string, label: string): string {
  if (value.trim().length > 40) throw new Error(`${label} exceeds supported integer limits.`);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`${label} must be a non-negative amount with at most two decimal places.`);
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))).toString();
}

export const TransactionObservabilityScreen: React.FC<TransactionObservabilityProps> = ({ initialType, initialCustomerId, onBackToCustomer }) => {
  const { principal, sessionId } = useAuthStore();
  const canViewGlobalTransactions = principal?.scopes.includes('transaction.view') ?? false;
  const canViewCustomerTransactions = principal?.scopes.includes('customer.view_transactions') ?? false;
  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal, initialType, initialCustomerId]);
  const canSimulate = canViewGlobalTransactions && !principal?.readOnlyPrincipal;
  return <TransactionWorkspace key={key} initialType={initialType} initialCustomerId={initialCustomerId} onBackToCustomer={onBackToCustomer} canSimulate={canSimulate} canViewGlobalTransactions={canViewGlobalTransactions} canViewCustomerTransactions={canViewCustomerTransactions} />;
};
const TransactionWorkspace: React.FC<TransactionObservabilityProps & {canViewGlobalTransactions: boolean; canViewCustomerTransactions: boolean; canSimulate: boolean}> = ({initialType, initialCustomerId, onBackToCustomer, canViewGlobalTransactions, canViewCustomerTransactions, canSimulate}) => {
  const traceGeneration = useRef(0);
  const feeGeneration = useRef(0);
  const traceLock = useRef(false);
  const feeLock = useRef(false);
  useEffect(() => () => { traceGeneration.current += 1; feeGeneration.current += 1; }, []);
  const isCustomerHistoryView = Boolean(initialCustomerId) && canViewCustomerTransactions;
  const [searchTxId, setSearchTxId] = useState('');
  const [txType, setTxType] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'>((initialType as any) || 'TRANSFER');
  const [txDetail, setTxDetail] = useState<TransactionDetail | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');

  // Fee Simulator State
  const [amountStr, setAmountStr] = useState('1000');
  const [flatFeeStr, setFlatFeeStr] = useState('50');
  const [percentBpsStr, setPercentBpsStr] = useState('100'); // 1.00%
  const [vatBpsStr, setVatBpsStr] = useState('750'); // 7.50% VAT
  const [feeResult, setFeeResult] = useState<FeeResult | null>(null);
  const [feeError, setFeeError] = useState('');
  const [feeLoading, setFeeLoading] = useState(false);

  // Customer 360° uses the implemented customer-scoped unified history endpoint; a customer UUID
  // is never treated as a transaction UUID.
  const [historyItems, setHistoryItems] = useState<CustomerTransaction[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyType, setHistoryType] = useState('');
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    if (!isCustomerHistoryView || !initialCustomerId) return;
    let active = true;
    const params = new URLSearchParams({ page: String(historyPage), limit: '20' });
    if (historyType) params.set('type', historyType);
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryItems([]);
    setHistoryTotal(0);
    setHistoryTotalPages(0);
    ApiClient.get<CustomerTransactionHistoryResponse>(
      `/internal/customers/${encodeURIComponent(initialCustomerId)}/transactions?${params.toString()}`,
    )
      .then((response) => {
        if (!active) return;
        if (!Array.isArray(response?.items) || response.items.some(item => !item || typeof item.id !== 'string' || typeof item.type !== 'string' || typeof item.status !== 'string' || typeof item.direction !== 'string' || typeof item.currency !== 'string' || typeof item.amountMinor !== 'string' || !/^-?\d+$/.test(item.amountMinor) || typeof item.createdAt !== 'string') || !response?.pagination || !Number.isSafeInteger(response.pagination.total) || response.pagination.total < 0 || response.pagination.page !== historyPage || response.pagination.limit !== 20 || response.items.length > response.pagination.limit || !Number.isSafeInteger(response.pagination.totalPages) || response.pagination.totalPages !== Math.ceil(response.pagination.total / response.pagination.limit) || response.pagination.hasNextPage !== (historyPage < response.pagination.totalPages) || (historyType && response.items.some(item => item.type !== historyType))) {
          throw new Error('Transaction history returned an invalid response.');
        }
        setHistoryItems(response.items);
        setHistoryTotal(response?.pagination?.total ?? 0);
        setHistoryTotalPages(response?.pagination?.totalPages ?? 0);
      })
      .catch((err: any) => {
        if (active) setHistoryError(err?.message || 'Failed to load customer transaction history.');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [isCustomerHistoryView, initialCustomerId, historyPage, historyType]);

  const handleSearchTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewGlobalTransactions || traceLock.current) return;
    if (!searchTxId.trim()) {
      setTxError('Transaction ID (UUID) is required');
      return;
    }
    traceLock.current = true;
    const request = ++traceGeneration.current;
    const requestedId = searchTxId.trim();
    setTxError('');
    setTxDetail(null);
    setTxLoading(true);

    try {
      let endpoint = '';
      if (txType === 'DEPOSIT') endpoint = `/deposits/${encodeURIComponent(requestedId)}`;
      else if (txType === 'WITHDRAWAL') endpoint = `/withdrawals/${encodeURIComponent(requestedId)}`;
      else endpoint = `/transfers/${encodeURIComponent(requestedId)}`;

      const res = await ApiClient.get<TransactionDetail>(endpoint);
      if (request !== traceGeneration.current) return;
      if (!res || res.id !== requestedId || typeof res.status !== 'string' || typeof res.currency !== 'string' || typeof res.amountMinor !== 'string' || !/^-?\d+$/.test(res.amountMinor) || typeof res.createdAt !== 'string') throw new Error('Transaction lookup returned an invalid or mismatched record.');
      setTxDetail(res);
    } catch (err: any) {
      if (request === traceGeneration.current) setTxError(err?.message || 'Transaction record not found.');
    } finally {
      traceLock.current = false;
      if (request === traceGeneration.current) setTxLoading(false);
    }
  };

  const handleCalculateFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSimulate || feeLock.current) return;
    feeLock.current = true;
    const request = ++feeGeneration.current;
    setFeeError('');
    setFeeResult(null);
    setFeeLoading(true);

    try {
      const amountMinor = parseNaira(amountStr, 'Transaction amount');
      const flatFeeMinor = parseNaira(flatFeeStr, 'Flat fee');
      if (BigInt(amountMinor) <= 0n) throw new Error('Transaction amount must be greater than zero.');
      if (!/^\d+$/.test(percentBpsStr.trim()) || !/^\d+$/.test(vatBpsStr.trim())) throw new Error('Fee and VAT basis points must be non-negative whole numbers.');

      const max = 9223372036854775807n;
      if ([amountMinor, flatFeeMinor, percentBpsStr.trim(), vatBpsStr.trim()].some(value => value.length > 40 || BigInt(value) > max)) throw new Error('Simulation values exceed supported integer limits.');
      const expectedFee = BigInt(flatFeeMinor) + BigInt(amountMinor) * BigInt(percentBpsStr.trim()) / 10000n;
      const expectedVat = expectedFee * BigInt(vatBpsStr.trim()) / 10000n;
      const expectedTotal = BigInt(amountMinor) + expectedFee + expectedVat;
      if (expectedTotal > max) throw new Error('Simulation total exceeds supported integer limits.');
      // POST /fees/calculate
      const res = await ApiClient.post<FeeResult>('/fees/calculate', {
        amountMinor,
        currency: 'NGN',
        paymentType: 'VIRTUAL_ACCOUNT',
        flatFeeMinor,
        percentageBps: percentBpsStr,
        vatBps: vatBpsStr,
      });
      if (request !== feeGeneration.current) return;
      if (!res || res.currency !== 'NGN' || res.paymentType !== 'VIRTUAL_ACCOUNT' || res.amountMinor !== amountMinor || ![res.feeMinor, res.vatMinor, res.totalMinor].every(value => typeof value === 'string' && /^\d+$/.test(value) && value.length <= 40) || BigInt(res.feeMinor) !== expectedFee || BigInt(res.vatMinor) !== expectedVat || BigInt(res.totalMinor) !== expectedTotal) throw new Error('Fee simulation returned an invalid or inconsistent result.');
      setFeeResult(res);
    } catch (err: any) {
      if (request === feeGeneration.current) setFeeError(err?.message || 'Fee calculation failed.');
    } finally {
      feeLock.current = false;
      if (request === feeGeneration.current) setFeeLoading(false);
    }
  };

  if (initialCustomerId ? !canViewCustomerTransactions : !canViewGlobalTransactions) {
    return (
      <div className="mn-operational" style={styles.container} role="alert">
        <div style={styles.errorBox}>
          {initialCustomerId
            ? 'Customer transaction history requires customer.view_transactions.'
            : 'Transaction tracing requires transaction.view.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-transactions" style={styles.container}>
      <PageHeader eyebrow="Transactions and finance" title={isCustomerHistoryView ? 'Customer transaction history' : 'Transaction trace & fee simulation'} description={isCustomerHistoryView ? 'Read-only, customer-scoped transaction history from the existing unified history service.' : 'Read-only transaction tracing and fee simulation; no settlement or financial commands run from this screen.'} actions={isCustomerHistoryView && onBackToCustomer ? <button type="button" style={styles.backButton} onClick={onBackToCustomer}>← Back to Customer 360°</button> : undefined} />

      {canViewGlobalTransactions && (
        <div style={styles.gapWarning}>
          <span style={styles.gapTitle}>Global transaction listing unavailable</span>
          <p style={styles.gapText}>
            The transfer controller does not expose a general GET `/transfers` search list route. Querying transfers requires the absolute Transaction UUID reference.
          </p>
        </div>
      )}

      {isCustomerHistoryView && (
        <section style={styles.historySection} aria-label="Customer transaction history">
          <div style={styles.historyHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Transactions for Customer</h2>
              <p style={styles.historyCustomer}>Customer ID: <code>{initialCustomerId}</code></p>
            </div>
            <label style={styles.historyFilterLabel}>
              Type
              <select
                style={styles.historyFilter}
                value={historyType}
                onChange={(event) => { setHistoryType(event.target.value); setHistoryPage(1); }}
              >
                <option value="">All transaction types</option>
                <option value="WALLET_TRANSFER">Wallet transfer</option>
                <option value="CASH_IN">Cash-in</option>
                <option value="CASH_OUT">Cash-out</option>
                <option value="CASH_TO_CASH">Cash-to-cash</option>
                <option value="FUNDING">Funding</option>
              </select>
            </label>
          </div>
          {historyError && <div style={styles.errorBox} role="alert">{historyError}</div>}
          {historyLoading ? <p style={styles.historyEmpty}>Loading transaction history…</p> : historyError ? null : historyItems.length === 0 ? (
            <p style={styles.historyEmpty}>{historyTotal > 0 ? 'No transactions on this page. Return to an earlier page.' : 'No transactions found for this customer and type filter.'}</p>
          ) : (
            <div style={styles.historyTableWrap} role="region" aria-label="Customer transaction history table" tabIndex={0}>
              <table style={styles.historyTable}>
                <thead><tr><th>Type</th><th>Status</th><th>Direction</th><th>Amount</th><th>Reference</th><th>Created</th></tr></thead>
                <tbody>
                  {historyItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.type}</td>
                      <td>{item.status}</td>
                      <td>{item.direction}</td>
                      <td>{formatMinorUnits(item.amountMinor, item.currency)}</td>
                      <td>{item.reference || '—'}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!historyLoading && !historyError && <div style={styles.historyPager}>
            <span>{historyTotal} transaction{historyTotal === 1 ? '' : 's'} · Page {historyPage}{historyTotalPages ? ` of ${historyTotalPages}` : ''}</span>
            <button type="button" style={styles.historyPageButton} disabled={historyPage <= 1 || historyLoading} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>Previous</button>
            <button type="button" style={styles.historyPageButton} disabled={historyPage >= historyTotalPages || historyLoading} onClick={() => setHistoryPage((page) => page + 1)}>Next</button>
          </div>}
        </section>
      )}

      {(canViewGlobalTransactions || !isCustomerHistoryView) && <div style={styles.splitLayout}>
        {/* Transaction Ingress Auditing */}
        {canViewGlobalTransactions && <section className="mn-transactions__panel" style={styles.leftSection} aria-label="Transaction trace">
          <p className="mn-transactions__eyebrow">TRANSACTION LOOKUP</p>
          <h2 style={styles.sectionTitle}>Transaction Audit & Traceability</h2>
          
          <form onSubmit={handleSearchTx} style={styles.searchForm}>
            <div style={styles.grid}>
              <div style={styles.inputGroup}>
                <label htmlFor="transaction-category" style={styles.label}>Select Category</label>
                <select id="transaction-category" style={styles.select} value={txType} disabled={txLoading} onChange={(e: any) => { setTxType(e.target.value); setTxDetail(null); setTxError(''); }}>
                  <option value="TRANSFER">P2P TRANSFER</option>
                  <option value="DEPOSIT">DEPOSIT FUNDING</option>
                  <option value="WITHDRAWAL">WITHDRAWAL OUTFLOW</option>
                </select>
              </div>

              <div style={styles.inputGroup}>
                <label htmlFor="transaction-id" style={styles.label}>Transaction ID (UUID)</label>
                <div style={styles.searchRow}>
                  <input
                    id="transaction-id"
                    type="text"
                    style={styles.input}
                    placeholder="e.g. 5e6f7g8h-..."
                    value={searchTxId}
                    onChange={(e) => { setSearchTxId(e.target.value); setTxDetail(null); setTxError(''); }}
                    disabled={txLoading}
                  />
                  <button type="submit" disabled={txLoading} style={styles.searchBtn}>
                    {txLoading ? 'Tracking...' : 'Track'}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {txError && <div style={styles.errorBox} role="alert">{txError}</div>}

          {txDetail && (
            <div style={styles.txCard}>
              <h4 style={styles.txTitle}>{txType} Detail View</h4>
              <div style={styles.txMetaGrid}>
                <p style={styles.metaItem}><strong>ID:</strong> {txDetail.id}</p>
                <p style={styles.metaItem}><strong>Status:</strong> <span style={txDetail.status === 'SUCCESS' || txDetail.status === 'COMPLETED' ? styles.successStatus : styles.pendingStatus}>{txDetail.status}</span></p>
                <p style={styles.metaItem}><strong>Amount:</strong> {formatMinorUnits(txDetail.amountMinor, txDetail.currency)}</p>
                <p style={styles.metaItem}><strong>Reference:</strong> {txDetail.reference || 'N/A'}</p>
                
                {txDetail.walletId && <p style={styles.metaItem}><strong>Wallet:</strong> {txDetail.walletId}</p>}
                {txDetail.sourceWalletId && <p style={styles.metaItem}><strong>Source Wallet:</strong> {txDetail.sourceWalletId}</p>}
                {txDetail.destinationWalletId && <p style={styles.metaItem}><strong>Dest Wallet:</strong> {txDetail.destinationWalletId}</p>}
                {txDetail.failureReason && <p style={{ ...styles.metaItem, color: 'var(--mn-status-danger, #b3261e)' }}><strong>Failure reason:</strong> {txDetail.failureReason}</p>}
                
                <p style={styles.metaItem}><strong>Created:</strong> {new Date(txDetail.createdAt).toLocaleString()}</p>
                {txDetail.completedAt && <p style={styles.metaItem}><strong>Completed:</strong> {new Date(txDetail.completedAt).toLocaleString()}</p>}
              </div>

              {(txType === 'DEPOSIT' || txType === 'WITHDRAWAL') && txDetail.status === 'PENDING' && (
                <div role="note" style={styles.readOnlyNotice}>
                  This view is read-only. A pending record cannot be completed here and is not evidence of external settlement.
                </div>
              )}
            </div>
          )}
        </section>}

        {/* Fee Simulator Panel */}
        {canViewGlobalTransactions && <section className="mn-transactions__panel" style={styles.rightSection} aria-label="Fee simulation">
          <p className="mn-transactions__eyebrow">HYPOTHETICAL SCENARIO</p>
          <h2 style={styles.sectionTitle}>Pricing Fee Simulator Tool</h2>
          <p style={styles.infoText}>Calculates an NGN virtual-account scenario using the values entered below. These example inputs are not active pricing, a quote, or evidence of a charged fee.</p>
          {!canSimulate && <div role="note" style={styles.readOnlyNotice}>This read-only session cannot run the POST simulation endpoint.</div>}

          {feeError && <div style={styles.errorBox} role="alert">{feeError}</div>}

          <form onSubmit={handleCalculateFee} style={styles.form}>
            <div style={styles.inputGroup}>
              <label htmlFor="fee-amount" style={styles.label}>Transaction Amount (NGN)</label>
              <input
                id="fee-amount"
                type="text" inputMode="decimal"
                style={styles.input}
                value={amountStr}
                onChange={(e) => { setAmountStr(e.target.value); setFeeResult(null); setFeeError(''); }}
                disabled={feeLoading}
              />
            </div>

            <div style={styles.grid}>
              <div style={styles.inputGroup}>
                <label htmlFor="fee-flat" style={styles.label}>Flat Fee Rule (NGN)</label>
                <input
                id="fee-flat"
                  type="text" inputMode="decimal"
                  style={styles.input}
                  value={flatFeeStr}
                  onChange={(e) => { setFlatFeeStr(e.target.value); setFeeResult(null); setFeeError(''); }}
                  disabled={feeLoading}
                />
              </div>

              <div style={styles.inputGroup}>
                <label htmlFor="fee-percent" style={styles.label}>Variable Fee (BPS)</label>
                <input
                id="fee-percent"
                  type="number"
                  style={styles.input}
                  value={percentBpsStr}
                  onChange={(e) => { setPercentBpsStr(e.target.value); setFeeResult(null); setFeeError(''); }}
                  disabled={feeLoading}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="fee-vat" style={styles.label}>VAT Tax Rate (BPS)</label>
              <input
                id="fee-vat"
                type="number"
                style={styles.input}
                value={vatBpsStr}
                onChange={(e) => { setVatBpsStr(e.target.value); setFeeResult(null); setFeeError(''); }}
                disabled={feeLoading}
              />
            </div>

            <button type="submit" disabled={feeLoading || !canSimulate} style={styles.submitBtn}>
              {feeLoading ? 'Calculating...' : 'Run Simulation'}
            </button>
          </form>

          {feeResult && (
            <div style={styles.feeCard}>
              <h4 style={styles.feeTitle}>Fee Calculation Results</h4>
              <div style={styles.feeMetaGrid}>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Calculated Net Fee:</span>
                  <span style={styles.feeValue}>{formatFinancialAmount(feeResult.feeMinor, 'NGN')}</span>
                </div>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Calculated Tax (VAT):</span>
                  <span style={styles.feeValue}>{formatFinancialAmount(feeResult.vatMinor, 'NGN')}</span>
                </div>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Total Gross Outflow:</span>
                  <span style={styles.feeValue}>{formatFinancialAmount(feeResult.totalMinor, 'NGN')}</span>
                </div>
              </div>
            </div>
          )}
        </section>}
      </div>}
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
  backButton: {
    marginTop: '10px',
    padding: '7px 10px',
    border: '1px solid #D1D5DB',
    borderRadius: '6px',
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    cursor: 'pointer',
  },
  historySection: {
    marginBottom: '24px',
    padding: '20px',
    background: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '8px',
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '16px',
  },
  historyCustomer: {
    margin: '-8px 0 0',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: '12px',
    wordBreak: 'break-all' as const,
  },
  historyFilterLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: '12px',
  },
  historyFilter: {
    minWidth: '180px',
    height: '36px',
    border: '1px solid #CBD5E1',
    borderRadius: '6px',
    padding: '0 8px',
    background: '#FFFFFF',
  },
  historyTableWrap: {
    overflowX: 'auto' as const,
  },
  historyTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
    textAlign: 'left' as const,
  },
  historyEmpty: {
    padding: '16px',
    color: 'var(--mn-text-secondary, #52655f)',
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '6px',
    fontSize: '13px',
  },
  historyPager: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: '12px',
  },
  historyPageButton: {
    padding: '6px 10px',
    border: '1px solid #CBD5E1',
    borderRadius: '5px',
    background: '#FFFFFF',
    cursor: 'pointer',
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
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 16px 0',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    paddingBottom: '8px',
  },
  searchForm: {
    marginBottom: '20px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
    gap: '16px',
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
  select: {
    height: '38px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '13px',
    backgroundColor: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
  },
  searchRow: {
    display: 'flex',
    gap: '10px',
  },
  input: {
    flex: 1,
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
    padding: '0 16px',
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
  txCard: {
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '16px',
  },
  txTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 12px 0',
    borderBottom: '1px dashed #CBD5E1',
    paddingBottom: '6px',
  },
  txMetaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  metaItem: {
    fontSize: '11px',
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
    wordBreak: 'break-all' as const,
  },
  successStatus: {
    color: 'var(--mn-status-success, #146348)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  pendingStatus: {
    color: 'var(--mn-status-warning, #8c5600)',
    fontWeight: 'bold',
    backgroundColor: 'var(--mn-status-warning-bg, #fff3d9)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  readOnlyNotice: {
    marginTop: '16px',
    padding: '12px',
    border: '1px solid var(--mn-status-warning, #8c5600)',
    borderRadius: '6px',
    backgroundColor: '#FFFBEB',
    color: '#92400E',
    fontSize: '12px',
    lineHeight: '18px',
  },
  rightSection: {
    flex: '1 1 340px',
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '8px',
    padding: '20px',
  },
  infoText: {
    fontSize: '13px',
    color: 'var(--mn-text-secondary, #52655f)',
    lineHeight: '18px',
    margin: '0 0 16px 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  submitBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-start',
    minWidth: '160px',
  },
  feeCard: {
    marginTop: '20px',
    backgroundColor: 'var(--mn-surface-canvas, #f5f8f6)',
    borderRadius: '8px',
    border: '1px solid #CBD5E1',
    padding: '16px',
  },
  feeTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 12px 0',
  },
  feeMetaGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  feeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  feeLabel: {
    color: 'var(--mn-text-secondary, #52655f)',
    fontWeight: '500',
  },
  feeValue: {
    color: 'var(--mn-action-primary, #0b624a)',
    fontWeight: '700',
  },
};
