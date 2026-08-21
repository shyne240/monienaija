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
  maxWorkers: 1
};
