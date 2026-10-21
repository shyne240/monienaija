import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { DashboardScreen } from './DashboardScreen';
import { DashboardSettingsScreen } from './DashboardSettingsScreen';
import { RoleAssignmentScreen } from './RoleAssignmentScreen';
import { ApprovalsScreen } from './ApprovalsScreen';
import { CustomerDirectoryScreen } from './CustomerDirectoryScreen';
import { LedgerOperationsScreen } from './LedgerOperationsScreen';
import { TransactionObservabilityScreen } from './TransactionObservabilityScreen';
import { ReconciliationObservabilityScreen } from './ReconciliationObservabilityScreen';
import { AgentNetworkScreen } from './AgentNetworkScreen';
import { SupportTicketsScreen } from './SupportTicketsScreen';
import { ComplianceScreen } from './ComplianceScreen';
import { RiskFraudScreen } from './RiskFraudScreen';
import { WorkforceAdminScreen } from './WorkforceAdminScreen';
import { SystemHealthScreen } from './SystemHealthScreen';
import { CommercialRulesScreen } from './CommercialRulesScreen';

type View = 'dashboard' | 'dashboardSettings' | 'roles' | 'approvals' | 'customers' | 'ledger' | 'transactions' | 'reconciliation' | 'agents' | 'support' | 'compliance' | 'riskfraud' | 'workforce' | 'system' | 'commercial';

export const Layout: React.FC = () => {
  const { principal, logout } = useAuthStore();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!principal) return null;

  const isSuperAdmin = principal.roles.includes('SUPER_ADMIN');
  const hasFn = (code: string) => principal.scopes.includes(code);

  // V1-MENU-VISIBILITY-11-ROLES-01 — strict catalogue-based nav, no legacy fallback.
  // Each canView* mirrors the exact function(s) that grant that operational area.
  // SUPER_ADMIN is the sole privileged overgrant (sees all) as the reserved admin role;
  // no other role is granted a menu via role name alone — only via catalogue functions.
  // This ensures FINANCE_PREPARER/CONTROLLER/AUDITOR no longer inherit every menu
  // via legacy privileged:execute/finance:prepare etc.
  const canViewDashboardSettings = isSuperAdmin || hasFn('workforce.dashboard.view');
  const canViewCustomers =
    isSuperAdmin ||
    hasFn('customer.view') ||
    hasFn('customer.manage_support_case') ||
    hasFn('kyc.view') ||
    hasFn('customer.view_transactions') ||
    hasFn('customer.view_wallets');
  const canViewLedger = isSuperAdmin || hasFn('ledger.view');
  const canViewTransactions =
    isSuperAdmin ||
    hasFn('reporting.transaction_summary.view') ||
    hasFn('transaction.view') ||
    hasFn('fee_rule.view') ||
    hasFn('commission_rule.view') ||
    hasFn('reward_rule.view');
  const canViewReconciliation = isSuperAdmin || hasFn('reconciliation.view');
  const canViewAgents =
    isSuperAdmin ||
    hasFn('agent.view') ||
    hasFn('agent.activate') ||
    hasFn('agent.suspend') ||
    hasFn('agent.review_application') ||
    hasFn('agent.manage_credentials') ||
    hasFn('agent.manage_outlets_terminals');
  const canViewSupport = isSuperAdmin || hasFn('customer.manage_support_case');
  const canViewCompliance =
    isSuperAdmin ||
    hasFn('kyc.view') ||
    hasFn('compliance.manage_case') ||
    hasFn('compliance.manage_risk_profile');
  const canViewRiskFraud = isSuperAdmin || hasFn('risk_fraud.manage_fraud_case');
  const canViewWorkforce =
    isSuperAdmin ||
    hasFn('workforce.user.view') ||
    hasFn('workforce.role.view') ||
    hasFn('workforce.dashboard.view');
  const canViewSystem =
    isSuperAdmin ||
    hasFn('metrics.view') ||
    hasFn('diagnostics.view') ||
    hasFn('outbox.view');
  const canViewCommercial =
    isSuperAdmin ||
    hasFn('fee_rule.view') ||
    hasFn('commission_rule.view') ||
    hasFn('reward_rule.view') ||
    hasFn('product.view') ||
    hasFn('limit.view');
  const canManageRoles =
    isSuperAdmin ||
    hasFn('workforce.role.assign') ||
    hasFn('workforce.role.assign_operational') ||
    hasFn('workforce.role.revoke') ||
    hasFn('workforce.role.revoke_operational') ||
    hasFn('workforce.role.create') ||
    hasFn('workforce.role.modify');
  const canViewApprovals =
    isSuperAdmin ||
    hasFn('workforce.role.assign') ||
    hasFn('workforce.role.create') ||
    hasFn('finance.control_policy.activate');

  const navItems: Array<{ key: View; label: string; visible: boolean }> = [
    { key: 'dashboard', label: '📊 Operational Dashboard', visible: true },
    { key: 'dashboardSettings', label: '⚙️ Dashboard Settings', visible: canViewDashboardSettings },
    { key: 'customers', label: '👥 Customer & KYC Servicing', visible: canViewCustomers },
    { key: 'agents', label: '🏪 Agent Network', visible: canViewAgents },
    { key: 'ledger', label: '📖 Ledger & Reversals', visible: canViewLedger },
    { key: 'transactions', label: '💸 Transaction & Fee Ops', visible: canViewTransactions },
    { key: 'reconciliation', label: '⚖️ Reconciliation & Breaks', visible: canViewReconciliation },
    { key: 'support', label: '🎧 Support Tickets', visible: canViewSupport },
    { key: 'compliance', label: '🛡️ Compliance & KYC', visible: canViewCompliance },
    { key: 'riskfraud', label: '🚨 Risk & Fraud', visible: canViewRiskFraud },
    { key: 'roles', label: '🔑 Finance Role Admin', visible: canManageRoles },
    { key: 'approvals', label: '⚖️ Privileged Approvals', visible: canViewApprovals },
    { key: 'workforce', label: '👷 Workforce Admin', visible: canViewWorkforce },
    { key: 'system', label: '🩺 System Health', visible: canViewSystem },
    { key: 'commercial', label: '🏷️ Commercial Rules', visible: canViewCommercial },
  ];

  const handleNav = (v: View) => {
    setCurrentView(v);
    setMobileOpen(false);
  };

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardScreen onNavigateToCustomers={() => setCurrentView('customers')} />;
      case 'dashboardSettings': return <DashboardSettingsScreen />;
      case 'roles': return <RoleAssignmentScreen />;
      case 'approvals': return <ApprovalsScreen />;
      case 'customers': return <CustomerDirectoryScreen />;
      case 'agents': return <AgentNetworkScreen />;
      case 'ledger': return <LedgerOperationsScreen />;
      case 'transactions': return <TransactionObservabilityScreen />;
      case 'reconciliation': return <ReconciliationObservabilityScreen />;
      case 'support': return <SupportTicketsScreen />;
      case 'compliance': return <ComplianceScreen />;
      case 'riskfraud': return <RiskFraudScreen />;
      case 'workforce': return <WorkforceAdminScreen />;
      case 'system': return <SystemHealthScreen />;
      case 'commercial': return <CommercialRulesScreen />;
      default: return null;
    }
  };

  return (
    <div style={styles.layout}>
      {/* Desktop Sidebar */}
      <div style={styles.sidebar} data-testid="desktop-nav">
        <div style={styles.branding}>
          <img src="/favicon.png" alt="MonieNaija" style={styles.brandIcon} />
          <span style={styles.brandText}>MonieNaija</span>
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

        <nav style={styles.nav} aria-label="Main navigation">
          {navItems.filter(i => i.visible).map(item => (
            <button
              key={item.key}
              data-testid={`nav-${item.key}`}
              style={currentView === item.key ? styles.activeNavLink : styles.navLink}
              onClick={() => handleNav(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button onClick={logout} style={styles.logoutBtn}>
          🚪 Log Out Session
        </button>
      </div>

      {/* Mobile Header + Hamburger */}
      <div style={styles.mobileHeader} data-testid="mobile-header">
        <button
          aria-label="Open navigation menu"
          data-testid="mobile-menu-toggle"
          onClick={() => setMobileOpen(v => !v)}
          style={styles.hamburger}
        >
          ☰
        </button>
        <span style={styles.mobileBrand}>MonieNaija</span>
        <span style={styles.mobileRole}>{principal.roles[0]}</span>
        {mobileOpen && (
          <div style={styles.mobileDrawer} data-testid="mobile-nav">
            <nav aria-label="Mobile navigation" style={styles.mobileNav}>
              {navItems.filter(i => i.visible).map(item => (
                <button
                  key={item.key}
                  data-testid={`mobile-nav-${item.key}`}
                  style={currentView === item.key ? styles.mobileActiveLink : styles.mobileNavLink}
                  onClick={() => handleNav(item.key)}
                >
                  {item.label}
                </button>
              ))}
              <button onClick={logout} style={styles.mobileLogoutBtn}>
                🚪 Log Out
              </button>
            </nav>
          </div>
        )}
      </div>

      {/* Main View Area */}
      <div style={styles.content} data-testid="main-content">
        {renderContent()}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#F8FAFC',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  sidebar: {
    width: '280px',
    backgroundColor: '#032B14',
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
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
    width: '36px',
    height: '36px',
    objectFit: 'contain',
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
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  userName: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#F8FAFC',
    whiteSpace: 'nowrap',
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
    textTransform: 'uppercase',
    display: 'inline-block',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  navLink: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left',
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
    textAlign: 'left',
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
  mobileHeader: {
    display: 'none', // overridden via media query injected below
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '56px',
    backgroundColor: '#032B14',
    color: '#fff',
    alignItems: 'center',
    padding: '0 12px',
    gap: '12px',
    zIndex: 100,
  } as React.CSSProperties,
  hamburger: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    fontSize: '22px',
    borderRadius: '6px',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  mobileBrand: {
    fontWeight: 700,
    letterSpacing: '0.5px',
  },
  mobileRole: {
    marginLeft: 'auto',
    fontSize: '10px',
    border: '1px solid #FFB703',
    color: '#FFB703',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  mobileDrawer: {
    position: 'fixed',
    top: '56px',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#032B14',
    padding: '16px',
    overflowY: 'auto',
    zIndex: 99,
  } as React.CSSProperties,
  mobileNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  } as React.CSSProperties,
  mobileNavLink: {
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '14px',
    color: '#CBD5E1',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  } as React.CSSProperties,
  mobileActiveLink: {
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '14px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  } as React.CSSProperties,
  mobileLogoutBtn: {
    marginTop: '16px',
    backgroundColor: '#EF4444',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,
  content: {
    flex: 1,
    overflowY: 'auto',
  },
};

// Inject responsive CSS for mobile header/sidebar toggle
if (typeof document !== 'undefined' && !document.getElementById('layout-responsive-style')) {
  const styleTag = document.createElement('style');
  styleTag.id = 'layout-responsive-style';
  styleTag.textContent = `
    @media (max-width: 768px) {
      [data-testid=\"desktop-nav\"] { display: none !important; }
      [data-testid=\"mobile-header\"] { display: flex !important; }
      [data-testid=\"main-content\"] { margin-top: 56px; }
    }
    @media (min-width: 769px) {
      [data-testid=\"mobile-header\"] { display: none !important; }
      [data-testid=\"mobile-nav\"] { display: none !important; }
    }
  `;
  document.head.appendChild(styleTag);
}
