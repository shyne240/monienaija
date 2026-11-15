#!/usr/bin/env node
/**
 * Customer web render smoke (Arena 3B Stage 9, environment fallback).
 *
 * The mission asks for persisted visual acceptance at 390 x 844. This sandbox has no browser
 * binary (Playwright's Chromium download host is unreachable), so `scripts/customer-visual-acceptance.js`
 * cannot run here. This script captures the strongest evidence that *is* obtainable: it loads the
 * real Expo **web export** of the customer app into a DOM, lets the application mount and navigate,
 * and records the normalised, rendered text of each screen plus every console/page error.
 *
 * It is DOM-level render evidence, NOT pixel acceptance and NOT physical-device acceptance. The
 * manifest it writes says so, and the viewport never influences the output.
 *
 * Usage:
 *   node scripts/customer-web-render-smoke.js [--out docs/integration/arena3b-visual-evidence]
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps/customer-mobile');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function exportWeb(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', outDir], {
    cwd: APP,
    stdio: 'pipe',
    env: { ...process.env, CI: '1' },
  });
  const bundleDir = path.join(outDir, '_expo/static/js/web');
  const [bundle] = fs.readdirSync(bundleDir).filter((file) => file.endsWith('.js'));
  if (!bundle) throw new Error(`no web bundle was produced in ${bundleDir}`);
  return {
    indexHtml: fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'),
    bundlePath: path.join(bundleDir, bundle),
    bundleName: bundle,
    bundleBytes: fs.statSync(path.join(bundleDir, bundle)).size,
  };
}

function reuseExport(outDir) {
  const bundleDir = path.join(outDir, '_expo/static/js/web');
  const [bundle] = fs.readdirSync(bundleDir).filter((file) => file.endsWith('.js'));
  return {
    indexHtml: fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'),
    bundlePath: path.join(bundleDir, bundle),
    bundleName: bundle,
    bundleBytes: fs.statSync(path.join(bundleDir, bundle)).size,
  };
}

async function main() {
  const outDir = path.resolve(arg('out', 'docs/integration/arena3b-visual-evidence'));
  const exportDir = path.join(ROOT, 'dist/customer-web');
  const reuse = process.argv.includes('--reuse-export');
  const build = reuse ? reuseExport(exportDir) : exportWeb(exportDir);

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(build.indexHtml, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.error || event.message)));
  window.eval(fs.readFileSync(build.bundlePath, 'utf8'));

  const normalised = () =>
    (window.document.body.textContent || '').replace(/\s+/g, ' ').trim();
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (needle) => {
    const nodes = [
      ...window.document.querySelectorAll('div[role="button"],button,a[role="button"],[tabindex]'),
    ];
    // Prefer the deepest (shortest-text) node: React Native Web nests every pressable inside
    // container divs whose textContent also contains the label.
    const target = nodes
      .filter((node) => (node.textContent || '').trim().includes(needle))
      .sort((left, right) => (left.textContent || '').length - (right.textContent || '').length)[0];
    if (!target) return false;
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  };

  await settle(2500);
  const screens = [];
  const capture = async (id, label, marker) => {
    const text = normalised();
    screens.push({
      id,
      label,
      reachedMarker: marker ? text.includes(marker) : true,
      textLength: text.length,
      text,
    });
  };

  await capture('entry', 'Entry screen (unauthenticated)', 'Welcome to MonieNaija');

  const openedLogin = click('Log In to Account');
  await settle(1200);
  // The captured text is whatever the app itself renders after the press; the label says exactly
  // that, so the evidence never claims more than it observed.
  await capture('after-login-press', 'Screen after pressing "Log In to Account"', null);

  // Back to the entry screen, then into registration: both front doors must mount.
  const back = [...window.document.querySelectorAll('div[role="button"],button,[tabindex]')].find(
    (node) => /back|‹|←/i.test(node.getAttribute('aria-label') || ''),
  );
  if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(600);
  const openedRegistration = click('Create New Wallet');
  await settle(1200);
  await capture('after-registration-press', 'Screen after pressing "Create New Wallet"', null);

  fs.mkdirSync(outDir, { recursive: true });
  for (const screen of screens) {
    fs.writeFileSync(path.join(outDir, `${screen.id}.render.txt`), `${screen.text}\n`, 'utf8');
  }
  const manifest = {
    capturedAt: new Date().toISOString(),
    kind: 'dom-render-smoke',
    honesty:
      'DOM-level render evidence from the Expo web export. No pixel screenshot and no ' +
      'physical-device acceptance was performed in this environment.',
    bundle: { name: build.bundleName, bytes: build.bundleBytes },
    interactions: { openedLogin, openedRegistration, foundBackButton: Boolean(back) },
    screens,
    errors,
  };
  fs.writeFileSync(
    path.join(outDir, 'render-smoke.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const blank = screens.filter((screen) => screen.textLength < 40);
  process.stdout.write(
    `Rendered ${screens.length} screens from ${build.bundleName} (${build.bundleBytes} bytes); ` +
      `blank=${blank.length}; errors=${errors.length}\n`,
  );
  if (blank.length > 0 || errors.length > 0 || !openedLogin || !openedRegistration) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
