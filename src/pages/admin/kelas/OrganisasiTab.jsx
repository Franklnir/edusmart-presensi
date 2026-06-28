import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { queryClient, queryKeys } from '../../../lib/queryClient'

const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)

export default function OrganisasiTab({
  guruList,
  siswaList,
  academicPeriod = null,
  pushToast,
  showHeader = true
}) {
  const [orgList, setOrgList] = useState([])
  const [orgSel, setOrgSel] = useState('')
  const [orgForm, setOrgForm] = useState({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
  const [orgAnggota, setOrgAnggota] = useState([])
  const [addMemberUid, setAddMemberUid] = useState('')
  const [addMemberJabatan, setAddMemberJabatan] = useState('')
  const [editAnggotaId, setEditAnggotaId] = useState(null)
  const [editAnggotaData, setEditAnggotaData] = useState({})
  const [loading, setLoading] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberOptions, setMemberOptions] = useState(() => siswaList || [])
  const [memberOptionsLoading, setMemberOptionsLoading] = useState(false)
  const [memberOptionsHasMore, setMemberOptionsHasMore] = useState(false)

  const JABATAN_OPTS = ['Ketua', 'Wakil Ketua', 'Sekretaris', 'Bendahara', 'Koordinator', 'Anggota']
  const FORBIDDEN = /[.#$[\]]/
  const slug = (s = '') => s.toString().trim().toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80)

  const mapStudentOptions = useCallback((rows = []) => (rows || []).map((siswa) => ({
    ...siswa,
    uid: siswa.uid || siswa.id,
    nama: siswa.nama || siswa.email || siswa.id
  })), [])

  const loadPeriodStudentMap = useCallback(async () => {
    const params = {
      all: true,
      per_page: 10000,
      status: 'active'
    }
    if (academicPeriod?.tahunAjaran) {
      params.tahun_ajaran = academicPeriod.tahunAjaran
    }

    const data = await queryClient.fetchQuery({
      queryKey: queryKeys.admin.studentOptions(params),
      queryFn: async () => {
        const { data, error } = await supabase.admin.studentOptions(params)
        if (error) throw error
        return data
      },
      staleTime: 60 * 1000,
    })

    return new Map(
      mapStudentOptions(data?.rows || [])
        .filter((siswa) => siswa.uid)
        .map((siswa) => [String(siswa.uid), siswa])
    )
  }, [academicPeriod?.tahunAjaran, mapStudentOptions])

  const loadMemberOptions = useCallback(async (query = '') => {
    setMemberOptionsLoading(true)
    try {
      const params = {
        q: query,
        status: 'active',
        per_page: 50
      }
      if (academicPeriod?.tahunAjaran) {
        params.tahun_ajaran = academicPeriod.tahunAjaran
      }

      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.studentOptions(params),
        queryFn: async () => {
          const { data, error } = await supabase.admin.studentOptions(params)
          if (error) throw error
          return data
        },
        staleTime: 60 * 1000,
      })

      setMemberOptions(mapStudentOptions(data?.rows || []))
      setMemberOptionsHasMore(Boolean(data?.meta?.has_more))
    } catch (error) {
      console.error('Error loading student options:', error)
      pushToast('error', error?.message || 'Gagal memuat opsi siswa')
    } finally {
      setMemberOptionsLoading(false)
    }
  }, [academicPeriod?.tahunAjaran, mapStudentOptions, pushToast])

  useEffect(() => {
    loadOrgList()
  }, [])

  useEffect(() => {
    if (Array.isArray(siswaList) && siswaList.length) {
      setMemberOptions(mapStudentOptions(siswaList))
      setMemberOptionsHasMore(false)
    }
  }, [mapStudentOptions, siswaList])

  useEffect(() => {
    if (orgSel) {
      loadOrgDetail()
      loadOrgAnggota()
    } else {
      setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
      setOrgAnggota([])
      setMemberSearch('')
      setAddMemberUid('')
    }
  }, [academicPeriod?.tahunAjaran, orgSel])

  useEffect(() => {
    if (!orgSel) return undefined

    const timer = window.setTimeout(() => {
      loadMemberOptions(memberSearch)
    }, memberSearch ? 300 : 0)

    return () => window.clearTimeout(timer)
  }, [loadMemberOptions, memberSearch, orgSel])

  const loadOrgList = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('organisasi')
        .select('*')
        .order('nama')

      if (error) throw error
      setOrgList(data || [])
    } catch (error) {
      console.error('Error loading organisasi:', error)
      pushToast('error', 'Gagal memuat data organisasi')
    } finally {
      setLoading(false)
    }
  }

  const loadOrgDetail = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('organisasi')
        .select('*')
        .eq('id', orgSel)
        .single()

      if (error) throw error

      setOrgForm({
        nama: data.nama || '',
        visi: data.visi || '',
        misi: data.misi || '',
        pembinaGuruId: data.pembina_guru_id || ''
      })
    } catch (error) {
      console.error('Error loading org detail:', error)
      pushToast('error', 'Gagal memuat detail organisasi')
    } finally {
      setLoading(false)
    }
  }

  const loadOrgAnggota = async () => {
    try {
      setLoading(true)

      const [anggotaResult, periodStudentMap] = await Promise.all([
        supabase
          .from('organisasi_anggota')
          .select('*')
          .eq('organisasi_id', orgSel)
          .order('jabatan', { ascending: false })
          .order('nama'),
        loadPeriodStudentMap()
      ])

      const { data, error } = anggotaResult
      if (error) throw error

      const rows = (data || [])
        .map((row) => {
          const siswa = periodStudentMap.get(String(row.siswa_id || ''))
          if (!siswa) return null
          return {
            ...row,
            nama: siswa.nama || row.nama,
            kelas: siswa.kelas || row.kelas || ''
          }
        })
        .filter(Boolean)

      setOrgAnggota(rows)
    } catch (error) {
      console.error('Error loading anggota:', error)
      pushToast('error', 'Gagal memuat anggota organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function tambahOrganisasi() {
    const nama = (orgForm.nama || '').trim()
    if (!nama) {
      pushToast('error', 'Nama organisasi harus diisi')
      return
    }
    
    if (nama.length < 3) {
      pushToast('error', 'Nama organisasi minimal 3 karakter')
      return
    }
    
    if (FORBIDDEN.test(nama)) {
      pushToast('error', 'Nama organisasi tidak boleh mengandung . # $ [ ]')
      return
    }

    const id = slug(nama)

    try {
      setLoading(true)

      // Cek apakah sudah ada
      const { data: existing } = await supabase
        .from('organisasi')
        .select('id')
        .eq('id', id)
        .single()

      if (existing) {
        pushToast('error', 'Nama organisasi sudah ada.')
        return
      }

      const pembinaId = orgForm.pembinaGuruId || ''
      const pembinaNama = pembinaId ? (guruList.find(g => g.id === pembinaId)?.name || '') : ''

      const { error } = await supabase
        .from('organisasi')
        .insert({
          id,
          nama,
          visi: orgForm.visi || '',
          misi: orgForm.misi || '',
          pembina_guru_id: pembinaId || null,
          pembina_guru_nama: pembinaNama,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', `Organisasi "${nama}" berhasil ditambahkan`)
      setOrgSel(id)
      await loadOrgList()
    } catch (error) {
      console.error('Error adding organisasi:', error)
      pushToast('error', error.message || 'Gagal menambah organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function simpanOrganisasi() {
    if (!orgSel) {
      pushToast('error', 'Pilih organisasi terlebih dahulu')
      return
    }

    try {
      setLoading(true)
      const pembinaId = orgForm.pembinaGuruId || ''
      const pembinaNama = pembinaId ? (guruList.find(g => g.id === pembinaId)?.name || '') : ''

      const { error } = await supabase
        .from('organisasi')
        .update({
          nama: orgForm.nama || '',
          visi: orgForm.visi || '',
          misi: orgForm.misi || '',
          pembina_guru_id: pembinaId || null,
          pembina_guru_nama: pembinaNama,
          updated_at: new Date().toISOString()
        })
        .eq('id', orgSel)

      if (error) throw error

      pushToast('success', 'Organisasi berhasil disimpan')
      await loadOrgList()
    } catch (error) {
      console.error('Error saving organisasi:', error)
      pushToast('error', error.message || 'Gagal menyimpan organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function hapusOrganisasi() {
    if (!orgSel) return
    if (!confirmDelete('Yakin mau hapus organisasi ini? Semua data anggota juga akan dihapus.')) return

    try {
      setLoading(true)

      // Hapus anggota terlebih dahulu
      const { error: deleteAnggotaError } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('organisasi_id', orgSel)

      if (deleteAnggotaError) throw deleteAnggotaError

      // Hapus organisasi
      const { error } = await supabase
        .from('organisasi')
        .delete()
        .eq('id', orgSel)

      if (error) throw error

      pushToast('success', 'Organisasi berhasil dihapus')
      setOrgSel('')
      setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
      setOrgAnggota([])
      setAddMemberUid('')
      setAddMemberJabatan('')
      setEditAnggotaId(null)
      setEditAnggotaData({})
      await loadOrgList()
    } catch (error) {
      console.error('Error deleting organisasi:', error)
      pushToast('error', error.message || 'Gagal menghapus organisasi')
    } finally {
      setLoading(false)
    }
  }

  async function tambahAnggota() {
    if (!orgSel) {
      pushToast('error', 'Pilih organisasi terlebih dahulu')
      return
    }
    
    if (!addMemberUid) {
      pushToast('error', 'Pilih siswa yang akan ditambahkan')
      return
    }

    const jabatan = (addMemberJabatan || 'Anggota').trim()

    try {
      setLoading(true)
      const siswa = memberOptions.find(s => s.uid === addMemberUid) || siswaList.find(s => s.uid === addMemberUid)
      const namaSiswa = siswa?.nama || ''

      const { error } = await supabase
        .from('organisasi_anggota')
        .insert({
          organisasi_id: orgSel,
          siswa_id: addMemberUid,
          nama: namaSiswa,
          kelas: siswa?.kelas || '',
          jabatan,
          created_at: new Date().toISOString()
        })

      if (error) throw error

      pushToast('success', 'Anggota berhasil ditambahkan')
      setAddMemberUid('')
      setAddMemberJabatan('')
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error adding anggota:', error)
      pushToast('error', error.message || 'Gagal menambah anggota')
    } finally {
      setLoading(false)
    }
  }

  async function hapusAnggota(anggota) {
    if (!confirmDelete(`Hapus ${anggota.nama} dari organisasi?`)) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('organisasi_anggota')
        .delete()
        .eq('id', anggota.id)

      if (error) throw error

      pushToast('success', 'Anggota berhasil dihapus')
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error deleting anggota:', error)
      pushToast('error', error.message || 'Gagal menghapus anggota')
    } finally {
      setLoading(false)
    }
  }

  function startEditAnggota(anggota) {
    setEditAnggotaId(anggota.id)
    setEditAnggotaData({ ...anggota })
  }

  function batalEditAnggota() {
    setEditAnggotaId(null)
    setEditAnggotaData({})
  }

  async function saveEditAnggota() {
    if (!editAnggotaId) return

    const jabatan = (editAnggotaData.jabatan || '').trim()
    if (!jabatan) {
      pushToast('error', 'Jabatan tidak boleh kosong')
      return
    }

    try {
      setLoading(true)
      const { error } = await supabase
        .from('organisasi_anggota')
        .update({
          jabatan,
          updated_at: new Date().toISOString()
        })
        .eq('id', editAnggotaId)

      if (error) throw error

      pushToast('success', 'Data anggota berhasil diupdate')
      setEditAnggotaId(null)
      setEditAnggotaData({})
      await loadOrgAnggota()
    } catch (error) {
      console.error('Error updating anggota:', error)
      pushToast('error', error.message || 'Gagal mengupdate anggota')
    } finally {
      setLoading(false)
    }
  }

  const isEditingOrg = Boolean(orgSel)

  return (
    <div className="space-y-6">
      {showHeader && (
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-green-100 rounded-lg">👥</span>
              <span>Organisasi Sekolah</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Kelola organisasi, pembina, serta anggota siswa
            </p>
          </div>
        </div>
      </div>
      )}

      {/* Statistik */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 shadow border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Organisasi</p>
              <p className="text-2xl font-bold text-gray-900">{orgList.length}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <span className="text-xl">👥</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-blue-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Anggota</p>
              <p className="text-2xl font-bold text-gray-900">{orgAnggota.length}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <span className="text-xl">👨‍🎓</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-purple-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Pembina</p>
              <p className="text-2xl font-bold text-gray-900">
                {orgList.filter(o => o.pembina_guru_id).length}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg">
              <span className="text-xl">👨‍🏫</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border border-yellow-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Opsi Siswa</p>
              <p className="text-2xl font-bold text-gray-900">{memberOptionsLoading ? '...' : memberOptions.length}</p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-lg">
              <span className="text-xl">📋</span>
            </div>
          </div>
        </div>
      </div>

      {/* Organisasi + Detail */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List Organisasi */}
          <div className="lg:border-r lg:pr-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
                <span className="p-1.5 bg-blue-100 rounded-lg">📂</span>
                <span>Daftar Organisasi</span>
              </h3>
              <span className="text-xs text-gray-500">{orgList.length}</span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {orgList.map(o => (
                <button
                  key={o.id}
                  className={`w-full text-left p-3 rounded-xl border text-sm transition-all duration-200 flex justify-between items-start ${
                    orgSel === o.id
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => setOrgSel(o.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{o.nama}</div>
                    {o.pembina_guru_nama && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        Pembina: {o.pembina_guru_nama}
                      </div>
                    )}
                  </div>
                  {orgSel === o.id && (
                    <span className="text-blue-500 ml-2">→</span>
                  )}
                </button>
              ))}
              {!orgList.length && (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                    <span>📂</span>
                  </div>
                  <p className="text-sm">Belum ada organisasi</p>
                </div>
              )}
            </div>

            <button
              className="mt-4 w-full py-2.5 text-sm bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border border-green-200 rounded-lg hover:from-green-100 hover:to-emerald-100 hover:border-green-300 transition-all duration-200 font-medium flex items-center justify-center space-x-2"
              type="button"
              onClick={() => {
                setOrgSel('')
                setOrgForm({ nama: '', visi: '', misi: '', pembinaGuruId: '' })
                setOrgAnggota([])
                setMemberSearch('')
                setAddMemberUid('')
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Buat Organisasi Baru</span>
            </button>
          </div>

          {/* Detail Organisasi */}
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
                <span className="p-1.5 bg-green-100 rounded-lg">📝</span>
                <span>{isEditingOrg ? 'Detail Organisasi' : 'Organisasi Baru'}</span>
              </h3>
              {isEditingOrg && (
                <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                  Sedang diedit
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nama Organisasi <span className="text-red-500">*</span>
                </label>
                <input
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                  value={orgForm.nama}
                  onChange={e => setOrgForm(f => ({ ...f, nama: e.target.value }))}
                  placeholder="cth: OSIS, Pramuka, PMR"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Visi
                  </label>
                  <textarea
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[100px]"
                    value={orgForm.visi}
                    onChange={e => setOrgForm(f => ({ ...f, visi: e.target.value }))}
                    placeholder="Tuliskan visi organisasi..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Misi
                  </label>
                  <textarea
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900 min-h-[100px]"
                    value={orgForm.misi}
                    onChange={e => setOrgForm(f => ({ ...f, misi: e.target.value }))}
                    placeholder="Tuliskan misi organisasi..."
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pembina Guru
                </label>
                <select
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm text-gray-900"
                  value={orgForm.pembinaGuruId}
                  onChange={e => setOrgForm(f => ({ ...f, pembinaGuruId: e.target.value }))}
                >
                  <option value="">Pilih guru pembina</option>
                  {guruList.map(g => (
                    <option key={g.id} value={g.id}>{g.label || g.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                {isEditingOrg ? (
                  <>
                    <button
                      type="button"
                      className="px-4 py-2.5 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 font-medium flex items-center space-x-2 transition-all duration-200"
                      onClick={hapusOrganisasi}
                      disabled={loading}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Hapus</span>
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2.5 text-sm bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 font-medium flex items-center space-x-2 transition-all duration-200 shadow-md"
                      onClick={simpanOrganisasi}
                      disabled={loading}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Simpan Perubahan</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="w-full md:w-auto px-4 py-2.5 text-sm bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:from-green-700 hover:to-green-800 font-medium flex items-center justify-center space-x-2 transition-all duration-200 shadow-md"
                    onClick={tambahOrganisasi}
                    disabled={loading || !orgForm.nama.trim()}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span>Tambah Organisasi</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Anggota Organisasi */}
      {orgSel && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              <span className="p-2 bg-blue-100 rounded-lg">👨‍🎓</span>
              <span>Anggota Organisasi</span>
            </h3>
            <span className="text-sm text-gray-500">
              {orgAnggota.length} anggota
            </span>
          </div>

          {/* Form tambah anggota */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
            <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center space-x-2">
              <span className="p-1.5 bg-blue-200 rounded-lg">➕</span>
              <span>Tambah Anggota Baru</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-blue-800 mb-1">
                  Siswa <span className="text-red-500">*</span>
                </label>
                <input
                  className="mb-2 block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  value={memberSearch}
                  onChange={(event) => {
                    setMemberSearch(event.target.value)
                    setAddMemberUid('')
                  }}
                  placeholder="Cari nama, NIS, email, atau kelas"
                />
                <select
                  className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  value={addMemberUid}
                  onChange={e => setAddMemberUid(e.target.value)}
                  disabled={memberOptionsLoading}
                >
                  <option value="">{memberOptionsLoading ? 'Memuat siswa...' : 'Pilih siswa'}</option>
                  {memberOptions.map(s => (
                    <option key={s.uid} value={s.uid}>
                      {s.nama} {s.kelas ? `(${s.kelas})` : ''}
                    </option>
                  ))}
                </select>
                {memberOptionsHasMore && (
                  <p className="mt-1 text-[11px] text-blue-700">
                    Hasil dibatasi 50 siswa. Ketik kata kunci lebih spesifik.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-blue-800 mb-1">Jabatan</label>
                <select
                  className="block w-full px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  value={addMemberJabatan}
                  onChange={e => setAddMemberJabatan(e.target.value)}
                >
                  <option value="">Anggota</option>
                  {JABATAN_OPTS.map(j => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-2.5 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-sm font-medium flex items-center justify-center space-x-2 disabled:opacity-50"
                  onClick={tambahAnggota}
                  disabled={loading || memberOptionsLoading || !addMemberUid}
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
                      <span>Tambah Anggota</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* List anggota */}
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Nama Siswa
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Jabatan
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orgAnggota.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                          <span className="text-blue-600 text-xs">👤</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-gray-900">{a.nama}</span>
                          {a.kelas && (
                            <div className="mt-0.5 text-xs text-gray-500">{a.kelas}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editAnggotaId === a.id ? (
                        <div className="flex items-center space-x-2">
                          <select
                            className="px-2 py-1 border border-gray-300 rounded-lg text-sm bg-white"
                            value={editAnggotaData.jabatan || ''}
                            onChange={e => setEditAnggotaData(d => ({ ...d, jabatan: e.target.value }))}
                          >
                            <option value="">Pilih jabatan</option>
                            {JABATAN_OPTS.map(j => (
                              <option key={j} value={j}>{j}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className={`text-sm px-2 py-1 rounded-full ${
                          a.jabatan === 'Ketua' 
                            ? 'bg-yellow-100 text-yellow-800'
                            : a.jabatan === 'Wakil Ketua' || a.jabatan === 'Sekretaris' || a.jabatan === 'Bendahara'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {a.jabatan || 'Anggota'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {editAnggotaId === a.id ? (
                        <>
                          <button
                            className="text-green-600 hover:text-green-800 px-3 py-1.5 rounded-lg hover:bg-green-50 text-sm font-medium transition-colors duration-200"
                            onClick={saveEditAnggota}
                          >
                            Simpan
                          </button>
                          <button
                            className="text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors duration-200"
                            onClick={batalEditAnggota}
                          >
                            Batal
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 text-sm font-medium transition-colors duration-200"
                            onClick={() => startEditAnggota(a)}
                            title="Edit jabatan"
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors duration-200"
                            onClick={() => hapusAnggota(a)}
                            title="Hapus anggota"
                          >
                            Hapus
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!orgAnggota.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                        <span>👥</span>
                      </div>
                      <p className="text-sm">Belum ada anggota</p>
                      <p className="text-xs mt-1">Tambahkan siswa sebagai anggota organisasi ini</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {orgAnggota.length > 0 && (
            <div className="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="font-medium">Total:</span> {orgAnggota.length} anggota
                </div>
                {JABATAN_OPTS.map(jabatan => {
                  const count = orgAnggota.filter(a => a.jabatan === jabatan).length
                  if (count > 0) {
                    return (
                      <div key={jabatan}>
                        <span className="font-medium">{jabatan}:</span> {count}
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )}
        </div>
      )}

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
