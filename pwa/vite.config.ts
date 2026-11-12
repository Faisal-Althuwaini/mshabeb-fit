import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in main.tsx
      injectManifest: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'] },
      manifest: {
        name: 'مشبب',
        short_name: 'مشبب',
        description: 'مدربك الشخصي للنزول: وزن يومي، متوسط أسبوعي، وصاحب يتابعك.',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0e0e0d',
        background_color: '#0e0e0d',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  // shared/stats.mjs lives one level up (the same file the bot uses)
  server: { fs: { allow: ['..'] }, port: 5173 },
});
