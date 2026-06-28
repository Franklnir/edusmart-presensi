import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'

const VALID_MODES = new Set(['login', 'link'])

const getInitialMode = () => {
  if (typeof window === 'undefined') return 'login'

  try {
    const mode = String(new URL(window.location.href).searchParams.get('mode') || 'login')
      .trim()
      .toLowerCase()
    return VALID_MODES.has(mode) ? mode : 'login'
  } catch {
    return 'login'
  }
}

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
    <path
      d="M21.805 12.23c0-.76-.068-1.49-.195-2.19H12v4.15h5.49a4.69 4.69 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.055-4.4 3.055-7.6Z"
      fill="#4285F4"
    />
    <path
      d="M12 22c2.76 0 5.075-.915 6.765-2.475l-3.3-2.56c-.915.615-2.085.98-3.465.98-2.66 0-4.915-1.795-5.72-4.21H2.87v2.64A10 10 0 0 0 12 22Z"
      fill="#34A853"
    />
    <path
      d="M6.28 13.735a5.97 5.97 0 0 1-.32-1.935c0-.67.115-1.32.32-1.935V7.225H2.87A9.99 9.99 0 0 0 2 11.8c0 1.61.385 3.135.87 4.575l3.41-2.64Z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.655c1.5 0 2.845.515 3.905 1.525l2.93-2.93C17.07 2.61 14.755 1.6 12 1.6A10 10 0 0 0 2.87 7.225l3.41 2.64c.805-2.415 3.06-4.21 5.72-4.21Z"
      fill="#EA4335"
    />
  </svg>
)

const ShieldIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 1.667 3.333 4.167v4.166c0 4.584 2.834 7.5 6.667 8.334 3.833-.834 6.667-3.75 6.667-8.334V4.167L10 1.667Z" />
    <path d="m7.5 10 1.667 1.667L12.5 8.333" />
  </svg>
)

export default function GoogleAuthPopup() {
  const targetOriginRef = useRef('')
  const stateRef = useRef('')
  const initialMode = getInitialMode()
  const modeRef = useRef(initialMode)

  const [mode, setMode] = useState(initialMode)
  const [status, setStatus] = useState(
    initialMode === 'link' ? 'Menyiapkan tautan Google...' : 'Menyiapkan login Google...'
  )
  const [error, setError] = useState('')
  const [phase, setPhase] = useState('loading') // loading | redirecting | error

  const notifyOpener = useCallback((type, payload = {}) => {
    if (typeof window === 'undefined') return
    if (!window.opener || !targetOriginRef.current) return

    window.opener.postMessage(
      {
        source: 'edusmart-google-popup',
        type,
        state: stateRef.current,
        mode: modeRef.current,
        ...payload
      },
      targetOriginRef.current
    )
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    let cancelled = false

    const bootstrap = async () => {
      if (!window.opener) {
        setError('Popup ini harus dibuka dari halaman login EduSmart.')
        setStatus('')
        setPhase('error')
        return
      }

      try {
        const url = new URL(window.location.href)
        const requestedOrigin = String(url.searchParams.get('origin') || '').trim()
        const requestedState = String(url.searchParams.get('state') || '').trim()
        const requestedMode = String(url.searchParams.get('mode') || 'login').trim().toLowerCase()
        const requestedReturnTo = String(url.searchParams.get('return_to') || '').trim()

        if (!requestedOrigin || !requestedState) {
          throw new Error('Parameter popup tidak lengkap.')
        }

        stateRef.current = requestedState
        modeRef.current = VALID_MODES.has(requestedMode) ? requestedMode : 'login'
        setMode(modeRef.current)
        document.title =
          modeRef.current === 'link' ? 'Tautkan Google — EduSmart' : 'Masuk dengan Google — EduSmart'

        const popupContext = await apiFetch(
          `/api/auth/google/popup-context?origin=${encodeURIComponent(requestedOrigin)}&mode=${encodeURIComponent(modeRef.current)}`,
          { method: 'GET' }
        )

        if (popupContext.error) {
          throw new Error(popupContext.error.message || 'Origin tidak diizinkan.')
        }

        const validatedOrigin = String(popupContext.raw?.data?.origin || '').trim()
        if (!validatedOrigin) {
          throw new Error('Origin tujuan tidak valid.')
        }

        targetOriginRef.current = validatedOrigin
        setPhase('redirecting')
        setStatus(
          modeRef.current === 'link'
            ? 'Mengarahkan ke Google...'
            : 'Mengarahkan ke Google...'
        )

        const endpoint = modeRef.current === 'link'
          ? '/api/auth/google/link'
          : '/api/auth/google/redirect'
        const oauthUrl = new URL(endpoint, validatedOrigin)
        oauthUrl.searchParams.set('popup', '1')
        oauthUrl.searchParams.set('origin', validatedOrigin)
        oauthUrl.searchParams.set('popup_state', requestedState)
        oauthUrl.searchParams.set('mode', modeRef.current)
        oauthUrl.searchParams.set(
          'redirect',
          requestedReturnTo || `${validatedOrigin}${modeRef.current === 'link' ? '/admin/pengaturan' : '/login'}`
        )

        window.setTimeout(() => {
          if (!cancelled) window.location.replace(oauthUrl.toString())
        }, 300)
      } catch (err) {
        if (cancelled) return
        const message = err?.message || 'Popup Google gagal dipersiapkan.'
        setError(message)
        setStatus('')
        setPhase('error')

        if (targetOriginRef.current) {
          notifyOpener('edusmart-google-error', { error: message })
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [notifyOpener])

  const isLinkMode = mode === 'link'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #e0f2fe 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: '380px',
        background: '#ffffff',
        borderRadius: '24px',
        boxShadow: '0 20px 60px rgba(100, 116, 139, 0.15), 0 0 0 1px rgba(226, 232, 240, 0.8)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '32px 24px 24px',
          textAlign: 'center',
          borderBottom: '1px solid #f1f5f9',
        }}>
          {/* Google logo circle */}
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: '#ffffff',
            border: '2px solid #e2e8f0',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            boxShadow: '0 4px 12px rgba(100, 116, 139, 0.08)',
          }}>
            <GoogleLogo />
          </div>

          <h1 style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#0f172a',
            letterSpacing: '-0.02em',
            margin: '0 0 6px',
            lineHeight: '1.3',
          }}>
            {isLinkMode ? 'Tautkan Akun Google' : 'Masuk dengan Google'}
          </h1>

          <p style={{
            fontSize: '13px',
            color: '#64748b',
            margin: 0,
            lineHeight: '1.5',
          }}>
            {isLinkMode
              ? 'Pilih akun Google untuk ditautkan ke EduSmart'
              : 'Pilih akun Google Anda untuk melanjutkan'}
          </p>
        </div>

        {/* Status area */}
        <div style={{ padding: '24px' }}>
          {/* Loading / redirecting state */}
          {!error && (
            <div style={{
              background: phase === 'redirecting' ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${phase === 'redirecting' ? '#bfdbfe' : '#e2e8f0'}`,
              borderRadius: '16px',
              padding: '20px',
              textAlign: 'center',
            }}>
              {/* Spinner */}
              <div style={{
                width: '36px',
                height: '36px',
                border: '3px solid #e2e8f0',
                borderTopColor: '#6366f1',
                borderRadius: '50%',
                animation: 'google-popup-spin 0.8s linear infinite',
                margin: '0 auto 16px',
              }} />

              <p style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#334155',
                margin: '0 0 4px',
              }}>
                {status}
              </p>

              <p style={{
                fontSize: '11px',
                color: '#94a3b8',
                margin: 0,
              }}>
                Popup akan diarahkan otomatis
              </p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '16px',
              padding: '20px',
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '12px',
                background: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
                fontSize: '18px',
                color: '#dc2626',
                fontWeight: '800',
              }}>
                ✕
              </div>

              <p style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#991b1b',
                textAlign: 'center',
                margin: '0 0 8px',
              }}>
                Tidak Dapat Melanjutkan
              </p>

              <p style={{
                fontSize: '12px',
                color: '#b91c1c',
                textAlign: 'center',
                margin: '0 0 16px',
                lineHeight: '1.5',
              }}>
                {error}
              </p>

              <button
                type="button"
                onClick={() => window.close()}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#b91c1c' }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#dc2626' }}
              >
                Tutup Popup
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px 16px',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}>
          <ShieldIcon />
          <p style={{
            fontSize: '10px',
            color: '#94a3b8',
            margin: 0,
            lineHeight: '1.4',
          }}>
            Koneksi aman · EduSmart tidak menyimpan password Google Anda
          </p>
        </div>
      </div>

      <style>{`
        @keyframes google-popup-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
