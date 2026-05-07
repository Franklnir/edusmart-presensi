import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openGoogleAuthPopup, getGoogleAuthBridgeUrl } from '../lib/googlePopupBridge'

const GoogleIcon = ({ className = '' }) => (
  <span className={className} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">
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

export default function GoogleCredentialButton({
  mode = 'login',
  onCredential,
  busy = false,
  className = '',
  buttonClassName = '',
  renderClassName = '',
  noteClassName = '',
  iconClassName = '',
  label = '',
  busyLabel = 'Memproses Google...',
  unavailableLabel = 'Hubungi admin untuk mengaktifkan OAuth Google.',
  busyButtonClassName = ''
}) {
  const [statusMessage, setStatusMessage] = useState('')
  const [isLaunching, setIsLaunching] = useState(false)

  const isGoogleAuthEnabled = Boolean(supabase.auth.isGoogleEnabled?.())
  const googleClientId = String(supabase.auth.getGoogleClientId?.() || '').trim()
  const bridgeUrl = String(getGoogleAuthBridgeUrl() || '').trim()

  const resolvedLabel = label || (mode === 'link' ? 'Tautkan Google' : 'Masuk dengan Google')
  const resolvedBusyLabel =
    busyLabel || (mode === 'link' ? 'Memproses tautan Google...' : 'Memproses login Google...')
  const resolvedButtonClassName =
    buttonClassName ||
    renderClassName ||
    'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70'
  const resolvedBusyButtonClassName = busyButtonClassName || resolvedButtonClassName
  const resolvedIconClassName = iconClassName || 'inline-flex h-5 w-5 items-center justify-center'

  const availabilityMessage = useMemo(() => {
    if (!isGoogleAuthEnabled) return unavailableLabel
    if (!googleClientId) return 'Client ID Google belum terpasang di frontend.'
    if (!bridgeUrl) return 'URL auth Google pusat belum valid.'
    return ''
  }, [bridgeUrl, googleClientId, isGoogleAuthEnabled, unavailableLabel])

  const disabled = busy || isLaunching || availabilityMessage !== ''

  const handleClick = async () => {
    if (disabled) return

    setStatusMessage('')
    setIsLaunching(true)

    try {
      const result = await openGoogleAuthPopup({ mode })
      const credential = String(result?.credential || '').trim()
      if (!credential) {
        throw new Error('Google tidak mengembalikan identitas akun yang valid.')
      }

      await onCredential?.(credential)
    } catch (error) {
      setStatusMessage(error?.message || 'Login Google gagal diproses.')
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={busy || isLaunching ? resolvedBusyButtonClassName : resolvedButtonClassName}
      >
        <GoogleIcon className={resolvedIconClassName} />
        <span>{busy || isLaunching ? resolvedBusyLabel : resolvedLabel}</span>
      </button>

      {!!availabilityMessage && (
        <p className={noteClassName}>{availabilityMessage}</p>
      )}

      {!availabilityMessage && !!statusMessage && (
        <p className={noteClassName}>{statusMessage}</p>
      )}
    </div>
  )
}
