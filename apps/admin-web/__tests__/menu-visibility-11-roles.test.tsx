/**
 * V1-MENU-VISIBILITY-11-ROLES — seven-section 26-submenu normative IA verification.
 * Renders actual Layout with each role's real catalogue scopes (live backend POST /internal/a2/workforce/local-admin-sessions capture)
 * and inspects rendered navigation buttons for both desktop and mobile, plus section headers.
 * Also clicks every visible menu and asserts target screen renders heading, proving route not blank.
 * Expected matrix derived from authorization-catalogue.seed.ts + Layout canView* predicates (least-privilege, granular commercial).
 * Legacy 15-key aliases removed — this tests the 26-submenu normative tree (proposal §3.2 corrected 2026-10-21).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useAuthStore } from '../src/store/auth-store';
import { Layout } from '../src/screens/authenticated/Layout';

const ROLE_PRINCIPALS: Record<string, { roles: string[]; scopes: string[]; type: 'PRIVILEGED'|'OPERATOR' }> = {
  SUPER_ADMIN: { type: 'PRIVILEGED', roles: ['SUPER_ADMIN'], scopes: ['agent.activate','agent.assign_limit','agent.manage_credentials','agent.manage_outlets_terminals','agent.reactivate','agent.review_application','agent.suspend','agent.terminate','agent.view','aggregator.manage','aggregator.view','audit.search','audit.view','commission_rule.view','compliance.manage_case','compliance.manage_risk_profile','customer.activate','customer.close','customer.create','customer.create_wallet','customer.manage_support_case','customer.suspend','customer.view','customer.view_address','customer.view_contact_methods','customer.view_identity_documents','customer.view_transactions','customer.view_wallets','diagnostics.view','fee_rule.view','kyc.approve','kyc.reject','kyc.review','kyc.view','ledger.view','limit.view','metrics.view','notification.view_deliveries','outbox.view','product.view','reconciliation.view','reporting.transaction_summary.view','reward_rule.view','transaction.view','workforce.dashboard.assign','workforce.dashboard.view','workforce.role.assign','workforce.role.assign_operational','workforce.role.create','workforce.role.modify','workforce.role.revoke','workforce.role.revoke_operational','workforce.role.view','workforce.user.create','workforce.user.suspend','workforce.user.view','privileged:execute'] },
  FINANCE_PREPARER: { type: 'OPERATOR', roles: ['FINANCE_PREPARER'], scopes: ['commission_rule.create','commission_rule.modify','commission_rule.view','fee_rule.create','fee_rule.modify','fee_rule.view','finance.control_policy.activate','ledger.post','ledger.reverse','ledger.view','limit.modify','limit.view','product.governance','product.modify','product.view','reporting.transaction_summary.view','reward_rule.create','reward_rule.modify','reward_rule.view','finance:prepare'] },
  FINANCE_CONTROLLER: { type: 'OPERATOR', roles: ['FINANCE_CONTROLLER'], scopes: ['agent.defund','agent.fund','commission_rule.create','commission_rule.modify','commission_rule.view','fee_rule.create','fee_rule.modify','fee_rule.view','finance.control_policy.activate','ledger.view','limit.modify','limit.view','product.governance','product.modify','product.view','reporting.transaction_summary.view','reward_rule.create','reward_rule.modify','reward_rule.view','workforce.role.assign','workforce.role.create','workforce.role.modify','workforce.role.revoke','workforce.role.view','privileged:approve','privileged:execute'] },
  FINANCE_AUDITOR: { type: 'OPERATOR', roles: ['FINANCE_AUDITOR'], scopes: ['agent.view','aggregator.view','audit.search','audit.view','commission_rule.view','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','diagnostics.view','fee_rule.view','kyc.view','ledger.view','limit.view','metrics.view','notification.view_deliveries','outbox.view','product.view','reconciliation.view','reporting.transaction_summary.view','reward_rule.view','transaction.view','workforce.role.view','finance:audit'] },
  ADMINISTRATOR: { type: 'OPERATOR', roles: ['ADMINISTRATOR'], scopes: ['agent.view','aggregator.view','customer.view','workforce.dashboard.assign','workforce.dashboard.view','workforce.role.assign_operational','workforce.role.revoke_operational','workforce.role.view','workforce.super_admin.recover','workforce.user.create','workforce.user.suspend','workforce.user.view'] },
  OPERATIONS: { type: 'OPERATOR', roles: ['OPERATIONS'], scopes: ['aggregator.manage','aggregator.view','customer.activate','customer.close','customer.create','customer.create_wallet','customer.manage_support_case','customer.suspend','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','customer.view_wallets','diagnostics.view','metrics.view','notification.view_deliveries','outbox.view','reporting.transaction_summary.view','transaction.view','workforce.user.create','workforce.user.suspend','workforce.user.view'] },
  AGENT_NETWORK_MANAGER: { type: 'OPERATOR', roles: ['AGENT_NETWORK_MANAGER'], scopes: ['agent.activate','agent.assign_limit','agent.defund','agent.fund','agent.manage_credentials','agent.manage_outlets_terminals','agent.reactivate','agent.review_application','agent.suspend','agent.terminate','agent.view','limit.view'] },
  COMPLIANCE: { type: 'OPERATOR', roles: ['COMPLIANCE'], scopes: ['compliance.manage_case','compliance.manage_risk_profile','customer.view','customer.view_address','customer.view_contact_methods','customer.view_identity_documents','kyc.approve','kyc.reject','kyc.review','kyc.view'] },
  RISK_FRAUD: { type: 'OPERATOR', roles: ['RISK_FRAUD'], scopes: ['risk_fraud.manage_fraud_case'] },
  CUSTOMER_SERVICE: { type: 'OPERATOR', roles: ['CUSTOMER_SERVICE'], scopes: ['customer.manage_support_case','customer.view','customer.view_address','customer.view_contact_methods','customer.view_transactions','customer.view_wallets'] },
  TREASURY: { type: 'OPERATOR', roles: ['TREASURY'], scopes: ['reconciliation.view'] },
};

// 26-submenu normative tree (proposal §3.2 corrected 26, not 23)
const ALL_NAV_KEYS = ['dashboard','dashboardSettings','customers','agents','support','transfers','cashIn','cashOut','cashToCash','ledgerExplorer','reconciliation','feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments','kycQueue','complianceCases','fraudCases','workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','systemHealth','auditEvents'] as const;
type NavKey = typeof ALL_NAV_KEYS[number];

// Expected visibility derived from Layout canView* predicates (least-privilege granular commercial)
// Verified 2026-10-21 via node probe against ROLE_PRINCIPALS scopes
const EXPECTED: Record<string, Record<NavKey, boolean>> = {
  SUPER_ADMIN: { dashboard:true, dashboardSettings:true, customers:true, agents:true, support:true, transfers:true, cashIn:true, cashOut:true, cashToCash:true, ledgerExplorer:true, reconciliation:true, feeRules:true, commissionRules:true, rewardRules:true, productCatalogue:true, limitCatalogue:true, limitAssignments:true, kycQueue:true, complianceCases:true, fraudCases:true, workforceAccess:true, roleGovernance:true, approvalsInbox:true, superAdminRecovery:true, systemHealth:true, auditEvents:true },
  FINANCE_PREPARER: { dashboard:true, dashboardSettings:false, customers:false, agents:false, support:false, transfers:true, cashIn:true, cashOut:true, cashToCash:true, ledgerExplorer:true, reconciliation:false, feeRules:true, commissionRules:true, rewardRules:true, productCatalogue:true, limitCatalogue:true, limitAssignments:true, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:false, roleGovernance:false, approvalsInbox:true, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  FINANCE_CONTROLLER: { dashboard:true, dashboardSettings:false, customers:false, agents:false, support:false, transfers:true, cashIn:true, cashOut:true, cashToCash:true, ledgerExplorer:true, reconciliation:false, feeRules:true, commissionRules:true, rewardRules:true, productCatalogue:true, limitCatalogue:true, limitAssignments:true, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:true, roleGovernance:true, approvalsInbox:true, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  FINANCE_AUDITOR: { dashboard:true, dashboardSettings:false, customers:true, agents:true, support:false, transfers:true, cashIn:true, cashOut:true, cashToCash:true, ledgerExplorer:true, reconciliation:true, feeRules:true, commissionRules:true, rewardRules:true, productCatalogue:true, limitCatalogue:true, limitAssignments:true, kycQueue:true, complianceCases:false, fraudCases:false, workforceAccess:true, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:true, auditEvents:true },
  ADMINISTRATOR: { dashboard:true, dashboardSettings:true, customers:true, agents:true, support:false, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:true, roleGovernance:true, approvalsInbox:false, superAdminRecovery:true, systemHealth:false, auditEvents:false },
  OPERATIONS: { dashboard:true, dashboardSettings:false, customers:true, agents:false, support:true, transfers:true, cashIn:true, cashOut:true, cashToCash:true, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:true, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:true, auditEvents:false },
  AGENT_NETWORK_MANAGER: { dashboard:true, dashboardSettings:false, customers:false, agents:true, support:false, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:true, limitAssignments:true, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:false, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  COMPLIANCE: { dashboard:true, dashboardSettings:false, customers:true, agents:false, support:false, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:true, complianceCases:true, fraudCases:false, workforceAccess:false, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  RISK_FRAUD: { dashboard:true, dashboardSettings:false, customers:false, agents:false, support:false, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:false, complianceCases:false, fraudCases:true, workforceAccess:false, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  CUSTOMER_SERVICE: { dashboard:true, dashboardSettings:false, customers:true, agents:false, support:true, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:false, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:false, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:false, auditEvents:false },
  TREASURY: { dashboard:true, dashboardSettings:false, customers:false, agents:false, support:false, transfers:false, cashIn:false, cashOut:false, cashToCash:false, ledgerExplorer:false, reconciliation:true, feeRules:false, commissionRules:false, rewardRules:false, productCatalogue:false, limitCatalogue:false, limitAssignments:false, kycQueue:false, complianceCases:false, fraudCases:false, workforceAccess:false, roleGovernance:false, approvalsInbox:false, superAdminRecovery:false, systemHealth:false, auditEvents:false },
};

// Each nav key must open a real screen (heading regex). Commercial 6 tabs share same heading; Money Movement 4 tabs share same screen.
const SCREEN_MARKERS: Record<NavKey, RegExp> = {
  dashboard: /Operational Dashboard|System Administration Dashboard/i,
  dashboardSettings: /Dashboard Settings/i,
  customers: /Customer Directory|Customer.*KYC Servicing/i,
  agents: /Agent Network/i,
  support: /Support Tickets/i,
  transfers: /Transaction.*Fee|In-House Transaction/i,
  cashIn: /Transaction.*Fee|In-House Transaction/i,
  cashOut: /Transaction.*Fee|In-House Transaction/i,
  cashToCash: /Transaction.*Fee|In-House Transaction/i,
  ledgerExplorer: /Ledger.*Reversals|Ledger Core/i,
  reconciliation: /Reconciliation.*Breaks|Independent Reconciliation/i,
  feeRules: /Commercial Rule Registries/i,
  commissionRules: /Commercial Rule Registries/i,
  rewardRules: /Commercial Rule Registries/i,
  productCatalogue: /Commercial Rule Registries/i,
  limitCatalogue: /Commercial Rule Registries/i,
  limitAssignments: /Limit Assignments/i,
  kycQueue: /Compliance.*KYC/i,
  complianceCases: /Compliance.*KYC/i,
  fraudCases: /Risk.*Fraud/i,
  workforceAccess: /Workforce Administration|Workforce Admin/i,
  roleGovernance: /Finance Role Administration|Workforce.*Role/i,
  approvalsInbox: /Privileged Approvals/i,
  superAdminRecovery: /Super-Admin Recovery/i,
  systemHealth: /System Health/i,
  auditEvents: /Audit.*Security Events/i,
};

describe('V1-MENU-VISIBILITY-11-ROLES — 7-section 26-submenu normative IA', () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated:false, isLoading:false, token:null, sessionId:null, principal:null, error:null });
    (global as any).localStorage={ getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{} };
  });

  const ALL_ROLES=Object.keys(ROLE_PRINCIPALS) as Array<keyof typeof ROLE_PRINCIPALS>;

  test.each(ALL_ROLES)('desktop nav for %s matches expected 26-key matrix (least-privilege)', (roleKey) => {
    const def=ROLE_PRINCIPALS[roleKey];
    useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'test-token', sessionId:'test-session', principal:{ type:def.type as any, principalId:'https://local-dev-identity.monienaija.invalid:local-admin-credential:'+roleKey, sessionId:'test-session', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
    const { queryByTestId } = render(<Layout />);
    for(const navKey of ALL_NAV_KEYS){
      const expectedVisible=EXPECTED[roleKey][navKey];
      const el=queryByTestId('nav-'+navKey);
      if(expectedVisible) expect(el).not.toBeNull();
      else expect(el).toBeNull();
    }
    // Section headers must exist when they contain visible items
    const visibleSectionsForRole = new Set<string>();
    // Derive expected visible sections from navKeys (7 sections map)
    const sectionMap: Record<string, NavKey[]> = {
      home: ['dashboard','dashboardSettings'],
      servicing: ['customers','agents','support'],
      money: ['transfers','cashIn','cashOut','cashToCash'],
      finance: ['ledgerExplorer','reconciliation'],
      commercial: ['feeRules','commissionRules','rewardRules','productCatalogue','limitCatalogue','limitAssignments'],
      compliance: ['kycQueue','complianceCases','fraudCases'],
      platform: ['workforceAccess','roleGovernance','approvalsInbox','superAdminRecovery','systemHealth','auditEvents'],
    };
    for(const [secId, keys] of Object.entries(sectionMap)){
      if(keys.some(k=>EXPECTED[roleKey][k as NavKey])) visibleSectionsForRole.add(secId);
    }
    for(const secId of ['home','servicing','money','finance','commercial','compliance','platform']){
      const header=queryByTestId('section-'+secId);
      if(visibleSectionsForRole.has(secId)) expect(header).not.toBeNull();
      else expect(header).toBeNull();
    }
    // mobile drawer parity
    const hamburger=queryByTestId('mobile-menu-toggle');
    expect(hamburger).not.toBeNull();
    fireEvent.click(hamburger!);
    const mobileNav=queryByTestId('mobile-nav');
    expect(mobileNav).not.toBeNull();
    for(const navKey of ALL_NAV_KEYS){
      const expectedVisible=EXPECTED[roleKey][navKey];
      const mobileEl=queryByTestId('mobile-nav-'+navKey);
      if(expectedVisible) expect(mobileEl).not.toBeNull();
      else expect(mobileEl).toBeNull();
    }
    fireEvent.click(hamburger!);
  });

  test.each(ALL_ROLES)('each visible menu for %s renders a real screen (not blank)', (roleKey) => {
    const def=ROLE_PRINCIPALS[roleKey];
    useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'test-token', sessionId:'test-session', principal:{ type:def.type as any, principalId:'https://local-dev-identity.monienaija.invalid:local-admin-credential:'+roleKey, sessionId:'test-session', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
    const { container, getByTestId } = render(<Layout />);
    for(const navKey of ALL_NAV_KEYS){
      if(!EXPECTED[roleKey][navKey]) continue;
      const btn=getByTestId('nav-'+navKey);
      fireEvent.click(btn);
      const content=container.textContent||'';
      if(navKey==='dashboard') expect(content.length).toBeGreaterThan(200);
      else expect(content).toMatch(SCREEN_MARKERS[navKey]);
    }
  });

  test('no cross-role leak for critical least-privilege pairs', () => {
    const forbiddenPairs: Array<[string, NavKey]> = [
      ['FINANCE_PREPARER','customers'],
      ['FINANCE_PREPARER','agents'],
      ['FINANCE_PREPARER','kycQueue'],
      ['OPERATIONS','ledgerExplorer'],
      ['OPERATIONS','feeRules'],
      ['TREASURY','customers'],
      ['TREASURY','transfers'],
      ['RISK_FRAUD','complianceCases'],
      ['RISK_FRAUD','kycQueue'],
      ['COMPLIANCE','fraudCases'],
      ['COMPLIANCE','ledgerExplorer'],
      ['CUSTOMER_SERVICE','ledgerExplorer'],
      ['CUSTOMER_SERVICE','reconciliation'],
      ['AGENT_NETWORK_MANAGER','feeRules'],
      ['AGENT_NETWORK_MANAGER','transfers'],
    ];
    for(const [roleKey, navKey] of forbiddenPairs){
      const def=ROLE_PRINCIPALS[roleKey as keyof typeof ROLE_PRINCIPALS];
      useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'t', sessionId:'s', principal:{ type:def.type as any, principalId:'iss:'+roleKey, sessionId:'s', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
      const { queryByTestId }=render(<Layout />);
      expect(queryByTestId('nav-'+navKey)).toBeNull();
    }
  });

  test('commercial granularity: AGENT_NETWORK_MANAGER sees only limit submenus, not fee/commission', () => {
    const def=ROLE_PRINCIPALS['AGENT_NETWORK_MANAGER'];
    useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'t', sessionId:'s', principal:{ type:def.type as any, principalId:'iss:AGENT_NETWORK_MANAGER', sessionId:'s', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
    const { queryByTestId }=render(<Layout />);
    expect(queryByTestId('nav-feeRules')).toBeNull();
    expect(queryByTestId('nav-commissionRules')).toBeNull();
    expect(queryByTestId('nav-rewardRules')).toBeNull();
    expect(queryByTestId('nav-productCatalogue')).toBeNull();
    expect(queryByTestId('nav-limitCatalogue')).not.toBeNull();
    expect(queryByTestId('nav-limitAssignments')).not.toBeNull();
  });
});
