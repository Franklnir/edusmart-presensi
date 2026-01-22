// src/pages/siswa/EditProfile.jsx
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

// ==================== STORAGE CONFIG ====================
const PROFILE_BUCKET = 'profile-photos'
const SIGNED_URL_EXPIRES_IN = 60 * 60 // 1 jam (aman, jangan simpan signed-url ke DB)

// ObjectKey yang aman dan konsisten (anti IDOR + gampang dipolicy)
const makeAvatarObjectKey = (uid) => `profiles/${uid}/avatar.jpg`

const addCacheBuster = (url) => {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

const isProbablyUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value)

// ==================== HELPER FUNCTIONS ====================

async function compressImageToMaxBytes(file, maxBytes = 100 * 1024) {
  if (!file) throw new Error('File tidak ada')
  if (file.size <= maxBytes) return file

  // Baca file ke DataURL
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'))
    reader.readAsDataURL(file)
  })

  // Load gambar
  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gagal memuat gambar'))
    image.src = dataUrl
  })

  // Canvas resize
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  const MAX_DIMENSION = 800
  let { width, height } = img

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(1, MAX_DIMENSION / Math.max(width, height))
    width = Math.floor(width * ratio)
    height = Math.floor(height * ratio)
  }

  canvas.width = width
  canvas.height = height

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)

  // Progressive compression
  let quality = 0.85
  const minQuality = 0.4
  const step = 0.08

  let blob = null
  while (quality >= minQuality) {
    // eslint-disable-next-line no-await-in-loop
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) break
    if (blob.size <= maxBytes) break
    quality -= step
  }

  if (!blob) return file

  const safeBaseName = (file.name || 'photo').replace(/\.\w+$/, '').slice(0, 60)
  return new File([blob], `${safeBaseName}_${Date.now()}.jpg`, { type: 'image/jpeg' })
}

const formatKelasDisplay = (slug) => {
  if (!slug || typeof slug !== 'string') return ''
  try {
    return slug
      .split('-')
      .map((part) => {
        if (part.toLowerCase() === 'x') return 'X'
        if (part.toLowerCase() === 'xi') return 'XI'
        if (part.toLowerCase() === 'xii') return 'XII'

        const jurusanMap = {
          ipa: 'IPA',
          ips: 'IPS',
          bahasa: 'Bahasa',
          agama: 'Agama',
          tkj: 'TKJ',
          rpl: 'RPL',
          mm: 'Multimedia',
          akuntansi: 'Akuntansi'
        }
        return jurusanMap[part.toLowerCase()] || part.toUpperCase()
      })
      .join(' ')
  } catch {
    return slug
  }
}

const validatePhoneNumber = (phone, fieldName = 'Nomor HP') => {
  if (!phone) return ''
  let cleanPhone = phone

  if (phone.startsWith('+')) cleanPhone = '+' + phone.slice(1).replace(/\D/g, '')
  else cleanPhone = phone.replace(/\D/g, '')

  const digitsOnly = cleanPhone.replace('+', '').replace(/^62/, '')
  if (digitsOnly.length > 14) return `${fieldName} maksimal 14 digit (tidak termasuk kode negara)`

  const indonesianPhoneRegex = /^(?:\+?62|0)(?:\d{8,13})$/
  const testNumber = cleanPhone.startsWith('+62') ? cleanPhone.slice(1) : cleanPhone
  if (!indonesianPhoneRegex.test(testNumber)) {
    return `${fieldName} tidak valid. Contoh: 081234567890 atau +6281234567890`
  }
  return ''
}

const formatPhoneDisplay = (phone) => {
  if (!phone) return '-'
  const clean = phone.replace(/\D/g, '')
  if (clean.startsWith('62')) {
    const operator = clean.slice(2, 4)
    const a = clean.slice(4, 8)
    const b = clean.slice(8)
    return `+62 ${operator}-${a}-${b}`
  }
  if (clean.startsWith('0') && clean.length >= 10) {
    const operator = clean.slice(1, 4)
    const a = clean.slice(4, 8)
    const b = clean.slice(8)
    return `0${operator}-${a}-${b}`
  }
  return phone
}

const formatPhoneInput = (value) => {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.startsWith('0')) return digits.length > 15 ? digits.slice(0, 15) : digits
  if (digits.startsWith('62')) return '+' + (digits.length > 14 ? digits.slice(0, 14) : digits)
  return digits.length > 14 ? digits.slice(0, 14) : digits
}

// ==================== MAIN COMPONENT ====================

export default function EditProfile() {
  const { user, profile, logout, refreshProfile } = useAuthStore()
  const { pushToast } = useUIStore()

  const fileInputRef = useRef(null)

  // Form
  const [form, setForm] = useState({
    nama: '',
    jk: '',
    nik: '',
    usia: '',
    kelas: '',
    no_hp_siswa: '',
    no_hp_wali: ''
  })

  const [originalForm, setOriginalForm] = useState({})
  const [isFormDirty, setIsFormDirty] = useState(false)

  // Validations
  const [namaError, setNamaError] = useState('')
  const [noHpSiswaError, setNoHpSiswaError] = useState('')
  const [noHpWaliError, setNoHpWaliError] = useState('')

  // Kelas logic
  const [kelasList, setKelasList] = useState([])
  const [isLoadingKelas, setIsLoadingKelas] = useState(false)
  const [showKelasWarning, setShowKelasWarning] = useState(false)
  const [newKelas, setNewKelas] = useState('')
  const [originalKelas, setOriginalKelas] = useState('')
  const [kelasChangeUsed, setKelasChangeUsed] = useState(false)

  // Photo states (DB simpan PATH saja)
  const [photoPath, setPhotoPath] = useState('') // objectKey (ideal)
  const [photoURL, setPhotoURL] = useState('')   // signed url (UI only)
  const [preview, setPreview] = useState('')     // UI preview (local or signed)
  const [imgBroken, setImgBroken] = useState(false)

  // UI states
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [sendingVerify, setSendingVerify] = useState(false)
  const [progressText, setProgressText] = useState('')

  const email = user?.email || profile?.email || ''
  const emailVerified = !!(user?.email_confirmed_at || user?.emailVerified)

  // ==================== DATA LOAD ====================

  const loadKelasList = async () => {
    try {
      setIsLoadingKelas(true)
      const { data, error } = await supabase
        .from('kelas')
        .select('id, nama, grade, suffix')
        .order('grade', { ascending: true })
        .order('suffix', { ascending: true })
        .limit(100)

      if (error) throw error

      const formatted = (data || []).map((k) => ({
        id: k.id,
        nama: k.nama || formatKelasDisplay(k.id),
        slug: k.id,
        grade: k.grade,
        suffix: k.suffix
      }))

      formatted.sort((a, b) => {
        const gradeOrder = { X: 1, XI: 2, XII: 3 }
        const ga = gradeOrder[a.grade] || 99
        const gb = gradeOrder[b.grade] || 99
        if (ga !== gb) return ga - gb
        return (a.suffix || '').localeCompare(b.suffix || '')
      })

      setKelasList(formatted)
    } catch {
      pushToast('error', 'Gagal memuat daftar kelas. Silakan refresh halaman.')
    } finally {
      setIsLoadingKelas(false)
    }
  }

  // Ambil path foto dari profile (support legacy URL lama juga)
  const extractStoredPhotoValue = () => {
    // prioritas: photo_path -> photo_url (tapi isinya boleh path atau url legacy)
    const v = profile?.photo_path || profile?.photo_url || ''
    return typeof v === 'string' ? v : ''
  }

  const getSignedUrlFromPath = async (objectKey) => {
    if (!objectKey) return ''
    const { data, error } = await supabase.storage
      .from(PROFILE_BUCKET)
      .createSignedUrl(objectKey, SIGNED_URL_EXPIRES_IN)

    if (error) throw error
    return data?.signedUrl ? addCacheBuster(data.signedUrl) : ''
  }

  // Update DB: simpan PATH saja (anti IDOR dibantu policy + trigger)
  const updateProfilePhotoPathInDb = async (uid, objectKeyOrNull) => {
    const payload = {
      photo_path: objectKeyOrNull,
      updated_at: new Date().toISOString()
    }

    // Coba pakai photo_path dulu
    let { error } = await supabase.from('profiles').update(payload).eq('id', uid)

    // Kalau kolom photo_path belum ada, fallback ke photo_url tapi isinya PATH (bukan URL)
    if (error && /column .*photo_path.* does not exist/i.test(error.message || '')) {
      const fallbackPayload = {
        photo_url: objectKeyOrNull,
        updated_at: new Date().toISOString()
      }
      ;({ error } = await supabase.from('profiles').update(fallbackPayload).eq('id', uid))
    }

    if (error) throw error
  }

  // ==================== EFFECTS ====================

  useEffect(() => {
    // load kelas list
    loadKelasList()

    // warn before unload kalau ada perubahan
    const handleBeforeUnload = (e) => {
      if (isFormDirty) {
        e.preventDefault()
        e.returnValue = 'Anda memiliki perubahan yang belum disimpan. Yakin ingin meninggalkan halaman?'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!profile) return

    const initialForm = {
      nama: profile.nama || '',
      jk: profile.jk || '',
      nik: profile.nik || '',
      usia: profile.usia || '',
      kelas: profile.kelas || '',
      no_hp_siswa: profile.no_hp_siswa || '',
      no_hp_wali: profile.no_hp_wali || ''
    }

    setForm(initialForm)
    setOriginalForm(initialForm)
    setIsFormDirty(false)

    setOriginalKelas(profile.kelas || '')
    setKelasChangeUsed(!!profile.kelas_change_used)

    // foto: simpan path/url legacy dari DB
    const stored = extractStoredPhotoValue()
    setPhotoPath(stored)
    setImgBroken(false)
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve photoPath -> photoURL (signed url) untuk display.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const stored = photoPath || ''
      if (!stored) {
        setPhotoURL('')
        setPreview('')
        return
      }

      // Legacy: kalau DB masih keburu nyimpan URL lama, kita tetap tampilkan.
      if (isProbablyUrl(stored)) {
        const u = addCacheBuster(stored)
        if (!cancelled) {
          setPhotoURL(u)
          setPreview(u)
        }
        return
      }

      // stored adalah objectKey/path
      try {
        const signed = await getSignedUrlFromPath(stored)
        if (!cancelled) {
          setPhotoURL(signed)
          setPreview(signed)
        }
      } catch {
        if (!cancelled) {
          // kalau gagal signed-url, set broken supaya fallback avatar muncul
          setPhotoURL('')
          setPreview('')
          setImgBroken(true)
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [photoPath])

  // ==================== FORM HANDLERS ====================

  const handleKelasChange = (value) => {
    // UI helper saja. Enforcement real tetap di trigger DB.
    if (kelasChangeUsed && originalKelas && value !== originalKelas) {
      pushToast('error', 'Kelas hanya bisa diubah satu kali. Hubungi admin jika ada kesalahan.', 5000)
      return
    }

    if (originalKelas && value !== originalKelas) {
      setNewKelas(value)
      setShowKelasWarning(true)
      return
    }

    const newForm = { ...form, kelas: value }
    setForm(newForm)
    setIsFormDirty(JSON.stringify(newForm) !== JSON.stringify(originalForm))
  }

  const handleFieldChange = (key, value) => {
    let processedValue = value

    switch (key) {
      case 'nama': {
        const namaRegex = /^[a-zA-Z\s.'-]+$/
        if (value && !namaRegex.test(value)) {
          setNamaError('Nama hanya boleh mengandung huruf, spasi, titik, apostrof, dan tanda hubung')
        } else setNamaError('')
        break
      }
      case 'no_hp_siswa': {
        processedValue = formatPhoneInput(value)
        setNoHpSiswaError(validatePhoneNumber(processedValue, 'Nomor HP Siswa'))
        break
      }
      case 'no_hp_wali': {
        processedValue = formatPhoneInput(value)
        setNoHpWaliError(validatePhoneNumber(processedValue, 'Nomor HP Wali'))
        break
      }
      case 'usia': {
        if (value) {
          const age = parseInt(value, 10)
          if (Number.isFinite(age) && (age < 10 || age > 30)) {
            pushToast('warning', 'Usia harus antara 10-30 tahun')
          }
        }
        break
      }
      case 'kelas': {
        handleKelasChange(value)
        return
      }
      default:
        break
    }

    const newForm = { ...form, [key]: processedValue }
    setForm(newForm)
    setIsFormDirty(JSON.stringify(newForm) !== JSON.stringify(originalForm))
  }

  const confirmKelasChange = () => {
    const newForm = { ...form, kelas: newKelas }
    setForm(newForm)
    setShowKelasWarning(false)
    setKelasChangeUsed(true)
    setOriginalKelas(newKelas)
    setIsFormDirty(true)
    setNewKelas('')

    pushToast('warning', 'Perubahan kelas diproses. Pastikan cek ulang data absensi dan tugas.', 4000)
  }

  const cancelKelasChange = () => {
    setNewKelas('')
    setShowKelasWarning(false)
    const newForm = { ...form, kelas: originalKelas || '' }
    setForm(newForm)
    setIsFormDirty(JSON.stringify(newForm) !== JSON.stringify(originalForm))
  }

  // ==================== PHOTO UPLOAD (PATH ONLY) ====================

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    setUploadingPhoto(true)
    setProgressText('Memproses gambar...')
    setImgBroken(false)

    let localPreviewUrl = ''
    try {
      if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar (JPEG/PNG/dll).')

      const MAX_FILE_SIZE = 10 * 1024 * 1024
      if (file.size > MAX_FILE_SIZE) throw new Error('Ukuran file terlalu besar. Maksimal 10MB.')

      setProgressText('Mengkompresi gambar...')
      let compressed = file
      try {
        compressed = await compressImageToMaxBytes(file, 100 * 1024)
      } catch {
        // kalau kompres gagal, lanjut pakai file asli
        compressed = file
      }

      // preview lokal
      localPreviewUrl = URL.createObjectURL(compressed)
      setPreview(localPreviewUrl)

      setProgressText('Mengupload ke server...')

      // Upload dengan objectKey yang fixed: anti IDOR + gampang RLS
      const objectKey = makeAvatarObjectKey(user.id)

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_BUCKET)
        .upload(objectKey, compressed, {
          upsert: true,
          cacheControl: '3600',
          contentType: 'image/jpeg'
        })

      if (uploadError) throw new Error(`Upload gagal: ${uploadError.message}`)

      // DB simpan PATH saja
      await updateProfilePhotoPathInDb(user.id, objectKey)

      // Signed URL untuk UI
      const signed = await getSignedUrlFromPath(objectKey)
      setPhotoPath(objectKey)
      setPhotoURL(signed)
      setPreview(signed)

      await refreshProfile()

      pushToast('success', `Foto profil berhasil diperbarui (${(compressed.size / 1024).toFixed(1)}KB)`)
    } catch (err) {
      pushToast('error', `Gagal upload foto: ${err.message || 'Terjadi kesalahan'}`)
      // revert preview ke foto yang ada
      setPreview(photoURL || '')
    } finally {
      setUploadingPhoto(false)
      setProgressText('')

      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeletePhoto = async () => {
    if (!user?.id) return
    const ok = window.confirm('Apakah Anda yakin ingin menghapus foto profil?')
    if (!ok) return

    setUploadingPhoto(true)
    setProgressText('Menghapus foto...')
    try {
      const stored = photoPath || ''
      // kalau stored itu path, kita hapus dari storage
      if (stored && !isProbablyUrl(stored)) {
        await supabase.storage.from(PROFILE_BUCKET).remove([stored])
      }

      await updateProfilePhotoPathInDb(user.id, null)

      setPhotoPath('')
      setPhotoURL('')
      setPreview('')
      setImgBroken(false)

      await refreshProfile()
      pushToast('success', 'Foto profil berhasil dihapus')
    } catch (err) {
      pushToast('error', err.message || 'Gagal menghapus foto profil')
    } finally {
      setUploadingPhoto(false)
      setProgressText('')
    }
  }

  // ==================== SAVE PROFILE ====================

  const validateForm = () => {
    if (!form.nama.trim()) return pushToast('error', 'Nama lengkap harus diisi') || false
    if (!form.jk) return pushToast('error', 'Jenis kelamin harus dipilih') || false
    if (!form.kelas) return pushToast('error', 'Kelas harus dipilih') || false

    const namaRegex = /^[a-zA-Z\s.'-]+$/
    if (form.nama && !namaRegex.test(form.nama)) {
      return pushToast('error', 'Nama hanya boleh mengandung huruf, spasi, titik, apostrof, dan tanda hubung') || false
    }

    if (noHpSiswaError) return pushToast('error', `Nomor HP Siswa: ${noHpSiswaError}`) || false
    if (noHpWaliError) return pushToast('error', `Nomor HP Wali: ${noHpWaliError}`) || false

    if (form.usia) {
      const age = parseInt(form.usia, 10)
      if (!Number.isFinite(age) || age < 10 || age > 30) {
        return pushToast('error', 'Usia harus antara 10-30 tahun') || false
      }
    }

    return true
  }

  const handleSaveProfile = async () => {
    if (!user?.id) return
    if (!validateForm()) return

    setSaving(true)
    try {
      const updateData = {
        nama: form.nama.trim(),
        jk: form.jk,
        nik: form.nik ? form.nik.trim() : null,
        usia: form.usia ? parseInt(form.usia, 10) : null,
        kelas: form.kelas,
        no_hp_siswa: form.no_hp_siswa ? form.no_hp_siswa.trim() : null,
        no_hp_wali: form.no_hp_wali ? form.no_hp_wali.trim() : null,
        updated_at: new Date().toISOString()
      }

      // UI helper: tandai kelas_change_used bila berubah.
      // Enforcement final harus di trigger DB (biar bukan cuma UI).
      if (form.kelas !== originalKelas && !kelasChangeUsed) {
        updateData.kelas_change_used = true
      }

      const { error } = await supabase.from('profiles').update(updateData).eq('id', user.id)
      if (error) throw error

      setOriginalForm(form)
      setIsFormDirty(false)
      setOriginalKelas(form.kelas)
      if (form.kelas !== originalKelas && !kelasChangeUsed) setKelasChangeUsed(true)

      await refreshProfile()
      pushToast('success', 'Profil berhasil diperbarui')
    } catch (err) {
      pushToast('error', err.message || 'Gagal menyimpan profil')

      // rollback tampilan ke profile terakhir
      if (profile) {
        const rollback = {
          nama: profile.nama || '',
          jk: profile.jk || '',
          nik: profile.nik || '',
          usia: profile.usia || '',
          kelas: profile.kelas || '',
          no_hp_siswa: profile.no_hp_siswa || '',
          no_hp_wali: profile.no_hp_wali || ''
        }
        setForm(rollback)
        setOriginalForm(rollback)
        setIsFormDirty(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleResetForm = () => {
    setForm(originalForm)
    setIsFormDirty(false)
    setNamaError('')
    setNoHpSiswaError('')
    setNoHpWaliError('')
    pushToast('info', 'Form telah direset ke data asli')
  }

  // ==================== EMAIL VERIFICATION ====================

  const handleSendVerification = async () => {
    if (!user?.email) return
    setSendingVerify(true)
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: user.email })
      if (error) throw error
      pushToast('success', 'Email verifikasi telah dikirim. Cek inbox dan folder spam.')
    } catch {
      pushToast('error', 'Gagal mengirim email verifikasi. Coba lagi nanti.')
    } finally {
      setSendingVerify(false)
    }
  }

  // ==================== UI HELPERS ====================

  const getDisplayKelas = (kelasSlug) => {
    if (!kelasSlug) return 'Belum ditentukan'
    const k = kelasList.find((x) => x.id === kelasSlug)
    return k ? k.nama : formatKelasDisplay(kelasSlug)
  }

  const getFilledFieldCount = () => {
    const required = ['nama', 'jk', 'kelas']
    const optional = ['nik', 'usia', 'no_hp_siswa', 'no_hp_wali']
    return {
      required: required.filter((f) => form[f]).length,
      optional: optional.filter((f) => form[f]).length,
      totalRequired: required.length,
      totalOptional: optional.length
    }
  }

  const fieldStats = getFilledFieldCount()

  // ==================== RENDER ====================

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-lg border border-blue-100/50 p-6 mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                <span className="text-2xl text-white">👤</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent mb-2">
                  Profil Siswa
                </h1>
                <p className="text-slate-600 text-base">Kelola informasi profil dan foto Anda dengan aman</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl px-5 py-3 shadow-lg shadow-blue-500/25">
                <p className="text-white text-center font-medium">
                  <span className="block text-xs opacity-90 mb-1">Status Akun</span>
                  <span className="block text-lg">{profile?.status === 'active' ? '🟢 Aktif' : '🔴 Nonaktif'}</span>
                </p>
              </div>

              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl px-5 py-3 shadow-lg shadow-emerald-500/25">
                <p className="text-white text-center font-medium text-sm">
                  <span className="block opacity-90 mb-1">Kelengkapan Data</span>
                  <span className="block">
                    {fieldStats.required}/{fieldStats.totalRequired} wajib
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* SIDEBAR */}
          <div className="lg:col-span-1 space-y-6">
            {/* PHOTO CARD */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              <div className="flex flex-col items-center gap-5">
                <div className="relative group">
                  <div className="relative w-32 h-32">
                    {preview && !imgBroken ? (
                      <img
                        src={preview}
                        alt="Foto Profil"
                        className="w-32 h-32 rounded-2xl object-cover border-4 border-white shadow-xl"
                        onError={() => setImgBroken(true)}
                      />
                    ) : (
                      <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 border-4 border-white shadow-xl flex items-center justify-center">
                        <span className="text-4xl text-blue-500">👤</span>
                      </div>
                    )}

                    {(uploadingPhoto || progressText) && (
                      <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                        <div className="text-center">
                          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                          <p className="text-white text-xs font-medium">{progressText}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="absolute -bottom-2 -right-2 flex gap-2">
                    <label
                      htmlFor="photo-input"
                      className={`${
                        uploadingPhoto
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 cursor-pointer shadow-lg shadow-blue-500/25'
                      } text-white p-3 rounded-2xl transition-all duration-300 transform hover:scale-105`}
                      title="Ubah Foto"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </label>

                    {(photoPath || photoURL) && (
                      <button
                        onClick={handleDeletePhoto}
                        className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white p-3 rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/25"
                        title="Hapus Foto"
                        disabled={uploadingPhoto}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <input
                    id="photo-input"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={uploadingPhoto}
                  />
                </div>

                <div className="text-center">
                  <h2 className="font-bold text-xl text-slate-800 mb-2 line-clamp-2 break-words">
                    {form.nama || profile?.nama || 'Siswa'}
                  </h2>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full text-xs font-medium shadow-md mb-2">
                    <span>🏫</span>
                    <span>{getDisplayKelas(profile?.kelas) || 'Kelas belum ditentukan'}</span>
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-1 break-all">{email || 'Email tidak tersedia'}</p>
                </div>

                <div className="w-full p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-xs text-blue-700 text-center">
                    📷 Foto otomatis dikompresi ke <strong>maksimal 100KB</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* VERIFICATION */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-5">
              <div className="space-y-4">
                <div
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium w-full justify-center ${
                    emailVerified
                      ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25'
                      : 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-lg shadow-yellow-500/25'
                  }`}
                >
                  {emailVerified ? (
                    <>
                      <span className="text-base">✅</span>
                      <span>Email Terverifikasi</span>
                    </>
                  ) : (
                    <>
                      <span className="text-base">⚠️</span>
                      <span>Email Belum Terverifikasi</span>
                    </>
                  )}
                </div>

                {!emailVerified && (
                  <button
                    onClick={handleSendVerification}
                    disabled={sendingVerify}
                    className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-blue-400 disabled:to-blue-500 text-white font-medium rounded-xl transition-all duration-300 shadow-lg shadow-blue-500/25 transform hover:scale-105 disabled:transform-none text-sm"
                  >
                    {sendingVerify ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Mengirim...</span>
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5">
                        <span>📧</span>
                        <span>Kirim Verifikasi</span>
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* SCHOOL INFO */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-5">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-blue-500">🏫</span>
                <span>Informasi Sekolah</span>
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Kelas</span>
                  <span className="font-semibold text-slate-800">{getDisplayKelas(profile?.kelas) || '-'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Status</span>
                  <span className="font-semibold text-slate-800 capitalize">{profile?.status || 'active'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Bergabung</span>
                  <span className="font-semibold text-slate-800 text-xs">
                    {profile?.created_at
                      ? new Date(profile.created_at).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        })
                      : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Hak ganti kelas</span>
                  <span className={`font-semibold text-xs ${kelasChangeUsed ? 'text-red-600' : 'text-green-600'}`}>
                    {kelasChangeUsed ? 'Sudah digunakan' : 'Masih tersedia'}
                  </span>
                </div>
              </div>
            </div>

            {/* CONTACT */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-5">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-blue-500">📱</span>
                <span>Kontak</span>
              </h4>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-slate-500 block mb-1">HP Siswa</span>
                  <span className="font-semibold text-slate-800">{formatPhoneDisplay(form.no_hp_siswa) || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">HP Orang Tua/Wali</span>
                  <span className="font-semibold text-slate-800">{formatPhoneDisplay(form.no_hp_wali) || '-'}</span>
                </div>
              </div>
            </div>

            {/* LOGOUT */}
            <button
              onClick={logout}
              className="w-full px-4 py-3 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-medium rounded-2xl transition-all duration-300 shadow-lg shadow-red-500/25 transform hover:scale-105 flex items-center justify-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="font-semibold">Keluar</span>
            </button>
          </div>

          {/* MAIN FORM */}
          <div className="lg:col-span-3">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                    <span className="text-lg text-white">📝</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Informasi Pribadi</h3>
                    <p className="text-slate-600 text-sm mt-1">Perbarui data profil Anda dengan informasi yang valid dan terbaru</p>
                  </div>
                </div>

                {isFormDirty && (
                  <button
                    onClick={handleResetForm}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-all duration-300 font-medium text-sm"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* NAMA */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 ${
                      namaError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-blue-300'
                    }`}
                    value={form.nama}
                    onChange={(e) => handleFieldChange('nama', e.target.value)}
                    placeholder="Masukkan nama lengkap Anda"
                    maxLength={100}
                  />
                  {namaError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{namaError}</span>
                    </p>
                  )}
                </div>

                {/* KELAS */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Kelas <span className="text-red-500">*</span>
                    {originalKelas && (
                      <span className="ml-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {kelasChangeUsed ? 'Tidak bisa diubah' : 'Bisa diubah 1x'}
                      </span>
                    )}
                  </label>
                  <select
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300 disabled:bg-slate-50 disabled:cursor-not-allowed"
                    value={form.kelas}
                    onChange={(e) => handleFieldChange('kelas', e.target.value)}
                    disabled={isLoadingKelas || (kelasChangeUsed && originalKelas)}
                  >
                    <option value="">Pilih Kelas</option>
                    {isLoadingKelas && <option disabled>Memuat daftar kelas...</option>}
                    {!isLoadingKelas && kelasList.length === 0 && <option disabled>Belum ada kelas tersedia</option>}
                    {!isLoadingKelas &&
                      kelasList.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.nama}
                        </option>
                      ))}
                  </select>
                  {originalKelas && (
                    <p className="mt-2 text-xs text-orange-600 flex items-center gap-1.5">
                      <span>💡</span>
                      <span>
                        {kelasChangeUsed
                          ? 'Anda sudah menggunakan hak perubahan kelas. Hubungi admin jika ada kesalahan.'
                          : 'Anda memiliki 1 kesempatan untuk mengubah kelas. Pastikan pilihan benar.'}
                      </span>
                    </p>
                  )}
                </div>

                {/* JK */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Jenis Kelamin <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300"
                    value={form.jk}
                    onChange={(e) => handleFieldChange('jk', e.target.value)}
                  >
                    <option value="">Pilih Jenis Kelamin</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>

                {/* NIK */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    NIK
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300 placeholder-slate-400"
                    value={form.nik}
                    onChange={(e) => handleFieldChange('nik', e.target.value)}
                    placeholder="16 digit (opsional)"
                    maxLength={16}
                  />
                </div>

                {/* USIA */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Usia
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="30"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300 placeholder-slate-400"
                    value={form.usia}
                    onChange={(e) => handleFieldChange('usia', e.target.value)}
                    placeholder="10-30 tahun (opsional)"
                  />
                </div>

                {/* EMAIL */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Email
                  </label>
                  <div className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 break-all">
                    {email || 'Email tidak tersedia'}
                  </div>
                </div>

                {/* HP SISWA */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Nomor HP Siswa
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-slate-500 text-sm">+62</span>
                    </div>
                    <input
                      type="tel"
                      className={`w-full px-4 py-3 pl-12 border rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 ${
                        noHpSiswaError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-blue-300'
                      }`}
                      value={form.no_hp_siswa}
                      onChange={(e) => handleFieldChange('no_hp_siswa', e.target.value)}
                      placeholder="81234567890"
                      maxLength={14}
                    />
                  </div>
                  {noHpSiswaError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{noHpSiswaError}</span>
                    </p>
                  )}
                </div>

                {/* HP WALI */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Nomor HP Orang Tua/Wali
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-slate-500 text-sm">+62</span>
                    </div>
                    <input
                      type="tel"
                      className={`w-full px-4 py-3 pl-12 border rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 ${
                        noHpWaliError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-blue-300'
                      }`}
                      value={form.no_hp_wali}
                      onChange={(e) => handleFieldChange('no_hp_wali', e.target.value)}
                      placeholder="81234567890"
                      maxLength={14}
                    />
                  </div>
                  {noHpWaliError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{noHpWaliError}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="text-xs text-slate-500">
                    <span className="text-red-500">*</span> Field wajib
                  </div>
                  {isFormDirty && (
                    <div className="text-xs text-orange-600 font-medium px-2 py-1 bg-orange-50 rounded-full">
                      Ada perubahan yang belum disimpan
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleResetForm}
                    disabled={!isFormDirty || saving}
                    className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 font-medium text-sm"
                  >
                    Reset
                  </button>

                  <button
                    onClick={handleSaveProfile}
                    disabled={
                      saving ||
                      !isFormDirty ||
                      !form.nama.trim() ||
                      !form.jk ||
                      !form.kelas ||
                      !!namaError ||
                      !!noHpSiswaError ||
                      !!noHpWaliError
                    }
                    className="px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-blue-400 disabled:to-blue-500 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg shadow-blue-500/25 transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed flex items-center gap-2 text-sm"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Simpan Perubahan</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL KELAS */}
      {showKelasWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-orange-200 max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-orange-500/25">
                <span className="text-xl text-white">⚠️</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Konfirmasi Perubahan Kelas</h3>
              <div className="bg-orange-50 rounded-xl p-3 border border-orange-200 mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-slate-700 font-medium">Saat ini:</span>
                  <span className="font-semibold text-slate-800">{getDisplayKelas(originalKelas)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 font-medium">Akan berubah:</span>
                  <span className="font-semibold text-blue-600">{getDisplayKelas(newKelas)}</span>
                </div>
              </div>
              <p className="text-xs text-orange-600 font-medium">
                Anda hanya punya <strong>1 kesempatan</strong> untuk mengubah kelas.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={cancelKelasChange}
                className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-all duration-300 font-medium text-sm"
              >
                Batalkan
              </button>
              <button
                onClick={confirmKelasChange}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl font-medium transition-all duration-300 shadow-lg shadow-orange-500/25 flex items-center justify-center gap-1.5 text-sm"
              >
                <span>✅</span>
                <span>Ya, Lanjutkan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
