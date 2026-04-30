// src/pages/guru/profile.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, PROFILE_BUCKET } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import GoogleCredentialButton from '../../components/GoogleCredentialButton'
import PasswordInput from '../../components/PasswordInput'
import VerificationCodeModal from '../../components/VerificationCodeModal'
import {
  hasRealLoginEmail,
  isEmailFormat,
  shouldForceAccountSetup
} from '../../utils/accountSetup'
import { validatePassword } from '../../utils/passwordPolicy'

/** Signed URL expire (detik) */
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 7 // 7 hari

/** Max file sebelum kompres */
const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024 // 5MB

/** Target kompres */
const MAX_COMPRESSED_BYTES = 100 * 1024 // 100KB

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

function addCacheBuster(url) {
  if (!url) return ''
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}t=${Date.now()}`
}

/* ========= Helper: kompres gambar ke <= 100KB ========= */
async function compressImageTo100KB(file, maxBytes = MAX_COMPRESSED_BYTES) {
  if (!file || file.size <= maxBytes) return file

  // pakai objectURL lalu revoke setelah selesai
  const objectUrl = URL.createObjectURL(file)

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Gagal memuat gambar'))
      image.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas tidak didukung')

    // Optimasi dimensi - maksimal 400px untuk hemat size
    const MAX_DIMENSION = 400
    let { width, height } = img

    if (width > height && width > MAX_DIMENSION) {
      height = (height * MAX_DIMENSION) / width
      width = MAX_DIMENSION
    } else if (height > MAX_DIMENSION) {
      width = (width * MAX_DIMENSION) / height
      height = MAX_DIMENSION
    }

    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))

    canvas.width = width
    canvas.height = height

    // background putih biar png transparan jadi rapih
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    // Kompresi progresif
    let quality = 0.82
    let lastBlob = null

    while (quality >= 0.3) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality)
      })

      if (!blob) break
      lastBlob = blob

      if (blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
          type: 'image/jpeg'
        })
      }

      quality -= 0.08
    }

    // fallback: blob terakhir
    if (lastBlob && lastBlob.size <= 2 * maxBytes) {
      return new File([lastBlob], file.name.replace(/\.\w+$/, '') + '.jpg', {
        type: 'image/jpeg'
      })
    }

    throw new Error('Gambar terlalu besar, gunakan gambar yang lebih kecil')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function createSignedUrlOrThrow(path) {
  const { data, error } = await supabase.storage
    .from(PROFILE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN)

  if (error) throw error
  const signedUrl = data?.signedUrl
  if (!signedUrl) throw new Error('Gagal membuat signed URL')
  return signedUrl
}

/**
 * Simpan path foto ke DB.
 * Prioritas: photo_path (kalau ada), fallback: photo_url (isi tetap path).
 */
async function savePhotoPathToProfile(uid, filePath) {
  // coba update photo_path + photo_url dulu
  const payloadA = {
    photo_path: filePath,
    photo_url: filePath,
    updated_at: new Date().toISOString()
  }

  const { error: errA } = await supabase.from('profiles').update(payloadA).eq('id', uid)
  if (!errA) return

  // kalau kolom photo_path tidak ada, fallback photo_url saja
  const msg = (errA?.message || '').toLowerCase()
  const looksLikeMissingColumn = msg.includes('column') && msg.includes('photo_path')
  if (!looksLikeMissingColumn) throw errA

  const payloadB = {
    photo_url: filePath,
    updated_at: new Date().toISOString()
  }
  const { error: errB } = await supabase.from('profiles').update(payloadB).eq('id', uid)
  if (errB) throw errB
}

export default function ProfileGuru() {
  const { user, profile, logout, refreshProfile, linkGoogleCredential } = useAuthStore()
  const { pushToast } = useUIStore()

  const fileInputRef = useRef(null)
  const [form, setForm] = useState({
    nama: '',
    jk: '',
    agama: '',
    telp: '',
    alamat: '',
    tanggal_lahir: ''
  })

  // photoKey = path di storage, previewUrl = signed url / local preview
  const [photoKey, setPhotoKey] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false)
  const [accountVerifyOpen, setAccountVerifyOpen] = useState(false)
  const [pendingAccountAction, setPendingAccountAction] = useState(null)

  const providerState = useMemo(
    () => supabase.auth.getProviderState?.(user || {}) || { googleLinked: false, emailVerified: false },
    [user]
  )
  const googleLinked = useMemo(
    () => Boolean(user?.google_linked || providerState.googleLinked),
    [user?.google_linked, providerState.googleLinked]
  )
  const email = useMemo(() => user?.email || profile?.email || '', [user?.email, profile?.email])
  const emailVerified = useMemo(
    () => Boolean(user?.email_confirmed_at || user?.emailVerified || providerState.emailVerified),
    [user?.email_confirmed_at, user?.emailVerified, providerState.emailVerified]
  )
  const googleLinkBlockedReason = (profile?.role === 'siswa' && profile?.must_change_password)
    ? 'Tautkan Google akan tersedia setelah Anda mengganti password awal akun ini.'
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
  const canManageAccount = profile?.role === 'siswa' || profile?.role === 'guru'

  useEffect(() => {
    if (!accountForm.email && email) {
      setAccountForm((prev) => ({ ...prev, email }))
    }
  }, [email]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (needsAccountSetup) {
      setShowPasswordFields(true)
    }
  }, [needsAccountSetup])

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
      const passwordCheck = validatePassword(accountForm.password)
      if (!passwordCheck.valid) {
        throw new Error(passwordCheck.errors[0])
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

  // Load profile data + buat signed URL jika yang tersimpan adalah path
  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      if (!profile) return

      setForm({
        nama: profile.nama || '',
        jk: profile.jk || '',
        agama: profile.agama || '',
        telp: profile.telp || '',
        alamat: profile.alamat || '',
        tanggal_lahir: profile.tanggal_lahir || ''
      })

      const stored = profile.photo_path || profile.photo_url || ''
      if (!stored) {
        setPhotoKey('')
        setPreviewUrl('')
        return
      }

      // kalau ternyata masih URL lama, tetap bisa tampil
      if (isHttpUrl(stored)) {
        setPhotoKey(stored) // legacy (url)
        setPreviewUrl(addCacheBuster(stored))
        return
      }

      // path => signed URL
      try {
        const signed = await createSignedUrlOrThrow(stored)
        if (!cancelled) {
          setPhotoKey(stored)
          setPreviewUrl(addCacheBuster(signed))
        }
      } catch (e) {
        if (!cancelled) {
          setPhotoKey(stored)
          setPreviewUrl('')
        }
      }
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [profile])

  const handleFieldChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /* ========== Upload & Kompres Foto Profil ========== */
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    setUploadingPhoto(true)

    // local preview (objectURL) supaya UI responsif
    let localPreview = ''
    try {
      // Validasi tipe file
      if (!file.type.startsWith('image/')) {
        throw new Error('Hanya file gambar yang diizinkan (JPEG/PNG/WebP)')
      }

      // Validasi ukuran awal
      if (file.size > MAX_ORIGINAL_SIZE) {
        throw new Error('Ukuran gambar maksimal 5MB')
      }

      // Kompres
      const compressedFile = await compressImageTo100KB(file, MAX_COMPRESSED_BYTES)
      if (compressedFile.size > MAX_COMPRESSED_BYTES) {
        throw new Error('Gagal mengkompres ke <= 100KB. Gunakan gambar yang lebih kecil.')
      }

      localPreview = URL.createObjectURL(compressedFile)
      setPreviewUrl(localPreview)

      // Path dipaksa fixed: 1 user = 1 object (tidak numpuk file)
      const filePath = `profiles/${user.id}/avatar.jpg`

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_BUCKET)
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'image/jpeg'
        })

      if (uploadError) throw new Error(`Upload gagal: ${uploadError.message}`)

      // Simpan path ke DB (bukan URL)
      await savePhotoPathToProfile(user.id, filePath)

      // Buat signed url untuk preview tampil
      const signed = await createSignedUrlOrThrow(filePath)
      setPhotoKey(filePath)
      setPreviewUrl(addCacheBuster(signed))

      await refreshProfile()
      pushToast('success', 'Foto profil berhasil diperbarui (disimpan sebagai path + signed URL)')

    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengupload foto')
      // fallback: coba tampilkan dari data yang ada
      if (photoKey && isHttpUrl(photoKey)) setPreviewUrl(addCacheBuster(photoKey))
      else if (photoKey && !isHttpUrl(photoKey)) {
        try {
          const signed = await createSignedUrlOrThrow(photoKey)
          setPreviewUrl(addCacheBuster(signed))
        } catch {
          setPreviewUrl('')
        }
      } else {
        setPreviewUrl('')
      }
    } finally {
      setUploadingPhoto(false)

      // reset input
      if (fileInputRef.current) fileInputRef.current.value = ''

      // revoke localPreview kalau masih dipakai, aman kalau sudah ganti signed url
      if (localPreview) {
        try {
          URL.revokeObjectURL(localPreview)
        } catch { }
      }
    }
  }

  /* ========== Simpan Data Profil ========== */
  const handleSaveProfile = async () => {
    if (!user?.id) return

    if (!form.nama.trim()) {
      pushToast('error', 'Nama lengkap harus diisi')
      return
    }
    if (!form.jk) {
      pushToast('error', 'Jenis kelamin harus dipilih')
      return
    }

    setSaving(true)
    try {
      // Anti-IDOR: update selalu untuk auth.uid() (user.id), tanpa menerima id dari UI/route
      const { error } = await supabase
        .from('profiles')
        .update({
          nama: form.nama.trim(),
          jk: form.jk,
          agama: form.agama || null,
          telp: form.telp || null,
          alamat: form.alamat || null,
          tanggal_lahir: form.tanggal_lahir || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (error) throw error

      await refreshProfile()
      pushToast('success', 'Profil berhasil diperbarui')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal menyimpan profil')
    } finally {
      setSaving(false)
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
      await linkGoogleCredential(credential)
      await refreshProfile()
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
      pushToast('success', 'Tautan Google berhasil dilepas.')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal melepas tautan Google')
    } finally {
      setUnlinkingGoogle(false)
    }
  }

  const securityAccountCard = canManageAccount ? (
    <div
      className={`rounded-2xl border p-6 shadow-sm ${needsAccountSetup
        ? 'border-amber-200/70 bg-amber-50/80'
        : 'border-blue-200/70 bg-blue-50/70'
        }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <h2
            className={`text-xl font-bold mb-2 ${needsAccountSetup ? 'text-amber-900' : 'text-blue-900'
              }`}
          >
            {needsAccountSetup ? 'Lengkapi Akun (Wajib)' : 'Keamanan Akun'}
          </h2>
          <p className={`text-sm ${needsAccountSetup ? 'text-amber-800' : 'text-blue-800'}`}>
            {needsAccountSetup
              ? 'Password awal buatan sistem bisa diganti langsung. Jika email sistem ingin diganti ke email aktif, email baru akan diverifikasi dulu dengan kode 6 digit.'
              : 'Untuk mengganti email atau password, sistem akan mengirim kode verifikasi 6 digit. Jika email masih tertaut ke Google, lepas tautan dulu sebelum mengganti email lagi.'}
          </p>
        </div>
        <div
          className={`text-xs px-4 py-2 rounded-xl ${needsAccountSetup ? 'text-amber-800 bg-amber-100/80' : 'text-blue-800 bg-blue-100/80'
            }`}
        >
          <span className="font-semibold">Login awal:</span> Siswa pakai NIS + tanggal lahir, guru pakai email + tanggal lahir.
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <label className="text-sm font-medium text-amber-900">Email Akun</label>
          <input
            type="email"
            value={accountForm.email}
            onChange={(e) =>
              setAccountForm((prev) => ({ ...prev, email: e.target.value }))
            }
            placeholder="nama@email.com"
            className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
          />
          {!isEmailFormat(accountForm.email) && accountForm.email && (
            <p className="text-xs text-red-600">Format email tidak valid</p>
          )}
        </div>

        {showPasswordFields && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-amber-900">Password Baru</label>
            <PasswordInput
              value={accountForm.password}
              onChange={(e) =>
                setAccountForm((prev) => ({ ...prev, password: e.target.value }))
              }
              placeholder="Minimal 6 karakter"
              className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
            />
          </div>
        )}

        {showPasswordFields && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-amber-900">Ulangi Password</label>
            <PasswordInput
              value={accountForm.confirmPassword}
              onChange={(e) =>
                setAccountForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
              }
              placeholder="Ulangi password"
              className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleTogglePasswordFields}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {showPasswordFields ? 'Batal Ganti Password' : 'Ganti Password'}
        </button>
        <button
          type="button"
          onClick={handleCompleteAccount}
          disabled={accountSaving}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-200/70 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {accountSaving
            ? 'Menyimpan...'
            : needsAccountSetup
              ? 'Simpan Setup Akun'
              : 'Simpan Perubahan Akun'}
        </button>
        <p className="text-xs text-amber-800">
          {needsAccountSetup
            ? 'Password awal masih bisa diganti langsung. Saat Anda memasukkan email aktif baru, sistem akan mengirim kode 6 digit ke email baru tersebut.'
            : 'Perubahan email atau password akan meminta kode verifikasi 6 digit. Jika Google masih tertaut, email tidak bisa diganti sebelum tautannya dilepas.'}
        </p>
      </div>
      {needsAccountSetup && (
        <p className="mt-3 text-xs text-amber-700">
          Anda boleh mengganti password dulu, email dulu, atau keduanya sekaligus. Jika email sistem diganti ke email aktif, email baru harus lolos verifikasi 6 digit terlebih dahulu. Akun tetap dianggap tahap awal sampai email aktif dan password awal sudah diganti.
        </p>
      )}
      {googleLinked && hasRealLoginEmail(email) && (
        <p className="mt-3 text-xs text-red-700">
          Email akun sedang tertaut dengan Google. Lepas tautan Google terlebih dahulu jika ingin mengganti email akun ini.
        </p>
      )}

      <div className="mt-6 rounded-xl border border-blue-200/70 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Tautkan Login Google</h3>
            <p className="text-xs text-slate-600 mt-1">
              Saat akun Google tertaut, login bisa pakai Google dan status email terverifikasi ikut tersinkron.
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Syarat: email akun harus sama persis dengan email Google.
            </p>
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
                busy={linkingGoogle}
                className="w-full md:w-[260px]"
                buttonClassName="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                noteClassName="text-xs text-slate-600"
                label="Tautkan Google"
                busyLabel="Memproses tautan Google..."
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
                className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {unlinkingGoogle ? 'Melepas...' : 'Lepas Tautan'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-2xl text-white">👨‍🏫</span>
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">Profil Guru</h1>
                <p className="text-slate-600 text-base">Kelola identitas akun, keamanan login, dan data pribadi Anda.</p>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              <div className="text-xs text-slate-500">Status Email</div>
              <div className={`font-semibold ${emailVerified ? 'text-emerald-700' : 'text-amber-700'}`}>
                {emailVerified ? 'Terverifikasi' : 'Belum Terverifikasi'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          {/* ========== SIDEBAR PROFIL ========== */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
              <div className="flex flex-col items-center">
                <div className="relative mb-4">
                  <div className="relative w-28 h-28">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Foto Profil"
                        className="w-28 h-28 rounded-2xl object-cover border-4 border-white shadow-lg"
                        onError={() => setPreviewUrl('')}
                      />
                    ) : (
                      <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 border-4 border-white shadow-lg flex items-center justify-center">
                        <span className="text-3xl text-blue-400">👤</span>
                      </div>
                    )}

                    {uploadingPhoto && (
                      <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>

                  <label
                    htmlFor="photo-input"
                    className={`absolute -bottom-2 -right-2 ${uploadingPhoto
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-lg'
                      } text-white p-2.5 rounded-full transition-all duration-200 border-4 border-white`}
                    title="Ubah Foto"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </label>

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

                <div className="text-center mb-6 w-full">
                  <h2 className="font-bold text-lg text-gray-900 mb-1 break-words">
                    {form.nama || profile?.nama || 'Guru'}
                  </h2>
                  <p className="text-gray-500 text-xs truncate">{email || 'Email tidak tersedia'}</p>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Foto disimpan sebagai <span className="font-semibold">path</span> di DB dan ditampilkan via{' '}
                    <span className="font-semibold">signed URL</span>.
                  </p>
                </div>

                <div className="w-full mb-4">
                  <div
                    className={`flex items-center justify-center px-3 py-2 rounded-xl text-sm font-medium ${emailVerified
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                  >
                    {emailVerified ? (
                      <>
                        <span className="mr-2">✅</span>Email Terverifikasi
                      </>
                    ) : (
                      <>
                        <span className="mr-2">⚠️</span>Belum Terverifikasi
                      </>
                    )}
                  </div>
                  <p className="mt-3 text-center text-[11px] leading-5 text-slate-500">
                    Verifikasi email 6 digit biasa sudah dimatikan. Kode 6 digit sekarang dipakai saat Anda mengganti email atau password akun.
                  </p>
                </div>

                <button
                  onClick={logout}
                  className="w-full px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-all duration-200 border border-gray-300 shadow-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Keluar
                </button>
              </div>
            </div>
          </div>

          {/* ========== FORM EDIT PROFIL ========== */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Informasi Pribadi</h3>
                  <p className="text-gray-600 mt-1">Perbarui data profil Anda</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg">
                    Foto maks. 100KB
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 placeholder-gray-400"
                    value={form.nama}
                    onChange={(e) => handleFieldChange('nama', e.target.value)}
                    placeholder="Masukkan nama lengkap"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">
                    Jenis Kelamin <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
                    value={form.jk}
                    onChange={(e) => handleFieldChange('jk', e.target.value)}
                  >
                    <option value="">Pilih Jenis Kelamin</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Agama</label>
                  <select
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
                    value={form.agama}
                    onChange={(e) => handleFieldChange('agama', e.target.value)}
                  >
                    <option value="">Pilih Agama</option>
                    <option value="Islam">Islam</option>
                    <option value="Kristen">Kristen</option>
                    <option value="Katolik">Katolik</option>
                    <option value="Hindu">Hindu</option>
                    <option value="Buddha">Buddha</option>
                    <option value="Konghucu">Konghucu</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Nomor Telepon/HP</label>
                  <input
                    type="tel"
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 placeholder-gray-400"
                    value={form.telp}
                    onChange={(e) => handleFieldChange('telp', e.target.value)}
                    placeholder="08xxxxxxxxxx"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Email</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl bg-gray-50 text-gray-700"
                    value={email || '-'}
                    readOnly
                  />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Tanggal Lahir</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
                    value={form.tanggal_lahir}
                    onChange={(e) => handleFieldChange('tanggal_lahir', e.target.value)}
                  />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Alamat Lengkap</label>
                  <textarea
                    rows={4}
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 resize-none placeholder-gray-400"
                    value={form.alamat}
                    onChange={(e) => handleFieldChange('alamat', e.target.value)}
                    placeholder="Masukkan alamat lengkap tempat tinggal"
                  />
                </div>
              </div>

              <div className="flex justify-end mt-10 pt-8 border-t border-gray-200">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving || !form.nama.trim() || !form.jk}
                  className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 disabled:shadow-none flex items-center gap-3"
                >
                  {saving ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Simpan Perubahan
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>
        {securityAccountCard}
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
    </div>
  )
}
