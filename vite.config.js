import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The files the start page loads - the entry chunk, every chunk it imports
// directly, and their CSS - read from the build itself. Only these (plus
// index.html and the icons) are saved on the phone when the app installs:
// site managers never download owner screens, the charts or ExcelJS. Other
// screens are cached the first time they're opened (runtimeCaching below).
const startPageFiles = new Set()

function recordStartPageFiles() {
  return {
    name: 'nkutwala:start-page-files',
    apply: 'build',
    generateBundle(_options, bundle) {
      startPageFiles.clear()
      const visit = (fileName) => {
        const chunk = bundle[fileName]
        if (startPageFiles.has(fileName) || chunk?.type !== 'chunk') return
        startPageFiles.add(fileName)
        for (const css of chunk.viteMetadata?.importedCss ?? []) startPageFiles.add(css)
        for (const imported of chunk.imports) visit(imported)
      }
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    recordStartPageFiles(),
    // Installable app (PWA). NEVER caches Supabase: its API, login, storage
    // and photo links are on Supabase's own address and no rule below
    // matches it - those requests always go straight to the network.
    VitePWA({
      // A new version installs in the background and is used the next time
      // the app is opened - never a reload in the middle of a form.
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      // The icons are already in globPatterns (and the plugin adds the
      // manifest itself) - listed once each.
      includeManifestIcons: false,
      manifest: {
        name: 'Nkutwala Site Reports',
        short_name: 'Nkutwala',
        description: 'Daily site reports and job costing for Nkutwala Construction.',
        theme_color: '#1F4FBF',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell only: HTML, JS, CSS, icons, images (and fonts, if
        // the app ever gets any) - narrowed to the start page's files below.
        globPatterns: ['**/*.{html,js,css,svg,png,jpeg,ico,woff2}'],
        manifestTransforms: [
          async (entries) => {
            if (startPageFiles.size === 0) throw new Error('The start page files were not recorded - check recordStartPageFiles().')
            return {
              manifest: entries.filter((entry) => !entry.url.startsWith('assets/') || startPageFiles.has(entry.url)),
              warnings: [],
            }
          },
        ],
        // Refreshing any page (e.g. /dashboard), even offline: the app.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Look after the open page from the first visit (not only the next).
        clientsClaim: true,
        runtimeCaching: [
          {
            // Screens, the charts and ExcelJS: cached the first time they're
            // opened. Our own /assets/ only (their names change with every
            // build, so a cached copy is never out of date).
            urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-chunks',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // The two libraries every screen needs get chunks of their own: they
        // download alongside the app and stay cached on the phone when the app
        // is updated. Matched by exact package name, so the chart library
        // (recharts) and ExcelJS are never pulled into the first download -
        // they're only reached through import() (see CLAUDE.md, Bundling).
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /[\\/]node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
})
