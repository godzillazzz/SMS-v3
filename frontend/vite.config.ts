import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { isG06DeviceContextDiagnosticBuild } from './src/lib/g06-device-context-diagnostic-route';
const enableG06DeviceContextDiagnostic = isG06DeviceContextDiagnosticBuild(process.env.VERCEL, process.env.VERCEL_ENV);

export default defineConfig({
  define: {
    __SMSV3_G06_DEVICE_CONTEXT_DIAGNOSTIC__: JSON.stringify(enableG06DeviceContextDiagnostic),
    'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV || '')
  },
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/components/layout/')) return 'layout-components';
          // Keep the initial accessible loader available without enlarging the application entry.
          if (id.endsWith('/components/AppLoader.tsx')) return 'app-loader';
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
