/**
 * Unit tests for the run-scoped integration-database namespace (test/support/pg-run-namespace.ts
 * + the naming entry points in test/support/pg-harness.ts). No PostgreSQL required: these cover
 * name generation, namespace consistency, validation (no silent fallback to the old naming
 * scheme), collision avoidance with databases from previous runs, and cleanup scoping.
 */
import {
  PG_TEST_RUN_ID_ENV,
  RUN_IDENTIFIER_PATTERN,
  assertOwnRunDatabaseName,
  isValidRunIdentifier,
  resetRunIdentifierMemoForTests,
  resolveRunIdentifier,
  validateRunIdentifier,
} from './support/pg-run-namespace';
import {
  integrationDatabaseName,
  migrationTemplateDatabaseName,
} from './support/pg-harness';

const LEGACY_FOREIGN_DATABASE = 'mn_it_h04unify_20364';

describe('integration-test run namespace (pg-run-namespace + pg-harness naming)', () => {
  const ORIGINAL_ENV = process.env[PG_TEST_RUN_ID_ENV];

  beforeEach(() => {
    resetRunIdentifierMemoForTests();
    delete process.env[PG_TEST_RUN_ID_ENV];
  });

  afterAll(() => {
    resetRunIdentifierMemoForTests();
    if (ORIGINAL_ENV === undefined) delete process.env[PG_TEST_RUN_ID_ENV];
    else process.env[PG_TEST_RUN_ID_ENV] = ORIGINAL_ENV;
  });

  describe('name generation', () => {
    it('embeds the run identifier and pid in suite database names', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      const name = integrationDatabaseName('v1-comm-03');
      expect(name).toBe(`mn_it_v1_comm_03_win21oct_${process.pid}`);
    });

    it('sanitises labels to lowercase alphanumerics/underscores and bounds their length', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(integrationDatabaseName('P0-A/COM:01')).toBe(
        `mn_it_p0_a_com_01_win21oct_${process.pid}`,
      );
      const long = integrationDatabaseName('x'.repeat(100));
      expect(long.startsWith('mn_it_')).toBe(true);
      expect(long.length).toBeLessThanOrEqual(63); // PostgreSQL identifier limit
      expect(integrationDatabaseName('v1-comm-03').length).toBeLessThanOrEqual(63);
    });

    it('names the migration template under the same run namespace', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(migrationTemplateDatabaseName()).toBe(`mn_it_tpl_win21oct_${process.pid}`);
    });
  });

  describe('namespace consistency', () => {
    it('resolves the identifier once per process and reuses it for every name in the run', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(resolveRunIdentifier()).toBe('win21oct');
      // Mutating the environment mid-run must not change the namespace.
      process.env[PG_TEST_RUN_ID_ENV] = 'otherid';
      expect(resolveRunIdentifier()).toBe('win21oct');
      expect(integrationDatabaseName('suite-a')).toBe(
        `mn_it_suite_a_win21oct_${process.pid}`,
      );
      expect(migrationTemplateDatabaseName()).toBe(`mn_it_tpl_win21oct_${process.pid}`);
    });

    it('gives suite databases and the migration template the identical run namespace', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      const suite = integrationDatabaseName('suite-a');
      const template = migrationTemplateDatabaseName();
      const suffix = `_win21oct_${process.pid}`;
      expect(suite.endsWith(suffix)).toBe(true);
      expect(template.endsWith(suffix)).toBe(true);
    });
  });

  describe('validation — no silent fallback to the old naming scheme', () => {
    it('throws when the identifier is missing (never falls back to mn_it_<label>_<pid>)', () => {
      delete process.env[PG_TEST_RUN_ID_ENV];
      expect(() => resolveRunIdentifier()).toThrow(/PG_TEST_RUN_ID is required/);
      expect(() => integrationDatabaseName('suite-a')).toThrow(/PG_TEST_RUN_ID/);
      expect(() => migrationTemplateDatabaseName()).toThrow(/PG_TEST_RUN_ID/);
    });

    it('throws when the identifier is empty', () => {
      process.env[PG_TEST_RUN_ID_ENV] = '';
      expect(() => resolveRunIdentifier()).toThrow(/PG_TEST_RUN_ID is required/);
    });

    it.each([
      ['uppercase', 'Win21Oct'],
      ['too short', 'abc'],
      ['too long', 'a'.repeat(17)],
      ['leading digit', '1win21'],
      ['underscore', 'win_21oct'],
      ['hyphen', 'win-21oct'],
      ['space', 'win 21oct'],
      ['path-like', '../evil'],
      ['sql-ish', 'x";drop'],
    ])('rejects invalid identifier (%s) loudly', (_case, value) => {
      process.env[PG_TEST_RUN_ID_ENV] = value;
      expect(isValidRunIdentifier(value)).toBe(false);
      expect(() => validateRunIdentifier(value)).toThrow(/Invalid PG_TEST_RUN_ID/);
      expect(() => resolveRunIdentifier()).toThrow(/Invalid PG_TEST_RUN_ID/);
      expect(() => integrationDatabaseName('suite-a')).toThrow(/PG_TEST_RUN_ID/);
    });

    it('accepts validated safe identifiers', () => {
      for (const value of ['win21oct', 'r1a2b3c4d5e6', 'p0test', 'abcdefghij']) {
        expect(isValidRunIdentifier(value)).toBe(true);
        expect(validateRunIdentifier(value)).toBe(value);
        expect(RUN_IDENTIFIER_PATTERN.test(value)).toBe(true);
      }
    });
  });

  describe('collision avoidance with previous runs', () => {
    it('produces different database names for different run identifiers (same pid, same label)', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'runaaaa';
      const first = integrationDatabaseName('v1-comm-03');
      const firstTemplate = migrationTemplateDatabaseName();
      resetRunIdentifierMemoForTests();
      process.env[PG_TEST_RUN_ID_ENV] = 'runbbbb';
      const second = integrationDatabaseName('v1-comm-03');
      const secondTemplate = migrationTemplateDatabaseName();
      expect(second).not.toBe(first);
      expect(secondTemplate).not.toBe(firstTemplate);
    });

    it('can never generate — or drop — databases from the old un-namespaced scheme', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'h04unify'; // even a same-shaped identifier...
      const name = integrationDatabaseName('h04unify');
      // ...still embeds the run id and pid: the legacy name is unreachable.
      expect(name).toBe(`mn_it_h04unify_h04unify_${process.pid}`);
      expect(name).not.toBe(LEGACY_FOREIGN_DATABASE);
      expect(() => assertOwnRunDatabaseName(LEGACY_FOREIGN_DATABASE)).toThrow(
        /outside this run's namespace/,
      );
    });

    it('keeps per-suite isolation: different labels stay different databases', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(integrationDatabaseName('suite-a')).not.toBe(integrationDatabaseName('suite-b'));
    });
  });

  describe('cleanup scoping (assertOwnRunDatabaseName)', () => {
    it('allows drops only for names generated under this run namespace + pid', () => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(() => assertOwnRunDatabaseName(integrationDatabaseName('suite-a'))).not.toThrow();
      expect(() => assertOwnRunDatabaseName(migrationTemplateDatabaseName())).not.toThrow();
    });

    it.each([
      ['legacy/un-namespaced database', LEGACY_FOREIGN_DATABASE],
      ['another run id', `mn_it_suite_a_othersun_${process.pid}`],
      ['another pid', 'mn_it_suite_a_win21oct_999999999'],
      ['prefix lookalike', `mn_itx_suite_a_win21oct_${process.pid}`],
      ['template of another run', `mn_it_tpl_othersun_${process.pid}`],
      ['plain database', 'postgres'],
    ])('refuses to drop %s', (_case, name) => {
      process.env[PG_TEST_RUN_ID_ENV] = 'win21oct';
      expect(() => assertOwnRunDatabaseName(name)).toThrow(/outside this run's namespace/);
    });

    it('fails loudly (not silently) when the run identifier is missing during cleanup', () => {
      delete process.env[PG_TEST_RUN_ID_ENV];
      expect(() => assertOwnRunDatabaseName('mn_it_suite_a_whatever_1')).toThrow(
        /PG_TEST_RUN_ID/,
      );
    });
  });
});
