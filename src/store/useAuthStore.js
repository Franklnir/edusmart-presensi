// src/store/useAuthStore.js
import { create } from 'zustand'
import {
  clearAuthSessionHint,
  setAuthSessionHint,
  supabase
} from '../lib/supabase'
import { useUIStore } from './useUIStore'
import { logError } from '../utils/logger'
import { isValidRole } from '../utils/role'
import { hasRealLoginEmail, shouldForceAccountSetup } from '../utils/accountSetup'
import {
  DEFAULT_USER_THEME,
  normalizeUserTheme,
  withResolvedThemePreference,
  writeUserThemeLocal
} from '../theme/userThemes'

// Helper kecil biar konsisten
const normalizeEmail = (email) => email.trim().toLowerCase()
let authInitPromise = null
const SETTINGS_COLUMNS = 'id,nama_sekolah,logo_url,logo_path,admin_lock_enabled,updated_at'
const AUTH_SESSION_RETRY_ATTEMPTS = 5
const AUTH_SESSION_RETRY_DELAY_MS = 350
const GOOGLE_POPUP_SESSION_RETRY_ATTEMPTS = 24
const GOOGLE_POPUP_SESSION_RETRY_DELAY_MS = 700
const SESSION_NOT_READY_MESSAGE =
  'Sesi login belum siap. Tunggu sebentar lalu coba lagi.'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeRetryNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const readActiveAuthSession = async ({
  retryAttempts = AUTH_SESSION_RETRY_ATTEMPTS,
  retryDelayMs = AUTH_SESSION_RETRY_DELAY_MS
} = {}) => {
  const attempts = normalizeRetryNumber(retryAttempts, AUTH_SESSION_RETRY_ATTEMPTS)
  const delayMs = Math.max(0, Number(retryDelayMs) || 0)
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: sessionData, error: sessionError } = await supabase.auth.waitForSessionReady({
      attempts: 1,
      delayMs: 0
    })
    if (sessionError) {
      lastError = new Error(sessionError.message || 'Gagal memuat sesi login')
    } else {
      const session = sessionData?.session || null
      const user = session?.user || null
      const profile = withResolvedThemePreference(
        session?.profile || sessionData?.profile || null,
        session?.user?.id
      )

      if (user && profile) {
        return {
          sessionData,
          session,
          user,
          profile,
          settings: session?.settings || sessionData?.settings || null,
          hasSuperAdminBootstrap:
            sessionData?.superAdminChecked === true ||
            session?.superAdminChecked === true,
          bootstrapIsSuperAdmin: Boolean(
            sessionData?.isSuperAdmin || session?.isSuperAdmin
          )
        }
      }

      lastError = new Error(SESSION_NOT_READY_MESSAGE)
    }

    if (attempt < attempts - 1 && delayMs > 0) {
      await wait(delayMs)
    }
  }

  throw lastError || new Error(SESSION_NOT_READY_MESSAGE)
}

const uniqueProviders = (...lists) => {
  const providers = []
  lists.forEach((list) => {
    if (!Array.isArray(list)) return
    list.forEach((provider) => {
      const normalized = String(provider || '').trim().toLowerCase()
      if (normalized) providers.push(normalized)
    })
  })
  providers.push('google')
  return Array.from(new Set(providers))
}

const withGoogleLinkedUserState = (user) => {
  if (!user) return user

  const linkedAt = user.google_linked_at || new Date().toISOString()
  const verifiedAt =
    user.email_verified_at ||
    user.email_confirmed_at ||
    user.verified_at ||
    linkedAt
  const userMetadata = user.user_metadata || {}
  const appMetadata = user.app_metadata || {}
  const providers = uniqueProviders(
    user.providers,
    userMetadata.providers,
    appMetadata.providers
  )

  return {
    ...user,
    google_linked: true,
    google_linked_at: linkedAt,
    emailVerified: true,
    email_verified: true,
    email_verified_at: verifiedAt,
    email_confirmed_at: verifiedAt,
    providers,
    user_metadata: {
      ...userMetadata,
      google_linked: true,
      google_linked_at: linkedAt,
      email_verified: true,
      email_verified_at: verifiedAt,
      providers
    },
    app_metadata: {
      ...appMetadata,
      google_linked: true,
      providers
    }
  }
}

const buildProfilePayload = (user) => {
  const meta = user?.user_metadata || {}
  const role = meta.role || user?.app_metadata?.role
  if (!isValidRole(role)) return null

  const nama =
    meta.nama ||
    meta.name ||
    meta.full_name ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'User'

  const payload = {
    id: user.id,
    role,
    nama,
    status: 'active',
    created_via: 'manual_registration',
    created_at: new Date().toISOString()
  }

  if (user?.email) {
    payload.email = normalizeEmail(user.email)
  }

  return payload
}

const ensureProfile = async (user) => {
  if (!user?.id) return { error: new Error('User tidak valid') }

  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!error && data) {
    return { profile: withResolvedThemePreference(data, user.id) }
  }

  if (error && error.code === 'PGRST116') {
    const payload = buildProfilePayload(user)
    if (!payload) {
      return { error: new Error('Role pengguna tidak valid') }
    }

    const { error: insertError } = await supabase.from('profiles').insert(payload)
    if (insertError) return { error: insertError }

      ; ({ data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single())

    if (error) return { error }
    return { profile: withResolvedThemePreference(data, user.id) }
  }

  return { error }
}

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  settings: null,
  isSuperAdmin: false,
  superAdminChecked: false,
  initialized: false,
  isLoading: false,
  error: null,

  markGoogleLinked: () => {
    let nextUser = null
    set((state) => {
      nextUser = withGoogleLinkedUserState(state.user)
      return {
        user: nextUser,
        error: null
      }
    })
    return nextUser
  },

  /* ===========================
     INIT (dipanggil di root App)
     =========================== */
  init: async () => {
    if (get().initialized) {
      return {
        user: get().user,
        profile: get().profile,
        settings: get().settings
      }
    }

    if (authInitPromise) {
      return authInitPromise
    }

    authInitPromise = (async () => {
      try {
        const sessionRes = await supabase.auth.getSession()
        const sessionData = sessionRes?.data || {}

        const session = sessionData?.session || null
        const user = session?.user ?? null
        let profile = session?.profile || sessionData?.profile || null
        let settings = session?.settings || sessionData?.settings || null
        const hasSuperAdminBootstrap =
          sessionData?.superAdminChecked === true ||
          session?.superAdminChecked === true
        const bootstrapIsSuperAdmin = Boolean(
          sessionData?.isSuperAdmin || session?.isSuperAdmin
        )

        if (!user) {
          clearAuthSessionHint()
        }

        if (user && !profile) {
          const { profile: loadedProfile, error: profileError } = await ensureProfile(user)
          if (profileError) {
            logError('Error loading profile on init:', profileError)
            await supabase.auth.signOut()
            clearAuthSessionHint()
            set({
              user: null,
              profile: null,
              settings,
              isSuperAdmin: false,
              superAdminChecked: true,
              initialized: true,
              error: profileError?.message || 'Gagal memuat data profil'
            })
            return { user: null, profile: null, settings }
          }

          if (!isValidRole(loadedProfile?.role)) {
            await supabase.auth.signOut()
            clearAuthSessionHint()
            set({
              user: null,
              profile: null,
              settings,
              isSuperAdmin: false,
              superAdminChecked: true,
              initialized: true,
              error: 'Role pengguna tidak valid. Hubungi administrator.'
            })
            return { user: null, profile: null, settings }
          }

          profile = withResolvedThemePreference(loadedProfile, user.id)
        }

        if (user && !isValidRole(profile?.role)) {
          await supabase.auth.signOut()
          clearAuthSessionHint()
          set({
            user: null,
            profile: null,
            settings,
            isSuperAdmin: false,
            superAdminChecked: true,
            initialized: true,
            error: 'Role pengguna tidak valid. Hubungi administrator.'
          })
          return { user: null, profile: null, settings }
        }

        if (user) {
          // Blokir jika status nonaktif
          if (profile && profile.status === 'nonaktif') {
            await supabase.auth.signOut()
            clearAuthSessionHint()

            let baseMessage = ''
            if (profile.role === 'guru') {
              baseMessage =
                'Akun guru ini dinonaktifkan. Silakan hubungi administrator.'
            } else if (profile.role === 'siswa') {
              baseMessage =
                'Akun siswa ini dinonaktifkan. Silakan hubungi wali kelas atau admin.'
            } else {
              baseMessage =
                'Akun ini dinonaktifkan. Silakan hubungi administrator.'
            }

            const errorMessage = profile.alasan_nonaktif
              ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
              : baseMessage

            set({
              user: null,
              profile: null,
              settings,
              isSuperAdmin: false,
              superAdminChecked: true,
              initialized: true,
              error: errorMessage
            })

            return { user: null, profile: null, settings }
          }
        }

        profile = withResolvedThemePreference(profile, user?.id)

        if (user) {
          setAuthSessionHint(true)
        }

        if (user && profile?.role === 'admin' && !settings) {
          settings = await get().loadSettings()
        }

        set({
          user,
          profile,
          settings,
          isSuperAdmin: hasSuperAdminBootstrap ? bootstrapIsSuperAdmin : false,
          superAdminChecked: hasSuperAdminBootstrap || !user || profile?.role !== 'admin',
          initialized: true
        })

        if (user && !hasSuperAdminBootstrap) {
          void get().loadSuperAdmin(profile)
        }

        return {
          user,
          profile,
          settings
        }
      } catch (err) {
        logError('Init error:', err)
        clearAuthSessionHint()
        set({
          user: null,
          profile: null,
          settings: null,
          isSuperAdmin: false,
          superAdminChecked: true,
          initialized: true,
          error: err?.message || 'Gagal inisialisasi auth'
        })
        return { user: null, profile: null, settings: null }
      } finally {
        authInitPromise = null
      }
    })()

    return authInitPromise
  },

  /* ===========================
     SETTINGS (logo, nama sekolah)
     =========================== */
  loadSettings: async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select(SETTINGS_COLUMNS)
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // Tidak ada baris settings
          return null
        }
        logError('Error loading settings:', error)
        return null
      }

      return data
    } catch (error) {
      logError('Failed to load settings:', error)
      return null
    }
  },

  refreshSettings: async () => {
    const settings = await get().loadSettings()
    set({ settings })
    return settings
  },

  refreshAuthSession: async ({
    successMessage = '',
    successToastOptions = {},
    showErrorToast = true,
    logErrorOnFail = true,
    retryAttempts = AUTH_SESSION_RETRY_ATTEMPTS,
    retryDelayMs = AUTH_SESSION_RETRY_DELAY_MS
  } = {}) => {
    const { pushToast } = useUIStore.getState()

    try {
      const {
        user,
        profile,
        settings: sessionSettings,
        hasSuperAdminBootstrap,
        bootstrapIsSuperAdmin
      } = await readActiveAuthSession({
        retryAttempts,
        retryDelayMs
      })
      let settings = sessionSettings || get().settings || null

      if (!isValidRole(profile?.role)) {
        await supabase.auth.signOut()
        throw new Error('Role pengguna tidak valid. Hubungi administrator.')
      }

      if (profile.status === 'nonaktif') {
        const baseMessage = profile.role === 'guru'
          ? 'Akun guru dinonaktifkan. Silahkan hubungi administrator.'
          : profile.role === 'siswa'
            ? 'Akun siswa dinonaktifkan. Silahkan hubungi wali kelas atau admin.'
            : 'Akun ini dinonaktifkan. Silahkan hubungi administrator.'
        const errorMessage = profile.alasan_nonaktif
          ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
          : baseMessage

        await supabase.auth.signOut()
        throw new Error(errorMessage)
      }

      if (profile?.role === 'admin' && !settings) {
        settings = await get().loadSettings()
      }

      const accountSetupRequired = shouldForceAccountSetup(profile, user?.email)

      setAuthSessionHint(true)
      set({
        user,
        profile,
        settings,
        isSuperAdmin: hasSuperAdminBootstrap ? bootstrapIsSuperAdmin : false,
        superAdminChecked: hasSuperAdminBootstrap || profile?.role !== 'admin',
        error: null
      })
      if (!hasSuperAdminBootstrap) {
        void get().loadSuperAdmin(profile)
      }

      if (accountSetupRequired) {
        pushToast(
          'warning',
          'Anda harus mengganti password akun sekarang.',
          5000
        )
      }

      if (successMessage) {
        pushToast('success', successMessage, successToastOptions)
      }

      return { user, profile }
    } catch (err) {
      if (logErrorOnFail) logError('Refresh auth session error:', err)
      const errorMessage = err?.message || 'Gagal memuat sesi login'
      set({ error: errorMessage })
      if (showErrorToast) pushToast('error', errorMessage)
      return { error: errorMessage }
    }
  },

  /* ===========================
     LOGIN
     =========================== */
  login: async (email, password) => {
    const { pushToast } = useUIStore.getState()
    set({ isLoading: true, error: null })

    try {
      clearAuthSessionHint()
      await supabase.auth.signOut()

      const normalizedEmail = normalizeEmail(email)

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        })

      if (authError) {
        logError('Login auth error:', authError)

        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Email/NIS atau password salah')
        }
        if (authError.message.includes('Email not confirmed')) {
          throw new Error('Email belum diverifikasi. Silakan cek email Anda.')
        }

        throw new Error(authError.message || 'Login gagal')
      }

      const user = authData?.user
      if (!user) throw new Error('User tidak ditemukan')

      let profile = withResolvedThemePreference(authData?.profile, user.id);
      if (!profile) {
        const { profile: fetchedProfile, error: profileError } = await ensureProfile(user);
        if (profileError) {
          logError('Profile error:', profileError);
          await supabase.auth.signOut();
          throw new Error('Gagal memuat data profil');
        }
        profile = withResolvedThemePreference(fetchedProfile, user.id);
      }

      if (!isValidRole(profile?.role)) {
        await supabase.auth.signOut()
        throw new Error('Role pengguna tidak valid. Hubungi administrator.')
      }

      if (profile.status === 'nonaktif') {
        let baseMessage = ''
        if (profile.role === 'guru') {
          baseMessage =
            'Akun guru dinonaktifkan. Silahkan hubungi administrator.'
        } else if (profile.role === 'siswa') {
          baseMessage =
            'Akun siswa dinonaktifkan. Silahkan hubungi wali kelas atau admin.'
        } else {
          baseMessage =
            'Akun ini dinonaktifkan. Silahkan hubungi administrator.'
        }

        const errorMessage = profile.alasan_nonaktif
          ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
          : baseMessage

        await supabase.auth.signOut()
        throw new Error(errorMessage)
      }

      const settings = await get().loadSettings()

      const accountSetupRequired = shouldForceAccountSetup(profile, user?.email)

      setAuthSessionHint(true)
      set({ user, profile: withResolvedThemePreference(profile, user.id), settings, error: null })
      void get().loadSuperAdmin(profile)

      if (accountSetupRequired) {
        pushToast(
          'warning',
          'Anda harus mengganti password akun sekarang.',
          5000
        )
      }

      pushToast('success', 'Login berhasil')

      return { user, profile }
    } catch (err) {
      logError('Login catch error:', err)
      const errorMessage = err?.message || 'Terjadi kesalahan saat login'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  loginWithGoogleCode: async (code) => {
    const { pushToast } = useUIStore.getState()
    set({ isLoading: true, error: null })

    try {
      clearAuthSessionHint()
      await supabase.auth.signOut()

      const { data: authData, error: authError } = await supabase.auth.signInWithGoogleCode({
        code
      })

      if (authError) {
        throw new Error(authError.message || 'Login Google gagal')
      }

      const user = authData?.user
      const profile = withResolvedThemePreference(authData?.profile, user?.id)
      if (!user || !profile) {
        throw new Error('Data akun Google tidak lengkap')
      }

      if (!isValidRole(profile?.role)) {
        await supabase.auth.signOut()
        throw new Error('Role pengguna tidak valid. Hubungi administrator.')
      }

      if (profile.status === 'nonaktif') {
        let baseMessage = ''
        if (profile.role === 'guru') {
          baseMessage =
            'Akun guru dinonaktifkan. Silahkan hubungi administrator.'
        } else if (profile.role === 'siswa') {
          baseMessage =
            'Akun siswa dinonaktifkan. Silahkan hubungi wali kelas atau admin.'
        } else {
          baseMessage =
            'Akun ini dinonaktifkan. Silahkan hubungi administrator.'
        }

        const errorMessage = profile.alasan_nonaktif
          ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
          : baseMessage

        await supabase.auth.signOut()
        throw new Error(errorMessage)
      }

      const settings = await get().loadSettings()
      const accountSetupRequired = shouldForceAccountSetup(profile, user?.email)

      setAuthSessionHint(true)
      set({ user, profile, settings, error: null })
      void get().loadSuperAdmin(profile)

      if (accountSetupRequired) {
        pushToast(
          'warning',
          'Anda harus mengganti password akun sekarang.',
          5000
        )
      }

      pushToast('success', 'Login Google berhasil')

      return { user, profile }
    } catch (err) {
      logError('Login Google catch error:', err)
      const errorMessage = err?.message || 'Terjadi kesalahan saat login Google'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  loginWithGoogleCredential: async (credential) => {
    const { pushToast } = useUIStore.getState()
    set({ isLoading: true, error: null })

    try {
      clearAuthSessionHint()
      await supabase.auth.signOut()

      const { data: authData, error: authError } = await supabase.auth.signInWithGoogleCredential({
        credential
      })

      if (authError) {
        throw new Error(authError.message || 'Login Google gagal')
      }

      const user = authData?.user
      const profile = withResolvedThemePreference(authData?.profile, user?.id)
      if (!user || !profile) {
        throw new Error('Data akun Google tidak lengkap')
      }

      if (!isValidRole(profile?.role)) {
        await supabase.auth.signOut()
        throw new Error('Role pengguna tidak valid. Hubungi administrator.')
      }

      if (profile.status === 'nonaktif') {
        let baseMessage = ''
        if (profile.role === 'guru') {
          baseMessage =
            'Akun guru dinonaktifkan. Silahkan hubungi administrator.'
        } else if (profile.role === 'siswa') {
          baseMessage =
            'Akun siswa dinonaktifkan. Silahkan hubungi wali kelas atau admin.'
        } else {
          baseMessage =
            'Akun ini dinonaktifkan. Silahkan hubungi administrator.'
        }

        const errorMessage = profile.alasan_nonaktif
          ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
          : baseMessage

        await supabase.auth.signOut()
        throw new Error(errorMessage)
      }

      const settings = await get().loadSettings()
      const accountSetupRequired = shouldForceAccountSetup(profile, user?.email)

      setAuthSessionHint(true)
      set({ user, profile, settings, error: null })
      void get().loadSuperAdmin(profile)

      if (accountSetupRequired) {
        pushToast(
          'warning',
          'Anda harus mengganti password akun sekarang.',
          5000
        )
      }

      pushToast('success', 'Login Google berhasil')

      return { user, profile }
    } catch (err) {
      logError('Login Google credential catch error:', err)
      const errorMessage = err?.message || 'Terjadi kesalahan saat login Google'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  completeGooglePopupLogin: async () => {
    const { pushToast } = useUIStore.getState()
    set({ isLoading: true, error: null })

    try {
      clearAuthSessionHint()
      const result = await get().refreshAuthSession({
        successMessage: 'Login Google berhasil',
        showErrorToast: false,
        logErrorOnFail: false,
        retryAttempts: GOOGLE_POPUP_SESSION_RETRY_ATTEMPTS,
        retryDelayMs: GOOGLE_POPUP_SESSION_RETRY_DELAY_MS
      })

      if (!result?.error) {
        return result
      }

      const errorMessage =
        result?.error ||
        'Login Google belum selesai diproses. Tunggu beberapa detik lalu coba lagi.'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  linkGoogleCredential: async (credential) => {
    const { pushToast } = useUIStore.getState()
    const currentUser = get().user
    const currentProfile = get().profile
    const currentEmail = currentUser?.email || currentProfile?.email || ''

    if (currentProfile?.role === 'siswa' && currentProfile?.must_change_password) {
      const message = 'Ganti password akun terlebih dahulu sebelum menautkan Google.'
      set({ error: message })
      pushToast('info', message)
      return { error: message }
    }

    if (!hasRealLoginEmail(currentEmail)) {
      const message =
        'Email akun ini masih email buatan sistem. Ganti dulu ke email aktif yang sama dengan akun Google Anda sebelum menautkan Google.'
      set({ error: message })
      pushToast('info', message)
      return { error: message }
    }

    set({ isLoading: true, error: null })

    try {
      const { data: authData, error: authError } = await supabase.auth.linkGoogleCredential({
        credential
      })

      if (authError) {
        throw new Error(authError.message || 'Tautkan Google gagal')
      }

      const nextUser = authData?.user || get().user
      const nextProfile = withResolvedThemePreference(
        authData?.profile || get().profile,
        nextUser?.id
      )

      set({
        user: nextUser,
        profile: nextProfile,
        error: null
      })

      pushToast('success', 'Akun Google berhasil ditautkan', {
        title: 'Google Tertaut',
        duration: 5200
      })

      return {
        user: nextUser,
        profile: nextProfile
      }
    } catch (err) {
      logError('Link Google credential catch error:', err)
      const errorMessage = err?.message || 'Terjadi kesalahan saat menautkan Google'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  /* ===========================
     SESSION EXPIRED
     =========================== */
  expireSession: (message = 'Sesi login Anda telah berakhir. Silakan masuk lagi.') => {
    clearAuthSessionHint()
    set({
      user: null,
      profile: null,
      isLoading: false,
      isSuperAdmin: false,
      superAdminChecked: true,
      initialized: true,
      error: message
    })
  },

  /* ===========================
     REGISTER
     =========================== */
  register: async (payload) => {
    const { email, password, role, profile: profileData } = payload
    const { pushToast } = useUIStore.getState()

    set({ isLoading: true, error: null })

    try {
      // Validasi basic
      if (!email || !password || !role || !profileData?.nama) {
        throw new Error('Data registrasi tidak lengkap')
      }
      if (!isValidRole(role)) {
        throw new Error('Role tidak valid')
      }

      const normalizedEmail = normalizeEmail(email)

      // 1) Daftarkan user di Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            role,
            nama: profileData.nama
          }
        }
      })

      if (error) {
        logError('Signup error:', error)
        if (error.message.includes('User already registered')) {
          throw new Error('Email sudah terdaftar')
        }
        throw error
      }

      const user = data?.user
      if (!user) throw new Error('User tidak ditemukan setelah registrasi')

      // 2) Insert ke tabel profiles
      const { error: errProfile } = await supabase.from('profiles').insert({
        id: user.id,
        email: normalizedEmail,
        role,
        nama: profileData.nama,
        status: 'active',
        jk: profileData.jk || null,
        telp: profileData.telp || null,
        alamat: profileData.alamat || null,
        kelas: profileData.kelas || null,
        usia: profileData.usia || null,
        nis: profileData.nis || null,
        agama: profileData.agama || null,
        jabatan: profileData.jabatan || null,
        created_via: 'manual_registration',
        created_at: new Date().toISOString()
      })

      if (errProfile) {
        logError('Profile insert error:', errProfile)
        // Di client TIDAK boleh panggil auth.admin (butuh service role),
        // jadi di sini cukup lapor error saja.
        throw new Error('Gagal membuat profil pengguna')
      }

      set({ error: null })
      pushToast('success', 'Registrasi berhasil! Silakan login.')

      return { user }
    } catch (err) {
      logError('Register error:', err)
      const errorMessage = err?.message || 'Registrasi gagal'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  /* ===========================
     LOGOUT
     =========================== */
  logout: async () => {
    clearAuthSessionHint()
    try {
      await supabase.auth.signOut()
    } catch (err) {
      logError('Logout error:', err)
    } finally {
      set({
        user: null,
        profile: null,
        error: null,
        isSuperAdmin: false,
        superAdminChecked: false
      })
    }
  },

  /* ===========================
     REFRESH PROFILE
     =========================== */
  refreshProfile: async () => {
    const user = get().user
    if (!user) return

    try {
      const { profile: data, error } = await ensureProfile(user)

      if (!error && data) {
        if (!isValidRole(data.role)) {
          const { pushToast } = useUIStore.getState()
          await supabase.auth.signOut()
          clearAuthSessionHint()
          set({ user: null, profile: null })
          pushToast('error', 'Role pengguna tidak valid. Hubungi administrator.')
          return
        }

        if (data.status === 'nonaktif') {
          const { pushToast } = useUIStore.getState()

          await supabase.auth.signOut()
          clearAuthSessionHint()
          set({ user: null, profile: null })

          let msg =
            'Akun Anda dinonaktifkan. Silakan hubungi administrator.'
          if (data.role === 'siswa') {
            msg =
              'Akun siswa Anda dinonaktifkan. Silakan hubungi wali kelas atau admin.'
          } else if (data.role === 'guru') {
            msg =
              'Akun guru Anda dinonaktifkan. Silakan hubungi administrator.'
          }
          if (data.alasan_nonaktif) {
            msg += ` Alasan: ${data.alasan_nonaktif}`
          }

          pushToast('error', msg)
          return
        }

        set({ profile: withResolvedThemePreference(data, user.id) })
        void get().loadSuperAdmin(data)
      } else if (error) {
        logError('Refresh profile error:', error)
        const { pushToast } = useUIStore.getState()
        await supabase.auth.signOut()
        clearAuthSessionHint()
        set({ user: null, profile: null })
        pushToast('error', error?.message || 'Gagal memuat data profil')
      }
    } catch (err) {
      logError('Refresh profile error (catch):', err)
    }
  },

  /* ===========================
     SUPER ADMIN CHECK
     =========================== */
  loadSuperAdmin: async (profileOverride = null) => {
    const user = get().user
    if (!user) {
      set({ isSuperAdmin: false, superAdminChecked: true })
      return false
    }

    const profile = profileOverride || get().profile
    if (profile?.role && profile.role !== 'admin') {
      set({ isSuperAdmin: false, superAdminChecked: true })
      return false
    }

    try {
      const { data, error } = await supabase.super.me()
      if (!error && data?.is_super_admin) {
        set({ isSuperAdmin: true, superAdminChecked: true })
        return true
      }
    } catch (err) {
      logError('Super admin check failed:', err)
    }

    set({ isSuperAdmin: false, superAdminChecked: true })
    return false
  },

  /* ===========================
     Utility
     =========================== */
  clearError: () => set({ error: null }),

  updateThemePreference: async (themeId) => {
    const { pushToast } = useUIStore.getState()
    const user = get().user
    const profile = get().profile

    if (!user?.id || !profile) {
      const message = 'Sesi pengguna tidak ditemukan.'
      pushToast('error', message)
      return { error: message }
    }

    const nextTheme = normalizeUserTheme(themeId || DEFAULT_USER_THEME)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          theme_preference: nextTheme,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (error) throw error

      writeUserThemeLocal(user.id, nextTheme)
      const nextProfile = {
        ...profile,
        theme_preference: nextTheme,
        updated_at: new Date().toISOString()
      }
      set({ profile: nextProfile, error: null })
      pushToast('success', 'Tema berhasil diperbarui')
      return { profile: nextProfile }
    } catch (err) {
      const message = err?.message || 'Gagal menyimpan tema pengguna'
      logError('Update theme preference error:', err)

      if (/theme_preference/i.test(message)) {
        writeUserThemeLocal(user.id, nextTheme)
        const fallbackProfile = {
          ...profile,
          theme_preference: nextTheme
        }
        set({ profile: fallbackProfile, error: null })
        pushToast(
          'warning',
          'Kolom tema user belum ada di database. Tema diterapkan lokal dulu.'
        )
        return { profile: fallbackProfile, warning: 'db_column_missing' }
      }

      set({ error: message })
      pushToast('error', message)
      return { error: message }
    }
  },

  checkUserStatus: () => {
    const { user, profile } = get()
    if (!user || !profile) return null

    return {
      isGuru: profile.role === 'guru',
      isSiswa: profile.role === 'siswa',
      isAdmin: profile.role === 'admin',
      isActive: profile.status === 'active',
      isNonaktif: profile.status === 'nonaktif'
    }
  },

  /**
   * IDOR Guard (defense-in-depth):
   * Validasi bahwa resourceUserId milik user yang sedang login.
   * Gunakan sebelum operasi sensitif pada resource milik user.
   * @param {string} resourceUserId - ID pemilik resource
   * @param {string} [context] - Konteks untuk logging
   * @returns {boolean} true jika cocok, false jika mismatch
   */
  assertOwner: (resourceUserId, context = '') => {
    const { user } = get()
    if (!user?.id) {
      logError(`[IDOR] assertOwner: No user logged in. Context: ${context}`)
      return false
    }
    if (String(resourceUserId) !== String(user.id)) {
      logError(`[IDOR] assertOwner MISMATCH: expected=${user.id}, got=${resourceUserId}. Context: ${context}`)
      return false
    }
    return true
  }
}))
