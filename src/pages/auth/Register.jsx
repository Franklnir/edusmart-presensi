// src/pages/auth/Register.jsx
import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import { logError } from '../../utils/logger'
import '../../styles/Login.css'

const initialSettings = {
  nama_sekolah: '',
  logo_url: '',
  registrasi_siswa_aktif: true,
  registrasi_guru_aktif: true,
  registrasi_admin_aktif: false,
  alamat: '',
  telepon: '',
  email: '',
  link_facebook: null,
  link_instagram: null,
  link_youtube: null,
  link_tiktok: null
}

const initialForm = {
  nama: '',
  email: '',
  password: '',
  confirmPassword: ''
}

export default function Register() {
  const nav = useNavigate()

  /* ====== STATE PENGATURAN (settings) ====== */
  const [settings, setSettings] = useState(initialSettings)
  const [settingsId, setSettingsId] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  /* ====== STATE REGISTRASI & OTP ====== */
  const [selectedRole, setSelectedRole] = useState(null)
  const [form, setForm] = useState(initialForm)

  const [step, setStep] = useState('email') // 'email' | 'otp'
  const [otp, setOtp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [otpSent, setOtpSent] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0) // detik untuk resend

  /* ====== LOAD SETTINGS SEKALI DI AWAL ====== */
  useEffect(() => {
    let isCancelled = false

    async function loadSettings() {
      setLoadingSettings(true)
      try {
        let { data, error } = await supabase
          .from('settings')
          .select('*')
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code === 'PGRST116') {
          data = null
        } else if (error) {
          throw error
        }

        if (!isCancelled && data) {
          setSettingsId(data.id)
          setSettings(prev => ({
            ...prev,
            nama_sekolah: data.nama_sekolah || '',
            logo_url: data.logo_url || '',
            registrasi_siswa_aktif: data.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: data.registrasi_guru_aktif ?? true,
            registrasi_admin_aktif: data.registrasi_admin_aktif ?? false,
            alamat: data.alamat || '',
            telepon: data.telepon || '',
            email: data.email || '',
            link_facebook: data.link_facebook,
            link_instagram: data.link_instagram,
            link_youtube: data.link_youtube,
            link_tiktok: data.link_tiktok
          }))
        }
      } catch (err) {
        if (!isCancelled) {
          logError('Gagal load settings register:', err)
        }
      } finally {
        if (!isCancelled) {
          setLoadingSettings(false)
        }
      }
    }

    loadSettings()
    return () => {
      isCancelled = true
    }
  }, [])

  /* ====== REALTIME UPDATE SETTINGS (optional) ====== */
  useEffect(() => {
    if (!settingsId) return

    const channel = supabase
      .channel('register_settings_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          filter: `id=eq.${settingsId}`
        },
        payload => {
          const row = payload.new
          if (!row) return

          setSettings(prev => ({
            ...prev,
            nama_sekolah: row.nama_sekolah || '',
            logo_url: row.logo_url || '',
            registrasi_siswa_aktif: row.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: row.registrasi_guru_aktif ?? true,
            registrasi_admin_aktif: row.registrasi_admin_aktif ?? false,
            alamat: row.alamat || '',
            telepon: row.telepon || '',
            email: row.email || '',
            link_facebook: row.link_facebook,
            link_instagram: row.link_instagram,
            link_youtube: row.link_youtube,
            link_tiktok: row.link_tiktok
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId])

  /* ====== TIMER COOLDOWN OTP (untuk tombol resend) ====== */
  useEffect(() => {
    if (!otpSent || otpCooldown <= 0) return

    const timer = setInterval(() => {
      setOtpCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [otpSent, otpCooldown])

  /* ====== HELPER ====== */
  const resetMessages = () => {
    setErrorMessage('')
    setSuccessMessage('')
  }

  const allDisabled =
    !settings.registrasi_siswa_aktif &&
    !settings.registrasi_guru_aktif &&
    !settings.registrasi_admin_aktif

  const handleSelectRole = role => {
    setSelectedRole(role)
    resetMessages()
    setStep('email')
    setOtp('')
  }

  const handleInputChange = e => {
    const { name, value } = e.target
    resetMessages()
    setForm(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const validateEmailStep = () => {
    if (!selectedRole) return 'Silakan pilih jenis akun terlebih dahulu.'
    if (!form.nama.trim()) return 'Nama lengkap wajib diisi.'
    if (!form.email.trim()) return 'Email wajib diisi.'

    const email = form.email.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return 'Format email tidak valid.'
    }

    // Hanya izinkan email Gmail
    if (!email.endsWith('@gmail.com')) {
      return 'Hanya email Gmail (@gmail.com) yang diizinkan untuk registrasi.'
    }

    return null
  }

  const validateOtpStep = () => {
    if (!otp.trim()) return 'Kode OTP wajib diisi.'
    if (!/^\d{6}$/.test(otp.trim())) {
      return 'OTP harus 6 digit angka.'
    }

    if (!form.password) return 'Password wajib diisi.'
    if (form.password.length < 8) {
      return 'Password minimal 8 karakter.'
    }
    if (!/(?=.*[A-Z])/.test(form.password)) {
      return 'Password harus mengandung minimal 1 huruf besar.'
    }
    if (!/(?=.*\d)/.test(form.password)) {
      return 'Password harus mengandung minimal 1 angka.'
    }
    if (/\s/.test(form.password)) {
      return 'Password tidak boleh mengandung spasi.'
    }
    if (form.password !== form.confirmPassword) {
      return 'Konfirmasi password tidak sama.'
    }
    return null
  }

  /* ====== STEP 1: KIRIM OTP KE EMAIL ====== */
  const handleSendOtp = async e => {
    e.preventDefault()
    resetMessages()

    const validationError = validateEmailStep()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmitting(true)
      const email = form.email.trim().toLowerCase()

      // PANGGIL EDGE FUNCTION: send-otp-register
      const { data, error } = await supabase.functions.invoke(
        'send-otp-register',
        {
          body: {
            email,
            role: selectedRole,
            nama: form.nama.trim()
          }
        }
      )

      if (error) {
        logError('send-otp-register error:', error)
        setErrorMessage(
          data?.message ||
            error.message ||
            'Gagal mengirim OTP. Coba beberapa saat lagi.'
        )
        return
      }

      if (!data?.ok) {
        setErrorMessage(
          data?.message || 'Gagal mengirim OTP. Silakan hubungi admin.'
        )
        return
      }

      setOtpSent(true)
      setOtpCooldown(60) // cooldown 60 detik
      setStep('otp')
      setSuccessMessage(
        data.message ||
          'OTP sudah dikirim ke email Anda. Silakan cek inbox / spam.'
      )
    } catch (err) {
      logError('Unhandled error send-otp-register:', err)
      setErrorMessage('Terjadi kesalahan saat mengirim OTP.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResendOtp = async () => {
    if (!otpSent || otpCooldown > 0) return
    resetMessages()

    const validationError = validateEmailStep()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmitting(true)
      const email = form.email.trim().toLowerCase()

      const { data, error } = await supabase.functions.invoke(
        'send-otp-register',
        {
          body: {
            email,
            role: selectedRole,
            nama: form.nama.trim(),
            resend: true
          }
        }
      )

      if (error) {
        logError('resend-otp error:', error)
        setErrorMessage(
          data?.message ||
            error.message ||
            'Gagal mengirim ulang OTP. Coba lagi nanti.'
        )
        return
      }

      if (!data?.ok) {
        setErrorMessage(
          data?.message || 'Gagal mengirim ulang OTP. Silakan hubungi admin.'
        )
        return
      }

      setOtp('')
      setOtpCooldown(60)
      setSuccessMessage(
        data.message ||
          'OTP baru sudah dikirim. Silakan cek email Anda kembali.'
      )
    } catch (err) {
      logError('Unhandled error resend-otp:', err)
      setErrorMessage('Terjadi kesalahan saat mengirim ulang OTP.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ====== STEP 2: VERIFIKASI OTP & BUAT AKUN ====== */
  const handleVerifyAndRegister = async e => {
    e.preventDefault()
    resetMessages()

    const validationError = validateOtpStep()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmitting(true)
      const email = form.email.trim().toLowerCase()

      // PANGGIL EDGE FUNCTION: verify-otp-register
      const { data, error } = await supabase.functions.invoke(
        'verify-otp-register',
        {
          body: {
            email,
            role: selectedRole,
            otp: otp.trim(),
            nama: form.nama.trim(),
            password: form.password
            // kalau nanti kamu mau kirim kelas/jk/telp, tambahkan di sini
          }
        }
      )

      if (error) {
        logError('verify-otp-register error:', error)
        setErrorMessage(
          data?.message ||
            error.message ||
            'Gagal verifikasi OTP. Coba beberapa saat lagi.'
        )
        return
      }

      if (!data?.ok) {
        setErrorMessage(
          data?.message || 'Verifikasi OTP gagal. Silakan ulangi proses.'
        )
        return
      }

      setSuccessMessage(
        data.message ||
          'Registrasi berhasil! Silakan login menggunakan akun Anda.'
      )
      setTimeout(() => {
        nav('/login')
      }, 2000)
    } catch (err) {
      logError('Unhandled error verify-otp-register:', err)
      setErrorMessage('Terjadi kesalahan saat memproses registrasi.')
    } finally {
      setSubmitting(false)
    }
  }

  /* ====== RENDER ====== */
  if (loadingSettings) {
    return (
      <div className="login-loading">
        <div className="login-spinner"></div>
      </div>
    )
  }

  const schoolName = settings.nama_sekolah || 'Nama Sekolah'
  const logoUrl = settings.logo_url
  const address = settings.alamat || 'Alamat sekolah belum diisi'
  const phone = settings.telepon || '-'
  const emailSekolah = settings.email || '-'

  const socials = [
    { key: 'facebook', href: settings?.link_facebook, icon: 'ri-facebook-fill' },
    { key: 'tiktok', href: settings?.link_tiktok, icon: 'ri-tiktok-fill' },
    {
      key: 'instagram',
      href: settings?.link_instagram,
      icon: 'ri-instagram-fill'
    },
    { key: 'youtube', href: settings?.link_youtube, icon: 'ri-youtube-fill' }
  ].filter(social => social.href)

  const canSendOtp = !submitting && !allDisabled
  const canVerify =
    !submitting && otpSent && step === 'otp' && otp.trim().length === 6

  return (
    <div className="login">
      {/* Background Elements */}
      <div className="login__bg">
        <div className="login__bg-grid"></div>
        <div className="login__bg-blur-1"></div>
        <div className="login__bg-blur-2"></div>
      </div>

      <div className="login__container">
        {/* Brand Section - kiri */}
        <div className="login__brand">
          <div className="login__brand-content">
            <div className="login__school-info">
              {logoUrl && (
                <img src={logoUrl} alt={schoolName} className="login__logo" />
              )}
              <div className="login__school-text">
                <h1 className="login__school-name">{schoolName}</h1>
                <p className="login__system-name">
                  Sistem Absensi &amp; Tugas Digital
                </p>
              </div>
            </div>

            <div className="login__features">
              <div className="login__feature-item">
                <i className="ri-shield-check-fill"></i>
                <span>Terpercaya</span>
              </div>
              <div className="login__feature-item">
                <i className="ri-time-fill"></i>
                <span>Real-time</span>
              </div>
              <div className="login__feature-item">
                <i className="ri-smartphone-fill"></i>
                <span>Responsive</span>
              </div>
            </div>

            {socials.length > 0 && (
              <div className="login__social">
                <div className="login__social-links">
                  {socials.map(social => (
                    <a
                      key={social.key}
                      href={social.href}
                      target="_blank"
                      rel="noopener"
                      className="login__social-link"
                    >
                      <i className={social.icon}></i>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="login__contact-info">
              <p className="login__address">{address}</p>
              <p className="login__contact-details">
                {phone} • {emailSekolah}
              </p>
            </div>
          </div>
        </div>

        {/* Form Section - kanan */}
        <div className="login__form-section">
          <div className="login__form-wrapper">
            <div className="login__form-header">
              <h2>Buat Akun</h2>
              <p>Portal registrasi untuk {schoolName}</p>
            </div>

            {allDisabled ? (
              <div className="login__error login__error--warning">
                <i className="ri-alert-fill"></i>
                <div className="login__error-content">
                  <strong>Registrasi Ditutup</strong>
                  <span>
                    Registrasi akun sedang tidak dibuka. Silakan hubungi admin
                    sekolah.
                  </span>
                  <Link to="/login" className="login__link">
                    Kembali ke halaman login
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {errorMessage && (
                  <div className="login__error">
                    <i className="ri-alert-fill"></i>
                    <span>{errorMessage}</span>
                  </div>
                )}
                {successMessage && (
                  <div className="login__success">
                    <i className="ri-checkbox-circle-fill"></i>
                    <span>{successMessage}</span>
                  </div>
                )}

                {/* Pilih Role */}
                <div className="login__role-selection">
                  <p className="login__role-title">Pilih Jenis Akun</p>

                  {settings.registrasi_siswa_aktif && (
                    <button
                      type="button"
                      onClick={() => handleSelectRole('siswa')}
                      className={`login__role-btn ${
                        selectedRole === 'siswa'
                          ? 'login__role-btn--active'
                          : ''
                      }`}
                    >
                      <div className="login__role-content">
                        <i className="ri-user-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Siswa</span>
                          <span className="login__role-desc">
                            Akses absensi dan tugas
                          </span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'siswa'
                            ? 'login__role-badge--selected'
                            : 'login__role-badge--active')
                        }
                      >
                        {selectedRole === 'siswa' ? 'Dipilih' : 'Dibuka'}
                      </span>
                    </button>
                  )}

                  {settings.registrasi_guru_aktif && (
                    <button
                      type="button"
                      onClick={() => handleSelectRole('guru')}
                      className={`login__role-btn ${
                        selectedRole === 'guru'
                          ? 'login__role-btn--active'
                          : ''
                      }`}
                    >
                      <div className="login__role-content">
                        <i className="ri-user-star-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Guru</span>
                          <span className="login__role-desc">
                            Kelola kelas dan tugas
                          </span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'guru'
                            ? 'login__role-badge--selected'
                            : 'login__role-badge--active')
                        }
                      >
                        {selectedRole === 'guru' ? 'Dipilih' : 'Dibuka'}
                      </span>
                    </button>
                  )}

                  {settings.registrasi_admin_aktif && (
                    <button
                      type="button"
                      onClick={() => handleSelectRole('admin')}
                      className={`login__role-btn ${
                        selectedRole === 'admin'
                          ? 'login__role-btn--active'
                          : ''
                      }`}
                    >
                      <div className="login__role-content">
                        <i className="ri-shield-keyhole-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Admin</span>
                          <span className="login__role-desc">
                            Lingkungan pengembangan
                          </span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'admin'
                            ? 'login__role-badge--selected'
                            : 'login__role-badge--warning')
                        }
                      >
                        {selectedRole === 'admin' ? 'Dipilih' : 'Resiko Tinggi'}
                      </span>
                    </button>
                  )}
                </div>

                {/* STEP 1: FORM NAMA + EMAIL (KIRIM OTP) */}
                {selectedRole && step === 'email' && (
                  <form onSubmit={handleSendOtp} className="login__form">
                    <div className="login__input-group">
                      <div className="login__input-field">
                        <i className="ri-user-3-fill"></i>
                        <input
                          type="text"
                          name="nama"
                          placeholder="Nama Lengkap"
                          value={form.nama}
                          onChange={handleInputChange}
                          required
                        />
                      </div>

                      <div className="login__input-field">
                        <i className="ri-mail-fill"></i>
                        <input
                          type="email"
                          name="email"
                          placeholder="Email Gmail (contoh: nama@gmail.com)"
                          value={form.email}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!canSendOtp}
                      className="login__submit-btn"
                    >
                      {submitting ? (
                        <>
                          <div className="login__spinner"></div>
                          Mengirim OTP...
                        </>
                      ) : (
                        <>
                          <i className="ri-mail-send-fill"></i>
                          Kirim OTP ke Email
                        </>
                      )}
                    </button>

                    <div className="login__form-footer">
                      <p>
                        Sudah punya akun?
                        <Link to="/login" className="login__link">
                          {' '}
                          Masuk di sini
                        </Link>
                      </p>
                    </div>
                  </form>
                )}

                {/* STEP 2: FORM OTP + PASSWORD */}
                {selectedRole && step === 'otp' && (
                  <form
                    onSubmit={handleVerifyAndRegister}
                    className="login__form"
                  >
                    <div className="login__input-group">
                      <div className="login__input-field login__input-field--readonly">
                        <i className="ri-mail-fill"></i>
                        <input
                          type="email"
                          value={form.email}
                          readOnly
                          disabled
                        />
                      </div>

                      <div className="login__input-field">
                        <i className="ri-shield-keyhole-fill"></i>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="Kode OTP 6 digit"
                          value={otp}
                          onChange={e => setOtp(e.target.value)}
                          required
                        />
                      </div>

                      <div className="login__input-row">
                        <div className="login__input-field">
                          <i className="ri-lock-password-fill"></i>
                          <input
                            type="password"
                            name="password"
                            placeholder="Password"
                            value={form.password}
                            onChange={handleInputChange}
                            autoComplete="new-password"
                            required
                          />
                        </div>

                        <div className="login__input-field">
                          <i className="ri-lock-password-fill"></i>
                          <input
                            type="password"
                            name="confirmPassword"
                            placeholder="Konfirmasi Password"
                            value={form.confirmPassword}
                            onChange={handleInputChange}
                            autoComplete="new-password"
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <div className="login__form-options">
                      <button
                        type="button"
                        className="login__link login__link--inline"
                        onClick={handleResendOtp}
                        disabled={submitting || otpCooldown > 0}
                      >
                        {otpCooldown > 0
                          ? `Kirim ulang OTP dalam ${otpCooldown}s`
                          : 'Kirim ulang OTP'}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={!canVerify}
                      className="login__submit-btn"
                    >
                      {submitting ? (
                        <>
                          <div className="login__spinner"></div>
                          Memproses...
                        </>
                      ) : (
                        <>
                          <i className="ri-user-add-fill"></i>
                          Daftar &amp; Verifikasi
                        </>
                      )}
                    </button>

                    <div className="login__form-footer">
                      <p>
                        Salah email?
                        <button
                          type="button"
                          className="login__link login__link--inline"
                          onClick={() => {
                            setStep('email')
                            setOtp('')
                            setOtpSent(false)
                            setOtpCooldown(0)
                            resetMessages()
                          }}
                        >
                          Ubah email / role
                        </button>
                      </p>
                      <p>
                        Sudah punya akun?
                        <Link to="/login" className="login__link">
                          {' '}
                          Masuk di sini
                        </Link>
                      </p>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
