import React, { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveDelegatedAdminFeatureFromPath } from '../constants/adminFeaturePermissions'
import LoadingSpinner from './LoadingSpinner'

const DelegatedAdminGate = () => {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const feature = resolveDelegatedAdminFeatureFromPath(location.pathname, location.search)

  useEffect(() => {
    let cancelled = false

    const checkAccess = async () => {
      if (!feature?.key) {
        setAllowed(false)
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const { data, error } = await supabase.admin.delegatedPermissions()
        if (error) throw error
        const features = Array.isArray(data?.features) ? data.features : []
        if (!cancelled) setAllowed(
          features.includes(feature.key) ||
          (feature.parentKey && features.includes(feature.parentKey))
        )
      } catch {
        if (!cancelled) setAllowed(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    checkAccess()

    return () => {
      cancelled = true
    }
  }, [feature?.key, feature?.parentKey])

  if (!feature?.key) return <Navigate to="/guru/jadwal" replace />
  if (loading) return <LoadingSpinner />
  if (allowed) return <Outlet />

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-4">
      <div className="page-card w-full p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-950">Akses Belum Diaktifkan</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          Fitur admin ini belum diaktifkan untuk akun Anda. Hubungi admin sekolah jika memang perlu mengakses halaman ini.
        </p>
      </div>
    </div>
  )
}

export default DelegatedAdminGate
