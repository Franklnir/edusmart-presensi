// src/pages/auth/Register.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../../lib/supabase'
import { sanitizeExternalUrl, sanitizeInput, sanitizeMediaUrl, sanitizeText } from '../../utils/sanitize'
import { validatePassword } from '../../utils/passwordPolicy'
import { Link, useNavigate } from 'react-router-dom'
import '../../styles/Login.css'
import PasswordInput from '../../components/PasswordInput'
import AuthIcon from '../../components/AuthIcon'

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
  registrasi_guru_aktif: false,
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
  const [logoPreview, setLogoPreview] = useState('')

  const [selectedRole, setSelectedRole] = useState(null)
  const [form, setForm] = useState(initialForm)

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // ========= LOAD SETTINGS =========
  useEffect(() => {
    let cancel = false

    async function loadSettings() {
      setLoadingSettings(true)
      try {
        let { data, error } = await supabase
          .from('settings')
          .select('id,nama_sekolah,logo_url,logo_path,alamat,telepon,email,link_facebook,link_tiktok,link_instagram,link_youtube,registrasi_siswa_aktif,registrasi_guru_aktif')
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code === 'PGRST116') data = null
        else if (error) throw error

        if (!cancel) {
          const merged = { ...DEFAULT_SETTINGS, ...(data || {}) }
          setSettings(merged)
          if (data?.id) setSettingsId(data.id)
        }
      } catch (e) {
        if (!cancel) setSettings(DEFAULT_SETTINGS)
      } finally {
        if (!cancel) setLoadingSettings(false)
      }
    }

    loadSettings()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    let active = true
    const raw = settings?.logo_url || settings?.logo_path || ''
    if (!raw) {
      setLogoPreview('')
      return () => { active = false }
    }

    const safeRawLogoUrl = sanitizeMediaUrl(raw)
    if (/^https?:\/\//i.test(safeRawLogoUrl)) {
      setLogoPreview(safeRawLogoUrl)
      return () => { active = false }
    }

    getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 30)
      .then((url) => { if (active) setLogoPreview(url) })
      .catch(() => { if (active) setLogoPreview('') })

    return () => { active = false }
  }, [settings?.logo_url, settings?.logo_path])

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

    return () => supabase.removeChannel(channel)
  }, [settingsId])

  const allDisabled = useMemo(() => {
    return !settings.registrasi_siswa_aktif &&
      !settings.registrasi_guru_aktif
  }, [settings])

  const schoolName = settings.nama_sekolah || 'Sekolah'
  const logoUrl = logoPreview || ''
  const address = settings.alamat || ''
  const phone = settings.telepon || ''
  const emailSekolah = settings.email || ''

  const socials = useMemo(() => ([
    { key: 'facebook', href: settings.link_facebook, icon: 'ri-facebook-fill' },
    { key: 'tiktok', href: settings.link_tiktok, icon: 'ri-tiktok-fill' },
    { key: 'instagram', href: settings.link_instagram, icon: 'ri-instagram-fill' },
    { key: 'youtube', href: settings.link_youtube, icon: 'ri-youtube-fill' }
  ]
    .map((s) => ({ ...s, href: sanitizeExternalUrl(s.href) }))
    .filter(s => s.href && s.href.trim() !== '')), [settings])

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

  const validateForm = () => {
    if (!selectedRole) return 'Silakan pilih jenis akun terlebih dahulu.'
    if (!form.nama.trim()) return 'Nama lengkap wajib diisi.'

    const email = form.email.trim().toLowerCase()
    if (!email) return 'Email wajib diisi.'
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(email)) return 'Format email tidak valid.'
    if (!form.password) return 'Password wajib diisi.'
    const pwdCheck = validatePassword(form.password)
    if (!pwdCheck.valid) return pwdCheck.errors[0]
    if (form.password !== form.confirmPassword) return 'Konfirmasi password tidak sama.'

    if (selectedRole === 'admin') {
      return 'Registrasi admin publik tidak diizinkan.'
    }

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    const err = validateForm()
    if (err) return setErrorMessage(err)

    setSubmitting(true)
    try {
      const email = form.email.trim().toLowerCase()

      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          data: {
            nama: sanitizeText(form.nama.trim()),
            role: selectedRole
          },
          emailRedirectTo: `${window.location.origin}/login`
        }
      })

      if (error) {
        const msg = (error.message || '').toLowerCase()
        if (msg.includes('already registered')) {
          setErrorMessage('Email sudah terdaftar. Silakan login.')
        } else {
          setErrorMessage(error.message || 'Gagal mendaftar. Coba lagi.')
        }
        return
      }

      // IMPORTANT:
      // Kalau email confirm ON, biasanya data.session = null. Jadi jangan insert profiles di sini.
      // Nanti profiles dibuat saat user login pertama (authenticated).
      setSuccessMessage('Berhasil mendaftar! Silakan cek email kamu untuk verifikasi.')
      setTimeout(() => nav('/login'), 2000)
    } catch (e2) {
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
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={schoolName}
                  className="login__logo"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div className="login__logo-fallback">
                  <AuthIcon className="ri-school-fill" />
                </div>
              )}
              <div className="login__school-text">
                <h1 className="login__school-name">{schoolName}</h1>
                <p className="login__system-name">Sistem Absensi & Tugas Digital</p>
              </div>
            </div>

            <div className="login__features">
              <div className="login__feature-item">
                <AuthIcon className="ri-shield-check-fill" /><span>Terpercaya</span>
              </div>
              <div className="login__feature-item">
                <AuthIcon className="ri-time-fill" /><span>Real-time</span>
              </div>
              <div className="login__feature-item">
                <AuthIcon className="ri-smartphone-fill" /><span>Responsive</span>
              </div>
            </div>

            {socials.length > 0 && (
              <div className="login__social">
                <div className="login__social-links">
                  {socials.map(s => (
                    <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" className="login__social-link">
                      <AuthIcon className={s.icon} />
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
                <AuthIcon className="ri-alert-fill" />
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
                    <AuthIcon className="ri-alert-fill" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                {successMessage && (
                  <div className="login__success">
                    <AuthIcon className="ri-checkbox-circle-fill" />
                    <span>{successMessage}</span>
                  </div>
                )}

                <div className="login__role-selection">
                  <p className="login__role-title">Pilih Jenis Akun</p>

                  {settings.registrasi_siswa_aktif && (
                    <button type="button" onClick={() => handleSelectRole('siswa')}
                      className={`login__role-btn ${selectedRole === 'siswa' ? 'login__role-btn--active' : ''}`}>
                      <div className="login__role-content">
                        <AuthIcon className="ri-user-fill" />
                        <div className="login__role-text">
                          <span className="login__role-name">Siswa</span>
                          <span className="login__role-desc">Akses absensi dan tugas</span>
                        </div>
                      </div>
                      <span className={'login__role-badge ' + (selectedRole === 'siswa' ? 'login__role-badge--selected' : 'login__role-badge--active')}>
                        {selectedRole === 'siswa' ? 'Dipilih' : 'Dibuka'}
                      </span>
                    </button>
                  )}

                  {settings.registrasi_guru_aktif && (
                    <button type="button" onClick={() => handleSelectRole('guru')}
                      className={`login__role-btn ${selectedRole === 'guru' ? 'login__role-btn--active' : ''}`}>
                      <div className="login__role-content">
                        <AuthIcon className="ri-user-star-fill" />
                        <div className="login__role-text">
                          <span className="login__role-name">Guru</span>
                          <span className="login__role-desc">Kelola kelas dan tugas</span>
                        </div>
                      </div>
                      <span className={'login__role-badge ' + (selectedRole === 'guru' ? 'login__role-badge--selected' : 'login__role-badge--active')}>
                        {selectedRole === 'guru' ? 'Dipilih' : 'Dibuka'}
                      </span>
                    </button>
                  )}

                </div>

                {selectedRole && (
                  <form onSubmit={handleSubmit} className="login__form" noValidate>
                    <div className="login__input-group">
                      <div className="login__input-field">
                        <AuthIcon className="ri-user-3-fill" />
                        <input type="text" name="nama" placeholder="Nama Lengkap"
                          value={form.nama} onChange={handleInputChange} required />
                      </div>

                      <div className="login__input-field">
                        <AuthIcon className="ri-mail-fill" />
                        <input type="email" name="email" placeholder="Email aktif"
                          value={form.email} onChange={handleInputChange} required />
                      </div>

                      <div className="login__input-row">
                        <div className="login__input-field">
                          <AuthIcon className="ri-lock-password-fill" />
                          <PasswordInput name="password" placeholder="Password"
                            value={form.password} onChange={handleInputChange} required />
                        </div>

                        <div className="login__input-field">
                          <AuthIcon className="ri-lock-password-fill" />
                          <PasswordInput name="confirmPassword" placeholder="Konfirmasi Password"
                            value={form.confirmPassword} onChange={handleInputChange} required />
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
                          <AuthIcon className="ri-user-add-fill" />
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
