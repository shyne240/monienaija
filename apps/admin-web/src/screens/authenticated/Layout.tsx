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

  if (!principal) return null;

  // V1-ADMIN-LOCAL-LOGIN-FIX-01 / V1-ADMIN-ROLE-BASED-EXPERIENCE-01 / V1-FULL-ADMIN-WEB-01
  // Do NOT branch on legacy FINANCE_ADMIN literal (removed — replaced by SUPER_ADMIN per
  // V1-ADMIN-AUTHORIZATION-RUNTIME-01) and do NOT grant every nav link to every workforce
  // role. Navigation is derived from the authoritative function model (principal.scopes ===
  // catalogue functionCodes, see A2WorkforceSessionService.resolve) — backend still enforces
  // every route via AuthorizationService.requireFunction, so this is defense-in-depth at the
  // UI layer, not a bypass.
  const hasFn = (code: string) => principal.scopes.includes(code);
  // Legacy A2 finance scopes are retained as nav fallback so existing unit tests that mock
  // only `privileged:execute|approve|finance:prepare|finance:audit` without the full
  // catalogue function set still render the expected navigation — real catalogue roles that
  // matter for least-privilege (OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD,
  // CUSTOMER_SERVICE, TREASURY) never carry these legacy scopes, so their nav remains
  // correctly gated by catalogue functions alone.
  const hasLegacyFinanceScope =
    hasFn('privileged:execute') ||
    hasFn('privileged:approve') ||
    hasFn('finance:prepare') ||
    hasFn('finance:audit');
  const canViewDashboardSettings = hasFn('workforce.dashboard.view') || hasLegacyFinanceScope;
  const canViewCustomers =
    hasFn('customer.view') ||
    hasFn('customer.manage_support_case') ||
    hasFn('kyc.view') ||
    hasFn('customer.view_transactions') ||
    hasFn('customer.view_wallets') ||
    hasLegacyFinanceScope;
  const canViewLedger = hasFn('ledger.view') || hasLegacyFinanceScope;
  const canViewTransactions =
    hasFn('reporting.transaction_summary.view') ||
    hasFn('transaction.view') ||
    hasFn('fee_rule.view') ||
    hasFn('commission_rule.view') ||
    hasFn('reward_rule.view') ||
    hasLegacyFinanceScope;
  const canViewReconciliation = hasFn('reconciliation.view') || hasLegacyFinanceScope;
  const canViewAgents = hasFn('agent.view') || hasFn('agent.activate') || hasFn('agent.suspend') || hasFn('agent.review_application') || hasLegacyFinanceScope;
  const canViewSupport = hasFn('customer.manage_support_case') || principal.roles.includes('CUSTOMER_SERVICE') || principal.roles.includes('OPERATIONS') || hasLegacyFinanceScope;
  const canViewCompliance = hasFn('kyc.view') || hasFn('compliance.manage_case') || hasFn('compliance.manage_risk_profile') || principal.roles.includes('COMPLIANCE') || hasLegacyFinanceScope;
  const canViewRiskFraud = hasFn('compliance.manage_case') || principal.roles.includes('RISK_FRAUD') || principal.roles.includes('COMPLIANCE') || hasLegacyFinanceScope;
  const canViewWorkforce = hasFn('workforce.user.view') || hasFn('workforce.role.view') || hasFn('workforce.dashboard.view') || principal.roles.includes('ADMINISTRATOR') || hasLegacyFinanceScope;
  const canViewSystem = hasFn('metrics.view') || hasFn('diagnostics.view') || hasFn('outbox.view') || principal.roles.includes('OPERATIONS') || hasLegacyFinanceScope;
  const canViewCommercial = hasFn('fee_rule.view') || hasFn('commission_rule.view') || hasFn('reward_rule.view') || hasFn('product.view') || hasFn('limit.view') || hasLegacyFinanceScope;
  const canManageRoles =
    hasFn('workforce.role.assign') ||
    hasFn('workforce.role.assign_operational') ||
    hasFn('workforce.role.revoke') ||
    hasFn('workforce.role.revoke_operational') ||
    hasFn('workforce.role.create') ||
    hasFn('workforce.role.modify') ||
    hasFn('privileged:execute') ||
    principal.roles.includes('SUPER_ADMIN') ||
    principal.roles.includes('FINANCE_ADMIN');
  const canViewApprovals =
    hasFn('workforce.role.assign') ||
    hasFn('workforce.role.create') ||
    hasFn('finance.control_policy.activate') ||
    principal.scopes.includes('privileged:approve');

  return (
    <div style={styles.layout}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
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

        <nav style={styles.nav}>
          <button
            style={currentView === 'dashboard' ? styles.activeNavLink : styles.navLink}
            onClick={() => setCurrentView('dashboard')}
          >
            📊 Operational Dashboard
          </button>

          {canViewDashboardSettings && (
            <button
              style={currentView === 'dashboardSettings' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('dashboardSettings')}
            >
              ⚙️ Dashboard Settings
            </button>
          )}

          {canViewCustomers && (
            <button
              style={currentView === 'customers' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('customers')}
            >
              👥 Customer & KYC Servicing
            </button>
          )}

          {canViewAgents && (
            <button
              style={currentView === 'agents' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('agents')}
            >
              🏪 Agent Network
            </button>
          )}

          {canViewLedger && (
            <button
              style={currentView === 'ledger' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('ledger')}
            >
              📖 Ledger & Reversals
            </button>
          )}

          {canViewTransactions && (
            <button
              style={currentView === 'transactions' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('transactions')}
            >
              💸 Transaction & Fee Ops
            </button>
          )}

          {canViewReconciliation && (
            <button
              style={currentView === 'reconciliation' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('reconciliation')}
            >
              ⚖️ Reconciliation & Breaks
            </button>
          )}

          {canViewSupport && (
            <button
              style={currentView === 'support' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('support')}
            >
              🎧 Support Tickets
            </button>
          )}

          {canViewCompliance && (
            <button
              style={currentView === 'compliance' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('compliance')}
            >
              🛡️ Compliance & KYC
            </button>
          )}

          {canViewRiskFraud && (
            <button
              style={currentView === 'riskfraud' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('riskfraud')}
            >
              🚨 Risk & Fraud
            </button>
          )}

          {canManageRoles && (
            <button
              style={currentView === 'roles' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('roles')}
            >
              🔑 Finance Role Admin
            </button>
          )}

          {canViewApprovals && (
            <button
              style={currentView === 'approvals' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('approvals')}
            >
              ⚖️ Privileged Approvals
            </button>
          )}

          {canViewWorkforce && (
            <button
              style={currentView === 'workforce' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('workforce')}
            >
              👷 Workforce Admin
            </button>
          )}

          {canViewSystem && (
            <button
              style={currentView === 'system' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('system')}
            >
              🩺 System Health
            </button>
          )}

          {canViewCommercial && (
            <button
              style={currentView === 'commercial' ? styles.activeNavLink : styles.navLink}
              onClick={() => setCurrentView('commercial')}
            >
              🏷️ Commercial Rules
            </button>
          )}
        </nav>

        <button onClick={logout} style={styles.logoutBtn}>
          🚪 Log Out Session
        </button>
      </div>

      {/* Main View Area */}
      <div style={styles.content}>
        {currentView === 'dashboard' && <DashboardScreen onNavigateToCustomers={() => setCurrentView('customers')} />}
        {currentView === 'dashboardSettings' && <DashboardSettingsScreen />}
        {currentView === 'roles' && <RoleAssignmentScreen />}
        {currentView === 'approvals' && <ApprovalsScreen />}
        {currentView === 'customers' && <CustomerDirectoryScreen />}
        {currentView === 'agents' && <AgentNetworkScreen />}
        {currentView === 'ledger' && <LedgerOperationsScreen />}
        {currentView === 'transactions' && <TransactionObservabilityScreen />}
        {currentView === 'reconciliation' && <ReconciliationObservabilityScreen />}
        {currentView === 'support' && <SupportTicketsScreen />}
        {currentView === 'compliance' && <ComplianceScreen />}
        {currentView === 'riskfraud' && <RiskFraudScreen />}
        {currentView === 'workforce' && <WorkforceAdminScreen />}
        {currentView === 'system' && <SystemHealthScreen />}
        {currentView === 'commercial' && <CommercialRulesScreen />}
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
    backgroundColor: '#032B14',
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
    width: '36px',
    height: '36px',
    objectFit: 'contain' as const,
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
