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
import '../../styles/GooglePopup.css';

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

const DEFAULT_LOGIN_SETTINGS = {
  nama_sekolah: 'Sekolah',
  alamat: '',
  telepon: '',
  email: '',
  logo_url: ''
}

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
    <path
      d="M21.805 12.23c0-.76-.068-1.49-.195-2.19H12v4.15h5.49a4.69 4.69 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.055-4.4 3.055-7.6Z"
      fill="#4285F4"
    />
    <path
      d="M12 22c2.76 0 5.075-.915 6.765-2.475l-3.3-2.56c-.915.615-2.085.98-3.465.98-2.66 0-4.915-1.795-5.72-4.21H2.87v2.64A10 10 0 0 0 12 22Z"
      fill="#34A853"
    />
    <path
      d="M6.28 13.735a5.97 5.97 0 0 1-.32-1.935c0-.67.115-1.32.32-1.935V7.225H2.87A9.99 9.99 0 0 0 2 11.8c0 1.61.385 3.135.87 4.575l3.41-2.64Z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.655c1.5 0 2.845.515 3.905 1.525l2.93-2.93C17.07 2.61 14.755 1.6 12 1.6A10 10 0 0 0 2.87 7.225l3.41 2.64c.805-2.415 3.06-4.21 5.72-4.21Z"
      fill="#EA4335"
    />
  </svg>
)

const GOOGLE_POPUP_NAME_PREFIX = 'edusmart_google_auth_popup'

const normalizeGooglePopupMode = (value) => (
  String(value || '').trim().toLowerCase() === 'link' ? 'link' : 'login'
)

const createGooglePopupStateToken = () => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `google_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const readPopupLaunchFromWindowName = () => {
  if (typeof window === 'undefined') {
    return {
      isGooglePopupName: false,
      state: '',
      mode: 'login'
    }
  }

  const popupName = String(window.name || '').trim()
  if (popupName === GOOGLE_POPUP_NAME_PREFIX) {
    return {
      isGooglePopupName: true,
      state: '',
      mode: 'login'
    }
  }

  const prefix = `${GOOGLE_POPUP_NAME_PREFIX}_`
  if (!popupName.startsWith(prefix)) {
    return {
      isGooglePopupName: false,
      state: '',
      mode: 'login'
    }
  }

  const raw = popupName.slice(prefix.length)
  const modeMatch = raw.match(/^(login|link)_(.+)$/)

  if (modeMatch) {
    return {
      isGooglePopupName: true,
      state: String(modeMatch[2] || '').trim(),
      mode: normalizeGooglePopupMode(modeMatch[1])
    }
  }

  return {
    isGooglePopupName: true,
    state: raw.trim(),
    mode: 'login'
  }
}

const popupResumeStorageKey = (state) => `edusmart_google_popup_resume:${state}`

const canResumeGooglePopupState = (state) => {
  const safeState = String(state || '').trim()
  if (!safeState || typeof window === 'undefined') return false

  try {
    const key = popupResumeStorageKey(safeState)
    const attempts = Number(window.sessionStorage?.getItem(key) || '0')
    if (Number.isFinite(attempts) && attempts >= 2) return false
    window.sessionStorage?.setItem(key, String((Number.isFinite(attempts) ? attempts : 0) + 1))
  } catch {
    // If storage is blocked, still allow the recovery once in memory-less mode.
  }

  return true
}

const readGooglePopupRuntime = () => {
  const fallback = {
    isPopupWindow: false,
    hasGoogleStatus: false,
    hasPopupState: false,
    isRedirectingToGoogle: false,
    status: '',
    state: '',
    mode: 'login'
  }

  if (typeof window === 'undefined') return fallback

  try {
    const url = new URL(window.location.href)
    const status = String(url.searchParams.get('google') || '').trim()
    const urlState = String(url.searchParams.get('google_popup_state') || '').trim()
    const popupLaunch = readPopupLaunchFromWindowName()
    const state = urlState || popupLaunch.state
    const mode = normalizeGooglePopupMode(
      url.searchParams.get('google_popup_mode') || popupLaunch.mode
    )
    const hasPopupParams = urlState !== '' || url.searchParams.has('google_popup_mode') || status !== ''

    const isPopupWindow = popupLaunch.isGooglePopupName ||
      (window.opener != null && hasPopupParams)

    return {
      isPopupWindow,
      hasGoogleStatus: status !== '',
      hasPopupState: state !== '',
      isRedirectingToGoogle: false,
      status,
      state,
      mode
    }
  } catch {
    return fallback
  }
}

const buildPopupResumeOAuthUrl = ({ state, mode }) => {
  const endpoint = mode === 'link'
    ? '/api/auth/google/link'
    : '/api/auth/google/redirect'
  const returnUrl = new URL(`${window.location.origin}/login`)

  returnUrl.searchParams.set('google_popup_state', state)
  returnUrl.searchParams.set('google_popup_mode', mode)

  const oauthUrl = new URL(endpoint, window.location.origin)
  oauthUrl.searchParams.set('popup', '1')
  oauthUrl.searchParams.set('origin', window.location.origin)
  oauthUrl.searchParams.set('popup_state', state)
  oauthUrl.searchParams.set('mode', mode)
  oauthUrl.searchParams.set('redirect', returnUrl.toString())

  return oauthUrl
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
  const [googlePopupRuntime, setGooglePopupRuntime] = useState(readGooglePopupRuntime);
  const [googlePopupRecoveryFailed, setGooglePopupRecoveryFailed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Rate limiting state
  const [failCount, setFailCount] = useState(0);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownTimerRef = useRef(null);
  const hasProcessedUrl = useRef(false);

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

  const [settings, setSettings] = useState(DEFAULT_LOGIN_SETTINGS);
  const [settingsId, setSettingsId] = useState(null);
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
          data = DEFAULT_LOGIN_SETTINGS;
        } else if (error) {
          throw error;
        }

        if (!isCancelled) {
          setSettings(data);
          if (data?.id) setSettingsId(data.id);
        }
      } catch (_err) {
        if (!isCancelled) {
          // Tetap lanjut meski settings gagal load
          setSettings(DEFAULT_LOGIN_SETTINGS);
        }
      }
    };

    loadSettings();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    if (hasProcessedUrl.current) return undefined
    hasProcessedUrl.current = true

    let redirectTimer = null

    try {
      const url = new URL(window.location.href)
      const googleStatus = String(url.searchParams.get('google') || '').trim()
      const googleError = String(url.searchParams.get('google_error') || '').trim()
      const popupLaunch = readPopupLaunchFromWindowName()
      const googlePopupStateFromUrl = String(url.searchParams.get('google_popup_state') || '').trim()
      let googlePopupState = googlePopupStateFromUrl || popupLaunch.state
      const hasGooglePopupStateParam = url.searchParams.has('google_popup_state')
      const hasGooglePopupModeParam = url.searchParams.has('google_popup_mode')
      const googlePopupMode = normalizeGooglePopupMode(
        url.searchParams.get('google_popup_mode') || popupLaunch.mode
      )
      const loginReason = String(url.searchParams.get('reason') || '').trim()
      const hasPopupMarker = popupLaunch.isGooglePopupName ||
        hasGooglePopupStateParam ||
        hasGooglePopupModeParam ||
        googleStatus !== ''
      const openedAsPopup = popupLaunch.isGooglePopupName ||
        (window.opener != null && hasPopupMarker)
      const normalizedPopupMode = googlePopupMode

      if (openedAsPopup && !googlePopupState && !googleStatus && !loginReason) {
        // Popup opened but no state/status found — this happens when backend
        // redirected popup to /login?google=disabled but URL was already cleaned,
        // or when the popup opened directly to /login without proper params.
        // Generate a transient state so the popup UI renders, but mark that
        // it should NOT attempt a recovery re-launch to backend.
        googlePopupState = createGooglePopupStateToken()
      }

      const shouldResumeGooglePopup = openedAsPopup &&
        googlePopupState &&
        !googleStatus &&
        !loginReason &&
        canResumeGooglePopupState(googlePopupState)

      setGooglePopupRuntime({
        isPopupWindow: openedAsPopup,
        hasGoogleStatus: googleStatus !== '',
        hasPopupState: googlePopupState !== '',
        isRedirectingToGoogle: shouldResumeGooglePopup,
        status: googleStatus,
        state: googlePopupState,
        mode: normalizedPopupMode
      })

      if (shouldResumeGooglePopup) {
        const oauthUrl = buildPopupResumeOAuthUrl({
          state: googlePopupState,
          mode: normalizedPopupMode
        })

        redirectTimer = window.setTimeout(() => {
          window.location.replace(oauthUrl.toString())
        }, 250)

        return () => {
          if (redirectTimer) window.clearTimeout(redirectTimer)
        }
      }

      if (!googleStatus && !loginReason) {
        if (!openedAsPopup && (hasGooglePopupStateParam || hasGooglePopupModeParam)) {
          url.searchParams.delete('google_popup_state')
          url.searchParams.delete('google_popup_mode')
          const cleaned = `${url.pathname}${url.search}${url.hash}`
          window.history.replaceState({}, '', cleaned)
        }
        return
      }

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

      if (openedAsPopup && googlePopupState && googleStatus) {
        const payload = {
          source: 'edusmart-google-popup',
          type: nextError ? 'edusmart-google-error' : 'edusmart-google-oauth-success',
          state: googlePopupState,
          mode: normalizedPopupMode,
          status: googleStatus || 'success'
        }

        if (nextError) {
          payload.error = nextError
        }

        try {
          window.opener?.postMessage(payload, window.location.origin)
        } catch {
          // ignore popup bridge errors
        }

        window.setTimeout(() => {
          try {
            window.close()
          } catch {
            // ignore close errors
          }
        }, nextError ? 1800 : 700)
      }

      setInfo(nextInfo)
      if (nextError) {
        setError(nextError)
      } else {
        setError('')
      }

      url.searchParams.delete('google')
      url.searchParams.delete('google_error')
      url.searchParams.delete('google_popup_state')
      url.searchParams.delete('google_popup_mode')
      const cleaned = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState({}, '', cleaned)
    } catch {
      // ignore malformed URL
    }

    return () => {
      if (redirectTimer) window.clearTimeout(redirectTimer)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!googlePopupRuntime.isPopupWindow) return undefined
    if (
      googlePopupRuntime.hasGoogleStatus ||
      googlePopupRuntime.hasPopupState ||
      googlePopupRuntime.isRedirectingToGoogle
    ) {
      setGooglePopupRecoveryFailed(false)
      return undefined
    }

    if (!window.opener) {
      setGooglePopupRecoveryFailed(true)
      return undefined
    }

    let attempts = 0
    let stopped = false
    setGooglePopupRecoveryFailed(false)

    const askOpenerToRelaunch = () => {
      if (stopped || attempts >= 8) return
      attempts += 1

      try {
        window.opener.postMessage(
          {
            source: 'edusmart-google-popup',
            type: 'edusmart-google-launch-request'
          },
          window.location.origin
        )
      } catch {
        // Ignore; the timeout below will show a clear fallback.
      }
    }

    askOpenerToRelaunch()
    const interval = window.setInterval(askOpenerToRelaunch, 450)
    const timeout = window.setTimeout(() => {
      stopped = true
      setGooglePopupRecoveryFailed(true)
      window.clearInterval(interval)
    }, 4200)

    return () => {
      stopped = true
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [
    googlePopupRuntime.hasGoogleStatus,
    googlePopupRuntime.hasPopupState,
    googlePopupRuntime.isPopupWindow,
    googlePopupRuntime.isRedirectingToGoogle
  ])

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
        return result
      }

      setFailCount(0)
      setCooldownEnd(0)
      setInfo('Login Google berhasil. Mengarahkan ke dashboard...')
      return result
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
        return result
      }

      setFailCount(0)
      setCooldownEnd(0)
      setInfo('Login Google berhasil. Mengarahkan ke dashboard...')
      return result
    } finally {
      setIsGoogleSubmitting(false)
    }
  }, [completeGooglePopupLogin, setCooldownEnd, setFailCount])

  // Jika callback Google kembali ke /login di popup,
  // tampilkan versi minimalis yang bersih
  if (googlePopupRuntime.isPopupWindow) {
    const hasLiveOpener = typeof window !== 'undefined' && window.opener != null
    const popupMissingState = !googlePopupRuntime.hasGoogleStatus &&
      !googlePopupRuntime.hasPopupState &&
      !googlePopupRuntime.isRedirectingToGoogle
    const popupRecoveringState = popupMissingState && hasLiveOpener && !googlePopupRecoveryFailed
    const popupErrorMessage = popupMissingState
      ? 'Sesi popup Google tidak lengkap. Tutup jendela ini, lalu klik Masuk dengan Google sekali lagi dari halaman utama.'
      : error
    const popupHasError = Boolean(!popupRecoveringState && popupErrorMessage)
    const popupHasSuccess = Boolean(info && !popupHasError)
    const popupTitle = popupHasError
      ? 'Login Google belum siap'
      : popupHasSuccess
        ? 'Login Google berhasil'
        : googlePopupRuntime.isRedirectingToGoogle || popupRecoveringState
          ? 'Membuka pilihan akun Google'
          : 'Menyelesaikan login Google'
    const popupDescription = popupHasError
      ? 'Tutup jendela ini, lalu coba login Google sekali lagi dari halaman utama.'
      : popupHasSuccess
        ? 'Sesi sedang disiapkan di halaman utama. Jendela ini akan tertutup otomatis.'
        : googlePopupRuntime.isRedirectingToGoogle || popupRecoveringState
          ? 'Jendela ini akan diarahkan ke halaman resmi Google untuk memilih akun.'
          : 'Mohon tunggu sebentar saat kami menyiapkan sesi akun Anda.'

    return (
      <div className="google-popup-page">
        <main className="google-popup-shell">
          <section className="google-popup-panel" aria-live="polite">
            <div className="google-popup-logo" aria-hidden="true">
              <GoogleLogo />
            </div>
            <p className="google-popup-kicker">Google sign-in</p>
            <h1 className="google-popup-title">{popupTitle}</h1>
            <p className="google-popup-description">{popupDescription}</p>

            {popupHasError && (
              <div className="google-popup-status google-popup-status--error">
                <span>{popupErrorMessage}</span>
              </div>
            )}

            {info && !popupHasError && (
              <div className="google-popup-status google-popup-status--success">
                <span className="google-popup-check" aria-hidden="true" />
                <span>{info}</span>
              </div>
            )}

            {!popupHasError && !info && (
              <div className="google-popup-status">
                <span className="google-popup-spinner" aria-hidden="true" />
                <span>
                  {googlePopupRuntime.isRedirectingToGoogle || popupRecoveringState
                    ? 'Membuka daftar akun Google...'
                    : 'Memproses akun Google...'}
                </span>
              </div>
            )}

            <div className="google-popup-actions">
              <button
                type="button"
                className="google-popup-button"
                onClick={() => {
                  try { window.close() } catch { /* ignore */ }
                  window.location.href = '/'
                }}
              >
                Tutup jendela
              </button>
            </div>

            <p className="google-popup-secure">
              Koneksi aman. SISMU tidak menyimpan password Google Anda.
            </p>
          </section>
        </main>
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
