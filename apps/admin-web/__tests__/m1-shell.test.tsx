import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { Layout } from '../src/screens/authenticated/Layout';
import { ApiClient } from '../src/services/api-client';
import { useAuthStore } from '../src/store/auth-store';
import { canAccessAdminView, canonicalAdminView, type AdminView } from '../src/screens/authenticated/navigation-access';

jest.mock('../src/services/api-client', () => ({
  ApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const DASHBOARD = {
  templateKey: 'DEFAULT_FALLBACK',
  displayName: 'Synthetic Workforce Dashboard',
  description: '',
  isFallback: true,
  widgets: [],
};

function setPrincipal(scopes: string[], roles: string[] = ['OPERATIONS']) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'OPERATOR',
      principalId: 'issuer:synthetic-operator',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles,
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    error: null,
  });
}

const FULL_SCOPES = [
  'customer.view',
  'customer.create',
  'workforce.dashboard.view',
  'ledger.view',
  'reconciliation.view',
  'transaction.view',
  'fee_rule.view',
];

describe('M1 shell — structure, landmarks and accessible naming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(DASHBOARD);
      if (path.startsWith('/internal/customers?')) {
        return Promise.resolve({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        });
      }
      return Promise.resolve([]);
    });
    setPrincipal(FULL_SCOPES);
  });

  test('exposes one named navigation landmark per surface plus a skip link to the workspace', async () => {
    const view = render(<Layout />);
    await act(async () => {
      await Promise.resolve();
    });

    const skip = view.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#mn-main-workspace');
    const target = view.container.querySelector('#mn-main-workspace');
    expect(target).not.toBeNull();
    // The shell must not add a second `main` landmark around the rendered screen.
    expect(view.container.querySelector('main')).toBeNull();

    expect(view.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
    expect(view.getByTestId('desktop-nav')).toBeTruthy();
    expect(view.getByTestId('mobile-menu-toggle')).toBeTruthy();
  });

  test('drawer toggle exposes aria-expanded/aria-controls and opens a labeled modal dialog', async () => {
    const view = render(<Layout />);
    const toggle = view.getByTestId('mobile-menu-toggle');

    expect(toggle.getAttribute('aria-label')).toBe('Navigation menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBe('mn-navigation-drawer');
    expect(view.queryByTestId('mobile-nav')).toBeNull();

    fireEvent.click(toggle);

    expect(view.getByTestId('mobile-menu-toggle').getAttribute('aria-expanded')).toBe('true');
    const drawer = view.getByTestId('mobile-nav');
    expect(drawer.getAttribute('id')).toBe(controls);
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.getAttribute('aria-label')).toBe('Navigation');
    expect(view.getByRole('navigation', { name: 'Mobile navigation' })).toBeTruthy();
  });

  test('keeps section disclosure state programmatically exposed', async () => {
    const view = render(<Layout />);
    const section = view.getByTestId('section-servicing');
    const panelId = section.getAttribute('aria-controls');

    expect(section.getAttribute('aria-expanded')).toBe('true');
    expect(panelId).toBeTruthy();
    expect(view.container.querySelector(`#${panelId}`)?.hasAttribute('hidden')).toBe(false);

    fireEvent.click(section);

    expect(view.getByTestId('section-servicing').getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector(`#${panelId}`)?.hasAttribute('hidden')).toBe(true);
    // Collapsing is visual: the permitted destinations stay discoverable in the DOM.
    expect(view.queryByTestId('nav-customers')).not.toBeNull();
  });

  test('marks exactly one current destination', async () => {
    const view = render(<Layout />);
    await act(async () => {
      await Promise.resolve();
    });

    const current = view.container.querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('data-testid')).toBe('nav-dashboard');

    fireEvent.click(view.getByTestId('nav-ledgerExplorer'));
    await act(async () => {
      await Promise.resolve();
    });

    const next = view.container.querySelectorAll('[aria-current="page"]');
    expect(next.length).toBe(1);
    expect(next[0].getAttribute('data-testid')).toBe('nav-ledgerExplorer');
  });
});

describe('M1 shell — modal drawer keyboard and focus management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ApiClient.get as jest.Mock).mockImplementation((path: string) => {
      if (path === '/internal/a2/workforce/dashboard/my-dashboard') return Promise.resolve(DASHBOARD);
      if (path.startsWith('/internal/customers?')) {
        return Promise.resolve({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        });
      }
      return Promise.resolve([]);
    });
    setPrincipal(FULL_SCOPES);
  });

  test('opening moves focus inside, prevents background scroll and closing restores focus to the toggle', async () => {
    const view = render(<Layout />);
    const toggle = view.getByTestId('mobile-menu-toggle');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(view.getByTestId('mobile-menu-close'));

    fireEvent.click(view.getByTestId('mobile-menu-close'));

    expect(view.queryByTestId('mobile-nav')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(toggle);
  });

  test('Escape closes the drawer and returns focus to the toggle', async () => {
    const view = render(<Layout />);
    const toggle = view.getByTestId('mobile-menu-toggle');
    fireEvent.click(toggle);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(view.queryByTestId('mobile-nav')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test('the backdrop closes the drawer and restores focus', async () => {
    const view = render(<Layout />);
    const toggle = view.getByTestId('mobile-menu-toggle');
    fireEvent.click(toggle);

    fireEvent.click(view.getByTestId('mobile-nav-backdrop'));

    expect(view.queryByTestId('mobile-nav')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test('Tab and Shift+Tab are contained inside the modal drawer', async () => {
    const view = render(<Layout />);
    fireEvent.click(view.getByTestId('mobile-menu-toggle'));

    const drawer = view.getByTestId('mobile-nav');
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(2);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Focus that escapes the drawer is pulled back in rather than left behind it.
    view.getByTestId('mobile-menu-toggle').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  test('a successful destination selection closes the drawer and focuses the destination heading', async () => {
    const view = render(<Layout />);
    fireEvent.click(view.getByTestId('mobile-menu-toggle'));
    fireEvent.click(view.getByTestId('mobile-nav-customers'));

    await waitFor(() => {
      expect(view.getByRole('heading', { name: 'Customer directory' })).toBeTruthy();
    });

    expect(view.queryByTestId('mobile-nav')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement?.textContent).toBe('Customer directory');
  });
});

describe('M1 shell — authorization, alias and context parity', () => {
  test('every legacy alias canonicalises and passes the same guard it did before', () => {
    const aliases: Array<[AdminView, AdminView]> = [
      ['ledger', 'ledgerExplorer'],
      ['transactions', 'transfers'],
      ['commercial', 'feeRules'],
      ['compliance', 'kycQueue'],
      ['riskfraud', 'fraudCases'],
      ['roles', 'roleGovernance'],
      ['approvals', 'approvalsInbox'],
      ['workforce', 'workforceAccess'],
      ['system', 'systemHealth'],
    ];

    for (const [alias, canonical] of aliases) {
      expect(canonicalAdminView(alias)).toBe(canonical);
    }
  });

  test('customer-context history access is contextual, never a substitute for transaction.view', () => {
    expect(
      canAccessAdminView('transactions', ['customer.view_transactions'], ['CUSTOMER_SERVICE'], {
        customerId: 'customer-1',
      }),
    ).toBe(true);
    expect(
      canAccessAdminView('transactions', ['customer.view_transactions'], ['CUSTOMER_SERVICE']),
    ).toBe(false);
    expect(
      canAccessAdminView('transfers', ['transaction.view'], ['CUSTOMER_SERVICE'], {
        customerId: 'customer-1',
      }),
    ).toBe(false);
    expect(canAccessAdminView('transfers', ['transaction.view'], ['CUSTOMER_SERVICE'])).toBe(true);
  });

  test('approval and role governance remain role-and-scope gated, not role-only', () => {
    expect(canAccessAdminView('approvalsInbox', ['privileged:approve'], ['FINANCE_AUDITOR'])).toBe(false);
    expect(
      canAccessAdminView('approvalsInbox', ['privileged:approve'], ['FINANCE_CONTROLLER']),
    ).toBe(true);
    expect(canAccessAdminView('roleGovernance', ['workforce.role.assign'], ['ADMINISTRATOR'])).toBe(false);
    expect(canAccessAdminView('roleGovernance', ['workforce.role.assign'], ['SUPER_ADMIN'])).toBe(true);
  });

  test('navigation rendering matches the guard for mixed scopes and hidden destinations', async () => {
    setPrincipal(['customer.view', 'ledger.view'], ['FINANCE_AUDITOR']);

    const view = render(<Layout />);
    await act(async () => {
      await Promise.resolve();
    });

    const rendered = Array.from(view.getByTestId('desktop-nav').querySelectorAll<HTMLElement>('[data-testid^="nav-"]'))
      .map((node) => node.getAttribute('data-testid')!.replace('nav-', ''));

    for (const key of rendered) {
      expect(canAccessAdminView(key as AdminView, ['customer.view', 'ledger.view'], ['FINANCE_AUDITOR'])).toBe(true);
    }
    expect(rendered).toContain('customers');
    expect(rendered).toContain('ledgerExplorer');
    expect(rendered).not.toContain('approvalsInbox');
    expect(rendered).not.toContain('roleGovernance');
    expect(rendered).not.toContain('transfers');
  });

  test('logout still calls the store action from both surfaces', async () => {
    setPrincipal(FULL_SCOPES);
    const logout = jest.spyOn(useAuthStore.getState(), 'logout').mockResolvedValue(undefined as never);

    try {
      const view = render(<Layout />);
      fireEvent.click(view.getByRole('button', { name: 'Log out session' }));
      expect(logout).toHaveBeenCalledTimes(1);

      fireEvent.click(view.getByTestId('mobile-menu-toggle'));
      fireEvent.click(view.getByRole('button', { name: 'Log out' }));
      expect(logout).toHaveBeenCalledTimes(2);
    } finally {
      logout.mockRestore();
    }
  });
});
