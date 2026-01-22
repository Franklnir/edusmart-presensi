// src/pages/siswa/EditProfile.jsx
import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

const BUCKET = 'profile-photos'

/* ========= Helper: kompres gambar ke <= 100KB ========= */
async function compressImageTo100KB(file, maxBytes = 100 * 1024) {
  if (!file || file.size <= maxBytes) return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      try {
        // Optimasi dimensi - maksimal 400px untuk menghemat ruang
        const MAX_DIMENSION = 400
        let { width, height } = img

        if (width > height && width > MAX_DIMENSION) {
          height = (height * MAX_DIMENSION) / width
          width = MAX_DIMENSION
        } else if (height > MAX_DIMENSION) {
          width = (width * MAX_DIMENSION) / height
          height = MAX_DIMENSION
        }

        canvas.width = Math.round(width)
        canvas.height = Math.round(height)

        // Optimasi kualitas gambar
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        // Kompresi progresif dengan target 100KB
        let quality = 0.8
        let bestBlob = null // simpan blob paling kecil yg pernah didapat

        const tryCompress = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Gagal mengkompres gambar'))
                return
              }

              if (!bestBlob || blob.size < bestBlob.size) {
                bestBlob = blob
              }

              if (blob.size <= maxBytes) {
                resolve(
                  new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                  })
                )
                return
              }

              if (quality > 0.3) {
                quality -= 0.1
                tryCompress()
                return
              }

              // Kalau sudah mentok kualitas, pakai bestBlob sebagai hasil terakhir
              if (bestBlob) {
                resolve(
                  new File([bestBlob], file.name.replace(/\.\w+$/, '') + '.jpg', {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                  })
                )
              } else {
                reject(new Error('Gambar terlalu besar, coba gunakan gambar yang lebih kecil'))
              }
            },
            'image/jpeg',
            quality
          )
        }

        tryCompress()
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Gagal memuat gambar'))
    }

    img.src = objectUrl
  })
}

/* helper kecil buat hapus query (?token=...) kalau butuh parsing */
function stripQuery(url) {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return url.split('?')[0]
  }
}

/* ==================== COMPONENT ==================== */
export default function EditProfile() {
  const { user, profile, logout, refreshProfile } = useAuthStore()
  const { pushToast } = useUIStore()

  const [form, setForm] = useState({
    nama: '',
    jk: '',
    agama: '',
    telp: '',
    alamat: '',
    tanggal_lahir: '',
  })

  const [photoURL, setPhotoURL] = useState('')
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [sendingVerify, setSendingVerify] = useState(false)

  // Revoke preview blob url biar nggak memory leak
  useEffect(() => {
    return () => {
      if (preview && typeof preview === 'string' && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview)
      }
    }
  }, [preview])

  // Load profile data
  useEffect(() => {
    if (profile) {
      setForm({
        nama: profile.nama || '',
        jk: profile.jk || '',
        agama: profile.agama || '',
        telp: profile.telp || '',
        alamat: profile.alamat || '',
        tanggal_lahir: profile.tanggal_lahir || '',
      })
      setPhotoURL(profile.photo_url || '')
      setPreview(profile.photo_url || '')
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

    try {
      // Validasi tipe file
      if (!file.type.startsWith('image/')) {
        throw new Error('Hanya file gambar yang diizinkan (JPEG, PNG)')
      }

      // Validasi ukuran file awal
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Ukuran gambar maksimal 5MB')
      }

      // Kompresi gambar ke <= 100KB
      const compressedFile = await compressImageTo100KB(file)

      // Validasi ukuran setelah kompresi
      if (compressedFile.size > 100 * 1024) {
        throw new Error('Gagal mengkompres gambar ke bawah 100KB. Gunakan gambar yang lebih kecil.')
      }

      // Preview lokal (sementara)
      const localPreview = URL.createObjectURL(compressedFile)
      setPreview(localPreview)

      // Upload ke Supabase Storage
      const fileName = `profile_${user.id}_${Date.now()}.jpg`
      const filePath = `profiles/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/jpeg',
        })

      if (uploadError) {
        console.error('Upload error details:', uploadError)
        throw new Error(`Upload gagal: ${uploadError.message}`)
      }

      // ✅ Ambil PUBLIC URL yang benar (untuk bucket PUBLIC)
      const { data: pubData } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
      const publicUrl = pubData?.publicUrl

      if (!publicUrl) {
        throw new Error('Gagal mendapatkan public URL dari storage.')
      }

      // Hapus foto lama jika ada (best effort)
      if (photoURL && photoURL.includes(BUCKET)) {
        try {
          // coba ambil filename lama (paling simpel)
          const clean = stripQuery(photoURL)
          const oldFileName = clean.split('/').pop()
          if (oldFileName && oldFileName !== fileName) {
            await supabase.storage.from(BUCKET).remove([`profiles/${oldFileName}`])
          }
        } catch (deleteError) {
          console.warn('Gagal menghapus foto lama:', deleteError)
        }
      }

      // Update photo_url di database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          photo_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (updateError) {
        throw new Error(`Update database gagal: ${updateError.message}`)
      }

      // pakai url final
      setPhotoURL(publicUrl)
      setPreview(publicUrl)
      await refreshProfile()

      pushToast('success', 'Foto profil berhasil diperbarui (maks. 100KB)')
    } catch (error) {
      console.error('Error upload foto:', error)
      pushToast('error', error.message)
      setPreview(photoURL)
    } finally {
      setUploadingPhoto(false)
      // reset input biar bisa upload file yg sama lagi
      if (e.target) e.target.value = ''
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
      const { error } = await supabase
        .from('profiles')
        .update({
          nama: form.nama.trim(),
          jk: form.jk,
          agama: form.agama,
          telp: form.telp,
          alamat: form.alamat,
          tanggal_lahir: form.tanggal_lahir,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) throw error

      await refreshProfile()
      pushToast('success', 'Profil berhasil diperbarui')
    } catch (error) {
      console.error('Error update profile:', error)
      pushToast('error', 'Gagal menyimpan profil')
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

  return (
    <div className="min-h-screen bg-gray-50/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Profil Siswa</h1>
          <p className="text-gray-600 text-lg">Kelola informasi profil dan preferensi akun Anda</p>
        </div>

        <div className="grid lg:grid-cols-4 gap-8">
          {/* ========== SIDEBAR PROFIL ========== */}
          <div className="lg:col-span-1 space-y-6">
            {/* Card Foto Profil */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex flex-col items-center">
                {/* Foto Container */}
                <div className="relative mb-4">
                  <div className="relative w-28 h-28">
                    {preview ? (
                      <img
                        src={preview}
                        alt="Foto Profil"
                        className="w-28 h-28 rounded-2xl object-cover border-4 border-white shadow-lg"
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

                  {/* Tombol Upload */}
                  <label
                    htmlFor="photo-input"
                    className={`absolute -bottom-2 -right-2 ${
                      uploadingPhoto
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-lg'
                    } text-white p-2.5 rounded-full transition-all duration-200 border-4 border-white`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
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

                {/* Info Siswa */}
                <div className="text-center mb-6">
                  <h2 className="font-bold text-lg text-gray-900 mb-1">
                    {form.nama || profile?.nama || 'Siswa'}
                  </h2>
                  <p className="text-gray-600 text-sm mb-1">{profile?.kelas || 'Kelas belum ditentukan'}</p>
                  <p className="text-gray-500 text-xs truncate max-w-full">{email || 'Email tidak tersedia'}</p>
                </div>

                {/* Status Verifikasi */}
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
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Email Terverifikasi
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Belum Terverifikasi
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

                {/* Tombol Logout */}
                <button
                  onClick={logout}
                  className="w-full px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-all duration-200 border border-gray-300 shadow-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Keluar
                </button>
              </div>
            </div>

            {/* Info Sekolah */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Informasi Sekolah</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-gray-500 text-xs">Kelas</label>
                  <p className="font-medium text-gray-900">{profile?.kelas || '-'}</p>
                </div>
                <div>
                  <label className="text-gray-500 text-xs">Status</label>
                  <p className="font-medium text-gray-900 capitalize">{profile?.status || 'active'}</p>
                </div>
                <div>
                  <label className="text-gray-500 text-xs">Bergabung</label>
                  <p className="font-medium text-gray-900">
                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('id-ID') : '-'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ========== FORM EDIT PROFIL ========== */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Informasi Pribadi</h3>
                  <p className="text-gray-600 mt-1">Lengkapi data profil Anda</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg">Maks. 100KB</div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Nama Lengkap */}
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

                {/* Jenis Kelamin */}
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

                {/* Agama */}
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

                {/* Nomor Telepon */}
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

                {/* Tanggal Lahir */}
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-semibold text-gray-900">Tanggal Lahir</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
                    value={form.tanggal_lahir}
                    onChange={(e) => handleFieldChange('tanggal_lahir', e.target.value)}
                  />
                </div>

                {/* Alamat */}
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

              {/* Action Buttons */}
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
      </div>
    </div>
  )
}
