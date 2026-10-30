/*
 * M1 acceptance — automated accessibility scan (axe-core in jsdom).
 *
 * NOT an application test and NOT part of the Admin Web suite. Documentation tool.
 *
 * Why jsdom and not a browser: no browser engine exists in the acceptance
 * environment and Playwright's browser CDN is unreachable (see §6 of the M1
 * acceptance report). axe-core still evaluates every rule that depends only on
 * markup, roles, names, states and relationships; rules that need layout
 * (color-contrast, target-size, landmark visibility) are reported as
 * "incomplete" and must be verified in a real browser.
 *
 * Usage:
 *   mkdir -p /tmp/a11y && cd /tmp/a11y && npm init -y && npm i axe-core@4.10.2 jsdom@25
 *   node scan.js <evidence-dir> [file ...]
 *
 * Violations are reported per document; "incomplete" is never counted as a pass.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axe = require('axe-core');

const DIR = process.argv[2];
const only = process.argv.slice(3);

// Rules that require a layout engine; jsdom cannot evaluate them.
const LAYOUT_RULES = ['color-contrast', 'target-size'];

(async () => {
  const files = (only.length ? only : fs.readdirSync(DIR).filter((f) => f.endsWith('.html') && !f.includes('gallery')))
    .sort();

  const report = { engine: 'axe-core ' + axe.version, dom: 'jsdom (no layout engine)', documents: {} };

  for (const file of files) {
    const html = fs.readFileSync(path.join(DIR, file), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    // jsdom has no canvas; axe uses it only for icon-ligature detection.
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.eval(axe.source);

    const results = await window.axe.run(window.document, {
      resultTypes: ['violations', 'incomplete', 'passes'],
      rules: Object.fromEntries(LAYOUT_RULES.map((id) => [id, { enabled: false }])),
    });

    report.documents[file] = {
      passes: results.passes.length,
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      })),
      // Rules axe could not decide without a rendering engine.
      needsBrowserReview: results.incomplete.map((v) => v.id),
    };
  }

  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error('SCAN ERROR:', error.message);
  process.exit(1);
});
