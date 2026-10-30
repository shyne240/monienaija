import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { Layout } from '../src/screens/authenticated/Layout';
import { CustomerDirectoryScreen } from '../src/screens/authenticated/CustomerDirectoryScreen';
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
}));

const SRC = path.join(__dirname, '..', 'src');

const PILOT_STYLESHEETS = [
  path.join(SRC, 'design-system', 'tokens.css'),
  path.join(SRC, 'design-system', 'primitives.css'),
  path.join(SRC, 'screens', 'authenticated', 'admin-shell.css'),
  path.join(SRC, 'screens', 'authenticated', 'customer-directory-pilot.css'),
];

const EXCLUDED_STYLESHEET = path.join(SRC, 'screens', 'authenticated', 'customer-management.css');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Minimal selector extractor. Comments are stripped first; at-rule preludes and
 * keyframe steps are not selectors, so they are skipped.
 */
function extractSelectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  const blockStart = /([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = blockStart.exec(withoutComments))) {
    const raw = match[1].trim();
    if (!raw) continue;
    if (raw.startsWith('@')) continue;
    if (/^(from|to|[\d.%,\s]+)$/.test(raw)) continue;
    for (const part of raw.split(',')) {
      const selector = part.replace(/\s+/g, ' ').trim();
      if (selector) selectors.push(selector);
    }
  }
  return selectors;
}

const customer = {
  id: 'cust-synthetic-1',
  reference: 'mn-••••5678',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_1',
  kycStatus: 'APPROVED',
  displayName: 'Synthetic Directory Alpha',
  legalName: null,
  createdAt: '2026-09-10T09:00:00.000Z',
  primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
};

function directoryResponse() {
  return {
    data: [customer],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function setPrincipal() {
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
      roles: ['OPERATIONS'],
      scopes: ['customer.view', 'customer.create', 'customer.view_contact_methods'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    error: null,
  });
}

function classesOf(element: Element): string[] {
  return Array.from(element.classList);
}

function collectMnClasses(root: Element): string[] {
  const found = new Set<string>();
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of nodes) {
    for (const name of classesOf(node)) {
      if (name.startsWith('mn-')) found.add(name);
    }
  }
  return Array.from(found);
}

describe('M1 style isolation — pilot CSS selector discipline', () => {
  test.each(PILOT_STYLESHEETS.map((file) => [path.basename(file), file]))(
    '%s is class-scoped to pilot-owned selectors only',
    (_name, file) => {
      const selectors = extractSelectors(read(file as string));
      expect(selectors.length).toBeGreaterThan(0);

      const violations = selectors.filter((selector) => {
        const scoped = /\.mn-/.test(selector);
        const globalRoot = /^:root/.test(selector);
        const htmlSelector = /(^|\s|>)html(\s|$|\.|:|\[)/.test(selector);
        const bodySelector = /(^|\s|>)body(\s|$|\.|:|\[)/.test(selector);
        const universal = selector.trim() === '*';
        const sharedClass = selector.includes('.cm-');
        const excludedScope = selector.includes('.customer-management');
        return !scoped || globalRoot || htmlSelector || bodySelector || universal || sharedClass || excludedScope;
      });
      // Printed as a joined string so a failure names the offending selector.
      expect(violations.join(' | ')).toBe('');
    },
  );

  test('pilot stylesheets do not use !important except for reduced-motion overrides', () => {
    for (const file of PILOT_STYLESHEETS) {
      const css = read(file);
      const importantCount = (css.match(/!important/g) ?? []).length;
      if (path.basename(file) !== 'tokens.css') {
        expect(importantCount).toBe(0);
        continue;
      }
      const reduceStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
      expect(reduceStart).toBeGreaterThan(-1);
      const beforeReduce = css.slice(0, reduceStart);
      expect((beforeReduce.match(/!important/g) ?? []).length).toBe(0);
    }
  });

  test('tokens are declared only on explicit pilot scopes', () => {
    const css = read(path.join(SRC, 'design-system', 'tokens.css'));
    const reduceIndex = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(reduceIndex).toBeGreaterThan(-1);

    const tokenScopeSelectors = extractSelectors(css.slice(0, reduceIndex));
    expect(tokenScopeSelectors.length).toBe(3);
    expect(new Set(tokenScopeSelectors)).toEqual(
      new Set(['.mn-shell', '.mn-dir-header', '.mn-dir-panel']),
    );

    // The reduced-motion block may only narrow motion inside pilot-owned subtrees.
    const motionSelectors = extractSelectors(css.slice(reduceIndex));
    expect(motionSelectors.length).toBeGreaterThan(0);
    expect(motionSelectors.filter((selector) => !selector.includes('.mn-')).length).toBe(0);
  });

  test('the shared customer-management stylesheet is untouched and still serves embedded workflows', () => {
    const css = read(EXCLUDED_STYLESHEET);
    expect(css).toContain('.customer-management');
    expect(css).toContain('.cm-registration-wizard');
    expect(css).toContain('.cm-workspace');
    expect(css).toContain('.cm-customer-table');
    // The pilot must not have appended overrides to the shared file.
    expect(css).not.toContain('.mn-');
  });

  test('the shell content region never clips or hides excluded screens', () => {
    const css = read(path.join(SRC, 'screens', 'authenticated', 'admin-shell.css'));
    const contentRule = css.slice(css.indexOf('.mn-shell__content {'));
    const ruleBody = contentRule.slice(0, contentRule.indexOf('}'));
    expect(ruleBody).not.toContain('overflow: hidden');
    expect(ruleBody).not.toContain('display: none');
    expect(ruleBody).not.toContain('height: 100vh');
  });
});

describe('M1 style isolation — embedded workflows keep their own presentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal();
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/customers?')) return Promise.resolve(directoryResponse());
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({
          templateKey: 'DEFAULT_FALLBACK',
          displayName: 'Synthetic Workforce Dashboard',
          description: '',
          isFallback: true,
          widgets: [],
        });
      }
      return Promise.resolve(customer);
    });
    (ApiClient.post as jest.Mock).mockResolvedValue({});
  });

  test('the directory shell root is not a pilot typography scope and the wizard keeps its cm- contract', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    const main = view.container.querySelector('main')!;
    // The scope root keeps only the pre-existing class: pilot typography and colour
    // are applied on the header and panel, never inherited by embedded workflows.
    expect(main.className).toBe('customer-management');
    expect(classesOf(main).filter((name) => name.startsWith('mn-')).join('')).toBe('');

    fireEvent.click(view.getByRole('button', { name: 'New Customer' }));
    const wizard = view.container.querySelector('.cm-registration-wizard');
    expect(wizard).not.toBeNull();

    // The registration wizard is wrapped for aria-controls only; no pilot class
    // reaches inside the workflow itself.
    expect(view.container.querySelector('#mn-dir-registration')).not.toBeNull();
    expect(collectMnClasses(wizard!)).toEqual([]);
  });

  test('Customer 360° is not painted with pilot classes', async () => {
    const view = render(<CustomerDirectoryScreen />);
    await view.findByText('Synthetic Directory Alpha');

    fireEvent.click(view.getByRole('button', { name: 'Open Customer 360° for Synthetic Directory Alpha' }));
    await waitFor(() => {
      expect(view.container.querySelector('.cm-workspace')).not.toBeNull();
    });

    const workspace = view.container.querySelector('.cm-workspace')!;
    expect(collectMnClasses(workspace)).toEqual([]);
    expect(view.container.querySelector('.mn-dir-panel')).toBeNull();
    expect(view.queryByRole('heading', { name: 'Customer directory' })).toBeNull();
  });

  test('the application shell adds no pilot styling scope around rendered screens', async () => {
    const view = render(<Layout />);
    await waitFor(() => {
      expect(view.getByTestId('main-content')).toBeTruthy();
    });

    const content = view.getByTestId('main-content');
    expect(content.className).toBe('mn-shell__content');
    // Excluded screens are direct children of an unstyled-typography container.
    expect(content.getAttribute('style')).toBeNull();
  });

  test('pilot class names never collide with the shared cm- contract', () => {
    const excluded = read(EXCLUDED_STYLESHEET);
    const excludedClasses = new Set(
      (excluded.match(/\.cm-[a-z0-9-]+/g) ?? []).map((name) => name.slice(1)),
    );
    const pilotClasses = new Set<string>();
    for (const file of PILOT_STYLESHEETS) {
      for (const name of read(file).match(/\.mn-[a-z0-9-]+/g) ?? []) {
        pilotClasses.add(name.slice(1));
      }
    }
    expect(pilotClasses.size).toBeGreaterThan(20);
    for (const name of pilotClasses) {
      expect(excludedClasses.has(name)).toBe(false);
    }
  });
});
