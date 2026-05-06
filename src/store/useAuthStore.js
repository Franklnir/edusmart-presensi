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

// Helper kecil biar konsisten
const normalizeEmail = (email) => email.trim().toLowerCase()
let authInitPromise = null
const SETTINGS_COLUMNS = 'id,nama_sekolah,admin_lock_enabled,updated_at'

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

  if (!error && data) return { profile: data }

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
    return { profile: data }
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
        const [settings, sessionRes] = await Promise.all([
          get().loadSettings(),
          supabase.auth.getSession()
        ])

        const session = sessionRes?.data?.session || null
        const user = session?.user ?? null
        let profile = session?.profile || sessionRes?.data?.profile || null

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
              initialized: true,
              error: 'Role pengguna tidak valid. Hubungi administrator.'
            })
            return { user: null, profile: null, settings }
          }

          profile = loadedProfile
        }

        if (user && !isValidRole(profile?.role)) {
          await supabase.auth.signOut()
          clearAuthSessionHint()
          set({
            user: null,
            profile: null,
            settings,
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
              initialized: true,
              error: errorMessage
            })

            return { user: null, profile: null, settings }
          }
        }

        if (user) {
          setAuthSessionHint(true)
        }

        set({ user, profile, settings, initialized: true })
        void get().loadSuperAdmin(profile)

        return { user, profile, settings }
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

  /* ===========================
     LOGIN
     =========================== */
  login: async (email, password) => {
    const { pushToast } = useUIStore.getState()
    set({ isLoading: true, error: null })

    try {
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

      const { profile, error: profileError } = await ensureProfile(user)
      if (profileError) {
        logError('Profile error:', profileError)
        await supabase.auth.signOut()
        throw new Error('Gagal memuat data profil')
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
      await supabase.auth.signOut()

      const { data: authData, error: authError } = await supabase.auth.signInWithGoogleCode({
        code
      })

      if (authError) {
        throw new Error(authError.message || 'Login Google gagal')
      }

      const user = authData?.user
      const profile = authData?.profile
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
      await supabase.auth.signOut()

      const { data: authData, error: authError } = await supabase.auth.signInWithGoogleCredential({
        credential
      })

      if (authError) {
        throw new Error(authError.message || 'Login Google gagal')
      }

      const user = authData?.user
      const profile = authData?.profile
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
      const nextProfile = authData?.profile || get().profile

      set({
        user: nextUser,
        profile: nextProfile,
        error: null
      })

      pushToast('success', 'Akun Google berhasil ditautkan')

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

        set({ profile: data })
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
