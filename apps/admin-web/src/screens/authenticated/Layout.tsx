import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DashboardScreen } from './DashboardScreen';
import { RoleAssignmentScreen } from './RoleAssignmentScreen';
import { ApprovalsScreen } from './ApprovalsScreen';
import { CustomerDirectoryScreen } from './CustomerDirectoryScreen';
import { LedgerOperationsScreen } from './LedgerOperationsScreen';
import { TransactionObservabilityScreen } from './TransactionObservabilityScreen';
import { ReconciliationObservabilityScreen } from './ReconciliationObservabilityScreen';

export const Layout: React.FC = () => {
  const { principal, logout } = useAuthStore();
  const [currentView, setCurrentView] = useState<'dashboard' | 'roles' | 'approvals' | 'customers' | 'ledger' | 'transactions' | 'reconciliation'>('dashboard');

  if (!principal) return null;

  const isAdmin = principal.roles.includes('FINANCE_ADMIN') || principal.scopes.includes('privileged:execute');
  const isController = principal.roles.includes('FINANCE_CONTROLLER') || principal.scopes.includes('privileged:approve');
  const isOperator = principal.roles.length > 0; // Expose directory views to any valid workforce role

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.branding}>
          <span style={styles.brandIcon}>₦</span>
          <span style={styles.brandText}>MoneyNaija</span>
        </div>

        <div style={styles.userInfo}>
          <div style={styles.avatar}>
            {principal.principalId.split(':').pop()?.charAt(0).toUpperCase() || 'O'}
          </div>
          <div style={styles.userMeta}>
            <span style={styles.userName} title={principal.principalId}>
              {principal.principalId.split(':').pop()}
            </span>
            <div style={styles.badgeWrapper}>
              {principal.roles.slice(0, 1).map((role) => (
                <span key={role} style={styles.roleBadge}>{role}</span>
              ))}
            </div>
          </div>
        </div>

        <nav style={styles.nav}>
          <button
            style={currentView === 'dashboard' ? styles.activeNavLink : styles.navLink}
            onClick={() => setCurrentView('dashboard')}
          >
            📊 Operational Dashboard
          </button>

          {isOperator && (
            <button
              style={currentView === 'customers' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('customers')}
            >
              👥 Customer & KYC Servicing
            </button>
          )}

          {isOperator && (
            <button
              style={currentView === 'ledger' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('ledger')}
            >
              📖 Ledger & Reversals
            </button>
          )}

          {isOperator && (
            <button
              style={currentView === 'transactions' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('transactions')}
            >
              💸 Transaction & Fee Ops
            </button>
          )}

          {isOperator && (
            <button
              style={currentView === 'reconciliation' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('reconciliation')}
            >
              ⚖️ Reconciliation & Breaks
            </button>
          )}

          {isAdmin && (
            <button
              style={currentView === 'roles' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('roles')}
            >
              🔑 Finance Role Admin
            </button>
          )}

          {isController && (
            <button
              style={currentView === 'approvals' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('approvals')}
            >
              ⚖️ Privileged Approvals
            </button>
          )}
        </nav>

        <button onClick={logout} style={styles.logoutBtn}>
          🚪 Log Out Session
        </button>
      </div>

      {/* Main View Area */}
      <div style={styles.content}>
        {currentView === 'dashboard' && <DashboardScreen />}
        {currentView === 'roles' && <RoleAssignmentScreen />}
        {currentView === 'approvals' && <ApprovalsScreen />}
        {currentView === 'customers' && <CustomerDirectoryScreen />}
        {currentView === 'ledger' && <LedgerOperationsScreen />}
        {currentView === 'transactions' && <TransactionObservabilityScreen />}
        {currentView === 'reconciliation' && <ReconciliationObservabilityScreen />}
      </div>
    </div>
  );
};

const styles = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#F8FAFC',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sidebar: {
    width: '280px',
    backgroundColor: '#032B14', // MoneyNaija brand deep green
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '24px',
    boxShadow: '2px 0 8px rgba(0, 0, 0, 0.05)',
  },
  branding: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '32px',
  },
  brandIcon: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#0A3D25',
    backgroundColor: '#FFB703', // MoneyNaija brand gold
    width: '36px',
    height: '36px',
    borderRadius: '18px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandText: {
    fontSize: '18px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    color: '#FFFFFF',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '28px',
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '20px',
    backgroundColor: '#FFB703',
    color: '#032B14',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontWeight: 'bold',
    fontSize: '16px',
  },
  userMeta: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
  },
  userName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#F8FAFC',
    whiteSpace: 'nowrap' as const,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  badgeWrapper: {
    marginTop: '4px',
  },
  roleBadge: {
    fontSize: '9px',
    fontWeight: 'bold',
    color: '#FFB703',
    borderColor: '#FFB703',
    borderWidth: '1px',
    borderStyle: 'solid',
    padding: '2px 6px',
    borderRadius: '4px',
    textTransform: 'uppercase' as const,
    display: 'inline-block',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    flex: 1,
  },
  navLink: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: '500',
    color: '#CBD5E1',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  activeNavLink: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: '600',
    color: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  logoutBtn: {
    marginTop: 'auto',
    backgroundColor: '#EF4444',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
  },
};
