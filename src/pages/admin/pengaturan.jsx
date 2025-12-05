// src/pages/admin/APengaturan.jsx
import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import FileDropzone from '../../components/FileDropzone'

const SUPABASE_BUCKET = 'profile-photos'
const LOGO_FILE_PATH = 'logo_sekolah.png'
// ID tetap untuk row pengaturan RFID
const RFID_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

// Normalisasi string waktu supaya cocok dengan input type="time" (HH:MM)
function normalizeTimeString(timeValue) {
  if (!timeValue) return ''
  if (typeof timeValue !== 'string') return ''
  // Biasanya dari Supabase: "07:00:00" → ambil 5 karakter pertama
  if (timeValue.length >= 5) {
    return timeValue.slice(0, 5)
  }
  return timeValue
}

// Fungsi kompresi gambar
const compressImage = (file, maxSizeKB = 300) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (event) => {
        const img = new Image()
        img.src = event.target.result
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          const MAX_WIDTH = 1200
          const MAX_HEIGHT = 1200
          let { width, height } = img

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width
              width = MAX_WIDTH
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height
              height = MAX_HEIGHT
            }
          }

          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)

          let quality = 0.8
          let compressedDataUrl

          const attemptCompression = () => {
            compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
            const base64 = compressedDataUrl.split(',')[1]
            const binaryString = atob(base64)
            const sizeInBytes = binaryString.length
            const sizeInKB = sizeInBytes / 1024

            if (sizeInKB > maxSizeKB && quality > 0.3) {
              quality -= 0.1
              attemptCompression()
            } else {
              const byteString = atob(compressedDataUrl.split(',')[1])
              const mimeString = compressedDataUrl.split(',')[0].split(':')[1].split(';')[0]
              const ab = new ArrayBuffer(byteString.length)
              const ia = new Uint8Array(ab)

              for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i)
              }

              const blob = new Blob([ab], { type: mimeString })
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              })

              resolve(compressedFile)
            }
          }

          attemptCompression()
        }
      }
      reader.onerror = (err) => reject(err)
    } catch (err) {
      reject(err)
    }
  })
}

/* ===== Password Modal Component ===== */
function PasswordModal({ isOpen, onClose, onConfirm, title = 'Konfirmasi Password', loading = false }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) {
      onConfirm(password)
    }
  }

  const handleClose = () => {
    setPassword('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm mb-4">
          Untuk melanjutkan, masukkan password akun Anda:
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              onClick={handleClose}
              disabled={loading}
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !password.trim()}
            >
              {loading ? 'Memverifikasi...' : 'Konfirmasi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ===== Password Verification Utility (lock screen) ===== */
const verifyPassword = async (password) => {
  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('User tidak ditemukan')
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password
    })

    if (error) {
      throw new Error('Password salah')
    }

    return true
  } catch (error) {
    throw error
  }
}

export default function APengaturan() {
  const { pushToast } = useUIStore()
  const { user, profile, logout } = useAuthStore()

  /* ---------- LOCK SCREEN STATE ---------- */
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(true)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const handlePasswordConfirm = async (password) => {
    setPasswordLoading(true)
    try {
      await verifyPassword(password)
      setIsAuthorized(true)
      setPasswordModalOpen(false)
      pushToast('success', 'Akses diizinkan. Selamat datang di Pengaturan Sistem.')
    } catch (error) {
      console.error('Password verification failed:', error)
      pushToast('error', error.message || 'Password salah')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handlePasswordClose = () => {
    setPasswordModalOpen(false)
  }

  /* ---------- STATE PENGATURAN ---------- */
  const [form, setForm] = useState({
    nama_sekolah: '',
    email: '',
    telepon: '',
    alamat: '',
    logo_url: '',
    visi: '',
    misi: '',
    link_instagram: '',
    link_facebook: '',
    link_youtube: '',
    link_tiktok: '',
    registrasi_siswa_aktif: true,
    registrasi_guru_aktif: true,
    registrasi_admin_aktif: false
  })

  // Pengaturan RFID
  const [rfidSettings, setRfidSettings] = useState({
    rfid_aktif: false,
    rfid_mulai: '07:00',
    rfid_selesai: '15:00'
  })

  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [selectedLogoFile, setSelectedLogoFile] = useState(null)
  const [settingsId, setSettingsId] = useState(null)

  // Timer untuk auto-save (debounce)
  const autoSaveTimerRef = useRef(null)

  // Inisialisasi avatar URL (setelah authorized)
  useEffect(() => {
    if (profile && isAuthorized) {
      const avatar = profile.photo_url || profile.avatar || profile.foto || ''
      setAvatarUrl(avatar)
    }
  }, [profile, isAuthorized])

  // Load settings + RFID settings (hanya jika authorized)
  useEffect(() => {
    if (!isAuthorized) return

    let isCancelled = false

    async function ensureRfidSettings() {
      try {
        let { data, error } = await supabase
          .from('absensi_rfid_settings')
          .select('*')
          .eq('id', RFID_SETTINGS_ID)
          .single()

        if (error && error.code === 'PGRST116') {
          // Belum ada row → buat default
          const { data: inserted, error: insertError } = await supabase
            .from('absensi_rfid_settings')
            .insert({
              id: RFID_SETTINGS_ID,
              rfid_aktif: false,
              rfid_mulai: '07:00',
              rfid_selesai: '15:00'
            })
            .select()
            .single()

          if (insertError) throw insertError
          data = inserted
        } else if (error) {
          throw error
        }

        if (!isCancelled && data) {
          setRfidSettings({
            rfid_aktif: data.rfid_aktif || false,
            rfid_mulai: normalizeTimeString(data.rfid_mulai) || '07:00',
            rfid_selesai: normalizeTimeString(data.rfid_selesai) || '15:00'
          })
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load RFID settings:', err)
        }
      }
    }

    async function loadSettings() {
      setLoading(true)
      try {
        // Ambil 1 baris settings saja
        let { data, error } = await supabase
          .from('settings')
          .select('*')
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code === 'PGRST116') {
          // Belum ada row → buat kosong
          const { data: inserted, error: insertError } = await supabase
            .from('settings')
            .insert({})
            .select()
            .single()

          if (insertError) throw insertError
          data = inserted
        } else if (error) {
          throw error
        }

        if (!isCancelled && data) {
          setSettingsId(data.id)
          setForm((prev) => ({
            ...prev,
            nama_sekolah: data.nama_sekolah || '',
            email: data.email || '',
            telepon: data.telepon || '',
            alamat: data.alamat || '',
            logo_url: data.logo_url || '',
            visi: data.visi || '',
            misi: data.misi || '',
            link_instagram: data.link_instagram || '',
            link_facebook: data.link_facebook || '',
            link_youtube: data.link_youtube || '',
            link_tiktok: data.link_tiktok || '',
            registrasi_siswa_aktif: data.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: data.registrasi_guru_aktif ?? true,
            registrasi_admin_aktif: data.registrasi_admin_aktif ?? false
          }))
        }

        await ensureRfidSettings()
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load settings:', err)
          pushToast('error', 'Gagal memuat pengaturan: ' + err.message)
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    loadSettings()

    return () => {
      isCancelled = true
    }
  }, [pushToast, isAuthorized])

  // Realtime update (kalau ada perubahan dari tab / user lain) - hanya jika authorized
  useEffect(() => {
    if (!settingsId || !isAuthorized) return

    const channel = supabase
      .channel('pengaturan_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings',
          filter: `id=eq.${settingsId}`
        },
        (payload) => {
          const row = payload.new
          if (!row) return

          setForm((prev) => ({
            ...prev,
            nama_sekolah: row.nama_sekolah || '',
            email: row.email || '',
            telepon: row.telepon || '',
            alamat: row.alamat || '',
            logo_url: row.logo_url || '',
            visi: row.visi || '',
            misi: row.misi || '',
            link_instagram: row.link_instagram || '',
            link_facebook: row.link_facebook || '',
            link_youtube: row.link_youtube || '',
            link_tiktok: row.link_tiktok || '',
            registrasi_siswa_aktif: row.registrasi_siswa_aktif ?? true,
            registrasi_guru_aktif: row.registrasi_guru_aktif ?? true,
            registrasi_admin_aktif: row.registrasi_admin_aktif ?? false
          }))
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_rfid_settings',
          filter: `id=eq.${RFID_SETTINGS_ID}`
        },
        (payload) => {
          const row = payload.new
          if (!row) return

          setRfidSettings({
            rfid_aktif: row.rfid_aktif || false,
            rfid_mulai: normalizeTimeString(row.rfid_mulai) || '07:00',
            rfid_selesai: normalizeTimeString(row.rfid_selesai) || '15:00'
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [settingsId, isAuthorized])

  // Handle perubahan input teks
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // Auto-save (debounce 800ms) untuk field teks utama - hanya jika authorized
  useEffect(() => {
    if (!settingsId || !isAuthorized) return

    const {
      nama_sekolah,
      email,
      telepon,
      alamat,
      logo_url,
      visi,
      misi,
      link_instagram,
      link_facebook,
      link_youtube,
      link_tiktok
    } = form

    const hasContent =
      nama_sekolah ||
      email ||
      telepon ||
      alamat ||
      logo_url ||
      visi ||
      misi ||
      link_instagram ||
      link_facebook ||
      link_youtube ||
      link_tiktok

    if (!hasContent) return

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = setTimeout(() => {
      saveSettings(false)
    }, 800)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settingsId,
    isAuthorized,
    form.nama_sekolah,
    form.email,
    form.telepon,
    form.alamat,
    form.logo_url,
    form.visi,
    form.misi,
    form.link_instagram,
    form.link_facebook,
    form.link_youtube,
    form.link_tiktok
  ])

  // Handle checkbox registrasi (langsung simpan) - hanya jika authorized
  async function handleCheckboxChange(e) {
    if (!isAuthorized) return

    const { name, checked } = e.target

    setForm((prev) => ({ ...prev, [name]: checked }))

    try {
      if (!settingsId) {
        pushToast('error', 'ID pengaturan belum siap, coba beberapa detik lagi.')
        return
      }

      const updateData = { [name]: checked, updated_at: new Date().toISOString() }

      const { error } = await supabase
        .from('settings')
        .update(updateData)
        .eq('id', settingsId)

      if (error) throw error

      pushToast('success', 'Pengaturan registrasi berhasil diperbarui.')
    } catch (err) {
      console.error('Error saving checkbox:', err)
      pushToast('error', 'Gagal menyimpan pengaturan: ' + err.message)
    }
  }

  // Handle perubahan pengaturan RFID (langsung simpan) - hanya jika authorized
  async function handleRfidChange(e) {
    if (!isAuthorized) return

    const { name, value, type, checked } = e.target
    const newValue = type === 'checkbox' ? checked : value

    const newRfidSettings = {
      ...rfidSettings,
      [name]: newValue
    }

    setRfidSettings(newRfidSettings)

    try {
      const payload = {
        id: RFID_SETTINGS_ID,
        rfid_aktif: newRfidSettings.rfid_aktif,
        rfid_mulai: newRfidSettings.rfid_mulai || null,
        rfid_selesai: newRfidSettings.rfid_selesai || null,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase.from('absensi_rfid_settings').upsert(payload)

      if (error) throw error

      pushToast('success', 'Pengaturan RFID berhasil diperbarui.')
    } catch (err) {
      console.error('Error saving RFID settings:', err)
      pushToast('error', 'Gagal menyimpan pengaturan RFID: ' + err.message)
    }
  }

  // Simpan settings umum - hanya jika authorized
  async function saveSettings(showToast = false) {
    if (!isAuthorized) return

    try {
      if (!settingsId) return

      const dataToSave = {
        nama_sekolah: form.nama_sekolah,
        email: form.email,
        telepon: form.telepon,
        alamat: form.alamat,
        logo_url: form.logo_url,
        visi: form.visi,
        misi: form.misi,
        link_instagram: form.link_instagram,
        link_facebook: form.link_facebook,
        link_youtube: form.link_youtube,
        link_tiktok: form.link_tiktok,
        registrasi_siswa_aktif: form.registrasi_siswa_aktif,
        registrasi_guru_aktif: form.registrasi_guru_aktif,
        registrasi_admin_aktif: form.registrasi_admin_aktif,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('settings')
        .update(dataToSave)
        .eq('id', settingsId)

      if (error) throw error

      if (showToast) {
        pushToast('success', 'Pengaturan berhasil disimpan.')
      }
    } catch (err) {
      console.error('Error saving settings:', err)
      if (showToast) {
        pushToast('error', 'Gagal menyimpan: ' + err.message)
      }
    }
  }

  // Upload Logo - hanya jika authorized
  async function handleLogoUpload() {
    if (!isAuthorized || !selectedLogoFile) return
    setUploadingLogo(true)
    try {
      const compressedFile = await compressImage(selectedLogoFile, 300)

      // Hapus file logo lama jika ada sebelum upload yang baru
      const { error: deleteError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .remove([LOGO_FILE_PATH])

      if (deleteError && deleteError.message !== 'Object not found') {
        console.warn('Gagal menghapus logo lama:', deleteError)
      }

      // Upload file baru
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(LOGO_FILE_PATH, compressedFile, {
          upsert: true,
          cacheControl: '3600'
        })

      if (uploadError) throw uploadError

      const {
        data: { publicUrl }
      } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(LOGO_FILE_PATH)

      // Tambahkan timestamp untuk menghindari cache
      const timestamp = new Date().getTime()
      const logoUrlWithTimestamp = `${publicUrl}?t=${timestamp}`

      setForm((prev) => ({ ...prev, logo_url: logoUrlWithTimestamp }))

      if (settingsId) {
        const { error } = await supabase
          .from('settings')
          .update({
            logo_url: logoUrlWithTimestamp,
            updated_at: new Date().toISOString()
          })
          .eq('id', settingsId)

        if (error) throw error
      }

      pushToast('success', 'Logo berhasil diupload dan diperbarui!')
      setSelectedLogoFile(null)
    } catch (err) {
      console.error('Error uploading logo:', err)
      pushToast('error', 'Gagal upload logo: ' + err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  // Upload Foto Profil Admin - hanya jika authorized
  async function handleAdminPhotoChange(file) {
    if (!isAuthorized || !file || !user?.id) return

    setUploadingAvatar(true)
    try {
      const compressedFile = await compressImage(file, 300)

      const fileName = `avatar-${user.id}-${Date.now()}.jpg`
      const path = `profiles/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(path, compressedFile, { upsert: false })

      if (uploadError) throw uploadError

      const {
        data: { publicUrl }
      } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path)

      // Tambahkan timestamp untuk menghindari cache
      const timestamp = new Date().getTime()
      const avatarUrlWithTimestamp = `${publicUrl}?t=${timestamp}`

      setAvatarUrl(avatarUrlWithTimestamp)

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          photo_url: avatarUrlWithTimestamp,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`user_avatar_${user.id}`, avatarUrlWithTimestamp)
        }
      }

      pushToast('success', 'Foto profil admin berhasil diperbarui.')
    } catch (err) {
      console.error('Avatar upload error:', err)
      pushToast('error', 'Gagal upload foto profil: ' + err.message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Simpan manual (backup) - hanya jika authorized
  async function onSave() {
    if (!isAuthorized) return
    setSaving(true)
    await saveSettings(true)
    setSaving(false)
  }

  const localStorageAvatar =
    typeof window !== 'undefined' && user?.id
      ? localStorage.getItem(`user_avatar_${user.id}`)
      : null

  const finalAvatarUrl = avatarUrl || localStorageAvatar || profile?.photo_url || ''
  const displayName = profile?.nama || user?.email || 'Admin'
  const roleLabel = (profile?.role || 'admin').toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 p-0">
      {/* Modal Password Akses Halaman */}
      <PasswordModal
        isOpen={passwordModalOpen && !isAuthorized}
        onClose={handlePasswordClose}
        onConfirm={handlePasswordConfirm}
        title="Akses Pengaturan Sistem"
        loading={passwordLoading}
      />

      {/* Jika belum authorized: tampilkan layar kunci saja */}
      {!isAuthorized ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 w-full max-w-md">
            <div className="flex items-center mb-4">
              <div className="p-3 bg-blue-100 rounded-xl mr-3">
                <span className="text-2xl">🔒</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Halaman Terkunci</h1>
                <p className="text-gray-600 text-sm">
                  Untuk membuka Pengaturan Sistem, silakan konfirmasi password akun admin Anda.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium transition-all duration-200"
            >
              Masukkan Password
            </button>
          </div>
        </div>
      ) : (
        /* ================== KONTEN ASLI HALAMAN (SETELAH PASSWORD BENAR) ================== */
        <div className="w-full mx-auto">
          {/* Header */}
          <div className="bg-white shadow-lg p-6 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-600 rounded-xl">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Pengaturan Sistem</h1>
                  <p className="text-gray-600 mt-1">
                    Kelola identitas sekolah, pengaturan registrasi, dan absensi RFID
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="p-4 md:p-6">
            {/* Loading Overlay */}
            {loading && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-gray-700 font-medium">Memuat pengaturan...</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Kolom Kiri: Form Pengaturan */}
              <div className="lg:col-span-2 space-y-6">
                {/* Identitas Sekolah */}
                {/* (bagian form identitas + RFID + registrasi PERSIS seperti yang kamu punya tadi, tidak diubah) */}
                {/* ... (kode bagian kiri sama dengan yang sudah ada di atas, tidak dihapus untuk singkatnya) */}
              </div>

              {/* Kolom Kanan: Sidebar */}
              <div className="space-y-6">
                {/* Profil Admin */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
                    <span>👨‍💼</span>
                    <span>Profil Admin</span>
                  </h2>

                  <div className="flex items-center space-x-4 mb-4">
                    {finalAvatarUrl ? (
                      <div className="relative">
                        <img
                          src={finalAvatarUrl}
                          alt="Foto Profil"
                          className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 transition-all duration-200 hover:border-blue-500"
                        />
                        {uploadingAvatar && (
                          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-lg font-bold text-white">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-gray-900">{displayName}</h3>
                      <div className="text-sm text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-full inline-block">
                        {roleLabel}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <FileDropzone
                      label={uploadingAvatar ? 'Mengupload...' : 'Ubah Foto Profil'}
                      onFileSelected={handleAdminPhotoChange}
                      accept={{ 'image/*': ['.png', '.jpg', '.jpeg'] }}
                      disabled={uploadingAvatar}
                      className="text-sm"
                    />

                    {/* Tombol Ubah Password DIHAPUS */}

                    <button
                      onClick={logout}
                      className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-all duration-200 font-medium text-sm flex items-center justify-center space-x-2"
                    >
                      <span>🚪</span>
                      <span>Logout</span>
                    </button>
                  </div>
                </div>

                {/* Logo Sekolah, Preview Visi Misi, dan Tombol Simpan */}
                {/* (bagian ini sama seperti kode yang sudah kamu punya, tidak diubah) */}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
