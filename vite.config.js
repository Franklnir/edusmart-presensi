import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    // Let Rollup/Vite decide chunk graph automatically to avoid
    // circular vendor chunk initialization issues in production.
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  }
})
