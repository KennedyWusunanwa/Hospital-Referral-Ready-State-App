// `defineConfig` comes from vitest, not vite: it is the overload that accepts
// the `test` block below. Importing it from 'vite' fails `tsc -b`, which the
// build script runs before bundling, so it would break the deploy rather than
// just the editor.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': a clinician mid-referral should not
      // have the page swapped under them. `PWAUpdatePrompt` offers the reload.
      registerType: 'prompt',
      // Registration happens in `usePWA`, so the virtual module stays the one
      // source of truth for update state.
      injectRegister: null,
      includeAssets: [
        'favicon.ico',
        'favicon-32.png',
        'favicon-16.png',
        'apple-touch-icon.png',
        'robots.txt',
      ],
      manifest: {
        id: '/',
        name: 'FERN - Referral Ready State',
        short_name: 'FERN',
        description:
          'Hospital emergency readiness and inter-hospital referral coordination for Ghana.',
        theme_color: '#1b5cf5',
        background_color: '#f8fafc',
        display: 'standalone',
        // On desktop (Windows, macOS, ChromeOS) take over the title bar so the
        // installed window looks like a native app; the app pads its own
        // chrome below the OS buttons (see .wco-titlebar in index.css).
        // Browsers that lack the overlay fall back down the list.
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        // Installed desktop windows are resizable, so no orientation lock --
        // the layout is responsive in both directions.
        orientation: 'any',
        prefer_related_applications: false,
        // Clicking the taskbar icon focuses the open window rather than opening
        // a second copy with its own realtime subscriptions.
        launch_handler: { client_mode: 'navigate-existing' },
        scope: '/',
        start_url: '/',
        lang: 'en',
        dir: 'ltr',
        categories: ['medical', 'health', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'New referral',
            short_name: 'Refer',
            url: '/referrals/new',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Submit readiness',
            short_name: 'Readiness',
            url: '/readiness',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Referrals',
            short_name: 'Referrals',
            url: '/referrals',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // The app is a client-side router, so any unknown path must resolve to
        // the shell rather than a 404 from the cache.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // recharts pushes the largest chunk past the 2 MiB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Stylesheet first: it names the font files the next rule caches.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              // Status 0 keeps opaque cross-origin font responses cacheable.
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Supabase data is deliberately absent: patient and readiness records
        // must never be served from a stale cache in a clinical decision.
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/domain/**'],
    },
  },
})
