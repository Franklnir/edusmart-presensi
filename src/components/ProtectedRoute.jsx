import React, { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import LoadingSpinner from './LoadingSpinner'

const ProtectedRoute = ({ children }) => {
  const { user, initialized, init } = useAuthStore()

  useEffect(() => {
    if (!initialized) {
      init()
    }
  }, [initialized, init])

  if (!initialized) return <LoadingSpinner />

  if (!user) return <Navigate to="/login" replace />

  // children biasanya <RoleGate />
  if (children) {
    return <>{children}</>
  }

  return <Outlet />
}

export default ProtectedRoute
