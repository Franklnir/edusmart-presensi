// src/routes/RoleRoute.jsx
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import LoadingSpinner from '../components/LoadingSpinner'
import { getRoleHome, isValidRole } from '../utils/role'

/**
 * Contoh:
 * <RoleRoute allow={['admin']}>
 *   <AdminLayout />
 * </RoleRoute>
 */
export function RoleRoute({ children, allow }) {
  const { user, profile, initialized, isLoading } = useAuthStore()

  if (!initialized || isLoading) return <LoadingSpinner />

  if (!user) return <Navigate to="/login" replace />

  if (!profile || !isValidRole(profile.role)) return <Navigate to="/login" replace />

  if (allow?.length && !allow.includes(profile.role)) {
    return <Navigate to={getRoleHome(profile.role)} replace />
  }

  return children
}
