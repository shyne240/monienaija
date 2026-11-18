import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 3D Group 30 — full PostgreSQL acceptance.
 *
 * ## The question this answers
 *
 * The repository has 179 real-PostgreSQL integration suites. The correct question is not "do they pass?" — they
 * do, and each one has been run. It is: **does every suite that needs a database actually get run by the matrix
 * runner, and is anything excluded without anyone deciding so?**
 *
 * That is a coverage question about the *runner*, and it is the one that goes wrong silently. A suite named
 * `foo.integration.spec.ts` is picked up automatically; a suite named `foo.isolated-pg.test.ts` is not, because
 * the integration config's `testRegex` is `.*\.integration\.spec\.ts$`. Anyone who writes the second kind and
 * forgets to wire it up has written a test that never runs, and nothing fails.
 *
 * This group found exactly that: eleven `*.isolated-pg.test.ts` suites exist, they are run by a separate script
 * (`run-isolated-kyc-tests.js`), and **that script is not invoked from CI at all**. They guard migration chains,
 * governance singletons, KYC registration flows and governed ledger reversal. None of it ran on any push.
 *
 * ## What this service does and does not claim
 *
 * It performs **static inventory**: which test files exist, which pattern claims them, and which are unclaimed.
 * It does not run them, and it does not report pass/fail — a green inventory says "everything is wired up", not
 * "everything works". Reporting the two as one number would be the same conflation as treating SENT as delivered.
 */

export type SuiteKind = 'INTEGRATION' | 'ISOLATED_PG' | 'UNIT';

export interface DiscoveredSuite {
  readonly file: string;
  readonly kind: SuiteKind;
  readonly pattern: string;
  /** The npm script or runner that executes it, or null when nothing does. */
  readonly executedBy: string | null;
}

export interface SuiteInventory {
  readonly total: number;
  readonly discovered: DiscoveredSuite[];
  /** Suites that need a database but that no configured runner will execute. */
  readonly unclaimed: DiscoveredSuite[];
  readonly verdict: 'PASS' | 'ERROR';
}

/**
 * How each suite naming convention is claimed. Mirrors `jest.integration.config.js` and `jest.config.js`.
 *
 * `script` is the local entry point; `ciCommands` are the commands that invoke it from a workflow. The isolated
 * suites need a disposable cluster, so CI calls a wrapper (`:ci`) that adds the confirmation variable while the
 * underlying script stays unchanged for local use — hence both are listed rather than assuming one name.
 */
const PATTERNS: ReadonlyArray<{
  kind: SuiteKind;
  suffix: string;
  script: string;
  ciCommands: string[];
}> = [
  {
    kind: 'INTEGRATION',
    suffix: '.integration.spec.ts',
    script: 'test:pg',
    ciCommands: ['npm run test:pg'],
  },
  {
    kind: 'ISOLATED_PG',
    suffix: '.isolated-pg.test.ts',
    script: 'test:pg:isolated-kyc',
    ciCommands: ['npm run test:pg:isolated-kyc:ci', 'npm run test:pg:isolated-kyc'],
  },
];

/**
 * Files that look like a database suite but are deliberately outside the matrix, with the reason.
 *
 * An exclusion without a written reason is how coverage disappears. Everything here is asserted by a test, so
 * removing the exclusion means changing this list on purpose.
 */
export const DELIBERATE_EXCLUSIONS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'test/zz-dbg.integration.spec.ts',
    reason: 'scratch debugging file, deleted rather than committed',
  },
];

export interface InventoryOptions {
  /** Script names present in package.json. A suite whose runner script is missing counts as unclaimed. */
  readonly scripts: ReadonlySet<string>;
  /** CI workflow text, used to assert the isolated suite runner is actually invoked. */
  readonly workflowText: string;
}

/**
 * Builds the inventory from the test directory.
 *
 * A suite is claimed only when its runner script exists **and**, for the isolated suites, that script is
 * reachable from CI. Having a script nobody invokes is the exact failure this group is correcting.
 */
export function inventorySuites(testDir: string, options: InventoryOptions): SuiteInventory {
  const files = readdirSync(testDir)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .sort();

  const discovered: DiscoveredSuite[] = [];
  for (const file of files) {
    const pattern = PATTERNS.find((candidate) => file.endsWith(candidate.suffix));
    if (!pattern) continue;

    /* A runner script that exists but is not wired into CI does not count as executing anything. */
    const scriptExists = options.scripts.has(pattern.script);
    const usedCommand = pattern.ciCommands.find((command) =>
      invokesExactly(options.workflowText, command),
    );
    const executedBy = scriptExists && usedCommand ? `npm run ${pattern.script}` : null;

    discovered.push({
      file: file.startsWith('test/') ? file : `test/${file}`,
      kind: pattern.kind,
      pattern: pattern.suffix,
      executedBy,
    });
  }

  const excluded = new Set(DELIBERATE_EXCLUSIONS.map((entry) => entry.file.split('/').pop() ?? ''));
  const unclaimed = discovered.filter(
    (suite) => suite.executedBy === null && !excluded.has(suite.file.split('/').pop() ?? ''),
  );

  return {
    total: discovered.length,
    discovered,
    unclaimed,
    verdict: unclaimed.length === 0 ? 'PASS' : 'ERROR',
  };
}

/**
 * Whether the workflow invokes this command as a whole command.
 *
 * Matched exactly rather than as a substring because `npm run test:pg` is a strict prefix of the isolated
 * runner's CI command — a naive `includes` would let the integration pattern claim the isolated suites, which is
 * precisely the bug that lets a suite look wired up while nothing runs it.
 */
function invokesExactly(workflowText: string, command: string): boolean {
  const escaped = escapeRegExp(command);
  return new RegExp(`^\\s*(?:-\\s*)?run:\\s*${escaped}\\s*$`, 'm').test(workflowText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convenience wrapper that reads the repository's own `test/` directory. */
export function inventoryRepositorySuites(
  repoRoot: string,
  scripts: ReadonlySet<string>,
  workflowText: string,
): SuiteInventory {
  return inventorySuites(join(repoRoot, 'test'), { scripts, workflowText });
}
