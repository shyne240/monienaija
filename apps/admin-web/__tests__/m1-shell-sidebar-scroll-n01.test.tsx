import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { Layout } from '../src/screens/authenticated/Layout';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';

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

const SHELL_CSS_PATH = path.join(
  __dirname,
  '..',
  'src',
  'screens',
  'authenticated',
  'admin-shell.css',
);

const SUPER_ADMIN_SCOPES = [
  'agent.activate',
  'agent.assign_limit',
  'agent.manage_credentials',
  'agent.manage_outlets_terminals',
  'agent.reactivate',
  'agent.review_application',
  'agent.suspend',
  'agent.terminate',
  'agent.view',
  'aggregator.manage',
  'aggregator.view',
  'audit.search',
  'audit.view',
  'commission_rule.view',
  'compliance.manage_case',
  'compliance.manage_risk_profile',
  'customer.activate',
  'customer.close',
  'customer.create',
  'customer.create_wallet',
  'customer.manage_support_case',
  'customer.suspend',
  'customer.view',
  'customer.view_address',
  'customer.view_contact_methods',
  'customer.view_identity_documents',
  'customer.view_transactions',
  'customer.view_wallets',
  'diagnostics.view',
  'fee_rule.view',
  'kyc.approve',
  'kyc.reject',
  'kyc.review',
  'kyc.view',
  'ledger.view',
  'limit.view',
  'metrics.view',
  'notification.view_deliveries',
  'outbox.view',
  'product.view',
  'reconciliation.view',
  'reporting.transaction_summary.view',
  'reward_rule.view',
  'transaction.view',
  'workforce.dashboard.assign',
  'workforce.dashboard.view',
  'workforce.role.assign',
  'workforce.role.assign_operational',
  'workforce.role.create',
  'workforce.role.modify',
  'workforce.role.revoke',
  'workforce.role.revoke_operational',
  'workforce.role.view',
  'workforce.user.create',
  'workforce.user.suspend',
  'workforce.user.view',
  'privileged:execute',
];

const FINANCE_AUDITOR_SCOPES = [
  'agent.view',
  'aggregator.view',
  'audit.search',
  'audit.view',
  'commission_rule.view',
  'customer.view',
  'customer.view_address',
  'customer.view_contact_methods',
  'customer.view_transactions',
  'diagnostics.view',
  'fee_rule.view',
  'kyc.view',
  'ledger.view',
  'limit.view',
  'metrics.view',
  'notification.view_deliveries',
  'outbox.view',
  'product.view',
  'reconciliation.view',
  'reporting.transaction_summary.view',
  'reward_rule.view',
  'transaction.view',
  'workforce.role.view',
  'finance:audit',
];

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extracts top-level (non-@media) declaration blocks for an exact selector.
 */
function extractTopLevelRuleBodies(css: string, targetSelector: string): string[] {
  const clean = stripCssComments(css);
  const bodies: string[] = [];
  let depth = 0;
  let headerStart = 0;
  let currentSelectors: string[] = [];
  let bodyStart = -1;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '{') {
      if (depth === 0) {
        const rawHeader = clean.slice(headerStart, i).trim();
        if (!rawHeader.startsWith('@')) {
          currentSelectors = rawHeader
            .split(',')
            .map((s) => s.replace(/\s+/g, ' ').trim());
          bodyStart = i + 1;
        } else {
          currentSelectors = [];
          bodyStart = -1;
        }
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (bodyStart !== -1 && currentSelectors.includes(targetSelector)) {
          bodies.push(clean.slice(bodyStart, i));
        }
        headerStart = i + 1;
        currentSelectors = [];
        bodyStart = -1;
      }
    }
  }
  return bodies;
}

function setRolePrincipal(
  role: 'SUPER_ADMIN' | 'FINANCE_AUDITOR',
  scopes: string[],
  type: 'PRIVILEGED' | 'OPERATOR' = 'OPERATOR',
) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: `synthetic-${role.toLowerCase()}-token`,
    sessionId: `session-${role.toLowerCase()}`,
    principal: {
      type,
      principalId: `https://idp.example.com:${role.toLowerCase()}`,
      sessionId: `session-${role.toLowerCase()}`,
      audience: 'workforce-admin',
      roles: [role],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    error: null,
  });
}

describe('Mission 19B (Defect N-01) — sidebar navigation scroll containment and non-overlapping logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('my-dashboard')) {
        return Promise.resolve({
          templateKey: 'EXECUTIVE_GOVERNANCE',
          displayName: 'Executive Governance Dashboard',
          description: '',
          isFallback: false,
          widgets: [],
        });
      }
      return Promise.resolve({ data: [], items: [], records: [], total: 0 });
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('admin-shell.css isolates scrolling to .mn-nav and prevents flex-shrink overlap with logout panels', () => {
    const css = fs.readFileSync(SHELL_CSS_PATH, 'utf8');

    const sidebarBody = extractTopLevelRuleBodies(css, '.mn-shell__sidebar').join('\n');
    const drawerBody = extractTopLevelRuleBodies(css, '.mn-drawer').join('\n');
    const navBody = extractTopLevelRuleBodies(css, '.mn-nav').join('\n');
    const groupBody = extractTopLevelRuleBodies(css, '.mn-nav__group').join('\n');
    const toggleBody = extractTopLevelRuleBodies(css, '.mn-nav__group-toggle').join('\n');
    const itemBody = extractTopLevelRuleBodies(css, '.mn-nav__item').join('\n');
    const brandBody = extractTopLevelRuleBodies(css, '.mn-shell__brand').join('\n');
    const identityBody = extractTopLevelRuleBodies(css, '.mn-identity').join('\n');
    const railLogoutBody = extractTopLevelRuleBodies(css, '.mn-shell__logout').join('\n');
    const drawerHeaderBody = extractTopLevelRuleBodies(css, '.mn-drawer__header').join('\n');
    const drawerLogoutBody = extractTopLevelRuleBodies(css, '.mn-drawer__logout').join('\n');

    // Outer rail and drawer containers bound their children and never let .mn-nav overflow behind logout.
    expect(sidebarBody).toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(sidebarBody).not.toMatch(/overflow-y\s*:\s*auto\s*;/);
    expect(drawerBody).toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(drawerBody).not.toMatch(/overflow-y\s*:\s*auto\s*;/);

    // .mn-nav owns the dedicated scrollport between identity and logout.
    expect(navBody).toMatch(/flex\s*:\s*1\s+1\s+auto\s*;/);
    expect(navBody).toMatch(/min-height\s*:\s*0\s*;/);
    expect(navBody).toMatch(/overflow-y\s*:\s*auto\s*;/);

    // Non-scrollable chrome (brand, identity, logout) and nav rows never compress vertically.
    for (const block of [
      groupBody,
      toggleBody,
      itemBody,
      brandBody,
      identityBody,
      railLogoutBody,
      drawerHeaderBody,
      drawerLogoutBody,
    ]) {
      expect(block).toMatch(/flex-shrink\s*:\s*0\s*;/);
    }

    // Ultra-short height fallback explicitly disables flex-shrink (`flex: 0 0 auto`) so .mn-nav
    // still never shrinks behind logout when whole-rail scrolling engages.
    const clean = stripCssComments(css);
    const shortHeightMatch = clean.match(/@media\s*\(max-height:\s*420px\)\s*\{([\s\S]*?\})\s*\}/);
    expect(shortHeightMatch).not.toBeNull();
    expect(shortHeightMatch![1]).toMatch(/\.mn-nav\s*\{[^}]*flex\s*:\s*0\s+0\s+auto\s*;/);
  });

  test('SUPER_ADMIN keeps Product Catalogue and Limit Catalogue separated from logout and clickable', async () => {
    setRolePrincipal('SUPER_ADMIN', SUPER_ADMIN_SCOPES, 'PRIVILEGED');
    const logoutSpy = jest
      .spyOn(useAuthStore.getState(), 'logout')
      .mockResolvedValue(undefined as never);

    try {
      const view = render(<Layout />);
      await act(async () => {
        await Promise.resolve();
      });

      const sidebar = view.getByTestId('desktop-nav');
      const nav = sidebar.querySelector('nav.mn-nav')!;
      const logoutContainer = sidebar.querySelector('.mn-shell__logout')!;

      expect(nav).not.toBeNull();
      expect(logoutContainer).not.toBeNull();
      expect(nav.contains(logoutContainer)).toBe(false);
      expect(
        Boolean(nav.compareDocumentPosition(logoutContainer) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);

      // Expand section 5 if collapsed and activate both previously obstructed items.
      const commercialToggle = sidebar.querySelector<HTMLButtonElement>(
        '[data-testid="section-commercial"]',
      );
      if (commercialToggle && commercialToggle.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(commercialToggle);
      }

      const productItem = view.getByTestId('nav-productCatalogue');
      const limitItem = view.getByTestId('nav-limitCatalogue');

      fireEvent.click(productItem);
      await waitFor(() => {
        expect(productItem.getAttribute('aria-current')).toBe('page');
        expect(view.getByTestId('main-content').textContent).toMatch(/Commercial Rule Registries/i);
      });

      fireEvent.click(limitItem);
      await waitFor(() => {
        expect(limitItem.getAttribute('aria-current')).toBe('page');
        expect(view.getByTestId('main-content').textContent).toMatch(/Commercial Rule Registries/i);
      });

      expect(logoutSpy).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole('button', { name: 'Log out session' }));
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      logoutSpy.mockRestore();
    }
  });

  test('FINANCE_AUDITOR keeps Limit Assignments separated from logout and clickable in both rail and drawer', async () => {
    setRolePrincipal('FINANCE_AUDITOR', FINANCE_AUDITOR_SCOPES, 'OPERATOR');
    const logoutSpy = jest
      .spyOn(useAuthStore.getState(), 'logout')
      .mockResolvedValue(undefined as never);

    try {
      const view = render(<Layout />);
      await act(async () => {
        await Promise.resolve();
      });

      const sidebar = view.getByTestId('desktop-nav');
      const commercialToggle = sidebar.querySelector<HTMLButtonElement>(
        '[data-testid="section-commercial"]',
      );
      if (commercialToggle && commercialToggle.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(commercialToggle);
      }

      const limitAssignments = view.getByTestId('nav-limitAssignments');
      fireEvent.click(limitAssignments);
      await waitFor(() => {
        expect(limitAssignments.getAttribute('aria-current')).toBe('page');
        expect(view.getByTestId('main-content').textContent).toMatch(/Limit Assignments/i);
      });

      // Verify compact modal drawer keeps nav and logout in separate sibling containers too.
      fireEvent.click(view.getByTestId('mobile-menu-toggle'));
      const drawer = view.getByTestId('mobile-nav');
      const drawerNav = drawer.querySelector('nav.mn-nav--drawer')!;
      const drawerLogout = drawer.querySelector('.mn-drawer__logout')!;
      expect(drawerNav.contains(drawerLogout)).toBe(false);
      expect(
        Boolean(drawerNav.compareDocumentPosition(drawerLogout) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);

      const drawerCommercialToggle = drawer.querySelector<HTMLButtonElement>(
        '[data-testid="section-commercial"]',
      );
      if (
        drawerCommercialToggle &&
        drawerCommercialToggle.getAttribute('aria-expanded') !== 'true'
      ) {
        fireEvent.click(drawerCommercialToggle);
      }

      fireEvent.click(view.getByTestId('mobile-nav-limitAssignments'));
      await waitFor(() => {
        expect(view.queryByTestId('mobile-nav')).toBeNull();
      });

      expect(logoutSpy).not.toHaveBeenCalled();
    } finally {
      logoutSpy.mockRestore();
    }
  });
});
