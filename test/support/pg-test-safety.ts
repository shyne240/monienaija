/** Integration tests CREATE/DROP databases: never infer that a loopback server is disposable. */
export function assertDisposablePgTestEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'test')
    throw new Error('PostgreSQL integration tests require NODE_ENV=test.');
  const host = (env.DB_HOST ?? '').trim().toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      'PostgreSQL integration tests require explicit loopback DB_HOST; remote hosts are refused.',
    );
  }
  if (env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER !== 'yes') {
    throw new Error(
      'PostgreSQL integration tests CREATE/DROP databases: set PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes only for an independently verified disposable local cluster.',
    );
  }
}
