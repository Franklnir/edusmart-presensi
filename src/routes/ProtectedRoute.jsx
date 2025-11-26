// src/routes/ProtectedRoute.jsx
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'

export function ProtectedRoute({ children }) {
  const { authUser, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Mengecek sesi...
      </div>
    )
  }

  if (!authUser) {
    return <Navigate to="/auth/login" replace />
  }

  return children
}
