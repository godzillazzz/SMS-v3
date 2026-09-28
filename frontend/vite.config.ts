import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react-vendor';
          if (id.includes('/node_modules/@simplewebauthn/')) return 'webauthn-vendor';
          return undefined;
        }
      }
    }
  },
  test: {
    // Keep API-client unit tests independent from ignored developer .env files.
    env: { VITE_API_BASE_URL: '/api/v1' }
  }
});
