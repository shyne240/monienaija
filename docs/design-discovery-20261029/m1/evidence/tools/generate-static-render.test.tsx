/*
 * M1 static-render evidence generator.
 *
 * NOT part of the Admin Web test suite and not an application test. It is a
 * documentation tool kept in the repo so the evidence in this directory can be
 * reproduced. No browser engine was installable in the M1 sandbox, so instead of
 * pixel screenshots this serialises the *real* rendered DOM (React Testing
 * Library) together with the *real* stylesheets into self-contained HTML files.
 * Media queries are evaluated by the viewer's browser inside fixed-width iframes.
 *
 * To reproduce:
 *   1. copy this file to apps/admin-web/__tests__/zz-evidence-generator.test.tsx
 *   2. MN_EVIDENCE_OUT=<repo>/docs/design-discovery-20261029/m1/evidence \
 *        npx jest __tests__/zz-evidence-generator.test.tsx --runInBand
 *   3. delete the copy from apps/admin-web/__tests__/
 *
 * The baseline ("before") renders in this directory were produced the same way
 * from an unmodified git worktree at commit 5736885.
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';

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

const APP = path.join(__dirname, '..');
const OUT = process.env.MN_EVIDENCE_OUT as string;

const CSS_ORDER = [
  'src/design-system/tokens.css',
  'src/design-system/primitives.css',
  'src/screens/authenticated/admin-shell.css',
  'src/screens/authenticated/customer-management.css',
  'src/screens/authenticated/customer-directory-pilot.css',
];

// The brand mark is copied once into evidence/assets and referenced relatively so
// nine evidence documents do not each carry a ~96 KB base64 copy.
const FAVICON_ASSET = 'assets/favicon.png';

function ensureFaviconAsset() {
  const source = path.join(APP, 'public', 'favicon.png');
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.copyFileSync(source, path.join(OUT, FAVICON_ASSET));
}

function stylesheet(): string {
  return CSS_ORDER.filter((relative) => fs.existsSync(path.join(APP, relative)))
    .map((relative) => fs.readFileSync(path.join(APP, relative), 'utf8'))
    .join('\n\n');
}

function rows() {
  const base = {
    type: 'INDIVIDUAL',
    kycLevel: 'LEVEL_2',
    kycStatus: 'APPROVED',
    createdAt: '2026-09-10T09:00:00.000Z',
    primaryContact: { type: 'PHONE', maskedValue: '+234*****4321', isVerified: true },
  };
  return [
    { ...base, id: 'c1', displayName: 'Amaka Obi', legalName: 'Amaka Chidinma Obi', reference: 'mn-••••4821', status: 'ACTIVE' },
    { ...base, id: 'c2', displayName: 'Tunde Balogun Stores', legalName: 'Tunde Balogun Stores Ltd', reference: 'mn-••••7390', status: 'ACTIVE', type: 'BUSINESS', kycLevel: 'LEVEL_3', primaryContact: { type: 'EMAIL', maskedValue: 't•••@example.test', isVerified: true } },
    { ...base, id: 'c3', displayName: 'Nneka Eze', legalName: null, reference: 'mn-••••1155', status: 'DRAFT', kycLevel: 'NONE', kycStatus: 'NOT_STARTED', primaryContact: null },
    { ...base, id: 'c4', displayName: 'Ibrahim Musa', legalName: null, reference: 'mn-••••6234', status: 'SUSPENDED', kycLevel: 'LEVEL_1', kycStatus: 'PENDING', primaryContact: { type: 'PHONE', maskedValue: '+234*****9090', isVerified: false } },
    { ...base, id: 'c5', displayName: 'Grace Adeyemi', legalName: 'Grace Adeyemi Ventures', reference: 'mn-••••0517', status: 'ACTIVE', type: 'BUSINESS', primaryContact: { type: 'PHONE', maskedValue: '+234*****3311', isVerified: true } },
    { ...base, id: 'c6', displayName: 'Emeka Nwosu', legalName: null, reference: 'mn-••••9402', status: 'CLOSED', kycLevel: 'LEVEL_1', kycStatus: 'REJECTED', primaryContact: null },
  ];
}

function directoryPayload() {
  return { data: rows(), total: 41, page: 1, limit: 20, totalPages: 3, hasNextPage: true, hasPreviousPage: false };
}

function setPrincipal(scopes: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    token: 'synthetic-workforce-token',
    sessionId: 'synthetic-session',
    principal: {
      type: 'PRIVILEGED',
      principalId: 'issuer:workforce.operator.demo',
      sessionId: 'synthetic-session',
      audience: 'workforce-admin',
      roles: ['OPERATIONS_MANAGER'],
      scopes,
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    },
    error: null,
  });
}

const SCOPES = [
  'customer.view',
  'customer.create',
  'customer.view_contact_methods',
  'customer.view_transactions',
  'customer.view_address',
  'ledger.view',
  'reconciliation.view',
  'transaction.view',
  'fee_rule.view',
  'workforce.dashboard.view',
];

function withFavicon(html: string): string {
  return html.replace(/src="\/favicon\.png"/g, `src="${FAVICON_ASSET}"`);
}

function writeDoc(name: string, markup: string) {
  ensureFaviconAsset();
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MonieNaija Admin — M1 static render</title>
<style>
${stylesheet()}
</style>
</head>
<body>
${withFavicon(markup)}
</body>
</html>`;
  fs.writeFileSync(path.join(OUT, `${name}.html`), doc, 'utf8');
}

function writeGallery(
  name: string,
  title: string,
  note: string,
  frames: Array<{ label: string; width: number; doc: string }>,
) {
  const cards = frames
    .map(
      (frame) => `  <figure class="frame">
    <figcaption>${frame.label} — ${frame.width} CSS px</figcaption>
    <iframe title="${frame.label}" src="./${frame.doc}" style="width:${frame.width}px"></iframe>
  </figure>`,
    )
    .join('\n');

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { margin: 0; padding: 24px; background: #eef1ef; font-family: system-ui, -apple-system, sans-serif; color: #132b25; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .note { max-width: 78ch; margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: #52655f; }
  .banner { display: inline-block; margin: 0 0 14px; padding: 4px 10px; border-radius: 999px; background: #fff3d9; color: #8c5600; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .frame { margin: 0 0 28px; }
  figcaption { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #52655f; margin-bottom: 8px; }
  iframe { display: block; height: 900px; border: 1px solid #b9cac3; border-radius: 10px; background: #fff; resize: both; overflow: auto; }
  .fallback { font-size: 12px; color: #52655f; margin: 6px 0 0; }
</style>
</head>
<body>
<h1>${title}</h1>
<span class="banner">Synthetic data · static DOM/CSS render · not a browser screenshot</span>
<p class="note">${note}</p>
${cards}
<p class="fallback">If a frame appears empty, the browser is blocking local iframes — open the referenced HTML file directly.</p>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT, `${name}.html`), page, 'utf8');
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('M1 evidence generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPrincipal(SCOPES);
    (ApiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/internal/customers?')) return Promise.resolve(directoryPayload());
      if (url === '/internal/a2/workforce/dashboard/my-dashboard') {
        return Promise.resolve({
          templateKey: 'DEFAULT_FALLBACK',
          displayName: 'Workforce dashboard',
          description: '',
          isFallback: true,
          widgets: [],
        });
      }
      if (url.startsWith('/internal/customers/')) return Promise.resolve(rows()[0]);
      return Promise.resolve([]);
    });
  });

  test('shell + directory (loaded, drawer closed)', async () => {
    const view = render(<Layout />);
    await settle();
    fireEvent.click(view.getByTestId('nav-customers'));
    await settle();
    await settle();

    const markup = `<div id="root">${view.container.innerHTML}</div>`;
    writeDoc('after-shell-directory-loaded', markup);
    expect(markup).toContain('Customer directory');
  });

  test('shell + directory with the modal drawer open', async () => {
    const view = render(<Layout />);
    await settle();
    fireEvent.click(view.getByTestId('nav-customers'));
    await settle();
    fireEvent.click(view.getByTestId('mobile-menu-toggle'));
    await settle();

    writeDoc('after-shell-drawer-open', `<div id="root">${view.container.innerHTML}</div>`);
    expect(view.getByTestId('mobile-nav')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  test('directory presentation states', async () => {
    const states: Array<{ name: string; setup: () => Promise<string> }> = [
      {
        name: 'loading',
        setup: async () => {
          (ApiClient.get as jest.Mock).mockImplementation(() => new Promise(() => {}));
          const view = render(<CustomerDirectoryScreen />);
          await settle();
          const html = view.container.innerHTML;
          view.unmount();
          return html;
        },
      },
      {
        name: 'empty',
        setup: async () => {
          (ApiClient.get as jest.Mock).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
          const view = render(<CustomerDirectoryScreen />);
          await settle();
          const html = view.container.innerHTML;
          view.unmount();
          return html;
        },
      },
      {
        name: 'error',
        setup: async () => {
          (ApiClient.get as jest.Mock).mockRejectedValue({ status: 500 });
          const view = render(<CustomerDirectoryScreen />);
          await settle();
          const html = view.container.innerHTML;
          view.unmount();
          return html;
        },
      },
      {
        name: 'restricted-contact',
        setup: async () => {
          setPrincipal(['customer.view']);
          (ApiClient.get as jest.Mock).mockResolvedValue(directoryPayload());
          const view = render(<CustomerDirectoryScreen />);
          await settle();
          const html = view.container.innerHTML;
          view.unmount();
          setPrincipal(SCOPES);
          return html;
        },
      },
      {
        name: 'stale-after-failed-refresh',
        setup: async () => {
          (ApiClient.get as jest.Mock).mockResolvedValue(directoryPayload());
          const view = render(<CustomerDirectoryScreen />);
          await settle();
          (ApiClient.get as jest.Mock).mockRejectedValueOnce({ status: 500 });
          fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
          await settle();
          await settle();
          const html = view.container.innerHTML;
          view.unmount();
          return html;
        },
      },
    ];

    const docs: Record<string, string> = {};
    for (const state of states) {
      docs[state.name] = await state.setup();
      writeDoc(`state-${state.name}`, `<div id="root">${docs[state.name]}</div>`);
    }
    expect(Object.keys(docs).length).toBe(5);
  });

  test('build the labelled galleries', () => {
    writeGallery(
      'after-responsive-gallery',
      'M1 — Admin shell and Customer Directory at target widths',
      'Each frame is the same markup and the same stylesheets rendered inside a fixed-width iframe, so CSS media and container queries evaluate at that width. Data is a synthetic fixture. Loading, empty, error, restricted and stale states are in the states gallery.',
      [
        { label: 'Desktop', width: 1440, doc: 'after-shell-directory-loaded.html' },
        { label: 'Desktop (rail breakpoint)', width: 1024, doc: 'after-shell-directory-loaded.html' },
        { label: 'Tablet', width: 768, doc: 'after-shell-directory-loaded.html' },
        { label: 'Mobile', width: 390, doc: 'after-shell-directory-loaded.html' },
        { label: 'Mobile (smallest)', width: 320, doc: 'after-shell-directory-loaded.html' },
      ],
    );

    writeGallery(
      'after-states-gallery',
      'M1 — Directory presentation states',
      'Loading, successful empty, failed load, permission-restricted contact and stale-after-failed-refresh are presented as distinct states. A failed load never reports a zero total.',
      [
        { label: 'Loading', width: 1024, doc: 'state-loading.html' },
        { label: 'Successful empty', width: 1024, doc: 'state-empty.html' },
        { label: 'Failed load', width: 1024, doc: 'state-error.html' },
        { label: 'Restricted contact', width: 1024, doc: 'state-restricted-contact.html' },
        { label: 'Stale after failed refresh', width: 1024, doc: 'state-stale-after-failed-refresh.html' },
        { label: 'Loading (mobile)', width: 390, doc: 'state-loading.html' },
        { label: 'Failed load (mobile)', width: 390, doc: 'state-error.html' },
      ],
    );

    writeGallery(
      'after-drawer-gallery',
      'M1 — Modal navigation drawer',
      'The compact drawer is a labelled modal dialog: focus is contained while open, Escape and the backdrop dismiss it, and focus returns to the toggle. Background scrolling is locked while it is open.',
      [
        { label: 'Drawer open', width: 390, doc: 'after-shell-drawer-open.html' },
        { label: 'Drawer open (tablet)', width: 768, doc: 'after-shell-drawer-open.html' },
      ],
    );
  });
});
