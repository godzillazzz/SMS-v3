import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Keep API-client unit tests independent from ignored developer .env files.
    env: { VITE_API_BASE_URL: '/api/v1' }
  }
});
