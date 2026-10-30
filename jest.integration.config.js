/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Only the real-PostgreSQL suites. These require a live server; the harness throws rather
  // than skipping when PostgreSQL is unreachable.
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  testTimeout: 120000,
  maxWorkers: 1,
  // Housekeeping for the shared migration-template database (see
  // test/support/pg-harness.ts `ensureMigrationTemplateDatabase`): drop any stale template
  // for this process id before the run starts, and drop the one this run builds once every
  // suite has finished with it. Both only ever touch this exact process's own template name,
  // never a different run's, so concurrent invocations against the same PostgreSQL server
  // cannot interfere with each other.
  globalSetup: '<rootDir>/test/support/pg-template-sweep.ts',
  globalTeardown: '<rootDir>/test/support/pg-template-sweep.ts'
};
