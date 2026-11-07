import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.jpg'],
      manifest: {
        id: '/',
        name: 'Antojitos Velázquez',
        short_name: 'Antojitos',
        description: 'Pide en línea y punto de venta de Antojitos Velázquez',
        lang: 'es-MX',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        categories: ['food', 'shopping'],
        dir: 'ltr',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // guarda TODA la app (incluido el POS) para que abra sin internet
        globPatterns: ['**/*.{js,css,html,jpg,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/\.well-known\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'fuentes', expiration: { maxEntries: 10, maxAgeSeconds: 31536000 } } },
        ],
      },
    }),
  ],
})
