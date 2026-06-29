import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import '../../styles/GooglePopup.css'

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

export default function GoogleAuthPopup() {
  const targetOriginRef = useRef('')
  const stateRef = useRef('')
  const initialMode = getInitialMode()
  const modeRef = useRef(initialMode)

  const [mode, setMode] = useState(initialMode)
  const [status, setStatus] = useState(
    initialMode === 'link' ? 'Menyiapkan pilihan akun Google...' : 'Menyiapkan pilihan akun Google...'
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
        setError('Popup ini harus dibuka dari halaman login SISMU.')
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
          modeRef.current === 'link' ? 'Tautkan Google — SISMU' : 'Masuk dengan Google — SISMU'

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
            ? 'Membuka pilihan akun Google untuk ditautkan...'
            : 'Membuka pilihan akun Google...'
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
  const title = error
    ? 'Tidak bisa melanjutkan'
    : isLinkMode
      ? 'Membuka pilihan akun Google'
      : 'Membuka pilihan akun Google'
  const description = error
    ? 'Kami belum bisa menyiapkan jendela Google. Tutup jendela ini lalu coba lagi dari aplikasi.'
    : isLinkMode
      ? 'Pilih akun Google yang akan ditautkan ke akun SISMU Anda.'
      : 'Pilih akun Google yang sesuai dengan akun SISMU Anda.'

  return (
    <div className={`google-popup-page ${error ? 'google-popup-page--error' : ''}`}>
      <main className="google-popup-shell">
        <section className="google-popup-panel" aria-live="polite">
          <div className="google-popup-logo" aria-hidden="true">
            <GoogleLogo />
          </div>

          <p className="google-popup-kicker">
            {isLinkMode ? 'Google account link' : 'Google sign-in'}
          </p>
          <h1 className="google-popup-title">
            {title}
          </h1>
          <p className="google-popup-description">{description}</p>

          {!error && (
            <div className={`google-popup-status ${phase === 'redirecting' ? 'google-popup-status--success' : ''}`}>
              <span className="google-popup-spinner" aria-hidden="true" />
              <span>{status}</span>
            </div>
          )}

          {error && (
            <div className="google-popup-status google-popup-status--error">
              <span>{error}</span>
            </div>
          )}

          <div className="google-popup-actions">
            <button type="button" className="google-popup-button" onClick={() => window.close()}>
              Tutup jendela
            </button>
          </div>

          <p className="google-popup-secure">
            Koneksi aman. SISMU tidak menyimpan password Google Anda.
          </p>
        </section>
      </main>
    </div>
  )
}
