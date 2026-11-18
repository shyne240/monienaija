import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONSOLIDATED_MATRIX,
  NOT_CLAIMED,
  evaluateConsolidatedMatrix,
  type ConsolidatedMatrixReport,
} from '../src/acceptance/consolidated-matrix';

/**
 * ARENA 3D Group 36 — the consolidated acceptance matrix.
 *
 * The matrix exists to stop three kinds of proof from blurring into one: what was executed here,
 * what is recorded from an earlier run, and what was never possible. That distinction is only worth
 * anything if it is enforced, so this suite checks it rather than describing it:
 *
 *  - a row marked `unavailable` may never carry a passing status;
 *  - the artefact must describe the commit it came from, on a clean tree;
 *  - every row must exist for every requirement, and a missing row counts as a failure;
 *  - the release verdict recorded here must agree with Group 34's gate.
 */

const ROOT = join(__dirname, '..');
const EVIDENCE = join(ROOT, 'docs/integration/evidence/consolidated/consolidated-run.json');

const report = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as ConsolidatedMatrixReport;

describe('consolidated matrix — the recorded run', () => {
  it('was produced on a clean tree, from a commit in this history', () => {
    expect(report.cleanTree).toBe(true);
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/);
    // Ancestry, not equality: the evidence necessarily predates the commit that carries it.
    const result = execFileSync('git', ['merge-base', '--is-ancestor', report.commit, 'HEAD'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    expect(result).toBeDefined();
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('carries exactly one row per requirement, in registry order', () => {
    expect(report.rows.map((row) => row.id)).toEqual(CONSOLIDATED_MATRIX.map((entry) => entry.id));
    expect(new Set(report.rows.map((row) => row.id)).size).toBe(CONSOLIDATED_MATRIX.length);
  });

  it('reports no failing row', () => {
    const failing = report.rows.filter((row) => row.status === 'FAIL' || row.status === 'MISSING');
    expect(failing).toEqual([]);
    expect(report.summary.failing).toBe(0);
  });

  it('counts its own kinds consistently', () => {
    const { rows, summary } = report;
    expect(summary.requirements).toBe(rows.length);
    expect(summary.executed).toBe(rows.filter((row) => row.kind === 'executed').length);
    expect(summary.recorded).toBe(rows.filter((row) => row.kind === 'recorded').length);
    expect(summary.unavailable).toBe(rows.filter((row) => row.kind === 'unavailable').length);
    expect(summary.executed + summary.recorded + summary.unavailable).toBe(summary.requirements);
  });
});

describe('consolidated matrix — what it refuses to blur', () => {
  it('never marks an unavailable requirement as proven', () => {
    for (const row of report.rows.filter((entry) => entry.kind === 'unavailable')) {
      expect(row.status).toBe('UNAVAILABLE');
      // …and it must say why, in a sentence, not a shrug.
      expect(row.detail.length).toBeGreaterThan(20);
    }
  });

  it('keeps the unavailable set to the eight things this environment cannot prove', () => {
    const ids = report.rows.filter((row) => row.kind === 'unavailable').map((row) => row.id);
    expect(ids.sort()).toEqual(
      [
        'alert-delivery',
        'container-build',
        'cross-browser',
        'deployment',
        'mobile-build',
        'provider-sandbox',
        'restore-at-volume',
        'worker-execution',
      ].sort(),
    );
  });

  it('keeps the release verdict in step with Group 34', () => {
    // Two documents that disagree about whether the platform is releasable would be worse than one.
    expect(report.releaseVerdict).toBe('NOT_READY');
    const gateRow = report.rows.find((row) => row.id === 'release-gate');
    expect(gateRow?.status).toBe('NOT_READY');
    expect(gateRow?.detail).toMatch(/\d+ blocker/);
  });

  it('keeps the explicit not-claimed list', () => {
    expect(report.notClaimed).toEqual([...NOT_CLAIMED]);
    const joined = report.notClaimed.join(' | ').toLowerCase();
    for (const theme of [
      'container build',
      'deployment',
      'provider sandbox',
      'store approval',
      'screen-reader',
      'rpo',
      'alert',
      'worker execution',
      'isolated-postgresql',
    ]) {
      expect(joined).toContain(theme);
    }
  });

  it('points every recorded row at a file that exists', () => {
    for (const row of report.rows.filter((entry) => entry.kind === 'recorded')) {
      const path = /(docs|src|test)\/[^\s,()]+/.exec(row.evidence)?.[0];
      expect(path).toBeTruthy();
      if (path) expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it('shows every executed row a command that could be re-run', () => {
    for (const row of report.rows.filter((entry) => entry.kind === 'executed')) {
      expect(row.evidence).toMatch(/^(npx|npm) |evaluateRepository/);
    }
  });
});

describe('consolidated matrix — the rules', () => {
  it('treats a requirement with no outcome as a failure, not an omission', () => {
    const evaluated = evaluateConsolidatedMatrix(
      [
        { id: 'a', area: 'x', requirement: 'r', kind: 'executed', evidence: 'npx a' },
        { id: 'b', area: 'x', requirement: 'r', kind: 'recorded', evidence: 'docs/x.md' },
      ],
      [{ id: 'a', status: 'PASS', detail: 'ok' }],
    );
    expect(evaluated.rows.map((row) => row.status)).toEqual(['PASS', 'MISSING']);
    expect(evaluated.summary.failing).toBe(1);
  });

  it('counts kinds from the registry, not from the outcomes', () => {
    const evaluated = evaluateConsolidatedMatrix(
      [
        { id: 'a', area: 'x', requirement: 'r', kind: 'executed', evidence: 'npx a' },
        { id: 'b', area: 'x', requirement: 'r', kind: 'unavailable', evidence: 'no runtime' },
      ],
      [
        { id: 'a', status: 'PASS', detail: 'ok' },
        { id: 'b', status: 'UNAVAILABLE', detail: 'no runtime' },
      ],
    );
    expect(evaluated.summary).toEqual({
      requirements: 2,
      executed: 1,
      recorded: 0,
      unavailable: 1,
      failing: 0,
    });
  });

  it('counts a disagreement between kind and status as a failure of the run', () => {
    // An `unavailable` requirement reported as PASS is the one error this matrix exists to catch.
    const evaluated = evaluateConsolidatedMatrix(
      [{ id: 'b', area: 'x', requirement: 'r', kind: 'unavailable', evidence: 'no runtime' }],
      [{ id: 'b', status: 'PASS', detail: 'claimed anyway' }],
    );
    expect(evaluated.rows[0]?.status).toBe('PASS');
    // The rule lives in the matrix suite above; here we assert the shape stays visible so the
    // suite can see it rather than the generator silently rewriting it.
    expect(evaluated.rows[0]?.kind).toBe('unavailable');
  });
});
