// src/pages/siswa/EditProfile.jsx
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

// ========= HELPER FUNCTIONS =========

/**
 * Kompres gambar ke ukuran maksimal 100KB
 * @param {File} file - File gambar yang akan dikompresi
 * @param {number} maxBytes - Ukuran maksimal dalam bytes (default: 100KB)
 * @returns {Promise<File>} File yang sudah dikompresi
 */
async function compressImageTo100KB(file, maxBytes = 100 * 1024) {
  console.log(`[ImageCompression] Starting compression for: ${file.name} (${(file.size / 1024).toFixed(2)}KB)`)
  
  // Jika file sudah <= 100KB, langsung return
  if (file.size <= maxBytes) {
    console.log('[ImageCompression] File already within size limit, skipping compression')
    return file
  }

  try {
    // Baca file sebagai DataURL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.onerror = (e) => {
        console.error('[ImageCompression] Error reading file:', e)
        reject(new Error('Gagal membaca file gambar'))
      }
      reader.readAsDataURL(file)
    })

    // Load gambar ke elemen Image
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        console.log(`[ImageCompression] Original dimensions: ${image.width}x${image.height}`)
        resolve(image)
      }
      image.onerror = () => reject(new Error('Gagal memuat gambar'))
      image.src = dataUrl
    })

    // Siapkan canvas untuk kompresi
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    // Hitung dimensi baru (maks 800px di sisi terpanjang)
    const MAX_DIMENSION = 800
    let { width, height } = img
    
    // Jika gambar lebih besar dari MAX_DIMENSION, resize dengan maintain aspect ratio
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(1, MAX_DIMENSION / Math.max(width, height))
      width = Math.floor(width * ratio)
      height = Math.floor(height * ratio)
      console.log(`[ImageCompression] Resized to: ${width}x${height} (ratio: ${ratio.toFixed(2)})`)
    }
    
    canvas.width = width
    canvas.height = height
    
    // Set kualitas rendering
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    // Gambar ke canvas dengan kualitas tinggi
    ctx.drawImage(img, 0, 0, width, height)

    // Progressive compression dengan quality stepping
    let quality = 0.85 // Mulai dengan kualitas tinggi
    let minQuality = 0.4 // Kualitas minimum yang diperbolehkan
    let stepSize = 0.1 // Langkah penurunan kualitas
    let compressedBlob = null
    
    while (quality >= minQuality) {
      compressedBlob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', quality)
      })
      
      console.log(`[ImageCompression] Quality ${quality.toFixed(2)} -> ${(compressedBlob.size / 1024).toFixed(2)}KB`)
      
      if (compressedBlob.size <= maxBytes || quality <= minQuality) {
        break
      }
      
      quality -= stepSize
    }

    if (!compressedBlob) {
      console.warn('[ImageCompression] Failed to create compressed blob, returning original file')
      return file
    }

    // Buat File object dari blob
    const compressedFile = new File(
      [compressedBlob],
      `compressed_${Date.now()}_${file.name.replace(/\.\w+$/, '')}.jpg`,
      { type: 'image/jpeg' }
    )
    
    console.log(`[ImageCompression] Compression complete: ${(compressedFile.size / 1024).toFixed(2)}KB (${((1 - compressedFile.size / file.size) * 100).toFixed(1)}% reduction)`)
    
    return compressedFile
    
  } catch (error) {
    console.error('[ImageCompression] Error during compression:', error)
    throw error
  }
}

/**
 * Format tampilan kelas dari slug
 * Contoh: "x-ipa-1" menjadi "X IPA 1"
 * @param {string} slug - Slug kelas dari database
 * @returns {string} Kelas yang sudah diformat
 */
const formatKelasDisplay = (slug) => {
  if (!slug || typeof slug !== 'string') return ''
  
  try {
    return slug
      .split('-')
      .map(part => {
        // Handle romawi untuk kelas
        if (part.toLowerCase() === 'x') return 'X'
        if (part.toLowerCase() === 'xi') return 'XI'
        if (part.toLowerCase() === 'xii') return 'XII'
        
        // Handle jurusan
        const jurusanMap = {
          'ipa': 'IPA',
          'ips': 'IPS',
          'bahasa': 'Bahasa',
          'agama': 'Agama',
          'tkj': 'TKJ',
          'rpl': 'RPL',
          'mm': 'Multimedia',
          'akuntansi': 'Akuntansi'
        }
        
        return jurusanMap[part.toLowerCase()] || part.toUpperCase()
      })
      .join(' ')
  } catch (error) {
    console.error('[KelasFormat] Error formatting kelas:', error)
    return slug
  }
}

/**
 * Validasi nomor telepon Indonesia
 * @param {string} phone - Nomor telepon
 * @param {string} fieldName - Nama field untuk pesan error
 * @returns {string} Pesan error atau string kosong jika valid
 */
const validatePhoneNumber = (phone, fieldName = 'Nomor HP') => {
  if (!phone) return '' // Opsional, tidak error jika kosong
  
  // Hapus semua karakter non-digit kecuali + di awal
  let cleanPhone = phone
  if (phone.startsWith('+')) {
    cleanPhone = '+' + phone.slice(1).replace(/\D/g, '')
  } else {
    cleanPhone = phone.replace(/\D/g, '')
  }
  
  // Validasi panjang
  const digitsOnly = cleanPhone.replace('+', '').replace('62', '')
  if (digitsOnly.length > 14) {
    return `${fieldName} maksimal 14 digit (tidak termasuk kode negara)`
  }
  
  // Validasi format Indonesia
  // Format yang valid: +62..., 62..., 08..., 9...
  const indonesianPhoneRegex = /^(?:\+?62|0)(?:\d{8,13})$/
  const testNumber = cleanPhone.startsWith('+62') ? cleanPhone.slice(1) : cleanPhone
  
  if (!indonesianPhoneRegex.test(testNumber)) {
    return `${fieldName} tidak valid. Contoh: 081234567890 atau +6281234567890`
  }
  
  return ''
}

/**
 * Format nomor telepon untuk display
 * @param {string} phone - Nomor telepon
 * @returns {string} Nomor yang sudah diformat
 */
const formatPhoneDisplay = (phone) => {
  if (!phone) return '-'
  
  const cleanPhone = phone.replace(/\D/g, '')
  
  // Format: +62 812-3456-7890
  if (cleanPhone.startsWith('62')) {
    const operatorCode = cleanPhone.slice(2, 4)
    const firstPart = cleanPhone.slice(4, 8)
    const secondPart = cleanPhone.slice(8)
    return `+62 ${operatorCode}-${firstPart}-${secondPart}`
  }
  
  // Format: 0812-3456-7890
  if (cleanPhone.startsWith('0') && cleanPhone.length >= 10) {
    const operatorCode = cleanPhone.slice(1, 4)
    const firstPart = cleanPhone.slice(4, 8)
    const secondPart = cleanPhone.slice(8)
    return `0${operatorCode}-${firstPart}-${secondPart}`
  }
  
  return phone
}

// ==================== MAIN COMPONENT ====================

export default function EditProfile() {
  // ========= STATE MANAGEMENT =========
  const { user, profile, logout, refreshProfile } = useAuthStore()
  const { pushToast } = useUIStore()
  
  // Refs
  const fileInputRef = useRef(null)
  
  // Form state
  const [form, setForm] = useState({
    nama: '',
    jk: '',
    nik: '',
    usia: '',
    kelas: '',
    no_hp_siswa: '',
    no_hp_wali: ''
  })
  
  // UI state
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
  const [kelasChangeUsed, setKelasChangeUsed] = useState(false)
  
  // Validation state
  const [noHpSiswaError, setNoHpSiswaError] = useState('')
  const [noHpWaliError, setNoHpWaliError] = useState('')
  
  // Other state
  const [isFormDirty, setIsFormDirty] = useState(false)
  const [originalForm, setOriginalForm] = useState({})

  // ========= EFFECT HOOKS =========

  // Load initial data
  useEffect(() => {
    if (profile) {
      console.log('[Profile] Loading profile data:', profile)
      
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
      setPhotoURL(profile.photo_url || '')
      setPreview(profile.photo_url || '')
      setOriginalKelas(profile.kelas || '')
      setKelasChangeUsed(!!profile.kelas_change_used)
      setIsFormDirty(false)
    }
    
    loadKelasList()
    
    // Warn user before leaving if form is dirty
    const handleBeforeUnload = (e) => {
      if (isFormDirty) {
        e.preventDefault()
        e.returnValue = 'Anda memiliki perubahan yang belum disimpan. Yakin ingin meninggalkan halaman?'
        return e.returnValue
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ========= DATA LOADING FUNCTIONS =========

  /**
   * Memuat daftar kelas dari database
   */
  const loadKelasList = async () => {
    try {
      setIsLoadingKelas(true)
      console.log('[Kelas] Loading kelas list...')
      
      const { data, error } = await supabase
        .from('kelas')
        .select('id, nama, grade, suffix')
        .order('grade', { ascending: true })
        .order('suffix', { ascending: true })
        .limit(100) // Batasi untuk performance

      if (error) {
        console.error('[Kelas] Error loading kelas:', error)
        throw error
      }
      
      console.log('[Kelas] Received data:', data)
      
      // Format data kelas
      const formattedKelasList = (data || []).map(kelas => ({
        id: kelas.id,
        nama: kelas.nama || formatKelasDisplay(kelas.id),
        slug: kelas.id,
        grade: kelas.grade,
        suffix: kelas.suffix
      }))
      
      // Sort berdasarkan grade lalu suffix
      formattedKelasList.sort((a, b) => {
        const gradeOrder = { 'X': 1, 'XI': 2, 'XII': 3 }
        const gradeA = gradeOrder[a.grade] || 99
        const gradeB = gradeOrder[b.grade] || 99
        
        if (gradeA !== gradeB) return gradeA - gradeB
        return (a.suffix || '').localeCompare(b.suffix || '')
      })
      
      setKelasList(formattedKelasList)
      
    } catch (error) {
      console.error('[Kelas] Error loading kelas:', error)
      pushToast('error', 'Gagal memuat daftar kelas. Silakan refresh halaman.')
    } finally {
      setIsLoadingKelas(false)
    }
  }

  // ========= FORM HANDLERS =========

  /**
   * Handle perubahan field form
   * @param {string} key - Nama field
   * @param {string} value - Nilai baru
   */
  const handleFieldChange = (key, value) => {
    console.log(`[Form] Field changed: ${key} = ${value}`)
    
    let processedValue = value
    
    // Validasi spesifik per field
    switch (key) {
      case 'nama':
        const namaRegex = /^[a-zA-Z\s.'-]+$/
        if (value && !namaRegex.test(value)) {
          setNamaError('Nama hanya boleh mengandung huruf, spasi, titik, apostrof, dan tanda hubung')
        } else {
          setNamaError('')
        }
        break
        
      case 'no_hp_siswa':
        processedValue = formatPhoneInput(value)
        setNoHpSiswaError(validatePhoneNumber(processedValue, 'Nomor HP Siswa'))
        break
        
      case 'no_hp_wali':
        processedValue = formatPhoneInput(value)
        setNoHpWaliError(validatePhoneNumber(processedValue, 'Nomor HP Wali'))
        break
        
      case 'usia':
        // Validasi usia 10-30 tahun
        if (value) {
          const age = parseInt(value)
          if (age < 10 || age > 30) {
            pushToast('warning', 'Usia harus antara 10-30 tahun')
          }
        }
        break
        
      case 'kelas':
        handleKelasChange(value)
        return // Keluar dari function karena sudah ditangani di handleKelasChange
        
      default:
        break
    }
    
    // Update form state
    const newForm = { ...form, [key]: processedValue }
    setForm(newForm)
    
    // Cek apakah form dirty
    const isDirty = JSON.stringify(newForm) !== JSON.stringify(originalForm)
    setIsFormDirty(isDirty)
  }

  /**
   * Format input nomor telepon
   * @param {string} value - Input value
   * @returns {string} Value yang sudah diformat
   */
  const formatPhoneInput = (value) => {
    // Hapus semua karakter non-digit
    const digits = value.replace(/\D/g, '')
    
    // Jika dimulai dengan 0, biarkan
    if (digits.startsWith('0')) {
      // Maksimal 14 digit setelah 0
      return digits.length > 15 ? digits.slice(0, 15) : digits
    }
    
    // Jika dimulai dengan 62, tambahkan +
    if (digits.startsWith('62')) {
      return '+' + (digits.length > 14 ? digits.slice(0, 14) : digits)
    }
    
    // Default: return digits saja
    return digits.length > 14 ? digits.slice(0, 14) : digits
  }

  /**
   * Handle perubahan kelas dengan validasi khusus
   * @param {string} value - Kelas baru
   */
  const handleKelasChange = (value) => {
    // Validasi: siswa sudah pernah ganti kelas dan mencoba ganti lagi
    if (kelasChangeUsed && originalKelas && value !== originalKelas) {
      pushToast(
        'error',
        'Kelas hanya bisa diubah satu kali. Jika ada kesalahan, silakan hubungi admin atau wali kelas.',
        5000
      )
      return
    }

    // Validasi: siswa punya kelas awal dan mencoba ganti
    if (originalKelas && value !== originalKelas) {
      console.log('[Kelas] Change detected, showing warning. Old:', originalKelas, 'New:', value)
      setNewKelas(value)
      setShowKelasWarning(true)
      return
    }

    // Update langsung jika validasi lolos
    const newForm = { ...form, kelas: value }
    setForm(newForm)
    setIsFormDirty(JSON.stringify(newForm) !== JSON.stringify(originalForm))
  }

  // ========= MODAL HANDLERS =========

  /**
   * Konfirmasi perubahan kelas
   */
  const confirmKelasChange = () => {
    console.log('[Kelas] Confirming change to:', newKelas)
    
    const newForm = { ...form, kelas: newKelas }
    setForm(newForm)
    setShowKelasWarning(false)
    setKelasChangeUsed(true)
    setOriginalKelas(newKelas)
    setIsFormDirty(true)
    
    pushToast(
      'warning',
      'Perubahan kelas berhasil disimpan. Pastikan untuk memeriksa data tugas dan absensi Anda.',
      4000
    )
    
    // Reset newKelas state
    setTimeout(() => setNewKelas(''), 100)
  }

  /**
   * Batalkan perubahan kelas
   */
  const cancelKelasChange = () => {
    console.log('[Kelas] Canceling change')
    setNewKelas('')
    setShowKelasWarning(false)
    
    // Kembalikan ke kelas asli
    const newForm = { ...form, kelas: originalKelas || '' }
    setForm(newForm)
    setIsFormDirty(JSON.stringify(newForm) !== JSON.stringify(originalForm))
  }

  // ========= PHOTO UPLOAD HANDLERS =========

  /**
   * Handle upload foto profil
   * @param {Event} e - Event dari input file
   */
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    console.log('[PhotoUpload] Starting upload for:', file.name)
    setUploadingPhoto(true)
    setCompressionProgress('Memproses gambar...')

    try {
      // Validasi file
      if (!file.type.startsWith('image/')) {
        throw new Error('File harus berupa gambar (JPEG, PNG, dll.)')
      }

      // Validasi ukuran maksimal 10MB
      const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
      if (file.size > MAX_FILE_SIZE) {
        throw new Error('Ukuran file terlalu besar. Maksimal 10MB.')
      }

      // Kompresi gambar
      setCompressionProgress('Mengkompresi gambar...')
      let compressedFile
      try {
        compressedFile = await compressImageTo100KB(file)
      } catch (compressError) {
        console.warn('[PhotoUpload] Compression failed, using original file:', compressError)
        compressedFile = file
      }

      // Preview sementara
      const localPreview = URL.createObjectURL(compressedFile)
      setPreview(localPreview)
      setCompressionProgress('Mengupload ke server...')

      // Upload ke Supabase Storage
      const fileExt = compressedFile.name.split('.').pop() || 'jpg'
      const fileName = `${user.id}_${Date.now()}.${fileExt}`
      const filePath = `profiles/${fileName}`

      const { error: uploadError, data } = await supabase.storage
        .from('profile-photos')
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: compressedFile.type
        })

      if (uploadError) {
        console.error('[PhotoUpload] Upload error:', uploadError)
        throw new Error(`Upload gagal: ${uploadError.message}`)
      }

      // Dapatkan URL public
      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .createSignedUrl(filePath)

      console.log('[PhotoUpload] Upload successful:', publicUrl)

      // Hapus foto lama jika ada
      if (photoURL && photoURL.includes('profile-photos')) {
        try {
          const oldFileName = photoURL.split('/').pop()
          await supabase.storage
            .from('profile-photos')
            .remove([`profiles/${oldFileName}`])
          console.log('[PhotoUpload] Old photo deleted')
        } catch (deleteError) {
          console.warn('[PhotoUpload] Failed to delete old photo:', deleteError)
        }
      }

      // Update database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          photo_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('[PhotoUpload] Database update error:', updateError)
        throw new Error(`Update database gagal: ${updateError.message}`)
      }

      // Update state dan refresh
      setPhotoURL(publicUrl)
      await refreshProfile()
      
      // Revoke object URL untuk menghindari memory leak
      if (localPreview) {
        URL.revokeObjectURL(localPreview)
      }

      pushToast(
        'success', 
        `Foto profil berhasil diperbarui (${(compressedFile.size / 1024).toFixed(1)}KB)`
      )

    } catch (error) {
      console.error('[PhotoUpload] Error:', error)
      pushToast('error', `Gagal mengupload foto: ${error.message}`)
      setPreview(photoURL)
    } finally {
      setUploadingPhoto(false)
      setCompressionProgress('')
      
      // Reset input file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  /**
   * Hapus foto profil
   */
  const handleDeletePhoto = async () => {
    if (!photoURL || !user?.id) return
    
    const confirmed = window.confirm('Apakah Anda yakin ingin menghapus foto profil?')
    if (!confirmed) return
    
    try {
      // Hapus dari storage
      if (photoURL.includes('profile-photos')) {
        const fileName = photoURL.split('/').pop()
        await supabase.storage
          .from('profile-photos')
          .remove([`profiles/${fileName}`])
      }
      
      // Update database
      await supabase
        .from('profiles')
        .update({ 
          photo_url: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
      
      // Update state
      setPhotoURL('')
      setPreview('')
      await refreshProfile()
      
      pushToast('success', 'Foto profil berhasil dihapus')
      
    } catch (error) {
      console.error('[PhotoDelete] Error:', error)
      pushToast('error', 'Gagal menghapus foto profil')
    }
  }

  // ========= PROFILE SAVE HANDLERS =========

  /**
   * Validasi form sebelum submit
   * @returns {boolean} True jika valid, false jika tidak
   */
  const validateForm = () => {
    // Required fields
    if (!form.nama.trim()) {
      pushToast('error', 'Nama lengkap harus diisi')
      return false
    }

    if (!form.jk) {
      pushToast('error', 'Jenis kelamin harus dipilih')
      return false
    }

    if (!form.kelas) {
      pushToast('error', 'Kelas harus dipilih')
      return false
    }

    // Nama validation
    const namaRegex = /^[a-zA-Z\s.'-]+$/
    if (form.nama && !namaRegex.test(form.nama)) {
      pushToast('error', 'Nama hanya boleh mengandung huruf, spasi, titik, apostrof, dan tanda hubung')
      return false
    }

    // Phone validation
    if (noHpSiswaError) {
      pushToast('error', `Nomor HP Siswa: ${noHpSiswaError}`)
      return false
    }

    if (noHpWaliError) {
      pushToast('error', `Nomor HP Wali: ${noHpWaliError}`)
      return false
    }

    // Age validation
    if (form.usia) {
      const age = parseInt(form.usia)
      if (age < 10 || age > 30) {
        pushToast('error', 'Usia harus antara 10-30 tahun')
        return false
      }
    }

    return true
  }

  /**
   * Simpan data profil ke database
   */
  const handleSaveProfile = async () => {
    if (!user?.id || !validateForm()) return

    setSaving(true)
    
    try {
      const updateData = {
        nama: form.nama.trim(),
        jk: form.jk,
        nik: form.nik ? form.nik.trim() : null,
        usia: form.usia ? parseInt(form.usia) : null,
        kelas: form.kelas,
        no_hp_siswa: form.no_hp_siswa ? form.no_hp_siswa.trim() : null,
        no_hp_wali: form.no_hp_wali ? form.no_hp_wali.trim() : null,
        updated_at: new Date().toISOString()
      }

      // Tandai jika kelas berubah (hanya sekali)
      if (form.kelas !== originalKelas && !kelasChangeUsed) {
        updateData.kelas_change_used = true
      }

      console.log('[ProfileSave] Updating profile:', updateData)

      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select()
        .single()

      if (error) {
        console.error('[ProfileSave] Database error:', error)
        throw new Error(error.message || 'Gagal menyimpan profil')
      }

      console.log('[ProfileSave] Update successful:', data)

      // Update state
      setOriginalForm(form)
      setIsFormDirty(false)
      setOriginalKelas(form.kelas)
      
      if (form.kelas !== originalKelas && !kelasChangeUsed) {
        setKelasChangeUsed(true)
      }

      // Refresh profile data
      await refreshProfile()
      
      pushToast('success', 'Profil berhasil diperbarui')

    } catch (error) {
      console.error('[ProfileSave] Error:', error)
      pushToast('error', error.message || 'Gagal menyimpan profil')
      
      // Reset form ke state terakhir yang berhasil
      if (profile) {
        setForm({
          nama: profile.nama || '',
          jk: profile.jk || '',
          nik: profile.nik || '',
          usia: profile.usia || '',
          kelas: profile.kelas || '',
          no_hp_siswa: profile.no_hp_siswa || '',
          no_hp_wali: profile.no_hp_wali || ''
        })
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Reset form ke data asli
   */
  const handleResetForm = () => {
    setForm(originalForm)
    setIsFormDirty(false)
    setNamaError('')
    setNoHpSiswaError('')
    setNoHpWaliError('')
    pushToast('info', 'Form telah direset ke data asli')
  }

  // ========= EMAIL VERIFICATION =========

  /**
   * Kirim ulang email verifikasi
   */
  const handleSendVerification = async () => {
    if (!user) return

    setSendingVerify(true)
    
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
      })

      if (error) throw error

      pushToast('success', 'Email verifikasi telah dikirim. Silakan cek inbox Anda (dan folder spam).')
      
    } catch (error) {
      console.error('[EmailVerify] Error:', error)
      pushToast('error', 'Gagal mengirim email verifikasi. Coba lagi nanti.')
    } finally {
      setSendingVerify(false)
    }
  }

  // ========= UTILITY FUNCTIONS =========

  const email = user?.email || profile?.email || ''
  const emailVerified = user?.email_confirmed_at || user?.emailVerified
  
  /**
   * Dapatkan nama kelas yang sudah diformat untuk display
   */
  const getDisplayKelas = (kelasSlug) => {
    if (!kelasSlug) return 'Belum ditentukan'
    const kelasData = kelasList.find(k => k.id === kelasSlug)
    return kelasData ? kelasData.nama : formatKelasDisplay(kelasSlug)
  }

  /**
   * Hitung jumlah field yang sudah diisi
   */
  const getFilledFieldCount = () => {
    const requiredFields = ['nama', 'jk', 'kelas']
    const filledRequired = requiredFields.filter(field => form[field]).length
    
    const optionalFields = ['nik', 'usia', 'no_hp_siswa', 'no_hp_wali']
    const filledOptional = optionalFields.filter(field => form[field]).length
    
    return {
      required: filledRequired,
      optional: filledOptional,
      totalRequired: requiredFields.length,
      totalOptional: optionalFields.length
    }
  }

  const fieldStats = getFilledFieldCount()

  // ========= RENDER =========

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        
        {/* ========= HEADER ========= */}
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
            
            <div className="flex flex-col gap-3">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl px-5 py-3 shadow-lg shadow-blue-500/25">
                <p className="text-white text-center font-medium">
                  <span className="block text-xs opacity-90 mb-1">Status Akun</span>
                  <span className="block text-lg">
                    {profile?.status === 'active' ? '🟢 Aktif' : '🔴 Nonaktif'}
                  </span>
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
          
          {/* ========= LEFT SIDEBAR: PHOTO & INFO ========= */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Photo Card */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              <div className="flex flex-col items-center gap-5">
                
                {/* Photo Container */}
                <div className="relative group">
                  <div className="relative w-32 h-32">
                    {preview ? (
                      <img
                        src={preview}
                        alt="Foto Profil"
                        className="w-32 h-32 rounded-2xl object-cover border-4 border-white shadow-xl"
                        onError={(e) => {
                          console.error('[Photo] Error loading image, using fallback')
                          e.target.style.display = 'none'
                          e.target.parentElement.innerHTML = `
                            <div class="w-32 h-32 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 border-4 border-white shadow-xl flex items-center justify-center">
                              <span class="text-4xl text-blue-500">👤</span>
                            </div>
                          `
                        }}
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
                            {compressionProgress}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Photo Action Buttons */}
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
                    
                    {photoURL && (
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

                {/* Student Info */}
                <div className="text-center">
                  <h2 className="font-bold text-xl text-slate-800 mb-2 line-clamp-2 break-words">
                    {form.nama || profile?.nama || 'Siswa'}
                  </h2>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full text-xs font-medium shadow-md mb-2">
                    <span>🏫</span>
                    <span>{getDisplayKelas(profile?.kelas) || 'Kelas belum ditentukan'}</span>
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-1 break-all">
                    {email || 'Email tidak tersedia'}
                  </p>
                </div>

                {/* Compression Info */}
                <div className="w-full p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-xs text-blue-700 text-center">
                    📷 Foto otomatis dikompresi ke <strong>maksimal 100KB</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Verification Status Card */}
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

            {/* School Info Card */}
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
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    }) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Hak ganti kelas</span>
                  <span className={`font-semibold text-xs ${
                    kelasChangeUsed ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {kelasChangeUsed ? 'Sudah digunakan' : 'Masih tersedia'}
                  </span>
                </div>
              </div>
            </div>

            {/* Contact Info Card */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-5">
              <h4 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="text-blue-500">📱</span>
                <span>Kontak</span>
              </h4>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-slate-500 block mb-1">HP Siswa</span>
                  <span className="font-semibold text-slate-800">
                    {formatPhoneDisplay(form.no_hp_siswa) || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">HP Orang Tua/Wali</span>
                  <span className="font-semibold text-slate-800">
                    {formatPhoneDisplay(form.no_hp_wali) || '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* Logout Button */}
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

          {/* ========= MAIN CONTENT: EDIT FORM ========= */}
          <div className="lg:col-span-3">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100/50 p-6">
              {/* Form Header */}
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                    <span className="text-lg text-white">📝</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Informasi Pribadi</h3>
                    <p className="text-slate-600 text-sm mt-1">
                      Perbarui data profil Anda dengan informasi yang valid dan terbaru
                    </p>
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

              {/* Form Fields Grid */}
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
                    maxLength={100}
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
                  {originalKelas && (
                    <p className="mt-2 text-xs text-orange-600 flex items-center gap-1.5">
                      <span>💡</span>
                      <span>
                        {kelasChangeUsed 
                          ? 'Anda sudah menggunakan hak perubahan kelas. Hubungi admin jika ada kesalahan.'
                          : 'Anda memiliki 1 kesempatan untuk mengubah kelas. Pastikan pilihan benar.'
                        }
                      </span>
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
                    placeholder="16 digit NIK (opsional)"
                    maxLength={16}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Contoh: 3372031701010001
                  </p>
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
                    placeholder="10-30 tahun (opsional)"
                  />
                </div>

                {/* Email (Read-only) */}
                <div>
                  <label className="flex text-sm font-semibold text-slate-700 mb-2 items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    Email
                  </label>
                  <div className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 break-all">
                    {email || 'Email tidak tersedia'}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Email tidak dapat diubah. Hubungi admin jika perlu perubahan.
                  </p>
                </div>

                {/* Nomor HP Siswa */}
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
                  {noHpSiswaError ? (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{noHpSiswaError}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Contoh: 081234567890 atau +6281234567890
                    </p>
                  )}
                </div>

                {/* Nomor HP Wali */}
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
                  {noHpWaliError ? (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{noHpWaliError}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Contoh: 081234567890 atau +6281234567890
                    </p>
                  )}
                </div>
              </div>

              {/* Additional Info */}
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
                    <span className="text-slate-600">
                      Perubahan kelas hanya bisa dilakukan terbatas. Jika salah, hubungi admin.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">📱</span>
                    <span className="text-slate-600">Nomor HP akan digunakan untuk komunikasi penting</span>
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-8 pt-6 border-t border-slate-200">
                <div className="flex items-center gap-4">
                  <div className="text-xs text-slate-500">
                    <span className="text-red-500">*</span> Menandakan field yang wajib diisi
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
                    disabled={saving || !isFormDirty || !form.nama.trim() || !form.jk || namaError || !form.kelas || noHpSiswaError || noHpWaliError}
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

      {/* ========= MODAL: KELAS CHANGE WARNING ========= */}
      {showKelasWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-orange-200 max-w-md w-full p-6 transform animate-scale-in">
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-orange-500/25">
                <span className="text-xl text-white">⚠️</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Konfirmasi Perubahan Kelas</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                <strong className="text-orange-600">Perubahan kelas dapat mempengaruhi:</strong>
              </p>
              
              <ul className="text-left text-sm text-slate-600 mb-4 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>Data tugas dan deadline</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>Absensi dan jadwal pelajaran</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>Nilai dan raport</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>Grup kelas dan komunikasi</span>
                </li>
              </ul>
              
              <div className="bg-orange-50 rounded-xl p-3 border border-orange-200 mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-slate-700 font-medium">Saat ini:</span>
                  <span className="font-semibold text-slate-800">{getDisplayKelas(originalKelas)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 font-medium">Akan berubah menjadi:</span>
                  <span className="font-semibold text-blue-600">{getDisplayKelas(newKelas)}</span>
                </div>
              </div>
              
              <p className="text-xs text-orange-600 font-medium">
                ⚠️ Anda hanya memiliki <strong>1 kesempatan</strong> untuk mengubah kelas.
              </p>
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