/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mockApi } from './mock/mockApi';

/**
 * The app is deployed under /optionbuilder/ next to its PHP backend in
 * /optionbuilder/api/. Every URL in the app derives from BASE_URL, so moving
 * the deployment is a one-line change here.
 *
 * Dev modes:
 *   npm run dev       → proxies /optionbuilder/api to VITE_API_PROXY
 *                       (default http://localhost:8080, e.g. `php -S` on ../)
 *   npm run dev:mock  → serves recorded market data, no backend or broker needed
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = '/optionbuilder/';
  const useMock = mode === 'mock';

  return {
    base,
    plugins: [react(), tailwindcss(), ...(useMock ? [mockApi(base)] : [])],
    server: {
      port: 5173,
      proxy: useMock
        ? undefined
        : {
            [`${base}api`]: {
              target: env.VITE_API_PROXY || 'http://localhost:8080',
              changeOrigin: true,
            },
          },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // React changes far less often than the app — cache it separately.
          manualChunks: (id) => (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
