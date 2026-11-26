import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseScriptNames } from '../src/deployment/ci-gate.service';
import {
  DELIBERATE_EXCLUSIONS,
  inventoryRepositorySuites,
  inventorySuites,
} from '../src/deployment/postgres-acceptance.service';

/**
 * ARENA 3D Group 30 — full PostgreSQL acceptance.
 *
 * The property under test is coverage of the *runner*, not correctness of the suites: every test file that needs
 * a database must be claimed by something that actually executes it. A suite nothing runs is worse than no suite,
 * because it looks like coverage.
 */
describe('Group 30 — PostgreSQL acceptance inventory', () => {
  const repoRoot = join(__dirname, '..');
  const scripts = parseScriptNames(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const workflowText = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const inventory = inventoryRepositorySuites(repoRoot, scripts, workflowText);

  describe('every database suite is claimed by a runner', () => {
    it('reports PASS with nothing unclaimed', () => {
      expect(inventory.unclaimed.map((suite) => suite.file)).toEqual([]);
      expect(inventory.verdict).toBe('PASS');
    });

    it('finds a substantial matrix — this is not a near-empty inventory', () => {
      // A guard against the inventory silently finding nothing and "passing".
      expect(inventory.total).toBeGreaterThan(150);
    });

    it('claims both suite kinds', () => {
      const kinds = new Set(inventory.discovered.map((suite) => suite.kind));
      expect(kinds).toContain('INTEGRATION');
      expect(kinds).toContain('ISOLATED_PG');
    });

    it('finds every isolated suite that CI did not run', () => {
      /*
       * The concrete gap. These do not match `.*\.integration\.spec\.ts$`, are run by a separate script, and
       * that script was never invoked from CI — so migration chains, governance singletons, KYC registration and
       * governed ledger reversal were guarded by tests that never ran on a push.
       */
      const isolated = inventory.discovered.filter((suite) => suite.kind === 'ISOLATED_PG');
      expect(isolated.length).toBe(12);
      for (const suite of isolated) {
        expect(suite.executedBy).toBe('npm run test:pg:isolated-kyc');
      }
    });

    it('names the runner script for every integration suite', () => {
      const integration = inventory.discovered.filter((suite) => suite.kind === 'INTEGRATION');
      expect(integration.length).toBeGreaterThan(150);
      for (const suite of integration) {
        expect(suite.executedBy).toBe('npm run test:pg');
      }
    });
  });

  describe('it detects a suite nothing runs', () => {
    it('reports an isolated suite as unclaimed when its script is absent', () => {
      // Removing the script is how a runner silently stops running anything.
      const withoutScript = new Set([...scripts].filter((name) => name !== 'test:pg:isolated-kyc'));
      const broken = inventoryRepositorySuites(repoRoot, withoutScript, workflowText);

      expect(broken.verdict).toBe('ERROR');
      expect(broken.unclaimed.length).toBe(12);
      expect(broken.unclaimed.every((suite) => suite.kind === 'ISOLATED_PG')).toBe(true);
    });

    it('reports a suite as unclaimed when CI stops invoking its script', () => {
      /*
       * The subtler failure, and the one that actually happened: the script exists and works, but no pipeline
       * calls it. A script nobody invokes executes nothing.
       */
      const workflowWithout = workflowText.replace(
        'npm run test:pg:isolated-kyc:ci',
        'npm run something-else',
      );
      const broken = inventoryRepositorySuites(repoRoot, scripts, workflowWithout);

      expect(broken.verdict).toBe('ERROR');
      expect(broken.unclaimed.length).toBe(12);
    });

    it('reports an unclaimed file dropped into a synthetic test directory', () => {
      const synthetic = inventorySuites(join(repoRoot, 'test'), {
        scripts: new Set([...scripts].filter((name) => name !== 'test:pg')),
        workflowText,
      });
      // Without `test:pg`, every integration suite becomes unclaimed.
      expect(synthetic.unclaimed.length).toBeGreaterThan(150);
    });
  });

  describe('exclusions are written down, never silent', () => {
    it('records a reason for every deliberate exclusion', () => {
      for (const exclusion of DELIBERATE_EXCLUSIONS) {
        expect(exclusion.reason.length).toBeGreaterThan(10);
        expect(exclusion.file.startsWith('test/')).toBe(true);
      }
    });

    it('excludes only files that do not exist', () => {
      /*
       * An exclusion for a file that is present would hide a real suite. These entries exist to explain a
       * scratch file that was deleted; if one reappears, this fails rather than quietly ignoring it.
       */
      const present = new Set(inventory.discovered.map((suite) => suite.file));
      for (const exclusion of DELIBERATE_EXCLUSIONS) {
        expect(present.has(exclusion.file)).toBe(false);
      }
    });
  });

  describe('what this report does not claim', () => {
    it('carries no pass/fail result for any suite', () => {
      /*
       * Inventory is static. A green inventory says "everything is wired up", not "everything works". Mixing
       * the two is the same conflation as treating SENT as delivered.
       */
      const serialized = JSON.stringify(inventory);
      expect(serialized).not.toMatch(/"passed"|"failed"|"duration"|"lastRun"/);
      for (const suite of inventory.discovered) {
        expect(Object.keys(suite)).not.toContain('passed');
        expect(Object.keys(suite)).not.toContain('failed');
      }
    });

    it('does not claim the isolated suites ran in this environment', () => {
      // No `initdb`/`pg_ctl` exists here, so they demonstrably did not. CI installs them; that is the claim.
      expect(scripts.has('test:pg:isolated-kyc:ci')).toBe(true);
      const block = workflowText.slice(workflowText.indexOf('backend-postgres-isolated:'));
      expect(block).toContain('postgresql');
    });
  });
});
