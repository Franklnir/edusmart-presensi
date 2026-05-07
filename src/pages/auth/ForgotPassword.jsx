// src/pages/auth/ForgotPassword.jsx
import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const ForgotPassword = () => {
  const adminSubdomain = String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin')
    .trim()
    .toLowerCase()
  const runtimeHost =
    typeof window !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : ''
  const hostParts = runtimeHost.split('.').filter(Boolean)
  const isAdminHost =
    runtimeHost === adminSubdomain ||
    (hostParts.length >= 2 && hostParts[0] === adminSubdomain)

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Rate limiting: 60s cooldown setelah submit
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (cooldownEnd <= 0) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000))
      setCooldownLeft(left)
      if (left <= 0) {
        clearInterval(timerRef.current)
        setCooldownEnd(0)
      }
    }
    tick()
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [cooldownEnd])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!email) {
      setError('Email harus diisi.')
      return
    }

    // Rate limit check
    if (cooldownEnd > Date.now()) {
      setError(`Tunggu ${cooldownLeft} detik sebelum mengirim ulang.`)
      return
    }

    setIsSubmitting(true)
    try {
      const redirectTo = `${window.location.origin}/reset-password`

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo
      })

      if (error) {
        console.error('resetPasswordForEmail error:', error)
        setError(error.message || 'Gagal mengirim email reset password.')
      } else {
        setSuccess(
          'Link reset password telah dikirim ke email kamu. Silakan cek inbox/spam.'
        )
        // Start 60s cooldown
        setCooldownEnd(Date.now() + 60000)
        setCooldownLeft(60)
      }
    } catch (err) {
      console.error('resetPasswordForEmail error:', err)
      setError(err.message || 'Terjadi kesalahan saat mengirim email reset password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isAdminHost) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100">
          <div className="text-center mb-4">
            <h1 className="text-2xl font-bold text-slate-800">Lupa Password</h1>
            <p className="text-sm text-slate-500 mt-2">
              Fitur ini tidak tersedia untuk admin dan super admin.
            </p>
          </div>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold">
              Kembali ke halaman login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4">
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">
            Lupa Password
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Fitur ini khusus guru dan siswa. Masukkan email terdaftar untuk menerima link reset password.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 rounded-lg">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (error) setError('')
              }}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              placeholder="Masukkan email yang terdaftar"
              disabled={isSubmitting}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || cooldownEnd > Date.now()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Mengirim link...
              </>
            ) : cooldownEnd > Date.now() ? (
              `Tunggu ${cooldownLeft} detik...`
            ) : (
              'Kirim Link Reset Password'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
          >
            Kembali ke halaman login
          </Link>
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
