// src/pages/guru/profile.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

/** Bucket Storage */
const PHOTO_BUCKET = 'profile-photos'

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
    .from(PHOTO_BUCKET)
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
  const { user, profile, logout, refreshProfile } = useAuthStore()
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
  const [sendingVerify, setSendingVerify] = useState(false)

  const email = useMemo(() => user?.email || profile?.email || '', [user?.email, profile?.email])
  const emailVerified = useMemo(
    () => user?.email_confirmed_at || user?.emailVerified,
    [user?.email_confirmed_at, user?.emailVerified]
  )

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
        .from(PHOTO_BUCKET)
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
        } catch {}
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

  /* ========== Kirim Verifikasi Email ========== */
  const handleSendVerification = async () => {
    if (!user?.email) return
    setSendingVerify(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email
      })
      if (error) throw error
      pushToast('success', 'Email verifikasi dikirim. Cek inbox (dan spam).')
    } catch (error) {
      pushToast('error', error?.message || 'Gagal mengirim email verifikasi')
    } finally {
      setSendingVerify(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Profil Guru</h1>
          <p className="text-gray-600 text-lg">Kelola informasi profil akun Anda</p>
        </div>

        <div className="grid lg:grid-cols-4 gap-8">
          {/* ========== SIDEBAR PROFIL ========== */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
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
                    className={`absolute -bottom-2 -right-2 ${
                      uploadingPhoto
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
                    className={`flex items-center justify-center px-3 py-2 rounded-xl text-sm font-medium ${
                      emailVerified
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

                  {!emailVerified && (
                    <button
                      onClick={handleSendVerification}
                      disabled={sendingVerify}
                      className="w-full mt-3 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-sm"
                    >
                      {sendingVerify ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Mengirim...
                        </span>
                      ) : (
                        'Verifikasi Email'
                      )}
                    </button>
                  )}
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
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
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

              {/* Debug kecil: path yang tersimpan (opsional, bisa hapus) */}
              {photoKey && !isHttpUrl(photoKey) && (
                <p className="mt-4 text-xs text-gray-500">
                  Storage key: <span className="font-mono">{photoKey}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
