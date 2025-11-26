import React from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'

const RoleGate = ({ allow = [] }) => {
  const { profile } = useAuthStore()
  const role = profile?.role

  if (!role || (allow.length && !allow.includes(role))) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

export default RoleGate
