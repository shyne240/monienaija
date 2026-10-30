import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { resolveAdminBuildConfig } from './src/config/build-config';

const appRoot = __dirname;

/**
 * INTEGRATION (integration/main-backend-frontend-20261030): the Admin Web lead's reviewed union
 * (docs/design-discovery-20261029/m1/acceptance/integration-prep.md §1 row 3, branch
 * arena/d4ef0b81-monienaija @ 4dd4e3ec):
 *
 *   - from this branch: the `admin-web-shared-deps` resolver plugin, `host: 0.0.0.0`,
 *     `allowedHosts: true` (the sandbox's proxied preview host, e.g. *.e2b.app) and the `/api`
 *     dev-server proxy that removes the cross-origin "Failed to fetch" on the login screen;
 *   - from main (39a9e504): the `define` block driven by `resolveAdminBuildConfig`, which injects
 *     `__ADMIN_API_BASE_URL__` / `__ADMIN_DEV_AUTH_MOCK__` at build time. This is what makes
 *     `src/config/index.ts` fail closed in a production bundle and what keeps `DEV_AUTH_MOCK`
 *     unreachable unless a development build explicitly opts in;
 *   - plus a development-only `/api/v1` proxy fallback, so a same-origin dev bundle still reaches
 *     the backend. It is registered only when `mode === 'development'`: a production build gets no
 *     proxy at all, so the shipped bundle keeps main's fail-closed posture (verified by the Admin
 *     Web lead with `vite build`: 0 occurrences of `/api/v1` in the bundle when no
 *     `ADMIN_WEB_API_BASE_URL` is configured).
 */
export default defineConfig(({ mode }) => {
  const { apiBaseUrl, devAuthMock } = resolveAdminBuildConfig(mode, process.env);

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
      // V1-RELEASE-01: still injected for any code path that reads the raw environment value.
      'process.env.ADMIN_WEB_API_BASE_URL': JSON.stringify(
        process.env.ADMIN_WEB_API_BASE_URL ?? '',
      ),
    },
    server: {
      port: 5173,
      host: '0.0.0.0', // Bind to 0.0.0.0 as required by Agent preview configurations
      allowedHosts: true, // Permit the sandbox's proxied preview host (e.g. *.e2b.app)
      // V1-ADMIN-LOCAL-LOGIN-01: root cause of the "Failed to fetch" errors on the login
      // screen. The backend (http://localhost:3000) and this dev server
      // (http://localhost:5173) are different origins, and src/main.ts never calls
      // app.enableCors() (by design — production fronts both behind the same reverse-proxy
      // origin, see src/config/index.ts). A browser fetch() from 5173 to 3000 is therefore a
      // genuine cross-origin request with no CORS headers on the response, which the browser
      // blocks before admin-web ever sees a real HTTP status — surfacing only as the generic
      // TypeError "Failed to fetch". Proxying API calls through this dev server (so the
      // browser only ever talks to its own origin) fixes this without adding any backend CORS
      // configuration, matching the same "deployed behind one origin" model production uses.
      proxy: {
        '/api': {
          target: process.env.ADMIN_WEB_DEV_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
        // Development-only fallback for a same-origin `/api/v1` dev bundle (see the header note).
        ...(mode === 'development'
          ? {
              '/api/v1': {
                target: process.env.ADMIN_WEB_DEV_PROXY_TARGET || 'http://localhost:3000',
                changeOrigin: true,
              },
            }
          : {}),
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
