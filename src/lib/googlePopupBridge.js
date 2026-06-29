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

const buildPopupName = (state) => {
  const safeState = String(state || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48)

  return safeState
    ? `${GOOGLE_POPUP_NAME_PREFIX}_${safeState}`
    : `${GOOGLE_POPUP_NAME_PREFIX}_${Date.now()}`
}

const writePopupLaunchDocument = (popup, mode) => {
  try {
    const title = mode === 'link' ? 'Tautkan Google - EduSmart' : 'Masuk dengan Google - EduSmart'
    popup.document.open()
    popup.document.write(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(420px,calc(100vw - 32px));border:1px solid #e2e8f0;border-radius:20px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.14);padding:28px;text-align:center}
    .logo{width:54px;height:54px;margin:0 auto 18px;border-radius:18px;display:grid;place-items:center;background:#fff;border:1px solid #e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,.08);font-size:28px;font-weight:800;color:#4285f4}
    .kicker{margin:0 0 8px;text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:800;color:#64748b}
    h1{margin:0;font-size:22px;line-height:1.28;font-weight:800;letter-spacing:0}
    p{margin:10px 0 0;color:#475569;font-size:14px;line-height:1.6}
    .status{margin:24px auto 0;display:inline-flex;align-items:center;gap:10px;border:1px solid #dbeafe;border-radius:999px;background:#eff6ff;color:#2563eb;padding:10px 16px;font-size:13px;font-weight:800}
    .spinner{width:18px;height:18px;border-radius:999px;border:2px solid #bfdbfe;border-top-color:#2563eb;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main aria-live="polite">
    <div class="logo" aria-hidden="true">G</div>
    <p class="kicker">Google sign-in</p>
    <h1>Membuka pilihan akun Google</h1>
    <p>Mohon tunggu sebentar. Jendela ini akan diarahkan ke halaman resmi Google.</p>
    <div class="status"><span class="spinner" aria-hidden="true"></span><span>Menyiapkan Google...</span></div>
  </main>
</body>
</html>`)
    popup.document.close()
  } catch {
    // The popup may already be navigating away.
  }
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
  const popupName = buildPopupName(state)
  const popupUrl = buildOAuthLaunchUrl({ mode: normalizedMode, state })

  const popup = window.open(
    'about:blank',
    popupName,
    popupFeatures()
  )

  if (!popup) {
    return Promise.reject(new Error('Popup Google diblokir browser. Izinkan popup lalu coba lagi.'))
  }

  popup.focus()
  writePopupLaunchDocument(popup, normalizedMode)

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

    window.setTimeout(() => {
      if (settled) return
      try {
        popup.location.replace(popupUrl.toString())
      } catch {
        // If navigation is blocked here, the timeout below will surface it.
      }
    }, 80)

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
