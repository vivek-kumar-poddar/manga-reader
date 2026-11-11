import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);
const isDesktop = process.env.VITE_TARGET === 'desktop' || isTauri;
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: './',
  clearScreen: false,
  define: {
    __DESKTOP_BUILD__: JSON.stringify(isDesktop),
  },
  resolve: {
    alias: isDesktop
      ? [
          {
            find: /^\.\/storage$/,
            replacement: path.resolve(__dirname, 'src/desktop/storage.ts'),
          },
          {
            find: /^\.\/importScan$/,
            replacement: path.resolve(__dirname, 'src/desktop/importScan.ts'),
          },
          {
            find: /^\.\/validation$/,
            replacement: path.resolve(__dirname, 'src/desktop/validation.ts'),
          },
        ]
      : [],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5183,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/') ||
              id.includes('\\node_modules\\react\\') ||
              id.includes('\\node_modules\\react-dom\\') ||
              id.includes('\\node_modules\\scheduler\\')
            ) {
              return 'vendor-react';
            }
            if (id.includes('react-router') || id.includes('@remix-run/router')) {
              return 'vendor-router';
            }
            if (id.includes('@radix-ui') || id.includes('@floating-ui')) {
              return 'vendor-ui';
            }
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwind(),
    process.env.ANALYZE
      ? ({
          name: 'bundle-visualizer',
          generateBundle(_options, bundle) {
            console.log('\n=== BUNDLE ANALYSIS ===');
            for (const [name, file] of Object.entries(bundle)) {
              if (file.type === 'chunk') {
                const modSummary: Record<string, number> = {};
                for (const [id, mod] of Object.entries(file.modules)) {
                  let pkg = 'app: ' + id.replace(/.*\/src\//, 'src/');
                  const nmIdx = id.indexOf('node_modules/');
                  if (nmIdx >= 0) {
                    const sub = id.slice(nmIdx + 'node_modules/'.length);
                    pkg = sub.startsWith('@')
                      ? sub.split('/').slice(0, 2).join('/')
                      : sub.split('/')[0];
                  }
                  const len = mod.renderedLength || 0;
                  modSummary[pkg] = (modSummary[pkg] || 0) + len;
                }
                console.log(`\nChunk: ${name} (${(file.code.length / 1024).toFixed(2)} KB)`);
                const sorted = Object.entries(modSummary).sort((a, b) => b[1] - a[1]);
                for (const [pkg, bytes] of sorted.slice(0, 10)) {
                  console.log(`  - ${pkg.padEnd(30)} ${(bytes / 1024).toFixed(2)} KB`);
                }
              }
            }
          },
        } as Plugin)
      : null,
    !isDesktop &&
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Manga Reader',
          short_name: 'Reader',
          theme_color: '#fafafa',
          background_color: '#fafafa',
          display: 'standalone',
          start_url: './',
        },
        workbox: {
          skipWaiting: false,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,html,woff2}'],
          // Always boot Reader for chapter navigations, including denied access.
          // A network 200 can be the parent site's fallback HTML, not our app.
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /\/assets\//,
            /\/[^/?]+\.[^/]+$/,
            // The widened hosted scope must not serve Reader for sibling apps.
            /\/manga-reader[^/?#]/,
          ],
          maximumFileSizeToCacheInBytes: 4000000,
        },
      }),
  ].filter(Boolean),
});
