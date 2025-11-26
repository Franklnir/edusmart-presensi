// src/routes/RoleRoute.jsx
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'

/**
 * Contoh:
 * <RoleRoute allow={['admin']}>
 *   <AdminLayout />
 * </RoleRoute>
 */
export function RoleRoute({ children, allow }) {
  const { profile, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Mengecek role...
      </div>
    )
  }

  if (!profile || !allow.includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  return children
}
