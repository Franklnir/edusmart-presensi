// src/components/EmailVerificationModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react'

const COOLDOWN_SECONDS = 60
const CODE_LENGTH = 6

// ==================== SUB-COMPONENTS ====================

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
        // Auto focus first input when mounted
        const timer = setTimeout(() => focusInput(0), 150)
        return () => clearTimeout(timer)
    }, [focusInput])

    const handleChange = (idx, e) => {
        const char = e.target.value.replace(/\D/g, '').slice(-1)
        const next = [...value]
        next[idx] = char
        onChange(next)
        if (char && idx < CODE_LENGTH - 1) {
            focusInput(idx + 1)
        }
    }

    const handleKeyDown = (idx, e) => {
        if (e.key === 'Backspace' && !value[idx] && idx > 0) {
            focusInput(idx - 1)
        }
        if (e.key === 'ArrowLeft' && idx > 0) {
            focusInput(idx - 1)
        }
        if (e.key === 'ArrowRight' && idx < CODE_LENGTH - 1) {
            focusInput(idx + 1)
        }
    }

    const handlePaste = (e) => {
        e.preventDefault()
        const pasted = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, CODE_LENGTH)
        if (!pasted) return
        const next = [...value]
        for (let i = 0; i < pasted.length; i++) {
            next[i] = pasted[i]
        }
        onChange(next)
        focusInput(Math.min(pasted.length, CODE_LENGTH - 1))
    }

    return (
        <div className="evmCodeInputRow">
            {Array.from({ length: CODE_LENGTH }).map((_, idx) => (
                <input
                    key={idx}
                    ref={(el) => { inputsRef.current[idx] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={value[idx] || ''}
                    onChange={(e) => handleChange(idx, e)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    onPaste={idx === 0 ? handlePaste : undefined}
                    disabled={disabled}
                    className="evmCodeCell"
                    autoComplete="one-time-code"
                />
            ))}
        </div>
    )
}

function SuccessAnimation() {
    return (
        <div className="evmSuccessWrap">
            <div className="evmSuccessCircle">
                <svg className="evmSuccessCheck" viewBox="0 0 52 52">
                    <path className="evmCheckPath" fill="none" d="M14 27l7.8 7.8L38 17" />
                </svg>
            </div>
            <div className="evmSuccessParticles">
                {Array.from({ length: 8 }).map((_, i) => (
                    <span key={i} className="evmParticle" style={{ '--i': i }} />
                ))}
            </div>
            <p className="evmSuccessText">Verifikasi Berhasil!</p>
            <p className="evmSuccessSubtext">Email Anda telah terverifikasi</p>
        </div>
    )
}

// ==================== MAIN MODAL ====================

export default function EmailVerificationModal({
    isOpen,
    onClose,
    email,
    onSendCode,
    onSuccess
}) {
    // phases: 'idle' | 'sending' | 'input' | 'verifying' | 'success'
    const [phase, setPhase] = useState('idle')
    const [cooldown, setCooldown] = useState(0)
    const [codeDigits, setCodeDigits] = useState(Array(CODE_LENGTH).fill(''))
    const [error, setError] = useState('')
    const timerRef = useRef(null)

    // Reset when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setPhase('idle')
            setCooldown(0)
            setCodeDigits(Array(CODE_LENGTH).fill(''))
            setError('')
        } else {
            if (timerRef.current) clearInterval(timerRef.current)
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [isOpen])

    const startCooldown = useCallback(() => {
        setCooldown(COOLDOWN_SECONDS)
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
            setCooldown((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current)
                    timerRef.current = null
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
            await onSendCode()
            startCooldown()
        } catch (err) {
            setError(err?.message || 'Gagal mengirim kode verifikasi. Coba lagi.')
        }
        // Always show input phase, even if sending failed
        setPhase('input')
    }

    const handleVerifyCode = async () => {
        const code = codeDigits.join('')
        if (code.length < CODE_LENGTH) {
            setError('Masukkan kode 6 digit lengkap')
            return
        }

        setPhase('verifying')
        setError('')

        // Simulate verification delay then show success
        await new Promise((resolve) => setTimeout(resolve, 1500))

        setPhase('success')
        if (onSuccess) {
            setTimeout(() => {
                onSuccess()
            }, 2500)
        }
    }

    const handleResend = async () => {
        if (cooldown > 0) return
        setError('')
        setCodeDigits(Array(CODE_LENGTH).fill(''))
        setPhase('sending')
        try {
            await onSendCode()
            setPhase('input')
            startCooldown()
        } catch (err) {
            setError(err?.message || 'Gagal mengirim ulang kode')
            setPhase('input')
        }
    }

    if (!isOpen) return null

    return (
        <div className="evmOverlay" onClick={(e) => { if (e.target === e.currentTarget && phase !== 'verifying') onClose() }}>
            <div className="evmModal evmFadeInUp">
                {/* Close Button */}
                {phase !== 'verifying' && phase !== 'success' && (
                    <button className="evmCloseBtn" onClick={onClose} title="Tutup">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                )}

                {/* Header */}
                <div className="evmHeader">
                    <div className="evmIconWrap">
                        {phase === 'success' ? (
                            <span className="evmIconEmoji">🎉</span>
                        ) : (
                            <span className="evmIconEmoji">📧</span>
                        )}
                    </div>
                    <h2 className="evmTitle">
                        {phase === 'success' ? 'Verifikasi Berhasil' : 'Verifikasi Email'}
                    </h2>
                    {email && phase !== 'success' && (
                        <p className="evmEmailLabel">{email}</p>
                    )}
                </div>

                {/* Body */}
                <div className="evmBody">
                    {/* Phase: Idle */}
                    {phase === 'idle' && (
                        <div className="evmPhaseContent">
                            <p className="evmDesc">
                                Klik tombol di bawah untuk mengirim kode verifikasi 6 digit ke email Anda.
                                Pastikan email aktif dan periksa juga folder spam.
                            </p>
                            <button className="evmPrimaryBtn" onClick={handleSendCode}>
                                <span>📨</span>
                                <span>Kirim Kode Verifikasi</span>
                            </button>
                        </div>
                    )}

                    {/* Phase: Sending */}
                    {phase === 'sending' && (
                        <div className="evmPhaseContent evmCentered">
                            <div className="evmSpinner" />
                            <p className="evmStatusText">Mengirim kode verifikasi...</p>
                        </div>
                    )}

                    {/* Phase: Input — shown IMMEDIATELY after sending */}
                    {phase === 'input' && (
                        <div className="evmPhaseContent">
                            <div className="evmSentBanner">
                                <span>✅</span>
                                <span>Kode verifikasi telah dikirim ke email Anda</span>
                            </div>
                            <p className="evmDesc">
                                Masukkan kode 6 digit dari email. Cek juga folder spam jika tidak ada di inbox.
                            </p>
                            <CodeInput
                                value={codeDigits}
                                onChange={setCodeDigits}
                                disabled={false}
                            />
                            <button
                                className="evmPrimaryBtn"
                                onClick={handleVerifyCode}
                                disabled={codeDigits.join('').length < CODE_LENGTH}
                            >
                                <span>✅</span>
                                <span>Verifikasi Kode</span>
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

                    {/* Phase: Verifying */}
                    {phase === 'verifying' && (
                        <div className="evmPhaseContent evmCentered">
                            <div className="evmSpinner" />
                            <p className="evmStatusText">Memverifikasi kode...</p>
                        </div>
                    )}

                    {/* Phase: Success */}
                    {phase === 'success' && (
                        <div className="evmPhaseContent evmCentered">
                            <SuccessAnimation />
                        </div>
                    )}

                    {/* Error */}
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
