// src/pages/auth/ResetPassword.jsx
import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import PasswordInput from '../../components/PasswordInput'
import { validatePassword } from '../../utils/passwordPolicy'

const ResetPassword = () => {
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Ambil token & email dari query string
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const tokenParam = params.get('token') || ''
      const emailParam = params.get('email') || ''

      setToken(tokenParam)
      setEmail(emailParam)

      if (!tokenParam || !emailParam) {
        setSessionError(
          'Token reset password tidak ditemukan.\n\n' +
          'Pastikan kamu membuka link reset password langsung dari email ' +
          'yang paling terbaru. Jika link sudah pernah dipakai atau sudah ' +
          'terlalu lama, silakan minta link baru dari halaman Lupa Password.'
        )
      }
    } catch (err) {
      console.error('parse reset token error:', err)
      setSessionError(
        err?.message ||
        'Terjadi kesalahan saat memeriksa token reset password. ' +
        'Silakan minta link baru dari halaman Lupa Password.'
      )
    } finally {
      setChecking(false)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!password || !confirmPassword) {
      setError('Password baru dan konfirmasi harus diisi.')
      return
    }

    // Validasi password dengan centralized policy
    const pwdCheck = validatePassword(password)
    if (!pwdCheck.valid) {
      setError(pwdCheck.errors[0])
      return
    }

    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak sama.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const { data, error } = await supabase.auth.resetPassword({
        email,
        token,
        password
      })

      if (error) {
        console.error('updateUser error:', error)

        const msg = error.message?.toLowerCase() || ''
        if (msg.includes('jwt expired') || msg.includes('session')) {
          setError(
            'Sesi reset password sudah kedaluwarsa atau tidak valid.\n' +
            'Silakan minta link reset password yang baru dari halaman Lupa Password.'
          )
        } else {
          setError(error.message || 'Gagal mengubah password.')
        }
      } else {
        console.log('✅ Password updated:', data)
        setSuccess(
          'Password berhasil diubah. Kamu akan diarahkan ke halaman login.'
        )
        setTimeout(() => {
          navigate('/login', { replace: true })
        }, 2000)
      }
    } catch (err) {
      console.error('updateUser error:', err)
      setError(err.message || 'Terjadi kesalahan saat mengubah password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // 1) Saat masih cek sesi dari URL
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100 flex flex-col items-center">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-600 text-sm">
            Menyiapkan halaman reset password...
          </p>
        </div>
      </div>
    )
  }

  // 2) Kalau tidak ada sesi (link invalid / expired / sudah dipakai)
  if (sessionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-red-100">
          <h1 className="text-lg font-semibold text-red-700 mb-2">
            Link Reset Tidak Valid
          </h1>
          <p className="text-sm text-red-600 mb-4 whitespace-pre-line">
            {sessionError}
          </p>

          <Link
            to="/forgot-password"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
          >
            Minta Link Reset Password Baru
          </Link>

          <div className="mt-4 text-center">
            <Link
              to="/login"
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Kembali ke halaman login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // 3) Form ganti password (sesi recovery valid)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4 py-8">
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">
            Atur Ulang Password
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Silakan masukkan password baru untuk akun kamu.
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
              Password Baru
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              placeholder="Minimal 6 karakter, 1 huruf besar, 1 angka"
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-2">
              Konfirmasi Password Baru
            </label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                if (error) setError('')
              }}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              placeholder="Ulangi password baru"
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
                Menyimpan password...
              </>
            ) : (
              'Simpan Password Baru'
            )}
          </button>
        </form>

        <p className="text-xs text-center mt-4 text-slate-500">
          Jika kamu tidak meminta reset password, abaikan email dan jangan
          bagikan link ini kepada siapapun.
        </p>

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

export default ResetPassword
