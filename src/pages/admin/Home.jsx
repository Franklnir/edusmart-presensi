import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'

/* ===== Utils ===== */
const FORBIDDEN = /[.#$/[\]]/
const slug = (s = '') =>
  s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

const confirmDelete = (msg = 'Yakin mau dihapus?') => window.confirm(msg)
const HARI_OPTS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

// helper parse/format hari ekskul (multi hari, disimpan sebagai string "Senin, Rabu")
const parseEskulDays = (hariText = '') => {
  if (!hariText) return []
  return hariText
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
}

const formatEskulDays = (hariArray = []) => {
  if (!Array.isArray(hariArray)) return ''
  return hariArray.join(', ')
}

// Komponen Stat Card
const StatCard = ({ label, value, icon, color = 'blue' }) => {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-orange-600',
    red: 'from-rose-500 to-rose-600',
    indigo: 'from-indigo-500 to-indigo-600'
  }

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-lg border border-gray-200 p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        {icon && (
          <div
            className={`text-2xl bg-gradient-to-br ${colorClasses[color]} text-white p-3 rounded-xl`}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="mt-4 h-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
    </div>
  )
}

// Loading Skeleton
const LoadingSkeleton = () => (
  <div className="animate-pulse">
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-gray-200 rounded-2xl h-24" />
      ))}
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="bg-gray-200 rounded-2xl h-96" />
      ))}
    </div>
  </div>
)

// ===================================================================
//    Halaman Home Admin (Dashboard, Pengumuman & Ekstrakurikuler)
// ===================================================================
export default function AHome() {
  const { pushToast } = useUIStore()
  const { user, profile } = useAuthStore()

  const [isLoading, setIsLoading] = useState(true)

  /* --- Statistics --- */
  const [stats, setStats] = useState({
    siswa: 0,
    guru: 0,
    admin: 0,
    kelas: 0,
    absensi: 0,
    pengumuman: 0,
    eskul: 0
  })

  /* --- Monitoring Admin --- */
  const [adminList, setAdminList] = useState([])

  useEffect(() => {
    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAllData = async () => {
    setIsLoading(true)
    try {
      await Promise.all([
        loadStatistics(),
        loadGuruDanSiswa(),
        loadPengumuman(),
        loadEskulList(),
        loadAdminList()
      ])
    } catch (error) {
      pushToast('error', 'Gagal memuat data awal')
    } finally {
      setIsLoading(false)
    }
  }

  const loadStatistics = async () => {
    try {
      const [
        { count: siswa },
        { count: guru },
        { count: admin },
        { count: kelas },
        { count: absensi },
        { count: pengumuman },
        { count: eskul }
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'siswa'),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'guru'),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin'),
        supabase.from('kelas').select('*', { count: 'exact', head: true }),
        supabase.from('absensi').select('*', { count: 'exact', head: true }),
        supabase.from('pengumuman').select('*', { count: 'exact', head: true }),
        supabase.from('ekskul').select('*', { count: 'exact', head: true })
      ])

      setStats({
        siswa: siswa || 0,
        guru: guru || 0,
        admin: admin || 0,
        kelas: kelas || 0,
        absensi: absensi || 0,
        pengumuman: pengumuman || 0,
        eskul: eskul || 0
      })
    } catch (error) {
      pushToast('error', 'Gagal memuat statistik')
    }
  }

  const loadAdminList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama, email, status')
        .eq('role', 'admin')
        .order('nama')

      if (error) throw error

      setAdminList(
        (data || []).map((a) => ({
          id: a.id,
          nama: a.nama || a.email || 'Tanpa Nama',
          email: a.email || '-',
          status: a.status || 'active'
        }))
      )
    } catch (error) {
      pushToast('error', 'Gagal memuat data admin')
    }
  }

  /* --- Data Umum (Guru & Siswa) --- */
  const [guruList, setGuruList] = useState([])
  const [siswaList, setSiswaList] = useState([])

  const loadGuruDanSiswa = async () => {
    try {
      // Load guru dari profiles
      const { data: guruData, error: guruError } = await supabase
        .from('profiles')
        .select('id, nama, email, role')
        .in('role', ['guru', 'teacher'])
        .order('nama')

      if (!guruError && guruData) {
        const formattedGuru = guruData.map((guru) => ({
          id: guru.id,
          name: `${guru.nama || 'Tanpa Nama'}${
            guru.email ? ` (${guru.email})` : ''
          }`
        }))
        setGuruList(formattedGuru)
      }

      // Load siswa dari profiles
      const { data: siswaData, error: siswaError } = await supabase
        .from('profiles')
        .select('id, nama, email, kelas, role')
        .eq('role', 'siswa')
        .order('kelas')
        .order('nama')

      if (!siswaError && siswaData) {
        const formattedSiswa = siswaData.map((siswa) => ({
          uid: siswa.id,
          nama: siswa.nama || siswa.email || 'Tanpa Nama',
          kelas: siswa.kelas || '',
          email: siswa.email
        }))
        setSiswaList(formattedSiswa)
      }
    } catch (error) {
      pushToast('error', 'Gagal memuat data guru dan siswa')
    }
  }

  // Map cepat: uid → {nama, kelas}
  const siswaMap = useMemo(() => {
    const m = {}
    siswaList.forEach((s) => {
      m[s.uid] = s
    })
    return m
  }, [siswaList])

  /* --- Section 1: Pengumuman --- */
  const [pengumumanList, setPengumumanList] = useState([])
  const [pForm, setPForm] = useState({
    judul: '',
    keterangan: '',
    target: 'semua'
  })
  const [pEditId, setPEditId] = useState(null)
  const [loadingPengumuman, setLoadingPengumuman] = useState(false)

  const loadPengumuman = async () => {
    try {
      const { data, error } = await supabase
        .from('pengumuman')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setPengumumanList(data || [])
    } catch (error) {
      pushToast('error', 'Gagal memuat pengumuman')
    }
  }

  async function simpanPengumuman(e) {
    e.preventDefault()
    const { judul, keterangan, target } = pForm
    if (!judul || !keterangan) {
      pushToast('error', 'Judul dan Keterangan wajib diisi.')
      return
    }

    setLoadingPengumuman(true)
    const payload = {
      judul: judul.trim(),
      keterangan: keterangan.trim(),
      target: target || 'semua',
      updated_at: new Date().toISOString()
    }

    try {
      if (pEditId) {
        const { error } = await supabase
          .from('pengumuman')
          .update(payload)
          .eq('id', pEditId)

        if (error) throw error
        pushToast('success', 'Pengumuman diperbarui!')
      } else {
        const id = slug(payload.judul) || Date.now().toString()

        // Check if exists
        const { data: existing } = await supabase
          .from('pengumuman')
          .select('id')
          .eq('id', id)
          .single()

        if (existing) {
          pushToast('error', 'Pengumuman dengan judul ini sudah ada.')
          return
        }

        const { error } = await supabase.from('pengumuman').insert({
          ...payload,
          id,
          created_at: new Date().toISOString()
        })

        if (error) throw error
        pushToast('success', 'Pengumuman disimpan!')
      }
      cancelEditPengumuman()
      loadPengumuman()
      loadStatistics()
    } catch (err) {
      pushToast('error', 'Gagal menyimpan pengumuman')
    } finally {
      setLoadingPengumuman(false)
    }
  }

  async function hapusPengumuman(id) {
    if (!confirmDelete('Hapus pengumuman ini?')) return

    try {
      const { error } = await supabase
        .from('pengumuman')
        .delete()
        .eq('id', id)

      if (error) throw error
      pushToast('success', 'Pengumuman dihapus!')
      loadPengumuman()
      loadStatistics()
    } catch (error) {
      pushToast('error', 'Gagal menghapus pengumuman')
    }
  }

  function startEditPengumuman(p) {
    setPEditId(p.id)
    setPForm({
      judul: p.judul,
      keterangan: p.keterangan,
      target: p.target || 'semua'
    })
  }

  function cancelEditPengumuman() {
    setPEditId(null)
    setPForm({ judul: '', keterangan: '', target: 'semua' })
  }

  /* --- Section 2: Ekstrakurikuler --- */
  const [eskulList, setEskulList] = useState([])
  const [eskulSel, setEskulSel] = useState('')
  const [eskulForm, setEskulForm] = useState({
    nama: '',
    keterangan: '',
    hari: '',
    jam_mulai: '',
    jam_selesai: '',
    pembina_guru_id: ''
  })
  const [eskulAnggota, setEskulAnggota] = useState([])
  // statistik absensi eskul per anggota (Hadir & Izin) untuk semua bulan
  const [eskulAbsensiStats, setEskulAbsensiStats] = useState({})
  const [addMemberUid, setAddMemberUid] = useState('')
  const [loadingEskul, setLoadingEskul] = useState(false)

  const loadEskulList = async () => {
    try {
      const { data, error } = await supabase.from('ekskul').select('*').order('nama')

      if (error) throw error
      setEskulList(data || [])
    } catch (error) {
      pushToast('error', 'Gagal memuat daftar eskul')
    }
  }

  useEffect(() => {
    if (!eskulSel) {
      setEskulForm({
        nama: '',
        keterangan: '',
        hari: '',
        jam_mulai: '',
        jam_selesai: '',
        pembina_guru_id: ''
      })
      setEskulAnggota([])
      setEskulAbsensiStats({})
      return
    }

    loadEskulDetail()
    loadEskulAnggota()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eskulSel])

  const loadEskulDetail = async () => {
    try {
      const { data, error } = await supabase
        .from('ekskul')
        .select('*')
        .eq('id', eskulSel)
        .single()

      if (error) throw error
      if (data) {
        setEskulForm({
          nama: data.nama || '',
          keterangan: data.keterangan || '',
          hari: data.hari || '',
          jam_mulai: data.jam_mulai || '',
          jam_selesai: data.jam_selesai || '',
          pembina_guru_id: data.pembina_guru_id || ''
        })
      }
    } catch (error) {
      // Tidak perlu toast untuk error detail, karena form sudah reset
    }
  }

  const loadEskulAnggota = async () => {
    if (!eskulSel) return

    try {
      const { data, error } = await supabase
        .from('ekskul_anggota')
        .select('*')
        .eq('ekskul_id', eskulSel)

      if (error) throw error
      const anggota = data || []
      setEskulAnggota(anggota)

      // Ambil statistik absensi eskul (Hadir & Izin) untuk SEMUA bulan
      const userIds = anggota.map((a) => a.user_id).filter(Boolean)

      if (userIds.length === 0) {
        setEskulAbsensiStats({})
        return
      }

      const { data: absData, error: absError } = await supabase
        .from('absensi_eskul')
        .select('user_id, status')
        .eq('ekskul_id', eskulSel)
        .in('user_id', userIds)
        .in('status', ['Hadir', 'Izin'])

      if (absError) throw absError

      const stats = {}
      ;(absData || []).forEach((row) => {
        const uid = row.user_id
        if (!stats[uid]) {
          stats[uid] = { hadir: 0, izin: 0 }
        }
        if (row.status === 'Hadir') {
          stats[uid].hadir += 1
        } else if (row.status === 'Izin') {
          stats[uid].izin += 1
        }
      })

      setEskulAbsensiStats(stats)
    } catch (error) {
      pushToast('error', 'Gagal memuat data anggota eskul')
    }
  }

  // daftar hari yang sedang dipilih (multi hari)
  const selectedHariValues = useMemo(
    () => parseEskulDays(eskulForm.hari),
    [eskulForm.hari]
  )

  // Gabungkan data anggota dengan data siswa (nama + kelas + statistik hadir/izin)
  const anggotaDisplay = useMemo(() => {
    const rows = eskulAnggota.map((a) => {
      const s = siswaMap[a.user_id] || {}
      const stat = eskulAbsensiStats[a.user_id] || { hadir: 0, izin: 0 }
      return {
        uid: a.user_id,
        id: a.id,
        nama: s.nama || a.user_id,
        kelas: s.kelas || '—',
        hadirCount: stat.hadir,
        izinCount: stat.izin
      }
    })
    return rows.sort(
      (a, b) =>
        (a.kelas || '').localeCompare(b.kelas || '', 'id') ||
        (a.nama || '').localeCompare(b.nama || '', 'id')
    )
  }, [eskulAnggota, siswaMap, eskulAbsensiStats])

  // toggle hari (checkbox di dropdown)
  const handleToggleHari = (hariValue) => {
    setEskulForm((prev) => {
      const current = parseEskulDays(prev.hari)
      const exists = current.includes(hariValue)
      const next = exists
        ? current.filter((h) => h !== hariValue)
        : [...current, hariValue]

      return {
        ...prev,
        hari: formatEskulDays(next)
      }
    })
  }

  async function simpanEskul() {
    const nama = (eskulForm.nama || '').trim()
    if (!nama) {
      pushToast('error', 'Nama eskul wajib diisi.')
      return
    }

    setLoadingEskul(true)
    const pembinaId = eskulForm.pembina_guru_id || ''

    const payload = {
      nama,
      keterangan: eskulForm.keterangan || '',
      // simpan hari sebagai string "Senin, Rabu" (multi hari)
      hari: eskulForm.hari || '',
      jam_mulai: eskulForm.jam_mulai || '',
      jam_selesai: eskulForm.jam_selesai || '',
      pembina_guru_id: pembinaId || null,
      updated_at: new Date().toISOString()
    }

    try {
      if (eskulSel) {
        const { error } = await supabase
          .from('ekskul')
          .update(payload)
          .eq('id', eskulSel)

        if (error) throw error
        pushToast('success', 'Eskul diperbarui!')
      } else {
        const id = slug(nama)

        // Check if exists
        const { data: existing } = await supabase
          .from('ekskul')
          .select('id')
          .eq('id', id)
          .single()

        if (existing) {
          pushToast('error', 'Eskul dengan nama ini sudah ada.')
          return
        }

        const { error } = await supabase.from('ekskul').insert({
          ...payload,
          id,
          created_at: new Date().toISOString()
        })

        if (error) throw error
        pushToast('success', 'Eskul disimpan!')
        setEskulSel(id)
      }
      loadEskulList()
      loadStatistics()
    } catch (err) {
      pushToast('error', 'Gagal menyimpan eskul')
    } finally {
      setLoadingEskul(false)
    }
  }

  async function hapusEskul() {
    if (!eskulSel) return
    if (
      !confirmDelete(`Hapus eskul "${eskulForm.nama || eskulSel}" beserta anggotanya?`)
    )
      return

    try {
      // Hapus anggota terlebih dahulu
      const { error: errorAnggota } = await supabase
        .from('ekskul_anggota')
        .delete()
        .eq('ekskul_id', eskulSel)

      if (errorAnggota) throw errorAnggota

      // Hapus eskul
      const { error: errorEskul } = await supabase
        .from('ekskul')
        .delete()
        .eq('id', eskulSel)

      if (errorEskul) throw errorEskul

      pushToast('success', 'Eskul berhasil dihapus!')
      setEskulSel('')
      loadEskulList()
      loadStatistics()
    } catch (error) {
      pushToast('error', 'Gagal menghapus eskul')
    }
  }

  async function tambahAnggotaEskul() {
    if (!eskulSel || !addMemberUid) return

    try {
      const { error } = await supabase.from('ekskul_anggota').insert({
        ekskul_id: eskulSel,
        user_id: addMemberUid,
        created_at: new Date().toISOString()
      })

      if (error) throw error
      pushToast('success', 'Anggota berhasil ditambahkan!')
      setAddMemberUid('')
      loadEskulAnggota()
    } catch (error) {
      pushToast('error', 'Gagal menambah anggota')
    }
  }

  async function hapusAnggotaEskul(anggotaId) {
    if (!eskulSel) return
    if (!confirmDelete('Hapus anggota ini dari eskul?')) return

    try {
      const { error } = await supabase
        .from('ekskul_anggota')
        .delete()
        .eq('id', anggotaId)

      if (error) throw error
      pushToast('success', 'Anggota berhasil dihapus!')
      loadEskulAnggota()
    } catch (error) {
      pushToast('error', 'Gagal menghapus anggota')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
        <div className="w-full">
          <LoadingSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
  
        </div>

        {/* --- DASHBOARD STATISTICS --- */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard label="Total Siswa" value={stats.siswa} icon="👨‍🎓" color="blue" />
          <StatCard label="Total Guru" value={stats.guru} icon="👨‍🏫" color="green" />
          {/* Card Total Admin DIHAPUS sesuai permintaan */}
          <StatCard label="Kelas" value={stats.kelas} icon="🏫" color="purple" />
          <StatCard label="Absensi" value={stats.absensi} icon="📊" color="orange" />
          <StatCard
            label="Informasi"
            value={stats.pengumuman}
            icon="📢"
            color="red"
          />
          <StatCard
            label="Eskul"
            value={stats.eskul}
            icon="⚽"
            color="green"
          />
        </div>

        {/* --- FORM PENGUMUMAN & ESKUL --- */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* === KOLOM PENGUMUMAN === */}
          <div className="space-y-6">
            {/* --- CARD FORM PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-2xl">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white/20 rounded-xl">
                      <span className="text-2xl text-white">📢</span>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        Kelola Pengumuman
                      </h2>
                      <p className="text-blue-100 mt-1">
                        Tambah atau edit pengumuman untuk guru & siswa
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium">
                    📋 Admin
                  </div>
                </div>
              </div>

              <div className="p-6">
                <form className="space-y-6" onSubmit={simpanPengumuman}>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-500 rounded-full" />
                          Judul Pengumuman
                        </span>
                      </label>
                      <input
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                        placeholder="Cth: Libur Nasional, Rapat Guru"
                        value={pForm.judul}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, judul: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-green-500 rounded-full" />
                          Keterangan / Isi
                        </span>
                      </label>
                      <textarea
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[120px] transition-all duration-200"
                        placeholder="Isi pengumuman..."
                        value={pForm.keterangan}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, keterangan: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-purple-500 rounded-full" />
                          Tampilkan ke
                        </span>
                      </label>
                      <select
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                        value={pForm.target}
                        onChange={(e) =>
                          setPForm((f) => ({ ...f, target: e.target.value }))
                        }
                      >
                        <option value="semua">Semua (Guru & Siswa)</option>
                        <option value="siswa">Siswa Saja</option>
                        <option value="guru">Guru Saja</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
                    {pEditId && (
                      <button
                        type="button"
                        className="px-6 py-3 text-sm font-semibold text-gray-700 bg-white border-2 border-gray-300 rounded-xl hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md"
                        onClick={cancelEditPengumuman}
                      >
                        ✕ Batal Edit
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl hover:from-blue-700 hover:to-indigo-800 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={loadingPengumuman}
                    >
                      {loadingPengumuman ? (
                        <span className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Menyimpan...
                        </span>
                      ) : pEditId ? (
                        '💾 Simpan Perubahan'
                      ) : (
                        '📝 Tambah Pengumuman'
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* --- CARD DAFTAR PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-2xl">
              <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="p-2 bg-blue-100 text-blue-600 rounded-lg">📋</span>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      Daftar Pengumuman
                    </h3>
                    <p className="text-xs text-gray-500">
                      {pengumumanList.length} pengumuman tersimpan
                    </p>
                  </div>
                </div>
                {pengumumanList.length > 0 && (
                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-white/70 text-blue-700">
                    Terbaru di atas
                  </span>
                )}
              </div>

              <div className="p-6">
                {/* max-h disamakan dengan daftar anggota eskul (max-h-80) supaya scroll rapi */}
                <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                  {pengumumanList.map((p, index) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-5 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 group"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="font-semibold text-gray-900 text-lg group-hover:text-blue-700 transition-colors">
                            {p.judul}
                          </div>
                          {index === 0 && (
                            <span className="px-3 py-1 text-xs font-bold bg-green-100 text-green-800 rounded-full">
                              TERBARU
                            </span>
                          )}
                        </div>
                        <div className="text-gray-600 text-sm leading-relaxed line-clamp-2">
                          {p.keterangan}
                        </div>
                        <div className="flex items-center gap-4 mt-3 text-xs">
                          <span
                            className={`px-3 py-1 rounded-full font-medium ${
                              p.target === 'siswa'
                                ? 'bg-orange-100 text-orange-800'
                                : p.target === 'guru'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            👥 {p.target || 'semua'}
                          </span>
                          <span className="text-gray-500">
                            📅{' '}
                            {p.created_at
                              ? new Date(p.created_at).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric'
                                })
                              : '-'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          className="px-4 py-2 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md"
                          onClick={() => startEditPengumuman(p)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md"
                          onClick={() => hapusPengumuman(p.id)}
                        >
                          🗑️ Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                  {pengumumanList.length === 0 && (
                    <div className="text-center py-12">
                      <div className="text-gray-300 text-6xl mb-4">📢</div>
                      <p className="text-gray-500 text-lg font-medium">
                        Belum ada pengumuman
                      </p>
                      <p className="text-gray-400 mt-2">
                        Mulai dengan membuat pengumuman pertama
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* === KOLOM EKSTRAKURIKULER === */}
          <div className="space-y-6">
            {/* Form utama eskul */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-2xl">
              <div className="bg-gradient-to-r from-orange-600 to-amber-700 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white/20 rounded-xl">
                      <span className="text-2xl text-white">⚽</span>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        Kelola Ekstrakurikuler
                      </h2>
                      <p className="text-orange-100 mt-1">
                        Atur data ekskul, jadwal, dan pembina
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium">
                    🏆 {eskulList.length} Eskul
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full" />
                        Pilih Eskul
                      </span>
                    </label>
                    <select
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-200"
                      value={eskulSel}
                      onChange={(e) => setEskulSel(e.target.value)}
                    >
                      <option value="">— Buat Eskul Baru —</option>
                      {eskulList.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 ml-6">
                    {eskulSel && (
                      <button
                        className="px-6 py-3 text-sm font-semibold text-red-600 bg-red-50 border-2 border-red-200 rounded-xl hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md"
                        onClick={hapusEskul}
                      >
                        🗑️ Hapus
                      </button>
                    )}
                    <button
                      className="px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-orange-600 to-amber-700 rounded-xl hover:from-orange-700 hover:to-amber-800 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={simpanEskul}
                      disabled={loadingEskul}
                    >
                      {loadingEskul ? (
                        <span className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Menyimpan...
                        </span>
                      ) : eskulSel ? (
                        '💾 Simpan Perubahan'
                      ) : (
                        '✨ Tambah Eskul Baru'
                      )}
                    </button>
                  </div>
                </div>

                {/* Form detail eskul */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 md:gap-x-10 items-start">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                        Nama Eskul
                      </span>
                    </label>
                    <input
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                      placeholder="cth: Pramuka, Paskibra"
                      value={eskulForm.nama}
                      onChange={(e) =>
                        setEskulForm((f) => ({ ...f, nama: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Pembina (Guru)
                      </span>
                    </label>
                    <select
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200"
                      value={eskulForm.pembina_guru_id}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          pembina_guru_id: e.target.value
                        }))
                      }
                    >
                      <option value="">— Pilih guru —</option>
                      {guruList.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Hari */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full" />
                        Hari
                      </span>
                    </label>
                    <div className="space-y-2">
                      {/* Dropdown + checkbox multi-hari */}
                      <details className="group relative">
                        <summary className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-purple-500 transition-all duration-200 flex items-center justify-between cursor-pointer list-none">
                          <span className="text-sm text-gray-700">
                            {selectedHariValues.length === 0
                              ? 'Pilih hari'
                              : selectedHariValues.join(', ')}
                          </span>
                          <span className="ml-2 text-xs text-gray-500 group-open:rotate-180 transform transition-transform">
                            ▾
                          </span>
                        </summary>
                        <div className="mt-2 absolute z-20 w-full bg-white border-2 border-purple-100 rounded-xl shadow-lg p-3 max-h-48 overflow-y-auto">
                          {HARI_OPTS.map((h) => {
                            const checked = selectedHariValues.includes(h)
                            return (
                              <label
                                key={h}
                                className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-purple-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded text-purple-600 focus:ring-purple-500"
                                  checked={checked}
                                  onChange={() => handleToggleHari(h)}
                                />
                                <span className="text-sm text-gray-700">{h}</span>
                              </label>
                            )
                          })}
                        </div>
                      </details>
                      <p className="text-xs text-gray-400">
                        Bisa pilih lebih dari satu hari untuk jadwal ekskul.
                      </p>
                    </div>
                  </div>

                  {/* Jadwal (Mulai) */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full" />
                        Jadwal (Mulai)
                      </span>
                    </label>
                    <input
                      type="time"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all duration-200"
                      value={eskulForm.jam_mulai}
                      onChange={(e) =>
                        setEskulForm((f) => ({ ...f, jam_mulai: e.target.value }))
                      }
                    />
                  </div>

                  {/* Jadwal selesai */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full" />
                        Jadwal (Selesai)
                      </span>
                    </label>
                    <input
                      type="time"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all duration-200"
                      value={eskulForm.jam_selesai}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          jam_selesai: e.target.value
                        }))
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full" />
                        Keterangan
                      </span>
                    </label>
                    <textarea
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 min-h-[100px]"
                      value={eskulForm.keterangan}
                      onChange={(e) =>
                        setEskulForm((f) => ({
                          ...f,
                          keterangan: e.target.value
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Anggota eskul */}
            {eskulSel && (
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-2xl">
                <div className="bg-gradient-to-r from-emerald-600 to-green-700 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/20 rounded-xl">
                        <span className="text-2xl text-white">👥</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">
                          Anggota • {eskulForm.nama || eskulSel}
                        </h3>
                        <p className="text-emerald-100 mt-1">
                          {anggotaDisplay.length} siswa mengikuti
                        </p>
                      </div>
                    </div>
                    <div className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium">
                      🎯 {anggotaDisplay.length} Anggota
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-3">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                          Tambah Anggota (Siswa)
                        </span>
                      </label>
                      <select
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200"
                        value={addMemberUid}
                        onChange={(e) => setAddMemberUid(e.target.value)}
                      >
                        <option value="">— Pilih siswa —</option>
                        {siswaList.map((s) => (
                          <option key={s.uid} value={s.uid}>
                            {s.nama} ({s.kelas || '—'})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        className="w-full px-6 py-3 text-sm font-semibold text-gray-700 bg-white border-2 border-gray-300 rounded-xl hover:bg-gray-50 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={tambahAnggotaEskul}
                        disabled={!addMemberUid}
                      >
                        ➕ Tambah
                      </button>
                    </div>
                  </div>

                  <div className="border-t pt-8">
                    <h4 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
                      <span className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                        📊
                      </span>
                      Daftar Anggota
                    </h4>
                    {/* max-h-80: disamakan dengan daftar pengumuman */}
                    <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                      {anggotaDisplay.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50 transition-all duration-200 group"
                        >
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg group-hover:bg-emerald-200 transition-colors">
                              👤
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
                                {a.nama}
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                Kelas:{' '}
                                <span className="font-medium">{a.kelas}</span>
                              </div>
                              {/* Status kehadiran & izin (total semua bulan) */}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                                  ✅ Hadir:
                                  <span className="ml-1">{a.hadirCount}</span>
                                </span>
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">
                                  📝 Izin:
                                  <span className="ml-1">{a.izinCount}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            className="px-4 py-2 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 hover:shadow-md"
                            onClick={() => hapusAnggotaEskul(a.id)}
                          >
                            🗑️ Hapus
                          </button>
                        </div>
                      ))}
                      {anggotaDisplay.length === 0 && (
                        <div className="text-center py-12">
                          <div className="text-gray-300 text-6xl mb-4">👥</div>
                          <p className="text-gray-500 text-lg font-medium">
                            Belum ada anggota
                          </p>
                          <p className="text-gray-400 mt-2">
                            Tambahkan siswa ke ekskul ini
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* --- MONITORING ADMIN (DI BAWAH SEMUA) --- */}
        {adminList.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  🛡️
                </span>
                Monitoring Admin
              </h2>
              <span className="px-4 py-1 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700">
                {adminList.length} admin terdaftar
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">
                      Nama
                    </th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">
                      Email
                    </th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">
                      Status Login
                    </th>
                    <th className="text-left py-3 px-3 font-semibold text-gray-700">
                      Status Akun
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {adminList.map((a) => {
                    const isCurrentAdmin =
                      (profile && a.id === profile.id) || (user && a.id === user.id)
                    const isActiveAccount = (a.status || 'active') === 'active'

                    return (
                      <tr
                        key={a.id}
                        className="border-b last:border-0 hover:bg-indigo-50/40 transition-colors"
                      >
                        <td className="py-3 px-3 text-gray-900 font-medium">
                          {a.nama}
                          {isCurrentAdmin && (
                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                              Anda
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-600">{a.email}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                              isCurrentAdmin
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            <span className="w-2 h-2 rounded-full mr-2 bg-current" />
                            {isCurrentAdmin ? 'Online sekarang' : 'Offline'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                              isActiveAccount
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {isActiveAccount ? 'Akun aktif' : 'Akun nonaktif'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}