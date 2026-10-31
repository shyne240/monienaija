import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import {
  resolveAdminBuildConfig,
  resolveAdminDevServerProxy,
} from './src/config/build-config';

const appRoot = __dirname;

/**
 * Admin Web Vite configuration.
 *
 * - `resolveAdminBuildConfig(mode, env, { command })` resolves `__ADMIN_API_BASE_URL__` and
 *   `__ADMIN_DEV_AUTH_MOCK__`:
 *   - `vite` (`command === 'serve'`, `mode === 'development'`): defaults an unset
 *     `ADMIN_WEB_API_BASE_URL` to same-origin `/api/v1` (while preserving any explicit
 *     `ADMIN_WEB_API_BASE_URL`) and attaches the dev-server proxy to the local backend
 *     (`http://127.0.0.1:3000` by default, overridable via `ADMIN_WEB_DEV_PROXY_TARGET`).
 *   - `vite build` (`command === 'build'`): never invents a fallback URL (`''` when unset so
 *     `ApiClient` fails closed, with 0 occurrences of `/api/v1` or `localhost` in the shipped
 *     bundle) and rejects loopback `ADMIN_WEB_API_BASE_URL` values outright.
 */
export default defineConfig(({ command, mode }) => {
  const fileEnv = loadEnv(mode, appRoot, 'ADMIN_WEB_');
  const env: Record<string, string | undefined> = {
    ...fileEnv,
    ...process.env,
  };
  const { apiBaseUrl, devAuthMock } = resolveAdminBuildConfig(mode, env, { command });
  const devServerProxy = resolveAdminDevServerProxy(mode, env, { command });

  return {
    plugins: [
      {
        name: 'admin-web-shared-deps',
        resolveId(source, importer, options) {
          if (
            importer &&
            !importer.startsWith(appRoot) &&
            !source.startsWith('.') &&
            !source.startsWith('\0') &&
            !path.isAbsolute(source)
          ) {
            return this.resolve(source, path.join(appRoot, 'index.html'), {
              ...options,
              skipSelf: true,
            });
          }
          return null;
        },
      },
      react(),
    ],
    define: {
      __ADMIN_API_BASE_URL__: JSON.stringify(apiBaseUrl),
      __ADMIN_DEV_AUTH_MOCK__: JSON.stringify(devAuthMock),
      // Kept consistent with `__ADMIN_API_BASE_URL__` for any code path reading the env value.
      'process.env.ADMIN_WEB_API_BASE_URL': JSON.stringify(apiBaseUrl),
    },
    server: {
      port: 5173,
      host: '0.0.0.0', // Bind to 0.0.0.0 as required by preview and local dev environments
      allowedHosts: true, // Permit proxied preview hosts (e.g. *.e2b.app)
      ...(devServerProxy ? { proxy: devServerProxy } : {}),
    },
    build: {
      outDir: 'dist',
    },
  };
});
