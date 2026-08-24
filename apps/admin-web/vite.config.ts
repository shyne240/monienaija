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
});
