// src/pages/siswa/EditProfile.jsx
import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

/* ========= Helper: kompres gambar ke <= 100KB ========= */
async function compressImageTo100KB(file, maxBytes = 100 * 1024) {
  if (!file || file.size <= maxBytes) return file

  console.log(`Mengkompresi gambar: ${file.name} (${(file.size / 1024).toFixed(2)}KB) -> target 100KB`)

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = dataUrl
  })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  // Ukuran maksimal yang lebih kecil untuk target 100KB
  const maxDim = 800
  let { width, height } = img
  
  // Hitung rasio untuk resize
  const ratio = Math.min(1, maxDim / Math.max(width, height))
  width = Math.floor(width * ratio)
  height = Math.floor(height * ratio)
  
  canvas.width = width
  canvas.height = height
  
  // Gunakan smoothing untuk kualitas yang lebih baik
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)

  let quality = 0.8 // Mulai dengan kualitas lebih rendah
  let blob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )

  console.log(`Kompresi awal: ${(blob.size / 1024).toFixed(2)}KB dengan kualitas ${quality}`)

  // Loop kompresi hingga mencapai target 100KB
  while (blob && blob.size > maxBytes && quality > 0.3) {
    quality -= 0.1
    blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    console.log(`Kompresi: ${(blob.size / 1024).toFixed(2)}KB dengan kualitas ${quality.toFixed(2)}`)
  }

  if (!blob) {
    console.warn('Gagal membuat blob, menggunakan file asli')
    return file
  }

  const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
    type: 'image/jpeg',
  })

  console.log(`Kompresi selesai: ${compressedFile.name} (${(compressedFile.size / 1024).toFixed(2)}KB)`)
  
  return compressedFile
}

// Fungsi untuk mengkonversi slug kelas ke format tampilan
const formatKelasDisplay = (slug) => {
  if (!slug) return ''
  
  try {
    return slug
      .split('-')
      .map(part => part.toUpperCase())
      .join(' ')
  } catch (error) {
    console.error('Error formatting kelas:', error)
    return slug
  }
}

/* ==================== COMPONENT ==================== */
export default function EditProfile() {
  const { user, profile, logout, refreshProfile } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  const [form, setForm] = useState({
    nama: '',
    jk: '',
    nik: '',
    usia: '',
    kelas: ''
  })

  const [photoURL, setPhotoURL] = useState('')
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [sendingVerify, setSendingVerify] = useState(false)
  const [kelasList, setKelasList] = useState([])
  const [isLoadingKelas, setIsLoadingKelas] = useState(false)
  const [namaError, setNamaError] = useState('')
  const [showKelasWarning, setShowKelasWarning] = useState(false)
  const [newKelas, setNewKelas] = useState('')
  const [originalKelas, setOriginalKelas] = useState('')
  const [compressionProgress, setCompressionProgress] = useState('')

  // Load profile data dan kelas list
  useEffect(() => {
    if (profile) {
      console.log('Profile loaded:', profile)
      setForm({
        nama: profile.nama || '',
        jk: profile.jk || '',
        nik: profile.nik || '',
        usia: profile.usia || '',
        kelas: profile.kelas || ''
      })
      setPhotoURL(profile.photo_url || '')
      setPreview(profile.photo_url || '')
      setOriginalKelas(profile.kelas || '')
    }
    loadKelasList()
  }, [profile])

  // Load daftar kelas dengan format yang benar
  const loadKelasList = async () => {
    try {
      setIsLoadingKelas(true)
      console.log('Loading kelas list...')
      
      const { data, error } = await supabase
        .from('kelas')
        .select('id, nama, grade, suffix')
        .order('grade')
        .order('suffix')

      if (error) {
        console.error('Error loading kelas:', error)
        throw error
      }
      
      console.log('Kelas data received:', data)
      
      const formattedKelasList = (data || []).map(kelas => ({
        id: kelas.id,
        nama: kelas.nama || formatKelasDisplay(kelas.id),
        slug: kelas.id
      }))
      
      console.log('Formatted kelas list:', formattedKelasList)
      setKelasList(formattedKelasList)
    } catch (error) {
      console.error('Error loading kelas:', error)
      pushToast('error', 'Gagal memuat daftar kelas')
    } finally {
      setIsLoadingKelas(false)
    }
  }

  const handleFieldChange = (key, value) => {
    console.log(`Field changed: ${key} = ${value}`)
    
    if (key === 'nama') {
      const namaRegex = /^[a-zA-Z\s.'-]+$/
      if (value && !namaRegex.test(value)) {
        setNamaError('Nama hanya boleh mengandung huruf, spasi, titik, dan tanda hubung')
      } else {
        setNamaError('')
      }
    }
    
    if (key === 'kelas' && originalKelas && originalKelas.trim() !== '' && value !== originalKelas) {
      console.log('Kelas change detected, showing warning. Old:', originalKelas, 'New:', value)
      setNewKelas(value)
      setShowKelasWarning(true)
      return
    }
    
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Konfirmasi perubahan kelas
  const confirmKelasChange = () => {
    console.log('Confirming kelas change to:', newKelas)
    setForm(prev => ({ ...prev, kelas: newKelas }))
    setShowKelasWarning(false)
    setOriginalKelas(newKelas)
    pushToast('warning', 'Perubahan kelas berhasil disimpan. Pastikan untuk memeriksa data tugas dan absensi Anda.')
  }

  // Batalkan perubahan kelas
  const cancelKelasChange = () => {
    console.log('Canceling kelas change')
    setNewKelas('')
    setShowKelasWarning(false)
    setForm(prev => ({ ...prev, kelas: originalKelas || '' }))
  }

  const hasExistingKelas = originalKelas && originalKelas.trim() !== ''

  /* ========== Upload & Kompres Foto Profil ========== */
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    setUploadingPhoto(true)
    setCompressionProgress('Mengkompresi gambar...')

    try {
      // Validasi tipe file
      if (!file.type.startsWith('image/')) {
        throw new Error('Hanya file gambar yang diizinkan')
      }

      // Validasi ukuran file awal
      if (file.size > 10 * 1024 * 1024) { // 10MB
        throw new Error('Ukuran file terlalu besar. Maksimal 10MB.')
      }

      // Kompresi gambar ke 100KB
      const compressedFile = await compressImageTo100KB(file)
      
      if (compressedFile.size > 100 * 1024) {
        console.warn(`File masih terlalu besar: ${(compressedFile.size / 1024).toFixed(2)}KB, memaksa kompresi ulang`)
        // Kompresi lebih agresif
        const moreCompressed = await compressImageTo100KB(compressedFile, 80 * 1024)
        if (moreCompressed.size > 100 * 1024) {
          pushToast('warning', 'Gambar masih melebihi 100KB setelah kompresi. Ukuran mungkin masih besar.')
        }
      }

      setCompressionProgress('Mengupload gambar...')
      const localPreview = URL.createObjectURL(compressedFile)
      setPreview(localPreview)

      // Upload ke Supabase Storage
      const fileExt = 'jpg'
      const fileName = `profile_${user.id}_${Date.now()}.${fileExt}`
      const filePath = `profiles/${fileName}`

      console.log('Uploading file to:', filePath)
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Upload error details:', uploadError)
        throw new Error(`Upload gagal: ${uploadError.message}`)
      }

      // Dapatkan URL public
      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(filePath)

      console.log('File uploaded successfully:', publicUrl)

      // Hapus foto lama jika ada
      if (photoURL && photoURL.includes('profile-photos')) {
        try {
          const oldFileName = photoURL.split('/').pop()
          await supabase.storage
            .from('profile-photos')
            .remove([`profiles/${oldFileName}`])
          console.log('Old photo deleted successfully')
        } catch (deleteError) {
          console.warn('Gagal menghapus foto lama:', deleteError)
        }
      }

      // Update photo_url di database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          photo_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('Database update error:', updateError)
        throw new Error(`Update database gagal: ${updateError.message}`)
      }

      setPhotoURL(publicUrl)
      await refreshProfile()

      pushToast('success', `Foto profil berhasil diperbarui (${(compressedFile.size / 1024).toFixed(1)}KB)`)
      
    } catch (error) {
      console.error('Error upload foto:', error)
      pushToast('error', `Gagal mengupload foto: ${error.message}`)
      setPreview(photoURL)
    } finally {
      setUploadingPhoto(false)
      setCompressionProgress('')
    }
  }

  /* ========== Simpan Data Profil ========== */
  const handleSaveProfile = async () => {
    if (!user?.id) return

    console.log('Saving profile with data:', form)

    // Validasi required fields
    if (!form.nama.trim()) {
      pushToast('error', 'Nama lengkap harus diisi')
      return
    }

    if (!form.jk) {
      pushToast('error', 'Jenis kelamin harus dipilih')
      return
    }

    const namaRegex = /^[a-zA-Z\s.'-]+$/
    if (!namaRegex.test(form.nama)) {
      pushToast('error', 'Nama hanya boleh mengandung huruf, spasi, titik, dan tanda hubung')
      return
    }

    if (!form.kelas) {
      pushToast('error', 'Kelas harus dipilih')
      return
    }

    setSaving(true)
    
    try {
      const updateData = {
        nama: form.nama.trim(),
        jk: form.jk,
        nik: form.nik || null,
        usia: form.usia ? parseInt(form.usia) : null,
        kelas: form.kelas,
        updated_at: new Date().toISOString()
      }

      console.log('Updating profile with:', updateData)

      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select()

      if (error) {
        console.error('Supabase error:', error)
        throw new Error(error.message || 'Gagal menyimpan profil')
      }

      console.log('Update successful, response:', data)

      setOriginalKelas(form.kelas)
      await refreshProfile()
      pushToast('success', 'Profil berhasil diperbarui')
      
    } catch (error) {
      console.error('Error update profile:', error)
      pushToast('error', error.message || 'Gagal menyimpan profil')
    } finally {
      setSaving(false)
    }
  }

  /* ========== Kirim Verifikasi Email ========== */
  const handleSendVerification = async () => {
    if (!user) return

    setSendingVerify(true)
    
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
      })

      if (error) throw error

      pushToast('success', 'Email verifikasi telah dikirim. Silakan cek inbox Anda.')
      
    } catch (error) {
      console.error('Error sending verification:', error)
      pushToast('error', 'Gagal mengirim email verifikasi')
    } finally {
      setSendingVerify(false)
    }
  }

  const email = user?.email || profile?.email || ''
  const emailVerified = user?.email_confirmed_at || user?.emailVerified

  // Dapatkan nama kelas yang diformat untuk ditampilkan
  const getDisplayKelas = (kelasSlug) => {
    if (!kelasSlug) return '-'
    const kelasData = kelasList.find(k => k.id === kelasSlug)
    return kelasData ? kelasData.nama : formatKelasDisplay(kelasSlug)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
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
                <p className="text-slate-600 text-base">
                  Kelola informasi profil dan foto Anda dengan aman
                </p>
              </div>
            </div>
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl px-5 py-3 shadow-lg shadow-blue-500/25">
              <p className="text-white text-center font-medium">
                <span className="block text-xs opacity-90 mb-1">Status Akun</span>
                <span className="block text-lg">{profile?.status === 'active' ? '🟢 Aktif' : '🔴 Nonaktif'}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* ========== SIDEBAR KIRI: FOTO PROFIL ========== */}
          <div className="lg:col-span-1 space-y-6">
            {/* Card Foto Profil */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              <div className="flex flex-col items-center gap-5">
                {/* Foto Profil */}
                <div className="relative">
                  <div className="relative w-32 h-32">
                    {preview ? (
                      <img
                        src={preview}
                        alt="Foto Profil"
                        className="w-32 h-32 rounded-2xl object-cover border-4 border-white shadow-xl"
                      />
                    ) : (
                      <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 border-4 border-white shadow-xl flex items-center justify-center">
                        <span className="text-4xl text-blue-500">👤</span>
                      </div>
                    )}

                    {/* Loading Overlay */}
                    {(uploadingPhoto || compressionProgress) && (
                      <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                        <div className="text-center">
                          <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                          <p className="text-white text-xs font-medium">
                            {compressionProgress || 'Mengupload...'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tombol Ubah Foto */}
                  <label
                    htmlFor="photo-input"
                    className={`absolute -bottom-2 -right-2 ${
                      uploadingPhoto 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 cursor-pointer shadow-lg shadow-blue-500/25'
                    } text-white p-3 rounded-2xl transition-all duration-300 transform hover:scale-105`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </label>
                  <input
                    id="photo-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={uploadingPhoto}
                  />
                </div>

                {/* Info Ringkas */}
                <div className="text-center">
                  <h2 className="font-bold text-xl text-slate-800 mb-2 line-clamp-2">
                    {form.nama || profile?.nama || 'Siswa'}
                  </h2>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full text-xs font-medium shadow-md mb-2">
                    <span>🏫</span>
                    <span>{getDisplayKelas(profile?.kelas) || 'Kelas belum ditentukan'}</span>
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-1">
                    {email || 'Email tidak tersedia'}
                  </p>
                </div>

                {/* Info Kompresi */}
                <div className="w-full p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-xs text-blue-700 text-center">
                    📷 Foto otomatis dikompresi ke <strong>maksimal 100KB</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Card Status Verifikasi */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-5">
              <div className="space-y-4">
                <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium w-full justify-center ${
                  emailVerified 
                    ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25' 
                    : 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-lg shadow-yellow-500/25'
                }`}>
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

            {/* Card Informasi Sekolah */}
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
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('id-ID') : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Tombol Logout */}
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

          {/* ========== KONTEN UTAMA: FORM EDIT PROFIL ========== */}
          <div className="lg:col-span-3">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <span className="text-lg text-white">📝</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Informasi Pribadi</h3>
                  <p className="text-slate-600 text-sm mt-1">Perbarui data profil Anda dengan informasi yang valid</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Nama Lengkap */}
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
                  />
                  {namaError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{namaError}</span>
                    </p>
                  )}
                </div>

                {/* Kelas */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Kelas <span className="text-red-500">*</span>
                    {hasExistingKelas && (
                      <span className="ml-1 text-xs text-orange-600 font-medium">(Dapat diubah)</span>
                    )}
                  </label>
                  <select
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300"
                    value={form.kelas}
                    onChange={(e) => handleFieldChange('kelas', e.target.value)}
                    disabled={isLoadingKelas}
                  >
                    <option value="">Pilih Kelas</option>
                    {isLoadingKelas && <option disabled>Memuat kelas...</option>}
                    {!isLoadingKelas && kelasList.length === 0 && (
                      <option disabled>Belum ada kelas tersedia</option>
                    )}
                    {!isLoadingKelas && kelasList.map(k => (
                      <option key={k.id} value={k.id}>
                        {k.nama}
                      </option>
                    ))}
                  </select>
                  {isLoadingKelas && (
                    <p className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Memuat daftar kelas...</span>
                    </p>
                  )}
                  {hasExistingKelas && (
                    <p className="mt-2 text-xs text-orange-600 flex items-center gap-1.5">
                      <span>💡</span>
                      <span>Kelas sudah terisi. Mengganti kelas dapat mempengaruhi data tugas dan absensi.</span>
                    </p>
                  )}
                </div>

                {/* Jenis Kelamin */}
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
                    NIK (Nomor Induk Kependudukan)
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-3 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all duration-300 hover:border-blue-300 placeholder-slate-400"
                    value={form.nik}
                    onChange={(e) => handleFieldChange('nik', e.target.value)}
                    placeholder="Masukkan NIK (opsional)"
                  />
                </div>

                {/* Usia */}
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
                    placeholder="Masukkan usia (opsional)"
                  />
                </div>

                {/* Email (Read-only) */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Email
                  </label>
                  <div className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-600">
                    {email || 'Email tidak tersedia'}
                  </div>
                </div>
              </div>

              {/* Informasi Tambahan */}
              <div className="mt-6 p-4 bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl border border-blue-200">
                <h4 className="font-semibold text-slate-700 mb-3 flex items-center gap-2 text-sm">
                  <span className="text-blue-500">💡</span>
                  <span>Informasi Penting</span>
                </h4>
                <div className="grid md:grid-cols-2 gap-4 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    <span className="text-slate-600">Pastikan data yang diisi sudah benar dan valid</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">📷</span>
                    <span className="text-slate-600">Foto profil otomatis dikompresi maksimal 100KB</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-orange-500 mt-0.5">⚠️</span>
                    <span className="text-slate-600">Perubahan kelas dapat mempengaruhi data akademik</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">🔄</span>
                    <span className="text-slate-600">Data akan diperbarui secara real-time</span>
                  </div>
                </div>
              </div>

              {/* Tombol Simpan */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-8 pt-6 border-t border-slate-200">
                <div className="text-xs text-slate-500">
                  <span className="text-red-500">*</span> Menandakan field yang wajib diisi
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={saving || !form.nama.trim() || !form.jk || namaError || !form.kelas}
                  className="px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-blue-400 disabled:to-blue-500 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg shadow-blue-500/25 transform hover:scale-105 disabled:transform-none flex items-center gap-2 text-sm"
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

      {/* Modal Warning untuk Perubahan Kelas */}
      {showKelasWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-orange-200 max-w-md w-full p-6 transform animate-scale-in">
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-orange-500/25">
                <span className="text-xl text-white">⚠️</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Peringatan!</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                <strong className="text-orange-600">Mengganti kelas dapat mempengaruhi</strong> data tugas, absensi, dan nilai Anda. 
                Pastikan perubahan ini benar-benar diperlukan.
              </p>
            </div>

            <div className="bg-orange-50 rounded-xl p-3 border border-orange-200 mb-4">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-700 font-medium">Dari:</span>
                <span className="font-semibold text-slate-800">{getDisplayKelas(originalKelas)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 font-medium">Menjadi:</span>
                <span className="font-semibold text-blue-600">{getDisplayKelas(newKelas)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={cancelKelasChange}
                className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-all duration-300 font-medium text-sm transform hover:scale-105"
              >
                Batalkan
              </button>
              <button
                onClick={confirmKelasChange}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-xl font-medium transition-all duration-300 shadow-lg shadow-orange-500/25 transform hover:scale-105 flex items-center justify-center gap-1.5 text-sm"
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