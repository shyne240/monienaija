import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLATFORM_JOURNEYS,
  evaluateJourneyResults,
  summariseJourneys,
  type JourneyAcceptanceReport,
  type JourneyId,
  type RawSuiteOutcome,
} from '../src/acceptance/platform-journeys';

/**
 * ARENA 3D Group 35 — the platform journeys.
 *
 * Two things are pinned here, and they fail in different ways:
 *
 * 1. **The map.** Every journey A–J exists once, has steps and guardrails, and names suites that are
 *    actually on disk. A renamed suite file is a journey that silently stops proving anything.
 * 2. **The run.** The recorded evidence must show every journey passing, with a test count, against
 *    a disposable cluster, and the report's own disclaimers must still be present.
 *
 * The suite does not re-run the journeys: they need a PostgreSQL cluster and take about six minutes.
 * `npm run acceptance:journeys` regenerates the evidence; this suite refuses to let it drift.
 */

const ROOT = join(__dirname, '..');
const EVIDENCE = join(ROOT, 'docs/integration/evidence/journeys/journey-results.json');

const report = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as JourneyAcceptanceReport;

const EXPECTED_IDS: JourneyId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

describe('platform journeys — the registry', () => {
  it('defines exactly the ten journeys, A to J, in order', () => {
    expect(PLATFORM_JOURNEYS.map((journey) => journey.id)).toEqual(EXPECTED_IDS);
    expect(new Set(PLATFORM_JOURNEYS.map((journey) => journey.title)).size).toBe(10);
  });

  it('gives every journey a participant, an entry point, steps and guardrails', () => {
    for (const journey of PLATFORM_JOURNEYS) {
      expect(journey.title.length).toBeGreaterThan(10);
      expect(journey.actor.length).toBeGreaterThan(3);
      expect(journey.entryPoint.length).toBeGreaterThan(5);
      expect(journey.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of journey.steps) {
        expect(step.step.length).toBeGreaterThan(10);
        expect(step.expected.length).toBeGreaterThan(10);
      }
      // The guardrails are the point: a journey with no refusal is just a happy path.
      expect(journey.guardrails.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('names suites that exist on disk', () => {
    for (const journey of PLATFORM_JOURNEYS) {
      expect(journey.suites.length).toBeGreaterThanOrEqual(1);
      for (const suite of journey.suites) {
        expect(suite).toMatch(/^test\/.+\.integration\.spec\.ts$/);
        expect(existsSync(join(ROOT, suite))).toBe(true);
      }
    }
    // A suite may prove more than one journey — B and D both run through the agent surface — but
    // a duplicate within one journey would double-count its tests.
    for (const journey of PLATFORM_JOURNEYS) {
      expect(new Set(journey.suites).size).toBe(journey.suites.length);
    }
  });

  it('spans the money paths, the controls and the exits', () => {
    const text = PLATFORM_JOURNEYS.map((journey) => `${journey.title} ${journey.actor}`).join(
      ' | ',
    );
    for (const theme of [
      /registers/i,
      /funds their wallet/i,
      /transfers/i,
      /withdraws cash/i,
      /float/i,
      /two people/i,
      /reconciled/i,
      /KYC/i,
      /Risk signals/i,
      /erased/i,
    ]) {
      expect(text).toMatch(theme);
    }
  });
});

describe('platform journeys — the recorded run', () => {
  it('covers all ten journeys and records a real timestamp and command', () => {
    expect(report.journeys.map((journey) => journey.id)).toEqual(EXPECTED_IDS);
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
    expect(report.command).toContain('jest');
    expect(report.database.disposableCluster).toBe(true);
    expect(report.database.port).toBeGreaterThan(0);
  });

  it('reports every journey as passed', () => {
    const failed = report.journeys.filter((journey) => journey.verdict !== 'PASS');
    expect(failed).toEqual([]);
    expect(report.summary).toEqual({
      journeys: 10,
      passed: 10,
      failed: 0,
      notRun: 0,
      tests: report.summary.tests,
    });
  });

  it('counts more than a hundred executed assertions, none of them failing', () => {
    // The exact number changes as suites grow; the point is that the journeys actually ran tests
    // rather than reporting ten empty passes.
    expect(report.summary.tests).toBeGreaterThan(100);
    for (const journey of report.journeys) {
      expect(journey.tests).toBeGreaterThan(0);
      for (const suite of journey.suites) {
        expect(suite.status).toBe('PASS');
        expect(suite.failed).toBe(0);
        expect(suite.tests).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the report consistent with the registry it came from', () => {
    for (const journey of PLATFORM_JOURNEYS) {
      const recorded = report.journeys.find((entry) => entry.id === journey.id);
      expect(recorded?.title).toBe(journey.title);
      expect(recorded?.suites.map((suite) => suite.file)).toEqual([...journey.suites]);
    }
  });

  it('keeps every disclaimer that stops the evidence overclaiming', () => {
    const joined = report.notPerformed.join(' | ').toLowerCase();
    expect(joined).toMatch(/no provider was contacted/);
    expect(joined).toMatch(/no real money moved/);
    expect(joined).toMatch(/no browser, mobile app or device/);
    expect(joined).toMatch(/no deployment/);
  });
});

describe('platform journeys — verdict rules', () => {
  function outcomes(entries: [string, 'PASS' | 'FAIL', number, number][]): RawSuiteOutcome[] {
    return entries.map(([file, status, tests, failed]) => ({
      file,
      status,
      tests,
      failed,
      durationMs: 1,
    }));
  }

  const journey = PLATFORM_JOURNEYS[0];
  if (!journey) throw new Error('registry is empty');

  it('passes a journey only when every one of its suites passed', () => {
    const [first, second] = journey.suites;
    const pass = evaluateJourneyResults(
      [journey],
      outcomes([
        [String(first), 'PASS', 5, 0],
        [String(second), 'PASS', 7, 0],
      ]),
      [],
    );
    expect(pass[0]?.verdict).toBe('PASS');
    expect(pass[0]?.tests).toBe(12);
  });

  it('fails a journey when one suite failed', () => {
    const [first, second] = journey.suites;
    const failed = evaluateJourneyResults(
      [journey],
      outcomes([
        [String(first), 'PASS', 5, 0],
        [String(second), 'FAIL', 7, 1],
      ]),
      [],
    );
    expect(failed[0]?.verdict).toBe('FAIL');
  });

  it('fails a journey whose suite threw in teardown with zero red assertions', () => {
    /*
     * This is not hypothetical: journey E's suite passed all fourteen assertions and still failed,
     * because `app.close()` destroyed the DataSource and the teardown destroyed it again. A verdict
     * derived from failing-assertion count alone would have called that green.
     */
    const [first, second] = journey.suites;
    const failed = evaluateJourneyResults(
      [journey],
      outcomes([
        [String(first), 'PASS', 5, 0],
        [String(second), 'FAIL', 14, 0],
      ]),
      [],
    );
    expect(failed[0]?.verdict).toBe('FAIL');
  });

  it('treats a missing or unrun suite as not proven, never as a pass', () => {
    const [first, second] = journey.suites;
    const missing = evaluateJourneyResults([journey], outcomes([[String(first), 'PASS', 5, 0]]), [
      String(second),
    ]);
    expect(missing[0]?.verdict).toBe('FAIL');
    expect(missing[0]?.suites.map((suite) => suite.status)).toEqual(['PASS', 'MISSING']);

    const notRun = evaluateJourneyResults([journey], outcomes([[String(first), 'PASS', 5, 0]]), []);
    expect(notRun[0]?.verdict).toBe('NOT_RUN');
    expect(notRun[0]?.suites.map((suite) => suite.status)).toEqual(['PASS', 'NOT_RUN']);
  });

  it('treats a suite that executed no assertions as a failure', () => {
    const [first, second] = journey.suites;
    const empty = evaluateJourneyResults(
      [journey],
      outcomes([
        [String(first), 'PASS', 5, 0],
        [String(second), 'PASS', 0, 0],
      ]),
      [],
    );
    expect(empty[0]?.verdict).toBe('FAIL');
  });

  it('summarises consistently with the results it is given', () => {
    const summary = summariseJourneys([
      { id: 'A', title: 'a', suites: [], verdict: 'PASS', tests: 3 },
      { id: 'B', title: 'b', suites: [], verdict: 'FAIL', tests: 4 },
      { id: 'C', title: 'c', suites: [], verdict: 'NOT_RUN', tests: 0 },
    ]);
    expect(summary).toEqual({ journeys: 3, passed: 1, failed: 1, notRun: 1, tests: 7 });
  });
});

describe('platform journeys — the defect the run found', () => {
  it('keeps the teardown guard in the suite that failed on it', () => {
    /*
     * `a3d-agent-float-funding` overrides the DataSource provider, so `app.close()` already destroys
     * it; destroying it again threw `CannotExecuteNotConnectedError` in `afterAll` and reddened the
     * suite while all fourteen assertions passed. Presence-based CI gates cannot see this, because a
     * configured job is not a passing one — executing the suite is what surfaced it.
     */
    const source = readFileSync(
      join(ROOT, 'test/a3d-agent-float-funding.integration.spec.ts'),
      'utf8',
    );
    expect(source).toContain('if (db?.isInitialized) await db.destroy()');
    expect(source).not.toMatch(/\n\s*await db\?\.destroy\(\);/);
  });
});
