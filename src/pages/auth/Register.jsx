// src/pages/auth/Register.jsx
import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import '../../styles/Login.css'

const initialSettings = {
  nama_sekolah: '',
  logo_url: '',
  registrasi_siswa_aktif: true,
  registrasi_guru_aktif: true,
  registrasi_admin_aktif: false,

  // optional tambahan (kalau ada di table settings kamu)
  alamat: '',
  telepon: '',
  email: '',
  link_facebook: '',
  link_tiktok: '',
  link_instagram: '',
  link_youtube: ''
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

        if (error && error.code === 'PGRST116') data = null
        else if (error) throw error

        if (!isCancelled && data) {
          setSettingsId(data.id)
          setSettings(prev => ({
            ...prev,
            ...data,
            nama_sekolah: data.nama_sekolah || prev.nama_sekolah,
            logo_url: data.logo_url || prev.logo_url,
            registrasi_siswa_aktif: data.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: data.registrasi_guru_aktif ?? true,
            registrasi_admin_aktif: data.registrasi_admin_aktif ?? false
          }))
        }
      } catch (err) {
        if (!isCancelled) console.error('Gagal load settings:', err)
      } finally {
        if (!isCancelled) setLoadingSettings(false)
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
        (payload) => {
          const row = payload.new
          if (!row) return
          setSettings(prev => ({
            ...prev,
            ...row,
            registrasi_siswa_aktif: row.registrasi_siswa_aktif ?? prev.registrasi_siswa_aktif,
            registrasi_guru_aktif: row.registrasi_guru_aktif ?? prev.registrasi_guru_aktif,
            registrasi_admin_aktif: row.registrasi_admin_aktif ?? prev.registrasi_admin_aktif
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

  const handleSelectRole = (role) => {
    setSelectedRole(role)
    setErrorMessage('')
    setSuccessMessage('')
    setForm(prev => ({ ...initialForm, email: prev.email }))
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  // ========== VALIDASI FORM (HANYA GMAIL) ==========
  const validateForm = () => {
    if (!selectedRole) return 'Silakan pilih jenis akun terlebih dahulu.'
    if (!form.nama.trim()) return 'Nama lengkap wajib diisi.'

    const email = form.email.trim().toLowerCase()
    if (!email) return 'Email wajib diisi.'

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(email)) return 'Format email tidak valid.'
    if (!email.endsWith('@gmail.com')) {
      return 'Untuk saat ini, registrasi hanya diperbolehkan menggunakan email Gmail (@gmail.com).'
    }

    if (!form.password) return 'Password wajib diisi.'
    if (form.password.length < 6) return 'Password minimal 6 karakter.'
    if (!/(?=.*[A-Z])/.test(form.password)) return 'Password harus mengandung minimal 1 huruf besar.'
    if (!/(?=.*\d)/.test(form.password)) return 'Password harus mengandung minimal 1 angka.'
    if (form.password !== form.confirmPassword) return 'Konfirmasi password tidak sama.'

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    const validationError = validateForm()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmitting(true)

      const email = form.email.trim().toLowerCase()

      /**
       * SECURITY NOTE:
       * Jangan percaya role dari client untuk akses (guru/admin).
       * Aman: set role default 'siswa' di metadata.
       * Guru/Admin dipromote oleh admin dari dashboard/RPC.
       */
      const safeRole = selectedRole === 'siswa' ? 'siswa' : 'siswa'

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          data: {
            nama: form.nama.trim(),
            // simpan pilihan user kalau mau untuk review admin, tapi jangan dipakai untuk akses
            requested_role: selectedRole,
            role: safeRole
          },
          // redirectTo: `${window.location.origin}/login` // optional
        }
      })

      if (signUpError) {
        // rate limit
        if (signUpError?.status === 429 || /48 seconds/i.test(signUpError.message || '')) {
          setErrorMessage('Terlalu cepat mencoba daftar. Tunggu sebentar lalu coba lagi.')
          return
        }
        setErrorMessage(signUpError.message || 'Gagal mendaftar. Coba lagi.')
        return
      }

      /**
       * PENTING:
       * Jangan insert ke table profiles dari client.
       * profiles akan dibuat otomatis oleh trigger di DB (handle_new_user).
       */
      const user = signUpData?.user
      const needsEmailConfirm = !user?.confirmed_at

      setSuccessMessage(
        needsEmailConfirm
          ? 'Berhasil mendaftar! Silakan cek email Gmail kamu untuk verifikasi, lalu login.'
          : 'Berhasil mendaftar! Silakan login.'
      )

      // bersihin form
      setForm(initialForm)
      setSelectedRole(null)

      setTimeout(() => {
        nav('/login')
      }, 1500)
    } catch (err) {
      console.error('Error submit:', err)
      setErrorMessage('Terjadi kesalahan saat mendaftar. Coba beberapa saat lagi.')
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

  const schoolName = settings.nama_sekolah || 'bapak penabur'
  const logoUrl = settings.logo_url
  const address = settings.alamat || 'Alamat sekolah belum diatur'
  const phone = settings.telepon || '-'
  const emailSekolah = settings.email || '-'

  const socials = [
    { key: 'facebook', href: settings?.link_facebook, icon: 'ri-facebook-fill' },
    { key: 'tiktok', href: settings?.link_tiktok, icon: 'ri-tiktok-fill' },
    { key: 'instagram', href: settings?.link_instagram, icon: 'ri-instagram-fill' },
    { key: 'youtube', href: settings?.link_youtube, icon: 'ri-youtube-fill' }
  ].filter(social => social.href)

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
              {logoUrl && <img src={logoUrl} alt={schoolName} className="login__logo" />}
              <div className="login__school-text">
                <h1 className="login__school-name">{schoolName}</h1>
                <p className="login__system-name">Sistem Absensi & Tugas Digital</p>
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
                  <span>Registrasi akun sedang tidak dibuka. Silakan hubungi admin sekolah.</span>
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
                      className={`login__role-btn ${selectedRole === 'siswa' ? 'login__role-btn--active' : ''}`}
                    >
                      <div className="login__role-content">
                        <i className="ri-user-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Siswa</span>
                          <span className="login__role-desc">Akses absensi dan tugas</span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'siswa' ? 'login__role-badge--selected' : 'login__role-badge--active')
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
                      className={`login__role-btn ${selectedRole === 'guru' ? 'login__role-btn--active' : ''}`}
                    >
                      <div className="login__role-content">
                        <i className="ri-user-star-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Guru</span>
                          <span className="login__role-desc">Kelola kelas dan tugas</span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'guru' ? 'login__role-badge--selected' : 'login__role-badge--active')
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
                      className={`login__role-btn ${selectedRole === 'admin' ? 'login__role-btn--active' : ''}`}
                    >
                      <div className="login__role-content">
                        <i className="ri-shield-keyhole-fill"></i>
                        <div className="login__role-text">
                          <span className="login__role-name">Admin</span>
                          <span className="login__role-desc">Lingkungan pengembangan</span>
                        </div>
                      </div>
                      <span
                        className={
                          'login__role-badge ' +
                          (selectedRole === 'admin' ? 'login__role-badge--selected' : 'login__role-badge--warning')
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
                          required
                        />
                      </div>

                      <div className="login__input-field">
                        <i className="ri-mail-fill"></i>
                        <input
                          type="email"
                          name="email"
                          placeholder="Email (wajib @gmail.com)"
                          value={form.email}
                          onChange={handleInputChange}
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
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <button type="submit" disabled={submitting} className="login__submit-btn">
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
                          {' '}Masuk di sini
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
