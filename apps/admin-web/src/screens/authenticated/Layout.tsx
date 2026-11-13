import React, { useCallback, useEffect, useRef, useState } from 'react';

import '../../design-system/tokens.css';
import { useAuthStore } from '../../store/auth-store';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { DashboardScreen } from './DashboardScreen';
import { GlobalSearch } from './GlobalSearch';
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
import { InstitutionDirectoryScreen } from './InstitutionDirectoryScreen';
import { InstitutionWorkspaceScreen } from './InstitutionWorkspaceScreen';
import { canonicalAdminView, canAccessAdminView, type AdminView } from './navigation-access';
import './admin-shell.css';
import './one-shell.css';

// Seven-section Admin Web navigation. Money movement includes the dedicated read-only
// Cash-to-Cash operations view; Agent classes are managed through their separate function scope.
// Menu visibility and route selection use function scopes, not role labels.
//
// M1 presentation note: this file owns shell markup, scoped styles and focus/drawer
// behaviour only. Section definitions, text labels, guards, aliases, customer context,
// the route switch, logout and every destination handler are unchanged.

type View = AdminView;

interface NavContext {
  customerId?: string;
  agentId?: string;
  openAgentApplications?: boolean;
  institutionId?: string;
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); accountButtonRef.current?.focus(); } };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [accountOpen]);
  const [navigationQuery, setNavigationQuery] = useState('');
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
  const [recoveryGuard, setRecoveryGuard] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [notificationGuard, setNotificationGuard] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const reportNotificationGuard = useCallback((guarded: boolean, busy: boolean) => { setNotificationGuard(guarded); setNotificationBusy(busy); }, []);
  const [ledgerGuard, setLedgerGuard] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const reportLedgerGuard = useCallback((guarded: boolean, busy: boolean) => { setLedgerGuard(guarded); setLedgerBusy(busy); }, []);
  const reportRecoveryGuard = useCallback((guarded: boolean, busy: boolean) => { setRecoveryGuard(guarded); setRecoveryBusy(busy); }, []);
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
    servicing: false,
    money: false,
    finance: false,
    commercial: false,
    compliance: false,
    institutions: false,
    platform: false,
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
      title: 'Overview',
      items: [
        { key: 'dashboard' as View, label: 'Dashboard', visible: true },
        { key: 'dashboardSettings' as View, label: 'Dashboard Settings', visible: isVisible('dashboardSettings') },
      ],
    },
    {
      id: 'servicing',
      title: 'Customers & agents',
      items: [
        { key: 'customers' as View, label: 'Customers', visible: isVisible('customers') },
        { key: 'agents' as View, label: 'Agents & network', visible: isVisible('agents') },
        { key: 'agentClasses' as View, label: 'Agent classes', visible: isVisible('agentClasses') },
        { key: 'support' as View, label: 'Support Inbox', visible: isVisible('support') },
      ],
    },
    {
      id: 'institutions',
      title: 'Institutions',
      items: [
        {
          key: 'institutions' as View,
          label: 'Institution directory',
          visible: isVisible('institutions'),
        },
      ],
    },
    {
      id: 'money',
      title: 'Transactions',
      items: [
        { key: 'transfers' as View, label: 'Transfers', visible: isVisible('transfers') },
        { key: 'cashIn' as View, label: 'Deposits', visible: isVisible('transfers') },
        { key: 'cashOut' as View, label: 'Withdrawals', visible: isVisible('transfers') },
        { key: 'cashToCashOps' as View, label: 'Cash to cash', visible: isVisible('cashToCashOps') },
      ],
    },
    {
      id: 'finance',
      title: 'Finance',
      items: [
        { key: 'ledgerExplorer' as View, label: 'Ledger & reversals', visible: isVisible('ledgerExplorer') },
        { key: 'reconciliation' as View, label: 'Reconciliation', visible: isVisible('reconciliation') },
      ],
    },
    {
      id: 'commercial',
      title: 'Products & pricing',
      items: [
        { key: 'feeRules' as View, label: 'Fee rules', visible: isVisible('feeRules') },
        { key: 'commissionRules' as View, label: 'Commission rules', visible: isVisible('commissionRules') },
        { key: 'rewardRules' as View, label: 'Reward rules', visible: isVisible('rewardRules') },
        { key: 'productCatalogue' as View, label: 'Products', visible: isVisible('productCatalogue') },
        { key: 'limitCatalogue' as View, label: 'Limit catalogue', visible: isVisible('limitCatalogue') },
        { key: 'limitAssignments' as View, label: 'Limit assignments', visible: isVisible('limitAssignments') },
      ],
    },
    {
      id: 'compliance',
      title: 'Risk & compliance',
      items: [
        { key: 'kycQueue' as View, label: 'KYC reviews', visible: isVisible('kycQueue') },
        { key: 'complianceCases' as View, label: 'Compliance cases', visible: isVisible('complianceCases') },
        { key: 'fraudCases' as View, label: 'Fraud cases', visible: isVisible('fraudCases') },
      ],
    },
    {
      id: 'platform',
      title: 'Administration',
      items: [
        { key: 'workforceAccess' as View, label: 'Workforce access', visible: isVisible('workforceAccess') },
        { key: 'roleGovernance' as View, label: 'Role governance', visible: isVisible('roleGovernance') },
        { key: 'approvalsInbox' as View, label: 'Approvals', visible: isVisible('approvalsInbox') },
        { key: 'superAdminRecovery' as View, label: 'Admin recovery', visible: isVisible('superAdminRecovery') },
        { key: 'notifications' as View, label: 'Notifications', visible: isVisible('notifications') },
        { key: 'systemHealth' as View, label: 'System health', visible: isVisible('systemHealth') },
        { key: 'auditEvents' as View, label: 'Audit events', visible: isVisible('auditEvents') },
      ],
    },
  ];

  const toggleSection = (key: string) => {
    setActiveSection(key);
    setExpandedSections((prev) => ({ [key]: !prev[key] }));
  };

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
    setRecoveryGuard(false); setRecoveryBusy(false);
    setLedgerGuard(false); setLedgerBusy(false);
    setNotificationGuard(false); setNotificationBusy(false);
    setNavigationQuery('');
    setCurrentView(view);
    // Customer context belongs only to the destination explicitly selected from Customer 360°.
    // Clear it on every ordinary navigation so stale IDs cannot leak into unrelated screens.
    setNavContext(context ? { ...context } : {});

    const canonicalView = canonicalAdminView(view);
    const owningSection = sections.find((section) =>
      section.items.some((item) => item.key === canonicalView),
    );
    if (owningSection) {
      setActiveSection(owningSection.id);
      setExpandedSections({ [owningSection.id]: true });
    }
    // A successful navigation closes the drawer and moves focus to the page, not
    // back to the toggle; a denied navigation keeps the guard behaviour unchanged.
    focusContentRef.current = true;
    restoreFocusRef.current = false;
    setMobileOpen(false);
  };

  const handleNav = (view: View, context?: NavContext) => {
    if (!canAccessAdminView(view, principal.scopes, principal.roles, context)) return;
    if ((customerGuard && canonicalAdminView(currentView) === 'customers') || (agentGuard && canonicalAdminView(currentView) === 'agents') || (approvalGuard && canonicalAdminView(currentView) === 'approvalsInbox') || (limitGuard && canonicalAdminView(currentView) === 'limitAssignments') || (classGuard && canonicalAdminView(currentView) === 'agentClasses') || (dashboardGuard && canonicalAdminView(currentView) === 'dashboardSettings') || (supportGuard && canonicalAdminView(currentView) === 'support') || (roleGuard && canonicalAdminView(currentView) === 'roleGovernance') || (workforceGuard && canonicalAdminView(currentView) === 'workforceAccess') || (complianceGuard && canonicalAdminView(currentView) === 'kycQueue') || (recoveryGuard && canonicalAdminView(currentView) === 'superAdminRecovery') || (ledgerGuard && canonicalAdminView(currentView) === 'ledgerExplorer') || (notificationGuard && canonicalAdminView(currentView) === 'notifications')) { restoreFocusRef.current = false; setMobileOpen(false); setPendingLeave({ view, context }); return; }
    performNav(view, context);
  };
  const requestLogout = () => {
    if ((customerGuard && canonicalAdminView(currentView) === 'customers') || (agentGuard && canonicalAdminView(currentView) === 'agents') || (approvalGuard && canonicalAdminView(currentView) === 'approvalsInbox') || (limitGuard && canonicalAdminView(currentView) === 'limitAssignments') || (classGuard && canonicalAdminView(currentView) === 'agentClasses') || (dashboardGuard && canonicalAdminView(currentView) === 'dashboardSettings') || (supportGuard && canonicalAdminView(currentView) === 'support') || (roleGuard && canonicalAdminView(currentView) === 'roleGovernance') || (workforceGuard && canonicalAdminView(currentView) === 'workforceAccess') || (complianceGuard && canonicalAdminView(currentView) === 'kycQueue') || (recoveryGuard && canonicalAdminView(currentView) === 'superAdminRecovery') || (ledgerGuard && canonicalAdminView(currentView) === 'ledgerExplorer') || (notificationGuard && canonicalAdminView(currentView) === 'notifications')) { restoreFocusRef.current = false; setMobileOpen(false); setPendingLeave({ logout: true }); return; }
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
            onNavigate={view => handleNav(view)}
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
      case 'ledgerExplorer': return <LedgerOperationsScreen onLedgerGuardChange={reportLedgerGuard} />;
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
      case 'superAdminRecovery': return <SuperAdminRecoveryScreen onRecoveryGuardChange={reportRecoveryGuard} />;
      case 'notifications': return <NotificationManagementScreen onNotificationGuardChange={reportNotificationGuard} />;
      case 'systemHealth': return <SystemHealthScreen onOpenNotifications={isVisible('notifications') ? () => handleNav('notifications') : undefined} />;
      case 'auditEvents': return <AuditTrailScreen initialCustomerId={navContext.customerId} />;
      case 'institutions': return <InstitutionDirectoryScreen onOpenInstitution={(institutionId) => handleNav('institutionWorkspace', { institutionId })} />;
      case 'institutionWorkspace': return <InstitutionWorkspaceScreen institutionId={navContext.institutionId} onBackToDirectory={() => handleNav('institutions')} />;
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
            id={variant === 'rail' ? `mn-nav-rail-header-${section.id}` : undefined}
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
    <div className={`mn-shell${sidebarCollapsed ? ' mn-shell--collapsed' : ''}`}>
      <a className="mn-skip-link" href="#mn-main-workspace">
        Skip to main content
      </a>

      <aside className="mn-shell__sidebar" data-testid="desktop-nav">
        <div className="one-rail" aria-label="Navigation sections">
          <img src="/favicon.png" alt="MonieNaija" className="one-rail__logo" />
          {sections.filter(section => section.items.some(item => item.visible)).map((section) => (
            <button key={section.id} type="button" title={section.title} aria-label={`Open ${section.title} navigation`} aria-pressed={activeSection === section.id && !sidebarCollapsed} className={activeSection === section.id && !sidebarCollapsed ? 'one-rail__button one-rail__button--active' : 'one-rail__button'} onClick={() => { setSidebarCollapsed(false); setActiveSection(section.id); setExpandedSections({ [section.id]: true }); requestAnimationFrame(() => { const header = document.getElementById(`mn-nav-rail-header-${section.id}`); const nav = header?.closest('.mn-nav'); if (header && nav) nav.scrollTop = header.offsetTop - (nav as HTMLElement).offsetTop; }); }}>
              <span aria-hidden="true">{({home:'▦',servicing:'♙',institutions:'◈',money:'⇄',finance:'◫',commercial:'▤',compliance:'◇',platform:'⚙'} as Record<string,string>)[section.id]}</span>
            </button>
          ))}
        </div>
        <div className="one-nav-panel" id="one-desktop-navigation" hidden={sidebarCollapsed}>
        <div className="one-nav-heading"><div className="mn-shell__brand"><span className="mn-shell__brand-text"><span className="mn-shell__brand-name">MonieNaija One</span><span className="mn-shell__brand-sub">Workforce console</span></span></div>
          <button type="button" className="one-nav-collapse" aria-label="Collapse sidebar" aria-expanded={!sidebarCollapsed} aria-controls="one-desktop-navigation" onClick={() => setSidebarCollapsed(true)}>‹</button>
        </div>
        <nav className="mn-nav" aria-label="Main navigation">
          {renderNavGroups('rail')}
        </nav>

        </div>
        {sidebarCollapsed && <button type="button" className="one-nav-expand" aria-label="Expand sidebar" aria-expanded="false" aria-controls="one-desktop-navigation" onClick={() => setSidebarCollapsed(false)}>›</button>}
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

      <div className="one-command-bar">
        <GlobalSearch query={navigationQuery} onQuery={setNavigationQuery} canSearchCustomers={isVisible('customers')} sessionKey={JSON.stringify([principal.principalId, principal.sessionId, principal.scopes])} workspaces={sections.flatMap(section => section.items).filter(item => item.visible)} onWorkspace={key => handleNav(key as View)} onCustomer={customerId => handleNav('customers', {customerId})} />
        <div className="one-account" ref={accountRef}>
          <button type="button" className="one-account__trigger" ref={accountButtonRef} aria-label="Account menu" aria-expanded={accountOpen} aria-controls="one-account-menu" onClick={() => setAccountOpen(open => !open)}><span className="one-command-avatar">{principalInitial}</span><span className="one-account__role">{principal.roles[0]?.replace(/_/g, ' ')}</span><span aria-hidden="true">⌄</span></button>
          {accountOpen && <div className="one-account__menu" id="one-account-menu"><div className="one-account__details"><strong>{principal.roles[0]?.replace(/_/g, ' ') || 'Operator'}</strong><span title={principal.principalId}>{principalHandle}</span></div><details><summary>Session details</summary><p>{principal.audience} · {principal.assuranceLevel}</p><details><summary>Allowed scopes ({principal.scopes.length})</summary><ul>{principal.scopes.map(scope => <li key={scope}>{scope}</li>)}</ul></details></details><button type="button" onClick={() => { setAccountOpen(false); requestLogout(); }}>Log out</button></div>}
        </div>
      </div>
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
            <h2 id="mn-customer-leave-title">{canonicalAdminView(currentView) === 'agents' ? 'Leave Agent review?' : canonicalAdminView(currentView) === 'approvalsInbox' ? 'Leave approval review?' : canonicalAdminView(currentView) === 'limitAssignments' ? 'Leave limit assignment review?' : canonicalAdminView(currentView) === 'agentClasses' ? 'Leave Agent class review?' : canonicalAdminView(currentView) === 'dashboardSettings' ? 'Leave dashboard settings?' : canonicalAdminView(currentView) === 'support' ? 'Leave support ticket review?' : canonicalAdminView(currentView) === 'roleGovernance' ? 'Leave role change review?' : canonicalAdminView(currentView) === 'workforceAccess' ? 'Leave workforce access review?' : canonicalAdminView(currentView) === 'kycQueue' ? 'Leave KYC decision review?' : canonicalAdminView(currentView) === 'superAdminRecovery' ? 'Leave recovery review?' : canonicalAdminView(currentView) === 'ledgerExplorer' ? 'Leave ledger reversal review?' : canonicalAdminView(currentView) === 'notifications' ? 'Leave notification review?' : 'Leave customer information?'}</h2>
            <p>{canonicalAdminView(currentView) === 'agents' ? 'Leaving discards unsaved Agent and funding entries, any visible one-time credential and local review locks. A funding key may remain in browser storage, but an earlier action may already have occurred; inspect Agent, funding, approval, ledger and audit records before acting again.' : canonicalAdminView(currentView) === 'approvalsInbox' ? 'Leaving discards approval and funding entries and local review locks. A decision or posting may already have occurred; inspect authoritative funding, approval, ledger and audit records before acting again.' : canonicalAdminView(currentView) === 'limitAssignments' ? 'Leaving discards assignment entries and local review locks. An action may already have occurred; inspect assignments and audit history before acting again.' : canonicalAdminView(currentView) === 'agentClasses' ? 'Leaving discards class and limit drafts and local review locks. An action may already have occurred; inspect class, assignment and audit records before acting again.' : canonicalAdminView(currentView) === 'dashboardSettings' ? 'Leaving discards dashboard assignment drafts and local review locks. An action may already have occurred; inspect assignment and audit history before acting again.' : canonicalAdminView(currentView) === 'support' ? 'Leaving discards ticket drafts, message retry keys and local review locks. An action may already have occurred; inspect ticket, message and audit history before acting again.' : canonicalAdminView(currentView) === 'roleGovernance' ? 'Leaving discards the role change draft and local review lock. An action may already have occurred; inspect authorized workforce, approval and audit records before acting again.' : canonicalAdminView(currentView) === 'workforceAccess' ? 'Leaving discards workforce drafts, local review locks and any visible one-time credential, which may not be retrievable. An action may already have occurred; inspect workforce and audit records before acting again.' : canonicalAdminView(currentView) === 'kycQueue' ? 'Leaving discards the KYC decision draft and local review lock. An action may already have occurred; inspect the customer assessment and audit history before acting again.' : canonicalAdminView(currentView) === 'superAdminRecovery' ? 'Leaving discards the recovery statement, receipt and local review lock. Recovery may already have occurred; inspect authorized recovery, assignment, session and audit records before acting again.' : canonicalAdminView(currentView) === 'ledgerExplorer' ? 'Leaving discards reversal details and local journal safeguards. A request or reversal may already exist; inspect journal, approval and audit records before acting again.' : canonicalAdminView(currentView) === 'notifications' ? 'Leaving discards notification trigger, template, checker and test-send drafts and local safeguards. A proposal, decision, execution or test-send may already exist; independently review relevant approval, configuration, template, provider and audit records before acting again.' : 'Leaving discards the customer draft, one-time proof or upload retry key, and any local uncertain-outcome lock. An earlier action may already have occurred; inspect current records and audit history before acting again.'}</p>
            {(customerBusy || agentBusy || approvalBusy || limitBusy || classBusy || dashboardBusy || supportBusy || roleBusy || workforceBusy || complianceBusy || recoveryBusy || ledgerBusy || notificationBusy) && <p>A request is in progress. Leaving cannot cancel or confirm the server outcome.</p>}
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

          </div>
        </div>
      )}
    </div>
  );
};
