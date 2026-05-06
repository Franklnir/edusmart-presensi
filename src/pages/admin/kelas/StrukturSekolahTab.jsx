import React, { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

const GRADE_OPTS = ['VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const GRADE_ORDER = Object.fromEntries(GRADE_OPTS.map((g, i) => [g, i]))
const GRADE_REGEX = /^\s*(VII|VIII|IX|X|XI|XII)\b/i

const parseGrade = (name = '') => {
  const match = String(name || '').toUpperCase().match(GRADE_REGEX)
  return match ? match[1] : ''
}

const stripGradePrefix = (name = '') => {
  const g = parseGrade(name)
  const value = String(name || '').trim()
  if (!g) return value
  return value.toUpperCase().startsWith(g) ? value.slice(g.length).trim() : value
}

const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)

export default function StrukturSekolahTab({ guruList, pushToast }) {
  const DEFAULT_POS = ['Kepala Sekolah', 'Wakil Kepala Sekolah', 'Kurikulum', 'Kesiswaan', 'Sarpras', 'Humas', 'Bendahara', 'Tata Usaha']
  const [struktur, setStruktur] = useState([])
  const [waliKelas, setWaliKelas] = useState([])
  const [posBaru, setPosBaru] = useState('')
  const [posGuru, setPosGuru] = useState('')
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(null)

  const FORBIDDEN = /[.#$[\]]/
  const slug = (s = '') => s.toString().trim().toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

  useEffect(() => {
    loadStruktur()
    loadWaliKelas()
  }, [])

  const loadStruktur = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('struktur_sekolah')
        .select('*')
        .order('jabatan')

      if (error) throw error
      setStruktur(data || [])
    } catch (error) {
      console.error('Error loading struktur:', error)
      pushToast('error', 'Gagal memuat struktur sekolah')
    } finally {
      setLoading(false)
    }
  }

  const loadWaliKelas = async () => {
    try {
      setLoading(true)
      
      // Ambil data kelas dengan struktur
      const { data: kelasData, error: kelasError } = await supabase
        .from('kelas')
        .select('*')
        .order('grade')
        .order('suffix')

      if (kelasError) throw kelasError

      const { data: strukturData, error: strukturError } = await supabase
        .from('kelas_struktur')
        .select('*')

      if (strukturError) throw strukturError

      // Gabungkan data
      const waliKelasData = kelasData.map(kelas => {
        const struktur = strukturData?.find(s => s.kelas_id === kelas.id)
        return {
          id: kelas.id,
          nama_kelas: kelas.nama || kelas.id,
          grade: kelas.grade || parseGrade(kelas.id),
          suffix: kelas.suffix || stripGradePrefix(kelas.nama || kelas.id),
          wali_guru_id: struktur?.wali_guru_id || '',
          wali_guru_nama: struktur?.wali_guru_nama || ''
        }
      })

      // Urutkan berdasarkan grade
      waliKelasData.sort((a, b) => {
        const ag = GRADE_ORDER[a.grade] ?? 999
        const bg = GRADE_ORDER[b.grade] ?? 999
        if (ag !== bg) return ag - bg
        return (a.suffix || '').localeCompare(b.suffix || '', 'id')
      })

      setWaliKelas(waliKelasData)
    } catch (error) {
      console.error('Error loading wali kelas:', error)
      pushToast('error', 'Gagal memuat data wali kelas')
    } finally {
      setLoading(false)
    }
  }

  function formatNamaKelas(kelas) {
    if (kelas.nama_kelas) return kelas.nama_kelas
    return `${kelas.grade || parseGrade(kelas.id)} ${kelas.suffix || ''}`.trim()
  }

  async function addPosisi() {
    const jab = (posBaru || '').trim()
    if (!jab) {
      pushToast('error', 'Nama jabatan harus diisi')
      return
    }
    
    if (FORBIDDEN.test(jab)) {
      pushToast('error', 'Nama posisi tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(jab)

    try {
      setLoading(true)

      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('struktur_sekolah')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Posisi sudah ada.')
        return
      }

      const guruId = posGuru || ''
      const guruNama = guruId ? (guruList.find(g => g.id === guruId)?.name || '') : ''

      const { error } = await supabase
        .from('struktur_sekolah')
        .insert({
          id,
          jabatan: jab,
          guru_id: guruId || null,
          guru_nama: guruNama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Posisi "${jab}" berhasil ditambahkan`)
      setPosBaru('')
      setPosGuru('')
      await loadStruktur()
    } catch (error) {
      console.error('Error adding posisi:', error)
      pushToast('error', error.message || 'Gagal menambah posisi')
    } finally {
      setLoading(false)
    }
  }

  async function updatePosisi(posisiId, newGuruId) {
    try {
      setLoading(true)
      const guruNama = newGuruId ? (guruList.find(g => g.id === newGuruId)?.name || '') : ''

      const { error } = await supabase
        .from('struktur_sekolah')
        .update({
          guru_id: newGuruId || null,
          guru_nama: guruNama,
          updated_at: new Date().toISOString()
        })
        .eq('id', posisiId)

      if (error) throw error

      pushToast('success', 'Posisi berhasil diupdate')
      await loadStruktur()
    } catch (error) {
      console.error('Error updating posisi:', error)
      pushToast('error', error.message || 'Gagal mengupdate posisi')
    } finally {
      setLoading(false)
    }
  }

  async function updateWaliKelas(kelasId, newGuruId) {
    try {
      setLoading(true)
      const guruNama = newGuruId ? (guruList.find(g => g.id === newGuruId)?.name || '') : ''

      const { error } = await supabase
        .from('kelas_struktur')
        .upsert({
          kelas_id: kelasId,
          wali_guru_id: newGuruId || null,
          wali_guru_nama: guruNama,
          updated_at: new Date().toISOString()
        }, { onConflict: 'kelas_id' })

      if (error) throw error

      pushToast('success', 'Wali kelas berhasil diupdate')
      await loadWaliKelas()
    } catch (error) {
      console.error('Error updating wali kelas:', error)
      pushToast('error', error.message || 'Gagal mengupdate wali kelas')
    } finally {
      setLoading(false)
    }
  }

  async function hapusPosisi(p) {
    if (!confirmDelete(`Hapus posisi "${p.jabatan}"?`)) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('struktur_sekolah')
        .delete()
        .eq('id', p.id)

      if (error) throw error

      pushToast('success', 'Posisi berhasil dihapus')
      await loadStruktur()
    } catch (error) {
      console.error('Error deleting posisi:', error)
      pushToast('error', error.message || 'Gagal menghapus posisi')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-purple-100 rounded-lg">🏢</span>
              <span>Struktur Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola jabatan dan penanggung jawab di sekolah
            </p>
          </div>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Posisi</p>
              <p className="text-2xl font-bold text-gray-900">{struktur.length}</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <span className="text-xl">👔</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Wali Kelas</p>
              <p className="text-2xl font-bold text-gray-900">{waliKelas.filter(wk => wk.wali_guru_id).length}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <span className="text-xl">👨‍🏫</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Kelas</p>
              <p className="text-2xl font-bold text-gray-900">{waliKelas.length}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <span className="text-xl">🏫</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form Tambah Posisi */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <span className="p-2 bg-blue-100 rounded-lg">➕</span>
          <span>Tambah Posisi Baru</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jabatan <span className="text-red-500">*</span>
            </label>
            <input
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
              list="list-posisi"
              placeholder="cth: Kepala Sekolah"
              value={posBaru}
              onChange={e => setPosBaru(e.target.value)}
            />
            <datalist id="list-posisi">
              {DEFAULT_POS.map(p => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Penanggung Jawab</label>
            <select
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
              value={posGuru}
              onChange={e => setPosGuru(e.target.value)}
            >
              <option value="">Pilih guru</option>
              {guruList.map(g => (
                <option key={g.id} value={g.id}>{g.label || g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
              onClick={addPosisi}
              disabled={loading || !posBaru.trim()}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Menambah...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>Tambah Posisi</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Struktur Sekolah */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <span className="p-2 bg-purple-100 rounded-lg">📊</span>
            <span>Struktur Sekolah</span>
          </h3>
          <span className="text-sm text-gray-500">
            {struktur.length} posisi
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {struktur.map((p, index) => (
            <div
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 p-4 hover:border-purple-300"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-purple-600 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-white">{index + 1}</span>
                    </div>
                    <h4 className="font-bold text-gray-900 text-lg">{p.jabatan}</h4>
                  </div>

                  {editMode === p.id ? (
                    <div className="space-y-2">
                      <select
                        className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                        value={p.guru_id || ''}
                        onChange={e => updatePosisi(p.id, e.target.value)}
                        onBlur={() => setEditMode(null)}
                        autoFocus
                      >
                        <option value="">Pilih penanggung jawab</option>
                        {guruList.map(g => (
                          <option key={g.id} value={g.id}>{g.label || g.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Klik di luar untuk menyimpan
                      </p>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(p.id)}
                    >
                      <p className="text-gray-700 text-sm">
                        {p.guru_nama || 'Belum ada penanggung jawab'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700 transition-colors">
                        <span className="inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Klik untuk mengubah
                        </span>
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className="text-red-500 hover:text-red-700 p-2 rounded-lg transition-all duration-200 hover:bg-red-50 ml-2"
                  onClick={() => hapusPosisi(p)}
                  disabled={loading}
                  title="Hapus posisi"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {!struktur.length && (
            <div className="col-span-full text-center py-12 text-gray-500">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <p className="text-lg font-medium">Belum ada data struktur</p>
              <p className="text-sm mt-1">Tambahkan posisi baru untuk memulai</p>
            </div>
          )}
        </div>
      </div>

      {/* Wali Kelas */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <span className="p-2 bg-green-100 rounded-lg">👨‍🏫</span>
            <span>Wali Kelas</span>
          </h3>
          <span className="text-sm text-gray-500">
            {waliKelas.filter(wk => wk.wali_guru_id).length} dari {waliKelas.length} kelas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waliKelas.map((wk, index) => (
            <div
              key={wk.id}
              className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-all duration-300 p-4 ${
                wk.wali_guru_id 
                  ? 'border-green-200 hover:border-green-300' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      wk.wali_guru_id ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <span className={`text-xs font-bold ${
                        wk.wali_guru_id ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {wk.grade?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-lg">{formatNamaKelas(wk)}</h4>
                      <p className="text-xs text-gray-500">
                        {wk.grade} • {wk.suffix || '-'}
                      </p>
                    </div>
                  </div>

                  {editMode === `wali_${wk.id}` ? (
                    <div className="space-y-2">
                      <select
                        className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                        value={wk.wali_guru_id || ''}
                        onChange={e => updateWaliKelas(wk.id, e.target.value)}
                        onBlur={() => setEditMode(null)}
                        autoFocus
                      >
                        <option value="">Pilih wali kelas</option>
                        {guruList.map(g => (
                          <option key={g.id} value={g.id}>{g.label || g.name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">
                        Klik di luar untuk menyimpan
                      </p>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer group"
                      onClick={() => setEditMode(`wali_${wk.id}`)}
                    >
                      <p className={`text-sm ${
                        wk.wali_guru_nama ? 'text-gray-700' : 'text-gray-500 italic'
                      }`}>
                        {wk.wali_guru_nama || 'Belum ada wali kelas'}
                      </p>
                      <p className="text-gray-500 text-xs mt-1 group-hover:text-gray-700 transition-colors">
                        <span className="inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Klik untuk mengubah
                        </span>
                      </p>
                    </div>
                  )}
                </div>
                
                {wk.wali_guru_id && (
                  <div className="ml-2">
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                      ✅
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!waliKelas.length && (
            <div className="col-span-full text-center py-12 text-gray-500">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-lg font-medium">Belum ada data wali kelas</p>
              <p className="text-sm mt-1">Atur wali kelas di tab Kelas & Jadwal</p>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 flex items-center space-x-3 shadow-2xl">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="text-gray-700 font-medium">Memproses...</span>
          </div>
        </div>
      )}
    </div>
  )
}
