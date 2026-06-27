import { lazy } from 'react'

const routeLoaders = {
  '/login': () => import('../pages/auth/Login'),
  '/landing': () => import('../pages/public/SismuLanding'),
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
  '/guru/rapot-siswa': () => import('../pages/guru/RapotSiswa'),
  '/guru/profile': () => import('../pages/guru/profile'),
  '/guru/admin/home': () => import('../pages/admin/Home'),
  '/guru/admin/kelas': () => import('../pages/admin/Kelas'),
  '/guru/admin/jadwal': () => import('../pages/admin/Jadwal'),
  '/guru/admin/struktur-sekolah': () => import('../pages/admin/StrukturSekolah'),
  '/guru/admin/organisasi': () => import('../pages/admin/Organisasi'),
  '/guru/admin/guru': () => import('../pages/admin/Guru'),
  '/guru/admin/siswa': () => import('../pages/admin/Siswa'),
  '/guru/admin/scan': () => import('../pages/admin/Scan'),
  '/guru/admin/sertifikat': () => import('../pages/admin/Sertifikat'),
  '/admin/home': () => import('../pages/admin/Home'),
  '/admin/kelas': () => import('../pages/admin/Kelas'),
  '/admin/jadwal': () => import('../pages/admin/Jadwal'),
  '/admin/struktur-sekolah': () => import('../pages/admin/StrukturSekolah'),
  '/admin/organisasi': () => import('../pages/admin/Organisasi'),
  '/admin/guru': () => import('../pages/admin/Guru'),
  '/admin/siswa': () => import('../pages/admin/Siswa'),
  '/admin/scan': () => import('../pages/admin/Scan'),
  '/admin/sertifikat': () => import('../pages/admin/Sertifikat'),
  '/admin/backup': () => import('../pages/admin/Backup'),
  '/admin/storage': () => import('../pages/admin/StorageManager'),
  '/admin/permission-admin': () => import('../pages/admin/PermissionAdmin'),
  '/admin/pengaturan': () => import('../pages/admin/pengaturan'),
  '/admin/monitoring': () => import('../pages/admin/SuperMonitoring'),
  '/admin/background-job': () => import('../pages/admin/SuperBackgroundJobs'),
  '/admin/monitoring-server': () => import('../pages/admin/SuperServerMonitoring'),
  '/admin/monitoring-log': () => import('../pages/admin/SuperMonitorLog'),
  '/admin/animasi-flow': () => import('../pages/admin/AnimasiFlow'),
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

const getConnection = () => (
  typeof navigator === 'undefined'
    ? null
    : navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection
)

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

  const connection = getConnection()

  if (connection?.saveData) return false
  if (LOW_BANDWIDTH_TYPES.has(connection?.effectiveType)) return false

  return true
}

const resolveAutoPrefetchMax = (requestedMax) => {
  const safeRequestedMax = Math.max(1, Number(requestedMax) || 1)
  const connection = getConnection()
  const deviceMemory = typeof navigator === 'undefined'
    ? 0
    : Number(navigator.deviceMemory || 0)
  const constrainedDevice = deviceMemory > 0 && deviceMemory <= 4
  const constrainedConnection = connection?.effectiveType === '3g'
  const ceiling = constrainedDevice || constrainedConnection ? 1 : 2

  return Math.min(safeRequestedMax, ceiling)
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

  const max = resolveAutoPrefetchMax(options.max || uniquePaths.length)
  const queue = uniquePaths.slice(0, max)
  const delay = Math.max(300, Number(options.delay) || 1200)
  const gap = Math.max(400, Number(options.gap) || 900)
  const timeout = Math.max(1000, Number(options.timeout) || 2500)
  let cancelled = false
  let cursor = 0
  let timer = null
  let idleHandle = null

  const clearScheduled = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleHandle)
      idleHandle = null
    }
  }

  const scheduleIdle = (callback) => {
    clearScheduled()
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(callback, { timeout })
      return
    }
    timer = window.setTimeout(callback, 0)
  }

  const runNext = () => {
    idleHandle = null
    if (cancelled) return

    const path = queue[cursor]
    if (!path) return

    void prefetchRoute(path)
      .catch(() => {})
      .finally(() => {
        cursor += 1
        if (cancelled || cursor >= queue.length) return
        timer = window.setTimeout(() => scheduleIdle(runNext), gap)
      })
  }

  timer = window.setTimeout(() => scheduleIdle(runNext), delay)

  return () => {
    cancelled = true
    clearScheduled()
  }
}
