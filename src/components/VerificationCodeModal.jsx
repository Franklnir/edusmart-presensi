import React, { useState, useEffect, useRef, useCallback } from 'react'

const COOLDOWN_SECONDS = 60
const CODE_LENGTH = 6

function CooldownBadge({ seconds }) {
  return (
    <span className="evmCooldownBadge">
      <span className="evmCooldownDot" />
      Kirim ulang dalam {seconds}s
    </span>
  )
}

function CodeInput({ value, onChange, disabled }) {
  const inputsRef = useRef([])

  const focusInput = useCallback((idx) => {
    if (inputsRef.current[idx]) {
      inputsRef.current[idx].focus()
      inputsRef.current[idx].select()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => focusInput(0), 150)
    return () => clearTimeout(timer)
  }, [focusInput])

  const handleChange = (idx, event) => {
    const char = event.target.value.replace(/\D/g, '').slice(-1)
    const next = [...value]
    next[idx] = char
    onChange(next)
    if (char && idx < CODE_LENGTH - 1) {
      focusInput(idx + 1)
    }
  }

  const handleKeyDown = (idx, event) => {
    if (event.key === 'Backspace' && !value[idx] && idx > 0) {
      focusInput(idx - 1)
    }
    if (event.key === 'ArrowLeft' && idx > 0) {
      focusInput(idx - 1)
    }
    if (event.key === 'ArrowRight' && idx < CODE_LENGTH - 1) {
      focusInput(idx + 1)
    }
  }

  const handlePaste = (event) => {
    event.preventDefault()
    const pasted = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return

    const next = [...value]
    for (let index = 0; index < pasted.length; index += 1) {
      next[index] = pasted[index]
    }

    onChange(next)
    focusInput(Math.min(pasted.length, CODE_LENGTH - 1))
  }

  return (
    <div className="evmCodeInputRow">
      {Array.from({ length: CODE_LENGTH }).map((_, idx) => (
        <input
          key={idx}
          ref={(element) => {
            inputsRef.current[idx] = element
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[idx] || ''}
          onChange={(event) => handleChange(idx, event)}
          onKeyDown={(event) => handleKeyDown(idx, event)}
          onPaste={idx === 0 ? handlePaste : undefined}
          disabled={disabled}
          className="evmCodeCell"
          autoComplete="one-time-code"
        />
      ))}
    </div>
  )
}

function SuccessAnimation({
  title = 'Verifikasi Berhasil!',
  subtitle = 'Perubahan akun berhasil diproses.'
}) {
  return (
    <div className="evmSuccessWrap">
      <div className="evmSuccessCircle">
        <svg className="evmSuccessCheck" viewBox="0 0 52 52">
          <path className="evmCheckPath" fill="none" d="M14 27l7.8 7.8L38 17" />
        </svg>
      </div>
      <div className="evmSuccessParticles">
        {Array.from({ length: 8 }).map((_, index) => (
          <span key={index} className="evmParticle" style={{ '--i': index }} />
        ))}
      </div>
      <p className="evmSuccessText">{title}</p>
      <p className="evmSuccessSubtext">{subtitle}</p>
    </div>
  )
}

export default function VerificationCodeModal({
  isOpen,
  onClose,
  onSuccess,
  email,
  title = 'Verifikasi Kode',
  description = 'Kirim kode 6 digit ke email Anda untuk melanjutkan perubahan akun.',
  inputDescription = 'Masukkan kode 6 digit dari email. Cek juga folder spam jika tidak ada di inbox.',
  sendLabel = 'Kirim Kode Verifikasi',
  confirmLabel = 'Konfirmasi Perubahan',
  successTitle = 'Perubahan Berhasil!',
  successSubtitle = 'Perubahan akun berhasil disimpan.',
  onSendCode,
  onVerifyCode
}) {
  const [phase, setPhase] = useState('idle')
  const [cooldown, setCooldown] = useState(0)
  const [codeDigits, setCodeDigits] = useState(Array(CODE_LENGTH).fill(''))
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setPhase('idle')
      setCooldown(0)
      setCodeDigits(Array(CODE_LENGTH).fill(''))
      setError('')
      return undefined
    }

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    return undefined
  }, [isOpen])

  useEffect(() => () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS)
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return 0
        }

        return prev - 1
      })
    }, 1000)
  }, [])

  const handleSendCode = async () => {
    setPhase('sending')
    setError('')

    try {
      await onSendCode?.()
      startCooldown()
      setPhase('input')
    } catch (err) {
      setError(err?.message || 'Gagal mengirim kode verifikasi. Coba lagi.')
      setPhase('idle')
    }
  }

  const handleVerifyCode = async () => {
    const code = codeDigits.join('')
    if (code.length < CODE_LENGTH) {
      setError('Masukkan kode 6 digit lengkap')
      return
    }

    setPhase('verifying')
    setError('')

    try {
      await onVerifyCode?.(code)
      setPhase('success')

      if (onSuccess) {
        setTimeout(() => {
          onSuccess()
        }, 1200)
      }
    } catch (err) {
      setError(err?.message || 'Kode verifikasi tidak valid.')
      setPhase('input')
    }
  }

  const handleResend = async () => {
    if (cooldown > 0) return

    setCodeDigits(Array(CODE_LENGTH).fill(''))
    setError('')
    await handleSendCode()
  }

  if (!isOpen) return null

  return (
    <div
      className="evmOverlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && phase !== 'verifying') {
          onClose?.()
        }
      }}
    >
      <div className="evmModal evmFadeInUp">
        {phase !== 'verifying' && phase !== 'success' && (
          <button className="evmCloseBtn" onClick={onClose} title="Tutup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="evmHeader">
          <div className="evmIconWrap">
            {phase === 'success' ? (
              <span className="evmIconEmoji">🎉</span>
            ) : (
              <span className="evmIconEmoji">🔐</span>
            )}
          </div>
          <h2 className="evmTitle">
            {phase === 'success' ? successTitle : title}
          </h2>
          {email && phase !== 'success' && (
            <p className="evmEmailLabel">{email}</p>
          )}
        </div>

        <div className="evmBody">
          {phase === 'idle' && (
            <div className="evmPhaseContent">
              <p className="evmDesc">{description}</p>
              <button className="evmPrimaryBtn" onClick={handleSendCode}>
                <span>📨</span>
                <span>{sendLabel}</span>
              </button>
            </div>
          )}

          {phase === 'sending' && (
            <div className="evmPhaseContent evmCentered">
              <div className="evmSpinner" />
              <p className="evmStatusText">Mengirim kode verifikasi...</p>
            </div>
          )}

          {phase === 'input' && (
            <div className="evmPhaseContent">
              <div className="evmSentBanner">
                <span>✅</span>
                <span>Kode verifikasi telah dikirim ke email Anda</span>
              </div>
              <p className="evmDesc">{inputDescription}</p>
              <CodeInput value={codeDigits} onChange={setCodeDigits} disabled={false} />
              <button
                className="evmPrimaryBtn"
                onClick={handleVerifyCode}
                disabled={codeDigits.join('').length < CODE_LENGTH}
              >
                <span>✅</span>
                <span>{confirmLabel}</span>
              </button>
              <div className="evmResendRow">
                {cooldown > 0 ? (
                  <CooldownBadge seconds={cooldown} />
                ) : (
                  <button className="evmResendBtn" onClick={handleResend}>
                    📨 Kirim ulang kode
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === 'verifying' && (
            <div className="evmPhaseContent evmCentered">
              <div className="evmSpinner" />
              <p className="evmStatusText">Memverifikasi kode...</p>
            </div>
          )}

          {phase === 'success' && (
            <div className="evmPhaseContent evmCentered">
              <SuccessAnimation title={successTitle} subtitle={successSubtitle} />
            </div>
          )}

          {error && (
            <div className="evmError">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
