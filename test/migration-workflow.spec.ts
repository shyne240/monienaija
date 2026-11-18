import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ARENA 3D Group 11 — migration workflow guards.
 *
 * The workflow itself needs a live database and is exercised out of band. What is checked here are the
 * properties that make it safe: that it cannot revert, that it locks, that it refuses to claim success
 * when work remains, and that the documentation and the code agree about all of that.
 */
const REPO_ROOT = join(__dirname, '..');
const WORKFLOW = readFileSync(join(REPO_ROOT, 'scripts', 'migration-workflow.js'), 'utf8');
const DOC = readFileSync(join(REPO_ROOT, 'docs', 'integration', 'MIGRATION-WORKFLOW.md'), 'utf8');

describe('Group 11 — migration workflow', () => {
  describe('there is no destructive revert', () => {
    it('exposes no revert command', () => {
      // Not "revert is discouraged" — the command does not exist. An available command gets run under
      // pressure at 3am; the only reliable safeguard is its absence.
      expect(WORKFLOW).not.toMatch(/migration:revert'/);
      expect(WORKFLOW).not.toContain("command === 'revert'");
      expect(WORKFLOW).not.toContain('command === "revert"');
    });

    it('only accepts the three documented commands', () => {
      const commands = [...WORKFLOW.matchAll(/command === '([a-z]+)'/g)].map((m) => m[1]);
      expect(commands.sort()).toEqual(['apply', 'status', 'verify']);
    });

    it('documents the absence of revert rather than leaving it unexplained', () => {
      expect(DOC).toContain('There is no revert');
      expect(DOC).toMatch(/Never `migration:revert` in production\./);
      expect(DOC).toMatch(/Recovery is roll-forward/i);
    });
  });

  describe('locking', () => {
    it('takes an advisory lock with a fixed numeric key', () => {
      // A fixed literal rather than hashtext(): stable across PostgreSQL versions and legible in pg_locks.
      expect(WORKFLOW).toMatch(/MIGRATION_LOCK_KEY = [\d_]+n/);
      expect(WORKFLOW).toContain('pg_advisory_lock');
      expect(WORKFLOW).toContain('pg_advisory_unlock');
    });

    it('supports failing fast instead of queueing forever', () => {
      expect(WORKFLOW).toContain('pg_try_advisory_lock');
      expect(WORKFLOW).toContain('--no-wait');
      // A bounded wait, because a release that waits forever is not a release.
      expect(WORKFLOW).toContain('wait-seconds');
      expect(WORKFLOW).toContain('statement_timeout');
    });

    it('exits 2 rather than 1 when the lock is held, so contention is distinguishable from failure', () => {
      expect(WORKFLOW).toMatch(/refusing to interleave[\s\S]{0,400}return 2/);
    });

    it('releases the lock even when the migration run throws', () => {
      // The unlock lives in a `finally`; without it a failed run would leave the next deploy blocked
      // behind a lock held by a process that has already exited its useful life.
      const applyBody = WORKFLOW.slice(
        WORKFLOW.indexOf('async function apply('),
        WORKFLOW.indexOf('async function verify('),
      );
      expect(applyBody).toContain('finally {');
      expect(applyBody).toContain('pg_advisory_unlock');
    });
  });

  describe('it refuses to overstate success', () => {
    it('re-checks the applied set after migrating and fails if anything is still pending', () => {
      expect(WORKFLOW).toMatch(/after\.pending\.length > 0/);
      expect(WORKFLOW).toContain('REFUSING to report success');
    });

    it('reports a database ahead of the code as a distinct, failing condition', () => {
      expect(WORKFLOW).toContain('missingFromRepository');
      expect(WORKFLOW).toMatch(/is AHEAD of the code/);
      expect(WORKFLOW).toMatch(/VERIFY FAILED: database contains/);
    });

    it('compares migrations by timestamp, which is the key TypeORM actually uses', () => {
      // Comparing by name would make a renamed file look permanently unapplied.
      expect(WORKFLOW).toContain('timestamp');
      expect(WORKFLOW).toMatch(/m\.timestamp/);
    });
  });

  describe('the documentation matches the code', () => {
    it('documents every exit code the tool can return', () => {
      for (const code of ['0', '1', '2', '3']) {
        expect(DOC).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
      }
    });

    it('names the same lock key the code uses', () => {
      const key = WORKFLOW.match(/MIGRATION_LOCK_KEY = ([\d_]+)n/);
      expect(key).not.toBeNull();
      const literal = (key?.[1] ?? '').replace(/_/g, '');
      expect(literal).not.toBe('');
      expect(DOC).toContain(literal);
    });

    it('states plainly which recovery steps are not automated', () => {
      // A runbook that implies an automatic backup or rollback exists is worse than one that omits them.
      expect(DOC).toContain('What is not automated');
      expect(DOC).toMatch(/No automatic pre-migration backup/);
      expect(DOC).toMatch(/No automatic rollback/);
    });
  });

  describe('the CLI rejects unknown input', () => {
    it('prints usage and exits 3 for an unknown command', () => {
      let result: { status: number; stderr: string };
      try {
        execFileSync('node', [join(REPO_ROOT, 'scripts', 'migration-workflow.js'), 'revert-all'], {
          stdio: 'pipe',
          env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '1' },
        });
        throw new Error('expected a non-zero exit');
      } catch (error) {
        const failure = error as { status: number; stderr: Buffer };
        result = { status: failure.status, stderr: String(failure.stderr) };
      }
      // The usage path must be reached without touching the database, so the unreachable DB_PORT above
      // never matters. Exit 3 is the documented usage code.
      expect(result.status).toBe(3);
      expect(result.stderr).toMatch(/usage:/);
      expect(result.stderr).toMatch(/no revert command by design/);
    });
  });
});
