// src/App.jsx
import React, { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ConfirmDialog from './components/ConfirmDialog'
import AppBootShell from './components/AppBootShell'
import AppRoutes from './router'
import { useAuthStore } from './store/useAuthStore'
import { SESSION_EXPIRED_EVENT, hasAuthSessionHint, supabase } from './lib/supabase'
import { scheduleRoutePrefetch } from './lib/routePrefetch'
import { isMarketingLandingPath } from './utils/marketingHost'
import {
  DEFAULT_USER_THEME,
  canUseUserTheme,
  normalizeUserTheme
} from './theme/userThemes'

const AUTH_PATHS = ['/login', '/auth/google/popup', '/register', '/forgot-password', '/reset-password']
const ADMIN_PRIORITY_PREFETCH_ROUTES = [
  '/admin/home',
  '/admin/organisasi',
  '/admin/struktur-sekolah',
  '/admin/siswa',
  '/admin/guru'
]
const SESSION_REVALIDATE_INTERVAL_MS = 60 * 1000
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
  const { user, profile, initialized, init, expireSession, isSuperAdmin } = useAuthStore()
  const deviceIdRef = useRef('')
  const lastPathRef = useRef('')
  const lastSessionRevalidateRef = useRef(0)

  const isAuthPage = AUTH_PATHS.some((p) => location.pathname.startsWith(p))
  const isMarketingPage = isMarketingLandingPath(location.pathname)
  const isQuizSessionPage = location.pathname.startsWith('/siswa/quiz/session/')
  const hasGoogleAuthCallback = new URLSearchParams(location.search).has('google')
  const shouldInitAuth = !isMarketingPage &&
    (!isAuthPage || hasAuthSessionHint() || hasGoogleAuthCallback)
  const shouldShowBootShell =
    !initialized &&
    !user &&
    !isAuthPage &&
    !isMarketingPage &&
    hasAuthSessionHint()
  const role = profile?.role || ''
  const canTrackPresence = Boolean(user?.id && profile?.id && !isSuperAdmin && !isMarketingPage)
  const canApplyUserTheme = canUseUserTheme(role)
  const activeTheme = canApplyUserTheme
    ? normalizeUserTheme(profile?.theme_preference)
    : DEFAULT_USER_THEME
  const appShellClassName = [
    'app-shell',
    canApplyUserTheme ? 'app-shell--user-themed' : '',
    canApplyUserTheme ? `edu-theme--${activeTheme}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (typeof document === 'undefined') return

    const { documentElement, body } = document

    documentElement.dataset.userTheme = activeTheme
    documentElement.dataset.userRole = role || 'guest'
    body.dataset.userTheme = activeTheme
    body.dataset.userRole = role || 'guest'

    if (canApplyUserTheme) {
      documentElement.classList.add('app-theme-active')
      body.classList.add('app-theme-active')
    } else {
      documentElement.classList.remove('app-theme-active')
      body.classList.remove('app-theme-active')
    }

    return () => {
      documentElement.classList.remove('app-theme-active')
      body.classList.remove('app-theme-active')
      delete documentElement.dataset.userTheme
      delete documentElement.dataset.userRole
      delete body.dataset.userTheme
      delete body.dataset.userRole
    }
  }, [activeTheme, canApplyUserTheme, role])

  useEffect(() => {
    if (!shouldInitAuth) return
    if (!initialized) {
      init()
    }
  }, [initialized, init, shouldInitAuth])

  useEffect(() => {
    if (!initialized || !user?.id || profile?.role !== 'admin') return undefined

    return scheduleRoutePrefetch(ADMIN_PRIORITY_PREFETCH_ROUTES, {
      max: ADMIN_PRIORITY_PREFETCH_ROUTES.length,
      delay: 900,
      gap: 700,
      timeout: 3500
    })
  }, [initialized, profile?.role, user?.id])

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
    if (!canTrackPresence) return
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

    let timer = null
    const schedulePing = () => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      timer = window.setTimeout(async () => {
        await ping(false)
        if (!stopped) schedulePing()
      }, hidden ? 180000 : 60000)
    }

    ping(true)
    schedulePing()

    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [canTrackPresence])

  useEffect(() => {
    if (!canTrackPresence) return
    const deviceId = deviceIdRef.current
    if (!deviceId) return
    if (lastPathRef.current === location.pathname) return
    lastPathRef.current = location.pathname

    supabase.presence.ping({ deviceId, activity: true }).catch(() => { })
  }, [canTrackPresence, location.pathname])

  useEffect(() => {
    if (!user?.id) return undefined
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

    const revalidateSession = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastSessionRevalidateRef.current < SESSION_REVALIDATE_INTERVAL_MS) return
      lastSessionRevalidateRef.current = now
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

  if (shouldShowBootShell) {
    return (
      <div className={appShellClassName}>
        <AppBootShell />
        <ConfirmDialog />
      </div>
    )
  }

  // Layout untuk halaman publik/auth (landing, login, register, dll)
  if (isMarketingPage || isAuthPage || !user) {
    return (
      <div className={appShellClassName}>
        <main className="w-full min-h-screen">
          <AppRoutes />
        </main>
        <ConfirmDialog />
      </div>
    )
  }

  if (isQuizSessionPage) {
    return (
      <div className={appShellClassName}>
        <main className="w-full min-h-screen">
          <AppRoutes />
        </main>
        <ConfirmDialog />
      </div>
    )
  }

  // Layout setelah login (ada navbar)
  return (
    <div className={`${appShellClassName} h-screen overflow-hidden`}>
      <div className="flex h-full flex-col md:flex-row overflow-hidden">
        <Navbar />
        {/* pb-20 untuk mobile bottom nav, tidak mempengaruhi desktop */}
        <main className="flex-1 w-full h-full overflow-y-auto pb-20 md:pb-0">
          <AppRoutes />
        </main>
      </div>
      <ConfirmDialog />
    </div>
  )
}

export default App
