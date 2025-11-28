// src/App.jsx
import React from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import AppRoutes from './router'
import { useAuthStore } from './store/useAuthStore'

const AUTH_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password'
]

const App = () => {
  const location = useLocation()
  const { user } = useAuthStore()

  const isAuthPage = AUTH_PATHS.some((p) =>
    location.pathname.startsWith(p)
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Halaman dengan navbar (hanya kalau bukan halaman auth DAN user sudah login) */}
      {!isAuthPage && user ? (
        <div className="flex min-h-screen">
          <Navbar />
          <main className="flex-1 w-full overflow-auto py-4">
            <div className="w-full h-full px-2 sm:px-4 lg:px-6">
              <div className="w-full bg-white min-h-full rounded-lg shadow-sm">
                <AppRoutes />
              </div>
            </div>
          </main>
        </div>
      ) : (
        // Layout polos untuk login / register / forgot-password / reset-password
        <main className="w-full min-h-screen">
          <div className="w-full h-full p-0">
            <div className="w-full bg-white min-h-screen">
              <AppRoutes />
            </div>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
