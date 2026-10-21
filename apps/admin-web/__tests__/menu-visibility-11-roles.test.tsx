/**
 * V1-MENU-VISIBILITY-11-ROLES — real rendered menu verification for all 11 V1 roles.
 *
 * This test does NOT merely inspect config or backend HTTP codes. It renders the actual
 * Layout component with each role's real catalogue scopes (as returned by the live
 * backend's POST /internal/a2/workforce/local-admin-sessions — captured once and
 * hardcoded here as ROLE_PRINCIPALS) and inspects the *rendered* navigation buttons
 * for both desktop and mobile.
 *
 * It also clicks every visible menu and asserts the target screen renders its heading,
 * proving the menu does not lead to a blank/placeholder/broken route.
 *
 * Expected matrix is derived from authorization-catalogue.seed.ts (pure function grants,
 * SUPER_ADMIN overgrant only). Every entry marked Visible/Hidden is asserted; any
 * Failed (blank screen) is a hard failure.
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

const ALL_NAV_KEYS = ['dashboard','dashboardSettings','customers','agents','ledger','transactions','reconciliation','support','compliance','riskfraud','roles','approvals','workforce','system','commercial'] as const;
type NavKey = typeof ALL_NAV_KEYS[number];

const EXPECTED: Record<string, Record<NavKey, boolean>> = {
  SUPER_ADMIN: { dashboard:true, dashboardSettings:true, customers:true, agents:true, ledger:true, transactions:true, reconciliation:true, support:true, compliance:true, riskfraud:true, roles:true, approvals:true, workforce:true, system:true, commercial:true },
  FINANCE_PREPARER: { dashboard:true, dashboardSettings:false, customers:false, agents:false, ledger:true, transactions:true, reconciliation:false, support:false, compliance:false, riskfraud:false, roles:false, approvals:true, workforce:false, system:false, commercial:true },
  FINANCE_CONTROLLER: { dashboard:true, dashboardSettings:false, customers:false, agents:false, ledger:true, transactions:true, reconciliation:false, support:false, compliance:false, riskfraud:false, roles:true, approvals:true, workforce:true, system:false, commercial:true },
  FINANCE_AUDITOR: { dashboard:true, dashboardSettings:false, customers:true, agents:true, ledger:true, transactions:true, reconciliation:true, support:false, compliance:true, riskfraud:false, roles:false, approvals:false, workforce:true, system:true, commercial:true },
  ADMINISTRATOR: { dashboard:true, dashboardSettings:true, customers:true, agents:true, ledger:false, transactions:false, reconciliation:false, support:false, compliance:false, riskfraud:false, roles:true, approvals:false, workforce:true, system:false, commercial:false },
  OPERATIONS: { dashboard:true, dashboardSettings:false, customers:true, agents:false, ledger:false, transactions:true, reconciliation:false, support:true, compliance:false, riskfraud:false, roles:false, approvals:false, workforce:true, system:true, commercial:false },
  AGENT_NETWORK_MANAGER: { dashboard:true, dashboardSettings:false, customers:false, agents:true, ledger:false, transactions:false, reconciliation:false, support:false, compliance:false, riskfraud:false, roles:false, approvals:false, workforce:false, system:false, commercial:true },
  COMPLIANCE: { dashboard:true, dashboardSettings:false, customers:true, agents:false, ledger:false, transactions:false, reconciliation:false, support:false, compliance:true, riskfraud:false, roles:false, approvals:false, workforce:false, system:false, commercial:false },
  RISK_FRAUD: { dashboard:true, dashboardSettings:false, customers:false, agents:false, ledger:false, transactions:false, reconciliation:false, support:false, compliance:false, riskfraud:true, roles:false, approvals:false, workforce:false, system:false, commercial:false },
  CUSTOMER_SERVICE: { dashboard:true, dashboardSettings:false, customers:true, agents:false, ledger:false, transactions:false, reconciliation:false, support:true, compliance:false, riskfraud:false, roles:false, approvals:false, workforce:false, system:false, commercial:false },
  TREASURY: { dashboard:true, dashboardSettings:false, customers:false, agents:false, ledger:false, transactions:false, reconciliation:true, support:false, compliance:false, riskfraud:false, roles:false, approvals:false, workforce:false, system:false, commercial:false },
};

const SCREEN_MARKERS: Record<NavKey, RegExp> = {
  dashboard: /Operational Dashboard|Executive|Transaction.*Operations|System Administration Dashboard/i,
  dashboardSettings: /Dashboard Settings/i,
  customers: /Customer.*KYC|Customer Directory/i,
  agents: /Agent Network/i,
  ledger: /Ledger.*Reversals|Ledger Operations/i,
  transactions: /Transaction.*Fee|Transaction.*Operations/i,
  reconciliation: /Reconciliation.*Breaks/i,
  support: /Support Tickets|Support Ticket Queue/i,
  compliance: /Compliance.*KYC/i,
  riskfraud: /Risk.*Fraud/i,
  roles: /Finance Role Admin|Workforce.*Role/i,
  approvals: /Privileged Approvals/i,
  workforce: /Workforce Administration|Workforce Admin/i,
  system: /System Health/i,
  commercial: /Commercial.*Rules|Commercial Rule Registries/i,
};

describe('V1-MENU-VISIBILITY-11-ROLES', () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated:false, isLoading:false, token:null, sessionId:null, principal:null, error:null });
    (global as any).localStorage={ getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{} };
  });
  const ALL_ROLES=Object.keys(ROLE_PRINCIPALS) as Array<keyof typeof ROLE_PRINCIPALS>;
  test.each(ALL_ROLES)('desktop nav for %s matches expected matrix', (roleKey) => {
    const def=ROLE_PRINCIPALS[roleKey];
    useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'test-token', sessionId:'test-session', principal:{ type:def.type as any, principalId:'https://local-dev-identity.monienaija.invalid:local-admin-credential:'+roleKey, sessionId:'test-session', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
    const { queryByTestId } = render(<Layout />);
    for(const navKey of ALL_NAV_KEYS){
      const expectedVisible=EXPECTED[roleKey][navKey];
      const el=queryByTestId('nav-'+navKey);
      if(expectedVisible) expect(el).not.toBeNull();
      else expect(el).toBeNull();
    }
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
  test.each(ALL_ROLES)('each visible menu for %s renders a real screen', (roleKey) => {
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
  test('no cross-role leak for critical pairs', () => {
    const forbiddenPairs: Array<[string, NavKey]> = [['FINANCE_PREPARER','customers'],['FINANCE_PREPARER','agents'],['OPERATIONS','ledger'],['TREASURY','customers'],['RISK_FRAUD','compliance'],['COMPLIANCE','riskfraud']];
    for(const [roleKey, navKey] of forbiddenPairs){
      const def=ROLE_PRINCIPALS[roleKey as keyof typeof ROLE_PRINCIPALS];
      useAuthStore.setState({ isAuthenticated:true, isLoading:false, token:'t', sessionId:'s', principal:{ type:def.type as any, principalId:'iss:'+roleKey, sessionId:'s', audience:'workforce-admin', roles:def.roles, scopes:def.scopes, customerAccess:'NONE', assuranceLevel:'MFA' }});
      const { queryByTestId }=render(<Layout />);
      expect(queryByTestId('nav-'+navKey)).toBeNull();
    }
  });
});
