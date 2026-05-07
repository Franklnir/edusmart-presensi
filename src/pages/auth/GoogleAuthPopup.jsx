import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, supabase } from '../../lib/supabase'
import {
  initializeGoogleSignIn,
  loadGoogleIdentityScript,
  renderGoogleSignInButton
} from '../../lib/googleIdentity'

const VALID_MODES = new Set(['login', 'link'])

const GoogleBadge = () => (
  <span
    aria-hidden="true"
    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm"
  >
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
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
  </span>
)

export default function GoogleAuthPopup() {
  const buttonRef = useRef(null)
  const targetOriginRef = useRef('')
  const stateRef = useRef('')
  const modeRef = useRef('login')

  const [status, setStatus] = useState('Menyiapkan login Google...')
  const [error, setError] = useState('')
  const [buttonReady, setButtonReady] = useState(false)

  const clientId = String(supabase.auth.getGoogleClientId?.() || '').trim()

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
        setError('Popup Google harus dibuka dari halaman login aplikasi.')
        setStatus('')
        return
      }

      if (!clientId) {
        setError('Client ID Google belum terpasang di frontend.')
        setStatus('')
        return
      }

      try {
        const url = new URL(window.location.href)
        const requestedOrigin = String(url.searchParams.get('origin') || '').trim()
        const requestedState = String(url.searchParams.get('state') || '').trim()
        const requestedMode = String(url.searchParams.get('mode') || 'login').trim().toLowerCase()

        if (!requestedOrigin || !requestedState) {
          throw new Error('Parameter popup Google tidak lengkap.')
        }

        stateRef.current = requestedState
        modeRef.current = VALID_MODES.has(requestedMode) ? requestedMode : 'login'
        document.title =
          modeRef.current === 'link' ? 'Tautkan Google - EduSmart' : 'Masuk dengan Google - EduSmart'

        const popupContext = await apiFetch(
          `/api/auth/google/popup-context?origin=${encodeURIComponent(requestedOrigin)}&mode=${encodeURIComponent(modeRef.current)}`,
          { method: 'GET' }
        )

        if (popupContext.error) {
          throw new Error(popupContext.error.message || 'Origin Google tidak diizinkan.')
        }

        const validatedOrigin = String(popupContext.raw?.data?.origin || '').trim()
        if (!validatedOrigin) {
          throw new Error('Origin tujuan Google tidak valid.')
        }

        targetOriginRef.current = validatedOrigin
        setStatus(
          modeRef.current === 'link'
            ? 'Pilih akun Google yang ingin ditautkan.'
            : 'Pilih akun Google untuk melanjutkan login.'
        )

        await loadGoogleIdentityScript()
        if (cancelled || !buttonRef.current) return

        initializeGoogleSignIn({
          clientId,
          callback: (response) => {
            if (cancelled) return

            const credential = String(response?.credential || '').trim()
            if (!credential) {
              const message = 'Google tidak mengembalikan identitas akun yang valid.'
              setError(message)
              setStatus('')
              notifyOpener('edusmart-google-error', { error: message })
              return
            }

            setError('')
            setStatus('Identitas Google diterima. Menutup popup...')
            notifyOpener('edusmart-google-credential', { credential })

            window.setTimeout(() => {
              try {
                window.close()
              } catch {
                // ignore close failure
              }
            }, 300)
          }
        })

        buttonRef.current.innerHTML = ''
        const buttonWidth = Math.max(
          280,
          Math.min(380, Math.round(buttonRef.current.getBoundingClientRect().width || 360))
        )
        renderGoogleSignInButton({
          element: buttonRef.current,
          width: buttonWidth
        })
        setButtonReady(true)
      } catch (err) {
        if (cancelled) return
        const message = err?.message || 'Popup Google gagal dipersiapkan.'
        setError(message)
        setStatus('')

        if (targetOriginRef.current) {
          notifyOpener('edusmart-google-error', { error: message })
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
      if (buttonRef.current) {
        buttonRef.current.innerHTML = ''
      }
    }
  }, [clientId, notifyOpener])

  const isLinkMode = modeRef.current === 'link'

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-3 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-md items-center justify-center">
        <div className="w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-xl shadow-slate-200/80">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-start gap-3">
              <GoogleBadge />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  EduSmart Google Login
                </p>
                <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">
                  {isLinkMode ? 'Tautkan akun Google' : 'Lanjutkan dengan Google'}
                </h1>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">
                  Pilih akun Google. Popup ini akan tertutup otomatis setelah selesai.
                </p>
              </div>
            </div>
          </div>

          <div className="px-5 py-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
              {status && <p className="text-sm text-slate-700">{status}</p>}
              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

              <div className="mt-3 flex justify-center">
                <div ref={buttonRef} className="w-full max-w-[340px]" />
              </div>

              {!error && !buttonReady && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex h-2 w-2 rounded-full bg-sky-500" aria-hidden="true" />
                  <span>Menyiapkan tombol login Google...</span>
                </div>
              )}
            </div>

            <p className="mt-3 text-xs leading-5 text-slate-500">
              Domain pusat dipakai agar login Google tetap aman dan konsisten.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
