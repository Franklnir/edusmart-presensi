const ROOT_DOMAIN = String(import.meta.env.VITE_ROOT_DOMAIN || '')
  .trim()
  .toLowerCase()
const EXPLICIT_BRIDGE_URL = String(import.meta.env.VITE_GOOGLE_AUTH_BRIDGE_URL || '').trim()
const DEFAULT_BRIDGE_PATH = '/auth/google/popup'
const POPUP_CLOSED_SUCCESS_GRACE_MS = 2500
const GOOGLE_POPUP_NAME_PREFIX = 'edusmart_google_auth_popup'

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

export const getGoogleAuthLaunchUrl = (mode = 'login') => {
  if (typeof window === 'undefined' || !window.location?.origin) return ''

  try {
    const endpoint = mode === 'link'
      ? '/api/auth/google/link'
      : '/api/auth/google/redirect'

    return new URL(endpoint, window.location.origin).toString()
  } catch {
    return ''
  }
}

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
  const width = 520
  const height = 640
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

const buildReturnUrl = (mode, state) => {
  const targetPath = mode === 'link'
    ? `${window.location.pathname}${window.location.search}${window.location.hash}`
    : '/login'
  const returnUrl = new URL(`${window.location.origin}${targetPath}`)

  returnUrl.searchParams.delete('google')
  returnUrl.searchParams.delete('google_error')
  returnUrl.searchParams.delete('google_popup_state')
  returnUrl.searchParams.delete('google_popup_mode')
  returnUrl.searchParams.set('google_popup_state', state)
  returnUrl.searchParams.set('google_popup_mode', mode)

  return returnUrl
}

const buildOAuthLaunchUrl = ({ mode, state }) => {
  const launchUrl = new URL(getGoogleAuthLaunchUrl(mode))
  launchUrl.searchParams.set('popup', '1')
  launchUrl.searchParams.set('origin', window.location.origin)
  launchUrl.searchParams.set('popup_state', state)
  launchUrl.searchParams.set('mode', mode)
  launchUrl.searchParams.set('redirect', buildReturnUrl(mode, state).toString())

  return launchUrl
}

const buildPopupName = (mode, state) => {
  const safeState = String(state || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48)
  const safeMode = mode === 'link' ? 'link' : 'login'

  return safeState
    ? `${GOOGLE_POPUP_NAME_PREFIX}_${safeMode}_${safeState}`
    : `${GOOGLE_POPUP_NAME_PREFIX}_${safeMode}_${Date.now()}`
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

  const normalizedMode = mode === 'link' ? 'link' : 'login'
  const launchUrl = getGoogleAuthLaunchUrl(normalizedMode)
  const launchOrigin = window.location.origin
  if (!launchUrl || !launchOrigin) {
    return Promise.reject(new Error('URL auth Google pusat belum valid.'))
  }

  const state = createStateToken()
  const popupName = buildPopupName(normalizedMode, state)
  const popupUrl = buildOAuthLaunchUrl({ mode: normalizedMode, state })

  const popup = window.open(
    popupUrl.toString(),
    popupName,
    popupFeatures()
  )

  if (!popup) {
    return Promise.reject(new Error('Popup Google diblokir browser. Izinkan popup lalu coba lagi.'))
  }

  popup.focus()

  return new Promise((resolve, reject) => {
    let settled = false
    let relaunchedFromPopupRequest = false
    let closeTimer = null
    let closeGraceTimer = null
    let timeoutTimer = null
    const allowedOrigins = allowedPopupMessageOrigins(launchOrigin)

    const cleanup = () => {
      if (closeTimer) window.clearInterval(closeTimer)
      if (closeGraceTimer) window.clearTimeout(closeGraceTimer)
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

      if (payload?.type === 'edusmart-google-launch-request') {
        if (event.source !== popup || relaunchedFromPopupRequest || settled) return
        relaunchedFromPopupRequest = true

        try {
          event.source.location.replace(popupUrl.toString())
        } catch {
          try {
            popup.location.replace(popupUrl.toString())
          } catch {
            // Let the normal timeout/error path handle this.
          }
        }
        return
      }

      if (payload?.state !== state) return

      if (payload?.type === 'edusmart-google-credential') {
        finalize(() => resolve({
          credential: String(payload.credential || ''),
          mode: String(payload.mode || normalizedMode)
        }))
        return
      }

      if (payload?.type === 'edusmart-google-oauth-success') {
        finalize(() => resolve({
          oauth: true,
          status: String(payload.status || 'success'),
          mode: String(payload.mode || normalizedMode)
        }))
        return
      }

      if (payload?.type === 'edusmart-google-error') {
        finalize(() => reject(new Error(payload.error || 'Login Google dibatalkan.')))
      }
    }

    const scheduleClosedFallback = () => {
      if (closeGraceTimer || settled) return
      closeGraceTimer = window.setTimeout(() => {
        finalize(() => resolve({
          oauth: true,
          status: 'popup_closed',
          popupClosed: true,
          mode: normalizedMode
        }))
      }, POPUP_CLOSED_SUCCESS_GRACE_MS)
    }

    window.addEventListener('message', handleMessage)

    if (launchOrigin === window.location.origin) {
      closeTimer = window.setInterval(() => {
        let isClosed = false
        try {
          isClosed = Boolean(popup.closed)
        } catch {
          return
        }

        if (!isClosed) {
          if (closeGraceTimer) {
            window.clearTimeout(closeGraceTimer)
            closeGraceTimer = null
          }
          return
        }

        scheduleClosedFallback()
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
