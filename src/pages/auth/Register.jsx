// src/pages/auth/Register.jsx
import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
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

  /* ====== STATE PENGATURAN ====== */
  const [settings, setSettings] = useState(initialSettings)
  const [settingsId, setSettingsId] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  /* ====== STATE REGISTRASI ====== */
  const [selectedRole, setSelectedRole] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  /* ====== CEK EMAIL TERDAFTAR ====== */
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'allowed' | 'not_found' | 'error'>('idle')

  // ========= LOAD SETTINGS =========
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

        // PGRST116 = no rows
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
          console.error('Gagal load settings:', err)
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

  // ========= REALTIME LISTENER SETTINGS =========
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

  /* ====== LOGIKA BANTUAN ====== */
  const allDisabled =
    !settings.registrasi_siswa_aktif &&
    !settings.registrasi_guru_aktif &&
    !settings.registrasi_admin_aktif

  const resetMessages = () => {
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleSelectRole = role => {
    setSelectedRole(role)
    resetMessages()
    setEmailStatus('idle')
    // reset form tapi pertahankan email kalau sudah diisi
    setForm(prev => ({
      ...initialForm,
      email: prev.email
    }))
  }

  const handleInputChange = e => {
    const { name, value } = e.target
    resetMessages()

    setForm(prev => ({
      ...prev,
      [name]: value
    }))

    if (name === 'email') {
      // setiap kali email berubah, status cek direset
      setEmailStatus('idle')
    }
  }

  const validateForm = () => {
    if (!selectedRole) return 'Silakan pilih jenis akun terlebih dahulu.'
    if (!form.nama.trim()) return 'Nama lengkap wajib diisi.'
    if (!form.email.trim()) return 'Email wajib diisi.'

    const email = form.email.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) return 'Format email tidak valid.'

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

    if (form.password !== form.confirmPassword)
      return 'Konfirmasi password tidak sama.'

    return null
  }

  /**
   * Cek apakah email + role diizinkan registrasi.
   * Menggunakan tabel: public.allowed_registrations (email, role)
   * Pastikan email di tabel disimpan lowercase.
   */
  const checkEmailAllowed = useCallback(
    async (email, role) => {
      const trimmed = (email || '').trim().toLowerCase()
      if (!trimmed || !role) {
        setEmailStatus('idle')
        return {
          ok: false,
          message: 'Isi email dan pilih jenis akun terlebih dahulu.'
        }
      }

      try {
        setCheckingEmail(true)

        const { data, error } = await supabase
          .from('allowed_registrations')
          .select('email, role')
          .eq('email', trimmed)
          .eq('role', role)
          .maybeSingle()

        if (error) {
          console.error('Gagal cek email terdaftar:', error)
          setEmailStatus('error')
          return {
            ok: false,
            message:
              'Gagal mengecek email terdaftar. Coba beberapa saat lagi atau hubungi admin.'
          }
        }

        if (!data) {
          setEmailStatus('not_found')
          return {
            ok: false,
            message:
              'Email ini belum terdaftar di sistem untuk role tersebut. Silakan hubungi admin sekolah.'
          }
        }

        setEmailStatus('allowed')
        return { ok: true, message: '' }
      } finally {
        setCheckingEmail(false)
      }
    },
    []
  )

  const handleBlurEmail = async () => {
    resetMessages()
    if (!form.email || !selectedRole) return
    await checkEmailAllowed(form.email, selectedRole)
  }

  const handleSubmit = async e => {
    e.preventDefault()
    resetMessages()

    const validationError = validateForm()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmitting(true)

      // Pastikan email memang terdaftar (server side check via Supabase)
      const checkResult = await checkEmailAllowed(form.email, selectedRole)
      if (!checkResult.ok) {
        setErrorMessage(checkResult.message)
        return
      }

      const email = form.email.trim().toLowerCase()

      // Buat user di Auth
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password: form.password,
          options: {
            data: {
              nama: form.nama.trim(),
              role: selectedRole
            },
            // Opsional: redirect setelah verifikasi email
            emailRedirectTo: `${window.location.origin}/login`
          }
        })

      if (signUpError) {
        console.error('SignUp error:', signUpError)
        // Beberapa pesan error yang lebih ramah
        if (signUpError.message?.includes('User already registered')) {
          setErrorMessage(
            'Email ini sudah memiliki akun. Silakan masuk menggunakan menu login.'
          )
        } else {
          setErrorMessage(
            signUpError.message ||
              'Gagal mendaftar. Silakan coba beberapa saat lagi.'
          )
        }
        return
      }

      const user = signUpData?.user
      if (!user) {
        setSuccessMessage(
          'Registrasi berhasil dibuat. Silakan cek email untuk verifikasi akun.'
        )
        return
      }

      // Insert ke tabel profiles
      const profilePayload = {
        id: user.id,
        email: user.email,
        nama: form.nama.trim(),
        role: selectedRole,
        kelas: null,
        jk: null,
        telp: null,
        status: 'active'
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .insert(profilePayload)

      if (profileError) {
        // Tidak fatal untuk user, tapi log ke console
        console.error('Gagal insert profiles:', profileError)
      }

      setSuccessMessage(
        'Berhasil mendaftar! Silakan cek email untuk verifikasi, lalu masuk ke sistem.'
      )
      setTimeout(() => {
        nav('/login')
      }, 2000)
    } catch (err) {
      console.error('Error submit:', err)
      setErrorMessage(
        'Terjadi kesalahan saat mendaftar. Coba beberapa saat lagi.'
      )
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
    { key: 'instagram', href: settings?.link_instagram, icon: 'ri-instagram-fill' },
    { key: 'youtube', href: settings?.link_youtube, icon: 'ri-youtube-fill' }
  ].filter(social => social.href)

  const canSubmit =
    !!selectedRole &&
    !submitting &&
    !checkingEmail && // jangan submit saat sedang cek
    emailStatus !== 'not_found'

  return (
    <div className="login">
      {/* Background Elements */}
      <div className="login__bg">
        <div className="login__bg-grid"></div>
        <div className="login__bg-blur-1"></div>
        <div className="login__bg-blur-2"></div>
      </div>

      <div className="login__container">
        {/* Brand Section - kiri (sama seperti Login) */}
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

                {/* Info status email terdaftar */}
                {emailStatus === 'allowed' && (
                  <div className="login__success login__success--soft">
                    <i className="ri-mail-check-fill"></i>
                    <span>
                      Email ini terdaftar dan bisa digunakan untuk registrasi.
                    </span>
                  </div>
                )}
                {emailStatus === 'not_found' && (
                  <div className="login__error login__error--soft">
                    <i className="ri-mail-close-fill"></i>
                    <span>
                      Email ini belum terdaftar di whitelist. Silakan hubungi
                      admin sekolah.
                    </span>
                  </div>
                )}
                {emailStatus === 'error' && (
                  <div className="login__error login__error--soft">
                    <i className="ri-alert-fill"></i>
                    <span>
                      Gagal mengecek status email. Coba beberapa saat lagi.
                    </span>
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

                {/* Form Register */}
                {selectedRole && (
                  <form onSubmit={handleSubmit} className="login__form">
                    <div className="login__input-group">
                      <div className="login__input-field">
                        <i className="ri-user-3-fill"></i>
                        <input
                          type="text"
                          name="nama"
                          placeholder="Nama Lengkap"
                          value={form.nama}
                          onChange={handleInputChange}
                          autoComplete="name"
                          required
                        />
                      </div>

                      <div className="login__input-field">
                        <i className="ri-mail-fill"></i>
                        <input
                          type="email"
                          name="email"
                          placeholder="Email yang terdaftar di sekolah"
                          value={form.email}
                          onChange={handleInputChange}
                          onBlur={handleBlurEmail}
                          autoComplete="email"
                          required
                        />
                        {checkingEmail && (
                          <span className="login__input-hint">
                            Mengecek email...
                          </span>
                        )}
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

                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="login__submit-btn"
                    >
                      {submitting ? (
                        <>
                          <div className="login__spinner"></div>
                          Mendaftarkan...
                        </>
                      ) : (
                        <>
                          <i className="ri-user-add-fill"></i>
                          Daftar Sekarang
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
