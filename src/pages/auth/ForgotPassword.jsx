// src/pages/auth/ForgotPassword.jsx
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!email) {
      setError('Email harus diisi.')
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
      }
    } catch (err) {
      console.error('resetPasswordForEmail error:', err)
      setError(err.message || 'Terjadi kesalahan saat mengirim email reset password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4">
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">
            Lupa Password
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Masukkan email yang terdaftar untuk menerima link reset password.
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
            disabled={isSubmitting}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Mengirim link...
              </>
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
