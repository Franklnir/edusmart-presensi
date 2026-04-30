// src/App.jsx
import React, { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import AppRoutes from './router'
import { useAuthStore } from './store/useAuthStore'
import { SESSION_EXPIRED_EVENT, supabase } from './lib/supabase'

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']
const buildLoginRedirectPath = ({ reason = '', next = '' } = {}) => {
  const params = new URLSearchParams()
  if (reason) params.set('reason', reason)
  if (next) params.set('next', next)
  const suffix = params.toString()
  return suffix ? `/login?${suffix}` : '/login'
}

const App = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, initialized, init, expireSession } = useAuthStore()
  const deviceIdRef = useRef('')
  const lastPathRef = useRef('')

  const isAuthPage = AUTH_PATHS.some((p) => location.pathname.startsWith(p))
  const isQuizSessionPage = location.pathname.startsWith('/siswa/quiz/session/')

  useEffect(() => {
    if (!initialized) {
      init()
    }
  }, [initialized, init])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleSessionExpired = (event) => {
      const nextPath = isAuthPage
        ? ''
        : `${location.pathname}${location.search}${location.hash}`
      const reason = String(event?.detail?.message || '').trim()

      expireSession(reason || 'Sesi login Anda telah berakhir. Silakan masuk lagi.')
      navigate(
        buildLoginRedirectPath({
          reason: 'session-expired',
          next: nextPath
        }),
        { replace: true }
      )
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
  }, [
    expireSession,
    isAuthPage,
    location.hash,
    location.pathname,
    location.search,
    navigate
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (deviceIdRef.current) return

    const key = 'edusmart_device_id'
    let id = ''
    try {
      id = localStorage.getItem(key) || ''
    } catch { }
    if (!id) {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID()
      } else {
        id = `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
      }
      try { localStorage.setItem(key, id) } catch { }
    }
    deviceIdRef.current = id
  }, [])

  useEffect(() => {
    if (!user?.id) return
    const deviceId = deviceIdRef.current
    if (!deviceId) return

    let stopped = false
    const ping = async (activity = false) => {
      try {
        await supabase.presence.ping({ deviceId, activity })
      } catch (error) {
        if (!stopped) {
          // silent: monitoring bukan fitur kritikal
          console.debug('Presence ping failed:', error)
        }
      }
    }

    ping(true)
    const interval = setInterval(() => ping(false), 30000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    const deviceId = deviceIdRef.current
    if (!deviceId) return
    if (lastPathRef.current === location.pathname) return
    lastPathRef.current = location.pathname

    supabase.presence.ping({ deviceId, activity: true }).catch(() => { })
  }, [location.pathname, user?.id])

  useEffect(() => {
    if (!user?.id) return undefined
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

    const revalidateSession = () => {
      if (document.visibilityState === 'hidden') return
      void supabase.auth.getSession()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidateSession()
      }
    }

    window.addEventListener('focus', revalidateSession)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', revalidateSession)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user?.id])

  // Layout untuk halaman auth (login, register, dll)
  if (isAuthPage || !user) {
    return (
      <div className="min-h-screen bg-slate-50">
        <main className="w-full min-h-screen">
          <AppRoutes />
        </main>
      </div>
    )
  }

  if (isQuizSessionPage) {
    return (
      <div className="min-h-screen bg-slate-100">
        <main className="w-full min-h-screen">
          <AppRoutes />
        </main>
      </div>
    )
  }

  // Layout setelah login (ada navbar)
  return (
    <div className="h-screen bg-slate-50 overflow-hidden">
      <div className="flex h-full flex-col md:flex-row overflow-hidden">
        <Navbar />
        {/* pb-20 untuk mobile bottom nav, tidak mempengaruhi desktop */}
        <main className="flex-1 w-full h-full overflow-y-auto pb-20 md:pb-0">
          <AppRoutes />
        </main>
      </div>
    </div>
  )
}

export default App
