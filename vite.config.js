import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const normalizeChunkId = (id) => id.split('\\').join('/')

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'],
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
          const normalized = normalizeChunkId(id)

          if (normalized.includes('/src/pages/admin/')) {
            return 'admin-panel'
          }

          if (normalized.includes('/src/pages/super/')) {
            return 'super-panel'
          }

          if (normalized.includes('/src/pages/guru/')) {
            return 'guru-panel'
          }

          if (normalized.includes('/src/pages/siswa/')) {
            return 'siswa-panel'
          }
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
