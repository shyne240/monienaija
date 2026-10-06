import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0', // Bind to 0.0.0.0 as required by Agent preview configurations
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
