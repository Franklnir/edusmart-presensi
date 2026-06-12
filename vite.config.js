import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeChunkId = (id) => id.split('\\').join('/')

export default defineConfig({
  plugins: [react()],
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
