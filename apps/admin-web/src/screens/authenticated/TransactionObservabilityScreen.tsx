import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

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

export const TransactionObservabilityScreen: React.FC<TransactionObservabilityProps> = ({ initialType, initialCustomerId, onBackToCustomer }) => {
  const { principal } = useAuthStore();
  const canViewGlobalTransactions = principal?.scopes.includes('transaction.view') ?? false;
  const canViewCustomerTransactions = principal?.scopes.includes('customer.view_transactions') ?? false;
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
    ApiClient.get<CustomerTransactionHistoryResponse>(
      `/internal/customers/${encodeURIComponent(initialCustomerId)}/transactions?${params.toString()}`,
    )
      .then((response) => {
        if (!active) return;
        setHistoryItems(response?.items ?? []);
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
    if (!canViewGlobalTransactions) return;
    if (!searchTxId.trim()) {
      setTxError('Transaction ID (UUID) is required');
      return;
    }
    setTxError('');
    setTxDetail(null);
    setTxLoading(true);

    try {
      let endpoint = '';
      if (txType === 'DEPOSIT') endpoint = `/deposits/${searchTxId.trim()}`;
      else if (txType === 'WITHDRAWAL') endpoint = `/withdrawals/${searchTxId.trim()}`;
      else endpoint = `/transfers/${searchTxId.trim()}`;

      const res = await ApiClient.get<TransactionDetail>(endpoint);
      setTxDetail(res);
    } catch (err: any) {
      setTxError(err?.message || 'Transaction record not found.');
    } finally {
      setTxLoading(false);
    }
  };

  const handleCalculateFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canViewGlobalTransactions) return;
    setFeeError('');
    setFeeResult(null);
    setFeeLoading(true);

    try {
      const amountMinor = Math.round(parseFloat(amountStr) * 100).toString();
      const flatFeeMinor = Math.round(parseFloat(flatFeeStr) * 100).toString();

      // POST /fees/calculate
      const res = await ApiClient.post<FeeResult>('/fees/calculate', {
        amountMinor,
        currency: 'NGN',
        paymentType: 'VIRTUAL_ACCOUNT',
        flatFeeMinor,
        percentageBps: percentBpsStr,
        vatBps: vatBpsStr,
      });
      setFeeResult(res);
    } catch (err: any) {
      setFeeError(err?.message || 'Fee calculation failed.');
    } finally {
      setFeeLoading(false);
    }
  };

  if (initialCustomerId ? !canViewCustomerTransactions : !canViewGlobalTransactions) {
    return (
      <div style={styles.container} role="alert">
        <div style={styles.errorBox}>
          {initialCustomerId
            ? 'Customer transaction history requires customer.view_transactions.'
            : 'Transaction tracing requires transaction.view.'}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>{isCustomerHistoryView ? 'Customer Transaction History' : 'In-House Transaction & Fee Operations'}</h2>
        <p style={styles.subtitle}>
          {isCustomerHistoryView
            ? 'Read-only, customer-scoped transaction history from the existing unified history service.'
            : 'Read-only transaction tracing and fee simulation; no settlement or financial commands run from this screen.'}
        </p>
        {isCustomerHistoryView && onBackToCustomer && (
          <button type="button" style={styles.backButton} onClick={onBackToCustomer}>← Back to Customer 360°</button>
        )}
      </div>

      {canViewGlobalTransactions && (
        <div style={styles.gapWarning}>
          <span style={styles.gapTitle}>⚠️ ADMIN API GAP: Global Transactions Search Listing Unavailable</span>
          <p style={styles.gapText}>
            The transfer controller does not expose a general GET `/transfers` search list route. Querying transfers requires the absolute Transaction UUID reference.
          </p>
        </div>
      )}

      {isCustomerHistoryView && (
        <section style={styles.historySection} aria-label="Customer transaction history">
          <div style={styles.historyHeader}>
            <div>
              <h3 style={styles.sectionTitle}>Transactions for Customer</h3>
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
          {historyError && <div style={styles.errorBox}>{historyError}</div>}
          {historyLoading ? <p style={styles.historyEmpty}>Loading transaction history…</p> : historyItems.length === 0 ? (
            <p style={styles.historyEmpty}>No transactions found for this customer and type filter.</p>
          ) : (
            <div style={styles.historyTableWrap}>
              <table style={styles.historyTable}>
                <thead><tr><th>Type</th><th>Status</th><th>Direction</th><th>Amount</th><th>Reference</th><th>Created</th></tr></thead>
                <tbody>
                  {historyItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.type}</td>
                      <td>{item.status}</td>
                      <td>{item.direction}</td>
                      <td>{item.currency} {(Number(item.amountMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
                      <td>{item.reference || '—'}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={styles.historyPager}>
            <span>{historyTotal} transaction{historyTotal === 1 ? '' : 's'} · Page {historyPage}{historyTotalPages ? ` of ${historyTotalPages}` : ''}</span>
            <button type="button" style={styles.historyPageButton} disabled={historyPage <= 1 || historyLoading} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>Previous</button>
            <button type="button" style={styles.historyPageButton} disabled={historyPage >= historyTotalPages || historyLoading} onClick={() => setHistoryPage((page) => page + 1)}>Next</button>
          </div>
        </section>
      )}

      {(canViewGlobalTransactions || !isCustomerHistoryView) && <div style={styles.splitLayout}>
        {/* Transaction Ingress Auditing */}
        {canViewGlobalTransactions && <div style={styles.leftSection}>
          <h3 style={styles.sectionTitle}>Transaction Audit & Traceability</h3>
          
          <form onSubmit={handleSearchTx} style={styles.searchForm}>
            <div style={styles.grid}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Select Category</label>
                <select style={styles.select} value={txType} onChange={(e: any) => setTxType(e.target.value)}>
                  <option value="TRANSFER">P2P TRANSFER</option>
                  <option value="DEPOSIT">DEPOSIT FUNDING</option>
                  <option value="WITHDRAWAL">WITHDRAWAL OUTFLOW</option>
                </select>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Transaction ID (UUID)</label>
                <div style={styles.searchRow}>
                  <input
                    type="text"
                    style={styles.input}
                    placeholder="e.g. 5e6f7g8h-..."
                    value={searchTxId}
                    onChange={(e) => setSearchTxId(e.target.value)}
                    disabled={txLoading}
                  />
                  <button type="submit" disabled={txLoading} style={styles.searchBtn}>
                    {txLoading ? 'Tracking...' : 'Track'}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {txError && <div style={styles.errorBox}>{txError}</div>}

          {txDetail && (
            <div style={styles.txCard}>
              <h4 style={styles.txTitle}>{txType} Detail View</h4>
              <div style={styles.txMetaGrid}>
                <p style={styles.metaItem}><strong>ID:</strong> {txDetail.id}</p>
                <p style={styles.metaItem}><strong>Status:</strong> <span style={txDetail.status === 'SUCCESS' || txDetail.status === 'COMPLETED' ? styles.successStatus : styles.pendingStatus}>{txDetail.status}</span></p>
                <p style={styles.metaItem}><strong>Amount:</strong> ₦{(parseFloat(txDetail.amountMinor || '0') / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p>
                <p style={styles.metaItem}><strong>Reference:</strong> {txDetail.reference || 'N/A'}</p>
                
                {txDetail.walletId && <p style={styles.metaItem}><strong>Wallet:</strong> {txDetail.walletId}</p>}
                {txDetail.sourceWalletId && <p style={styles.metaItem}><strong>Source Wallet:</strong> {txDetail.sourceWalletId}</p>}
                {txDetail.destinationWalletId && <p style={styles.metaItem}><strong>Dest Wallet:</strong> {txDetail.destinationWalletId}</p>}
                {txDetail.failureReason && <p style={{ ...styles.metaItem, color: '#EF4444' }}><strong>Failure reason:</strong> {txDetail.failureReason}</p>}
                
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
        </div>}

        {/* Fee Simulator Panel */}
        {canViewGlobalTransactions && <div style={styles.rightSection}>
          <h3 style={styles.sectionTitle}>Pricing Fee Simulator Tool</h3>
          <p style={styles.infoText}>Deterministic pricing fee engine simulator executing the backend math endpoint.</p>

          {feeError && <div style={styles.errorBox}>{feeError}</div>}

          <form onSubmit={handleCalculateFee} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Transaction Amount (NGN)</label>
              <input
                type="number"
                style={styles.input}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={feeLoading}
              />
            </div>

            <div style={styles.grid}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Flat Fee Rule (NGN)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={flatFeeStr}
                  onChange={(e) => setFlatFeeStr(e.target.value)}
                  disabled={feeLoading}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Variable Fee (BPS)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={percentBpsStr}
                  onChange={(e) => setPercentBpsStr(e.target.value)}
                  disabled={feeLoading}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>VAT Tax Rate (BPS)</label>
              <input
                type="number"
                style={styles.input}
                value={vatBpsStr}
                onChange={(e) => setVatBpsStr(e.target.value)}
                disabled={feeLoading}
              />
            </div>

            <button type="submit" disabled={feeLoading} style={styles.submitBtn}>
              {feeLoading ? 'Calculating...' : 'Run Simulation'}
            </button>
          </form>

          {feeResult && (
            <div style={styles.feeCard}>
              <h4 style={styles.feeTitle}>Fee Calculation Results</h4>
              <div style={styles.feeMetaGrid}>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Calculated Net Fee:</span>
                  <span style={styles.feeValue}>₦{(parseFloat(feeResult.feeMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Calculated Tax (VAT):</span>
                  <span style={styles.feeValue}>₦{(parseFloat(feeResult.vatMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={styles.feeRow}>
                  <span style={styles.feeLabel}>Total Gross Outflow:</span>
                  <span style={styles.feeValue}>₦{(parseFloat(feeResult.totalMinor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}
        </div>}
      </div>}
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
  backButton: {
    marginTop: '10px',
    padding: '7px 10px',
    border: '1px solid #D1D5DB',
    borderRadius: '6px',
    background: '#FFFFFF',
    color: '#334155',
    cursor: 'pointer',
  },
  historySection: {
    marginBottom: '24px',
    padding: '20px',
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
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
    color: '#64748B',
    fontSize: '12px',
    wordBreak: 'break-all' as const,
  },
  historyFilterLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    color: '#475569',
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
    color: '#64748B',
    background: '#F8FAFC',
    borderRadius: '6px',
    fontSize: '13px',
  },
  historyPager: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    color: '#64748B',
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
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 16px 0',
    borderBottom: '1px solid #E2E8F0',
    paddingBottom: '8px',
  },
  searchForm: {
    marginBottom: '20px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
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
    color: '#475569',
    marginBottom: '6px',
  },
  select: {
    height: '38px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '13px',
    backgroundColor: '#FFFFFF',
    color: '#334155',
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
  txCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '16px',
  },
  txTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 12px 0',
    borderBottom: '1px dashed #CBD5E1',
    paddingBottom: '6px',
  },
  txMetaGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '16px',
  },
  metaItem: {
    fontSize: '11px',
    color: '#475569',
    margin: 0,
    wordBreak: 'break-all' as const,
  },
  successStatus: {
    color: '#10B981',
    fontWeight: 'bold',
    backgroundColor: '#D1FAE5',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  pendingStatus: {
    color: '#F59E0B',
    fontWeight: 'bold',
    backgroundColor: '#FEF3C7',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  readOnlyNotice: {
    marginTop: '16px',
    padding: '12px',
    border: '1px solid #F59E0B',
    borderRadius: '6px',
    backgroundColor: '#FFFBEB',
    color: '#92400E',
    fontSize: '12px',
    lineHeight: '18px',
  },
  rightSection: {
    width: '460px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
  },
  infoText: {
    fontSize: '13px',
    color: '#64748B',
    lineHeight: '18px',
    margin: '0 0 16px 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  submitBtn: {
    backgroundColor: '#0A3D25',
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
    backgroundColor: '#F8FAFC',
    borderRadius: '8px',
    border: '1px solid #CBD5E1',
    padding: '16px',
  },
  feeTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1E293B',
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
    color: '#64748B',
    fontWeight: '500',
  },
  feeValue: {
    color: '#0A3D25',
    fontWeight: '700',
  },
};
