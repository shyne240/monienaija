import { assertDisposablePgTestEnvironment } from './support/pg-test-safety';

describe('PostgreSQL integration test safety', () => {
  const safe = {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: 'yes',
  };
  it('requires explicit test mode, loopback and disposable-cluster confirmation', () => {
    expect(() => assertDisposablePgTestEnvironment(safe)).not.toThrow();
    for (const bad of [
      { ...safe, NODE_ENV: 'production' },
      { ...safe, DB_HOST: 'db.example.com' },
      { ...safe, DB_HOST: '/tmp/socket' },
      { ...safe, DB_HOST: '' },
      { ...safe, PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: '' },
    ])
      expect(() => assertDisposablePgTestEnvironment(bad)).toThrow();
  });
});
