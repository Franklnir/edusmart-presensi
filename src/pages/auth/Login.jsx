// src/pages/auth/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';


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

  /* ========== LOAD SETTINGS SEKALI DI AWAL ========== */
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

        // PGRST116 = no rows
        if (error && error.code === 'PGRST116') {
          data = null;
        } else if (error) {
          throw error;
        }

        if (!isCancelled && data) {
          setSettings(data);
          setSettingsId(data.id);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Settings error:', err);
        }
      }
    };

    loadSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  /* ========== REALTIME UPDATE SETTINGS ========== */
  useEffect(() => {
    if (!settingsId) return;

    const channel = supabase
      .channel('login_settings_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          filter: `id=eq.${settingsId}`
        },
        (payload) => {
          const row = payload.new;
          if (!row) return;

          // update nama sekolah, logo, dan field lain kalau berubah
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

  /* ========== LOGIC LOGIN ========== */
  useEffect(() => {
    if (!user || !profile) return;

    if (profile.status === 'nonaktif') {
      let message =
        profile.role === 'guru'
          ? 'Akun guru ini dinonaktifkan. Hubungi administrator.'
          : 'Akun siswa ini dinonaktifkan. Hubungi wali kelas.';

      if (profile.alasan_nonaktif) message += ` Alasan: ${profile.alasan_nonaktif}`;

      setError(message);
      supabase.auth.signOut();
      return;
    }

    const redirectMap = {
      siswa: '/siswa/home',
      guru: '/guru/jadwal',
      admin: '/admin/home'
    };

    const target = redirectMap[profile.role];
    if (target) navigate(target, { replace: true });
  }, [user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password.trim()) {
      setError('Email dan password harus diisi');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = await login(form.email, form.password);
      if (result?.error) setError(result.error);
    } catch (err) {
      setError(err?.message || 'Terjadi kesalahan saat login');
    } finally {
      setIsSubmitting(false);
    }
  };

  // loading awal saat settings belum ada
  if (!settings) {
    return (
      <div className="login-loading">
        <div className="login-spinner"></div>
      </div>
    );
  }

  const schoolName = settings?.nama_sekolah || 'bapak penabur';
  const logoUrl = settings?.logo_url || settings?.logourl;
  const address = settings?.alamat || 'jl. kasuarieewd';
  const phone = settings?.telepon || '0895318323655';
  const emailSekolah = settings?.email || 'milertr26@gmail.com';

  const socials = [
    { key: 'facebook', href: settings?.link_facebook, icon: 'ri-facebook-fill' },
    { key: 'tiktok', href: settings?.link_tiktok, icon: 'ri-tiktok-fill' },
    { key: 'instagram', href: settings?.link_instagram, icon: 'ri-instagram-fill' },
    { key: 'youtube', href: settings?.link_youtube, icon: 'ri-youtube-fill' }
  ].filter((social) => social.href);

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
              {logoUrl && (
                <img src={logoUrl} alt={schoolName} className="login__logo" />
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
                <div className="login__social-links">
                  {socials.map((social) => (
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

        {/* Form Section */}
        <div className="login__form-section">
          <div className="login__form-wrapper">
            <div className="login__form-header">
              <h2>Masuk ke Akun</h2>
              <p>Solusi mudah untuk untuk sekolah</p>
            </div>

            {error && (
              <div className="login__error">
                <i className="ri-alert-fill"></i>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login__form">
              <div className="login__input-group">
                <div className="login__input-field">
                  <i className="ri-user-3-fill"></i>
                  <input
                    type="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    disabled={isSubmitting}
                    required
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
                  />
                  <i
                    className={`ri-eye-${showPassword ? 'off' : ''}-fill login__toggle`}
                    onClick={() => setShowPassword(!showPassword)}
                  ></i>
                </div>
              </div>

              <div className="login__form-options">
                <Link to="/forgot-password" className="login__forgot-link">
                  Lupa password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="login__submit-btn"
              >
                {isSubmitting ? (
                  <div className="login__spinner"></div>
                ) : (
                  <i className="ri-login-box-fill"></i>
                )}
                Masuk
              </button>
            </form>

            <div className="login__form-footer">
              <p>
                Belum punya akun?
                <Link to="/register" className="login__register-link">
                  {' '}
                  Daftar
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
