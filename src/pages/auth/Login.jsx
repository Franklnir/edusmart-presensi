import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'

const Login = () => {
  const navigate = useNavigate()
  const { user, profile, login, settings, isLoading } = useAuthStore()

  const [form, setForm] = useState({ email: '', password: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Ambil nama sekolah & logo dari settings global
  const schoolName = settings?.nama_sekolah || 'Sekolah'
  const logoUrl =
    settings?.logo_url || // nama kolom di Supabase
    settings?.logourl ||   // alternatif
    settings?.logoUrl      // kalau camelCase

  // Redirect / blokir nonaktif jika sudah login (LOGIC TETAP)
  useEffect(() => {
    if (user && profile) {
      console.log('🔄 Login effect - user:', profile.role, 'status:', profile.status)

      if (profile.status === 'nonaktif') {
        console.log('🚫 Akun nonaktif mencoba login, melakukan logout...')

        let baseMessage = ''
        if (profile.role === 'guru') {
          baseMessage = 'Akun guru ini dinonaktifkan. Silakan hubungi administrator.'
        } else if (profile.role === 'siswa') {
          baseMessage =
            'Akun siswa ini dinonaktifkan. Silakan hubungi wali kelas atau admin.'
        } else {
          baseMessage = 'Akun ini dinonaktifkan. Silakan hubungi administrator.'
        }

        if (profile.alasan_nonaktif) {
          baseMessage += ` Alasan: ${profile.alasan_nonaktif}`
        }

        setError(baseMessage)
        supabase.auth.signOut()
        return
      }

      const redirectMap = {
        siswa: '/siswa/home',
        guru: '/guru/jadwal',
        admin: '/admin/home'
      }

      const targetPath = redirectMap[profile.role]

      if (targetPath) {
        console.log(`🎯 Redirecting ${profile.role} to: ${targetPath}`)
        setTimeout(() => {
          navigate(targetPath, { replace: true })
        }, 100)
      }
    }
  }, [user, profile, navigate])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (error) setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.email.trim() || !form.password.trim()) {
      setError('Email dan password harus diisi')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const result = await login(form.email, form.password)

      if (result?.error) {
        setError(result.error)
      }
    } catch (err) {
      console.error('Login error:', err)
      setError(err?.message || 'Terjadi kesalahan saat login')
    } finally {
      setIsSubmitting(false)
    }
  }

  const disabled = isSubmitting || isLoading

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4 py-8">
      {/* Card utama: tetap kecil */}
      <div className="w-full max-w-3xl">
        <div className="bg-white/90 backdrop-blur-sm rounded-[32px] shadow-2xl border border-slate-100 w-full overflow-hidden flex flex-col md:flex-row">
          {/* KIRI: area form */}
          <div className="w-full md:w-1/2 px-6 sm:px-8 lg:px-9 py-4 md:py-5 flex flex-col justify-center">
            <div className="mb-4 md:mb-5">
              <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                Login
              </h1>
              <p className="text-sm md:text-base text-slate-500 mt-2">
                Selamat datang di sistem absensi.
              </p>
            </div>

            {error && (
              <div
                className={`mb-3 p-3 border rounded-lg text-sm ${
                  error.toLowerCase().includes('nonaktif')
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {error.toLowerCase().includes('nonaktif') ? (
                  <div className="flex items-start">
                    <svg
                      className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div>
                      <p className="font-semibold">Akun Dinonaktifkan</p>
                      <p className="text-sm mt-1 whitespace-pre-line">{error}</p>
                    </div>
                  </div>
                ) : (
                  error
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors"
                    placeholder="nama@sekolah.sch.id"
                    required
                    disabled={disabled}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    👤
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    className="w-full pl-10 pr-12 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors"
                    placeholder="Masukkan password"
                    required
                    disabled={disabled}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    🔒
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    disabled={disabled}
                  >
                    {showPassword ? (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L7.757 7.757M9.878 9.878l2.121-2.121m0 0l2.122-2.122M14.121 9.88l2.122 2.121"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>

                {/* ⬇️ Tambahan: link Lupa Password */}
                <div className="flex justify-end mt-1">
                  <Link
                    to="/forgot-password"
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
                  >
                    Lupa password?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={disabled}
                className="mt-1.5 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30"
              >
                {disabled ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Memproses...
                  </>
                ) : (
                  'Masuk'
                )}
              </button>
            </form>

            <p className="text-sm text-center mt-4 text-slate-500">
              Belum punya akun?{' '}
              <Link
                to="/register"
                className="text-indigo-600 font-semibold hover:text-indigo-700"
              >
                Daftar di sini
              </Link>
            </p>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start">
                <svg
                  className="w-4 h-4 text-blue-600 mt-0.5 mr-2 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="text-sm text-blue-700">
                  <p className="font-medium">Informasi Login</p>
                  <p className="mt-1 text-xs">
                    Akun yang berstatus <span className="font-semibold">nonaktif</span>{' '}
                    (baik siswa maupun guru) tidak dapat login hingga diaktifkan kembali
                    oleh administrator.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* KANAN: panel logo, lebih melebar (landscape) dan lebih pendek */}
          <div className="w-full md:w-1/2 bg-gradient-to-br from-indigo-50 via-sky-50 to-slate-50 flex items-center justify-center px-6 py-4 md:py-5">
            <div className="w-full">
              {/* RASIO DI SINI: semakin kecil angka pt[...] semakin pendek & melebar */}
              <div className="relative w-full rounded-2xl bg-white shadow-lg overflow-hidden pt-[110%] mx-auto max-w-[330px]">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={`Logo ${schoolName}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-indigo-100">
                    <span className="text-5xl md:text-6xl font-extrabold text-indigo-600">
                      {schoolName[0]?.toUpperCase() || 'S'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default Login
