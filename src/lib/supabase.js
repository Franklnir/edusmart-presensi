// src/lib/supabase.js
import { readAcademicCorrectionSession } from '../utils/academicCorrectionSession'
/* ===================== API BASE ===================== */
const getRuntimeHostname = () => {
  if (typeof window === 'undefined') return 'localhost'
  return window.location?.hostname || 'localhost'
}

const ADMIN_SUBDOMAIN = String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin26')
  .trim()
  .toLowerCase()
const ROOT_DOMAIN = String(import.meta.env.VITE_ROOT_DOMAIN || '')
  .trim()
  .toLowerCase()

const DELEGATED_ADMIN_FEATURE_PATHS = [
  ['dashboard', '/guru/admin/home'],
  ['kelas', '/guru/admin/kelas'],
  ['jadwal', '/guru/admin/jadwal'],
  ['struktur-sekolah', '/guru/admin/struktur-sekolah'],
  ['organisasi', '/guru/admin/organisasi'],
  ['guru', '/guru/admin/guru'],
  ['sertifikat', '/guru/admin/sertifikat'],
  ['siswa', '/guru/admin/siswa'],
  ['scan-kehadiran-pengaturan', '/guru/admin/scan?menu=pengaturan'],
  ['scan-kehadiran-live', '/guru/admin/scan?menu=live-scan'],
  ['scan-kehadiran-riwayat', '/guru/admin/scan?menu=riwayat']
]

const resolveDelegatedAdminFeatureKeyFromPath = (pathname = '', search = '') => {
  const normalized = String(pathname || '').split('?')[0].split('#')[0]
  if (normalized === '/guru/admin/scan') {
    const params = new URLSearchParams(search || '')
    const menu = params.get('menu') || 'pengaturan'
    if (menu === 'live-scan') return 'scan-kehadiran-live'
    if (menu === 'riwayat') return 'scan-kehadiran-riwayat'

    return 'scan-kehadiran-pengaturan'
  }

  const match = DELEGATED_ADMIN_FEATURE_PATHS.find(([, route]) => (
    normalized === route || normalized.startsWith(route + '/')
  ))
  return match?.[0] || ''
}

const isLocalApiHost = (host) => {
  const normalized = String(host || '').toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '127.0.0.1.nip.io' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.127.0.0.1.nip.io')
  )
}

const deriveApiHost = (host) => {
  const normalized = String(host || '').toLowerCase()
  if (!normalized) return 'localhost'
  if (normalized === 'localhost') return 'localhost'
  if (normalized === '127.0.0.1') return '127.0.0.1'
  // Keep tenant subdomain host (e.g. bali.localhost) so CSRF cookie is readable on the same host.
  if (normalized.endsWith('.localhost')) return normalized
  return normalized
}

const deriveTenantSlug = (host) => {
  const normalized = String(host || '').toLowerCase()
  if (!normalized) return ''
  if (normalized === 'localhost' || normalized === '127.0.0.1') return ''
  if (normalized.endsWith('.localhost')) {
    const first = normalized.split('.')[0]
    if (!first || first === 'www' || first === ADMIN_SUBDOMAIN) return ''
    return first
  }
  if (normalized.endsWith('.127.0.0.1.nip.io')) {
    const first = normalized.split('.')[0]
    if (!first || first === 'www' || first === ADMIN_SUBDOMAIN) return ''
    return first
  }
  return ''
}

const RUNTIME_HOST = getRuntimeHostname()
const DEFAULT_API_HOST = deriveApiHost(RUNTIME_HOST)
const isWithinRootDomain = (host, rootDomain) => {
  const normalizedHost = String(host || '').trim().toLowerCase()
  const normalizedRoot = String(rootDomain || '').trim().toLowerCase()
  if (!normalizedHost || !normalizedRoot) return false
  return normalizedHost === normalizedRoot || normalizedHost.endsWith(`.${normalizedRoot}`)
}

const normalizeApiUrl = (rawApiUrl, runtimeHost) => {
  const runtime = String(runtimeHost || '').toLowerCase()
  const runtimeIsLocal = isLocalApiHost(runtime)
  const runtimeProtocol =
    typeof window !== 'undefined' && window.location?.protocol
      ? window.location.protocol
      : 'http:'
  const fallback = runtimeIsLocal
    ? `http://${DEFAULT_API_HOST}:8000`
    : `${runtimeProtocol}//${DEFAULT_API_HOST}`
  const input = String(rawApiUrl || '').trim()
  if (!input) return fallback

  try {
    const url = new URL(input)
    const apiHost = String(url.hostname || '').toLowerCase()

    const apiIsLocal = isLocalApiHost(apiHost)

    // Keep frontend and API on the same local host to avoid CSRF cookie mismatch.
    if (runtimeIsLocal && apiIsLocal && runtime && runtime !== apiHost) {
      url.hostname = runtime
    }

    const runtimeInRoot = isWithinRootDomain(runtime, ROOT_DOMAIN)
    const apiInRoot = isWithinRootDomain(apiHost, ROOT_DOMAIN)
    if (!runtimeIsLocal && runtimeInRoot && apiInRoot && runtime !== apiHost) {
      url.hostname = runtime
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return input.replace(/\/$/, '')
  }
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL, RUNTIME_HOST)
const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG || deriveTenantSlug(RUNTIME_HOST)
export const CURRENT_TENANT_SLUG = TENANT_SLUG
export const buildApiUrl = (path = '') => {
  try {
    return new URL(String(path || ''), `${API_URL}/`).toString()
  } catch {
    return `${API_URL}${String(path || '')}`
  }
}
const GOOGLE_AUTH_ENABLED = String(import.meta.env.VITE_GOOGLE_AUTH_ENABLED || 'false')
  .trim()
  .toLowerCase() === 'true'
const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '')
  .trim()
const normalizeAuthEndpointUrl = (rawUrl, fallbackPath) => {
  const input = String(rawUrl || fallbackPath || '').trim()
  if (!input) return ''

  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : API_URL
    const url = new URL(input, baseOrigin)
    const runtime = String(RUNTIME_HOST || '').toLowerCase()
    const targetHost = String(url.hostname || '').toLowerCase()

    const runtimeIsLocal = isLocalApiHost(runtime)
    const targetIsLocal = isLocalApiHost(targetHost)

    if (runtimeIsLocal && targetIsLocal && runtime && runtime !== targetHost) {
      url.hostname = runtime
    }

    const runtimeInRoot = isWithinRootDomain(runtime, ROOT_DOMAIN)
    const targetInRoot = isWithinRootDomain(targetHost, ROOT_DOMAIN)
    if (!runtimeIsLocal && runtimeInRoot && targetInRoot && runtime !== targetHost) {
      url.hostname = runtime
    }

    return url.toString()
  } catch {
    return input
  }
}

const GOOGLE_AUTH_LOGIN_URL = normalizeAuthEndpointUrl(
  import.meta.env.VITE_GOOGLE_AUTH_LOGIN_URL,
  '/api/auth/google/redirect'
)
const GOOGLE_AUTH_LINK_URL = normalizeAuthEndpointUrl(
  import.meta.env.VITE_GOOGLE_AUTH_LINK_URL,
  '/api/auth/google/link'
)
export const AUTH_SESSION_HINT_KEY = 'edusmart_auth_session_hint'
export const SESSION_EXPIRED_EVENT = 'edusmart:session-expired'
export const API_UNAVAILABLE_EVENT = 'edusmart:api-unavailable'
const SESSION_EXPIRED_MESSAGE =
  'Sesi login Anda telah berakhir. Silakan masuk lagi untuk melanjutkan.'
let lastSessionExpiredNotifiedAt = 0
let lastApiUnavailableNotifiedAt = 0
let apiUnavailableUntil = 0
const pendingApiRequests = new Map()
const staleRequestControllers = new Map()
const apiResponseCache = new Map()
const PERSISTED_API_CACHE_PREFIX = 'edusmart_api_cache:'
const PERSISTED_API_CACHE_INDEX_KEY = 'edusmart_api_cache:index'
const MAX_PERSISTED_API_CACHE_ENTRIES = 80
const DEFAULT_DB_SELECT_CACHE_TTL_MS = Number(
  import.meta.env.VITE_DB_SELECT_CACHE_TTL_MS || 1000 * 60 * 5
)
const DEFAULT_PERSISTED_API_STALE_TTL_MS = Number(
  import.meta.env.VITE_PERSISTED_API_STALE_TTL_MS || 1000 * 60 * 10
)
const MAX_API_RESPONSE_CACHE_ENTRIES = 250
const persistedApiRevalidations = new Map()

const isPlainObjectValue = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const stableRequestStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableRequestStringify).join(',')}]`
  }

  if (isPlainObjectValue(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableRequestStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const buildPendingRequestKey = (path, method, body, options = {}) => {
  if (options?.dedupe === false) return ''
  if (method === 'GET' || method === 'HEAD') {
    return `${method}:${path}`
  }

  if (method === 'POST' && path === '/api/db' && body?.action === 'select') {
    return `${method}:${path}:${stableRequestStringify(body)}`
  }

  if (method === 'POST' && path === '/api/db/batch') {
    return `${method}:${path}:${stableRequestStringify(body)}`
  }

  return ''
}

const cloneApiResult = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch { }
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

const isCacheableApiRequest = (path, method, body, options = {}) => {
  if (method === 'GET' || method === 'HEAD') {
    const hasExplicitCacheTtl = Object.prototype.hasOwnProperty.call(options, 'cacheTtlMs') &&
      Number.isFinite(Number(options.cacheTtlMs)) &&
      Number(options.cacheTtlMs) > 0
    return options.cache === true || hasExplicitCacheTtl
  }

  return method === 'POST' && (
    path === '/api/db/batch' ||
    (options.cache === true && path === '/api/db' && body?.action === 'select')
  )
}

const canPersistApiCache = (_path, method, options = {}) => {
  if (method !== 'GET' && method !== 'HEAD') return false
  return options.persistCache === true
}

const getApiCacheStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const persistedCacheKey = (key) => `${PERSISTED_API_CACHE_PREFIX}${key}`

const readPersistedCacheIndex = (storage) => {
  try {
    const parsed = JSON.parse(storage.getItem(PERSISTED_API_CACHE_INDEX_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writePersistedCacheIndex = (storage, entries) => {
  try {
    storage.setItem(PERSISTED_API_CACHE_INDEX_KEY, JSON.stringify(entries.slice(-MAX_PERSISTED_API_CACHE_ENTRIES)))
  } catch { }
}

const getPersistedApiResponse = (key, options = {}) => {
  const storage = getApiCacheStorage()
  if (!storage || !key) return null

  const storageKey = persistedCacheKey(key)
  try {
    const entry = JSON.parse(storage.getItem(storageKey) || 'null')
    if (!entry) {
      storage.removeItem(storageKey)
      return null
    }

    const now = Date.now()
    const expiresAt = Number(entry.expiresAt || entry.freshUntil || 0)
    const staleExpiresAt = Number(entry.staleExpiresAt || expiresAt)
    const allowStale = options.allowStale === true

    if (expiresAt > now) {
      return {
        stale: false,
        value: cloneApiResult(entry.value)
      }
    }

    if (allowStale && staleExpiresAt > now) {
      return {
        stale: true,
        value: cloneApiResult(entry.value)
      }
    }

    storage.removeItem(storageKey)
    return null
  } catch {
    storage.removeItem(storageKey)
    return null
  }
}

const setPersistedApiResponse = (key, value, ttlMs, options = {}) => {
  const storage = getApiCacheStorage()
  if (!storage || !key || !Number.isFinite(ttlMs) || ttlMs <= 0) return

  const storageKey = persistedCacheKey(key)
  try {
    const now = Date.now()
    const staleTtlMs = Number(options.staleTtlMs || DEFAULT_PERSISTED_API_STALE_TTL_MS)
    const normalizedStaleTtlMs = Number.isFinite(staleTtlMs)
      ? Math.max(ttlMs, staleTtlMs)
      : ttlMs

    storage.setItem(storageKey, JSON.stringify({
      expiresAt: now + ttlMs,
      staleExpiresAt: now + normalizedStaleTtlMs,
      value: cloneApiResult(value)
    }))

    const nextIndex = readPersistedCacheIndex(storage).filter((item) => item !== storageKey)
    nextIndex.push(storageKey)
    while (nextIndex.length > MAX_PERSISTED_API_CACHE_ENTRIES) {
      const oldest = nextIndex.shift()
      if (oldest) storage.removeItem(oldest)
    }
    writePersistedCacheIndex(storage, nextIndex)
  } catch { }
}

const clearPersistedApiCache = (matcher = null) => {
  const storage = getApiCacheStorage()
  if (!storage) return
  const index = readPersistedCacheIndex(storage)
  const keep = []

  for (const key of index) {
    const shouldDelete = typeof matcher === 'function' ? matcher(key) : true
    if (shouldDelete) {
      try { storage.removeItem(key) } catch { }
    } else {
      keep.push(key)
    }
  }

  writePersistedCacheIndex(storage, keep)
}

const getCachedApiResponse = (key) => {
  const entry = apiResponseCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    apiResponseCache.delete(key)
    return null
  }
  return cloneApiResult(entry.value)
}

const setCachedApiResponse = (key, value, ttlMs) => {
  if (!key || !Number.isFinite(ttlMs) || ttlMs <= 0) return
  if (apiResponseCache.size >= MAX_API_RESPONSE_CACHE_ENTRIES) {
    const oldestKey = apiResponseCache.keys().next().value
    if (oldestKey) apiResponseCache.delete(oldestKey)
  }
  apiResponseCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value: cloneApiResult(value)
  })
}

export const invalidateDbSelectCache = (table = '') => {
  const normalizedTable = String(table || '').trim()
  if (!normalizedTable) {
    apiResponseCache.clear()
    clearPersistedApiCache()
    return
  }

  const tableNeedle = `"table":${JSON.stringify(normalizedTable)}`
  for (const key of Array.from(apiResponseCache.keys())) {
    if (
      key.includes(tableNeedle) ||
      key.includes('/api/reports/') ||
      key.includes('/api/quiz/')
    ) {
      apiResponseCache.delete(key)
    }
  }

  clearPersistedApiCache((key) => (
    key.includes(tableNeedle) ||
    key.includes('/api/reports/') ||
    key.includes('/api/quiz/')
  ))
}

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const setAuthSessionHint = (value = true) => {
  const storage = getSessionStorage()
  if (!storage) return

  try {
    if (value) {
      storage.setItem(AUTH_SESSION_HINT_KEY, '1')
    } else {
      storage.removeItem(AUTH_SESSION_HINT_KEY)
    }
  } catch {
    // ignore storage access errors
  }
}

export const clearAuthSessionHint = () => setAuthSessionHint(false)

export const hasAuthSessionHint = () => {
  const storage = getSessionStorage()
  if (!storage) return false

  try {
    return storage.getItem(AUTH_SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

const normalizeSessionHandlingPath = (input = '') => {
  const raw = String(input || '').trim()
  if (!raw) return ''

  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : API_URL
    const url = new URL(raw, baseOrigin)
    return `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

const shouldIgnoreSessionExpiredHandling = (input = '') => {
  const normalized = normalizeSessionHandlingPath(input)
  if (!normalized) return false

  const ignoredPrefixes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/verify-email/',
    '/api/auth/google/redirect',
    '/api/auth/google/popup-context',
    '/api/auth/google/callback',
    '/api/auth/google/finalize-login',
    '/api/auth/google/code-login',
    '/api/auth/google/credential-login'
  ]

  return ignoredPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix)
  )
}

const notifySessionExpired = ({ path = '', status = 401, message } = {}) => {
  if (typeof window === 'undefined') return
  if (!hasAuthSessionHint()) return
  if (shouldIgnoreSessionExpiredHandling(path)) return

  const now = Date.now()
  if (now - lastSessionExpiredNotifiedAt < 1500) return
  lastSessionExpiredNotifiedAt = now

  clearAuthSessionHint()

  window.dispatchEvent(
    new CustomEvent(SESSION_EXPIRED_EVENT, {
      detail: {
        path: normalizeSessionHandlingPath(path),
        status,
        message: message || SESSION_EXPIRED_MESSAGE
      }
    })
  )
}

/* ===================== BUCKETS ===================== */
export const ASSIGNMENT_BUCKET = 'assignments'
export const PROFILE_BUCKET = 'profile-photos'
export const QUIZ_MEDIA_BUCKET = 'quiz-media'
export const CERT_BUCKET = 'certificates'
export const CERT_TEMPLATE_BUCKET = 'certificate-templates'
const DIRECT_UPLOAD_BUCKETS = new Set([
  PROFILE_BUCKET,
  ASSIGNMENT_BUCKET,
  QUIZ_MEDIA_BUCKET,
  CERT_BUCKET,
  'sertifikat-files',
  CERT_TEMPLATE_BUCKET,
  'sertifikat-templates'
])
const DIRECT_UPLOAD_COOLDOWN_MS = 10 * 60 * 1000
const DIRECT_UPLOAD_COOLDOWN_PREFIX = 'edusmart:direct-upload-cooldown:'
const DIRECT_UPLOAD_CONFIRM_RETRY_DELAYS_MS = [0, 600]
const DIRECT_UPLOAD_SMALL_FILE_RELAY_BYTES = Number(import.meta.env.VITE_DIRECT_UPLOAD_SMALL_FILE_RELAY_BYTES || 1024 * 1024)
const DIRECT_UPLOAD_OBJECT_TIMEOUT_MS = Number(import.meta.env.VITE_DIRECT_UPLOAD_OBJECT_TIMEOUT_MS || 120000)
const directUploadObjectTimeoutMs = Number.isFinite(DIRECT_UPLOAD_OBJECT_TIMEOUT_MS)
  ? Math.max(15000, DIRECT_UPLOAD_OBJECT_TIMEOUT_MS)
  : 120000

const directUploadCooldownKey = (bucket) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'server'
  return `${DIRECT_UPLOAD_COOLDOWN_PREFIX}${encodeURIComponent(origin)}:${bucket}`
}

const directUploadCooldownUntil = (bucket) => {
  if (typeof window === 'undefined') return 0
  try {
    return Number(window.sessionStorage.getItem(directUploadCooldownKey(bucket)) || 0)
  } catch {
    return 0
  }
}

const isDirectUploadCoolingDown = (bucket) => {
  const until = directUploadCooldownUntil(bucket)
  return Number.isFinite(until) && until > Date.now()
}

const markDirectUploadCooldown = (bucket) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      directUploadCooldownKey(bucket),
      String(Date.now() + DIRECT_UPLOAD_COOLDOWN_MS)
    )
  } catch {
    // Jika sessionStorage diblokir, fallback upload tetap berjalan tanpa cache cooldown.
  }
}

const clearDirectUploadCooldown = (bucket) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(directUploadCooldownKey(bucket))
  } catch {
    // no-op
  }
}

const shouldCooldownDirectUploadError = (error) => (
  error?.code === 'DIRECT_UPLOAD_NETWORK_ERROR' ||
  error?.code === 'DIRECT_UPLOAD_TIMEOUT'
)

const isDirectUploadVerificationError = (error) => (
  ['OBJECT_STORAGE_NOT_READY', 'OBJECT_STORAGE_VERIFY_FAILED', 'OBJECT_STORAGE_SIZE_MISMATCH'].includes(error?.code) ||
  /object storage/i.test(String(error?.message || ''))
)

const shouldRetryDirectUploadConfirm = (response) => (
  response?.raw?.retryable === true ||
  ['OBJECT_STORAGE_NOT_READY', 'OBJECT_STORAGE_VERIFY_FAILED'].includes(response?.error?.code)
)

const waitForDirectUploadRetry = (delayMs, signal) => new Promise((resolve) => {
  if (!delayMs) {
    resolve(!signal?.aborted)
    return
  }
  if (signal?.aborted) {
    resolve(false)
    return
  }

  let settled = false
  let timer = null
  let abortHandler = null
  const finish = (value) => {
    if (settled) return
    settled = true
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
    resolve(value)
  }
  timer = setTimeout(() => finish(true), delayMs)
  abortHandler = () => {
    clearTimeout(timer)
    finish(false)
  }

  if (signal) signal.addEventListener('abort', abortHandler, { once: true })
})

const shouldUseServerRelayForSmallUpload = (bucket, file, options = {}) => {
  if (!DIRECT_UPLOAD_BUCKETS.has(bucket)) return false
  if (options?.fastLocal || options?.skipDirectUpload || options?.forceBrowserDirectUpload) return false

  const size = Number(file?.size || 0)
  if (bucket === PROFILE_BUCKET) {
    return size > 0 && size <= 2 * 1024 * 1024
  }

  if (options?.preferServerRelayForSmallFiles !== true && options?.skipDrive !== true) return false

  const threshold = Number.isFinite(DIRECT_UPLOAD_SMALL_FILE_RELAY_BYTES)
    ? Math.max(0, DIRECT_UPLOAD_SMALL_FILE_RELAY_BYTES)
    : 1024 * 1024
  return threshold > 0 && size > 0 && size <= threshold
}

const PROFILE_IMAGE_MAX_BYTES = 50 * 1024
const ASSIGNMENT_IMAGE_MAX_BYTES = 680 * 1024
const QUIZ_MEDIA_IMAGE_MAX_BYTES = 70 * 1024
const KNOWN_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif'
]

/* ===================== CSRF HELPERS ===================== */
let csrfReady = false
let csrfPromise = null

const getCookie = (name) => {
  if (typeof document === 'undefined') return ''
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop().split(';').shift() || ''
  return ''
}

const ensureCsrf = async (force = false) => {
  if (!force && csrfReady && getCookie('XSRF-TOKEN')) return
  if (csrfPromise) {
    await csrfPromise
    return
  }

  csrfPromise = (async () => {
    const res = await fetchWithTransientRetry(`${API_URL}/sanctum/csrf-cookie`, {
      method: 'GET',
      credentials: 'include'
    }, { method: 'GET' })
    if (!res.ok) {
      throw new Error(`Gagal mengambil CSRF cookie (${res.status})`)
    }
    csrfReady = true
  })()

  try {
    await csrfPromise
  } finally {
    csrfPromise = null
  }
}

const makeError = (message, status, code, extra = {}) => ({
  message: message || 'Terjadi kesalahan',
  status,
  code,
  ...extra
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const API_RETRY_DELAYS_MS = [350, 900]
const API_UNAVAILABLE_PAUSE_MS = Number(
  import.meta.env.VITE_API_UNAVAILABLE_PAUSE_MS || 15000
)
const TRANSIENT_API_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524])
const requestAbortReasons = typeof WeakMap !== 'undefined' ? new WeakMap() : null

const isTransientApiStatus = (status) => TRANSIENT_API_STATUSES.has(Number(status || 0))

const getApiUnavailableDelayMs = () => Math.max(0, apiUnavailableUntil - Date.now())

const notifyApiUnavailable = ({ path = '', status = 0, retryAfterMs = API_UNAVAILABLE_PAUSE_MS } = {}) => {
  if (typeof window === 'undefined') return

  const now = Date.now()
  if (now - lastApiUnavailableNotifiedAt < 10000) return
  lastApiUnavailableNotifiedAt = now

  window.dispatchEvent(
    new CustomEvent(API_UNAVAILABLE_EVENT, {
      detail: {
        path: normalizeSessionHandlingPath(path),
        status,
        retryAfterMs
      }
    })
  )
}

const markApiUnavailable = ({ path = '', status = 0 } = {}) => {
  const pauseMs = Number.isFinite(API_UNAVAILABLE_PAUSE_MS)
    ? Math.max(3000, API_UNAVAILABLE_PAUSE_MS)
    : 15000
  apiUnavailableUntil = Math.max(apiUnavailableUntil, Date.now() + pauseMs)
  notifyApiUnavailable({ path, status, retryAfterMs: pauseMs })
}

const makeApiUnavailableResult = ({ path = '', status = 0, retryAfterMs = getApiUnavailableDelayMs() } = {}) => ({
  data: null,
  error: makeError(
    'Server sedang menyambung ulang. Coba lagi beberapa saat.',
    status,
    'API_TEMPORARILY_UNAVAILABLE',
    {
      retryAfter: Math.ceil(Math.max(0, retryAfterMs) / 1000),
      retryAfterMs: Math.max(0, retryAfterMs)
    }
  ),
  raw: {
    path: normalizeSessionHandlingPath(path),
    status,
    retry_after_seconds: Math.ceil(Math.max(0, retryAfterMs) / 1000)
  }
})

const isAbortError = (error) => (
  error?.name === 'AbortError' ||
  error?.code === 20 ||
  /aborted|abort/i.test(String(error?.message || ''))
)

const setAbortReason = (signal, reason) => {
  if (!requestAbortReasons || !signal || !reason) return
  try {
    requestAbortReasons.set(signal, reason)
  } catch { }
}

const getAbortReason = (signal) => {
  if (!requestAbortReasons || !signal) return ''
  try {
    return requestAbortReasons.get(signal) || ''
  } catch {
    return ''
  }
}

const fetchWithTransientRetry = async (url, init = {}, options = {}) => {
  const method = String(options.method || init?.method || 'GET').toUpperCase()
  const retryable = method === 'GET' || method === 'HEAD'

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (error) {
      const canRetry =
        retryable &&
        attempt < API_RETRY_DELAYS_MS.length &&
        !isAbortError(error) &&
        !init?.signal?.aborted

      if (!canRetry) {
        throw error
      }

      await wait(API_RETRY_DELAYS_MS[attempt])
    }
  }
}

const isSessionExpiredStatus = (status) => status === 401 || status === 419

const formatBytesLabel = (bytes) => {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / Math.pow(1024, idx)
  const rounded = idx === 0 ? Math.round(value) : Math.round(value * 100) / 100
  return `${rounded} ${units[idx]}`
}

const getFileExtension = (name = '') => {
  const normalized = String(name || '').split('?')[0].toLowerCase()
  const parts = normalized.split('.')
  if (parts.length < 2) return ''
  return parts.pop() || ''
}

const isImageFile = (file) => {
  if (!file) return false
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return true
  const ext = getFileExtension(file.name || '')
  return KNOWN_IMAGE_EXTENSIONS.includes(ext)
}

const isLogoPath = (path = '') => {
  const normalized = String(path || '').toLowerCase()
  if (!normalized) return false
  if (normalized === 'logo_sekolah.png' || normalized === 'logo_sekolah.jpg') return true
  return normalized.includes('logo')
}

const resolveImageUploadLimitBytes = (bucket, path, file) => {
  if (!isImageFile(file)) return null

  if (bucket === ASSIGNMENT_BUCKET) {
    return ASSIGNMENT_IMAGE_MAX_BYTES
  }

  if (bucket === PROFILE_BUCKET) {
    const normalizedPath = String(path || '').toLowerCase()
    if (normalizedPath.startsWith('profiles/') || isLogoPath(normalizedPath)) {
      return PROFILE_IMAGE_MAX_BYTES
    }
    // fallback aman untuk bucket foto profil
    return PROFILE_IMAGE_MAX_BYTES
  }

  if (bucket === QUIZ_MEDIA_BUCKET) {
    return QUIZ_MEDIA_IMAGE_MAX_BYTES
  }

  return null
}

const loadImageFromFile = (file) =>
  new Promise((resolve, reject) => {
    if (typeof URL === 'undefined') {
      reject(new Error('Browser tidak mendukung URL API'))
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Gagal memuat gambar'))
    }

    image.src = objectUrl
  })

const canvasToJpegBlob = (canvas, quality) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })

const toJpegFileName = (originalName = 'image.jpg') => {
  const base = String(originalName || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80)
  return `${base || 'image'}.jpg`
}

const compressImageToTarget = async (file, maxBytes) => {
  if (!file || !Number.isFinite(maxBytes) || maxBytes <= 0) return file
  if (!isImageFile(file) || file.size <= maxBytes) return file

  if (typeof document === 'undefined') {
    throw new Error(`Upload gambar ditolak. Maksimal ${Math.floor(maxBytes / 1024)}KB.`)
  }

  const img = await loadImageFromFile(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak didukung di browser ini')

  const MAX_DIMENSION = 1800
  const MIN_SIDE = 80
  const ratio = Math.min(1, MAX_DIMENSION / Math.max(img.width || 1, img.height || 1))
  let width = Math.max(1, Math.round((img.width || 1) * ratio))
  let height = Math.max(1, Math.round((img.height || 1) * ratio))
  let quality = 0.9
  let bestBlob = null

  for (let i = 0; i < 18; i += 1) {
    canvas.width = width
    canvas.height = height
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    // eslint-disable-next-line no-await-in-loop
    const blob = await canvasToJpegBlob(canvas, quality)
    if (!blob) break

    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob
    if (blob.size <= maxBytes) {
      bestBlob = blob
      break
    }

    if (quality > 0.45) {
      quality = Math.max(0.45, quality - 0.08)
    } else {
      width = Math.max(MIN_SIDE, Math.round(width * 0.85))
      height = Math.max(MIN_SIDE, Math.round(height * 0.85))
      quality = Math.max(0.35, quality - 0.02)
    }
  }

  if (!bestBlob || bestBlob.size > maxBytes) {
    throw new Error(`Gambar terlalu besar. Maksimal ${Math.floor(maxBytes / 1024)}KB.`)
  }

  if (bestBlob.size >= file.size) {
    return file
  }

  return new File([bestBlob], toJpegFileName(file.name), {
  type: 'image/jpeg',
    lastModified: Date.now()
  })
}

const runApiFetch = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase()
  const body = options.body

  if (method === 'POST' && path === '/api/db') {
    if (!body?.table || !body?.action) {
      throw new Error('Missing table or action in /api/db payload')
    }
  }

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const signal = options.signal
  const guardedByApiRecovery = options.apiRecoveryGuard !== false
  const unavailableDelayMs = guardedByApiRecovery ? getApiUnavailableDelayMs() : 0

  if (unavailableDelayMs > 0) {
    return makeApiUnavailableResult({ path, retryAfterMs: unavailableDelayMs })
  }

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      await ensureCsrf()
    } catch (error) {
      if (!isAbortError(error)) {
        markApiUnavailable({ path, status: 0 })
      }
      return {
        data: null,
        error: makeError(
          `Tidak bisa terhubung ke server API (${API_URL}).`,
          0,
          'NETWORK_ERROR'
        ),
        raw: null
      }
    }
  }

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  }

  if (TENANT_SLUG) {
    headers['X-Tenant'] = TENANT_SLUG
  }

  if (path === '/api/db' || path === '/api/db/batch') {
    const frontendRoute = typeof window !== 'undefined' ? window.location?.pathname || '' : ''
    if (frontendRoute) headers['X-Frontend-Route'] = frontendRoute
    headers['X-DB-Consumer'] = String(options.dbConsumer || 'legacy-supabase-adapter').slice(0, 128)
  }

  const delegatedFeatureKey = typeof window !== 'undefined'
    ? resolveDelegatedAdminFeatureKeyFromPath(window.location?.pathname || '', window.location?.search || '')
    : ''
  if (delegatedFeatureKey) {
    headers['X-Admin-Feature'] = delegatedFeatureKey
  }

  const correctionSession = readAcademicCorrectionSession()
  const academicYearFromRequest = body?.filters?.eq?.tahun_ajaran
    || body?.payload?.tahun_ajaran
    || (Array.isArray(body?.payload) ? body.payload[0]?.tahun_ajaran : '')
  const semesterFromRequest = body?.filters?.eq?.semester
    || body?.payload?.semester
    || (Array.isArray(body?.payload) ? body.payload[0]?.semester : '')
  const correctionContextMatches =
    String(academicYearFromRequest || '') === String(correctionSession?.tahun_ajaran || '') &&
    (!semesterFromRequest || String(semesterFromRequest) === String(correctionSession?.semester || ''))
  if (
    correctionSession?.id &&
    correctionContextMatches &&
    path === '/api/db' &&
    method !== 'GET' &&
    method !== 'HEAD'
  ) {
    headers['X-Academic-Correction-Session'] = correctionSession.id
  }

  const xsrf = getCookie('XSRF-TOKEN')
  if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf)

  let finalBody = body
  if (body && !isForm && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json'
    finalBody = JSON.stringify(body)
  }

  const runFetch = async (requestHeaders) => {
    return fetchWithTransientRetry(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: requestHeaders,
      body: finalBody,
      signal
    }, { method })
  }

  let res
  try {
    res = await runFetch(headers)
  } catch (error) {
    if (isAbortError(error)) {
      if (getAbortReason(signal) === 'timeout') {
        return {
          data: null,
          error: makeError(
            `Request ke server API timeout (${API_URL}). Coba lagi beberapa saat.`,
            0,
            'REQUEST_TIMEOUT'
          ),
          raw: null,
          aborted: true
        }
      }

      return {
        data: null,
        error: makeError('Request dibatalkan', 0, 'REQUEST_ABORTED'),
        raw: null,
        aborted: true
      }
    }

    if (!isAbortError(error)) {
      markApiUnavailable({ path, status: 0 })
    }

    return {
      data: null,
      error: makeError(
        `Tidak bisa terhubung ke server API (${API_URL}).`,
        0,
        'NETWORK_ERROR'
      ),
      raw: null
    }
  }

  if (res.status === 419 && method !== 'GET' && method !== 'HEAD') {
    csrfReady = false
    try {
      await ensureCsrf(true)
      const retryHeaders = { ...headers }
      const refreshedXsrf = getCookie('XSRF-TOKEN')
      if (refreshedXsrf) {
        retryHeaders['X-XSRF-TOKEN'] = decodeURIComponent(refreshedXsrf)
      } else {
        delete retryHeaders['X-XSRF-TOKEN']
      }
      res = await runFetch(retryHeaders)
    } catch (error) {
      if (isAbortError(error)) {
        if (getAbortReason(signal) === 'timeout') {
          return {
            data: null,
            error: makeError(
              `Request ke server API timeout (${API_URL}). Coba lagi beberapa saat.`,
              0,
              'REQUEST_TIMEOUT'
            ),
            raw: null,
            aborted: true
          }
        }

        return {
          data: null,
          error: makeError('Request dibatalkan', 0, 'REQUEST_ABORTED'),
          raw: null,
          aborted: true
        }
      }

      if (!isAbortError(error)) {
        markApiUnavailable({ path, status: 0 })
      }

      return {
        data: null,
        error: makeError(
          `Tidak bisa terhubung ke server API (${API_URL}).`,
          0,
          'NETWORK_ERROR'
        ),
        raw: null
      }
    }
  }

  let json = null
  try {
    json = await res.json()
  } catch { }

  if (!res.ok) {
    if (isTransientApiStatus(res.status)) {
      markApiUnavailable({ path, status: res.status })
      return makeApiUnavailableResult({
        path,
        status: res.status,
        retryAfterMs: getApiUnavailableDelayMs()
      })
    }

    if (isSessionExpiredStatus(res.status) && !shouldIgnoreSessionExpiredHandling(path)) {
      notifySessionExpired({
        path,
        status: res.status,
        message: SESSION_EXPIRED_MESSAGE
      })

      return {
        data: null,
        error: makeError(SESSION_EXPIRED_MESSAGE, res.status, 'SESSION_EXPIRED'),
        raw: json
      }
    }

    return {
      data: null,
      error: makeError(json?.error || json?.message || res.statusText, res.status, json?.code || json?.reason, {
        retryAfter: json?.retry_after ?? json?.retry_after_seconds ?? null
      }),
      raw: json
    }
  }

  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    options.invalidateCache !== false &&
    !isCacheableApiRequest(path, method, body, options)
  ) {
    invalidateDbSelectCache()
  }

  return {
    data: json?.data ?? json,
    error: null,
    raw: json
  }
}

const revalidatePersistedApiResponse = (path, options, dedupeKey, cacheTtlMs, staleCacheTtlMs) => {
  if (!dedupeKey || persistedApiRevalidations.has(dedupeKey)) return

  const refreshOptions = {
    ...options,
    cacheTtlMs: 0,
    dedupe: false,
    persistCache: false,
    signal: undefined,
    staleKey: ''
  }

  const task = runApiFetch(path, refreshOptions)
    .then((result) => {
      const hasBatchErrors = Object.keys(result?.raw?.errors || {}).length > 0
      if (!result?.error && !hasBatchErrors) {
        setCachedApiResponse(dedupeKey, result, cacheTtlMs)
        setPersistedApiResponse(dedupeKey, result, cacheTtlMs, {
          staleTtlMs: staleCacheTtlMs
        })
      }
    })
    .catch(() => {
      // Keep stale cache available; the foreground request should stay smooth.
    })
    .finally(() => {
      persistedApiRevalidations.delete(dedupeKey)
    })

  persistedApiRevalidations.set(dedupeKey, task)
}

const createAbortableOptions = (path, method, options = {}) => {
  const canAbort = typeof AbortController !== 'undefined'
  const staleKey = options.staleKey ? String(options.staleKey) : ''
  const timeoutMs = Number(options.timeoutMs || 0)
  const needsController = canAbort && (staleKey || timeoutMs > 0 || options.signal)

  if (!needsController) {
    return {
      options,
      cleanup: () => {}
    }
  }

  const controller = new AbortController()
  let timeoutId = null
  const externalSignal = options.signal

  if (staleKey) {
    const previous = staleRequestControllers.get(staleKey)
    if (previous && !previous.signal.aborted) {
      setAbortReason(previous.signal, 'stale')
      previous.abort()
    }
    staleRequestControllers.set(staleKey, controller)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      setAbortReason(controller.signal, 'external')
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', () => {
        setAbortReason(controller.signal, 'external')
        controller.abort()
      }, { once: true })
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      setAbortReason(controller.signal, 'timeout')
      controller.abort()
    }, timeoutMs)
  }

  return {
    options: {
      ...options,
      signal: controller.signal
    },
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (staleKey && staleRequestControllers.get(staleKey) === controller) {
        staleRequestControllers.delete(staleKey)
      }
    }
  }
}

export const apiFetch = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase()
  const dedupeKey = buildPendingRequestKey(path, method, options.body, options)
  const cacheTtlMs = options.cacheTtlMs === undefined
    ? DEFAULT_DB_SELECT_CACHE_TTL_MS
    : Number(options.cacheTtlMs)
  const canUseCache =
    dedupeKey &&
    Number.isFinite(cacheTtlMs) &&
    cacheTtlMs > 0 &&
    isCacheableApiRequest(path, method, options.body, options)

  if (canUseCache) {
    const cached = getCachedApiResponse(dedupeKey)
    if (cached) return cached
    if (canPersistApiCache(path, method, options)) {
      const staleCacheTtlMs = Number(options.staleCacheTtlMs || DEFAULT_PERSISTED_API_STALE_TTL_MS)
      const persisted = getPersistedApiResponse(dedupeKey, {
        allowStale: options.returnStaleCache !== false,
      })

      if (persisted?.value) {
        const cachedTtl = persisted.stale ? Math.min(cacheTtlMs, 3000) : cacheTtlMs
        setCachedApiResponse(dedupeKey, persisted.value, cachedTtl)

        if (persisted.stale && options.revalidateOnStale !== false) {
          revalidatePersistedApiResponse(path, options, dedupeKey, cacheTtlMs, staleCacheTtlMs)
        }

        return {
          ...persisted.value,
          cache: {
            persisted: true,
            stale: persisted.stale
          }
        }
      }
    }
  }

  if (!dedupeKey) {
    const abortable = createAbortableOptions(path, method, options)
    return runApiFetch(path, abortable.options).finally(abortable.cleanup)
  }

  const pending = pendingApiRequests.get(dedupeKey)
  if (pending) return pending

  const abortable = createAbortableOptions(path, method, options)
  const request = runApiFetch(path, abortable.options)
    .then((result) => {
      const hasBatchErrors = Object.keys(result?.raw?.errors || {}).length > 0
      if (canUseCache && !result?.error && !hasBatchErrors) {
        setCachedApiResponse(dedupeKey, result, cacheTtlMs)
        if (canPersistApiCache(path, method, options) && options.persistCache !== false) {
          setPersistedApiResponse(dedupeKey, result, cacheTtlMs, {
            staleTtlMs: Number(options.staleCacheTtlMs || DEFAULT_PERSISTED_API_STALE_TTL_MS)
          })
        }
      }
      return result
    })
    .finally(() => {
      abortable.cleanup()
      pendingApiRequests.delete(dedupeKey)
    })
  pendingApiRequests.set(dedupeKey, request)

  return request
}

const apiUploadFormData = async (path, form, options = {}) => {
  try {
    await ensureCsrf()
  } catch {
    return {
      data: null,
      error: makeError(
        `Tidak bisa terhubung ke server API (${API_URL}).`,
        0,
        'NETWORK_ERROR'
      ),
      raw: null
    }
  }

  const uploadOnce = () => new Promise((resolve) => {
    if (typeof XMLHttpRequest === 'undefined') {
      resolve(apiFetch(path, { method: 'POST', body: form, signal: options.signal }))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    if (TENANT_SLUG) xhr.setRequestHeader('X-Tenant', TENANT_SLUG)
    const xsrf = getCookie('XSRF-TOKEN')
    if (xsrf) xhr.setRequestHeader('X-XSRF-TOKEN', decodeURIComponent(xsrf))

    if (xhr.upload && typeof options.onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !event.total) return
        const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
        options.onProgress(progress, event)
      }
    }

    const cleanup = () => {
      if (options.signal) options.signal.removeEventListener('abort', abortHandler)
    }

    const parseBody = () => {
      try {
        return xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        return null
      }
    }

    const abortHandler = () => {
      xhr.abort()
      cleanup()
      resolve({
        data: null,
        error: makeError('Request dibatalkan', 0, 'REQUEST_ABORTED'),
        raw: null,
        aborted: true
      })
    }

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler()
        return
      }
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }

    xhr.onload = () => {
      cleanup()
      const raw = parseBody()
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = raw?.error || raw?.message || xhr.statusText || 'Upload gagal'
        if (isSessionExpiredStatus(xhr.status) && !shouldIgnoreSessionExpiredHandling(path)) {
          notifySessionExpired({
            path,
            status: xhr.status,
            message: SESSION_EXPIRED_MESSAGE
          })
          resolve({
            data: null,
            error: makeError(SESSION_EXPIRED_MESSAGE, xhr.status, 'SESSION_EXPIRED'),
            raw
          })
          return
        }
        resolve({
          data: null,
          error: makeError(message, xhr.status, raw?.code || null),
          raw
        })
        return
      }

      resolve({ data: raw?.data ?? raw, error: null, raw })
    }

    xhr.onerror = () => {
      cleanup()
      resolve({
        data: null,
        error: makeError(
          `Tidak bisa terhubung ke server API (${API_URL}).`,
          0,
          'NETWORK_ERROR'
        ),
        raw: null
      })
    }

    xhr.send(form)
  })

  let result = await uploadOnce()
  if (result?.raw === null && result?.error?.code === 'REQUEST_ABORTED') return result

  if (result?.error?.status === 419) {
    csrfReady = false
    try {
      await ensureCsrf(true)
      result = await uploadOnce()
    } catch { }
  }

  return result
}

const apiUploadDirectObject = async (upload, file, options = {}) => new Promise((resolve) => {
  if (!upload?.url || !file) {
    resolve({
      data: null,
      error: makeError('Signed upload URL tidak tersedia', 422, 'DIRECT_UPLOAD_INVALID'),
      raw: null
    })
    return
  }

  if (typeof XMLHttpRequest === 'undefined') {
    fetch(upload.url, {
      method: upload.method || 'PUT',
      headers: upload.headers || {},
      body: file,
      credentials: 'omit',
      signal: options.signal
    })
      .then((response) => {
        if (!response.ok) {
          resolve({
            data: null,
            error: makeError('Upload object storage gagal', response.status, 'DIRECT_UPLOAD_FAILED'),
            raw: null
          })
          return
        }
        resolve({ data: { uploaded: true }, error: null, raw: null })
      })
      .catch((error) => {
        resolve({
          data: null,
          error: makeError(
            error?.name === 'AbortError'
              ? 'Request dibatalkan'
              : 'Upload langsung ke object storage gagal. Periksa koneksi atau konfigurasi CORS bucket.',
            error?.name === 'AbortError' ? 0 : 502,
            error?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'DIRECT_UPLOAD_NETWORK_ERROR'
          ),
          raw: null,
          aborted: error?.name === 'AbortError'
        })
      })
    return
  }

  const xhr = new XMLHttpRequest()
  xhr.open(upload.method || 'PUT', upload.url)
  xhr.withCredentials = false
  xhr.timeout = directUploadObjectTimeoutMs

  Object.entries(upload.headers || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      xhr.setRequestHeader(key, String(value))
    }
  })

  if (xhr.upload && typeof options.onProgress === 'function') {
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return
      const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
      options.onProgress(progress, event)
    }
  }

  const cleanup = () => {
    if (options.signal) options.signal.removeEventListener('abort', abortHandler)
  }

  const abortHandler = () => {
    xhr.abort()
    cleanup()
    resolve({
      data: null,
      error: makeError('Request dibatalkan', 0, 'REQUEST_ABORTED'),
      raw: null,
      aborted: true
    })
  }

  if (options.signal) {
    if (options.signal.aborted) {
      abortHandler()
      return
    }
    options.signal.addEventListener('abort', abortHandler, { once: true })
  }

  xhr.onload = () => {
    cleanup()
    if (xhr.status < 200 || xhr.status >= 300) {
      resolve({
        data: null,
        error: makeError(
          xhr.statusText || 'Upload object storage gagal',
          xhr.status || 502,
          'DIRECT_UPLOAD_FAILED'
        ),
        raw: xhr.responseText || null
      })
      return
    }

    resolve({ data: { uploaded: true }, error: null, raw: xhr.responseText || null })
  }

  xhr.onerror = () => {
    cleanup()
    resolve({
      data: null,
      error: makeError(
        'Upload langsung ke object storage gagal. Periksa koneksi atau konfigurasi CORS bucket.',
        502,
        'DIRECT_UPLOAD_NETWORK_ERROR'
      ),
      raw: null
    })
  }

  xhr.ontimeout = () => {
    cleanup()
    resolve({
      data: null,
      error: makeError(
        'Upload langsung ke object storage terlalu lama. Sistem akan mencoba jalur server.',
        504,
        'DIRECT_UPLOAD_TIMEOUT'
      ),
      raw: null
    })
  }

  xhr.send(file)
})

export const buildQueryString = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      const filtered = value.map((item) => String(item ?? '').trim()).filter(Boolean)
      if (filtered.length) query.set(String(key), filtered.join(','))
      return
    }
    query.set(String(key), String(value))
  })
  return query.toString() ? `?${query.toString()}` : ''
}

const parseDownloadFilename = (contentDisposition = '', fallback = 'download.bin') => {
  const header = String(contentDisposition || '')
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1])
    } catch {
      return utfMatch[1]
    }
  }

  const plainMatch = header.match(/filename="?([^";]+)"?/i)
  if (plainMatch?.[1]) return plainMatch[1]

  return fallback
}

export const downloadAuthenticatedFile = async (path, fallbackName = 'download.bin') => {
  const headers = {}
  if (TENANT_SLUG) {
    headers['X-Tenant'] = TENANT_SLUG
  }

  let res
  try {
    res = await fetchWithTransientRetry(`${API_URL}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers
    }, { method: 'GET' })
  } catch {
    return {
      data: null,
      error: makeError(
        `Tidak bisa terhubung ke server API (${API_URL}).`,
        0,
        'NETWORK_ERROR'
      )
    }
  }

  if (!res.ok) {
    let message = res.statusText || 'Gagal mengunduh file'
    try {
      const json = await res.json()
      message = json?.error || json?.message || message
    } catch { }

    if (isSessionExpiredStatus(res.status) && !shouldIgnoreSessionExpiredHandling(path)) {
      notifySessionExpired({
        path,
        status: res.status,
        message: SESSION_EXPIRED_MESSAGE
      })
      return {
        data: null,
        error: makeError(SESSION_EXPIRED_MESSAGE, res.status, 'SESSION_EXPIRED')
      }
    }

    return { data: null, error: makeError(message, res.status) }
  }

  const blob = await res.blob()
  if (typeof document === 'undefined') {
    return { data: { downloaded: true }, error: null }
  }

  const filename = parseDownloadFilename(
    res.headers.get('content-disposition'),
    fallbackName
  )
  const downloadUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)

  return { data: { downloaded: true, filename }, error: null }
}

/* ===================== QUERY BUILDER ===================== */
class QueryBuilder {
  constructor(table) {
    this.table = table
    this.action = 'select'
    this.columns = '*'
    this.options = {}
    this.filters = { eq: {}, neq: {}, is: {}, in: {}, gte: {}, lte: {}, gt: {}, lt: {}, ilike: {} }
    this.orderBy = []
    this.limitValue = null
    this.offsetValue = null
    this.payload = null
    this.onConflict = null
    this.singleFlag = false
    this.allowEmpty = false
  }

  select(columns = '*', options = {}) {
    this.columns = columns
    this.options = options || {}
    // Supabase compatibility: allow .insert(...).select().single()
    // without changing action back to "select".
    if (!['insert', 'update', 'upsert', 'delete'].includes(this.action)) {
      this.action = 'select'
    }
    return this
  }

  insert(payload) {
    this.action = 'insert'
    this.payload = payload
    return this
  }

  update(payload) {
    this.action = 'update'
    this.payload = payload
    return this
  }

  upsert(payload, options = {}) {
    this.action = 'upsert'
    this.payload = payload
    this.onConflict = options?.onConflict || null
    return this
  }

  delete() {
    this.action = 'delete'
    return this
  }

  eq(field, value) {
    this.filters.eq[field] = value
    return this
  }

  match(values = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return this
    }

    Object.entries(values).forEach(([field, value]) => {
      if (value !== undefined) {
        this.filters.eq[field] = value
      }
    })

    return this
  }

  neq(field, value) {
    this.filters.neq[field] = value
    return this
  }

  is(field, value) {
    this.filters.is[field] = value
    return this
  }

  in(field, values) {
    this.filters.in[field] = values
    return this
  }

  gte(field, value) {
    this.filters.gte[field] = value
    return this
  }

  lte(field, value) {
    this.filters.lte[field] = value
    return this
  }

  gt(field, value) {
    this.filters.gt[field] = value
    return this
  }

  lt(field, value) {
    this.filters.lt[field] = value
    return this
  }

  ilike(field, value) {
    this.filters.ilike[field] = value
    return this
  }

  order(field, options = {}) {
    const dir = options?.ascending === false ? 'desc' : 'asc'
    this.orderBy.push({ field, dir })
    return this
  }

  limit(count) {
    this.limitValue = count
    return this
  }

  range(from, to) {
    this.offsetValue = from
    this.limitValue = Math.max(0, to - from + 1)
    return this
  }

  single() {
    this.singleFlag = true
    this.allowEmpty = false
    return this
  }

  maybeSingle() {
    this.singleFlag = true
    this.allowEmpty = true
    return this
  }

  toRequestBody() {
    return {
      table: this.table,
      action: this.action,
      columns: this.columns,
      filters: this.filters,
      order: this.orderBy,
      limit: this.limitValue,
      offset: this.offsetValue,
      payload: this.payload,
      onConflict: this.onConflict,
      count: this.options?.count || null,
      head: this.options?.head || false
    }
  }

  formatResponse(res) {
    const count = res.raw?.count ?? null

    if (res.error) {
      return { data: null, error: res.error, count }
    }

    let data = res.raw?.data ?? res.data

    if (this.action !== 'select') {
      invalidateDbSelectCache(this.table)
      pulseRealtimeForMutation(this.table)
    }

    if (this.singleFlag) {
      if (Array.isArray(data)) {
        if (data.length === 1) {
          data = data[0]
        } else if (data.length === 0) {
          if (this.allowEmpty) return { data: null, error: null, count }
          return { data: null, error: makeError('No rows', 406, 'PGRST116'), count }
        } else {
          return { data: null, error: makeError('Multiple rows', 406, 'PGRST116'), count }
        }
      }
    }

    return { data, error: null, count }
  }

  async execute() {
    const res = await apiFetch('/api/db', { method: 'POST', body: this.toRequestBody() })
    return this.formatResponse(res)
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

const dbBatch = async (items = []) => {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const query = item?.query || item?.builder
      const key = String(item?.key ?? index)
      return { key, query }
    })
    .filter(({ query }) => query instanceof QueryBuilder)

  if (normalizedItems.length === 0) {
    return { data: {}, error: null, errors: {} }
  }

  const body = {
    requests: normalizedItems.map(({ key, query }) => ({
      key,
      ...query.toRequestBody()
    }))
  }

  const res = await apiFetch('/api/db/batch', { method: 'POST', body })
  if (res.error) {
    return { data: null, error: res.error, errors: {} }
  }

  const rawData = res.raw?.data ?? res.data ?? {}
  const rawErrors = res.raw?.errors || {}
  const data = {}

  normalizedItems.forEach(({ key, query }) => {
    const item = rawData?.[key]
    if (!item) {
      const batchError = rawErrors?.[key]
      data[key] = {
        data: null,
        count: null,
        error: batchError
          ? makeError(batchError.message || 'Request batch gagal', batchError.status || 500, batchError.code)
          : makeError('Response batch tidak lengkap', 502, 'BATCH_RESPONSE_MISSING')
      }
      return
    }

    data[key] = query.formatResponse({
      data: item.data,
      error: null,
      raw: item
    })
  })

  const hasErrors = Object.keys(rawErrors).length > 0
  return {
    data,
    error: hasErrors ? makeError('Sebagian request batch gagal', 207, 'BATCH_PARTIAL_ERROR') : null,
    errors: rawErrors
  }
}

/* ===================== STORAGE ===================== */
const signedUrlCache = new Map()
const signedUrlCacheKey = (bucket, path) => `${bucket}:${String(path || '').replace(/\\/g, '/')}`
const getCachedSignedUrl = (bucket, path) => {
  const cached = signedUrlCache.get(signedUrlCacheKey(bucket, path))
  if (!cached || cached.expiresAt <= Date.now() + 30 * 1000) {
    signedUrlCache.delete(signedUrlCacheKey(bucket, path))
    return null
  }
  return cached.data
}
const setCachedSignedUrl = (bucket, path, data, expiresInSec) => {
  const ttlMs = Math.max(30 * 1000, (Number(expiresInSec) || 900) * 1000 - 30 * 1000)
  signedUrlCache.set(signedUrlCacheKey(bucket, path), {
    data,
    expiresAt: Date.now() + ttlMs
  })
}
const invalidateSignedUrlCache = (bucket, path) => {
  signedUrlCache.delete(signedUrlCacheKey(bucket, path))
}

class StorageBucket {
  constructor(bucket) {
    this.bucket = bucket
  }

  async upload(path, file, options = {}) {
    let uploadFile = file
    let forceServerObjectRelay = false
    const maxImageBytes = resolveImageUploadLimitBytes(this.bucket, path, file)

    if (maxImageBytes) {
      try {
        uploadFile = await compressImageToTarget(file, maxImageBytes)
      } catch (error) {
        return {
          data: null,
          error: makeError(
            error?.message ||
            `Gagal memproses gambar. Maksimal ${Math.floor(maxImageBytes / 1024)}KB.`,
            422,
            'IMAGE_COMPRESSION_FAILED'
          )
        }
      }
    }

    if (
      DIRECT_UPLOAD_BUCKETS.has(this.bucket) &&
      !options?.fastLocal &&
      options?.skipDirectUpload !== true &&
      !shouldUseServerRelayForSmallUpload(this.bucket, uploadFile, options) &&
      !isDirectUploadCoolingDown(this.bucket)
    ) {
      const direct = await this.directUpload(path, uploadFile, {
        ...options,
        originalFile: file
      })

      if (direct?.attempted && !direct.error) {
        clearDirectUploadCooldown(this.bucket)
        return { data: direct.data, error: null }
      }

      if (direct?.attempted && direct.error && !direct.canFallback) {
        return { data: null, error: direct.error }
      }

      if (direct?.attempted && direct.error && direct.canFallback) {
        if (shouldCooldownDirectUploadError(direct.error)) {
          markDirectUploadCooldown(this.bucket)
        }
        forceServerObjectRelay = true
        console.warn('Direct storage upload gagal, fallback ke upload API:', direct.error)
      }
    } else if (shouldUseServerRelayForSmallUpload(this.bucket, uploadFile, options)) {
      forceServerObjectRelay = true
    }

    const form = new FormData()
    form.append('bucket', this.bucket)
    form.append('path', path)
    form.append('file', uploadFile)
    if (options?.upsert) form.append('upsert', 'true')
    if (options?.fastLocal || options?.skipDrive || forceServerObjectRelay) form.append('fast_local', 'true')

    const res = typeof options?.onProgress === 'function'
      ? await apiUploadFormData('/api/storage/upload', form, {
        signal: options.signal,
        onProgress: options.onProgress
      })
      : await apiFetch('/api/storage/upload', { method: 'POST', body: form, signal: options.signal })

    const rawData = res.raw?.data ?? res.data
    const baseData = rawData && typeof rawData === 'object' ? { ...rawData } : { value: rawData }

    if (!res.error) {
      invalidateSignedUrlCache(this.bucket, path)
      const originalSize = Number(file?.size || 0)
      const uploadedSize = Number(baseData.uploadedSizeBytes || uploadFile?.size || 0)
      baseData.originalSizeBytes = originalSize
      baseData.uploadedSizeBytes = uploadedSize
      baseData.uploadedSizeLabel = formatBytesLabel(uploadedSize)
      baseData.isCompressed = uploadedSize > 0 && originalSize > 0 && uploadedSize !== originalSize
    }

    return { data: baseData, error: res.error }
  }

  async directUpload(path, file, options = {}) {
    const initiate = await apiFetch('/api/storage/direct-upload', {
      method: 'POST',
      body: {
        bucket: this.bucket,
        path,
        filename: file?.name || path.split('/').pop() || 'file',
        mime_type: file?.type || '',
        size_bytes: Number(file?.size || 0),
        upsert: Boolean(options?.upsert)
      },
      cacheTtlMs: 0,
      signal: options.signal
    })

    if (initiate.error) {
      return {
        attempted: true,
        canFallback: false,
        data: null,
        error: initiate.error
      }
    }

    const directData = initiate.raw?.data ?? initiate.data
    if (!directData?.available || !directData?.upload?.url) {
      return { attempted: false, canFallback: true, data: null, error: null }
    }

    const uploadResult = await apiUploadDirectObject(directData.upload, file, {
      signal: options.signal,
      onProgress: options.onProgress
    })

    if (uploadResult.error) {
      return {
        attempted: true,
        canFallback: uploadResult.error?.code !== 'REQUEST_ABORTED',
        data: null,
        error: uploadResult.error
      }
    }

    const confirmBody = {
      bucket: this.bucket,
      path: directData.path || path,
      provider: 'object_storage',
      filename: file?.name || path.split('/').pop() || 'file',
      mime_type: directData.contentType || file?.type || '',
      size_bytes: Number(file?.size || 0),
      object_key: directData.objectKey || ''
    }
    let confirm = null
    for (const delayMs of DIRECT_UPLOAD_CONFIRM_RETRY_DELAYS_MS) {
      const shouldContinue = await waitForDirectUploadRetry(delayMs, options.signal)
      if (!shouldContinue) {
        return {
          attempted: true,
          canFallback: false,
          data: null,
          error: makeError('Request dibatalkan', 0, 'REQUEST_ABORTED')
        }
      }

      confirm = await apiFetch('/api/storage/confirm-upload', {
        method: 'POST',
        body: confirmBody,
        cacheTtlMs: 0,
        signal: options.signal
      })

      if (!confirm.error || !shouldRetryDirectUploadConfirm(confirm)) {
        break
      }
    }

    if (confirm.error) {
      return {
        attempted: true,
        canFallback: isDirectUploadVerificationError(confirm.error),
        data: null,
        error: confirm.error
      }
    }

    invalidateSignedUrlCache(this.bucket, path)
    const originalSize = Number(options?.originalFile?.size || file?.size || 0)
    const uploadedSize = Number(file?.size || 0)
    return {
      attempted: true,
      canFallback: false,
      data: {
        path: directData.path || path,
        fullPath: directData.fullPath || directData.path || path,
        bucket: this.bucket,
        physicalBucket: directData.physicalBucket || '',
        objectKey: directData.objectKey || '',
        provider: 'object_storage',
        providerLabel: directData.providerLabel || 'Object Storage',
        browserDirect: true,
        uploadedSizeBytes: uploadedSize,
        uploadedSizeLabel: formatBytesLabel(uploadedSize),
        originalSizeBytes: originalSize,
        isCompressed: uploadedSize > 0 && originalSize > 0 && uploadedSize !== originalSize
      },
      error: null
    }
  }

  async uploadDestination({ filename = '', mime_type = '', mime = '' } = {}) {
    const res = await apiFetch('/api/storage/upload-destination', {
      method: 'POST',
      body: {
        bucket: this.bucket,
        filename,
        mime_type: mime_type || mime
      }
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  }

  async update(path, file, options = {}) {
    return this.upload(path, file, { ...options, upsert: true })
  }

  async remove(paths) {
    const list = (Array.isArray(paths) ? paths : [paths]).map((item) => {
      const raw = String(item || '').trim()
      const normalizedRaw = raw.replace(/\\/g, '/').replace(/^\/+/, '')
      if (
        this.bucket === QUIZ_MEDIA_BUCKET &&
        (normalizedRaw.startsWith(`${QUIZ_MEDIA_BUCKET}/`) || /^https?:\/\/(?:drive|docs)\.google\.com\//i.test(raw))
      ) {
        return raw
      }
      const parsed = extractObjectPath(this.bucket, item)
      return parsed || item
    })
    const res = await apiFetch('/api/storage/remove', {
      method: 'POST',
      body: { bucket: this.bucket, paths: list }
    })
    if (!res.error) {
      list.forEach((path) => invalidateSignedUrlCache(this.bucket, path))
    }
    return { data: res.raw?.data ?? res.data, error: res.error }
  }

  async createSignedUrl(path, expiresInSec = 900) {
    const normalized = extractObjectPath(this.bucket, path) || path
    const cached = getCachedSignedUrl(this.bucket, normalized)
    if (cached) return { data: cached, error: null }

    const res = await apiFetch(
      `/api/storage/signed?bucket=${encodeURIComponent(this.bucket)}&path=${encodeURIComponent(normalized)}&expires=${expiresInSec}`,
      { method: 'GET' }
    )
    const data = res.raw?.data ?? res.data
    if (data?.signedUrl) {
      const resolvedData = { ...data, signedUrl: resolveApiAssetUrl(data.signedUrl) }
      setCachedSignedUrl(this.bucket, normalized, resolvedData, expiresInSec)
      return { data: resolvedData, error: res.error }
    }
    return { data, error: res.error }
  }

  getPublicUrl(path) {
    const publicUrl = `${API_URL}/api/storage/object?bucket=${encodeURIComponent(this.bucket)}&path=${encodeURIComponent(path)}`
    return { data: { publicUrl } }
  }

  async download(path) {
    const normalized = extractObjectPath(this.bucket, path) || path
    const url = `${API_URL}/api/storage/object?bucket=${encodeURIComponent(this.bucket)}&path=${encodeURIComponent(normalized)}`
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) {
        if (isSessionExpiredStatus(response.status)) {
          notifySessionExpired({
            path: url,
            status: response.status,
            message: SESSION_EXPIRED_MESSAGE
          })
          return {
            data: null,
            error: makeError(
              SESSION_EXPIRED_MESSAGE,
              response.status,
              'SESSION_EXPIRED'
            )
          }
        }
        return { data: null, error: makeError('Gagal mengunduh', response.status) }
      }
      const blob = await response.blob()
      return { data: blob, error: null }
    } catch (error) {
      return { data: null, error: makeError(error?.message || 'Gagal mengunduh') }
    }
  }
}

/* ===================== AUTH ===================== */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeProviderList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/g)
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  }
  return []
}

const collectUserProviders = (user = {}) => {
  const providers = [
    ...normalizeProviderList(user?.providers),
    ...normalizeProviderList(user?.app_metadata?.providers),
    ...normalizeProviderList(user?.user_metadata?.providers)
  ]

  if (Array.isArray(user?.identities)) {
    user.identities.forEach((identity) => {
      const provider = String(identity?.provider || '').trim().toLowerCase()
      if (provider) providers.push(provider)
    })
  }

  return Array.from(new Set(providers))
}

const isGoogleLinkedUser = (user = {}) => {
  const providers = collectUserProviders(user)
  if (providers.includes('google')) return true

  return Boolean(
    user?.google_linked ||
    user?.google_linked_at ||
    user?.google_id ||
    user?.google_sub ||
    user?.user_metadata?.google_linked ||
    user?.user_metadata?.google_linked_at ||
    user?.app_metadata?.google_linked
  )
}

const resolveVerifiedAt = (user = {}) => {
  const candidates = [
    user?.email_verified_at,
    user?.email_confirmed_at,
    user?.verified_at,
    user?.google_email_verified_at,
    user?.user_metadata?.email_verified_at,
    user?.user_metadata?.email_confirmed_at,
    user?.app_metadata?.email_verified_at
  ]

  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return null
}

const isEmailVerifiedUser = (user = {}, providers = []) => {
  const verifiedAt = resolveVerifiedAt(user)
  if (verifiedAt) return true

  const explicitFlag = Boolean(
    user?.email_verified ||
    user?.email_confirmed ||
    user?.user_metadata?.email_verified ||
    user?.app_metadata?.email_verified
  )
  if (explicitFlag) return true

  // Email Google selalu verified oleh provider.
  return providers.includes('google')
}

const buildAuthRedirectUrl = (baseUrl, params = {}) => {
  const input = String(baseUrl || '').trim()
  if (!input) return ''

  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : API_URL
    const url = new URL(input, baseOrigin)
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(String(key), String(value))
    })
    return url.toString()
  } catch {
    return ''
  }
}

const normalizeUser = (user, profile) => {
  if (!user) return null
  const role =
    profile?.role ||
    user?.app_metadata?.role ||
    user?.user_metadata?.role ||
    null
  const nama =
    profile?.nama ||
    user?.user_metadata?.nama ||
    user?.user_metadata?.name ||
    user?.name ||
    (user?.email ? user.email.split('@')[0] : null)
  const providers = collectUserProviders(user)
  const googleLinked = isGoogleLinkedUser(user)
  const verifiedAt = resolveVerifiedAt(user)
  const emailVerified = isEmailVerifiedUser(user, providers)

  const userMeta = isObject(user?.user_metadata) ? { ...user.user_metadata } : {}
  if (role) userMeta.role = role
  if (nama) {
    userMeta.nama = nama
    if (!userMeta.name) userMeta.name = nama
  }
  if (providers.length > 0) userMeta.providers = providers
  if (googleLinked) userMeta.google_linked = true
  if (emailVerified) userMeta.email_verified = true

  const appMeta = isObject(user?.app_metadata) ? { ...user.app_metadata } : {}
  if (role) appMeta.role = role
  if (providers.length > 0) appMeta.providers = providers

  return {
    ...user,
    email_confirmed_at: verifiedAt,
    emailVerified,
    providers,
    google_linked: googleLinked,
    user_metadata: userMeta,
    app_metadata: appMeta
  }
}

const auth = {
  isGoogleEnabled() {
    return GOOGLE_AUTH_ENABLED
  },

  getGoogleClientId() {
    return GOOGLE_CLIENT_ID
  },

  async waitForSessionReady({
    attempts = 8,
    delayMs = 350
  } = {}) {
    const maxAttempts = Math.max(1, Number(attempts) || 1)
    const retryDelayMs = Math.max(0, Number(delayMs) || 0)
    let lastError = null

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const res = await apiFetch('/api/auth/me', {
        method: 'GET',
        cacheTtlMs: 0,
        persistCache: false
      })

      if (!res.error) {
        const profile = res.raw?.data?.profile || null
        const user = normalizeUser(res.raw?.data?.user, profile)
        const settings = res.raw?.data?.settings || null
        const hasSuperAdminFlag = Object.prototype.hasOwnProperty.call(res.raw?.data || {}, 'is_super_admin')
        const isSuperAdmin = Boolean(res.raw?.data?.is_super_admin)

        if (user && profile) {
          return {
            data: {
              isSuperAdmin,
              settings,
              superAdminChecked: hasSuperAdminFlag,
              profile,
              session: { user, profile, settings, isSuperAdmin, superAdminChecked: hasSuperAdminFlag },
              user
            },
            error: null
          }
        }

        lastError = makeError('Sesi login belum siap.', 0, 'AUTH_SESSION_NOT_READY')
      } else {
        lastError = res.error
      }

      if (attempt < maxAttempts - 1 && retryDelayMs > 0) {
        await wait(retryDelayMs)
      }
    }

    return {
      data: { session: null, user: null, profile: null },
      error: lastError || makeError('Sesi login belum siap.', 0, 'AUTH_SESSION_NOT_READY')
    }
  },

  getProviderState(user) {
    const providers = collectUserProviders(user || {})
    return {
      providers,
      googleLinked: isGoogleLinkedUser(user || {}),
      emailVerified: isEmailVerifiedUser(user || {}, providers)
    }
  },

  async signInWithPassword({ email, password }) {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    })

    if (res.error) return { data: null, error: res.error }

    invalidateDbSelectCache()

    const profile = res.raw?.data?.profile || null
    const user = normalizeUser(res.raw?.data?.user, profile)
    const settings = res.raw?.data?.settings || null
    const hasSuperAdminFlag = Object.prototype.hasOwnProperty.call(res.raw?.data || {}, 'is_super_admin')
    const isSuperAdmin = Boolean(res.raw?.data?.is_super_admin)

    if (user && profile) {
      return {
        data: {
          user,
          profile,
          settings,
          isSuperAdmin,
          superAdminChecked: hasSuperAdminFlag,
          session: { user, profile, settings, isSuperAdmin, superAdminChecked: hasSuperAdminFlag }
        },
        error: null
      }
    }

    const ready = await this.waitForSessionReady()
    if (!ready.error && ready.data?.user && ready.data?.profile) {
      return { data: ready.data, error: null }
    }

    return { data: { user, profile, session: user ? { user, profile } : null }, error: null }
  },

  async signInWithGoogle(options = {}) {
    const redirectTo =
      options?.redirectTo ||
      (typeof window !== 'undefined'
        ? `${window.location.origin}/login`
        : '')

    const redirectUrl = buildAuthRedirectUrl(GOOGLE_AUTH_LOGIN_URL, {
      redirect: redirectTo,
      next: redirectTo,
      tenant: TENANT_SLUG || undefined,
      mode: 'login'
    })

    if (!redirectUrl) {
      return {
        data: null,
        error: makeError(
          'URL login Google belum valid. Cek VITE_GOOGLE_AUTH_LOGIN_URL.',
          500,
          'GOOGLE_AUTH_URL_INVALID'
        )
      }
    }

    if (typeof window !== 'undefined' && options?.navigate !== false) {
      window.location.assign(redirectUrl)
    }

    return { data: { redirectUrl }, error: null }
  },

  async signInWithGoogleCode({ code }) {
    const res = await apiFetch('/api/auth/google/code-login', {
      method: 'POST',
      body: { code }
    })

    if (res.error) return { data: null, error: res.error }

    invalidateDbSelectCache()

    const profile = res.raw?.data?.profile || null
    const user = normalizeUser(res.raw?.data?.user, profile)
    const settings = res.raw?.data?.settings || null
    const hasSuperAdminFlag = Object.prototype.hasOwnProperty.call(res.raw?.data || {}, 'is_super_admin')
    const isSuperAdmin = Boolean(res.raw?.data?.is_super_admin)

    if (user && profile) {
      return {
        data: {
          user,
          profile,
          settings,
          isSuperAdmin,
          superAdminChecked: hasSuperAdminFlag,
          session: { user, profile, settings, isSuperAdmin, superAdminChecked: hasSuperAdminFlag }
        },
        error: null
      }
    }

    const ready = await this.waitForSessionReady()
    if (!ready.error && ready.data?.user && ready.data?.profile) {
      return { data: ready.data, error: null }
    }

    return {
      data: {
        user,
        profile,
        session: user ? { user, profile } : null
      },
      error: null
    }
  },

  async signInWithGoogleCredential({ credential }) {
    const res = await apiFetch('/api/auth/google/credential-login', {
      method: 'POST',
      body: { credential }
    })

    if (res.error) return { data: null, error: res.error }

    invalidateDbSelectCache()

    const profile = res.raw?.data?.profile || null
    const user = normalizeUser(res.raw?.data?.user, profile)
    const settings = res.raw?.data?.settings || null
    const hasSuperAdminFlag = Object.prototype.hasOwnProperty.call(res.raw?.data || {}, 'is_super_admin')
    const isSuperAdmin = Boolean(res.raw?.data?.is_super_admin)

    if (user && profile) {
      return {
        data: {
          user,
          profile,
          settings,
          isSuperAdmin,
          superAdminChecked: hasSuperAdminFlag,
          session: { user, profile, settings, isSuperAdmin, superAdminChecked: hasSuperAdminFlag }
        },
        error: null
      }
    }

    const ready = await this.waitForSessionReady()
    if (!ready.error && ready.data?.user && ready.data?.profile) {
      return { data: ready.data, error: null }
    }

    return {
      data: {
        user,
        profile,
        session: user ? { user, profile } : null
      },
      error: null
    }
  },

  async linkGoogleCredential({ credential }) {
    const res = await apiFetch('/api/auth/google/credential-link', {
      method: 'POST',
      body: { credential }
    })

    if (res.error) return { data: null, error: res.error }

    const user = normalizeUser(res.raw?.data?.user, res.raw?.data?.profile)

    return {
      data: {
        user,
        profile: res.raw?.data?.profile || null
      },
      error: null
    }
  },

  async linkGoogleAccount(options = {}) {
    const redirectTo =
      options?.redirectTo ||
      (typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : '')

    const redirectUrl = buildAuthRedirectUrl(GOOGLE_AUTH_LINK_URL, {
      redirect: redirectTo,
      next: redirectTo,
      tenant: TENANT_SLUG || undefined,
      mode: 'link'
    })

    if (!redirectUrl) {
      return {
        data: null,
        error: makeError(
          'URL tautkan Google belum valid. Cek VITE_GOOGLE_AUTH_LINK_URL.',
          500,
          'GOOGLE_AUTH_URL_INVALID'
        )
      }
    }

    if (typeof window !== 'undefined' && options?.navigate !== false) {
      window.location.assign(redirectUrl)
    }

    return { data: { redirectUrl }, error: null }
  },

  async unlinkGoogleAccount() {
    const res = await apiFetch('/api/auth/google/unlink', {
      method: 'POST'
    })
    if (res.error) return { data: null, error: res.error }

    const user = normalizeUser(res.raw?.data?.user, res.raw?.data?.profile)
    return { data: { user }, error: null }
  },

  async signUp({ email, password, options = {} }) {
    const role = options?.data?.role || 'siswa'
    const nama = options?.data?.nama || options?.data?.name || email?.split('@')[0] || 'User'

    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: { email, password, role, nama }
    })

    if (res.error) return { data: null, error: res.error }

    const user = normalizeUser(res.raw?.data?.user, res.raw?.data?.profile)
    return { data: { user, session: null }, error: null }
  },

  async signOut() {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' })
    invalidateDbSelectCache()
    return { error: res.error }
  },

  async getSecurityOverview() {
    const res = await apiFetch('/api/auth/security', {
      method: 'GET',
      cacheTtlMs: 0,
      persistCache: false
    })
    if (res.error) return { data: null, error: res.error }
    return { data: res.data || null, error: null }
  },

  async logoutOtherDevices({ password } = {}) {
    const res = await apiFetch('/api/auth/logout-other-devices', {
      method: 'POST',
      body: { password }
    })
    invalidateDbSelectCache()
    if (res.error) return { data: null, error: res.error }
    return { data: res.data || null, error: null }
  },

  async getSession() {
    const res = await apiFetch('/api/auth/me', { method: 'GET' })
    if (res.error) return { data: { session: null }, error: res.error }
    const user = normalizeUser(res.raw?.data?.user, res.raw?.data?.profile)
    const profile = res.raw?.data?.profile || null
    const settings = res.raw?.data?.settings || null
    const hasSuperAdminFlag = Object.prototype.hasOwnProperty.call(res.raw?.data || {}, 'is_super_admin')
    const isSuperAdmin = Boolean(res.raw?.data?.is_super_admin)
    return {
      data: {
        isSuperAdmin,
        settings,
        superAdminChecked: hasSuperAdminFlag,
        profile,
        session: user ? { user, profile, settings, isSuperAdmin, superAdminChecked: hasSuperAdminFlag } : null
      },
      error: null
    }
  },

  async getUser() {
    const res = await apiFetch('/api/auth/me', { method: 'GET' })
    if (res.error) return { data: { user: null }, error: res.error }
    const user = normalizeUser(res.raw?.data?.user, res.raw?.data?.profile)
    return {
      data: {
        user,
        profile: res.raw?.data?.profile || null,
        settings: res.raw?.data?.settings || null,
        isSuperAdmin: Boolean(res.raw?.data?.is_super_admin)
      },
      error: null
    }
  },

  async resetPasswordForEmail(email) {
    const res = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email }
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async resetPassword({ email, token, password }) {
    const res = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: { email, token, password, password_confirmation: password }
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async updateUser({ email, password, verificationCode }) {
    const normalizedEmail = typeof email === 'string' ? email.trim() : ''
    const normalizedPassword = typeof password === 'string' ? password : ''

    if (normalizedEmail) {
      const body = {
        email: normalizedEmail
      }

      if (normalizedPassword) {
        body.password = normalizedPassword
        body.password_confirmation = normalizedPassword
      }
      if (verificationCode) {
        body.verification_code = verificationCode
      }

      const res = await apiFetch('/api/auth/update-account', {
        method: 'POST',
        body
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }

    const body = {
      password: normalizedPassword,
      password_confirmation: normalizedPassword
    }
    if (verificationCode) {
      body.verification_code = verificationCode
    }

    const res = await apiFetch('/api/auth/update-password', {
      method: 'POST',
      body
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async sendPasswordChangeCode(email = '') {
    const body = {}
    if (typeof email === 'string' && email.trim()) {
      body.email = email.trim()
    }

    const res = await apiFetch('/api/auth/password-change/send-code', {
      method: 'POST',
      body
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async resend() {
    const res = await apiFetch('/api/auth/verify-email/resend', {
      method: 'POST',
      body: {}
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async sendEmailVerificationCode() {
    const res = await apiFetch('/api/auth/email-verification/send-code', {
      method: 'POST',
      body: {}
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  async verifyEmailCode(code) {
    const res = await apiFetch('/api/auth/email-verification/verify-code', {
      method: 'POST',
      body: { code }
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },

  quiz: {
    async dashboard(params = {}) {
      const res = await apiFetch(`/api/quiz/dashboard${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 0,
        staleKey: `quiz.dashboard.${JSON.stringify(params || {})}`,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async detail(quizId, params = {}) {
      const id = encodeURIComponent(String(quizId || ''))
      const res = await apiFetch(`/api/quiz/${id}/detail${buildQueryString(params)}`, {
        method: 'GET',
        cacheTtlMs: 0,
        staleKey: `quiz.detail.${id}`,
        timeoutMs: 60000
      })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async start(payload) {
      const res = await apiFetch('/api/quiz/start', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async clone(payload) {
      const res = await apiFetch('/api/quiz/clone', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async saveAnswer(payload) {
      const res = await apiFetch('/api/quiz/answer', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async saveAnswersBatch(payload) {
      const res = await apiFetch('/api/quiz/answers/batch', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async submit(payload) {
      const res = await apiFetch('/api/quiz/submit', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error ? { ...res.error, ...(res.raw || {}) } : null }
    },
    async logViolation(payload) {
      const res = await apiFetch('/api/quiz/violation', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async schedule(payload) {
      const res = await apiFetch('/api/quiz/schedule', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async publish(payload) {
      const res = await apiFetch('/api/quiz/publish', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async close(payload) {
      const res = await apiFetch('/api/quiz/close', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async retake(payload) {
      const res = await apiFetch('/api/quiz/retake', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async retakeHistory(quizId) {
      const id = encodeURIComponent(String(quizId || ''))
      const res = await apiFetch(`/api/quiz/retake-history?quiz_id=${id}`, { method: 'GET' })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async restoreRetakeScore(payload) {
      const res = await apiFetch('/api/quiz/restore-retake-score', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async gradeEssay(payload) {
      const res = await apiFetch('/api/quiz/grade-essay', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async completeEssayReview(payload) {
      const res = await apiFetch('/api/quiz/complete-essay-review', { method: 'POST', body: payload })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }
  }
}

const reports = {
  async homeroomOptions() {
    const res = await apiFetch('/api/reports/homeroom-options', {
      method: 'GET',
      cacheTtlMs: 60 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: 'reports.homeroom-options'
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },
  async teacherSummary(params = {}) {
    const res = await apiFetch(`/api/reports/teacher-summary${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 30 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: `reports.teacher-summary.${params?.type || 'default'}`,
      timeoutMs: 90000
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },
  async attendanceSummary(params = {}) {
    const res = await apiFetch(`/api/reports/attendance-summary${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 30 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: 'reports.attendance-summary',
      timeoutMs: 90000
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },
  async taskSummary(params = {}) {
    const res = await apiFetch(`/api/reports/task-summary${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 30 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: 'reports.task-summary',
      timeoutMs: 90000
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },
  async quizSummary(params = {}) {
    const res = await apiFetch(`/api/reports/quiz-summary${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 30 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: 'reports.quiz-summary',
      timeoutMs: 90000
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  },
  async homeroomSummary(params = {}) {
    const res = await apiFetch(`/api/reports/homeroom-summary${buildQueryString(params)}`, {
      method: 'GET',
      cacheTtlMs: 30 * 1000,
      persistCache: true,
      staleCacheTtlMs: 10 * 60 * 1000,
      staleKey: 'reports.homeroom-summary',
      timeoutMs: 120000
    })
    return { data: res.raw?.data ?? res.data, error: res.error }
  }
}

const attendanceQr = {
  async session(payload = {}) {
    const res = await apiFetch('/api/attendance-qr/session', {
      method: 'POST',
      body: payload
    })

    return {
      data: res.raw?.data ?? res.data,
      error: res.error,
      raw: res.raw
    }
  },

  async scan(token) {
    const res = await apiFetch('/api/attendance-qr/scan', {
      method: 'POST',
      body: { token }
    })

    return {
      data: res.raw?.data ?? res.data,
      error: res.error,
      raw: res.raw
    }
  }
}

/* ===================== STORAGE HELPERS ===================== */
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v)

const resolveApiAssetUrl = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isHttpUrl(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw

  try {
    return new URL(raw, `${API_URL}/`).toString()
  } catch {
    return raw
  }
}

export const extractObjectPath = (bucket, urlOrPath) => {
  if (!urlOrPath || typeof urlOrPath !== 'string') return ''

  const normalizePathString = (rawValue) => {
    const raw = String(rawValue || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!raw) return ''

    const prefixes = [
      `private/${bucket}/`,
      `${bucket}/`,
      `storage/app/private/${bucket}/`,
      `app/private/${bucket}/`
    ]

    for (const prefix of prefixes) {
      if (raw.startsWith(prefix)) {
        return raw.slice(prefix.length).replace(/^\/+/, '')
      }
    }

    const marker = `/private/${bucket}/`
    const markerIdx = raw.indexOf(marker)
    if (markerIdx >= 0) {
      return raw.slice(markerIdx + marker.length).replace(/^\/+/, '')
    }

    return raw
  }

  if (!isHttpUrl(urlOrPath)) {
    const rawInput = String(urlOrPath || '').trim()
    if (/^\/?api\/storage\/object\?/i.test(rawInput)) {
      try {
        const baseOrigin = typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost'
        const relativeUrl = new URL(rawInput, baseOrigin)
        const queryPath = relativeUrl.searchParams.get('path')
        if (queryPath) return normalizePathString(queryPath)
      } catch {
        // fallback to default normalization below
      }
    }
    return normalizePathString(urlOrPath)
  }

  try {
    const u = new URL(urlOrPath)
    const paramPath = u.searchParams.get('path')
    if (paramPath) return normalizePathString(paramPath)

    const parts = u.pathname.split('/').filter(Boolean)
    const bucketIdx = parts.indexOf(bucket)
    if (bucketIdx === -1) return ''
    return normalizePathString(parts.slice(bucketIdx + 1).join('/'))
  } catch {
    return ''
  }
}

export const createSignedUrl = async (bucket, objectPath, expiresInSec = 60 * 15) => {
  if (!bucket) throw new Error('Bucket belum diset')
  if (!objectPath) throw new Error('Object path kosong')

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresInSec)

  if (error) throw error
  if (!data?.signedUrl) throw new Error('Signed URL tidak tersedia')
  return resolveApiAssetUrl(data.signedUrl)
}

export const getSignedUrlForValue = async (bucket, urlOrPath, expiresInSec = 60 * 15) => {
  const objectPath = extractObjectPath(bucket, urlOrPath)
  if (!objectPath) throw new Error('Path tidak valid')
  return createSignedUrl(bucket, objectPath, expiresInSec)
}

export const removeStorageObject = async (bucket, urlOrPath) => {
  const objectPath = extractObjectPath(bucket, urlOrPath)
  if (!objectPath) return { ok: false, error: new Error('Path tidak valid') }

  const { error } = await supabase.storage.from(bucket).remove([objectPath])
  if (error) return { ok: false, error }
  return { ok: true, error: null }
}

/* ===================== REALTIME (POLLING) ===================== */
const DEFAULT_REALTIME_POLL_MS = 4000
const DEFAULT_REALTIME_POLL_HIDDEN_MS = 12000
const REALTIME_POLL_COLUMNS_BY_TABLE = Object.freeze({
  absensi: 'id,kelas,tanggal,uid,mapel,status,nama,waktu,komentar,oleh,dikonfirmasi,tahun_ajaran,semester,created_at,updated_at',
  absensi_ajuan: 'id,kelas,tanggal,uid,nama,alasan,mapel,created_at,status_guru,kategori_final,guru_id,guru_nama,waktu_respon,tahun_ajaran,semester',
  absensi_settings: 'id,kelas,tanggal,mapel,mode,allow_self_absen,tahun_ajaran,semester,updated_at',
  jam_kosong: 'id,tanggal,kelas,mapel,jam_mulai,jam_selesai,alasan,guru_pengganti,created_by,created_at,updated_at,tahun_ajaran,semester',
  jadwal: 'id,kelas_id,hari,mapel,guru_id,guru_nama,jam_mulai,jam_selesai,tahun_ajaran,semester,created_at,updated_at',
  kelas: 'id,nama,grade,suffix,tingkat,jurusan,angkatan,tahun_ajaran,semester,is_active,updated_at',
  kelas_struktur: 'kelas_id,wali_guru_id,wali_guru_nama,ketua_siswa_id,ketua_siswa_nama,updated_at',
  pengumuman: 'id,judul,keterangan,target,created_at,updated_at',
  profiles: 'id,nama,email,role,kelas,status,nis,rfid_uid,photo_url,photo_path,updated_at',
  quizzes: 'id,kelas_id,guru_id,mapel,nama,starts_at,deadline_at,mode,is_live,is_active,live_started_at,duration_minutes,result_visible_to_students,updated_at',
  quiz_questions: 'id,quiz_id,nomor,soal,image_path,poin,question_type,updated_at',
  quiz_options: 'id,question_id,label,text,image_path,is_correct,updated_at',
  quiz_submissions: 'id,quiz_id,siswa_id,status,score,total_points,started_at,finished_at,last_saved_at,essay_review_completed_at,essay_review_completed_by,updated_at',
  quiz_answers: 'id,submission_id,question_id,option_id,essay_answer,essay_score,is_correct,poin,updated_at',
  quiz_violation_logs: 'id,quiz_id,submission_id,siswa_id,event_type,event_message,event_meta,created_at',
  rfid_scans: 'id,tenant_id,card_uid,device_id,status,created_at',
  settings: 'id,tahun_ajaran,semester_aktif,periode_mulai,periode_selesai,updated_at',
  tugas: 'id,kelas,judul,mapel,mulai,deadline,keterangan,file_url,link,created_by,created_at,updated_at,tahun_ajaran,semester,angkatan',
  tugas_jawaban: 'id,tugas_id,user_id,file_url,link_url,file_name,file_urls,status,nilai,waktu_submit,dinilai_at,dinilai_oleh,komentar_siswa,updated_at,tahun_ajaran,semester,angkatan',
  user_presence: 'id,user_id,device_id,online,activity,last_seen_at,updated_at'
})

const toPositiveInt = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

const REALTIME_POLL_MS = toPositiveInt(
  import.meta.env.VITE_REALTIME_POLL_MS,
  DEFAULT_REALTIME_POLL_MS
)

const REALTIME_POLL_HIDDEN_MS = toPositiveInt(
  import.meta.env.VITE_REALTIME_POLL_HIDDEN_MS,
  DEFAULT_REALTIME_POLL_HIDDEN_MS
)

const realtimeColumnsForTable = (table) => (
  REALTIME_POLL_COLUMNS_BY_TABLE[String(table || '').trim()] || '*'
)

let channelCounter = 0

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

const sortForStableStringify = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify)
  }
  if (!isPlainObject(value)) return value

  const sorted = {}
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = sortForStableStringify(value[key])
    })
  return sorted
}

const stableStringify = (value) => JSON.stringify(sortForStableStringify(value))

const normalizeEventType = (event) => {
  if (!event || event === '*') return '*'
  const upper = String(event).toUpperCase()
  if (upper === 'INSERT' || upper === 'UPDATE' || upper === 'DELETE') return upper
  return '*'
}

const parseRealtimeFilter = (filter) => {
  if (!filter || typeof filter !== 'string') return null
  const trimmed = filter.trim()
  if (!trimmed) return null

  const marker = '=eq.'
  const markerIdx = trimmed.indexOf(marker)
  if (markerIdx <= 0) return null

  const field = trimmed.slice(0, markerIdx).trim()
  const rawValue = trimmed.slice(markerIdx + marker.length).trim()
  if (!field || rawValue === '') return null

  let value = rawValue
  try {
    value = decodeURIComponent(rawValue)
  } catch {
    value = rawValue
  }

  return { field, op: 'eq', value }
}

const applyRealtimeFilterToPayload = (body, parsedFilter) => {
  if (!parsedFilter || parsedFilter.op !== 'eq') return
  body.filters = body.filters || {}
  body.filters.eq = body.filters.eq || {}
  body.filters.eq[parsedFilter.field] = parsedFilter.value
}

const resolveRowKey = (row, index) => {
  if (isPlainObject(row) && row.id !== undefined && row.id !== null) {
    return `id:${String(row.id)}`
  }
  if (isPlainObject(row) && row.uuid !== undefined && row.uuid !== null) {
    return `uuid:${String(row.uuid)}`
  }
  return `idx:${index}:${stableStringify(row)}`
}

const buildSnapshot = (rows) => {
  const snapshot = new Map()
  if (!Array.isArray(rows)) return snapshot

  rows.forEach((item, index) => {
    const row = isPlainObject(item) ? item : {}
    const key = resolveRowKey(row, index)
    snapshot.set(key, {
      row,
      serialized: stableStringify(row)
    })
  })

  return snapshot
}

const makeRealtimePayload = (table, eventType, newRow, oldRow) => ({
  schema: 'public',
  table,
  eventType,
  new: newRow,
  old: oldRow,
  errors: null
})

const eventMatches = (expected, actual) => (
  expected === '*' || expected === actual
)

class RealtimePollingManager {
  constructor() {
    this.entries = new Map()
    this.timer = null
    this.polling = false
    this.visibilityListenerAttached = false
    this.onVisibilityChange = this.handleVisibilityChange.bind(this)
  }

  registerChannel(channel) {
    if (!channel || !Array.isArray(channel.bindings)) return
    channel.bindings.forEach((binding) => this.registerBinding(binding))
    this.ensureRunning()
  }

  registerBinding(binding) {
    if (!binding || !binding.table) return
    const key = this.entryKey(binding.table, binding.filterRaw)
    let entry = this.entries.get(key)

    if (!entry) {
      entry = {
        key,
        table: binding.table,
        filterRaw: binding.filterRaw || '',
        parsedFilter: binding.parsedFilter || null,
        bindings: new Set(),
        snapshot: new Map(),
        ready: false,
        blocked: false
      }
      this.entries.set(key, entry)
    }

    entry.bindings.add(binding)
    this.ensureRunning()
  }

  unregisterChannel(channel) {
    if (!channel) return

    for (const [entryKey, entry] of this.entries) {
      for (const binding of Array.from(entry.bindings)) {
        if (binding.channelId === channel.id) {
          entry.bindings.delete(binding)
        }
      }
      if (entry.bindings.size === 0) {
        this.entries.delete(entryKey)
      }
    }

    if (this.entries.size === 0) this.stop()
  }

  entryKey(table, filterRaw) {
    return `${table}::${filterRaw || ''}`
  }

  ensureRunning() {
    if (this.entries.size === 0) return
    this.attachVisibilityListener()
    if (!this.timer) this.schedule(0)
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.detachVisibilityListener()
  }

  schedule(delay) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, typeof delay === 'number' ? delay : this.currentInterval())
  }

  currentInterval() {
    if (typeof document !== 'undefined' && document.hidden) {
      return REALTIME_POLL_HIDDEN_MS
    }
    return REALTIME_POLL_MS
  }

  attachVisibilityListener() {
    if (this.visibilityListenerAttached || typeof document === 'undefined') return
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.visibilityListenerAttached = true
  }

  detachVisibilityListener() {
    if (!this.visibilityListenerAttached || typeof document === 'undefined') return
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.visibilityListenerAttached = false
  }

  handleVisibilityChange() {
    if (this.entries.size === 0) return
    this.schedule(0)
  }

  pulse(table) {
    if (this.entries.size === 0) return
    const normalizedTable = String(table || '').trim()
    if (normalizedTable) {
      const hasMatchingEntry = Array.from(this.entries.values()).some(
        (entry) => entry.table === normalizedTable
      )
      if (!hasMatchingEntry) return
    }
    this.schedule(0)
  }

  async tick() {
    if (this.polling) {
      this.schedule()
      return
    }
    if (this.entries.size === 0) {
      this.stop()
      return
    }

    this.polling = true
    const entries = Array.from(this.entries.values())
    await Promise.all(entries.map((entry) => this.pollEntry(entry)))
    this.polling = false

    const hasActiveEntry = Array.from(this.entries.values()).some(
      (entry) => entry.bindings.size > 0 && !entry.blocked
    )
    if (hasActiveEntry) this.schedule()
    else this.stop()
  }

  async pollEntry(entry) {
    if (!entry || entry.bindings.size === 0) return
    if (entry.blocked) return

    const body = {
      table: entry.table,
      action: 'select',
      columns: realtimeColumnsForTable(entry.table),
      filters: { eq: {}, in: {}, gte: {}, lte: {}, gt: {}, lt: {} },
      order: [],
      limit: null,
      offset: null
    }
    applyRealtimeFilterToPayload(body, entry.parsedFilter)

    const res = await apiFetch('/api/db', {
      method: 'POST',
      body,
      cacheTtlMs: 0
    })

    if (res.error) {
      const status = Number(res.error.status || 0)
      if (status === 401 || status === 403) {
        entry.blocked = true
        entry.ready = true
        entry.snapshot = new Map()
        this.notifyStatus(entry, 'SUBSCRIBED')
        return
      }
      this.notifyStatus(entry, 'CHANNEL_ERROR')
      return
    }

    const rowsRaw = res.raw?.data ?? res.data
    const rows = Array.isArray(rowsRaw) ? rowsRaw : []
    const nextSnapshot = buildSnapshot(rows)

    if (!entry.ready) {
      entry.snapshot = nextSnapshot
      entry.ready = true
      this.notifyStatus(entry, 'SUBSCRIBED')
      return
    }

    this.notifyStatus(entry, 'SUBSCRIBED')
    const prevSnapshot = entry.snapshot

    for (const [key, next] of nextSnapshot) {
      const prev = prevSnapshot.get(key)
      if (!prev) {
        this.emit(entry, 'INSERT', next.row, null)
        continue
      }

      if (prev.serialized !== next.serialized) {
        this.emit(entry, 'UPDATE', next.row, prev.row)
      }
    }

    for (const [key, prev] of prevSnapshot) {
      if (!nextSnapshot.has(key)) {
        this.emit(entry, 'DELETE', null, prev.row)
      }
    }

    entry.snapshot = nextSnapshot
  }

  emit(entry, eventType, newRow, oldRow) {
    const payload = makeRealtimePayload(entry.table, eventType, newRow, oldRow)
    for (const binding of entry.bindings) {
      if (!eventMatches(binding.event, eventType)) continue
      try {
        binding.callback(payload)
      } catch (error) {
        console.error('[realtime] callback error:', error)
      }
    }
  }

  notifyStatus(entry, status) {
    const handled = new Set()
    for (const binding of entry.bindings) {
      const channel = binding.channel
      if (!channel || handled.has(channel.id)) continue
      handled.add(channel.id)
      channel.setStatus(status)
    }
  }
}

const realtimeManager = new RealtimePollingManager()

function pulseRealtimeForMutation(table) {
  realtimeManager.pulse(table)
}

class RealtimeChannel {
  constructor(name) {
    channelCounter += 1
    this.id = `ch_${channelCounter}`
    this.name = name || this.id
    this.bindings = []
    this.statusHandlers = new Set()
    this.status = 'CLOSED'
    this.subscribed = false
    this.closed = false
  }

  on(type, config, callback) {
    if (this.closed) return this
    if (type !== 'postgres_changes') return this
    if (typeof callback !== 'function') return this

    const table = config?.table
    if (!table) return this

    const binding = {
      channelId: this.id,
      channel: this,
      event: normalizeEventType(config?.event || '*'),
      schema: config?.schema || 'public',
      table,
      filterRaw: config?.filter || '',
      parsedFilter: parseRealtimeFilter(config?.filter),
      callback
    }

    this.bindings.push(binding)
    if (this.subscribed) {
      realtimeManager.registerBinding(binding)
    }

    return this
  }

  subscribe(callback) {
    if (typeof callback === 'function') {
      this.statusHandlers.add(callback)
    }
    if (this.closed) return this

    if (!this.subscribed) {
      this.subscribed = true
      realtimeManager.registerChannel(this)
    }

    this.setStatus('SUBSCRIBED')
    return this
  }

  setStatus(status) {
    if (!status || this.status === status) return
    this.status = status
    this.statusHandlers.forEach((handler) => {
      try {
        handler(status)
      } catch (error) {
        console.error('[realtime] status callback error:', error)
      }
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.subscribed = false
    realtimeManager.unregisterChannel(this)
    this.setStatus('CLOSED')
  }
}


const createLazyRoleApi = (loader, label) => {
  let loadedApiPromise = null

  const loadApi = async () => {
    if (!loadedApiPromise) {
      loadedApiPromise = loader().then((module) => module.default || module)
    }
    return loadedApiPromise
  }

  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then' || typeof property === 'symbol') return undefined

      return async (...args) => {
        const api = await loadApi()
        const handler = api?.[property]
        if (typeof handler !== 'function') {
          throw new Error(`Endpoint ${label}.${String(property)} tidak tersedia.`)
        }
        return handler(...args)
      }
    }
  })
}

const adminApi = createLazyRoleApi(() => import('./adminApi'), 'admin')
const superApi = createLazyRoleApi(() => import('./superApi'), 'super')

/* ===================== MAIN CLIENT ===================== */
export const supabase = {
  from: (table) => new QueryBuilder(table),
  batch: dbBatch,
  invalidateCache: invalidateDbSelectCache,
  public: {
    async settings() {
      const res = await apiFetch('/api/public/settings', {
        method: 'GET',
        cache: true,
        cacheTtlMs: DEFAULT_DB_SELECT_CACHE_TTL_MS,
        persistCache: true,
        staleCacheTtlMs: 30 * 60 * 1000,
        staleKey: 'public.settings',
        timeoutMs: 12000
      })

      return { data: res.raw?.data ?? null, error: res.error }
    }
  },
  auth,
  admin: adminApi,
  super: superApi,
  quiz: auth.quiz,
  reports,
  attendanceQr,
  students: {
    async updateAdditionalInfo(studentId, payload = {}) {
      const res = await apiFetch(`/api/students/${studentId}/additional-info`, {
        method: 'PATCH',
        body: payload
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }
  },

  presence: {
    async ping({ deviceId, activity = false }) {
      const res = await apiFetch('/api/presence/ping', {
        method: 'POST',
        body: { device_id: deviceId, activity }
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }
  },
  assignments: {
    async createTask(payload = {}) {
      const res = await apiFetch('/api/tugas', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async updateTask(taskId, payload = {}) {
      const id = encodeURIComponent(String(taskId || ''))
      const res = await apiFetch(`/api/tugas/${id}`, {
        method: 'PATCH',
        body: payload,
        cacheTtlMs: 0
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async deleteTask(taskId) {
      const id = encodeURIComponent(String(taskId || ''))
      const res = await apiFetch(`/api/tugas/${id}`, {
        method: 'DELETE',
        cacheTtlMs: 0
      })
      if (!res.error) invalidateDbSelectCache()
      return { data: res.raw?.data ?? res.data, error: res.error }
    },
    async submitAnswer(payload = {}) {
      const res = await apiFetch('/api/tugas/jawaban/submit', {
        method: 'POST',
        body: payload,
        cacheTtlMs: 0
      })
      return { data: res.raw?.data ?? res.data, error: res.error }
    }
  },
  storage: {
    from: (bucket) => new StorageBucket(bucket)
  },
  channel: (name) => new RealtimeChannel(name),
  removeChannel: (channel) => {
    if (!channel || typeof channel.close !== 'function') return
    channel.close()
  }
}
