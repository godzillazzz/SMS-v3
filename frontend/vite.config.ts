import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    // Keep API-client unit tests independent from ignored developer .env files.
    env: { VITE_API_BASE_URL: '/api/v1' }
  }
});
