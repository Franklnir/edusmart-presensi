import React, { useMemo, useState } from 'react'
import { openGoogleAuthPopup, getGoogleAuthLaunchUrl } from '../lib/googlePopupBridge'
import { useUIStore } from '../store/useUIStore'

const normalizeMessage = (value = '') => String(value || '').trim()

const googleStatusCopy = ({ type = 'error', mode = 'login', message = '', expectedEmail = '' } = {}) => {
  const cleanMessage = normalizeMessage(message)
  const email = normalizeMessage(expectedEmail)
  const isLink = mode === 'link'
  const lower = cleanMessage.toLowerCase()

  if (type === 'success') {
    return {
      tone: 'success',
      title: isLink ? 'Google Berhasil Tertaut' : 'Login Google Berhasil',
      message: isLink
        ? 'Akun Google sudah tertaut dan bisa dipakai untuk login berikutnya.'
        : 'Anda berhasil masuk menggunakan Google.',
      detail: isLink ? 'Status tertaut diperbarui otomatis tanpa perlu refresh halaman.' : ''
    }
  }

  if (lower.includes('harus sama') || lower.includes('berbeda')) {
    return {
      tone: 'error',
      title: 'Akun Google Berbeda',
      message: 'Maaf, akun Google yang dipilih berbeda dengan email akun EduSmart.',
      detail: email
        ? `Gunakan akun Google dengan email ${email}, atau ubah email akun EduSmart terlebih dahulu.`
        : 'Gunakan akun Google yang emailnya sama dengan email akun EduSmart.'
    }
  }

  if (lower.includes('email buatan sistem') || lower.includes('email aktif')) {
    return {
      tone: 'warning',
      title: 'Email Akun Belum Siap',
      message: cleanMessage || 'Email akun belum bisa ditautkan ke Google.',
      detail: 'Ganti email akun ke email aktif yang sama dengan akun Google, lalu coba tautkan lagi.'
    }
  }

  if (lower.includes('password') && lower.includes('terlebih dahulu')) {
    return {
      tone: 'warning',
      title: 'Ganti Password Dulu',
      message: cleanMessage,
      detail: 'Setelah password awal diganti, tautkan Google bisa dicoba kembali.'
    }
  }

  if (lower.includes('sudah tertaut') || lower.includes('digunakan akun lain')) {
    return {
      tone: 'error',
      title: 'Google Sudah Digunakan',
      message: cleanMessage,
      detail: 'Pakai akun Google lain atau hubungi admin sekolah untuk mengecek akun yang terkait.'
    }
  }

  if (lower.includes('dikonfirmasi') || lower.includes('dibatalkan') || lower.includes('ditutup')) {
    return {
      tone: 'warning',
      title: isLink ? 'Tautkan Google Belum Selesai' : 'Login Google Belum Selesai',
      message: cleanMessage || 'Kami belum menerima konfirmasi dari Google.',
      detail: email
        ? `Pastikan popup Google selesai dan pilih akun ${email}.`
        : 'Pastikan popup Google selesai, lalu coba lagi.'
    }
  }

  return {
    tone: 'error',
    title: isLink ? 'Tautkan Google Gagal' : 'Login Google Gagal',
    message: cleanMessage || (isLink ? 'Tautkan Google gagal diproses.' : 'Login Google gagal diproses.'),
    detail: 'Silakan coba lagi. Jika masih gagal, hubungi admin dengan menyertakan pesan ini.'
  }
}

function GoogleStatusOverlay({ status, onClose }) {
  if (!status) return null

  const isSuccess = status.tone === 'success'
  const isWarning = status.tone === 'warning'
  const colorClass = isSuccess
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : isWarning
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'
  const buttonClass = isSuccess
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : isWarning
      ? 'bg-amber-600 hover:bg-amber-700'
      : 'bg-rose-600 hover:bg-rose-700'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="google-status-title"
      >
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${colorClass}`}>
              <span className="text-2xl font-black">{isSuccess ? '✓' : isWarning ? '!' : '×'}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="google-status-title" className="text-lg font-extrabold text-slate-950">
                {status.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">{status.message}</p>
              {status.detail && (
                <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  {status.detail}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-2xl px-4 py-2 text-sm font-bold text-white transition-colors ${buttonClass}`}
          >
            Mengerti
          </button>
        </div>
      </div>
    </div>
  )
}

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
  onOAuthSuccess,
  busy = false,
  className = '',
  buttonClassName = '',
  renderClassName = '',
  noteClassName = '',
  iconClassName = '',
  label = '',
  busyLabel = 'Memproses Google...',
  unavailableLabel = 'Hubungi admin untuk mengaktifkan OAuth Google.',
  busyButtonClassName = '',
  expectedEmail = ''
}) {
  const [statusMessage, setStatusMessage] = useState('')
  const [isLaunching, setIsLaunching] = useState(false)
  const [statusOverlay, setStatusOverlay] = useState(null)
  const pushToast = useUIStore((state) => state.pushToast)

  const launchUrl = String(getGoogleAuthLaunchUrl(mode) || '').trim()

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
    if (!launchUrl) return 'URL auth Google pusat belum valid.'
    return ''
  }, [launchUrl])

  const disabled = busy || isLaunching || availabilityMessage !== ''

  const handleClick = async () => {
    if (disabled) return

    setStatusMessage('')
    setIsLaunching(true)

    try {
      const result = await openGoogleAuthPopup({ mode })
      let callbackResult = null
      if (result?.oauth) {
        callbackResult = await onOAuthSuccess?.(result)
        if (callbackResult?.error) {
          throw new Error(callbackResult.error)
        }
        if (mode === 'link') {
          setStatusOverlay(googleStatusCopy({ type: 'success', mode, expectedEmail }))
        }
        return
      }

      const credential = String(result?.credential || '').trim()
      if (!credential) {
        throw new Error('Google tidak mengembalikan identitas akun yang valid.')
      }

      callbackResult = await onCredential?.(credential)
      if (callbackResult?.error) {
        throw new Error(callbackResult.error)
      }
      if (mode === 'link') {
        setStatusOverlay(googleStatusCopy({ type: 'success', mode, expectedEmail }))
      }
    } catch (error) {
      const message = error?.message || 'Login Google gagal diproses.'
      const status = googleStatusCopy({ type: 'error', mode, message, expectedEmail })
      setStatusMessage(message)
      setStatusOverlay(status)
      pushToast(status.tone === 'warning' ? 'warning' : 'error', status.message, {
        title: status.title,
        duration: 6500
      })
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <div className={className}>
      <GoogleStatusOverlay status={statusOverlay} onClose={() => setStatusOverlay(null)} />

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
