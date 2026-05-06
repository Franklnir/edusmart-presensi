import React, { useEffect, useRef } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import LoadingSpinner from './LoadingSpinner'
import { getRoleHome, isValidRole } from '../utils/role'
import { shouldForceAccountSetup } from '../utils/accountSetup'

const RoleGate = ({ allow = [] }) => {
  const { user, profile, initialized, isLoading, refreshProfile, isSuperAdmin, superAdminChecked } =
    useAuthStore()
  const attemptedRef = useRef(false)
  const location = useLocation()
  const role = profile?.role
  const nextPath = `${location.pathname}${location.search}${location.hash}`
  const loginParams = new URLSearchParams()
  if (nextPath && nextPath !== '/login') {
    loginParams.set('next', nextPath)
  }
  const loginTarget = loginParams.toString() ? `/login?${loginParams.toString()}` : '/login'

  const canBypassAdmin = allow.includes('admin') && isSuperAdmin
  const needsSuperAdminCheck = allow.includes('admin') && role !== 'admin' && !superAdminChecked
  const needsAccountSetup = shouldForceAccountSetup(profile, user?.email)

  useEffect(() => {
    if (initialized && user && !profile && !attemptedRef.current) {
      attemptedRef.current = true
      refreshProfile?.()
    }
    if (!user) attemptedRef.current = false
  }, [initialized, user, profile, refreshProfile])

  if (!initialized || isLoading || needsSuperAdminCheck) {
    return <LoadingSpinner />
  }

  if (!user) return <Navigate to={loginTarget} replace />

  if (!profile) return <LoadingSpinner />

  if (!isValidRole(role)) return <Navigate to={loginTarget} replace />

  if (needsAccountSetup && !canBypassAdmin) {
    const target = role === 'siswa' ? '/siswa/profile' : '/guru/profile'
    if (!location.pathname.startsWith(target)) {
      return <Navigate to={target} replace />
    }
  }

  if (canBypassAdmin) {
    return <Outlet />
  }

  if (allow.length && !allow.includes(role)) {
    return <Navigate to={getRoleHome(role)} replace />
  }

  return <Outlet />
}

export default RoleGate
