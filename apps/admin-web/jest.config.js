module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: { '\\.css$': '<rootDir>/__tests__/style-mock.js' },
  // These are ts-jest + jsdom render suites over large back-office screens. Jest's 5 s default
  // is below the wall-clock cost of the heavier screens on a shared CI runner, where the
  // push-triggered and pull_request-triggered runs of the same commit execute concurrently and
  // contend for CPU. That produced a non-deterministic red check with no behavioural change
  // (commit 5bc03845: Admin Web green in the push run, failed in the racing PR run; the same
  // suite passes locally at the exact CI command). Raising the default budget removes the
  // resource-contention flake without weakening anything: no assertion, retry or skip is
  // altered, and genuinely hung tests still fail.
  testTimeout: 20000,
};
