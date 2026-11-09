import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const isElectron = !!process.env.ELECTRON_BUILD;

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwind(),
    !isElectron &&
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
