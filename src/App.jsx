// src/App.jsx
import React from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import AppRoutes from './router'
import { useAuthStore } from './store/useAuthStore'

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']

const App = () => {
  const location = useLocation()
  const { user } = useAuthStore()

  const isAuthPage = AUTH_PATHS.some((p) => location.pathname.startsWith(p))

  // Layout untuk halaman auth (login, register, dll)
  if (isAuthPage || !user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="w-full min-h-screen">
          <div className="w-full h-full">
            {/* biarkan halaman auth yang atur background/warna sendiri */}
            <AppRoutes />
          </div>
        </main>
      </div>
    )
  }

  // Layout setelah login (ada navbar)
  return (
    <div className="min-h-screen bg-gray-50">
      {/* HP = kolom (navbar di atas), md+ = baris (navbar di samping) */}
      <div className="flex min-h-screen flex-col md:flex-row">
        <Navbar />

        <main className="flex-1 w-full overflow-auto py-4">
          <div className="w-full h-full px-2 sm:px-4 lg:px-6">
            <div className="w-full bg-white min-h-full rounded-lg shadow-sm">
              <AppRoutes />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
