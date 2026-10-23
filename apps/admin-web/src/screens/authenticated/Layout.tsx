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
import { SuperAdminRecoveryScreen } from './SuperAdminRecoveryScreen';
import { AuditTrailScreen } from './AuditTrailScreen';
import { LimitAssignmentScreen } from './LimitAssignmentScreen';
import { canonicalAdminView, canAccessAdminView, type AdminView } from './navigation-access';

// V1-ADMIN-IA-02 — seven-section, 25-item navigation. Counts reflect the screens actually
// implemented here: three money-movement filters (no cash-to-cash admin route) and six
// commercial/limit views. Menu visibility and route selection use function scopes, not role labels.

type View = AdminView;

interface NavContext {
  customerId?: string;
}

export const Layout: React.FC = () => {
  const { principal, logout } = useAuthStore();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [navContext, setNavContext] = useState<NavContext>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    home: true,
    servicing: true,
    money: true,
    finance: true,
    commercial: true,
    compliance: true,
    platform: true,
  });

  if (!principal) return null;

  const isVisible = (view: View) =>
    canAccessAdminView(view, principal.scopes, principal.roles);

  // Seven sections; only implemented menu routes are exposed.
  const sections = [
    {
      id: 'home',
      title: '1. Home & My Work',
      items: [
        { key: 'dashboard' as View, label: '📊 Operational Dashboard', visible: true },
        { key: 'dashboardSettings' as View, label: '⚙️ Dashboard Settings', visible: isVisible('dashboardSettings') },
      ],
    },
    {
      id: 'servicing',
      title: '2. Customer & Agent Servicing',
      items: [
        { key: 'customers' as View, label: '👥 Customer & KYC Servicing', visible: isVisible('customers') },
        { key: 'agents' as View, label: '🏪 Agent Network Management', visible: isVisible('agents') },
        { key: 'support' as View, label: '🎧 Support Inbox', visible: isVisible('support') },
      ],
    },
    {
      id: 'money',
      title: '3. Money Movement',
      items: [
        { key: 'transfers' as View, label: '💸 Transaction & Fee Ops — Transfers (W2W)', visible: isVisible('transfers') },
        { key: 'cashIn' as View, label: '💸 Transaction & Fee Ops — Cash-In (C2W)', visible: isVisible('transfers') },
        { key: 'cashOut' as View, label: '💸 Transaction & Fee Ops — Cash-Out (W2C)', visible: isVisible('transfers') },
      ],
    },
    {
      id: 'finance',
      title: '4. Finance & Ledger',
      items: [
        { key: 'ledgerExplorer' as View, label: '📖 Ledger & Reversals', visible: isVisible('ledgerExplorer') },
        { key: 'reconciliation' as View, label: '⚖️ Reconciliation & Breaks', visible: isVisible('reconciliation') },
      ],
    },
    {
      id: 'commercial',
      title: '5. Commercial & Risk Controls',
      items: [
        { key: 'feeRules' as View, label: '5.1 Fee Rules', visible: isVisible('feeRules') },
        { key: 'commissionRules' as View, label: '5.2 Commission Rules', visible: isVisible('commissionRules') },
        { key: 'rewardRules' as View, label: '5.3 Reward Rules', visible: isVisible('rewardRules') },
        { key: 'productCatalogue' as View, label: '5.4 Product Catalogue', visible: isVisible('productCatalogue') },
        { key: 'limitCatalogue' as View, label: '5.5 Limit Catalogue', visible: isVisible('limitCatalogue') },
        { key: 'limitAssignments' as View, label: '5.6 Limit Assignments', visible: isVisible('limitAssignments') },
      ],
    },
    {
      id: 'compliance',
      title: '6. Compliance & Risk',
      items: [
        { key: 'kycQueue' as View, label: '6.1 KYC Assessment Lookup & Review', visible: isVisible('kycQueue') },
        { key: 'complianceCases' as View, label: '6.2 Compliance Case Lookup', visible: isVisible('complianceCases') },
        { key: 'fraudCases' as View, label: '6.3 Fraud Case Lookup', visible: isVisible('fraudCases') },
      ],
    },
    {
      id: 'platform',
      title: '7. Platform Administration',
      items: [
        { key: 'workforceAccess' as View, label: '👷 Workforce Overview & Support Provisioning', visible: isVisible('workforceAccess') },
        { key: 'roleGovernance' as View, label: '🔑 Finance Role Assignments', visible: isVisible('roleGovernance') },
        { key: 'approvalsInbox' as View, label: '⚖️ Privileged Approvals', visible: isVisible('approvalsInbox') },
        { key: 'superAdminRecovery' as View, label: '🔐 Super-Admin Recovery', visible: isVisible('superAdminRecovery') },
        { key: 'systemHealth' as View, label: '🩺 System Health', visible: isVisible('systemHealth') },
        { key: 'auditEvents' as View, label: '📜 Audit & Security Events', visible: isVisible('auditEvents') },
      ],
    },
  ];

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleNav = (view: View, context?: NavContext) => {
    if (!canAccessAdminView(view, principal.scopes, principal.roles, context)) return;

    setCurrentView(view);
    // Customer context belongs only to the destination explicitly selected from Customer 360°.
    // Clear it on every ordinary navigation so stale IDs cannot leak into unrelated screens.
    setNavContext(context ? { ...context } : {});

    const canonicalView = canonicalAdminView(view);
    const owningSection = sections.find((section) =>
      section.items.some((item) => item.key === canonicalView),
    );
    if (owningSection) {
      setExpandedSections((prev) => ({ ...prev, [owningSection.id]: true }));
    }
    setMobileOpen(false);
  };

  const navigateWithCustomer = (view: View, customerId: string) => {
    handleNav(view, { customerId });
  };

  // Legacy view aliases remain supported, but every alias passes the same route guard.
  const renderContent = () => {
    if (!canAccessAdminView(currentView, principal.scopes, principal.roles, navContext)) {
      return (
        <div role="alert" style={styles.routeDenied}>
          This screen is not available to the current workforce principal.
        </div>
      );
    }

    const effectiveView = canonicalAdminView(currentView);
    switch (effectiveView) {
      case 'dashboard': return <DashboardScreen onNavigateToCustomers={() => handleNav('customers')} />;
      case 'dashboardSettings': return <DashboardSettingsScreen />;
      case 'customers': return <CustomerDirectoryScreen onNavigate={(view, customerId) => navigateWithCustomer(view as View, customerId)} selectedCustomerId={navContext.customerId} />;
      case 'agents': return <AgentNetworkScreen />;
      case 'support': return <SupportTicketsScreen initialCustomerId={navContext.customerId} />;
      case 'transfers': return <TransactionObservabilityScreen initialType="TRANSFER" initialCustomerId={navContext.customerId} onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'cashIn': return <TransactionObservabilityScreen initialType="DEPOSIT" initialCustomerId={navContext.customerId} />;
      case 'cashOut': return <TransactionObservabilityScreen initialType="WITHDRAWAL" initialCustomerId={navContext.customerId} />;
      case 'ledgerExplorer': return <LedgerOperationsScreen />;
      case 'reconciliation': return <ReconciliationObservabilityScreen />;
      case 'feeRules': return <CommercialRulesScreen initialTab="fees" />;
      case 'commissionRules': return <CommercialRulesScreen initialTab="commissions" />;
      case 'rewardRules': return <CommercialRulesScreen initialTab="rewards" />;
      case 'productCatalogue': return <CommercialRulesScreen initialTab="products" />;
      case 'limitCatalogue': return <CommercialRulesScreen initialTab="limits" />;
      case 'limitAssignments': return <LimitAssignmentScreen initialCustomerId={navContext.customerId} onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'kycQueue': return <ComplianceScreen initialCustomerId={navContext.customerId} mode="kyc" onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'complianceCases': return <ComplianceScreen initialCustomerId={navContext.customerId} initialCategory="AML" mode="cases" onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'fraudCases': return <RiskFraudScreen initialCustomerId={navContext.customerId} onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'workforceAccess': return <WorkforceAdminScreen />;
      case 'roleGovernance': return <RoleAssignmentScreen />;
      case 'approvalsInbox': return <ApprovalsScreen />;
      case 'superAdminRecovery': return <SuperAdminRecoveryScreen />;
      case 'systemHealth': return <SystemHealthScreen />;
      case 'auditEvents': return <AuditTrailScreen initialCustomerId={navContext.customerId} />;
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
          {sections.map(section => {
            const visibleItems = section.items.filter(i => i.visible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.id} style={styles.section}>
                <button
                  onClick={() => toggleSection(section.id)}
                  style={styles.sectionHeader}
                  aria-expanded={expandedSections[section.id]}
                  data-testid={`section-${section.id}`}
                >
                  <span>{section.title}</span>
                  <span style={styles.chevron}>{expandedSections[section.id] ? '▾' : '▸'}</span>
                </button>
                {expandedSections[section.id] && (
                  <div style={styles.sectionItems}>
                    {visibleItems.map(item => {
                      const isActive = canonicalAdminView(currentView) === item.key;
                      return (
                        <button
                          key={item.key}
                          data-testid={`nav-${item.key}`}
                          style={isActive ? styles.activeNavLink : styles.navLink}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => handleNav(item.key)}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
              {sections.map(section => {
                const visibleItems = section.items.filter(i => i.visible);
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.id} style={styles.mobileSection}>
                    <button
                      type="button"
                      style={styles.mobileSectionHeader}
                      aria-expanded={expandedSections[section.id]}
                      data-testid={`mobile-section-${section.id}`}
                      onClick={() => toggleSection(section.id)}
                    >
                      <span>{section.title}</span>
                      <span>{expandedSections[section.id] ? '▾' : '▸'}</span>
                    </button>
                    {expandedSections[section.id] && visibleItems.map(item => {
                      const isActive = canonicalAdminView(currentView) === item.key;
                      return (
                        <button
                          key={item.key}
                          data-testid={`mobile-nav-${item.key}`}
                          aria-current={isActive ? 'page' : undefined}
                          style={isActive ? styles.mobileActiveLink : styles.mobileNavLink}
                          onClick={() => handleNav(item.key)}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
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
    overflowY: 'auto',
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
  section: {
    marginBottom: '8px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '8px 12px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#FFB703',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  chevron: {
    fontSize: '12px',
  },
  sectionItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginTop: '6px',
    paddingLeft: '8px',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    marginLeft: '4px',
  },
  navLink: {
    display: 'block',
    width: '100%',
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: '13px',
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
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: '13px',
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
    display: 'none',
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
  mobileSection: {
    marginBottom: '12px',
  },
  mobileSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 700,
    color: '#FFB703',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '6px',
    paddingLeft: '4px',
  },
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
      [data-testid="desktop-nav"] { display: none !important; }
      [data-testid="mobile-header"] { display: flex !important; }
      [data-testid="main-content"] { margin-top: 56px; }
    }
    @media (min-width: 769px) {
      [data-testid="mobile-header"] { display: none !important; }
      [data-testid="mobile-nav"] { display: none !important; }
    }
  `;
  document.head.appendChild(styleTag);
}
