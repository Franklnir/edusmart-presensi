// src/pages/auth/Login.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../../lib/supabase';
import { getRoleHome, isValidRole } from '../../utils/role';
import { shouldForceAccountSetup } from '../../utils/accountSetup';
import { sanitizeExternalUrl, sanitizeMediaUrl } from '../../utils/sanitize';
import '../../styles/Login.css';

const Login = () => {
  const navigate = useNavigate();
  const { user, profile, login } = useAuthStore();

  const [form, setForm] = useState({
    email: '',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Rate limiting state
  const [failCount, setFailCount] = useState(0);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownTimerRef = useRef(null);

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownEnd <= 0) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setCooldownLeft(left);
      if (left <= 0) {
        clearInterval(cooldownTimerRef.current);
        setCooldownEnd(0);
      }
    };
    tick();
    cooldownTimerRef.current = setInterval(tick, 500);
    return () => clearInterval(cooldownTimerRef.current);
  }, [cooldownEnd]);

  const startCooldown = useCallback((fails) => {
    // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
    const seconds = Math.min(30, Math.pow(2, fails));
    setCooldownEnd(Date.now() + seconds * 1000);
    setCooldownLeft(seconds);
  }, []);

  const [settings, setSettings] = useState(null);
  const [settingsId, setSettingsId] = useState(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [logoPreview, setLogoPreview] = useState('');

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
      } catch (_err) {
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

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const url = new URL(window.location.href)
      const googleStatus = String(url.searchParams.get('google') || '').trim()
      const googleError = String(url.searchParams.get('google_error') || '').trim()
      if (!googleStatus) return

      let nextError = ''
      let nextInfo = ''
      if (googleStatus === 'failed' && googleError) {
        nextError = googleError
      } else if (googleStatus === 'disabled') {
        nextError = 'Login Google belum diaktifkan oleh administrator.'
      } else if (googleStatus === 'state_invalid') {
        nextError = 'Sesi login Google tidak valid atau sudah kedaluwarsa.'
      } else if (googleStatus === 'tenant_invalid') {
        nextError = 'Tenant sekolah tidak valid untuk login Google.'
      } else if (googleStatus === 'unauthenticated') {
        nextError = 'Silakan login biasa dulu sebelum menautkan Google.'
      } else if (googleStatus === 'success') {
        nextInfo = 'Login Google berhasil. Mengarahkan ke dashboard...'
      } else if (googleStatus === 'linked') {
        nextInfo = 'Akun Google berhasil ditautkan.'
      }

      setInfo(nextInfo)
      if (nextError) {
        setError(nextError)
      } else {
        setError('')
      }

      url.searchParams.delete('google')
      url.searchParams.delete('google_error')
      const cleaned = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState({}, '', cleaned)
    } catch {
      // ignore malformed URL
    }
  }, [])

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

  // Build signed URL for logo (supports path)
  useEffect(() => {
    let active = true;
    const raw = settings?.logo_url || settings?.logo_path || '';
    if (!raw) {
      setLogoPreview('');
      return () => { active = false; };
    }

    const safeRawLogoUrl = sanitizeMediaUrl(raw);
    if (/^https?:\/\//i.test(safeRawLogoUrl)) {
      setLogoPreview(safeRawLogoUrl);
      return () => { active = false; };
    }

    getSignedUrlForValue(PROFILE_BUCKET, raw, 60 * 30)
      .then((url) => { if (active) setLogoPreview(url); })
      .catch(() => { if (active) setLogoPreview(''); });

    return () => { active = false; };
  }, [settings?.logo_url, settings?.logo_path]);

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

    if (!isValidRole(profile.role)) {
      setError('Role tidak dikenali. Hubungi administrator.');
      supabase.auth.signOut();
      return;
    }

    const needsSetup = shouldForceAccountSetup(profile, user?.email);

    const target = needsSetup
      ? profile.role === 'siswa'
        ? '/siswa/profile'
        : '/guru/profile'
      : getRoleHome(profile.role);
    navigate(target, { replace: true });
  }, [user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Rate limit check
    if (cooldownEnd > Date.now()) {
      setError(`Terlalu banyak percobaan. Tunggu ${cooldownLeft} detik`);
      return;
    }

    // Validasi input
    if (!form.email.trim() || !form.password.trim()) {
      setError('Email/NIS dan password harus diisi');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setInfo('');

    try {
      const result = await login(form.email, form.password);

      if (result?.error) {
        const errorMsg = result.error.toLowerCase();
        const newFails = failCount + 1;
        setFailCount(newFails);

        // Start cooldown setelah 2+ kali gagal
        if (newFails >= 2) {
          startCooldown(newFails - 1);
        }

        if (
          errorMsg.includes('invalid login credentials') ||
          errorMsg.includes('invalid email or password')
        ) {
          setError(`Email/NIS atau password salah${newFails >= 2 ? `. Tunggu ${Math.min(30, Math.pow(2, newFails - 1))} detik sebelum coba lagi` : ''}`);
        } else if (errorMsg.includes('email not confirmed')) {
          setError('Email belum dikonfirmasi. Silakan cek email Anda');
        } else if (errorMsg.includes('too many requests')) {
          setError('Terlalu banyak percobaan login. Silakan coba lagi nanti');
          startCooldown(5); // Force 30s cooldown
        } else {
          setError(result.error);
        }
      } else {
        // Login berhasil, reset fail count
        setFailCount(0);
        setCooldownEnd(0);
      }
    } catch (_err) {
      setError('Terjadi kesalahan saat login. Silakan coba lagi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isOnCooldown = cooldownEnd > Date.now();

  const handleGoogleLogin = async () => {
    setError('')
    setInfo('')
    setIsGoogleSubmitting(true)

    try {
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}/login`
          : '/login'

      const { error: googleError } = await supabase.auth.signInWithGoogle({
        redirectTo
      })

      if (googleError) {
        throw googleError
      }
    } catch (err) {
      setError(err?.message || 'Gagal memulai login Google')
      setIsGoogleSubmitting(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isSubmitting && !isOnCooldown) {
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
  const logoUrl = logoPreview || '';
  const address = settings?.alamat || '';
  const phone = settings?.telepon || '';
  const emailSekolah = settings?.email || '';
  const isGoogleAuthEnabled = Boolean(supabase.auth.isGoogleEnabled?.());
  const adminSubdomain = String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin')
    .trim()
    .toLowerCase();
  const runtimeHost = typeof window !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : '';
  const hostParts = runtimeHost.split('.').filter(Boolean);
  const isAdminHost =
    runtimeHost === adminSubdomain ||
    (hostParts.length >= 2 && hostParts[0] === adminSubdomain);
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
  ]
    .map((social) => ({ ...social, href: sanitizeExternalUrl(social.href) }))
    .filter((social) => social.href && social.href.trim() !== '');

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
                    const img = e.target;
                    img.style.display = 'none';

                    const parent = img.parentElement;
                    const fallback = parent
                      ? parent.querySelector('.login__logo-fallback')
                      : null;

                    if (fallback && fallback.style) {
                      fallback.style.display = 'flex';
                    }
                  }}
                />
              ) : (
                <div className="login__logo-fallback">
                  <i className="ri-school-fill"></i>
                </div>
              )}
              <div className="login__school-text">
                <h1 className="login__school-name">{schoolName}</h1>
                <p className="login__system-name">
                  Sistem Absensi & Tugas Digital
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
                    {phone && emailSekolah && (
                      <span className="login__separator"> • </span>
                    )}
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
            {info && (
              <div className="login__success" role="status">
                <i className="ri-checkbox-circle-fill"></i>
                <span>{info}</span>
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
                    type="text"
                    placeholder="Email / NIS"
                    value={form.email}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        email: e.target.value.trim()
                      }))
                    }
                    disabled={isSubmitting}
                    required
                    autoComplete="username"
                    aria-label="Email atau NIS"
                  />
                </div>

                <div className="login__input-field">
                  <i className="ri-lock-password-fill"></i>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        password: e.target.value
                      }))
                    }
                    disabled={isSubmitting}
                    required
                    autoComplete="current-password"
                    aria-label="Password"
                  />
                  <button
                    type="button"
                    className={`login__toggle ${showPassword ? 'active' : ''
                      }`}
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={0}
                    aria-label={
                      showPassword
                        ? 'Sembunyikan password'
                        : 'Tampilkan password'
                    }
                  >
                    <i
                      className={`ri-eye-${showPassword ? 'off' : ''
                        }-fill`}
                    ></i>
                  </button>
                </div>
              </div>

              {!isAdminHost && (
                <div className="login__form-options">
                  <Link to="/forgot-password" className="login__forgot-link">
                    Lupa password?
                  </Link>
                </div>
              )}

              <div className="login__action-row">
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
              </div>

              <div className="login__divider" role="separator" aria-label="Atau login dengan Google">
                <span>atau</span>
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleSubmitting || isSubmitting}
                className="login__google-btn"
                aria-label="Masuk dengan Google"
                title="Masuk dengan Google"
              >
                <span className="login__google-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img" focusable="false">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.95h5.49c-.24 1.27-.96 2.35-2.03 3.08l3.29 2.55c1.92-1.77 3.02-4.37 3.02-7.45 0-.73-.07-1.44-.19-2.13H12z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 22c2.73 0 5.03-.9 6.71-2.43l-3.29-2.55c-.91.61-2.08.98-3.42.98-2.64 0-4.88-1.78-5.68-4.18l-3.4 2.62C4.59 19.74 8.03 22 12 22z"
                    />
                    <path
                      fill="#4A90E2"
                      d="M6.32 13.82A6 6 0 016 12c0-.63.11-1.24.32-1.82L2.92 7.56A9.99 9.99 0 002 12c0 1.62.39 3.14 1.08 4.44l3.24-2.62z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M12 5.95c1.48 0 2.81.51 3.86 1.51l2.9-2.9C17.03 2.94 14.73 2 12 2 8.03 2 4.59 4.26 2.92 7.56l3.4 2.62C7.12 7.78 9.36 5.95 12 5.95z"
                    />
                  </svg>
                </span>
                <span>
                  {isGoogleSubmitting
                    ? 'Mengalihkan ke Google...'
                    : 'Masuk dengan Google'}
                </span>
              </button>

              {!isGoogleAuthEnabled && (
                <p className="login__google-note">
                  Hubungi admin untuk mengaktifkan OAuth Google.
                </p>
              )}
            </form>

            <div className="login__form-footer">
              <p>
                Belum punya akun?
                <Link to="/register" className="login__register-link">
                  {' '}
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
