import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import Toast from './components/Toast'
import { queryClient } from './lib/queryClient'
import { AcademicContextProvider } from './context/AcademicContext'
import { installGlobalFrontendErrorReporter } from './lib/observability/frontendErrorReporter'

// Register PWA Service Worker
import { registerSW } from 'virtual:pwa-register'
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    registration?.update?.().catch(() => {})
  },
  onNeedRefresh() {
    updateSW(true)
  }
})

installGlobalFrontendErrorReporter()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AcademicContextProvider>
          <App />
          <Toast />
        </AcademicContextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
