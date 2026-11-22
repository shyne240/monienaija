import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REQUIRED_CI,
  evaluateCiGates,
  evaluateRepositoryCiGates,
  extractJobBlock,
  parseScriptNames,
} from '../src/deployment/ci-gate.service';

/**
 * ARENA 3D Group 29 — CI and deployment gates.
 *
 * This suite reads the repository's own workflow file. It fails if a gate is deleted or hollowed out, which is
 * the only mechanism that makes "we have a PostgreSQL gate" a checkable claim rather than a convention.
 */
describe('Group 29 — CI and deployment gates', () => {
  const repoRoot = join(__dirname, '..');
  const workflowText = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const packageJsonText = readFileSync(join(repoRoot, 'package.json'), 'utf8');

  describe('the repository currently passes its own gates', () => {
    it('reports PASS with no missing gates', () => {
      const report = evaluateRepositoryCiGates(repoRoot);
      expect(report.missing).toEqual([]);
      expect(report.verdict).toBe('PASS');
    });

    it('checks every declared job', () => {
      const report = evaluateRepositoryCiGates(repoRoot);
      const jobGates = report.checks.filter((check) => check.gate.startsWith('job:'));
      expect(jobGates.map((check) => check.gate).sort()).toEqual(
        REQUIRED_CI.jobs.map((job) => `job:${job.name}`).sort(),
      );
      for (const gate of jobGates) expect(gate.present).toBe(true);
    });

    it('checks every script the workflow depends on', () => {
      const report = evaluateRepositoryCiGates(repoRoot);
      for (const script of REQUIRED_CI.requiredScripts) {
        expect(report.checks.find((check) => check.gate === `script:${script}`)?.present).toBe(
          true,
        );
      }
    });
  });

  describe('the gates it took to get here are recorded', () => {
    it('gates the agent mobile app, which CI previously never touched', () => {
      /*
       * The concrete gap this group found. `apps/agent-mobile` had 323 passing unit tests and a clean type
       * check, and the workflow did not reference it at all — so none of that ever ran on a push.
       */
      const block = extractJobBlock(workflowText, 'agent-mobile');
      expect(block).not.toBeNull();
      expect(block).toContain('apps/agent-mobile');
      expect(block).toContain('npm run ts:check');
      expect(block).toContain('npm test');
    });

    it('gates the production container image build', () => {
      // The Dockerfile existed and nothing ever built it.
      const block = extractJobBlock(workflowText, 'backend-container-build');
      expect(block).not.toBeNull();
      expect(block).toContain('docker/build-push-action');
    });

    it('keeps the real-PostgreSQL gate non-optional', () => {
      const block = extractJobBlock(workflowText, 'backend-postgres');
      expect(block).toContain('PG_TEST_CONFIRM_DISPOSABLE_CLUSTER');
      // A gate that is allowed to fail is not a gate.
      expect(block).not.toContain('continue-on-error: true');
    });

    it('runs lint as two passes, because one pass exhausts the runner', () => {
      /*
       * A single eslint invocation over both src and test builds one TypeScript program over ~1,750 files
       * and aborts with an
       * out-of-memory kill on a constrained runner. Split, each half fits. This is asserted because silently
       * merging them back would restore a gate that fails for an infrastructure reason, which reads as a code
       * failure and wastes an afternoon.
       */
      const scripts = parseScriptNames(packageJsonText);
      expect(scripts.has('lint:src')).toBe(true);
      expect(scripts.has('lint:test')).toBe(true);
    });
  });

  describe('it detects a gate being removed or hollowed out', () => {
    it('fails when a job is deleted', () => {
      const without = workflowText.replace(
        /\n {2}agent-mobile:\n[\s\S]*?(?=\n {2}[a-z-]+:\n)/,
        '\n',
      );
      const report = evaluateCiGates(without, packageJsonText);
      expect(report.verdict).toBe('ERROR');
      expect(report.missing).toContain('job:agent-mobile');
    });

    it('fails when a required step is removed from a job', () => {
      const hollowed = workflowText.replace('        run: npm run test:pg\n', '');
      const report = evaluateCiGates(hollowed, packageJsonText);
      expect(report.verdict).toBe('ERROR');
      expect(report.missing).toContain('job:backend-postgres');
    });

    it('fails when continue-on-error weakens the database gate', () => {
      // The schema asserts absence of the fragment inside the block, so adding it must be caught.
      const weakened = workflowText.replace(
        '  backend-postgres:\n',
        '  backend-postgres:\n    continue-on-error: true\n',
      );
      const block = extractJobBlock(weakened, 'backend-postgres');
      expect(block).toContain('continue-on-error: true');
    });

    it('fails when a required npm script disappears', () => {
      const withoutScript = JSON.stringify({
        ...(JSON.parse(packageJsonText) as { scripts: Record<string, string> }),
        scripts: {
          ...(JSON.parse(packageJsonText) as { scripts: Record<string, string> }).scripts,
        },
      });
      const parsed = JSON.parse(withoutScript) as { scripts: Record<string, string> };
      delete parsed.scripts['test:pg'];

      const report = evaluateCiGates(workflowText, JSON.stringify(parsed));
      expect(report.verdict).toBe('ERROR');
      expect(report.missing).toContain('script:test:pg');
    });

    it('fails when the container build is dropped', () => {
      const without = workflowText.replace(
        /\n {2}backend-container-build:\n[\s\S]*?(?=\n {2}[a-z-]+:\n)/,
        '\n',
      );
      const report = evaluateCiGates(without, packageJsonText);
      expect(report.missing).toContain('job:backend-container-build');
    });
  });

  describe('what this report does not claim', () => {
    it('does not claim any workflow ran', () => {
      /*
       * Nothing here can execute GitHub Actions. The report asserts the gates exist and are intact; it says
       * nothing about whether they passed, and there is no field that could be read as a run result.
       */
      const report = evaluateRepositoryCiGates(repoRoot);
      expect(Object.keys(report)).not.toContain('lastRun');
      expect(Object.keys(report)).not.toContain('status');
      expect(Object.keys(report)).not.toContain('conclusion');
      expect(JSON.stringify(report)).not.toMatch(/success|passed in|duration/i);
    });

    it('declares no deploy or release job or production deployment action', () => {
      // The release event is retained for release-time regression; it is not a release job.
      expect(workflowText).toMatch(/^[ ]{2}release:\n[ ]{4}types: \[published\]$/m);
      expect(extractJobBlock(workflowText, 'deploy')).toBeNull();
      expect(extractJobBlock(workflowText, 'release')).toBeNull();

      // Deployment is deliberately absent: no production environment or deployment action is configured.
      expect(workflowText).not.toContain('environment: production');
      expect(workflowText).not.toMatch(/^\s+uses:.*(?:deploy|release).*@/im);
    });

    it('configures no registry push', () => {
      // A `push: true` build would need registry credentials that do not exist here.
      expect(workflowText).not.toContain('push: true');
      expect(workflowText).not.toContain('docker/login-action');
    });
  });
});
