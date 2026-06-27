// src/pages/siswa/EditProfile.jsx
import React, { useState, useEffect, useRef } from 'react'
import { supabase, PROFILE_BUCKET, getSignedUrlForValue } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import GoogleCredentialButton from '../../components/GoogleCredentialButton'
import PasswordInput from '../../components/PasswordInput'
import VerificationCodeModal from '../../components/VerificationCodeModal'
import UserThemeSettings from '../../components/UserThemeSettings'
import AccountSecurityPanel from '../../components/AccountSecurityPanel'
import {
  AlertCircle,
  BookOpen,
  Camera,
  CheckCircle2,
  FilePenLine,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Trash2,
  UserRound
} from 'lucide-react'
import {
  hasRealLoginEmail,
  isEmailFormat,
  shouldForceAccountSetup
} from '../../utils/accountSetup'
import { completeGoogleLinkOAuthFlow } from '../../utils/googleLinking'
import { sanitizeText } from '../../utils/sanitize'
import { validatePassword } from '../../utils/passwordPolicy'
import { religionSelectOptions } from '../../constants/religionOptions'

// ==================== STORAGE CONFIG ====================
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
  if (file.size <= maxBytes && /^image\/jpe?g$/i.test(file.type || '')) return file

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
  const { user, profile, logout, refreshProfile, linkGoogleCredential, refreshAuthSession, markGoogleLinked } = useAuthStore()
  const { pushToast } = useUIStore()

  const fileInputRef = useRef(null)

  // Form
  const [form, setForm] = useState({
    nama: '',
    jk: '',
    agama: '',
    nis: '',
    usia: '',
    kelas: '',
    no_hp_siswa: '',
    no_hp_wali: ''
  })

  const [originalForm, setOriginalForm] = useState({})
  const [isFormDirty, setIsFormDirty] = useState(false)

  // Validations
  const [noHpSiswaError, setNoHpSiswaError] = useState('')
  const [noHpWaliError, setNoHpWaliError] = useState('')

  // Kelas logic
  const [kelasList, setKelasList] = useState([])

  // Photo states (DB simpan PATH saja)
  const [photoPath, setPhotoPath] = useState('') // objectKey (ideal)
  const [photoURL, setPhotoURL] = useState('')   // signed url (UI only)
  const [preview, setPreview] = useState('')     // UI preview (local or signed)
  const [imgBroken, setImgBroken] = useState(false)

  // UI states
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false)
  const [accountVerifyOpen, setAccountVerifyOpen] = useState(false)
  const [pendingAccountAction, setPendingAccountAction] = useState(null)

  const providerState = supabase.auth.getProviderState?.(user || {}) || { googleLinked: false, emailVerified: false }
  const googleLinked = Boolean(user?.google_linked || providerState.googleLinked)
  const email = user?.email || profile?.email || ''
  const emailVerified = Boolean(user?.email_confirmed_at || user?.emailVerified || providerState.emailVerified)
  const googleLinkBlockedReason = profile?.role === 'siswa' && profile?.must_change_password
    ? 'Tautkan Google akan tersedia setelah Anda mengganti password awal akun siswa ini.'
    : !hasRealLoginEmail(email)
      ? 'Tautkan Google akan tersedia setelah email akun diganti dari email sistem ke email aktif yang sama dengan akun Google Anda.'
      : ''

  const [accountForm, setAccountForm] = useState({
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [accountSaving, setAccountSaving] = useState(false)
  const [showPasswordFields, setShowPasswordFields] = useState(false)

  const needsAccountSetup = shouldForceAccountSetup(profile, user?.email)

  useEffect(() => {
    if (!accountForm.email && email) {
      setAccountForm((prev) => ({ ...prev, email }))
    }
  }, [email]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    const googleError = String(url.searchParams.get('google_error') || '').trim()
    if (!googleError) return

    pushToast('error', googleError)
    url.searchParams.delete('google')
    url.searchParams.delete('google_error')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  }, [pushToast])

  useEffect(() => {
    if (needsAccountSetup) {
      setShowPasswordFields(true)
    }
  }, [needsAccountSetup])

  // ==================== DATA LOAD ====================

  const loadKelasList = async () => {
    try {
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
    const signedUrl = await getSignedUrlForValue(PROFILE_BUCKET, objectKey, SIGNED_URL_EXPIRES_IN)
    return signedUrl ? addCacheBuster(signedUrl) : ''
  }

  // Update DB: simpan PATH saja (anti IDOR dibantu policy + trigger)
  const updateProfilePhotoPathInDb = async (uid, objectKeyOrNull) => {
    const payload = {
      photo_path: objectKeyOrNull,
      photo_url: objectKeyOrNull,
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
        ; ({ error } = await supabase.from('profiles').update(fallbackPayload).eq('id', uid))
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
      agama: profile.agama || '',
      nis: profile.nis || '',
      usia: profile.usia || '',
      kelas: profile.kelas || '',
      no_hp_siswa: profile.no_hp_siswa || '',
      no_hp_wali: profile.no_hp_wali || ''
    }

    setForm(initialForm)
    setOriginalForm(initialForm)
    setIsFormDirty(false)

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
    if (value !== form.kelas) {
      pushToast('warning', 'Kelas hanya bisa diubah oleh admin.', 5000)
    }
  }

  const handleFieldChange = (key, value) => {
    let processedValue = value

    switch (key) {
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
        compressed = await compressImageToMaxBytes(file, 50 * 1024)
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

      const { data: uploadData, error: uploadError } = await supabase.storage
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

      const finalSizeBytes = Number(uploadData?.uploadedSizeBytes || compressed.size || 0)
      pushToast(
        'success',
        `Foto profil berhasil diperbarui (${(finalSizeBytes / 1024).toFixed(1)}KB)`
      )
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
    if (!form.jk) return pushToast('error', 'Jenis kelamin harus dipilih') || false

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
        jk: form.jk,
        agama: form.agama || null,
        nis: form.nis ? form.nis.trim() : null,
        usia: form.usia ? parseInt(form.usia, 10) : null,
        no_hp_siswa: form.no_hp_siswa ? form.no_hp_siswa.trim() : null,
        no_hp_wali: form.no_hp_wali ? form.no_hp_wali.trim() : null,
        updated_at: new Date().toISOString()
      }

      const { error } = await supabase.from('profiles').update(updateData).eq('id', user.id)
      if (error) throw error

      setOriginalForm(form)
      setIsFormDirty(false)

      await refreshProfile()
      pushToast('success', 'Profil berhasil diperbarui')
    } catch (err) {
      pushToast('error', err.message || 'Gagal menyimpan profil')

      // rollback tampilan ke profile terakhir
      if (profile) {
        const rollback = {
          nama: profile.nama || '',
          jk: profile.jk || '',
          agama: profile.agama || '',
          nis: profile.nis || '',
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
    setNoHpSiswaError('')
    setNoHpWaliError('')
    pushToast('info', 'Form telah direset ke data asli')
  }

  const handleTogglePasswordFields = () => {
    if (showPasswordFields) {
      setShowPasswordFields(false)
      setAccountForm((prev) => ({ ...prev, password: '', confirmPassword: '' }))
      return
    }

    setShowPasswordFields(true)
  }

  const buildAccountChangePlan = () => {
    const currentEmail = (email || '').trim().toLowerCase()
    const nextEmail = (accountForm.email || '').trim().toLowerCase()
    const wantsPasswordChange = showPasswordFields && Boolean(accountForm.password)
    const emailChanged = nextEmail !== currentEmail
    const currentEmailIsReal = hasRealLoginEmail(currentEmail)
    const nextEmailIsReal = hasRealLoginEmail(nextEmail)

    if (emailChanged) {
      if (!nextEmail) {
        throw new Error('Email baru wajib diisi sebelum menyimpan perubahan akun')
      }
      if (!isEmailFormat(nextEmail) || !nextEmailIsReal) {
        throw new Error('Email aktif baru tidak valid')
      }
      if (googleLinked && currentEmailIsReal) {
        throw new Error('Lepas tautan Google terlebih dahulu sebelum mengganti email akun.')
      }
    }

    if (wantsPasswordChange) {
      const pwdCheck = validatePassword(accountForm.password)
      if (!pwdCheck.valid) {
        throw new Error(pwdCheck.errors[0])
      }
      if (accountForm.password !== accountForm.confirmPassword) {
        throw new Error('Password dan konfirmasi tidak sama')
      }
    }

    if (!emailChanged && !wantsPasswordChange) {
      throw new Error('Belum ada perubahan email atau password yang bisa disimpan')
    }

    const targetEmail = emailChanged ? nextEmail : currentEmail
    const requiresVerification = emailChanged || !needsAccountSetup

    let verificationTitle = 'Konfirmasi Perubahan Akun'
    let verificationDescription = 'Kirim kode 6 digit ke email tujuan untuk menyimpan perubahan email atau password akun.'
    let verificationInputDescription = 'Masukkan kode 6 digit dari email tujuan. Kode ini dipakai untuk memastikan perubahan akun benar-benar Anda lakukan.'

    if (emailChanged && wantsPasswordChange) {
      verificationTitle = 'Verifikasi Email Baru'
      verificationDescription = 'Sebelum email akun diganti, sistem akan mengirim kode 6 digit ke email baru ini. Setelah lolos, email dan password baru disimpan sekaligus.'
      verificationInputDescription = 'Masukkan kode 6 digit dari email baru. Setelah cocok, email baru akan aktif dan password baru ikut disimpan.'
    } else if (emailChanged) {
      verificationTitle = 'Verifikasi Email Baru'
      verificationDescription = 'Sebelum email akun diganti, sistem akan mengirim kode 6 digit ke email baru ini.'
      verificationInputDescription = 'Masukkan kode 6 digit dari email baru. Setelah cocok, email akun akan diganti ke email aktif tersebut.'
    } else if (wantsPasswordChange) {
      verificationTitle = 'Konfirmasi Ganti Password'
      verificationDescription = 'Sistem akan mengirim kode 6 digit ke email aktif akun ini untuk memastikan perubahan password benar-benar Anda lakukan.'
      verificationInputDescription = 'Masukkan kode 6 digit dari email aktif akun. Setelah cocok, password baru akan langsung disimpan.'
    }

    return {
      nextEmail,
      password: wantsPasswordChange ? accountForm.password : '',
      emailChanged,
      wantsPasswordChange,
      targetEmail,
      requiresVerification,
      verificationTitle,
      verificationDescription,
      verificationInputDescription,
      successMessage: emailChanged && wantsPasswordChange
        ? 'Email dan password berhasil diperbarui'
        : emailChanged
          ? 'Email berhasil diperbarui'
          : 'Password berhasil diperbarui'
    }
  }

  const submitAccountChange = async (plan, verificationCode = '') => {
    setAccountSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        email: plan.nextEmail,
        password: plan.password,
        verificationCode
      })
      if (error) throw error

      setAccountForm((prev) => ({
        ...prev,
        email: plan.nextEmail,
        password: '',
        confirmPassword: ''
      }))
      if (plan.wantsPasswordChange) {
        setShowPasswordFields(false)
      }
      await refreshProfile()
      pushToast('success', plan.successMessage)
    } catch (err) {
      throw err
    } finally {
      setAccountSaving(false)
    }
  }

  const handleCompleteAccount = async () => {
    if (!user?.id) return

    try {
      const plan = buildAccountChangePlan()
      if (plan.requiresVerification) {
        setPendingAccountAction(plan)
        setAccountVerifyOpen(true)
        return
      }

      await submitAccountChange(plan)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memperbarui akun')
    }
  }

  const handleLinkGoogle = async (credential) => {
    if (googleLinkBlockedReason) {
      pushToast('info', googleLinkBlockedReason)
      return
    }

    if (googleLinked) {
      pushToast('info', 'Akun Google sudah tertaut.')
      return
    }

    setLinkingGoogle(true)
    try {
      const result = await linkGoogleCredential(credential)
      if (result?.error) return result
      await refreshProfile()
      return result
    } finally {
      setLinkingGoogle(false)
    }
  }

  const handleLinkGoogleOAuthSuccess = async (popupResult = {}) => {
    if (googleLinkBlockedReason) {
      pushToast('info', googleLinkBlockedReason)
      return
    }

    if (googleLinked) {
      pushToast('info', 'Akun Google sudah tertaut.')
      return
    }

    setLinkingGoogle(true)
    try {
      const result = await completeGoogleLinkOAuthFlow({
        popupResult,
        googleLinked,
        markGoogleLinked,
        refreshAuthSession,
        refreshProfile,
        expectedEmail: email
      })
      pushToast('success', 'Akun Google berhasil ditautkan', {
        title: 'Google Tertaut',
        duration: 5200
      })
      return result
    } finally {
      setLinkingGoogle(false)
    }
  }

  const handleUnlinkGoogle = async () => {
    if (!googleLinked) {
      pushToast('info', 'Akun Google belum tertaut.')
      return
    }

    const confirmed = window.confirm(
      'Yakin ingin melepas tautan Google? Setelah ini login Google dinonaktifkan untuk akun ini.'
    )
    if (!confirmed) return

    setUnlinkingGoogle(true)
    try {
      const { data, error } = await supabase.auth.unlinkGoogleAccount()
      if (error) throw error
      if (data?.user) {
        useAuthStore.setState((state) => ({ ...state, user: data.user }))
      }
      await refreshProfile()
      pushToast('success', 'Tautan Google berhasil dilepas.', {
        title: 'Google Dilepas',
        duration: 5200
      })
    } catch (error) {
      pushToast('error', error?.message || 'Gagal melepas tautan Google')
    } finally {
      setUnlinkingGoogle(false)
    }
  }

  // ==================== UI HELPERS ====================

  const getDisplayKelas = (kelasSlug) => {
    if (!kelasSlug) return 'Belum ditentukan'
    const k = kelasList.find((x) => x.id === kelasSlug)
    return k ? k.nama : formatKelasDisplay(kelasSlug)
  }

  const securityAccountCard = (
    <div
      className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${needsAccountSetup
        ? 'border-amber-200'
        : 'border-blue-200'
        }`}
    >
      <div className={`h-1.5 ${needsAccountSetup ? 'bg-amber-400' : 'bg-blue-500'}`} />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              needsAccountSetup ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
            }`}>
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Akses Akun</p>
              <h2 className="mt-0.5 text-base font-bold text-slate-900">
                {needsAccountSetup ? 'Lengkapi Akun' : 'Keamanan Akun'}
              </h2>
            </div>
          </div>
          <span
            className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
              needsAccountSetup ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {needsAccountSetup ? 'Perlu Setup' : 'Aktif'}
          </span>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Email Akun</label>
              <input
                type="email"
                value={accountForm.email}
                onChange={(e) =>
                  setAccountForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="nama@email.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {!isEmailFormat(accountForm.email) && accountForm.email && (
                <p className="text-xs text-red-600">Format email tidak valid</p>
              )}
            </div>

            {showPasswordFields && (
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Password Baru</label>
                <PasswordInput
                  value={accountForm.password}
                  onChange={(e) =>
                    setAccountForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  placeholder="Minimal 6 karakter"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}

            {showPasswordFields && (
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Ulangi Password</label>
                <PasswordInput
                  value={accountForm.confirmPassword}
                  onChange={(e) =>
                    setAccountForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  }
                  placeholder="Ulangi password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleTogglePasswordFields}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
            >
              {showPasswordFields ? 'Batal Ganti Password' : 'Ganti Password'}
            </button>
            <button
              type="button"
              onClick={handleCompleteAccount}
              disabled={accountSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {accountSaving
                ? 'Menyimpan...'
                : needsAccountSetup
                  ? 'Simpan Setup Akun'
                  : 'Simpan Perubahan Akun'}
            </button>
          </div>
        </div>

        {googleLinked && hasRealLoginEmail(email) && (
          <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
            Email akun sedang tertaut dengan Google. Lepas tautan Google terlebih dahulu jika ingin mengganti email akun ini.
          </p>
        )}

        <div className="mt-4 rounded-2xl border border-blue-100 bg-white px-3 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-sm font-bold text-slate-700">
                G
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Tautkan Login Google</h3>
            </div>

            <div className="flex flex-col items-stretch gap-2 md:items-end">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${googleLinked
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-700'
                }`}
              >
                {googleLinked ? 'Google Tertaut' : 'Belum Tertaut'}
              </span>
              {!googleLinked && !googleLinkBlockedReason && (
                <GoogleCredentialButton
                  mode="link"
                  onCredential={handleLinkGoogle}
                  onOAuthSuccess={handleLinkGoogleOAuthSuccess}
                  busy={linkingGoogle}
                  className="w-full md:w-[260px]"
                  buttonClassName="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  noteClassName="text-xs text-slate-600"
                  label="Tautkan Google"
                  busyLabel="Memproses tautan Google..."
                  expectedEmail={email}
                />
              )}
              {!googleLinked && googleLinkBlockedReason && (
                <div className="w-full md:w-[260px] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  {googleLinkBlockedReason}
                </div>
              )}
              {googleLinked && (
                <button
                  type="button"
                  onClick={handleUnlinkGoogle}
                  disabled={unlinkingGoogle || linkingGoogle}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {unlinkingGoogle ? 'Melepas...' : 'Lepas Tautan'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // ==================== RENDER ====================

  return (
    <div className="space-y-6 p-4 sm:p-6">
        {/* HEADER */}
        <div className="page-title-card">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div className="flex items-center gap-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
                <UserRound className="h-6 w-6" />
              </div>
              <div>
                <h1 className="page-title-heading">
                  Profil Siswa
                </h1>
                <p className="page-title-description">Kelola informasi profil dan foto Anda dengan aman</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${profile?.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <span className="block text-xs font-medium text-slate-500">Status Akun</span>
                  <span className={`block text-sm font-semibold ${profile?.status === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {profile?.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
              </div>

            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* SIDEBAR */}
          <div className="space-y-6">
            {/* PHOTO CARD */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="h-20 border-b border-slate-100 bg-slate-100" />
              <div className="-mt-16 p-6 pt-0">
              <div className="flex flex-col items-center gap-5">
                <div className="relative group">
                  <div className="relative h-32 w-32">
                    {preview && !imgBroken ? (
                      <img
                        src={preview}
                        alt="Foto Profil"
                        className="h-32 w-32 rounded-3xl border-4 border-white object-cover shadow-sm"
                        onError={() => setImgBroken(true)}
                      />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded-3xl border-4 border-white bg-slate-100 text-4xl font-bold text-slate-500 shadow-sm">
                        {(form.nama || profile?.nama || 'S').charAt(0).toUpperCase()}
                      </div>
                    )}

                    {(uploadingPhoto || progressText) && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-slate-900/50 backdrop-blur-sm">
                        <div className="text-center">
                          <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                          <p className="text-white text-xs font-medium">{progressText}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="absolute -bottom-2 -right-2 flex gap-2">
                    <label
                      htmlFor="photo-input"
                      className={`${uploadingPhoto
                        ? 'cursor-not-allowed bg-slate-400'
                        : 'cursor-pointer bg-slate-900 shadow-sm hover:bg-slate-800'
                        } rounded-2xl p-3 text-white transition-all duration-200`}
                      title="Ubah Foto"
                    >
                      <Camera className="h-5 w-5" />
                    </label>

                    {(photoPath || photoURL) && (
                      <button
                        onClick={handleDeletePhoto}
                        className="rounded-2xl bg-white p-3 text-rose-600 shadow-sm ring-1 ring-rose-200 transition-all duration-200 hover:bg-rose-50"
                        title="Hapus Foto"
                        disabled={uploadingPhoto}
                      >
                        <Trash2 className="h-5 w-5" />
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
                  <h2 className="mb-2 line-clamp-2 break-words text-xl font-bold text-slate-900">
                    {form.nama || profile?.nama || 'Siswa'}
                  </h2>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>{getDisplayKelas(profile?.kelas) || 'Kelas belum ditentukan'}</span>
                  </div>
                  <p className="text-slate-600 text-sm line-clamp-1 break-all">{email || 'Email tidak tersedia'}</p>
                </div>

              </div>
              </div>
            </div>

            <UserThemeSettings />

            {/* VERIFICATION */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-4">
                <div
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${emailVerified
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                >
                  {emailVerified ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Email Terverifikasi</span>
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      <span>Email Belum Terverifikasi</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* SCHOOL INFO */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
                <BookOpen className="h-4 w-4 text-emerald-600" />
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
                  <span className="text-slate-500">Pengubahan kelas</span>
                  <span className="font-semibold text-xs text-slate-700">Hanya admin</span>
                </div>
              </div>
            </div>

            {/* CONTACT */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
                <Phone className="h-4 w-4 text-emerald-600" />
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              <span className="font-semibold">Keluar</span>
            </button>
          </div>

          {/* MAIN FORM */}
          <div>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-white p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                      <FilePenLine className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Profil Siswa</p>
                      <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">Informasi Pribadi</h3>
                    </div>
                  </div>

                  {isFormDirty && (
                    <button
                      onClick={handleResetForm}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-2">
                {/* NAMA */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700"
                    value={form.nama}
                    readOnly
                    disabled
                  />
                </div>

                {/* KELAS */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Kelas
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700"
                    value={getDisplayKelas(form.kelas)}
                    readOnly
                  />
                </div>

                {/* JK */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Jenis Kelamin <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 transition-all duration-200 hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                    value={form.jk}
                    onChange={(e) => handleFieldChange('jk', e.target.value)}
                  >
                    <option value="">Pilih Jenis Kelamin</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>

                {/* AGAMA */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Agama
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 transition-all duration-200 hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                    value={form.agama}
                    onChange={(e) => handleFieldChange('agama', e.target.value)}
                  >
                    {religionSelectOptions(form.agama).map((option) => (
                      <option key={option.value || 'empty'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* NIS */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    NIS
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 placeholder-slate-400 transition-all duration-200 hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                    value={form.nis}
                    onChange={(e) => handleFieldChange('nis', e.target.value)}
                    placeholder="16 digit (opsional)"
                    maxLength={16}
                  />
                </div>

                {/* USIA */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Usia
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="30"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 placeholder-slate-400 transition-all duration-200 hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"
                    value={form.usia}
                    onChange={(e) => handleFieldChange('usia', e.target.value)}
                    placeholder="10-30 tahun (opsional)"
                  />
                </div>

                {/* EMAIL */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Email
                  </label>
                  <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600 break-all">
                    {email || 'Email tidak tersedia'}
                  </div>
                </div>

                {/* HP SISWA */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Nomor HP Siswa
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-slate-500 text-sm">+62</span>
                    </div>
                    <input
                      type="tel"
                      className={`w-full rounded-xl border bg-white px-4 py-3 pl-12 transition-all duration-200 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100 ${noHpSiswaError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      value={form.no_hp_siswa}
                      onChange={(e) => handleFieldChange('no_hp_siswa', e.target.value)}
                      placeholder="81234567890"
                      maxLength={14}
                    />
                  </div>
                  {noHpSiswaError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{noHpSiswaError}</span>
                    </p>
                  )}
                </div>

                {/* HP WALI */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Nomor HP Orang Tua/Wali
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-slate-500 text-sm">+62</span>
                    </div>
                    <input
                      type="tel"
                      className={`w-full rounded-xl border bg-white px-4 py-3 pl-12 transition-all duration-200 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100 ${noHpWaliError ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      value={form.no_hp_wali}
                      onChange={(e) => handleFieldChange('no_hp_wali', e.target.value)}
                      placeholder="81234567890"
                      maxLength={14}
                    />
                  </div>
                  {noHpWaliError && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{noHpWaliError}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
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
                    className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reset
                  </button>

                  <button
                    onClick={handleSaveProfile}
                    disabled={
                      saving ||
                      !isFormDirty ||
                      !form.jk ||
                      !!noHpSiswaError ||
                      !!noHpWaliError
                    }
                    className="flex items-center gap-2 rounded-xl bg-slate-900 px-8 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Simpan Perubahan</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {securityAccountCard}
        <AccountSecurityPanel tone="blue" />
        <VerificationCodeModal
          isOpen={accountVerifyOpen}
          onClose={() => {
            if (accountSaving) return
            setAccountVerifyOpen(false)
            setPendingAccountAction(null)
          }}
          onSuccess={() => {
            setAccountVerifyOpen(false)
            setPendingAccountAction(null)
          }}
          email={pendingAccountAction?.targetEmail || ''}
          title={pendingAccountAction?.verificationTitle || 'Konfirmasi Perubahan Akun'}
          description={pendingAccountAction?.verificationDescription || 'Kirim kode 6 digit ke email tujuan untuk menyimpan perubahan email atau password akun.'}
          inputDescription={pendingAccountAction?.verificationInputDescription || 'Masukkan kode 6 digit dari email tujuan. Kode ini dipakai untuk memastikan perubahan akun benar-benar Anda lakukan.'}
          sendLabel="Kirim Kode 6 Digit"
          confirmLabel="Simpan Perubahan"
          successTitle="Perubahan Akun Berhasil!"
          successSubtitle={pendingAccountAction?.successMessage || 'Perubahan akun berhasil disimpan.'}
          onSendCode={async () => {
            const plan = pendingAccountAction || buildAccountChangePlan()
            const { error } = await supabase.auth.sendPasswordChangeCode(plan.targetEmail)
            if (error) throw error
          }}
          onVerifyCode={async (code) => {
            const plan = pendingAccountAction || buildAccountChangePlan()
            await submitAccountChange(plan, code)
          }}
        />
    </div>
  )
}
