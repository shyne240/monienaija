import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 3D Group 33 — pins the browser acceptance evidence.
 *
 * The run itself needs a Chromium binary, which not every environment has; this suite does not
 * re-run it. What it does is refuse to let the recorded evidence drift into a claim: every check
 * that the harness writes must have passed, the report must still say that the API was stubbed,
 * the disclaimers must still be present, and the client fix the run uncovered must still be in
 * the tree.
 *
 * A suite that only asserted "a JSON file exists" would be decoration. A suite that re-runs the
 * browser would fail wherever no browser can be installed, which is most CI runners. This is the
 * honest middle: the evidence is checked, and the harness is checked to be capable of failing.
 */

const ROOT = join(__dirname, '..');
const EVIDENCE = join(ROOT, 'docs/integration/evidence/browser-acceptance');

interface BrowserCheck {
  id: string;
  ok: boolean;
  detail: string;
}

interface BrowserReport {
  mission: string;
  group: number;
  generatedAt: string;
  browser: { name: string; version: string; engine: string; headless: boolean };
  viewport: { width: number; height: number };
  api: { origin: string; reason: string; calls: number };
  bundle: { path: string; assets: number };
  checks: BrowserCheck[];
  summary: { total: number; passed: number; failed: number };
  notPerformed: string[];
}

const report = JSON.parse(
  readFileSync(join(EVIDENCE, 'browser-acceptance.json'), 'utf8'),
) as BrowserReport;

const checkIds = new Set(report.checks.map((entry) => entry.id));

describe('ARENA 3D Group 33 — browser acceptance evidence', () => {
  it('is the admin console run, in a real browser engine', () => {
    expect(report.mission).toBe('ARENA 3D');
    expect(report.group).toBe(33);
    expect(report.browser.engine).toBe('Blink');
    expect(report.browser.name).toBe('chromium');
    // A version string, not a placeholder: the report has to say which engine rendered the DOM.
    expect(report.browser.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(report.viewport).toEqual({ width: 1440, height: 900 });
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('records no failing check', () => {
    const failed = report.checks.filter((entry) => !entry.ok);
    expect(failed).toEqual([]);
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.summary.passed).toBe(report.checks.length);
    expect(report.summary.failed).toBe(0);
    // Duplicate ids would let one check overwrite another's meaning.
    expect(checkIds.size).toBe(report.checks.length);
  });

  it('still says the API was stubbed rather than served', () => {
    expect(report.api.origin).toMatch(/stubbed/i);
    expect(report.api.reason).toMatch(/financial dependencies/i);
    expect(report.api.calls).toBeGreaterThan(0);
  });

  it('covers the login lifecycle, session handling and authorization boundary', () => {
    for (const required of [
      'BOOT-RENDERS-LOGIN',
      'BOOT-NO-PROTECTED-CHROME',
      'LOGIN-FAILURE-SHOWS-ALERT',
      'LOGIN-FAILURE-SETS-NO-TOKEN',
      'LOGIN-RETRY-PRESERVES-EMAIL',
      'LOGIN-FORM-STAYS-MOUNTED-IN-FLIGHT',
      'LOGIN-IS-ONE-POST',
      'AUTHENTICATED-NAV-RENDERS',
      'SESSION-PERSISTED-IN-LOCALSTORAGE',
      'SESSION-RESTORED-AFTER-RELOAD',
      'EXPIRED-SESSION-RETURNS-TO-LOGIN',
      'ROLE-DIFFERENTIAL-NAV',
    ]) {
      expect(checkIds.has(required)).toBe(true);
    }
  });

  it('covers accessibility surfaces a browser can actually adjudicate', () => {
    for (const required of [
      'A11Y-FORM-LABELS',
      'A11Y-DOCUMENT-LANG',
      'A11Y-SKIP-LINK-FIRST-IN-AUTHENTICATED-SHELL',
      'KEYBOARD-FIRST-TAB-LANDS-IN-DOCUMENT',
      'PASSWORD-MASKED-BY-DEFAULT',
    ]) {
      expect(checkIds.has(required)).toBe(true);
    }
  });

  it('covers the shipped bundle and the network it is allowed to reach', () => {
    for (const required of [
      'BUNDLE-HAS-NO-LOOPBACK-HOST',
      'NETWORK-SAME-ORIGIN-ONLY',
      'CONSOLE-NO-UNEXPECTED-ERRORS',
      'RENDER-PRODUCED-AUTHENTICATED-LAYOUT',
      'PASSWORD-NEVER-PERSISTED',
    ]) {
      expect(checkIds.has(required)).toBe(true);
    }
  });

  it('keeps every disclaimer that stops the evidence overclaiming', () => {
    const joined = report.notPerformed.join(' | ').toLowerCase();
    expect(joined).toMatch(/no server assertion/);
    expect(joined).toMatch(/no cross-browser/);
    expect(joined).toMatch(/not a handset/);
    expect(joined).toMatch(/no assistive technology/);
    expect(joined).toMatch(/no visual regression baseline/);
    expect(joined).toMatch(/no load, concurrency or performance/);
  });

  it('claims nothing about the server, the database or a device', () => {
    for (const entry of report.checks) {
      expect(entry.id).not.toMatch(/\b(SERVER|DATABASE|DB|MOBILE|DEVICE|STORE)\b/);
    }
    const serialized = JSON.stringify(report.checks).toLowerCase();
    expect(serialized).not.toContain('provider accepted');
    expect(serialized).not.toContain('deployed');
  });

  it('keeps the screenshots it refers to', () => {
    for (const name of [
      'admin-login-1440x900.png',
      'admin-authenticated-1440x900.png',
      'admin-minimal-role-1440x900.png',
    ]) {
      const path = join(EVIDENCE, name);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(10_000);
    }
  });

  it('keeps the harness able to fail', () => {
    const harness = readFileSync(join(ROOT, 'scripts/admin-web-browser-acceptance.cjs'), 'utf8');
    // The API is intercepted rather than served; if that ever changes, the disclaimers above
    // become false and this suite must be revisited deliberately.
    expect(harness).toContain("context.route('**/api/v1/**'");
    // Every check is recorded through one function, and the process exits non-zero on a failure.
    expect(harness).toContain('process.exit(failed.length === 0 ? 0 : 1)');
    // The browser path is an argument, not a hardcoded absolute path.
    expect(harness).toContain('--executable');
  });

  it('keeps the client fix the run uncovered', () => {
    // The browser run found that a rejected sign-in discarded the typed email, because the whole
    // screen was gated on `isLoading` — which is true for the duration of every attempt. The
    // fix gates the initialising screen on the first paint only. `apps/admin-web`'s own suite
    // covers the behaviour in jsdom; this pins the source so a future refactor cannot quietly
    // reintroduce the unmount.
    const app = readFileSync(join(ROOT, 'apps/admin-web/src/App.tsx'), 'utf8');
    expect(app).toContain('if (isLoading && !booted) {');
    expect(app).not.toMatch(/\n\s*if \(isLoading\) \{/);
  });
});
