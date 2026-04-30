import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import LoadingSpinner from './LoadingSpinner'

const ProtectedRoute = ({ children }) => {
  const { user, initialized } = useAuthStore()
  const location = useLocation()

  if (!initialized) return <LoadingSpinner />

  if (!user) {
    const next = `${location.pathname}${location.search}${location.hash}`
    const params = new URLSearchParams()
    if (next && next !== '/login') {
      params.set('next', next)
    }

    return <Navigate to={params.toString() ? `/login?${params.toString()}` : '/login'} replace />
  }

  // children biasanya <RoleGate />
  if (children) {
    return <>{children}</>
  }

  return <Outlet />
}

export default ProtectedRoute
