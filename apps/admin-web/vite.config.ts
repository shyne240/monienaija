import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { resolveAdminBuildConfig } from './src/config/build-config';

export default defineConfig(({ mode }) => {
  const { apiBaseUrl, devAuthMock } = resolveAdminBuildConfig(mode, process.env);

  return {
    plugins: [react()],
    define: {
      __ADMIN_API_BASE_URL__: JSON.stringify(apiBaseUrl),
      __ADMIN_DEV_AUTH_MOCK__: JSON.stringify(devAuthMock),
    },
    server: {
      port: 5173,
      host: '0.0.0.0', // Bind to 0.0.0.0 as required by Agent preview configurations
    },
    build: {
      outDir: 'dist',
    },
  };
});
