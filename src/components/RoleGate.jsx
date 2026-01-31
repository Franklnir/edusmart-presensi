import React, { useEffect, useRef } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import LoadingSpinner from './LoadingSpinner'
import { getRoleHome, isValidRole } from '../utils/role'

const RoleGate = ({ allow = [] }) => {
  const { user, profile, initialized, isLoading, refreshProfile } = useAuthStore()
  const attemptedRef = useRef(false)
  const role = profile?.role

  useEffect(() => {
    if (initialized && user && !profile && !attemptedRef.current) {
      attemptedRef.current = true
      refreshProfile?.()
    }
    if (!user) attemptedRef.current = false
  }, [initialized, user, profile, refreshProfile])

  if (!initialized || isLoading) return <LoadingSpinner />

  if (!user) return <Navigate to="/login" replace />

  if (!profile) return <LoadingSpinner />

  if (!isValidRole(role)) return <Navigate to="/login" replace />

  if (allow.length && !allow.includes(role)) {
    return <Navigate to={getRoleHome(role)} replace />
  }

  return <Outlet />
}

export default RoleGate
