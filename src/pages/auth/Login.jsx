// src/pages/auth/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import '../../styles/Login.css';

const Login = () => {
  const navigate = useNavigate();
  const { user, profile, login } = useAuthStore();

  const [form, setForm] = useState({
    email: '',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [settings, setSettings] = useState(null);
  const [settingsId, setSettingsId] = useState(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // Load settings sekali di awal
  useEffect(() => {
    let isCancelled = false;

    const loadSettings = async () => {
      try {
        let { data, error } = await supabase
          .from('settings')
          .select('*')
          .order('id', { ascending: true })
          .limit(1)
          .single();

        if (error && error.code === 'PGRST116') {
          // Tidak ada data settings, gunakan default
          data = {
            nama_sekolah: 'Sekolah',
            alamat: '',
            telepon: '',
            email: '',
            logo_url: ''
          };
        } else if (error) {
          throw error;
        }

        if (!isCancelled) {
          setSettings(data);
          if (data?.id) setSettingsId(data.id);
          setIsLoadingSettings(false);
        }
      } catch (err) {
        if (!isCancelled) {
          // Tetap lanjut meski settings gagal load
          setSettings({
            nama_sekolah: 'Sekolah',
            alamat: '',
            telepon: '',
            email: '',
            logo_url: ''
          });
          setIsLoadingSettings(false);
        }
      }
    };

    loadSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Realtime update settings jika ada perubahan
  useEffect(() => {
    if (!settingsId) return;

    const channel = supabase
      .channel('login_settings_realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'settings',
          filter: `id=eq.${settingsId}`
        },
        (payload) => {
          const row = payload.new;
          if (!row) return;

          setSettings((prev) => ({
            ...prev,
            ...row
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [settingsId]);

  // Logic redirect setelah login
  useEffect(() => {
    if (!user || !profile) return;

    if (profile.status === 'nonaktif') {
      let message = 'Akun ini dinonaktifkan. Hubungi administrator.';
      
      if (profile.alasan_nonaktif) {
        message += ` Alasan: ${profile.alasan_nonaktif}`;
      }

      setError(message);
      supabase.auth.signOut();
      return;
    }

    // Redirect berdasarkan role
    const redirectMap = {
      siswa: '/siswa/home',
      guru: '/guru/jadwal',
      admin: '/admin/home'
    };

    const target = redirectMap[profile.role];
    if (target) {
      navigate(target, { replace: true });
    } else {
      setError('Role tidak dikenali. Hubungi administrator.');
    }
  }, [user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validasi input
    if (!form.email.trim() || !form.password.trim()) {
      setError('Email dan password harus diisi');
      return;
    }

    // Validasi format email sederhana
    if (!form.email.includes('@')) {
      setError('Format email tidak valid');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = await login(form.email, form.password);
      
      if (result?.error) {
        // Handle error spesifik dari Supabase
        const errorMsg = result.error.toLowerCase();
        
        if (errorMsg.includes('invalid login credentials') || 
            errorMsg.includes('invalid email or password')) {
          setError('Email atau password salah');
        } else if (errorMsg.includes('email not confirmed')) {
          setError('Email belum dikonfirmasi. Silakan cek email Anda');
        } else if (errorMsg.includes('too many requests')) {
          setError('Terlalu banyak percobaan login. Silakan coba lagi nanti');
        } else {
          setError(result.error);
        }
      }
    } catch (err) {
      setError('Terjadi kesalahan saat login. Silakan coba lagi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isSubmitting) {
      handleSubmit(e);
    }
  };

  // Loading state
  if (isLoadingSettings) {
    return (
      <div className="login-loading">
        <div className="login-spinner"></div>
        <p className="login-loading-text">Memuat halaman login...</p>
      </div>
    );
  }

  // Data sekolah dengan fallback
  const schoolName = settings?.nama_sekolah || 'Sekolah';
  const logoUrl = settings?.logo_url || '';
  const address = settings?.alamat || '';
  const phone = settings?.telepon || '';
  const emailSekolah = settings?.email || '';

  // Social media links
  const socials = [
    { 
      key: 'facebook', 
      href: settings?.link_facebook, 
      icon: 'ri-facebook-fill',
      label: 'Facebook'
    },
    { 
      key: 'tiktok', 
      href: settings?.link_tiktok, 
      icon: 'ri-tiktok-fill',
      label: 'TikTok'
    },
    { 
      key: 'instagram', 
      href: settings?.link_instagram, 
      icon: 'ri-instagram-fill',
      label: 'Instagram'
    },
    { 
      key: 'youtube', 
      href: settings?.link_youtube, 
      icon: 'ri-youtube-fill',
      label: 'YouTube'
    }
  ].filter((social) => social.href && social.href.trim() !== '');

  return (
    <div className="login">
      {/* Background Elements */}
      <div className="login__bg">
        <div className="login__bg-grid"></div>
        <div className="login__bg-blur-1"></div>
        <div className="login__bg-blur-2"></div>
      </div>

      <div className="login__container">
        {/* Brand Section */}
        <div className="login__brand">
          <div className="login__brand-content">
            <div className="login__school-info">
              {logoUrl ? (
                <img 
                  src={logoUrl} 
                  alt={schoolName} 
                  className="login__logo"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.querySelector('.login__logo-fallback')?.style.display = 'flex';
                  }}
                />
              ) : (
                <div className="login__logo-fallback">
                  <i className="ri-school-fill"></i>
                </div>
              )}
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
                <p className="login__social-title">Ikuti kami:</p>
                <div className="login__social-links">
                  {socials.map((social) => (
                    <a
                      key={social.key}
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="login__social-link"
                      title={social.label}
                      aria-label={social.label}
                    >
                      <i className={social.icon}></i>
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
                    {phone && <span>{phone}</span>}
                    {phone && emailSekolah && <span className="login__separator"> • </span>}
                    {emailSekolah && <span>{emailSekolah}</span>}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Form Section */}
        <div className="login__form-section">
          <div className="login__form-wrapper">
            <div className="login__form-header">
              <h2>Masuk ke Akun</h2>
              <p>Silakan masuk untuk mengakses sistem</p>
            </div>

            {error && (
              <div className="login__error" role="alert">
                <i className="ri-alert-fill"></i>
                <span>{error}</span>
              </div>
            )}

            <form 
              onSubmit={handleSubmit} 
              className="login__form"
              onKeyPress={handleKeyPress}
              noValidate
            >
              <div className="login__input-group">
                <div className="login__input-field">
                  <i className="ri-user-3-fill"></i>
                  <input
                    type="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, email: e.target.value.trim() }))
                    }
                    disabled={isSubmitting}
                    required
                    autoComplete="email"
                    aria-label="Email"
                  />
                </div>

                <div className="login__input-field">
                  <i className="ri-lock-password-fill"></i>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, password: e.target.value }))
                    }
                    disabled={isSubmitting}
                    required
                    autoComplete="current-password"
                    aria-label="Password"
                  />
                  <button
                    type="button"
                    className={`login__toggle ${showPassword ? 'active' : ''}`}
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={0}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  >
                    <i className={`ri-eye-${showPassword ? 'off' : ''}-fill`}></i>
                  </button>
                </div>
              </div>

              <div className="login__form-options">
                <Link to="/forgot-password" className="login__forgot-link">
                  Lupa password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !form.email || !form.password}
                className="login__submit-btn"
                aria-label="Masuk"
              >
                {isSubmitting ? (
                  <>
                    <div className="login__spinner-btn"></div>
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-login-box-fill"></i>
                    <span>Masuk</span>
                  </>
                )}
              </button>
            </form>

            <div className="login__form-footer">
              <p>
                Belum punya akun?
                <Link to="/register" className="login__register-link">
                  Daftar Sekarang
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;