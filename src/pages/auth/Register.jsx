// src/pages/auth/Register.jsx
import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import '../../styles/Login.css'

const DEFAULT_SETTINGS = {
  nama_sekolah: 'Sekolah',
  logo_url: '',
  alamat: '',
  telepon: '',
  email: '',
  link_facebook: '',
  link_tiktok: '',
  link_instagram: '',
  link_youtube: '',
  registrasi_siswa_aktif: true,
  registrasi_guru_aktif: true,
  registrasi_admin_aktif: false
}

const initialForm = {
  nama: '',
  email: '',
  password: '',
  confirmPassword: ''
}

export default function Register() {
  const nav = useNavigate()

  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsId, setSettingsId] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

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

        if (error && error.code === 'PGRST116') {
          data = null
        } else if (error) {
          throw error
        }

        if (!isCancelled) {
          const merged = { ...DEFAULT_SETTINGS, ...(data || {}) }
          setSettings(merged)
          setSettingsId(data?.id || null)
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Gagal load settings:', err)
          setSettings(DEFAULT_SETTINGS)
          setSettingsId(null)
        }
      } finally {
        if (!isCancelled) setLoadingSettings(false)
      }
    }

    loadSettings()
    return () => {
      isCancelled = true
    }
  }, [])

  // ========= REALTIME SETTINGS =========
  useEffect(() => {
    if (!settingsId) return

    const channel = supabase
      .channel('register_settings_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings', filter: `id=eq.${settingsId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setSettings(prev => ({ ...prev, ...row }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId])

  const allDisabled =
    !settings.registrasi_siswa_aktif &&
    !settings.registrasi_guru_aktif &&
    !settings.registrasi_admin_aktif

  const handleSelectRole = (role) => {
    setSelectedRole(role)
    setErrorMessage('')
    setSuccessMessage('')
    setForm(initialForm)
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

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

    // extra guard: batasi admin dari UI (kalau settings admin off)
    if (selectedRole === 'admin' && !settings.registrasi_admin_aktif) {
      return 'Registrasi admin tidak dibuka.'
    }

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

      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          // metadata ini akan dipakai trigger handle_new_user()
          data: {
            nama: form.nama.trim(),
            role: selectedRole
          }
        }
      })

      if (error) {
        const msg = (error.message || '').toLowerCase()

        // rate limit / throttle supabase auth
        if (msg.includes('for security purposes')) {
          setErrorMessage('Terlalu banyak percobaan. Coba lagi sebentar lagi ya.')
        } else if (msg.includes('already registered')) {
          setErrorMessage('Email sudah terdaftar. Silakan login.')
        } else {
          setErrorMessage(error.message || 'Gagal mendaftar. Coba lagi.')
        }
        return
      }

      // Kalau email confirmation ON, biasanya session null dan user ada.
      // Trigger sudah membuat row profiles otomatis.
      const user = data?.user
      if (!user) {
        setSuccessMessage('Registrasi dibuat. Silakan cek email untuk verifikasi.')
      } else {
        setSuccessMessage('Berhasil mendaftar! Silakan cek email Gmail kamu untuk verifikasi.')
      }

      // optional: kalau tiba-tiba session ada (confirm OFF), biar flow tetap rapi:
      if (data?.session) {
        await supabase.auth.signOut()
      }

      setTimeout(() => nav('/login'), 1500)
    } catch (err) {
      console.error('Error submit:', err)
      setErrorMessage('Terjadi kesalahan saat mendaftar. Coba beberapa saat lagi.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingSettings) {
    return (
      <div className="login-loading">
        <div className="login-spinner"></div>
      </div>
    )
  }

  const schoolName = settings.nama_sekolah || 'Sekolah'
  const logoUrl = settings.logo_url
  const address = settings.alamat || ''
  const phone = settings.telepon || ''
  const emailSekolah = settings.email || ''

  const socials = [
    { key: 'facebook', href: settings.link_facebook, icon: 'ri-facebook-fill' },
    { key: 'tiktok', href: settings.link_tiktok, icon: 'ri-tiktok-fill' },
    { key: 'instagram', href: settings.link_instagram, icon: 'ri-instagram-fill' },
    { key: 'youtube', href: settings.link_youtube, icon: 'ri-youtube-fill' }
  ].filter(s => s.href && String(s.href).trim() !== '')

  return (
    <div className="login">
      <div className="login__bg">
        <div className="login__bg-grid"></div>
        <div className="login__bg-blur-1"></div>
        <div className="login__bg-blur-2"></div>
      </div>

      <div className="login__container">
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
              <div className="login__feature-item"><i className="ri-shield-check-fill"></i><span>Terpercaya</span></div>
              <div className="login__feature-item"><i className="ri-time-fill"></i><span>Real-time</span></div>
              <div className="login__feature-item"><i className="ri-smartphone-fill"></i><span>Responsive</span></div>
            </div>

            {socials.length > 0 && (
              <div className="login__social">
                <div className="login__social-links">
                  {socials.map(s => (
                    <a key={s.key} href={s.href} target="_blank" rel="noopener" className="login__social-link">
                      <i className={s.icon}></i>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {(address || phone || emailSekolah) && (
              <div className="login__contact-info">
                {address && <p className="login__address">{address}</p>}
                {(phone || emailSekolah) && (
                  <p className="login__contact-details">
                    {phone}{phone && emailSekolah ? ' • ' : ''}{emailSekolah}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

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
                  <Link to="/login" className="login__link">Kembali ke halaman login</Link>
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
                      <span className={'login__role-badge ' + (selectedRole === 'siswa'
                        ? 'login__role-badge--selected'
                        : 'login__role-badge--active')}>
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
                      <span className={'login__role-badge ' + (selectedRole === 'guru'
                        ? 'login__role-badge--selected'
                        : 'login__role-badge--active')}>
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
                      <span className={'login__role-badge ' + (selectedRole === 'admin'
                        ? 'login__role-badge--selected'
                        : 'login__role-badge--warning')}>
                        {selectedRole === 'admin' ? 'Dipilih' : 'Resiko Tinggi'}
                      </span>
                    </button>
                  )}
                </div>

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
                        <Link to="/login" className="login__link"> Masuk di sini</Link>
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
