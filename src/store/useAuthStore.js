import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useUIStore } from './useUIStore.js'

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  settings: null,
  initialized: false,
  isLoading: false,
  error: null,

  /* ===========================
     INIT (dipanggil di App root)
     =========================== */
  init: async () => {
    try {
      // Load settings dulu (logo, nama sekolah, dsb)
      const settings = await get().loadSettings()

      const {
        data: { session }
      } = await supabase.auth.getSession()

      const user = session?.user ?? null
      let profile = null

      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (!error && data) {
          profile = data
        } else if (error) {
          console.error('Error loading profile on init:', error)
        }

        // Cek akun nonaktif (siswa/guru/admin)
        if (profile && profile.status === 'nonaktif') {
          await supabase.auth.signOut()

          let baseMessage = ''
          if (profile.role === 'guru') {
            baseMessage = 'Akun guru ini dinonaktifkan. Silakan hubungi administrator.'
          } else if (profile.role === 'siswa') {
            baseMessage =
              'Akun siswa ini dinonaktifkan. Silakan hubungi wali kelas atau admin.'
          } else {
            baseMessage = 'Akun ini dinonaktifkan. Silakan hubungi administrator.'
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

          return
        }
      }

      set({ user, profile, settings, initialized: true })
    } catch (err) {
      console.error('Init error:', err)
      set({
        user: null,
        profile: null,
        settings: null,
        initialized: true,
        error: err?.message || 'Gagal inisialisasi auth'
      })
    }
  },

  /* ===========================
     SETTINGS (logo, nama sekolah)
     =========================== */
  loadSettings: async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // tidak ada settings, kembalikan null saja
          return null
        }
        console.error('Error loading settings:', error)
        return null
      }

      return data
    } catch (error) {
      console.error('Failed to load settings:', error)
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
      // Clear session dulu biar bersih
      await supabase.auth.signOut()

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password
        })

      if (authError) {
        console.error('Login auth error:', authError)
        // Pesan error lebih ramah
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Email atau password salah')
        } else if (authError.message.includes('Email not confirmed')) {
          throw new Error('Email belum diverifikasi. Silakan cek email Anda.')
        } else {
          throw new Error(authError.message || 'Login gagal')
        }
      }

      const user = authData.user
      if (!user) throw new Error('User tidak ditemukan')

      // Ambil profil user
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileError) {
        console.error('Profile error:', profileError)
        throw new Error('Gagal memuat data profil')
      }

      // Blokir akun nonaktif
      if (profile.status === 'nonaktif') {
        let baseMessage = ''
        if (profile.role === 'guru') {
          baseMessage = 'Akun guru dinonaktifkan. Silahkan hubungi administrator.'
        } else if (profile.role === 'siswa') {
          baseMessage =
            'Akun siswa dinonaktifkan. Silahkan hubungi wali kelas atau admin.'
        } else {
          baseMessage = 'Akun ini dinonaktifkan. Silahkan hubungi administrator.'
        }

        const errorMessage = profile.alasan_nonaktif
          ? `${baseMessage} Alasan: ${profile.alasan_nonaktif}`
          : baseMessage

        // Logout lagi biar session bersih
        await supabase.auth.signOut()

        throw new Error(errorMessage)
      }

      // Load settings setelah login sukses
      const settings = await get().loadSettings()

      set({ user, profile, settings, error: null })
      pushToast('success', 'Login berhasil')

      return { user, profile }
    } catch (err) {
      console.error('Login catch error:', err)
      const errorMessage = err.message || 'Terjadi kesalahan saat login'
      set({ error: errorMessage })
      pushToast('error', errorMessage)
      return { error: errorMessage }
    } finally {
      set({ isLoading: false })
    }
  },

  /* ===========================
     REGISTER
     =========================== */
  register: async payload => {
    const { email, password, role, profile: profileData } = payload
    const { pushToast } = useUIStore.getState()

    set({ isLoading: true, error: null })

    try {
      if (!email || !password || !role || !profileData?.nama) {
        throw new Error('Data registrasi tidak lengkap')
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            role: role,
            nama: profileData.nama
          }
        }
      })

      if (error) {
        console.error('Signup error:', error)
        if (error.message.includes('User already registered')) {
          throw new Error('Email sudah terdaftar')
        }
        throw error
      }

      const user = data.user
      if (!user) throw new Error('User tidak ditemukan setelah registrasi')

      // Insert profile data
      const { error: errProfile } = await supabase.from('profiles').insert({
        id: user.id,
        email: email.trim().toLowerCase(),
        role: role,
        nama: profileData.nama,
        status: 'active', // default aktif
        jk: profileData.jk || null,
        telp: profileData.telp || null,
        alamat: profileData.alamat || null,
        kelas: profileData.kelas || null,
        usia: profileData.usia || null,
        nik: profileData.nik || null,
        agama: profileData.agama || null,
        jabatan: profileData.jabatan || null,
        created_at: new Date().toISOString()
      })

      if (errProfile) {
        console.error('Profile insert error:', errProfile)
        try {
          await supabase.auth.admin.deleteUser(user.id)
        } catch (e) {
          console.error('Cleanup deleteUser failed:', e)
        }
        throw new Error('Gagal membuat profil pengguna')
      }

      set({ error: null })
      pushToast('success', 'Registrasi berhasil! Silakan login.')

      return { user }
    } catch (err) {
      console.error('Register error:', err)
      const errorMessage = err.message || 'Registrasi gagal'
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
    try {
      await supabase.auth.signOut()
      set({ user: null, profile: null, error: null })
    } catch (err) {
      console.error('Logout error:', err)
    }
  },

  /* ===========================
     REFRESH PROFILE (misal setelah edit profile)
     =========================== */
  refreshProfile: async () => {
    const user = get().user
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!error && data) {
        // Cek lagi jika status berubah jadi nonaktif
        if (data.status === 'nonaktif') {
          const { pushToast } = useUIStore.getState()

          await supabase.auth.signOut()
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
      } else if (error) {
        console.error('Refresh profile error:', error)
      }
    } catch (err) {
      console.error('Refresh profile error (catch):', err)
    }
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
  }
}))
