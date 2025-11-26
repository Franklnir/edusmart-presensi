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

export default function APengaturan() {
  const { pushToast } = useUIStore()
  const { user, profile, logout } = useAuthStore()

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

  // Inisialisasi avatar URL
  useEffect(() => {
    if (profile) {
      const avatar = profile.photo_url || profile.avatar || profile.foto || ''
      setAvatarUrl(avatar)
    }
  }, [profile])

  // Load settings + RFID settings (sekali di awal)
  useEffect(() => {
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
  }, [pushToast])

  // Realtime update (kalau ada perubahan dari tab / user lain)
  useEffect(() => {
    if (!settingsId) return

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
  }, [settingsId])

  // Handle perubahan input teks
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // Auto-save (debounce 800ms) untuk field teks utama
  useEffect(() => {
    if (!settingsId) return

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

  // Handle checkbox registrasi (langsung simpan)
  async function handleCheckboxChange(e) {
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

  // Handle perubahan pengaturan RFID (langsung simpan)
  async function handleRfidChange(e) {
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

      const { error } = await supabase
        .from('absensi_rfid_settings')
        .upsert(payload)

      if (error) throw error

      pushToast('success', 'Pengaturan RFID berhasil diperbarui.')
    } catch (err) {
      console.error('Error saving RFID settings:', err)
      pushToast('error', 'Gagal menyimpan pengaturan RFID: ' + err.message)
    }
  }

  // Simpan settings umum
  async function saveSettings(showToast = false) {
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
      } else {
        console.log('Pengaturan berhasil disimpan otomatis')
      }
    } catch (err) {
      console.error('Error saving settings:', err)
      if (showToast) {
        pushToast('error', 'Gagal menyimpan: ' + err.message)
      }
    }
  }

  // Upload Logo
  async function handleLogoUpload() {
    if (!selectedLogoFile) return
    setUploadingLogo(true)
    try {
      const compressedFile = await compressImage(selectedLogoFile, 300)

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(LOGO_FILE_PATH, compressedFile, { upsert: true })

      if (uploadError) throw uploadError

      const {
        data: { publicUrl }
      } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(LOGO_FILE_PATH)

      setForm((prev) => ({ ...prev, logo_url: publicUrl }))

      if (settingsId) {
        const { error } = await supabase
          .from('settings')
          .update({
            logo_url: publicUrl,
            updated_at: new Date().toISOString()
          })
          .eq('id', settingsId)

        if (error) throw error
      }

      pushToast('success', 'Logo berhasil di-upload dan dikompresi!')
      setSelectedLogoFile(null)
    } catch (err) {
      console.error('Error uploading logo:', err)
      pushToast('error', 'Gagal upload logo: ' + err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  // Upload Foto Profil Admin
  async function handleAdminPhotoChange(file) {
    if (!file || !user?.id) return

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

      setAvatarUrl(publicUrl)

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          photo_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`user_avatar_${user.id}`, publicUrl)
        }
      }

      pushToast('success', 'Foto profil admin berhasil diperbarui dan dikompresi.')
    } catch (err) {
      console.error('Avatar upload error:', err)
      pushToast('error', 'Gagal upload foto profil: ' + err.message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Simpan manual (backup)
  async function onSave() {
    setSaving(true)
    await saveSettings(true)
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <span className="text-gray-600">Memuat pengaturan...</span>
        </div>
      </div>
    )
  }

  const localStorageAvatar =
    typeof window !== 'undefined' && user?.id
      ? localStorage.getItem(`user_avatar_${user.id}`)
      : null

  const finalAvatarUrl = avatarUrl || localStorageAvatar || profile?.photo_url || ''
  const displayName = profile?.nama || user?.email || 'Admin'
  const roleLabel = (profile?.role || 'admin').toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Pengaturan Sistem</h1>
          <p className="text-gray-600 mt-2">
            Kelola identitas sekolah, pengaturan registrasi, dan absensi RFID
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Kolom Kiri: Form Pengaturan */}
          <div className="lg:col-span-2 space-y-6">
            {/* Identitas Sekolah */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Identitas Sekolah</h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nama Sekolah
                  </label>
                  <input
                    type="text"
                    name="nama_sekolah"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={form.nama_sekolah}
                    onChange={handleChange}
                    placeholder="Masukkan nama sekolah"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email Sekolah
                    </label>
                    <input
                      type="email"
                      name="email"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={form.email}
                      onChange={handleChange}
                      placeholder="email@sekolah.example"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nomor Telepon
                    </label>
                    <input
                      type="tel"
                      name="telepon"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={form.telepon}
                      onChange={handleChange}
                      placeholder="+62 ..."
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Alamat Sekolah
                  </label>
                  <textarea
                    name="alamat"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                    rows="3"
                    value={form.alamat}
                    onChange={handleChange}
                    placeholder="Alamat lengkap sekolah"
                  ></textarea>
                </div>

                {/* Visi dan Misi */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Visi Sekolah
                    </label>
                    <textarea
                      name="visi"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      rows="4"
                      value={form.visi}
                      onChange={handleChange}
                      placeholder="Visi sekolah yang ingin dicapai"
                    ></textarea>
                    <p className="text-xs text-gray-500 mt-1">
                      Tuliskan visi sekolah yang inspiratif dan jelas
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Misi Sekolah
                    </label>
                    <textarea
                      name="misi"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      rows="4"
                      value={form.misi}
                      onChange={handleChange}
                      placeholder="Misi sekolah untuk mencapai visi"
                    ></textarea>
                    <p className="text-xs text-gray-500 mt-1">
                      Tuliskan misi sekolah secara detail dan terukur
                    </p>
                  </div>
                </div>

                {/* Media Sosial */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Media Sosial Sekolah
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center">
                          <svg
                            className="w-5 h-5 text-pink-500 mr-2"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.174-.105-.949-.199-2.403.042-3.441.219-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001.012.017z" />
                          </svg>
                          Instagram
                        </div>
                      </label>
                      <input
                        type="url"
                        name="link_instagram"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={form.link_instagram}
                        onChange={handleChange}
                        placeholder="https://instagram.com/username"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center">
                          <svg
                            className="w-5 h-5 text-blue-600 mr-2"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                          Facebook
                        </div>
                      </label>
                      <input
                        type="url"
                        name="link_facebook"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={form.link_facebook}
                        onChange={handleChange}
                        placeholder="https://facebook.com/username"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center">
                          <svg
                            className="w-5 h-5 text-red-600 mr-2"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                          </svg>
                          YouTube
                        </div>
                      </label>
                      <input
                        type="url"
                        name="link_youtube"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={form.link_youtube}
                        onChange={handleChange}
                        placeholder="https://youtube.com/c/username"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <div className="flex items-center">
                          <svg
                            className="w-5 h-5 text-black mr-2"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                          </svg>
                          TikTok
                        </div>
                      </label>
                      <input
                        type="url"
                        name="link_tiktok"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={form.link_tiktok}
                        onChange={handleChange}
                        placeholder="https://tiktok.com/@username"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Link media sosial akan ditampilkan di halaman publik sekolah
                  </p>
                </div>
              </div>
            </div>

            {/* Pengaturan Absensi RFID */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Pengaturan Absensi RFID</h2>

              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="text-sm text-blue-700">
                    <strong>Info:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>
                        • Jika fitur RFID aktif, siswa hanya bisa absen menggunakan kartu RFID dalam
                        rentang waktu yang ditentukan
                      </li>
                      <li>
                        • Jika fitur RFID non-aktif, siswa bisa absen mandiri (sesuai mode sistem)
                      </li>
                      <li>
                        • Di luar rentang waktu, siswa tidak bisa absen mandiri maupun RFID
                      </li>
                    </ul>
                  </div>
                </div>

                <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    name="rfid_aktif"
                    checked={rfidSettings.rfid_aktif}
                    onChange={handleRfidChange}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <span className="text-gray-900 font-medium">Aktifkan Fitur RFID Saja</span>
                    <p className="text-sm text-gray-500 mt-1">
                      Jika aktif, siswa hanya dapat absen dengan RFID dalam rentang waktu yang
                      ditentukan
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      rfidSettings.rfid_aktif ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {rfidSettings.rfid_aktif ? 'AKTIF' : 'NON-AKTIF'}
                  </div>
                </label>

                {rfidSettings.rfid_aktif && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Mulai Jam
                      </label>
                      <input
                        type="time"
                        name="rfid_mulai"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={normalizeTimeString(rfidSettings.rfid_mulai)}
                        onChange={handleRfidChange}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Selesai Jam
                      </label>
                      <input
                        type="time"
                        name="rfid_selesai"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={normalizeTimeString(rfidSettings.rfid_selesai)}
                        onChange={handleRfidChange}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-green-600 bg-green-50 p-2 rounded border border-green-200">
                        ✅ Pengaturan RFID tersimpan otomatis & realtime
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pengaturan Registrasi */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Pengaturan Registrasi Publik</h2>

              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="text-sm text-blue-700">
                    <strong>Info:</strong> Pengaturan ini akan langsung tersimpan otomatis ketika
                    diubah. Role yang tidak aktif akan disembunyikan di halaman registrasi publik.
                  </div>
                </div>

                <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    name="registrasi_siswa_aktif"
                    checked={form.registrasi_siswa_aktif}
                    onChange={handleCheckboxChange}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <span className="text-gray-900 font-medium">Aktifkan Registrasi Siswa</span>
                    <p className="text-sm text-gray-500 mt-1">
                      Siswa dapat membuat akun sendiri melalui halaman registrasi publik
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      form.registrasi_siswa_aktif
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {form.registrasi_siswa_aktif ? 'AKTIF' : 'NON-AKTIF'}
                  </div>
                </label>

                <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    name="registrasi_guru_aktif"
                    checked={form.registrasi_guru_aktif}
                    onChange={handleCheckboxChange}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <span className="text-gray-900 font-medium">Aktifkan Registrasi Guru</span>
                    <p className="text-sm text-gray-500 mt-1">
                      Guru dapat membuat akun sendiri melalui halaman registrasi publik
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      form.registrasi_guru_aktif
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {form.registrasi_guru_aktif ? 'AKTIF' : 'NON-AKTIF'}
                  </div>
                </label>

                <label className="flex items-center space-x-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    name="registrasi_admin_aktif"
                    checked={form.registrasi_admin_aktif}
                    onChange={handleCheckboxChange}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <span className="text-gray-900 font-medium">Aktifkan Registrasi Admin</span>
                    <p className="text-sm text-gray-500 mt-1">
                      Admin dapat membuat akun sendiri melalui halaman registrasi publik
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      form.registrasi_admin_aktif
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {form.registrasi_admin_aktif ? 'AKTIF' : 'NON-AKTIF'}
                  </div>
                </label>

                {form.registrasi_admin_aktif && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-700 font-medium">
                      ⚠️ PERINGATAN: Membuka pendaftaran admin untuk publik sangat berisiko. Hanya
                      aktifkan jika benar-benar diperlukan dan dalam lingkungan pengembangan.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Kolom Kanan: Sidebar */}
          <div className="space-y-6">
            {/* Profil Admin */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Profil Admin</h2>

              <div className="flex items-center space-x-4 mb-4">
                {finalAvatarUrl ? (
                  <img
                    src={finalAvatarUrl}
                    alt="Foto Profil"
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                  />
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

                <button
                  onClick={logout}
                  className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
                >
                  Logout
                </button>
              </div>
            </div>

            {/* Logo Sekolah */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Logo Sekolah</h2>

              <div className="flex justify-center mb-4">
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt="Logo Sekolah"
                    className="w-24 h-24 object-contain bg-gray-50 rounded-lg p-2 border border-gray-200"
                  />
                ) : (
                  <div className="w-24 h-24 flex items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 text-gray-400">
                    <div className="text-center">
                      <div className="text-lg">🏫</div>
                      <div className="text-xs mt-1">Belum ada logo</div>
                    </div>
                  </div>
                )}
              </div>

              <FileDropzone
                label="Pilih file logo"
                onFileSelected={setSelectedLogoFile}
                accept={{ 'image/*': ['.png', '.jpg', '.jpeg'] }}
                className="text-sm"
              />

              <button
                onClick={handleLogoUpload}
                disabled={!selectedLogoFile || uploadingLogo}
                className="w-full mt-3 bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {uploadingLogo ? 'Mengupload...' : 'Upload Logo'}
              </button>
              <p className="text-xs text-gray-500 text-center mt-2">
                Gambar akan dikompresi maksimal 300KB
              </p>
            </div>

            {/* Preview Visi Misi */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Preview Visi &amp; Misi</h2>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">Visi:</h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 min-h-[80px]">
                    {form.visi ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.visi}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">
                        Belum ada visi yang ditambahkan
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">Misi:</h3>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 min-h-[80px]">
                    {form.misi ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.misi}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">
                        Belum ada misi yang ditambahkan
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tombol Simpan (Backup Manual) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-green-700 text-center">
                  ✅ Semua pengaturan tersimpan otomatis & bisa disinkron realtime
                </p>
              </div>

              <button
                onClick={onSave}
                disabled={saving}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {saving ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Menyimpan...
                  </div>
                ) : (
                  'Simpan Manual (Backup)'
                )}
              </button>

              <p className="text-xs text-gray-500 text-center mt-2">
                Tombol backup untuk memastikan data tersimpan.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
