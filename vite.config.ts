import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import packageJson from './package.json';

function normalizeBasePath(path: string) {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const basePath = normalizeBasePath(env.PUBLIC_BASE ?? env.VITE_PUBLIC_BASE ?? '/gamb_rhid/');
  const buildTime = new Date().toISOString();
  const apiPort = env.API_PORT || '8787';

  return {
    base: basePath,
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
    server: {
      host: env.HOST || '0.0.0.0',
      port: Number(env.PORT || 3000),
      allowedHosts: true,
      hmr: env.DISABLE_HMR === 'true' ? false : undefined,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
    plugins: [
      react(),
      {
        name: 'redirect-base-alias',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const requestWithUrl = req as { url?: string };
            if (requestWithUrl.url && (requestWithUrl.url.startsWith('/gamb_rhid') || requestWithUrl.url.startsWith('/gambrhid'))) {
              requestWithUrl.url = requestWithUrl.url.replace(/^\/gamb_?rhid/, '') || '/';
            }
            next();
          });
        },
      },
    ],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.{js,mjs,ts}'],
      env: {
        TZ: 'America/Sao_Paulo',
      },
    },
  };
});
