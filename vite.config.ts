import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const isElectron = !!process.env.ELECTRON_BUILD;
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: './',
  clearScreen: false,
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
  plugins: [
    react(),
    tailwind(),
    !isElectron &&
      !isTauri &&
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
