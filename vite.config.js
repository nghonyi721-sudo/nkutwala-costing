import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The version shown on the login page: package.json's version and the
// commit it was built from (Vercel's, or the local git checkout's), e.g.
// "1.0.0 · f86889e".
function appVersion() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      commit = ''
    }
  }
  return commit ? `${version} · ${commit}` : version
}

// The launch screen (index.html, #splash) must appear as soon as the page
// arrives. Stylesheets in <head> hold back ALL drawing until they've
// downloaded, so the app's own stylesheets are moved to the end of <body>,
// after the launch screen. The app's code still waits for them before it
// runs, so the app never appears unstyled.
function stylesAfterSplash() {
  return {
    name: 'styles-after-splash',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const links = html.match(/<link rel="stylesheet"[^>]*>/g) ?? []
        if (links.length === 0) return html
        const rest = links.reduce((page, link) => page.replace(link, ''), html)
        return rest.replace('</body>', `  ${links.join('\n    ')}\n  </body>`)
      },
    },
  }
}

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
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  plugins: [
    react(),
    recordStartPageFiles(),
    stylesAfterSplash(),
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
        // The same near-white as the launch screen (index.html, #splash) and the
        // app's background, so opening the installed app has no colour flash.
        theme_color: '#F2F2F7',
        background_color: '#F2F2F7',
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
