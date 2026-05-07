import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        secure: false
      },
      '/sanctum': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        secure: false
      }
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
