import { DEFAULT_BASE_URL, LOCAL_DEVELOPMENT_BASE_URL, resolveApiBaseUrl } from '../src/config';

/**
 * Agent Mobile endpoint configuration — production must fail closed.
 *
 * The failure this guards against is specific and expensive: an EAS release build that shipped with
 * no `EXPO_PUBLIC_API_URL` set used to fall back to `http://10.0.2.2:3000`, which is the Android
 * emulator's alias for the host machine. The app would install, look functional, and silently send
 * every request — including authentication — to a developer's laptop over plain HTTP.
 *
 * The rule is tested through the pure resolver rather than by re-requiring the module. That is not a
 * workaround: `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` at transform time, so a module
 * reload cannot observe a different value, and a test that pretended otherwise would be asserting
 * something the shipped bundle never does. Passing the inputs in tests exactly the decision that gets
 * made, which is the point.
 */
describe('Agent Mobile API base URL resolution', () => {
  it('uses an explicitly configured endpoint in a production build', () => {
    expect(resolveApiBaseUrl('https://api.monienaija.ng', 'production')).toBe(
      'https://api.monienaija.ng',
    );
  });

  it('fails closed in a production build with no configured endpoint', () => {
    // Empty, not the emulator fallback. An empty base URL makes the API client refuse to issue a
    // request at all, which is the only safe behaviour for a build shipped to a real device.
    expect(resolveApiBaseUrl(undefined, 'production')).toBe('');
    expect(resolveApiBaseUrl('', 'production')).toBe('');
    expect(resolveApiBaseUrl('   ', 'production')).toBe('');
  });

  it('still offers the emulator fallback outside production', () => {
    expect(resolveApiBaseUrl(undefined, 'development')).toBe(LOCAL_DEVELOPMENT_BASE_URL);
    // An unset NODE_ENV is a development context, not a production one: only the explicit value
    // 'production' withdraws the fallback, so a misconfigured build fails open rather than shipping
    // a build that cannot reach anything at all.
    expect(resolveApiBaseUrl(undefined, undefined)).toBe(LOCAL_DEVELOPMENT_BASE_URL);
  });

  it('strips a trailing slash so paths are not doubled', () => {
    expect(resolveApiBaseUrl('https://api.monienaija.ng/', 'production')).toBe(
      'https://api.monienaija.ng',
    );
  });

  it('never returns the loopback address for a production build', () => {
    // The whole point, stated as a single assertion over the space of inputs a build could produce.
    for (const configured of [undefined, '', '  ', 'https://api.monienaija.ng', 'https://x.ng/']) {
      const resolved = resolveApiBaseUrl(configured, 'production');
      expect(resolved).not.toContain('10.0.2.2');
      expect(resolved).not.toMatch(/127\.0\.0\.1|localhost/);
    }
  });

  it('exports a base URL that matches what the resolver decides for this build', () => {
    // Guards against the exported constants drifting away from the resolver: whatever this test
    // process's environment is, the two must agree.
    const expected = resolveApiBaseUrl(
      process.env.EXPO_PUBLIC_API_URL,
      process.env.NODE_ENV,
    );
    expect(DEFAULT_BASE_URL).toBe(expected);
  });
});
