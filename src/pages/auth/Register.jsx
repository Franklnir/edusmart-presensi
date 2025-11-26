import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { supabase } from '../../lib/supabase'

const Register = () => {
  const { register, settings, initialized, refreshSettings } = useAuthStore()
  const { loading, setLoading } = useUIStore()
  const nav = useNavigate()

  const [role, setRole] = useState('')
  const [nama, setNama] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)

  // Load settings dengan fallback
  useEffect(() => {
    const loadSettingsWithFallback = async () => {
      try {
        if (initialized && !settings) {
          await refreshSettings()
        }

        if (!settings) {
          const { data, error } = await supabase
            .from('settings')
            .select('*')
            .limit(1)
            .single()

          if (!error && data) {
            useAuthStore.setState({ settings: data })
          }
        }
      } catch (error) {
        console.error('Error in settings loading fallback:', error)
      } finally {
        setIsLoadingSettings(false)
      }
    }

    loadSettingsWithFallback()
  }, [initialized, settings, refreshSettings])

  // Status buka/tutup dari settings
  const isSiswaOpen = settings?.registrasi_siswa_aktif !== false
  const isGuruOpen = settings?.registrasi_guru_aktif !== false
  const isAdminOpen = settings?.registrasi_admin_aktif !== false

  const availableRoles = []
  if (isSiswaOpen) availableRoles.push({ value: 'siswa', label: 'Siswa' })
  if (isGuruOpen) availableRoles.push({ value: 'guru', label: 'Guru' })
  if (isAdminOpen) availableRoles.push({ value: 'admin', label: 'Admin' })

  const allClosed = availableRoles.length === 0

  // Set role otomatis jika hanya ada satu pilihan
  useEffect(() => {
    if (availableRoles.length === 1 && !role) {
      setRole(availableRoles[0].value)
    }
  }, [availableRoles, role])

  // Validasi password
  const validatePassword = (password) => {
    if (password.length < 6) {
      return 'Password minimal 6 karakter'
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'Password harus mengandung minimal satu huruf besar'
    }
    if (!/(?=.*\d)/.test(password)) {
      return 'Password harus mengandung minimal satu angka'
    }
    return null
  }

  // Handle submit
  const onSubmit = async (e) => {
    e.preventDefault()

    if (allClosed) {
      alert('Pendaftaran akun baru saat ini ditutup oleh Admin.')
      return
    }

    if (!role) {
      alert('Silakan pilih role pendaftaran.')
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      alert(passwordError)
      return
    }

    if (password !== confirm) {
      alert('Konfirmasi password tidak cocok')
      return
    }

    if (!nama.trim()) {
      alert('Silakan isi nama lengkap.')
      return
    }

    try {
      setLoading(true)

      const result = await register({
        email,
        password,
        role,
        profile: {
          email: email,
          role: role,
          nama: nama.trim()
        }
      })

      if (result.error) {
        throw new Error(result.error)
      }

      alert('Pendaftaran berhasil! Silakan login.')
      nav('/login')
    } catch (err) {
      console.error('Error saat pendaftaran:', err)
      alert(`Gagal mendaftar: ${err.message || 'Silakan coba lagi.'}`)
    } finally {
      setLoading(false)
    }
  }

  if (isLoadingSettings) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Memuat pengaturan registrasi...</p>
        </div>
      </div>
    )
  }

  const schoolName = settings?.nama_sekolah || 'Sekolah'
  const logoUrl = settings?.logo_url || settings?.logourl || settings?.logoUrl

  const disabledSubmit = loading || allClosed || !role

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-slate-100 px-4 py-8">
      <div className="w-full max-w-3xl">
        <div className="bg-white/90 backdrop-blur-sm rounded-[32px] shadow-2xl border border-slate-100 w-full overflow-hidden flex flex-col md:flex-row">
          
          {/* KIRI: Form Register - Lebih Compact */}
          <div className="w-full md:w-1/2 px-6 sm:px-8 py-5 md:py-6 flex flex-col justify-center">
            
            {/* Header - Lebih Kecil */}
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
                Daftar Akun
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Buat akun baru untuk {schoolName}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              
              {/* Pilihan Role - Lebih Compact */}
              {availableRoles.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                    Daftar Sebagai:
                  </label>
                  <div className="flex gap-1.5">
                    {availableRoles.map((r) => (
                      <label
                        key={r.value}
                        className={`flex-1 text-center p-1.5 border rounded-lg cursor-pointer transition-all text-xs ${
                          role === r.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={r.value}
                          checked={role === r.value}
                          onChange={(e) => setRole(e.target.value)}
                          className="hidden"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Role jika hanya 1 pilihan */}
              {availableRoles.length === 1 && role && (
                <div className="p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-center mb-1">
                  <p className="text-indigo-700 font-medium text-xs">
                    Mendaftar sebagai: <span className="font-bold">{availableRoles[0].label}</span>
                  </p>
                </div>
              )}

              {/* Data Pribadi - Lebih Compact */}
              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    Nama Lengkap
                  </label>
                  <div className="relative">
                    <input
                      className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors text-sm"
                      value={nama}
                      onChange={e => setNama(e.target.value)}
                      required
                      placeholder="Masukkan nama lengkap"
                      disabled={allClosed}
                    />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                      👤
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    Email
                  </label>
                  <div className="relative">
                    <input
                      className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors text-sm"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      type="email"
                      placeholder="nama@example.com"
                      disabled={allClosed}
                    />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                      ✉️
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        className="w-full pl-8 pr-8 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors text-sm"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Minimal 6 karakter"
                        minLength="6"
                        disabled={allClosed}
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                        🔒
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        disabled={allClosed}
                      >
                        {showPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Min. 6 karakter, huruf besar & angka
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                      Konfirmasi Password
                    </label>
                    <div className="relative">
                      <input
                        className="w-full pl-8 pr-8 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 transition-colors text-sm"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        required
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Ketik ulang password"
                        disabled={allClosed}
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                        🔒
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        disabled={allClosed}
                      >
                        {showConfirmPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tombol Submit */}
              <div className="pt-1">
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-600/30 text-sm"
                  disabled={disabledSubmit}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Memproses...
                    </>
                  ) : allClosed ? (
                    'Pendaftaran Ditutup'
                  ) : (
                    'Daftar Sekarang'
                  )}
                </button>

                <div className="mt-3 text-center">
                  <p className="text-xs text-slate-500">
                    Sudah punya akun?{' '}
                    <Link
                      to="/login"
                      className="text-indigo-600 font-semibold hover:text-indigo-700 text-xs"
                    >
                      Login di sini
                    </Link>
                  </p>
                </div>
              </div>
            </form>
          </div>

          {/* KANAN: Panel Logo - Sama seperti Login tapi lebih kecil */}
          <div className="w-full md:w-1/2 bg-gradient-to-br from-indigo-50 via-sky-50 to-slate-50 flex items-center justify-center px-5 py-5 md:py-6">
            <div className="w-full text-center">
              <div className="relative w-full rounded-2xl bg-white shadow-lg overflow-hidden pt-[110%] mx-auto max-w-[330px]">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={`Logo ${schoolName}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-indigo-100">
                    <span className="text-4xl md:text-5xl font-extrabold text-indigo-600">
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

export default Register