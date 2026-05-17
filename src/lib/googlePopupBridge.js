const ROOT_DOMAIN = String(import.meta.env.VITE_ROOT_DOMAIN || '')
  .trim()
  .toLowerCase()
const EXPLICIT_BRIDGE_URL = String(import.meta.env.VITE_GOOGLE_AUTH_BRIDGE_URL || '').trim()
const DEFAULT_BRIDGE_PATH = '/auth/google/popup'

const isLocalHost = (host) => {
  const normalized = String(host || '').trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized.endsWith('.localhost')
  )
}

const buildBridgeUrl = () => {
  if (EXPLICIT_BRIDGE_URL) {
    try {
      const baseOrigin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:5173'
      return new URL(EXPLICIT_BRIDGE_URL, baseOrigin).toString()
    } catch {
      return EXPLICIT_BRIDGE_URL
    }
  }

  if (typeof window !== 'undefined') {
    const runtimeOrigin = String(window.location.origin || '').trim()
    const runtimeHost = String(window.location.hostname || '').trim().toLowerCase()

    if (!runtimeOrigin) return ''
    if (!ROOT_DOMAIN || isLocalHost(runtimeHost)) {
      return `${runtimeOrigin}${DEFAULT_BRIDGE_PATH}`
    }

    return `https://${ROOT_DOMAIN}${DEFAULT_BRIDGE_PATH}`
  }

  if (ROOT_DOMAIN) {
    return `https://${ROOT_DOMAIN}${DEFAULT_BRIDGE_PATH}`
  }

  return ''
}

export const getGoogleAuthBridgeUrl = () => buildBridgeUrl()

export const getGoogleAuthBridgeOrigin = () => {
  const bridgeUrl = buildBridgeUrl()
  if (!bridgeUrl) return ''

  try {
    return new URL(bridgeUrl).origin
  } catch {
    return ''
  }
}

const popupFeatures = () => {
  const width = 500
  const height = 560
  const left =
    typeof window !== 'undefined'
      ? Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
      : 0
  const top =
    typeof window !== 'undefined'
      ? Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
      : 0

  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'resizable=yes',
    'scrollbars=yes'
  ].join(',')
}

const createStateToken = () => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `google_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const allowedPopupMessageOrigins = (bridgeOrigin) => {
  const origins = new Set()
  if (bridgeOrigin) origins.add(bridgeOrigin)

  if (typeof window !== 'undefined' && window.location?.origin) {
    origins.add(window.location.origin)
  }

  return origins
}

export const openGoogleAuthPopup = ({
  mode = 'login',
  timeoutMs = 180000
} = {}) => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Popup Google hanya tersedia di browser.'))
  }

  const bridgeUrl = getGoogleAuthBridgeUrl()
  const bridgeOrigin = getGoogleAuthBridgeOrigin()
  if (!bridgeUrl || !bridgeOrigin) {
    return Promise.reject(new Error('URL auth Google pusat belum valid.'))
  }

  const state = createStateToken()
  const popupUrl = new URL(bridgeUrl, window.location.origin)
  popupUrl.searchParams.set('mode', mode)
  popupUrl.searchParams.set('origin', window.location.origin)
  popupUrl.searchParams.set('state', state)
  popupUrl.searchParams.set(
    'return_to',
    `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
  )

  const popup = window.open(
    popupUrl.toString(),
    'edusmart_google_auth_popup',
    popupFeatures()
  )

  if (!popup) {
    return Promise.reject(new Error('Popup Google diblokir browser. Izinkan popup lalu coba lagi.'))
  }

  popup.focus()

  return new Promise((resolve, reject) => {
    let settled = false
    let closeTimer = null
    let timeoutTimer = null
    const allowedOrigins = allowedPopupMessageOrigins(bridgeOrigin)

    const cleanup = () => {
      if (closeTimer) window.clearInterval(closeTimer)
      if (timeoutTimer) window.clearTimeout(timeoutTimer)
      window.removeEventListener('message', handleMessage)
    }

    const finalize = (callback) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const handleMessage = (event) => {
      if (!allowedOrigins.has(event.origin)) return

      const payload = event.data || {}
      if (payload?.source !== 'edusmart-google-popup') return
      if (payload?.state !== state) return

      if (payload?.type === 'edusmart-google-credential') {
        finalize(() => resolve({
          credential: String(payload.credential || ''),
          mode: String(payload.mode || mode)
        }))
        return
      }

      if (payload?.type === 'edusmart-google-oauth-success') {
        finalize(() => resolve({
          oauth: true,
          status: String(payload.status || 'success'),
          mode: String(payload.mode || mode)
        }))
        return
      }

      if (payload?.type === 'edusmart-google-error') {
        finalize(() => reject(new Error(payload.error || 'Login Google dibatalkan.')))
      }
    }

    window.addEventListener('message', handleMessage)

    if (bridgeOrigin === window.location.origin) {
      closeTimer = window.setInterval(() => {
        if (!popup.closed) return

        finalize(() => reject(new Error('Popup Google ditutup sebelum proses selesai.')))
      }, 500)
    }

    timeoutTimer = window.setTimeout(() => {
      try {
        popup.close()
      } catch {
        // ignore
      }

      finalize(() => reject(new Error('Login Google terlalu lama. Jika popup sudah tertutup, coba masuk kembali.')))
    }, timeoutMs)
  })
}
