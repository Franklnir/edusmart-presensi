import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { apiClient } from '../../lib/api/client'
import { useAuthStore } from '../../store/useAuthStore'

const FLUSH_DELAY_MS = 3200
const MIN_FLUSH_GAP_MS = 8000
const MAX_ROUTE_LENGTH = 191
const MAX_HOST_LENGTH = 191
const CLS_SESSION_GAP_MS = 1000
const CLS_SESSION_WINDOW_MS = 5000
const PROTECTED_ROUTE_PREFIXES = ['/admin', '/guru', '/siswa']
const COLLECTOR_VERSION = 'route-v2'

const clampNumber = (value, precision = 2) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  const factor = 10 ** precision
  return Math.round(number * factor) / factor
}

const routeFromLocation = (location) => {
  const path = `${location.pathname || '/'}${location.search || ''}`
  return path.slice(0, MAX_ROUTE_LENGTH) || '/'
}

const createMetrics = (navigation, includeDocumentTiming = false) => ({
  lcp_ms: null,
  ttfb_ms: includeDocumentTiming ? navigation?.ttfb_ms ?? null : null,
  inp_ms: null,
  cls: 0,
  fcp_ms: null,
  route_ready_ms: null
})

const createClsSession = () => ({
  value: 0,
  startTime: 0,
  lastTime: 0
})

const isProtectedRoute = (routePath = '') => {
  const path = String(routePath || '/').split('?')[0] || '/'
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => (
    path === prefix || path.startsWith(`${prefix}/`)
  ))
}

const canReportRouteIdentity = (routePath, auth) => {
  if (!isProtectedRoute(routePath)) return true
  if (auth?.isSuperAdmin) return true
  return Boolean(auth?.user?.id && auth?.profile?.role)
}

const getConnection = () => {
  if (typeof navigator === 'undefined') return null
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
}

const getDeviceType = () => {
  if (typeof window === 'undefined') return 'unknown'
  const width = Number(window.innerWidth || 0)
  if (width > 0 && width < 768) return 'mobile'
  if (width >= 768 && width < 1180) return 'tablet'
  return 'desktop'
}

const getNavigationTiming = () => {
  if (typeof performance === 'undefined') return null
  const nav = performance.getEntriesByType?.('navigation')?.[0]
  if (!nav) return null

  const requestStart = Number(nav.requestStart || 0)
  const responseStart = Number(nav.responseStart || 0)
  const ttfb = responseStart > 0
    ? responseStart - (requestStart > 0 ? requestStart : Number(nav.startTime || 0))
    : null

  return {
    ttfb_ms: clampNumber(ttfb),
    navigation_type: nav.type || 'navigate'
  }
}

const supportsEntryType = (type) => {
  if (typeof PerformanceObserver === 'undefined') return false
  const supported = PerformanceObserver.supportedEntryTypes || []
  return supported.includes(type)
}

const resolveSampleRate = () => {
  const raw = Number(import.meta.env.VITE_WEB_VITALS_SAMPLE_RATE ?? 1)
  if (!Number.isFinite(raw)) return 1
  return Math.max(0, Math.min(1, raw))
}

export default function WebVitalsReporter() {
  const location = useLocation()
  const { user, profile, isSuperAdmin } = useAuthStore()
  const authRef = useRef({ user: null, profile: null, isSuperAdmin: false })
  const routeRef = useRef(routeFromLocation(location))
  const routeStartedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now())
  const routeReadyMsRef = useRef(null)
  const flushTimerRef = useRef(null)
  const lastFlushAtRef = useRef(0)
  const sendingRef = useRef(false)
  const collectRef = useRef(Math.random() <= resolveSampleRate())
  const navigationRef = useRef(getNavigationTiming())
  const metricsRef = useRef(createMetrics(navigationRef.current, true))
  const clsSessionRef = useRef(createClsSession())
  const interactionDurationsRef = useRef(new Map())

  const resetRouteMetrics = useCallback((includeDocumentTiming = false) => {
    metricsRef.current = createMetrics(navigationRef.current, includeDocumentTiming)
    clsSessionRef.current = createClsSession()
    interactionDurationsRef.current.clear()
  }, [])

  const measureRouteReady = useCallback(() => {
    if (typeof window === 'undefined') return
    const startedAt = routeStartedAtRef.current
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        routeReadyMsRef.current = clampNumber(performance.now() - startedAt)
      })
    })
  }, [])

  const flush = useCallback(async (reason = 'interval', routePath = routeRef.current, force = false) => {
    if (!collectRef.current || sendingRef.current) return
    if (typeof window === 'undefined') return

    const now = Date.now()
    if (!force && now - lastFlushAtRef.current < MIN_FLUSH_GAP_MS) return

    const { user: activeUser, profile: activeProfile, isSuperAdmin: activeSuperAdmin } = authRef.current
    if (!canReportRouteIdentity(routePath, {
      user: activeUser,
      profile: activeProfile,
      isSuperAdmin: activeSuperAdmin
    })) {
      return
    }

    const metrics = {
      ...metricsRef.current,
      route_ready_ms: routeReadyMsRef.current
    }
    const hasMetric = Object.values(metrics).some((value) => value !== null && value !== undefined)
    if (!hasMetric) return

    const connection = getConnection()
    const role = activeSuperAdmin
      ? 'super_admin'
      : activeProfile?.role || (activeUser?.id ? 'authenticated' : 'guest')

    lastFlushAtRef.current = now
    sendingRef.current = true

    try {
      await apiClient('/api/observability/web-vitals', {
        method: 'POST',
        body: {
          route_path: routePath,
          url_host: String(window.location.hostname || '').slice(0, MAX_HOST_LENGTH),
          role,
          navigation_type: navigationRef.current?.navigation_type || 'navigate',
          device_type: getDeviceType(),
          effective_connection_type: connection?.effectiveType || '',
          viewport_width: Math.max(0, Math.round(window.innerWidth || 0)),
          viewport_height: Math.max(0, Math.round(window.innerHeight || 0)),
          measured_at: new Date().toISOString(),
          metrics,
          metadata: {
            reason,
            collector_version: COLLECTOR_VERSION,
            language: navigator.language || '',
            visibility_state: document.visibilityState || 'visible'
          }
        }
      })
    } catch {
      // Web Vitals telemetry must never disturb the active page.
    } finally {
      sendingRef.current = false
    }
  }, [])

  const scheduleFlush = useCallback((reason = 'route-view') => {
    if (typeof window === 'undefined') return
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      void flush(reason, routeRef.current)
    }, FLUSH_DELAY_MS)
  }, [flush])

  useEffect(() => {
    authRef.current = { user, profile, isSuperAdmin }
    if (!collectRef.current) return
    if (canReportRouteIdentity(routeRef.current, { user, profile, isSuperAdmin })) {
      scheduleFlush('auth-ready')
    }
  }, [isSuperAdmin, profile, scheduleFlush, user])

  useEffect(() => {
    if (!collectRef.current) return undefined

    const observers = []

    if (supportsEntryType('largest-contentful-paint')) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const last = entries[entries.length - 1]
          if (last) metricsRef.current.lcp_ms = clampNumber(last.startTime)
        })
        observer.observe({ type: 'largest-contentful-paint', buffered: true })
        observers.push(observer)
      } catch { }
    }

    if (supportsEntryType('layout-shift')) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.hadRecentInput) return

            const shiftValue = Number(entry.value || 0)
            if (!Number.isFinite(shiftValue) || shiftValue <= 0) return

            const startTime = Number(entry.startTime || performance.now())
            const currentSession = clsSessionRef.current
            const withinGap = startTime - currentSession.lastTime < CLS_SESSION_GAP_MS
            const withinWindow = startTime - currentSession.startTime < CLS_SESSION_WINDOW_MS

            if (currentSession.value > 0 && withinGap && withinWindow) {
              currentSession.value += shiftValue
              currentSession.lastTime = startTime
            } else {
              currentSession.value = shiftValue
              currentSession.startTime = startTime
              currentSession.lastTime = startTime
            }

            metricsRef.current.cls = clampNumber(
              Math.max(Number(metricsRef.current.cls || 0), currentSession.value),
              4
            )
          })
        })
        observer.observe({ type: 'layout-shift', buffered: true })
        observers.push(observer)
      } catch { }
    }

    if (supportsEntryType('event')) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            const duration = clampNumber(entry.duration)
            if (duration === null) return

            const interactionId = Number(entry.interactionId || 0)
            if (interactionId > 0) {
              interactionDurationsRef.current.set(
                interactionId,
                Math.max(Number(interactionDurationsRef.current.get(interactionId) || 0), duration)
              )
              metricsRef.current.inp_ms = clampNumber(Math.max(...interactionDurationsRef.current.values()))
              return
            }

            metricsRef.current.inp_ms = clampNumber(Math.max(Number(metricsRef.current.inp_ms || 0), duration))
          })
        })
        observer.observe({ type: 'event', buffered: true, durationThreshold: 40 })
        observers.push(observer)
      } catch { }
    }

    if (supportsEntryType('paint')) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.name === 'first-contentful-paint') {
              metricsRef.current.fcp_ms = clampNumber(entry.startTime)
            }
          })
        })
        observer.observe({ type: 'paint', buffered: true })
        observers.push(observer)
      } catch { }
    }

    measureRouteReady()
    scheduleFlush('initial-view')

    return () => {
      observers.forEach((observer) => observer.disconnect())
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current)
    }
  }, [measureRouteReady, scheduleFlush])

  useEffect(() => {
    if (!collectRef.current) return

    const nextRoute = routeFromLocation(location)
    const previousRoute = routeRef.current
    if (previousRoute && previousRoute !== nextRoute) {
      void flush('route-change', previousRoute, true)
    }

    routeRef.current = nextRoute
    resetRouteMetrics(false)
    routeStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now()
    routeReadyMsRef.current = null
    measureRouteReady()
    scheduleFlush('route-view')
  }, [flush, location, measureRouteReady, resetRouteMetrics, scheduleFlush])

  useEffect(() => {
    if (!collectRef.current || typeof document === 'undefined') return undefined

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flush('visibility-hidden', routeRef.current, true)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [flush])

  return null
}
