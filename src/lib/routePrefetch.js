import { lazy } from 'react'

const routeLoaders = {
  '/login': () => import('../pages/auth/Login'),
  '/auth/google/popup': () => import('../pages/auth/GoogleAuthPopup'),
  '/register': () => import('../pages/auth/Register'),
  '/forgot-password': () => import('../pages/auth/ForgotPassword'),
  '/reset-password': () => import('../pages/auth/ResetPassword'),
  '/siswa/home': () => import('../pages/siswa/Home'),
  '/siswa/absensi': () => import('../pages/siswa/Absensi'),
  '/siswa/quiz': () => import('../pages/siswa/Quiz'),
  '/siswa/tugas': () => import('../pages/siswa/Tugas'),
  '/siswa/profile': () => import('../pages/siswa/EditProfile'),
  '/guru/jadwal': () => import('../pages/guru/JadwalGuru'),
  '/guru/absensi': () => import('../pages/guru/AbsensiGuru'),
  '/guru/quiz': () => import('../pages/guru/Quiz'),
  '/guru/tugas': () => import('../pages/guru/TugasGuru'),
  '/guru/laporan': () => import('../pages/guru/Laporan'),
  '/guru/siswa': () => import('../pages/admin/Siswa'),
  '/guru/profile': () => import('../pages/guru/profile'),
  '/admin/home': () => import('../pages/admin/Home'),
  '/admin/kelas': () => import('../pages/admin/Kelas'),
  '/admin/guru': () => import('../pages/admin/Guru'),
  '/admin/siswa': () => import('../pages/admin/Siswa'),
  '/admin/scan': () => import('../pages/admin/Scan'),
  '/admin/sertifikat': () => import('../pages/admin/Sertifikat'),
  '/admin/backup': () => import('../pages/admin/Backup'),
  '/admin/pengaturan': () => import('../pages/admin/pengaturan'),
  '/admin/tenants': () => import('../pages/admin/Tenants'),
  '/admin/super-admins': () => import('../pages/admin/SuperAdmins'),
  '/admin/approvals': () => import('../pages/admin/Approvals'),
  '/admin/audit-trail': () => import('../pages/admin/AuditTrail'),
  '/admin/plugins': () => import('../pages/admin/Plugins'),
  '/admin/whatsapp': () => import('../pages/admin/WhatsApp')
}

const routeEntries = Object.entries(routeLoaders).sort(
  (left, right) => right[0].length - left[0].length
)

const prefetchedModules = new Map()
const LOW_BANDWIDTH_TYPES = new Set(['slow-2g', '2g'])

const normalizeRoutePath = (path = '') => {
  const normalized = String(path || '').trim()
  if (!normalized) return ''
  return normalized.split('#')[0].split('?')[0]
}

const resolveRouteLoader = (path = '') => {
  const normalized = normalizeRoutePath(path)
  if (!normalized) return null

  const matchedEntry = routeEntries.find(([routePath]) => {
    return normalized === routePath || normalized.startsWith(`${routePath}/`)
  })

  return matchedEntry || null
}

const canPrefetchRoutes = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection

  if (connection?.saveData) return false
  if (LOW_BANDWIDTH_TYPES.has(connection?.effectiveType)) return false

  return true
}

export const lazyRoute = (path) => {
  const loader = routeLoaders[path]
  if (!loader) {
    throw new Error(`Route loader tidak ditemukan untuk path: ${path}`)
  }
  return lazy(loader)
}

export const prefetchRoute = (path) => {
  if (!canPrefetchRoutes()) return Promise.resolve(null)

  const matchedEntry = resolveRouteLoader(path)
  if (!matchedEntry) return Promise.resolve(null)

  const [cacheKey, loader] = matchedEntry
  if (!prefetchedModules.has(cacheKey)) {
    prefetchedModules.set(
      cacheKey,
      loader().catch((error) => {
        prefetchedModules.delete(cacheKey)
        throw error
      })
    )
  }

  return prefetchedModules.get(cacheKey)
}

export const scheduleRoutePrefetch = (paths, options = {}) => {
  const uniquePaths = Array.from(
    new Set(
      (Array.isArray(paths) ? paths : [])
        .map((path) => normalizeRoutePath(path))
        .filter(Boolean)
    )
  )

  if (!canPrefetchRoutes() || uniquePaths.length === 0) {
    return () => {}
  }

  const max = Math.max(1, Number(options.max) || uniquePaths.length)
  let cancelled = false

  const run = () => {
    if (cancelled) return
    uniquePaths.slice(0, max).forEach((path) => {
      void prefetchRoute(path)
    })
  }

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, {
      timeout: Number(options.timeout) || 1500
    })

    return () => {
      cancelled = true
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(handle)
      }
    }
  }

  const timer = window.setTimeout(run, Number(options.delay) || 250)
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
