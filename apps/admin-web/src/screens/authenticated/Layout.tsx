import React, { useCallback, useEffect, useRef, useState } from 'react';

import '../../design-system/tokens.css';
import { Button } from '../../design-system/primitives';
import { useAuthStore } from '../../store/auth-store';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { DashboardScreen } from './DashboardScreen';
import { DashboardSettingsScreen } from './DashboardSettingsScreen';
import { RoleAssignmentScreen } from './RoleAssignmentScreen';
import { ApprovalsScreen } from './ApprovalsScreen';
import { CustomerDirectoryScreen } from './CustomerDirectoryScreen';
import { LedgerOperationsScreen } from './LedgerOperationsScreen';
import { TransactionObservabilityScreen } from './TransactionObservabilityScreen';
import { ReconciliationObservabilityScreen } from './ReconciliationObservabilityScreen';
import { AgentNetworkScreen } from './AgentNetworkScreen';
import { AgentClassesScreen } from './AgentClassesScreen';
import { CashToCashOperationsScreen } from './CashToCashOperationsScreen';
import { SupportTicketsScreen } from './SupportTicketsScreen';
import { ComplianceScreen } from './ComplianceScreen';
import { RiskFraudScreen } from './RiskFraudScreen';
import { WorkforceAdminScreen } from './WorkforceAdminScreen';
import { SystemHealthScreen } from './SystemHealthScreen';
import { NotificationManagementScreen } from './NotificationManagementScreen';
import { CommercialRulesScreen } from './CommercialRulesScreen';
import { SuperAdminRecoveryScreen } from './SuperAdminRecoveryScreen';
import { AuditTrailScreen } from './AuditTrailScreen';
import { LimitAssignmentScreen } from './LimitAssignmentScreen';
import { canonicalAdminView, canAccessAdminView, type AdminView } from './navigation-access';
import './admin-shell.css';

// Seven-section Admin Web navigation. Money movement includes the dedicated read-only
// Cash-to-Cash operations view; Agent classes are managed through their separate function scope.
// Menu visibility and route selection use function scopes, not role labels.
//
// M1 presentation note: this file owns shell markup, scoped styles and focus/drawer
// behaviour only. Section definitions, item labels, guards, aliases, customer context,
// the route switch, logout and every destination handler are unchanged.

type View = AdminView;

interface NavContext {
  customerId?: string;
  agentId?: string;
  openAgentApplications?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export const Layout: React.FC = () => {
  const { principal, logout } = useAuthStore();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [navContext, setNavContext] = useState<NavContext>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customerGuard, setCustomerGuard] = useState(false);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [agentGuard, setAgentGuard] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [approvalGuard, setApprovalGuard] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [limitGuard, setLimitGuard] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [classGuard, setClassGuard] = useState(false);
  const [classBusy, setClassBusy] = useState(false);
  const [dashboardGuard, setDashboardGuard] = useState(false);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [supportGuard, setSupportGuard] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [roleGuard, setRoleGuard] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [workforceGuard, setWorkforceGuard] = useState(false);
  const [workforceBusy, setWorkforceBusy] = useState(false);
  const [complianceGuard, setComplianceGuard] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);
  const reportComplianceGuard = useCallback((guarded: boolean, busy: boolean) => { setComplianceGuard(guarded); setComplianceBusy(busy); }, []);
  const reportWorkforceGuard = useCallback((guarded: boolean, busy: boolean) => { setWorkforceGuard(guarded); setWorkforceBusy(busy); }, []);
  const reportRoleGuard = useCallback((guarded: boolean, busy: boolean) => { setRoleGuard(guarded); setRoleBusy(busy); }, []);
  const reportSupportGuard = useCallback((guarded: boolean, busy: boolean) => { setSupportGuard(guarded); setSupportBusy(busy); }, []);
  const reportDashboardGuard = useCallback((guarded: boolean, busy: boolean) => { setDashboardGuard(guarded); setDashboardBusy(busy); }, []);
  const reportClassGuard = useCallback((guarded: boolean, busy: boolean) => { setClassGuard(guarded); setClassBusy(busy); }, []);
  const reportLimitGuard = useCallback((guarded: boolean, busy: boolean) => { setLimitGuard(guarded); setLimitBusy(busy); }, []);
  const reportApprovalGuard = useCallback((guarded: boolean, busy: boolean) => { setApprovalGuard(guarded); setApprovalBusy(busy); }, []);
  const reportAgentGuard = useCallback((guarded: boolean, busy: boolean) => { setAgentGuard(guarded); setAgentBusy(busy); }, []);
  const [pendingLeave, setPendingLeave] = useState<{ view: View; context?: NavContext } | { logout: true } | null>(null);
  const leaveDialogRef = useRef<HTMLElement>(null);
  const reportCustomerGuard = useCallback((guarded: boolean, busy: boolean) => { setCustomerGuard(guarded); setCustomerBusy(busy); }, []);
  useDialogFocus(leaveDialogRef, Boolean(pendingLeave), () => setPendingLeave(null));
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    home: true,
    servicing: true,
    money: true,
    finance: true,
    commercial: true,
    compliance: true,
    platform: true,
  });

  const contentRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const focusContentRef = useRef(false);

  const openDrawer = useCallback(() => {
    restoreFocusRef.current = false;
    setMobileOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    restoreFocusRef.current = true;
    setMobileOpen(false);
  }, []);

  const toggleDrawer = useCallback(() => {
    if (mobileOpen) closeDrawer();
    else openDrawer();
  }, [mobileOpen, closeDrawer, openDrawer]);

  // Modal drawer contract: focus moves inside, stays inside, Escape/backdrop/close
  // dismiss it, background scrolling is prevented, and focus returns to the toggle.
  useEffect(() => {
    if (!mobileOpen) return;

    const drawer = drawerRef.current;
    const focusables = getFocusable(drawer);
    (focusables[0] ?? drawer)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable(drawer);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = drawer ? drawer.contains(active) : false;

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        drawerToggleRef.current?.focus();
      }
    };
  }, [mobileOpen, closeDrawer]);

  // Leaving the compact breakpoint while the drawer is open must not strand focus
  // in a hidden overlay. Guarded because not every test environment implements it.
  useEffect(() => {
    if (!mobileOpen) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (query.matches) closeDrawer();
    };

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => {
        query.removeListener(onChange);
      };
    }
    return;
  }, [mobileOpen, closeDrawer]);

  // After a successful navigation, move focus to the destination heading (or the
  // workspace container) so keyboard and screen-reader users land on the new page.
  useEffect(() => {
    if (!focusContentRef.current) return;
    focusContentRef.current = false;

    const container = contentRef.current;
    if (!container) return;
    const heading = container.querySelector<HTMLElement>('h1, h2, [data-mn-focus-target]');
    const target = heading ?? container;
    if (target !== container && !target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  }, [currentView, navContext]);

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
        { key: 'agentClasses' as View, label: '🏷️ Agent Classes & Capabilities', visible: isVisible('agentClasses') },
        { key: 'support' as View, label: '🎧 Support Inbox', visible: isVisible('support') },
      ],
    },
    {
      id: 'money',
      title: '3. Money Movement',
      items: [
        { key: 'transfers' as View, label: '💸 Transaction & Fee Ops — Transfers (W2W)', visible: isVisible('transfers') },
        { key: 'cashIn' as View, label: '💸 Transaction & Fee Ops — Deposits', visible: isVisible('transfers') },
        { key: 'cashOut' as View, label: '💸 Transaction & Fee Ops — Withdrawals', visible: isVisible('transfers') },
        { key: 'cashToCashOps' as View, label: '💸 Cash-to-Cash Operations', visible: isVisible('cashToCashOps') },
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
        { key: 'roleGovernance' as View, label: '🔑 Role Governance', visible: isVisible('roleGovernance') },
        { key: 'approvalsInbox' as View, label: '⚖️ Privileged Approvals', visible: isVisible('approvalsInbox') },
        { key: 'superAdminRecovery' as View, label: '🔐 Super-Admin Recovery', visible: isVisible('superAdminRecovery') },
        { key: 'notifications' as View, label: '🔔 SMS & Email Notifications', visible: isVisible('notifications') },
        { key: 'systemHealth' as View, label: '🩺 System Health', visible: isVisible('systemHealth') },
        { key: 'auditEvents' as View, label: '📜 Audit & Security Events', visible: isVisible('auditEvents') },
      ],
    },
  ];

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const performNav = (view: View, context?: NavContext) => {
    if (!canAccessAdminView(view, principal.scopes, principal.roles, context)) return;
    setCustomerGuard(false);
    setCustomerBusy(false);
    setAgentGuard(false);
    setAgentBusy(false);
    setApprovalGuard(false);
    setApprovalBusy(false);
    setLimitGuard(false); setLimitBusy(false);
    setClassGuard(false); setClassBusy(false);
    setDashboardGuard(false); setDashboardBusy(false);
    setSupportGuard(false); setSupportBusy(false);
    setRoleGuard(false); setRoleBusy(false);
    setWorkforceGuard(false); setWorkforceBusy(false);
    setComplianceGuard(false); setComplianceBusy(false);
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
    // A successful navigation closes the drawer and moves focus to the page, not
    // back to the toggle; a denied navigation keeps the guard behaviour unchanged.
    focusContentRef.current = true;
    restoreFocusRef.current = false;
    setMobileOpen(false);
  };

  const handleNav = (view: View, context?: NavContext) => {
    if (!canAccessAdminView(view, principal.scopes, principal.roles, context)) return;
    if ((customerGuard && canonicalAdminView(currentView) === 'customers') || (agentGuard && canonicalAdminView(currentView) === 'agents') || (approvalGuard && canonicalAdminView(currentView) === 'approvalsInbox') || (limitGuard && canonicalAdminView(currentView) === 'limitAssignments') || (classGuard && canonicalAdminView(currentView) === 'agentClasses') || (dashboardGuard && canonicalAdminView(currentView) === 'dashboardSettings') || (supportGuard && canonicalAdminView(currentView) === 'support') || (roleGuard && canonicalAdminView(currentView) === 'roleGovernance') || (workforceGuard && canonicalAdminView(currentView) === 'workforceAccess') || (complianceGuard && canonicalAdminView(currentView) === 'kycQueue')) { restoreFocusRef.current = false; setMobileOpen(false); setPendingLeave({ view, context }); return; }
    performNav(view, context);
  };
  const requestLogout = () => {
    if ((customerGuard && canonicalAdminView(currentView) === 'customers') || (agentGuard && canonicalAdminView(currentView) === 'agents') || (approvalGuard && canonicalAdminView(currentView) === 'approvalsInbox') || (limitGuard && canonicalAdminView(currentView) === 'limitAssignments') || (classGuard && canonicalAdminView(currentView) === 'agentClasses') || (dashboardGuard && canonicalAdminView(currentView) === 'dashboardSettings') || (supportGuard && canonicalAdminView(currentView) === 'support') || (roleGuard && canonicalAdminView(currentView) === 'roleGovernance') || (workforceGuard && canonicalAdminView(currentView) === 'workforceAccess') || (complianceGuard && canonicalAdminView(currentView) === 'kycQueue')) { restoreFocusRef.current = false; setMobileOpen(false); setPendingLeave({ logout: true }); return; }
    logout();
  };

  const navigateWithCustomer = (view: View, customerId: string) => {
    handleNav(view, { customerId });
  };

  // Legacy view aliases remain supported, but every alias passes the same route guard.
  const renderContent = () => {
    if (!canAccessAdminView(currentView, principal.scopes, principal.roles, navContext)) {
      return (
        <div role="alert" className="mn-route-denied">
          This screen is not available to the current workforce principal.
        </div>
      );
    }

    const effectiveView = canonicalAdminView(currentView);
    switch (effectiveView) {
      case 'dashboard':
        return (
          <DashboardScreen
            onNavigateToCustomers={() => handleNav('customers')}
            onNavigateToAgents={(opts) =>
              handleNav('agents', opts?.openApplications ? { openAgentApplications: true } : undefined)
            }
          />
        );
      case 'dashboardSettings': return <DashboardSettingsScreen onDashboardGuardChange={reportDashboardGuard} />;
      case 'customers': return <CustomerDirectoryScreen onNavigate={(view, customerId) => navigateWithCustomer(view as View, customerId)} selectedCustomerId={navContext.customerId} onCustomerGuardChange={reportCustomerGuard} />;
      case 'agents':
        return (
          <AgentNetworkScreen
            onAgentGuardChange={reportAgentGuard}
            initialAgentId={navContext.agentId}
            initialOpenApplications={navContext.openAgentApplications}
            onNavigateToSupportTickets={
              isVisible('support')
                ? (agentId: string) => handleNav('support', { agentId })
                : undefined
            }
          />
        );
      case 'agentClasses': return <AgentClassesScreen onClassGuardChange={reportClassGuard} />;
      case 'cashToCashOps': return <CashToCashOperationsScreen />;
      case 'support':
        return (
          <SupportTicketsScreen
            onSupportGuardChange={reportSupportGuard}
            initialCustomerId={navContext.customerId}
            initialAgentId={navContext.agentId}
            onBackToAgent={
              navContext.agentId && isVisible('agents')
                ? () => handleNav('agents', { agentId: navContext.agentId })
                : undefined
            }
          />
        );
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
      case 'limitAssignments': return <LimitAssignmentScreen onLimitGuardChange={reportLimitGuard} initialCustomerId={navContext.customerId} onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'kycQueue': return <ComplianceScreen onComplianceGuardChange={reportComplianceGuard} initialCustomerId={navContext.customerId} mode="kyc" onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'complianceCases': return <ComplianceScreen initialCustomerId={navContext.customerId} initialCategory="AML" mode="cases" onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'fraudCases': return <RiskFraudScreen initialCustomerId={navContext.customerId} onBackToCustomer={navContext.customerId ? () => handleNav('customers', { customerId: navContext.customerId }) : undefined} />;
      case 'workforceAccess': return <WorkforceAdminScreen onWorkforceGuardChange={reportWorkforceGuard} />;
      case 'roleGovernance': return <RoleAssignmentScreen onRoleGuardChange={reportRoleGuard} />;
      case 'approvalsInbox': return <ApprovalsScreen onApprovalGuardChange={reportApprovalGuard} />;
      case 'superAdminRecovery': return <SuperAdminRecoveryScreen />;
      case 'notifications': return <NotificationManagementScreen />;
      case 'systemHealth': return <SystemHealthScreen onOpenNotifications={isVisible('notifications') ? () => handleNav('notifications') : undefined} />;
      case 'auditEvents': return <AuditTrailScreen initialCustomerId={navContext.customerId} />;
      default: return null;
    }
  };

  const principalHandle = principal.principalId.split(':').pop() || principal.principalId;
  const principalInitial = principalHandle.charAt(0).toUpperCase() || 'O';

  const renderNavGroups = (variant: 'rail' | 'drawer') => {
    const prefix = variant === 'rail' ? '' : 'mobile-';
    return sections.map((section) => {
      const visibleItems = section.items.filter((item) => item.visible);
      if (visibleItems.length === 0) return null;
      const expanded = !!expandedSections[section.id];
      const panelId = `mn-nav-${variant}-group-${section.id}`;

      return (
        <div key={section.id} className="mn-nav__group">
          <button
            type="button"
            className="mn-nav__group-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            data-testid={`${prefix}section-${section.id}`}
            onClick={() => toggleSection(section.id)}
          >
            <span className="mn-nav__group-title">{section.title}</span>
            <span className="mn-nav__chevron" aria-hidden="true" />
          </button>
          <div className="mn-nav__items" id={panelId} hidden={!expanded}>
            {visibleItems.map((item) => {
              const isActive = canonicalAdminView(currentView) === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className="mn-nav__item"
                  data-testid={`${prefix}nav-${item.key}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleNav(item.key)}
                >
                  {/* Label kept as a single text node so existing accessible names and
                      exact-text regression assertions remain unchanged. */}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="mn-shell">
      <a className="mn-skip-link" href="#mn-main-workspace">
        Skip to main content
      </a>

      <aside className="mn-shell__sidebar" data-testid="desktop-nav">
        <div className="mn-shell__brand">
          <img className="mn-shell__brand-mark" src="/favicon.png" alt="" aria-hidden="true" />
          <span className="mn-shell__brand-text">
            <span className="mn-shell__brand-name">MonieNaija</span>
            <span className="mn-shell__brand-sub">Workforce console</span>
          </span>
        </div>

        <div className="mn-identity">
          <span className="mn-identity__avatar" aria-hidden="true">
            {principalInitial}
          </span>
          <span className="mn-identity__meta">
            <span className="mn-identity__name" title={principal.principalId}>
              {principalHandle}
            </span>
            {principal.roles.slice(0, 1).map((role) => (
              <span className="mn-identity__role" key={role}>
                {role}
              </span>
            ))}
          </span>
        </div>

        <nav className="mn-nav" aria-label="Main navigation">
          {renderNavGroups('rail')}
        </nav>

        <div className="mn-shell__logout">
          <Button variant="secondary" onClick={requestLogout}>
            Log out session
          </Button>
        </div>
      </aside>

      {/* Compact top app bar: shown below the persistent-rail breakpoint. */}
      <header className="mn-shell__topbar" data-testid="mobile-header">
        <button
          type="button"
          className="mn-topbar__toggle"
          ref={drawerToggleRef}
          aria-label="Navigation menu"
          aria-expanded={mobileOpen}
          aria-controls="mn-navigation-drawer"
          data-testid="mobile-menu-toggle"
          onClick={toggleDrawer}
        >
          <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
        </button>
        <span className="mn-topbar__brand">MonieNaija</span>
        <span className="mn-topbar__role">{principal.roles[0]}</span>
      </header>

      <div
        className="mn-shell__content"
        id="mn-main-workspace"
        data-testid="main-content"
        ref={contentRef}
        tabIndex={-1}
      >
        {renderContent()}
      </div>

      {pendingLeave && (
        <div className="cm-modal-backdrop" role="presentation">
          <section ref={leaveDialogRef} tabIndex={-1} className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="mn-customer-leave-title">
            <h2 id="mn-customer-leave-title">{canonicalAdminView(currentView) === 'agents' ? 'Leave Agent review?' : canonicalAdminView(currentView) === 'approvalsInbox' ? 'Leave approval review?' : canonicalAdminView(currentView) === 'limitAssignments' ? 'Leave limit assignment review?' : canonicalAdminView(currentView) === 'agentClasses' ? 'Leave Agent class review?' : canonicalAdminView(currentView) === 'dashboardSettings' ? 'Leave dashboard settings?' : canonicalAdminView(currentView) === 'support' ? 'Leave support ticket review?' : canonicalAdminView(currentView) === 'roleGovernance' ? 'Leave role change review?' : canonicalAdminView(currentView) === 'workforceAccess' ? 'Leave workforce access review?' : canonicalAdminView(currentView) === 'kycQueue' ? 'Leave KYC decision review?' : 'Leave customer information?'}</h2>
            <p>{canonicalAdminView(currentView) === 'agents' ? 'Leaving discards unsaved Agent entries, any visible one-time credential and local Agent review locks. An earlier action may already have occurred; inspect Agent access records and audit history before acting again.' : canonicalAdminView(currentView) === 'approvalsInbox' ? 'Leaving discards the local approval decision and review locks. A decision may already have occurred; inspect the authoritative approval and audit trail before acting again.' : canonicalAdminView(currentView) === 'limitAssignments' ? 'Leaving discards assignment entries and local review locks. An action may already have occurred; inspect assignments and audit history before acting again.' : canonicalAdminView(currentView) === 'agentClasses' ? 'Leaving discards class and limit drafts and local review locks. An action may already have occurred; inspect class, assignment and audit records before acting again.' : canonicalAdminView(currentView) === 'dashboardSettings' ? 'Leaving discards dashboard assignment drafts and local review locks. An action may already have occurred; inspect assignment and audit history before acting again.' : canonicalAdminView(currentView) === 'support' ? 'Leaving discards ticket drafts, message retry keys and local review locks. An action may already have occurred; inspect ticket, message and audit history before acting again.' : canonicalAdminView(currentView) === 'roleGovernance' ? 'Leaving discards the role change draft and local review lock. An action may already have occurred; inspect authorized workforce, approval and audit records before acting again.' : canonicalAdminView(currentView) === 'workforceAccess' ? 'Leaving discards workforce drafts, local review locks and any visible one-time credential, which may not be retrievable. An action may already have occurred; inspect workforce and audit records before acting again.' : canonicalAdminView(currentView) === 'kycQueue' ? 'Leaving discards the KYC decision draft and local review lock. An action may already have occurred; inspect the customer assessment and audit history before acting again.' : 'Leaving discards the customer draft, one-time proof or upload retry key, and any local uncertain-outcome lock. An earlier action may already have occurred; inspect current records and audit history before acting again.'}</p>
            {(customerBusy || agentBusy || approvalBusy || limitBusy || classBusy || dashboardBusy || supportBusy || roleBusy || workforceBusy || complianceBusy) && <p>A request is in progress. Leaving cannot cancel or confirm the server outcome.</p>}
            <div className="cm-actions-row">
              <button type="button" className="cm-button cm-button-secondary" onClick={() => setPendingLeave(null)}>Keep working</button>
              <button type="button" className="cm-button cm-button-danger" onClick={() => { const destination = pendingLeave; setPendingLeave(null); if ('logout' in destination) logout(); else performNav(destination.view, destination.context); }}>Discard and leave</button>
            </div>
          </section>
        </div>
      )}
      {mobileOpen && (
        <div className="mn-drawer-layer">
          <div
            className="mn-drawer__backdrop"
            data-testid="mobile-nav-backdrop"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            className="mn-drawer"
            id="mn-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            data-testid="mobile-nav"
            ref={drawerRef}
          >
            <div className="mn-drawer__header">
              <span className="mn-drawer__brand">MonieNaija</span>
              <button
                type="button"
                className="mn-drawer__close"
                aria-label="Close navigation menu"
                data-testid="mobile-menu-close"
                onClick={closeDrawer}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <nav className="mn-nav mn-nav--drawer" aria-label="Mobile navigation">
              {renderNavGroups('drawer')}
            </nav>

            <div className="mn-drawer__logout">
              <Button variant="secondary" onClick={requestLogout}>
                Log out
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
