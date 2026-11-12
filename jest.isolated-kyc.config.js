/**
 * @type {import('jest').Config}
 *
 * The isolated KYC suites (`test/*.isolated-pg.test.ts`) run against their OWN disposable,
 * socket-only PostgreSQL cluster, not the shared cluster `npm run test:pg` uses. They are
 * therefore deliberately excluded from `jest.integration.config.js` and require their own run:
 *
 *   KYC_ISOLATED_CONFIRM_DISPOSABLE=yes npm run test:pg:isolated-kyc
 *
 * `maxWorkers: 1` is required, not merely preferred: each suite creates a schema in the one
 * cluster and the suites assert on cluster-level state (governance singletons, provider lock).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.isolated-pg\\.test\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  testTimeout: 180000,
  maxWorkers: 1,
};
