import React, { useState, useEffect } from 'react';
import { ApiClient, ApiError } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';

interface Customer {
  id: string;
  reference: string;
  type: string;
  status: string;
  actor: string;
  createdAt: string;
}

interface Wallet {
  id: string;
  customerId: string;
  type: string;
  currency: string;
  status: string;
  balanceMinor: number;
}

interface KycRecord {
  id: string;
  level: string;
  status: string;
  reason?: string;
  assessedBy: string;
  expiresAt?: string;
  createdAt: string;
}

export const CustomerDirectoryScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [searchType, setSearchType] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create Customer Form State
  const [showCreate, setShowCreate] = useState(false);
  const [reference, setReference] = useState('');
  const [custType, setCustType] = useState('INDIVIDUAL');
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Selected Customer Detail State
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [kyc, setKyc] = useState<KycRecord | null>(null);
  const [detailError, setDetailError] = useState('');

  // Wallet Provision State
  const [walletCurrency, setWalletCurrency] = useState('NGN');
  const [walletType, setWalletType] = useState('PRIMARY');
  const [walletSuccess, setWalletSuccess] = useState('');

  // KYC Assessment Form State
  const [kycLevel, setKycLevel] = useState('LEVEL_1');
  const [kycStatus, setKycStatus] = useState('APPROVED');
  const [kycReason, setKycReason] = useState('');
  const [kycSuccess, setKycSuccess] = useState('');

  // Status Update State
  const [statusSuccess, setStatusSuccess] = useState('');

  // Check roles permissions
  const isPreparer = principal?.roles.includes('FINANCE_PREPARER') || principal?.roles.includes('FINANCE_ADMIN') || principal?.scopes.includes('finance:prepare');
  const isController = principal?.roles.includes('FINANCE_CONTROLLER') || principal?.scopes.includes('privileged:approve');
  const isAuditor = principal?.roles.includes('FINANCE_AUDITOR') || principal?.scopes.includes('finance:audit');

  const fetchCustomers = async () => {
    setIsLoading(true);
    setError('');
    try {
      // GET /customers
      const params = [];
      if (searchStatus) params.push(`status=${searchStatus}`);
      if (searchType) params.push(`type=${searchType}`);
      const query = params.length > 0 ? `?${params.join('&')}` : '';
      
      const list = await ApiClient.get<Customer[]>(`/customers${query}`);
      setCustomers(list || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to retrieve customer directory.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [searchStatus, searchType]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reference.trim()) {
      setCreateError('Customer Reference is required');
      return;
    }
    setCreateError('');
    setCreateSuccess('');

    try {
      // POST /customers
      const res = await ApiClient.post<Customer>('/customers', {
        reference: reference.trim(),
        type: custType,
        status: 'ACTIVE',
        actor: principal?.principalId || 'Back-Office Operator',
      });
      setCreateSuccess(`Customer created successfully! ID: ${res.id}`);
      setReference('');
      fetchCustomers();
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create customer');
    }
  };

  const handleLoadDetails = async (customer: Customer) => {
    setSelectedCust(customer);
    setWallets([]);
    setKyc(null);
    setDetailError('');
    setWalletSuccess('');
    setKycSuccess('');
    setStatusSuccess('');

    try {
      // GET /customers/:id/wallets
      const walletList = await ApiClient.get<Wallet[]>(`/customers/${customer.id}/wallets`);
      setWallets(walletList || []);

      // GET /customers/:id/kyc
      try {
        const kycRecord = await ApiClient.get<KycRecord>(`/customers/${customer.id}/kyc`);
        setKyc(kycRecord);
      } catch {
        // Fallback for null/empty KYC records
        setKyc(null);
      }
    } catch (err: any) {
      setDetailError('Error retrieving details: ' + (err?.message || ''));
    }
  };

  const handleProvisionWallet = async () => {
    if (!selectedCust) return;
    setDetailError('');
    setWalletSuccess('');
    try {
      // POST /customers/:id/wallets
      await ApiClient.post(`/customers/${selectedCust.id}/wallets`, {
        type: walletType,
        currency: walletCurrency,
        status: 'ACTIVE',
        actor: principal?.principalId || 'Back-Office Operator',
      });
      setWalletSuccess('NGN Wallet provisioned successfully!');
      
      // Reload wallets
      const walletList = await ApiClient.get<Wallet[]>(`/customers/${selectedCust.id}/wallets`);
      setWallets(walletList || []);
    } catch (err: any) {
      setDetailError(err?.message || 'Wallet provisioning failed');
    }
  };

  const handleUpdateKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCust) return;
    setDetailError('');
    setKycSuccess('');
    try {
      // POST /customers/:id/kyc-assessment
      const record = await ApiClient.post<KycRecord>(`/customers/${selectedCust.id}/kyc-assessment`, {
        level: kycLevel,
        status: kycStatus,
        reason: kycReason.trim() || undefined,
        assessedBy: principal?.principalId || 'Back-Office Compliance Officer',
      });
      setKycSuccess('KYC Assessment verified successfully!');
      setKyc(record);
      setKycReason('');
    } catch (err: any) {
      setDetailError(err?.message || 'KYC Assessment submission failed');
    }
  };

  const handleUpdateStatus = async (newStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') => {
    if (!selectedCust) return;
    setDetailError('');
    setStatusSuccess('');
    try {
      // PATCH /customers/:id
      const res = await ApiClient.patch<Customer>(`/customers/${selectedCust.id}`, {
        status: newStatus,
        actor: principal?.principalId || 'Back-Office Operator',
      });
      setStatusSuccess(`Customer status locked to ${newStatus} successfully.`);
      setSelectedCust(res);
      fetchCustomers();
    } catch (err: any) {
      setDetailError(err?.message || 'Customer status update failed');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Customer Directory & Servicing</h2>
        <p style={styles.subtitle}>Manage profiles, KYC assessment verifications, and wallet bindings</p>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.actionRow}>
        <div style={styles.filterGroup}>
          <select style={styles.select} value={searchStatus} onChange={(e) => setSearchStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="DRAFT">DRAFT</option>
          </select>
          <select style={styles.select} value={searchType} onChange={(e) => setSearchType(e.target.value)}>
            <option value="">All Types</option>
            <option value="INDIVIDUAL">INDIVIDUAL</option>
            <option value="BUSINESS">BUSINESS</option>
          </select>
        </div>

        {isPreparer && (
          <button style={styles.createBtn} onClick={() => { setShowCreate(!showCreate); setCreateSuccess(''); setCreateError(''); }}>
            {showCreate ? 'Close Register Form' : '➕ Register Customer'}
          </button>
        )}
      </div>

      {showCreate && (
        <div style={styles.formCard}>
          <h3 style={styles.cardTitle}>Register New Customer Profile</h3>
          {createError && <div style={styles.errorBox}>{createError}</div>}
          {createSuccess && <div style={styles.successBox}>{createSuccess}</div>}
          <form onSubmit={handleCreateCustomer} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Unique Customer Reference (Phone or Unique tag)</label>
              <input
                type="text"
                style={styles.input}
                placeholder="e.g. MN-08012345678"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Select Customer Segment Type</label>
              <select style={styles.select} value={custType} onChange={(e) => setCustType(e.target.value)}>
                <option value="INDIVIDUAL">INDIVIDUAL</option>
                <option value="BUSINESS">BUSINESS</option>
              </select>
            </div>
            <button type="submit" style={styles.submitBtn}>Register Profile</button>
          </form>
        </div>
      )}

      {/* Main Layout Split */}
      <div style={styles.splitLayout}>
        {/* Customer List */}
        <div style={styles.listSection}>
          <h3 style={styles.sectionTitle}>Registered Customers</h3>
          {isLoading ? (
            <p style={styles.loadingText}>Fetching profiles...</p>
          ) : customers.length === 0 ? (
            <p style={styles.emptyText}>No customers matching filters found.</p>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.thRow}>
                    <th style={styles.th}>Reference</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} style={selectedCust?.id === c.id ? styles.selectedRow : styles.row}>
                      <td style={styles.td}>{c.reference}</td>
                      <td style={styles.td}>{c.type}</td>
                      <td style={styles.td}>
                        <span style={c.status === 'ACTIVE' ? styles.activeStatus : styles.inactiveStatus}>
                          {c.status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button style={styles.viewBtn} onClick={() => handleLoadDetails(c)}>View & Service</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Selected Customer Details */}
        {selectedCust && (
          <div style={styles.detailsSection}>
            <h3 style={styles.sectionTitle}>Servicing Principal: {selectedCust.reference}</h3>
            {detailError && <div style={styles.errorBox}>{detailError}</div>}
            
            <div style={styles.detailsCard}>
              <div style={styles.metaBlock}>
                <h4 style={styles.blockTitle}>Profile Metadata</h4>
                <p style={styles.metaItem}><strong>Customer ID:</strong> {selectedCust.id}</p>
                <p style={styles.metaItem}><strong>Segment Type:</strong> {selectedCust.type}</p>
                <p style={styles.metaItem}><strong>Status:</strong> {selectedCust.status}</p>
                <p style={styles.metaItem}><strong>Registered On:</strong> {new Date(selectedCust.createdAt).toLocaleString()}</p>
                
                {isPreparer && (
                  <div style={styles.statusToggleBlock}>
                    <span style={styles.label}>Lock/Unlock Profile:</span>
                    <div style={styles.btnRow}>
                      <button style={styles.activeBtn} onClick={() => handleUpdateStatus('ACTIVE')}>ACTIVE</button>
                      <button style={styles.suspendBtn} onClick={() => handleUpdateStatus('SUSPENDED')}>SUSPEND</button>
                      <button style={styles.closeBtn} onClick={() => handleUpdateStatus('CLOSED')}>CLOSE</button>
                    </div>
                    {statusSuccess && <p style={styles.inlineSuccess}>{statusSuccess}</p>}
                  </div>
                )}
              </div>

              {/* Wallets Binding */}
              <div style={styles.metaBlock}>
                <h4 style={styles.blockTitle}>Preserved Wallet Bindings</h4>
                {walletSuccess && <div style={styles.successBox}>{walletSuccess}</div>}
                
                {wallets.length === 0 ? (
                  <p style={styles.emptyText}>No active wallet bindings found.</p>
                ) : (
                  wallets.map((w) => (
                    <div key={w.id} style={styles.walletRow}>
                      <div>
                        <span style={styles.walletId}>ID: {w.id}</span>
                        <span style={styles.walletMeta}>{w.type} / {w.currency} ({w.status})</span>
                      </div>
                      <span style={styles.walletBalance}>
                        ₦{(w.balanceMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))
                )}

                {isPreparer && (
                  <div style={styles.provisionBlock}>
                    <h5 style={styles.subBlockTitle}>Provision NGN Wallet</h5>
                    <div style={styles.grid}>
                      <select style={styles.select} value={walletType} onChange={(e) => setWalletType(e.target.value)}>
                        <option value="PRIMARY">PRIMARY</option>
                        <option value="SAVINGS">SAVINGS</option>
                        <option value="BUSINESS">BUSINESS</option>
                      </select>
                      <button style={styles.submitBtn} onClick={handleProvisionWallet}>Provision Wallet</button>
                    </div>
                  </div>
                )}
              </div>

              {/* KYC Assessment */}
              <div style={styles.metaBlock}>
                <h4 style={styles.blockTitle}>KYC Assessment & Verifications</h4>
                {kycSuccess && <div style={styles.successBox}>{kycSuccess}</div>}

                {kyc ? (
                  <div style={styles.kycInfo}>
                    <p style={styles.metaItem}><strong>KYC Level:</strong> {kyc.level}</p>
                    <p style={styles.metaItem}><strong>Status:</strong> <span style={kyc.status === 'APPROVED' ? styles.activeStatus : styles.inactiveStatus}>{kyc.status}</span></p>
                    {kyc.reason && <p style={styles.metaItem}><strong>Auditing Reason:</strong> {kyc.reason}</p>}
                    <p style={styles.metaItem}><strong>Assessed By:</strong> {kyc.assessedBy}</p>
                  </div>
                ) : (
                  <p style={styles.emptyText}>No KYC verification assessment recorded.</p>
                )}

                {isPreparer && (
                  <form onSubmit={handleUpdateKyc} style={styles.kycForm}>
                    <h5 style={styles.subBlockTitle}>Submit KYC Assessment</h5>
                    <div style={styles.grid}>
                      <select style={styles.select} value={kycLevel} onChange={(e) => setKycLevel(e.target.value)}>
                        <option value="LEVEL_1">LEVEL 1</option>
                        <option value="LEVEL_2">LEVEL 2</option>
                        <option value="LEVEL_3">LEVEL 3</option>
                      </select>
                      <select style={styles.select} value={kycStatus} onChange={(e) => setKycStatus(e.target.value)}>
                        <option value="APPROVED">APPROVED</option>
                        <option value="PENDING">PENDING</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    </div>
                    <div style={{ ...styles.inputGroup, marginTop: '10px' }}>
                      <label style={styles.label}>Audit Reason for Assessment Decision</label>
                      <input
                        type="text"
                        style={styles.input}
                        placeholder="e.g. Identity documents successfully verified"
                        value={kycReason}
                        onChange={(e) => setKycReason(e.target.value)}
                      />
                    </div>
                    <button type="submit" style={{ ...styles.submitBtn, marginTop: '10px' }}>Submit KYC Assessment</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
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
  actionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  filterGroup: {
    display: 'flex',
    gap: '12px',
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
  createBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '20px',
    marginBottom: '24px',
    maxWidth: '600px',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 16px 0',
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: '8px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
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
  input: {
    height: '38px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '13px',
    color: '#1E293B',
  },
  submitBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-start',
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
  splitLayout: {
    display: 'flex',
    gap: '24px',
    alignItems: 'flex-start',
  },
  listSection: {
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
  row: {
    borderBottom: '1px solid #F1F5F9',
  },
  selectedRow: {
    borderBottom: '1px solid #F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  td: {
    padding: '12px 10px',
    color: '#334155',
  },
  activeStatus: {
    color: '#10B981',
    fontWeight: 'bold',
    backgroundColor: '#D1FAE5',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
  },
  inactiveStatus: {
    color: '#EF4444',
    fontWeight: 'bold',
    backgroundColor: '#FEE2E2',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
  },
  viewBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #0A3D25',
    color: '#0A3D25',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  detailsSection: {
    width: '460px',
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
  },
  detailsCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  metaBlock: {
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: '16px',
  },
  blockTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 12px 0',
  },
  metaItem: {
    fontSize: '13px',
    color: '#334155',
    margin: '0 0 8px 0',
  },
  statusToggleBlock: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px dashed #E2E8F0',
  },
  btnRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '6px',
  },
  activeBtn: {
    backgroundColor: '#10B981',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  suspendBtn: {
    backgroundColor: '#F59E0B',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  closeBtn: {
    backgroundColor: '#EF4444',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  inlineSuccess: {
    color: '#10B981',
    fontSize: '11px',
    fontWeight: '600',
    margin: '6px 0 0 0',
  },
  walletRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '10px',
    marginBottom: '8px',
    border: '1px solid #E2E8F0',
  },
  walletId: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#1E293B',
    display: 'block',
  },
  walletMeta: {
    fontSize: '10px',
    color: '#64748B',
    display: 'block',
  },
  walletBalance: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#0A3D25',
  },
  provisionBlock: {
    marginTop: '12px',
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '12px',
    border: '1px dashed #CBD5E1',
  },
  subBlockTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#475569',
    margin: '0 0 8px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  kycInfo: {
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '12px',
    border: '1px solid #E2E8F0',
  },
  kycForm: {
    marginTop: '12px',
    backgroundColor: '#F8FAFC',
    borderRadius: '6px',
    padding: '12px',
    border: '1px dashed #CBD5E1',
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
    margin: '8px 0',
  },
};
