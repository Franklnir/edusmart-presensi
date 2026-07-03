import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'],
      workbox: {
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/sanctum(?:\/|$)/,
          /^\/auth(?:\/|$)/,
          /^\/login(?:\/|$|\?)/,
          /^\/logout(?:\/|$)/
        ],
        globIgnores: [
          '**/pdf.worker-*.mjs',
          '**/vendor-pdf-*.js'
        ]
      },
      manifest: {
        name: 'Edusmart Presensi',
        short_name: 'Edusmart',
        description: 'Sistem Informasi Presensi dan Akademik Sekolah',
        theme_color: '#059669',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.nip.io'],
    watch: {
      ignored: [
        '**/.local/**',
        '**/backend/storage/**',
        '**/backend/vendor/**'
      ]
    }
  },
  build: {
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'vendor-pdf-preview'
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf-export'
          if (id.includes('react-window')) return 'vendor-virtual-list'
          return undefined
        }
      }
    },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  }
})
