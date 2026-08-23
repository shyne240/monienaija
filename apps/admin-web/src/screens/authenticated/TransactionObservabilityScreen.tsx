import React, { useState } from 'react';
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

export const TransactionObservabilityScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const [searchTxId, setSearchTxId] = useState('');
  const [txType, setTxType] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'>('TRANSFER');
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

  // Sandbox Utilities State
  const [sandboxSuccess, setSandboxSuccess] = useState('');
  const [sandboxError, setSandboxError] = useState('');
  const [sandboxLoading, setSandboxLoading] = useState(false);

  // Check roles
  const isController = principal?.roles.includes('FINANCE_CONTROLLER') || principal?.scopes.includes('privileged:approve');
  const isPreparer = principal?.roles.includes('FINANCE_PREPARER') || principal?.roles.includes('FINANCE_ADMIN') || principal?.scopes.includes('finance:prepare');

  const handleSearchTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTxId.trim()) {
      setTxError('Transaction ID (UUID) is required');
      return;
    }
    setTxError('');
    setTxDetail(null);
    setTxLoading(true);
    setSandboxSuccess('');
    setSandboxError('');

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

  const handleExecuteSandboxComplete = async () => {
    if (!txDetail) return;
    setSandboxError('');
    setSandboxSuccess('');
    setSandboxLoading(true);

    try {
      let endpoint = '';
      if (txType === 'DEPOSIT') {
        endpoint = `/deposits/${txDetail.id}/complete`;
      } else if (txType === 'WITHDRAWAL') {
        endpoint = `/withdrawals/${txDetail.id}/complete`;
      } else {
        throw new Error('Sandbox completion override is not applicable to P2P Transfers.');
      }

      // POST /deposits/:id/complete or /withdrawals/:id/complete
      await ApiClient.post(endpoint);
      setSandboxSuccess('Sandbox simulated transaction completed successfully!');
      
      // Reload transaction state
      const reloadEndpoint = txType === 'DEPOSIT' ? `/deposits/${txDetail.id}` : `/withdrawals/${txDetail.id}`;
      const res = await ApiClient.get<TransactionDetail>(reloadEndpoint);
      setTxDetail(res);
    } catch (err: any) {
      console.error('SANDBOX OVERRIDE ERROR:', err);
      setSandboxError(err?.message || 'Sandbox execution command rejected.');
    } finally {
      setSandboxLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>In-House Transaction & Fee Operations</h2>
        <p style={styles.subtitle}>Trace transaction states, simulate fee pricing rules, and trigger sandbox overrides</p>
      </div>

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>⚠️ ADMIN API GAP: Global Transactions Search Listing Unavailable</span>
        <p style={styles.gapText}>
          The transfer controller does not expose a general GET `/transfers` search list route. Querying transfers requires the absolute Transaction UUID reference.
        </p>
      </div>

      <div style={styles.splitLayout}>
        {/* Transaction Ingress Auditing */}
        <div style={styles.leftSection}>
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

              {sandboxError && <div style={styles.errorBox}>{sandboxError}</div>}
              {sandboxSuccess && <div style={styles.successBox}>{sandboxSuccess}</div>}

              {/* Sandbox Complete override button for Deposit/Withdrawal */}
              {(txType === 'DEPOSIT' || txType === 'WITHDRAWAL') && txDetail.status === 'PENDING' && isController && (
                <div style={styles.sandboxUtilities}>
                  <h5 style={styles.sandboxTitle}>⚙️ Sandbox Simulated Completion Utilities</h5>

                  <button
                    disabled={sandboxLoading}
                    onClick={handleExecuteSandboxComplete}
                    style={styles.sandboxActionBtn}
                  >
                    {sandboxLoading ? 'Processing Override...' : 'Trigger Sandbox Completion'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fee Simulator Panel */}
        <div style={styles.rightSection}>
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
  sandboxUtilities: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px dashed #CBD5E1',
  },
  sandboxTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#D97706',
    margin: '0 0 12px 0',
  },
  sandboxActionBtn: {
    backgroundColor: '#FFB703',
    color: '#032B14',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
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
