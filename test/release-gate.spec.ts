import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OUTSTANDING_REQUIREMENTS,
  evaluateBrowserEvidence,
  evaluateReleaseGate,
  evaluateRepositoryReleaseGate,
  type ReleaseGateInput,
} from '../src/readiness/release-gate.service';
import { FINANCIAL_DEPENDENCY_BLOCKERS } from '../src/production/production-readiness.service';

/**
 * ARENA 3D Group 34 — the release gate.
 *
 * The gate's whole value is that it is capable of saying both things. A gate that always says
 * `NOT_READY` is a wall, not a gate: nobody can tell a genuine blocker from a permanent one, and
 * the first release board to be annoyed by it will route around it. So the suite proves the gate
 * answers `READY` on a clean input, and proves the repository's real input is `NOT_READY` for
 * specific, named reasons.
 */

const ROOT = join(__dirname, '..');

function cleanInput(overrides: Partial<ReleaseGateInput> = {}): ReleaseGateInput {
  return {
    financialDependencyBlockers: [],
    outstanding: [],
    ci: { gate: 'ci-deployment', verdict: 'PASS', detail: 'all jobs present' },
    mobile: { gate: 'mobile-release', verdict: 'PASS', detail: 'manifests registerable' },
    browser: { gate: 'browser-acceptance', verdict: 'PASS', detail: '27 checks passed' },
    mobileConditions: [],
    ...overrides,
  };
}

describe('release gate — the rules', () => {
  it('answers READY when nothing blocks', () => {
    const report = evaluateReleaseGate(cleanInput());
    expect(report.verdict).toBe('READY');
    expect(report.blockers).toEqual([]);
    expect(report.gates.map((gate) => gate.verdict)).toEqual(['PASS', 'PASS', 'PASS']);
  });

  it('answers NOT_READY for a single unverified financial dependency, and names it', () => {
    const report = evaluateReleaseGate(
      cleanInput({ financialDependencyBlockers: ['effective_kyc_policy_unverified'] }),
    );
    expect(report.verdict).toBe('NOT_READY');
    expect(report.blockers.map((blocker) => blocker.id)).toEqual([
      'effective_kyc_policy_unverified',
    ]);
    expect(report.blockers[0]?.category).toBe('financial-dependency');
    expect(report.blockers[0]?.evidence).toMatch(/SANDBOX-INTEGRATION-READINESS/);
  });

  it('keeps a failing input gate as a blocker and a warning as a condition', () => {
    const failing = evaluateReleaseGate(
      cleanInput({
        ci: { gate: 'ci-deployment', verdict: 'ERROR', detail: 'job missing: backend' },
      }),
    );
    expect(failing.verdict).toBe('NOT_READY');
    expect(failing.blockers.map((blocker) => blocker.id)).toEqual(['ci_gate_incomplete']);
    // A broken gate must not be demoted to a note.
    expect(failing.conditions.map((condition) => condition.id)).not.toContain('ci_gate_incomplete');

    const warning = evaluateReleaseGate(
      cleanInput({
        browser: { gate: 'browser-acceptance', verdict: 'WARNING', detail: 'one engine' },
      }),
    );
    expect(warning.verdict).toBe('READY');
    expect(warning.conditions.map((condition) => condition.id)).toContain(
      'browser_acceptance_partial',
    );
    // …and it is still recorded: "ready" must not mean "silent".
    expect(warning.conditions).toHaveLength(1);
  });

  it('treats an ERROR from any input gate as a blocker', () => {
    for (const key of ['ci', 'mobile', 'browser'] as const) {
      const report = evaluateReleaseGate(
        cleanInput({ [key]: { gate: key, verdict: 'ERROR', detail: `${key} broke` } }),
      );
      expect(report.verdict).toBe('NOT_READY');
      expect(report.blockers.length).toBe(1);
    }
  });

  it('cannot be talked into READY by a friendly detail string', () => {
    // The verdict is derived from the verdict field, never from prose that says "all good".
    const report = evaluateReleaseGate(
      cleanInput({
        ci: { gate: 'ci-deployment', verdict: 'ERROR', detail: 'everything is fine, honestly' },
      }),
    );
    expect(report.verdict).toBe('NOT_READY');
  });

  it('reports what it does not do', () => {
    const report = evaluateReleaseGate(cleanInput());
    const joined = report.notPerformed.join(' | ');
    expect(joined).toMatch(/no deployment/);
    expect(joined).toMatch(/no environment override/);
    expect(joined).toMatch(/does not re-run the evidence/);
  });
});

describe('release gate — the repository', () => {
  const report = evaluateRepositoryReleaseGate(ROOT);

  it('refuses to release this repository, and cannot say anything else', () => {
    expect(report.verdict).toBe('NOT_READY');
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('carries every unverified financial dependency straight from the startup gate', () => {
    const financial = report.blockers
      .filter((blocker) => blocker.category === 'financial-dependency')
      .map((blocker) => blocker.id);
    // Same list, not a copy: exporting it from the service is what keeps the two in step.
    expect(financial).toEqual([...FINANCIAL_DEPENDENCY_BLOCKERS]);
    expect(financial).toHaveLength(8);
  });

  it('names the standing obligations that no artefact here can discharge', () => {
    const ids = report.blockers.map((blocker) => blocker.id);
    expect(ids).toEqual(expect.arrayContaining(OUTSTANDING_REQUIREMENTS.map((entry) => entry.id)));
    // The three the mission explicitly refuses to consider settled.
    // Narrowed in Group 37: the mechanism now exists and is tested, so the blocker names what is
    // still true — no deployment has been observed executing it.
    expect(ids).toContain('worker_execution_not_observed_in_deployment');
    expect(ids).not.toContain('worker_automated_execution_unproven');
    expect(ids).toContain('alert_delivery_unproven');
    expect(ids).toContain('disaster_recovery_not_measured');
  });

  it('still reports its own input gates as healthy', () => {
    /*
     * The point of the distinction: our CI gates, mobile manifests and browser run are fine, and
     * the repository is still not releasable. A gate that conflated the two would either block on
     * things that are done, or release on things that are not.
     */
    expect(report.gates.map((gate) => gate.verdict)).toEqual(['PASS', 'WARNING', 'PASS']);
  });

  it('surfaces the mobile warnings as conditions rather than hiding them', () => {
    const ids = report.conditions.map((condition) => condition.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'mobile_agent-mobile_cross-app-version-collision',
        'mobile_customer-mobile_runtime-version',
      ]),
    );
    expect(report.conditions.length).toBeGreaterThanOrEqual(4);
  });

  it('gives every blocker a category, a sentence and a document', () => {
    for (const blocker of report.blockers) {
      expect(blocker.id).toMatch(/^[a-z0-9_]+$/);
      expect(blocker.category).toBeTruthy();
      expect(blocker.summary.length).toBeGreaterThan(20);
      expect(blocker.evidence).toMatch(/\.md|§/);
    }
    // Ids must be unique: a duplicate would let one obligation be discharged twice.
    const ids = report.blockers.map((blocker) => blocker.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('release gate — browser evidence handling', () => {
  function withEvidence(body: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'release-gate-'));
    mkdirSync(join(root, 'docs/integration/evidence/browser-acceptance'), { recursive: true });
    writeFileSync(
      join(root, 'docs/integration/evidence/browser-acceptance/browser-acceptance.json'),
      // A string is written verbatim so the "unparseable" case is genuinely unparseable.
      typeof body === 'string' ? body : JSON.stringify(body),
    );
    return root;
  }

  it('treats a missing report as an error, not as a pass', () => {
    const empty = mkdtempSync(join(tmpdir(), 'release-gate-empty-'));
    const result = evaluateBrowserEvidence(empty);
    expect(result.verdict).toBe('ERROR');
    expect(result.detail).toMatch(/no recorded browser run/);
    rmSync(empty, { recursive: true, force: true });
  });

  it('treats an unparseable report as an error', () => {
    const root = withEvidence('not json at all');
    const result = evaluateBrowserEvidence(root);
    expect(result.verdict).toBe('ERROR');
    expect(result.detail).toMatch(/could not be parsed/);
    rmSync(root, { recursive: true, force: true });
  });

  it('treats an empty check list as an error', () => {
    const root = withEvidence({ checks: [], api: { origin: 'stubbed' } });
    expect(evaluateBrowserEvidence(root).verdict).toBe('ERROR');
    rmSync(root, { recursive: true, force: true });
  });

  it('fails when any recorded check failed', () => {
    const root = withEvidence({
      checks: [
        { id: 'A', ok: true },
        { id: 'B', ok: false },
      ],
      api: { origin: 'stubbed at the browser network layer' },
    });
    const result = evaluateBrowserEvidence(root);
    expect(result.verdict).toBe('ERROR');
    expect(result.detail).toMatch(/1 of 2 browser checks failed/);
    rmSync(root, { recursive: true, force: true });
  });

  it('records whether the API was stubbed', () => {
    const stubbed = withEvidence({ checks: [{ id: 'A', ok: true }], api: { origin: 'stubbed' } });
    expect(evaluateBrowserEvidence(stubbed).detail).toMatch(/the API was stubbed/);
    rmSync(stubbed, { recursive: true, force: true });

    const unstated = withEvidence({ checks: [{ id: 'A', ok: true }] });
    expect(evaluateBrowserEvidence(unstated).detail).toMatch(
      /does not say whether the API was stubbed/,
    );
    rmSync(unstated, { recursive: true, force: true });
  });
});

describe('release gate — no way around it', () => {
  it('reads no environment variable', () => {
    // A flag that waives a blocker would eventually be set. There is none, and this asserts it.
    const source = readFileSync(join(ROOT, 'src/readiness/release-gate.service.ts'), 'utf8');
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/skipReadiness|allowUnverified|forceReady|bypass/i);
  });

  it('does not import a deployer, a provider client or a financial service', () => {
    const source = readFileSync(join(ROOT, 'src/readiness/release-gate.service.ts'), 'utf8');
    expect(source).not.toMatch(/from '\.\.\/banking/);
    expect(source).not.toMatch(/from '\.\.\/ledger/);
    expect(source).not.toMatch(/monnify|dojah|paystack/i);
  });
});
