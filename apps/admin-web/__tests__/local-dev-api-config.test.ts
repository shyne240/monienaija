/**
 * @jest-environment node
 */
import viteConfigFactory from '../vite.config';
import {
  isLoopbackApiBaseUrl,
  LOCAL_DEV_DEFAULT_API_BASE_URL,
  LOCAL_DEV_DEFAULT_PROXY_TARGET,
  resolveAdminBuildConfig,
  resolveAdminDevServerProxy,
} from '../src/config/build-config';

describe('Defect AW-01 — Admin Web local development API configuration & production safety', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_WEB_API_BASE_URL;
    delete process.env.ADMIN_WEB_DEV_PROXY_TARGET;
    delete process.env.ADMIN_WEB_DEV_AUTH_MOCK;
    delete (globalThis as Record<string, unknown>).__ADMIN_API_BASE_URL__;
    delete (globalThis as Record<string, unknown>).__ADMIN_DEV_AUTH_MOCK__;
  });

  afterAll(() => {
    process.env = originalEnv;
    delete (globalThis as Record<string, unknown>).__ADMIN_API_BASE_URL__;
    delete (globalThis as Record<string, unknown>).__ADMIN_DEV_AUTH_MOCK__;
  });

  describe('resolveAdminBuildConfig', () => {
    it('defaults unset ADMIN_WEB_API_BASE_URL to /api/v1 during local Vite dev serve', () => {
      expect(resolveAdminBuildConfig('development', {}, { command: 'serve' })).toEqual({
        apiBaseUrl: LOCAL_DEV_DEFAULT_API_BASE_URL,
        devAuthMock: false,
      });
      expect(
        resolveAdminBuildConfig('development', { ADMIN_WEB_API_BASE_URL: '   ' }, { command: 'serve' }),
      ).toEqual({
        apiBaseUrl: '/api/v1',
        devAuthMock: false,
      });
    });

    it('preserves explicit ADMIN_WEB_API_BASE_URL in both development and production', () => {
      expect(
        resolveAdminBuildConfig(
          'development',
          { ADMIN_WEB_API_BASE_URL: 'https://staging-admin.monienaija.example/api/v1/' },
          { command: 'serve' },
        ),
      ).toEqual({
        apiBaseUrl: 'https://staging-admin.monienaija.example/api/v1',
        devAuthMock: false,
      });

      expect(
        resolveAdminBuildConfig(
          'production',
          { ADMIN_WEB_API_BASE_URL: 'https://admin-api.monienaija.example/api/v1/' },
          { command: 'build' },
        ),
      ).toEqual({
        apiBaseUrl: 'https://admin-api.monienaija.example/api/v1',
        devAuthMock: false,
      });

      expect(
        resolveAdminBuildConfig('production', { ADMIN_WEB_API_BASE_URL: '/api/v1' }, { command: 'build' }),
      ).toEqual({
        apiBaseUrl: '/api/v1',
        devAuthMock: false,
      });
    });

    it('fails closed (empty string) for static bundle builds and non-development modes when unset', () => {
      expect(resolveAdminBuildConfig('production', {}, { command: 'build' }).apiBaseUrl).toBe('');
      expect(resolveAdminBuildConfig('staging', {}, { command: 'build' }).apiBaseUrl).toBe('');
      expect(resolveAdminBuildConfig('development', {}, { command: 'build' }).apiBaseUrl).toBe('');
      expect(
        resolveAdminBuildConfig('development', { NODE_ENV: 'production' }, { command: 'serve' })
          .apiBaseUrl,
      ).toBe('');
    });

    it.each([
      'http://localhost:3000/api/v1',
      'https://admin.localhost/api/v1',
      'http://127.0.0.1:3000/api/v1',
      'http://127.0.1.1:3000/api/v1',
      'http://[::1]:3000/api/v1',
      'http://0.0.0.0:3000/api/v1',
      '//localhost:3000/api/v1',
      'localhost:3000/api/v1',
    ])('rejects loopback URL %s in production and static bundle builds', (loopbackUrl) => {
      expect(isLoopbackApiBaseUrl(loopbackUrl)).toBe(true);
      expect(() =>
        resolveAdminBuildConfig(
          'production',
          { ADMIN_WEB_API_BASE_URL: loopbackUrl },
          { command: 'build' },
        ),
      ).toThrow(/Refusing to configure loopback ADMIN_WEB_API_BASE_URL/);
      expect(() =>
        resolveAdminBuildConfig(
          'development',
          { ADMIN_WEB_API_BASE_URL: loopbackUrl },
          { command: 'build' },
        ),
      ).toThrow(/Refusing to configure loopback ADMIN_WEB_API_BASE_URL/);
    });
  });

  describe('resolveAdminDevServerProxy & vite.config.ts integration', () => {
    it('configures Vite dev server define + local backend proxy when ADMIN_WEB_API_BASE_URL is unset', () => {
      delete process.env.NODE_ENV;
      const config =
        typeof viteConfigFactory === 'function'
          ? viteConfigFactory({ command: 'serve', mode: 'development' })
          : viteConfigFactory;

      expect(config.define?.__ADMIN_API_BASE_URL__).toBe(JSON.stringify('/api/v1'));
      expect(config.define?.['process.env.ADMIN_WEB_API_BASE_URL']).toBe(JSON.stringify('/api/v1'));
      expect(config.define?.__ADMIN_DEV_AUTH_MOCK__).toBe(JSON.stringify(false));
      expect(config.server?.proxy).toEqual({
        '/api/v1': {
          target: LOCAL_DEV_DEFAULT_PROXY_TARGET,
          changeOrigin: true,
        },
        '/api': {
          target: LOCAL_DEV_DEFAULT_PROXY_TARGET,
          changeOrigin: true,
        },
      });
    });

    it('honours ADMIN_WEB_DEV_PROXY_TARGET override in local development', () => {
      expect(
        resolveAdminDevServerProxy(
          'development',
          { ADMIN_WEB_DEV_PROXY_TARGET: 'http://127.0.0.1:4100/' },
          { command: 'serve' },
        ),
      ).toEqual({
        '/api/v1': {
          target: 'http://127.0.0.1:4100',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://127.0.0.1:4100',
          changeOrigin: true,
        },
      });
    });

    it('injects empty string and omits local proxy in unconfigured production Vite builds', () => {
      const config =
        typeof viteConfigFactory === 'function'
          ? viteConfigFactory({ command: 'build', mode: 'production' })
          : viteConfigFactory;

      expect(config.define?.__ADMIN_API_BASE_URL__).toBe(JSON.stringify(''));
      expect(config.define?.['process.env.ADMIN_WEB_API_BASE_URL']).toBe(JSON.stringify(''));
      expect(config.define?.__ADMIN_DEV_AUTH_MOCK__).toBe(JSON.stringify(false));
      expect(config.server?.proxy).toBeUndefined();
    });
  });

  describe('runtime config + ApiClient request routing', () => {
    beforeEach(() => {
      Object.defineProperty(global, 'localStorage', {
        value: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
          clear: () => undefined,
        },
        writable: true,
      });
    });

    it('routes login requests to same-origin /api/v1/... when Vite dev injects the local fallback', async () => {
      (globalThis as Record<string, unknown>).__ADMIN_API_BASE_URL__ = '/api/v1';
      (globalThis as Record<string, unknown>).__ADMIN_DEV_AUTH_MOCK__ = false;

      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({ accessToken: 'tok-1' }),
      });
      Object.defineProperty(global, 'fetch', { value: fetchSpy, writable: true });

      let resolvedUrl = '';
      await new Promise<void>((resolve, reject) => {
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { API_BASE_URL } = require('../src/config');
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ApiClient } = require('../src/services/api-client');
          resolvedUrl = API_BASE_URL;
          ApiClient.post('/internal/a2/workforce/local-admin-sessions', {
            email: 'admin@monienaija.local',
            password: 'MonieNaijaAdmin123!',
          }).then(() => resolve(), reject);
        });
      });

      expect(resolvedUrl).toBe('/api/v1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/internal/a2/workforce/local-admin-sessions');
    });

    it('refuses loopback ADMIN_WEB_API_BASE_URL at runtime if NODE_ENV=production without Vite define', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_WEB_API_BASE_URL = 'http://localhost:3000/api/v1';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { API_BASE_URL, DEV_AUTH_MOCK } = require('../src/config');
        expect(API_BASE_URL).toBe('');
        expect(DEV_AUTH_MOCK).toBe(false);
      });
    });
  });
});
