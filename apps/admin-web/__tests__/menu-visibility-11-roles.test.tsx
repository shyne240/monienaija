import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { Layout } from '../src/screens/authenticated/Layout';
import { AgentNetworkScreen } from '../src/screens/authenticated/AgentNetworkScreen';
import { CommercialRulesScreen } from '../src/screens/authenticated/CommercialRulesScreen';
import { LedgerOperationsScreen } from '../src/screens/authenticated/LedgerOperationsScreen';
import { ReconciliationObservabilityScreen } from '../src/screens/authenticated/ReconciliationObservabilityScreen';
import { canAccessAdminView } from '../src/screens/authenticated/navigation-access';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  ApiError: class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Seed catalogue function grants plus the legacy scope sample from .env.example. Runtime
// principals receive the union; the menu itself is always driven by principal.scopes.
const ROLE_PRINCIPALS = {
  SUPER_ADMIN: {
    type: 'PRIVILEGED', roles: ['SUPER_ADMIN'],
    scopes: ['agent.activate','agent.assign_limit','agent.manage_credentials','agent.manage_outlets_terminals','agent.reactivate','agent.review_application','agent.suspend','agent.terminate','agent.view','aggregator.manage','aggregator.view','audit.search','audit.view','commission_rule.view','compliance.manage_case','compliance.manage_risk_profile','customer.activate','customer.close','customer.create','customer.create_wallet','customer.manage_support_case','customer.suspend','customer.view','customer.view_address','customer.view_contact_methods','customer.view_identity_documents','customer.view_transactions','customer.view_wallets','diagnostics.view','fee_rule.view','kyc.approve','kyc.reject','kyc.review','kyc.view','ledger.view','limit.view','metrics.view','notification.view_deliveries','outbox.view','product.view','reconciliation.view','reporting.transaction_summary.view','reward_rule.view','transaction.view','workforce.dashboard.assign','workforce.dashboard.view','workforce.role.assign','workforce.role.assign_operational','workforce.role.create','workforce.role.modify','workforce.role.revoke','workforce.role.revoke_operational','workforce.role.view','workforce.user.create','workforce.user.suspend','workforce.user.view','privileged:execute'],
  },
  FINANCE_PREPARER: {
    type: 'OPERATOR', roles: ['FINANCE_PREPARER'],
    scopes: ['commission_rule.create','commission_rule.modify','commission_rule.view','fee_rule.create','fee_rule.modify','fee_rule.view','finance.control_policy.activate','ledger.post','ledger.reverse','ledger.view','limit.modify','limit.view','product.governance','product.modify','product.view','reporting.transaction_summary.view','reward_rule.create','reward_rule.modify','reward_rule.view','finance:prepare'],
  },
  FINANCE_CONTROLLER: {
    type: 'OPERATOR', roles: ['FINANCE_CONTROLLER'],
    scopes: ['agent.defund','agent.fund','commission_rule.create','commission_rule.modify','commission_rule.view','fee_rule.create','fee_rule.modify','fee_rule.view','finance.control_policy.activate','ledger.view','limit.modify','limit.view','product.governance','product.modify','product.view','reporting.transaction_summary.view','reward_rule.create','reward_rule.modify','reward_rule.view','workforce.role.assign','workforce.role.create','workforce.role.modify','workforce.role.revoke','workforce.role.view','privileged:approve','privileged:execute'],
  },
  FINANCE_AUDITOR: {
    type: 'OPERATOR', roles: ['FINANCE_AUDITOR'],
    scopes: ['agent.view','aggregator.view','audit.search','audit.view','commission_rule.view','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','diagnostics.view','fee_rule.view','kyc.view','ledger.view','limit.view','metrics.view','notification.view_deliveries','outbox.view','product.view','reconciliation.view','reporting.transaction_summary.view','reward_rule.view','transaction.view','workforce.role.view','finance:audit'],
  },
  ADMINISTRATOR: {
    type: 'OPERATOR', roles: ['ADMINISTRATOR'],
    scopes: ['agent.view','aggregator.view','customer.view','workforce.dashboard.assign','workforce.dashboard.view','workforce.role.assign_operational','workforce.role.revoke_operational','workforce.role.view','workforce.super_admin.recover','workforce.user.create','workforce.user.suspend','workforce.user.view'],
  },
  OPERATIONS: {
    type: 'OPERATOR', roles: ['OPERATIONS'],
    scopes: ['aggregator.manage','aggregator.view','customer.activate','customer.close','customer.create','customer.create_wallet','customer.manage_support_case','customer.suspend','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','customer.view_wallets','diagnostics.view','metrics.view','notification.view_deliveries','outbox.view','reporting.transaction_summary.view','transaction.view','workforce.user.create','workforce.user.suspend','workforce.user.view'],
  },
  AGENT_NETWORK_MANAGER: {
    type: 'OPERATOR', roles: ['AGENT_NETWORK_MANAGER'],
    scopes: ['agent.activate','agent.assign_limit','agent.defund','agent.fund','agent.manage_credentials','agent.manage_outlets_terminals','agent.reactivate','agent.review_application','agent.suspend','agent.terminate','agent.view','limit.view'],
  },
  COMPLIANCE: {
    type: 'OPERATOR', roles: ['COMPLIANCE'],
    scopes: ['compliance.manage_case','compliance.manage_risk_profile','customer.view','customer.view_address','customer.view_contact_methods','customer.view_identity_documents','kyc.approve','kyc.reject','kyc.review','kyc.view'],
  },
  RISK_FRAUD: {
    type: 'OPERATOR', roles: ['RISK_FRAUD'], scopes: ['risk_fraud.manage_fraud_case'],
  },
  CUSTOMER_SERVICE: {
    type: 'OPERATOR', roles: ['CUSTOMER_SERVICE'],
    scopes: ['customer.manage_support_case','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','customer.view_wallets'],
  },
  TREASURY: {
    type: 'OPERATOR', roles: ['TREASURY'], scopes: ['reconciliation.view'],
  },
} as const;

type RoleKey = keyof typeof ROLE_PRINCIPALS;
const ALL_ROLES = Object.keys(ROLE_PRINCIPALS) as RoleKey[];

const ALL_NAV_KEYS = [
  'dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps',
  'ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue',
  'limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess',
  'roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents',
] as const;
type NavKey = typeof ALL_NAV_KEYS[number];

// Visible sidebar routes, derived from each role's seeded function-code set and the existing
// legacy approval/execution scopes. Customer-service transaction history is contextual, not a
// global sidebar route.
const EXPECTED: Record<RoleKey, readonly NavKey[]> = {
  SUPER_ADMIN: ['dashboard','dashboardSettings','customers','agents','agentClasses','support','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','workforceAccess','roleGovernance','notifications','systemHealth','auditEvents'],
  FINANCE_PREPARER: ['dashboard','ledgerExplorer','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments'],
  // INTEGRATION (Arena 3 Phase 5): FINANCE_CONTROLLER + privileged:approve is the notification
  // change-request CHECKER — the Arena 1 registry requireRead admits FC (MFA-verified per
  // request), so the console must be reachable to inspect frozen proposals before deciding.
  FINANCE_CONTROLLER: ['dashboard','agents','ledgerExplorer','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','approvalsInbox','notifications'],
  FINANCE_AUDITOR: ['dashboard','customers','agents','agentClasses','transfers','cashIn','cashOut','cashToCashOps','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','notifications','systemHealth','auditEvents'],
  ADMINISTRATOR: ['dashboard','dashboardSettings','customers','agents','agentClasses','workforceAccess','roleGovernance','superAdminRecovery'],
  OPERATIONS: ['dashboard','customers','support','transfers','cashIn','cashOut','cashToCashOps','workforceAccess','notifications','systemHealth'],
  AGENT_NETWORK_MANAGER: ['dashboard','agents','agentClasses','limitCatalogue','limitAssignments'],
  COMPLIANCE: ['dashboard','customers','kycQueue','complianceCases'],
  RISK_FRAUD: ['dashboard','fraudCases'],
  CUSTOMER_SERVICE: ['dashboard','customers','support'],
  TREASURY: ['dashboard','reconciliation'],
};

const SECTION_KEYS: Record<string, readonly NavKey[]> = {
  home: ['dashboard','dashboardSettings'],
  servicing: ['customers','agents','agentClasses','support'],
  money: ['transfers','cashIn','cashOut','cashToCashOps'],
  finance: ['ledgerExplorer','reconciliation'],
  commercial: ['feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments'],
  compliance: ['kycQueue','complianceCases','fraudCases'],
  platform: ['workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','notifications','systemHealth','auditEvents'],
};

const SCREEN_MARKERS: Record<NavKey, RegExp> = {
  dashboard: /System Administration Dashboard/i,
  dashboardSettings: /Dashboard Settings/i,
  customers: /Customer Directory/i,
  agents: /Agent Network Management/i,
  agentClasses: /Agent Classes & Service Eligibility/i,
  support: /Support Tickets/i,
  transfers: /In-House Transaction & Fee Operations/i,
  cashIn: /In-House Transaction & Fee Operations/i,
  cashOut: /In-House Transaction & Fee Operations/i,
  cashToCashOps: /Cash-to-Cash Operations/i,
  ledgerExplorer: /Ledger Core & Reversals Desk/i,
  reconciliation: /Independent Reconciliation & Breaks Desk/i,
  feeRules: /Commercial Rule Registries/i,
  commissionRules: /Commercial Rule Registries/i,
  rewardRules: /Commercial Rule Registries/i,
  productCatalogue: /Commercial Rule Registries/i,
  limitCatalogue: /Commercial Rule Registries/i,
  limitAssignments: /Limit Assignments/i,
  kycQueue: /KYC Assessment Lookup & Review/i,
  complianceCases: /Compliance Case Lookup/i,
  fraudCases: /Fraud Case Lookup/i,
  workforceAccess: /Workforce Overview & Support Provisioning/i,
  roleGovernance: /Role (Assignments|Governance)/i,
  approvalsInbox: /Privileged Approvals/i,
  superAdminRecovery: /Super-Admin Recovery/i,
  notifications: /SMS & Email Notification Management/i,
  systemHealth: /System Health/i,
  auditEvents: /Audit & Security Events/i,
};

function setPrincipal(roleKey: RoleKey) {
  const definition = ROLE_PRINCIPALS[roleKey];
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'test-token',
    sessionId: 'test-session',
    principal: {
      type: definition.type,
      principalId: `issuer:${roleKey}`,
      sessionId: 'test-session',
      audience: 'workforce-admin',
      roles: [...definition.roles],
      scopes: [...definition.scopes],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
  });
}

describe('V1-MENU-VISIBILITY-11-ROLES — implemented routes for all catalogue roles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({ templateKey: 'DEFAULT_FALLBACK', displayName: 'Default Dashboard', description: '', isFallback: true, widgets: [] });
      }
      if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [], total: 0 });
      if (path.startsWith('/internal/admin/cash-to-cash/transfers?')) return Promise.resolve({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      if (path.startsWith('/internal/agents/') && path.endsWith('/financial-position')) {
        return Promise.resolve({ agentId: 'agent-id', currency: 'NGN', balanceMinor: '0', walletExists: false, walletId: null });
      }
      return Promise.resolve([]);
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
    (ApiClient.put as jest.Mock).mockResolvedValue({});
    (ApiClient.patch as jest.Mock).mockResolvedValue({});
    (ApiClient.delete as jest.Mock).mockResolvedValue({});
    useAuthStore.setState({ isAuthenticated: false, isLoading: false, token: null, sessionId: null, principal: null, error: null });
  });

  test.each(ALL_ROLES)('desktop and mobile navigation for %s matches its granted routes', async (roleKey) => {
    setPrincipal(roleKey);
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<Layout />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const { queryByTestId } = view!;
    const expected = new Set<NavKey>(EXPECTED[roleKey]);

    for (const key of ALL_NAV_KEYS) {
      expect(queryByTestId(`nav-${key}`) !== null).toBe(expected.has(key));
    }
    for (const [section, keys] of Object.entries(SECTION_KEYS)) {
      expect(queryByTestId(`section-${section}`) !== null).toBe(keys.some((key) => expected.has(key)));
    }

    const hamburger = queryByTestId('mobile-menu-toggle');
    expect(hamburger).not.toBeNull();
    fireEvent.click(hamburger!);
    expect(queryByTestId('mobile-nav')).not.toBeNull();
    for (const key of ALL_NAV_KEYS) {
      expect(queryByTestId(`mobile-nav-${key}`) !== null).toBe(expected.has(key));
    }
  });

  test.each(ALL_ROLES)('each visible route for %s renders its implemented screen', async (roleKey) => {
    setPrincipal(roleKey);
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<Layout />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const { container, getByTestId } = view!;
    for (const key of EXPECTED[roleKey]) {
      await act(async () => {
        fireEvent.click(getByTestId(`nav-${key}`));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(container.textContent).toMatch(SCREEN_MARKERS[key]);
    }
  });

  test('customer-scoped history is contextual; it is not a substitute for global transaction.view', () => {
    expect(canAccessAdminView('transfers', ['transaction.view'], ['CUSTOMER_SERVICE'], { customerId: 'customer-1' })).toBe(false);
    expect(canAccessAdminView('transactions', ['customer.view_transactions'], ['CUSTOMER_SERVICE'], { customerId: 'customer-1' })).toBe(true);
    expect(canAccessAdminView('transactions', ['customer.view_transactions'], ['CUSTOMER_SERVICE'])).toBe(false);
  });

  test('approval navigation requires both the configured checker role and approval scope', () => {
    expect(canAccessAdminView('approvalsInbox', ['privileged:approve'], ['FINANCE_AUDITOR'])).toBe(false);
    expect(canAccessAdminView('approvalsInbox', [], ['FINANCE_CONTROLLER'])).toBe(false);
    expect(canAccessAdminView('approvalsInbox', ['privileged:approve'], ['FINANCE_CONTROLLER'])).toBe(true);
  });

  test('funding workflow navigation requires the maker/checker role and a funding function', () => {
    expect(canAccessAdminView('agents', ['agent.fund'], ['FINANCE_CONTROLLER'])).toBe(true);
    expect(canAccessAdminView('agents', ['agent.defund'], ['AGENT_NETWORK_MANAGER'])).toBe(true);
    expect(canAccessAdminView('agents', ['agent.fund'], ['OPERATIONS'])).toBe(false);
    expect(canAccessAdminView('agents', [], ['FINANCE_CONTROLLER'])).toBe(false);
  });

  test('notification management navigation is unlocked only by notification.* authorization scopes', () => {
    expect(canAccessAdminView('notifications', [], ['OPERATIONS'])).toBe(false);
    expect(canAccessAdminView('notifications', ['metrics.view', 'outbox.view'], ['OPERATIONS'])).toBe(false);
    expect(canAccessAdminView('notifications', ['notification.view_deliveries'], ['FINANCE_AUDITOR'])).toBe(true);
    expect(canAccessAdminView('notifications', ['notification.manage_templates'], ['OPERATIONS'])).toBe(true);
    expect(canAccessAdminView('notifications', ['notification.approve_templates'], ['FINANCE_CONTROLLER'])).toBe(true);
    expect(canAccessAdminView('notifications', ['notification.manage_configuration'], ['OPERATIONS'])).toBe(true);
    expect(canAccessAdminView('notifications', ['notification.test_send'], ['OPERATIONS'])).toBe(true);
  });

  test('agent list and lifecycle affordances use exact function scopes, not role-name fallbacks', async () => {
    const agent = { id: 'agent-id', reference: 'AG-001', status: 'ACTIVE', agentClassId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/internal/agents?')) return Promise.resolve({ data: [agent], total: 1 });
      if (path.endsWith('/financial-position')) return Promise.resolve({ agentId: agent.id, currency: 'NGN', balanceMinor: '0', walletExists: false, walletId: null });
      return Promise.resolve([]);
    });

    setPrincipal('FINANCE_AUDITOR');
    const readOnly = render(<AgentNetworkScreen />);
    const readOnlyViewButton = await readOnly.findByText('View');
    await act(async () => {
      fireEvent.click(readOnlyViewButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(readOnly.queryByText('Suspend')).toBeNull();
    expect(readOnly.queryByText('Terminate')).toBeNull();
    expect(readOnly.queryByText('Reactivate')).toBeNull();
    expect(readOnly.queryByText('Activate')).toBeNull();
    readOnly.unmount();

    setPrincipal('AGENT_NETWORK_MANAGER');
    const manager = render(<AgentNetworkScreen />);
    const managerViewButton = await manager.findByText('View');
    await act(async () => {
      fireEvent.click(managerViewButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(manager.getByText('Suspend')).toBeTruthy();
    expect(manager.getByText('Terminate')).toBeTruthy();
    expect(manager.getByText('Reactivate')).toBeTruthy();
    expect(manager.getByText('Activate')).toBeTruthy();
  });

  test('commercial tabs are individually scope-gated instead of inherited from role labels', async () => {
    useAuthStore.setState({
      isAuthenticated: true, isLoading: false, token: 't', sessionId: 's',
      principal: { type: 'PRIVILEGED', principalId: 'issuer:SUPER_ADMIN', sessionId: 's', audience: 'workforce-admin', roles: ['SUPER_ADMIN'], scopes: ['fee_rule.view'], customerAccess: 'NONE', assuranceLevel: 'MFA' },
    });
    (ApiClient.get as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const screen = render(<CommercialRulesScreen initialTab="fees" />);
    expect(screen.getByText('Fees')).toBeTruthy();
    expect(screen.queryByText('Commissions')).toBeNull();
    expect(screen.queryByText('Products')).toBeNull();
    await waitFor(() => expect(ApiClient.get).toHaveBeenCalledWith('/internal/fee-rules'));
    expect(ApiClient.get).not.toHaveBeenCalledWith('/internal/commission-rules');
  });

  test('ledger read screen does not use SUPER_ADMIN role alone as a substitute for ledger.view', () => {
    useAuthStore.setState({
      isAuthenticated: true, isLoading: false, token: 't', sessionId: 's',
      principal: { type: 'PRIVILEGED', principalId: 'issuer:SUPER_ADMIN', sessionId: 's', audience: 'workforce-admin', roles: ['SUPER_ADMIN'], scopes: [], customerAccess: 'NONE', assuranceLevel: 'MFA' },
    });
    const screen = render(<LedgerOperationsScreen />);
    expect(screen.getByRole('alert').textContent).toMatch(/requires ledger.view/i);
    expect(ApiClient.get).not.toHaveBeenCalled();
  });

  test('reconciliation screen requires reconciliation.view even when rendered directly', () => {
    useAuthStore.setState({
      isAuthenticated: true, isLoading: false, token: 't', sessionId: 's',
      principal: { type: 'PRIVILEGED', principalId: 'issuer:SUPER_ADMIN', sessionId: 's', audience: 'workforce-admin', roles: ['SUPER_ADMIN'], scopes: [], customerAccess: 'NONE', assuranceLevel: 'MFA' },
    });
    const screen = render(<ReconciliationObservabilityScreen />);
    expect(screen.getByRole('alert').textContent).toMatch(/requires reconciliation.view/i);
  });
});
