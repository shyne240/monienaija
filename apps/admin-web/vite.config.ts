import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    },
  },
  build: {
    outDir: 'dist',
  },
  define: {
    // V1-RELEASE-01: injected from the deployer's real build-time environment so
    // production bundles never fall back to a hardcoded localhost API URL. See
    // src/config/index.ts for the production-safe default when this is unset.
    'process.env.ADMIN_WEB_API_BASE_URL': JSON.stringify(
      process.env.ADMIN_WEB_API_BASE_URL ?? '',
    ),
  },
});
