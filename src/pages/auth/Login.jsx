// src/pages/auth/Login.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import GoogleCredentialButton from '../../components/GoogleCredentialButton';
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../../lib/supabase';
import { getRoleHome, isValidRole } from '../../utils/role';
import { shouldForceAccountSetup } from '../../utils/accountSetup';
import { sanitizeExternalUrl, sanitizeMediaUrl } from '../../utils/sanitize';
import AuthIcon from '../../components/AuthIcon';
import '../../styles/Login.css';

const sanitizeNextPath = (value) => {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return '';

  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const url = new URL(raw, baseOrigin);

    if (typeof window !== 'undefined' && url.origin !== window.location.origin) {
      return '';
    }

    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    if (
      nextPath.startsWith('/login') ||
      nextPath.startsWith('/register') ||
      nextPath.startsWith('/forgot-password') ||
      nextPath.startsWith('/reset-password')
    ) {
      return '';
    }

    return nextPath.startsWith('/') ? nextPath : '';
  } catch {
    return '';
  }
};

const resolveRetryAfterSeconds = (result, fallbackMessage = '') => {
  const direct = Number(result?.retryAfter ?? result?.retry_after ?? result?.retry_after_seconds)
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct)

  const match = String(result?.error || fallbackMessage || '').match(/(?:dalam|tunggu)\s+(\d+)\s+detik/i)
  if (match) {
    const parsed = Number(match[1])
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed)
  }

  return 0
}

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, login, loginWithGoogleCredential, completeGooglePopupLogin } = useAuthStore();

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

  const startCooldownSeconds = useCallback((seconds) => {
    const safeSeconds = Math.min(900, Math.max(1, Math.ceil(Number(seconds) || 0)))
    setCooldownEnd(Date.now() + safeSeconds * 1000)
    setCooldownLeft(safeSeconds)
  }, [])

  const startCooldown = useCallback((fails) => {
    // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
    const seconds = Math.min(30, Math.pow(2, fails));
    startCooldownSeconds(seconds);
  }, [startCooldownSeconds]);

  const [settings, setSettings] = useState(null);
  const [settingsId, setSettingsId] = useState(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [logoPreview, setLogoPreview] = useState('');
  const nextAfterLogin = sanitizeNextPath(
    new URLSearchParams(location.search).get('next')
  );

  // Load settings sekali di awal
  useEffect(() => {
    let isCancelled = false;

    const loadSettings = async () => {
      try {
        let { data, error } = await supabase.public.settings();

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
      const loginReason = String(url.searchParams.get('reason') || '').trim()
      if (!googleStatus && !loginReason) return

      let nextError = ''
      let nextInfo = ''
      if (loginReason === 'session-expired') {
        nextInfo =
          'Sesi Anda telah berakhir karena tidak ada aktivitas. Silakan login lagi untuk melanjutkan.'
      }
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
      : nextAfterLogin || getRoleHome(profile.role);
    navigate(target, { replace: true });
  }, [user, profile, navigate, nextAfterLogin]);

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
        const serverRetryAfter = resolveRetryAfterSeconds(result, errorMsg)
        const isSessionPreparing =
          errorMsg.includes('sesi login belum siap') ||
          errorMsg.includes('login belum selesai diproses')

        if (isSessionPreparing) {
          setError('Sesi login sedang disiapkan. Tunggu sebentar lalu klik Masuk sekali lagi.')
          return
        }

        const newFails = failCount + 1;
        setFailCount(newFails);

        // Start cooldown setelah 2+ kali gagal
        if (newFails >= 2) {
          startCooldown(newFails - 1);
        }
        if (serverRetryAfter > 0) {
          startCooldownSeconds(serverRetryAfter)
        }

        if (
          errorMsg.includes('invalid login credentials') ||
          errorMsg.includes('invalid email or password')
        ) {
          const waitSeconds = serverRetryAfter || (newFails >= 2 ? Math.min(30, Math.pow(2, newFails - 1)) : 0)
          setError(`Email/NIS atau password salah${waitSeconds ? `. Tunggu ${waitSeconds} detik sebelum coba lagi` : ''}`);
        } else if (errorMsg.includes('email not confirmed')) {
          setError('Email belum dikonfirmasi. Silakan cek email Anda');
        } else if (errorMsg.includes('too many requests')) {
          const waitSeconds = serverRetryAfter || 30
          setError(`Terlalu banyak percobaan login. Silakan coba lagi dalam ${waitSeconds} detik`);
          startCooldownSeconds(waitSeconds);
        } else if (result.status === 429) {
          const waitSeconds = serverRetryAfter || 30
          setError(`Terlalu banyak percobaan login. Silakan coba lagi dalam ${waitSeconds} detik`)
          startCooldownSeconds(waitSeconds)
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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !isSubmitting && !isOnCooldown) {
      handleSubmit(e);
    }
  };

  // Data sekolah dengan fallback
  const schoolName = settings?.nama_sekolah || 'Sekolah';
  const logoUrl = logoPreview || '';
  const address = settings?.alamat || '';
  const phone = settings?.telepon || '';
  const emailSekolah = settings?.email || '';
  const isSessionExpiredNotice = info.toLowerCase().includes('sesi anda telah berakhir');
  const adminSubdomain = String(import.meta.env.VITE_ADMIN_SUBDOMAIN || 'admin26')
    .trim()
    .toLowerCase();
  const runtimeHost = typeof window !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : '';
  const hostParts = runtimeHost.split('.').filter(Boolean);
  const isAdminHost =
    runtimeHost === adminSubdomain ||
    (hostParts.length >= 2 && hostParts[0] === adminSubdomain);
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

  const handleGoogleCredential = useCallback(async (credential) => {
    setError('')
    setInfo('')
    setIsGoogleSubmitting(true)

    try {
      const result = await loginWithGoogleCredential(credential)
      if (result?.error) {
        setError(result.error)
        return
      }

      setFailCount(0)
      setCooldownEnd(0)
      setInfo('Login Google berhasil. Mengarahkan ke dashboard...')
    } finally {
      setIsGoogleSubmitting(false)
    }
  }, [loginWithGoogleCredential, setCooldownEnd, setFailCount])

  const handleGoogleOAuthSuccess = useCallback(async () => {
    setError('')
    setInfo('')
    setIsGoogleSubmitting(true)

    try {
      const result = await completeGooglePopupLogin()
      if (result?.error) {
        setError(result.error)
        return
      }

      setFailCount(0)
      setCooldownEnd(0)
      setInfo('Login Google berhasil. Mengarahkan ke dashboard...')
    } finally {
      setIsGoogleSubmitting(false)
    }
  }, [completeGooglePopupLogin, setCooldownEnd, setFailCount])

  // Deteksi jika halaman login dibuka di dalam popup window (misalnya setelah Google OAuth callback)
  const isPopupWindow = typeof window !== 'undefined' && (
    window.opener != null || window.name === 'edusmart_google_auth_popup'
  )

  // Loading state
  if (isLoadingSettings) {
    return (
      <div className="login-loading">
        <div className="login-spinner"></div>
        <p className="login-loading-text">Memuat halaman login...</p>
      </div>
    );
  }

  // Jika dibuka di popup window (Google OAuth redirect kembali ke /login di popup),
  // tampilkan versi minimalis yang bersih
  if (isPopupWindow) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #e0f2fe 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}>
        <div style={{
          width: '100%',
          maxWidth: '380px',
          background: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 20px 60px rgba(100, 116, 139, 0.15), 0 0 0 1px rgba(226, 232, 240, 0.8)',
          overflow: 'hidden',
          textAlign: 'center',
        }}>
          {/* Header */}
          <div style={{
            padding: '32px 24px 20px',
            borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              boxShadow: '0 8px 24px rgba(99, 102, 241, 0.3)',
            }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                <path d="M21.805 12.23c0-.76-.068-1.49-.195-2.19H12v4.15h5.49a4.69 4.69 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.055-4.4 3.055-7.6Z" fill="#fff" fillOpacity=".9"/>
                <path d="M12 22c2.76 0 5.075-.915 6.765-2.475l-3.3-2.56c-.915.615-2.085.98-3.465.98-2.66 0-4.915-1.795-5.72-4.21H2.87v2.64A10 10 0 0 0 12 22Z" fill="#fff" fillOpacity=".75"/>
                <path d="M6.28 13.735a5.97 5.97 0 0 1-.32-1.935c0-.67.115-1.32.32-1.935V7.225H2.87A9.99 9.99 0 0 0 2 11.8c0 1.61.385 3.135.87 4.575l3.41-2.64Z" fill="#fff" fillOpacity=".65"/>
                <path d="M12 5.655c1.5 0 2.845.515 3.905 1.525l2.93-2.93C17.07 2.61 14.755 1.6 12 1.6A10 10 0 0 0 2.87 7.225l3.41 2.64c.805-2.415 3.06-4.21 5.72-4.21Z" fill="#fff" fillOpacity=".85"/>
              </svg>
            </div>

            <h1 style={{
              fontSize: '17px',
              fontWeight: '700',
              color: '#0f172a',
              letterSpacing: '-0.02em',
              margin: '0 0 4px',
            }}>
              Login Google Selesai
            </h1>

            <p style={{
              fontSize: '12px',
              color: '#64748b',
              margin: 0,
            }}>
              Sedang memproses akun Anda...
            </p>
          </div>

          {/* Status */}
          <div style={{ padding: '24px' }}>
            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '14px',
                padding: '16px',
                marginBottom: '12px',
              }}>
                <p style={{
                  fontSize: '12px',
                  color: '#b91c1c',
                  margin: 0,
                  lineHeight: '1.5',
                }}>
                  {error}
                </p>
              </div>
            )}

            {info && (
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '14px',
                padding: '16px',
                marginBottom: '12px',
              }}>
                <p style={{
                  fontSize: '12px',
                  color: '#166534',
                  margin: 0,
                  lineHeight: '1.5',
                }}>
                  {info}
                </p>
              </div>
            )}

            {!error && !info && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 0',
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid #e2e8f0',
                  borderTopColor: '#6366f1',
                  borderRadius: '50%',
                  animation: 'popup-login-spin 0.8s linear infinite',
                }} />
                <p style={{
                  fontSize: '12px',
                  color: '#94a3b8',
                  margin: 0,
                }}>
                  Mohon tunggu sebentar...
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                try { window.close() } catch { /* ignore */ }
                window.location.href = '/'
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                marginTop: '8px',
                transition: 'all 0.15s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#e2e8f0'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#f1f5f9'
              }}
            >
              Tutup Jendela Ini
            </button>
          </div>

          {/* Security footer */}
          <div style={{
            padding: '10px 24px 14px',
            borderTop: '1px solid #f1f5f9',
          }}>
            <p style={{
              fontSize: '10px',
              color: '#94a3b8',
              margin: 0,
            }}>
              🔒 Koneksi terenkripsi · EduSmart tidak menyimpan password Google
            </p>
          </div>
        </div>

        <style>{`
          @keyframes popup-login-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

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
                  <AuthIcon className="ri-school-fill" />
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
                <AuthIcon className="ri-graduation-cap-fill" />
                <span>Kelola Akademik Digital</span>
              </div>
              <div className="login__feature-item">
                <AuthIcon className="ri-file-list-3-fill" />
                <span>Manajemen Tugas & Nilai</span>
              </div>
              <div className="login__feature-item">
                <AuthIcon className="ri-calendar-check-fill" />
                <span>Solusi Absensi Sekolah</span>
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
                      <AuthIcon className={social.icon} />
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
                <AuthIcon className="ri-alert-fill" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div
                className={isSessionExpiredNotice ? 'login__error login__error--warning' : 'login__success'}
                role="status"
              >
                <AuthIcon className={isSessionExpiredNotice ? 'ri-time-line' : 'ri-checkbox-circle-fill'} />
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
                  <AuthIcon className="ri-user-3-fill" />
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
                  <AuthIcon className="ri-lock-password-fill" />
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
                    <AuthIcon
                      className={`ri-eye-${showPassword ? 'off' : ''
                        }-fill`}
                    />
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
                  disabled={isSubmitting || isOnCooldown || !form.email || !form.password}
                  className="login__submit-btn"
                  aria-label="Masuk"
                >
                  {isSubmitting ? (
                    <>
                      <div className="login__spinner-btn"></div>
                      <span>Memproses...</span>
                    </>
                  ) : isOnCooldown ? (
                    <>
                      <AuthIcon className="ri-time-line" />
                      <span>Tunggu {cooldownLeft} detik</span>
                    </>
                  ) : (
                    <>
                      <AuthIcon className="ri-login-box-fill" />
                      <span>Masuk</span>
                    </>
                  )}
                </button>
              </div>

              <div className="login__divider" role="separator" aria-label="Atau login dengan Google">
                <span>atau</span>
              </div>

              <div className="login__google-slot">
                <GoogleCredentialButton
                  onCredential={handleGoogleCredential}
                  onOAuthSuccess={handleGoogleOAuthSuccess}
                  busy={isGoogleSubmitting}
                  className="w-full"
                  buttonClassName="login__google-btn"
                  noteClassName="login__google-note"
                  iconClassName="login__google-icon"
                  label="Masuk dengan Google"
                  busyLabel="Memproses login Google..."
                />
              </div>
            </form>

            {!isAdminHost && (
              <div className="login__form-footer">
                <p>
                  Belum punya akun?
                  <Link to="/register" className="login__register-link">
                    {' '}
                    Daftar Sekarang
                  </Link>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
