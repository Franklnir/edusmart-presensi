import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/Badge'
import { useUIStore } from '../../store/useUIStore'

// Helper: render link / gambar lampiran
const renderLink = (url, text) => {
  if (!url) return null
  try {
    if (/\.(jpeg|jpg|gif|png|webp)$/i.test(url)) {
      return (
        <img
          src={url}
          alt="lampiran"
          className="max-w-xs max-h-32 rounded-lg mt-1 border border-gray-200 transition-transform duration-200 hover:scale-105"
        />
      )
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all duration-200 mt-1"
      >
        {text}
      </a>
    )
  } catch {
    return null
  }
}

// Komponen Modal untuk Detail Organisasi
const OrganisasiModal = ({ organisasi, isOpen, onClose }) => {
  if (!isOpen || !organisasi) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden transform transition-all duration-300 scale-100">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">{organisasi.nama}</h2>
              <div className="flex flex-wrap items-center gap-4 text-purple-100 text-sm">
                <span className="flex items-center gap-2 bg-purple-500/30 px-3 py-1 rounded-full">
                  <span className="text-sm">👨‍🏫</span>
                  <span>Pembina: {organisasi.pembina_guru_nama || 'Belum ada'}</span>
                </span>
                <span className="flex items-center gap-2 bg-purple-500/30 px-3 py-1 rounded-full">
                  <span className="text-sm">👥</span>
                  <span>{organisasi.anggota?.length || 0} Anggota</span>
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-purple-200 transition-all duration-200 text-xl bg-purple-500/30 hover:bg-purple-500/50 w-8 h-8 rounded-full flex items-center justify-center ml-4"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Modal */}
        <div className="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
          {/* Visi & Misi */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200 shadow-sm">
              <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2 text-base">
                <span className="text-blue-600 text-lg">🎯</span>
                Visi Organisasi
              </h3>
              <p className="text-blue-800 text-sm leading-relaxed">
                {organisasi.visi || 'Belum ada visi yang ditentukan'}
              </p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200 shadow-sm">
              <h3 className="font-bold text-green-900 mb-3 flex items-center gap-2 text-base">
                <span className="text-green-600 text-lg">📋</span>
                Misi Organisasi
              </h3>
              <p className="text-green-800 text-sm leading-relaxed">
                {organisasi.misi || 'Belum ada misi yang ditentukan'}
              </p>
            </div>
          </div>

          {/* Struktur Kepengurusan */}
          <div className="mb-4">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2 text-base">
              <span className="text-purple-600 text-lg">🏛️</span>
              Struktur Kepengurusan
            </h3>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {organisasi.anggota?.map((anggota, index) => (
                  <div
                    key={anggota.id}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md ${
                      anggota.jabatan === 'Ketua' 
                        ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-amber-300' 
                        : anggota.jabatan === 'Wakil Ketua'
                        ? 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-300'
                        : anggota.jabatan?.includes('Sekretaris') || anggota.jabatan?.includes('Bendahara')
                        ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-300'
                        : 'bg-gray-50 border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 text-sm leading-tight mb-1">
                          {anggota.nama}
                        </h4>
                        <p className="text-xs text-gray-600">{anggota.kelas}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        anggota.jabatan === 'Ketua' 
                          ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                          : anggota.jabatan === 'Wakil Ketua'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : anggota.jabatan?.includes('Sekretaris') || anggota.jabatan?.includes('Bendahara')
                          ? 'bg-green-100 text-green-800 border border-green-200'
                          : 'bg-gray-100 text-gray-800 border border-gray-200'
                      }`}>
                        {anggota.jabatan || 'Anggota'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {!organisasi.anggota?.length && (
                <div className="text-center py-8 text-gray-500 bg-gray-50">
                  <div className="text-4xl mb-2 opacity-60">👥</div>
                  <p className="text-sm font-medium">Belum ada anggota terdaftar</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Modal */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition-all duration-200 font-medium text-sm shadow-sm hover:shadow-md"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Skeleton Loading Component
const SkeletonLoader = () => (
  <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-4">
    <div className="w-full px-3 sm:px-4 lg:px-5 space-y-4">
      {/* Header Skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-7 bg-gray-200 rounded-lg w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Main Content Skeleton */}
        <div className="xl:col-span-3 space-y-6">
          {/* Pengumuman Skeleton */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <div className="h-6 bg-gray-200 rounded w-1/4"></div>
            </div>
            <div className="p-4 space-y-4">
              {[1, 2, 3].map((item) => (
                <div key={item} className="animate-pulse">
                  <div className="h-5 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Tugas & Organisasi Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((item) => (
              <div key={item} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                </div>
                <div className="p-4 space-y-4">
                  {[1, 2].map((subItem) => (
                    <div key={subItem} className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Skeleton */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
              <div className="h-16 bg-gray-200 rounded-lg mb-4"></div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 bg-gray-200 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)

export default function SHome() {
  const { profile, user } = useAuthStore()
  const { pushToast } = useUIStore()
  const userId = profile?.id || user?.id

  /* ============================
   *          STATE
   * ============================ */
  const [ringkas, setRingkas] = useState({ H: 0, I: 0, A: 0 })
  const [statusUser, setStatusUser] = useState('-')
  const [tugas, setTugas] = useState([])
  const [pengumuman, setPengumuman] = useState([])
  const [ekskul, setEkskul] = useState([])
  const [myEskul, setMyEkskul] = useState(new Set())
  const [organisasi, setOrganisasi] = useState([])
  const [selectedOrganisasi, setSelectedOrganisasi] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const getToday = () => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  /* ============================
   *        LOAD DATA
   * ============================ */
  useEffect(() => {
    if (!userId) return

    const loadAllData = async () => {
      setIsLoading(true)
      try {
        await Promise.all([
          loadPengumuman(),
          loadEskul(),
          loadOrganisasi(),
          ...(profile?.kelas ? [loadAbsensi(), loadTugas()] : [])
        ])
      } catch (error) {
        console.error('Error loading data:', error)
        pushToast('error', 'Gagal memuat data dashboard')
      } finally {
        setIsLoading(false)
      }
    }

    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.kelas])

  const loadPengumuman = async () => {
    try {
      const { data, error } = await supabase
        .from('pengumuman')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      const filtered = (data || []).filter((p) => {
        if (!p.target) return true
        const t = p.target.toLowerCase()
        return t === 'semua' || t === 'siswa'
      })

      setPengumuman(filtered)
    } catch (err) {
      console.error('Error loading pengumuman:', err)
      pushToast('error', 'Gagal memuat pengumuman')
    }
  }

  const loadAbsensi = async () => {
    if (!profile?.kelas || !userId) return
    const today = getToday()

    try {
      const { data, error } = await supabase
        .from('absensi')
        .select('uid, status')
        .eq('kelas', profile.kelas)
        .eq('tanggal', today)

      if (error) throw error

      const agg = { H: 0, I: 0, A: 0 }
      let myStatus = '-'

      ;(data || []).forEach((row) => {
        if (row.status === 'Hadir') agg.H++
        else if (row.status === 'Izin' || row.status === 'Sakit') agg.I++
        else if (row.status === 'Alpha') agg.A++

        if (row.uid === userId) {
          myStatus = row.status || '-'
        }
      })

      setRingkas(agg)
      setStatusUser(myStatus)
    } catch (err) {
      console.error('Error loading absensi:', err)
      pushToast('error', 'Gagal memuat data absensi')
    }
  }

  const loadTugas = async () => {
    if (!profile?.kelas) return
    const nowIso = new Date().toISOString()

    try {
      const { data, error } = await supabase
        .from('tugas')
        .select('*')
        .eq('kelas', profile.kelas)
        .gte('deadline', nowIso)
        .order('deadline', { ascending: true })
        .limit(6)

      if (error) throw error
      setTugas(data || [])
    } catch (err) {
      console.error('Error loading tugas:', err)
      pushToast('error', 'Gagal memuat tugas')
    }
  }

  const loadEskul = async () => {
    if (!userId) return
    try {
      const [
        { data: eskulData, error: eskulError },
        { data: anggotaData, error: anggotaError },
      ] = await Promise.all([
        supabase
          .from('ekskul')
          .select('id, nama, keterangan, hari, jam_mulai, jam_selesai, pembina_guru_id')
          .order('nama'),
        supabase
          .from('ekskul_anggota')
          .select('id, ekskul_id, user_id'),
      ])

      if (eskulError) throw eskulError
      if (anggotaError) throw anggotaError

      const pembinaIds = Array.from(
        new Set((eskulData || []).map((e) => e.pembina_guru_id).filter(Boolean)),
      )

      let pembinaMap = {}
      if (pembinaIds.length) {
        const { data: pembinaData, error: pembinaError } = await supabase
          .from('profiles')
          .select('id, nama')
          .in('id', pembinaIds)

        if (pembinaError) throw pembinaError
        pembinaMap = Object.fromEntries(
          (pembinaData || []).map((p) => [p.id, p.nama || '']),
        )
      }

      const anggotaByEkskul = {}
      const myEskulSet = new Set()

      ;(anggotaData || []).forEach((row) => {
        if (!row.ekskul_id) return
        anggotaByEkskul[row.ekskul_id] =
          (anggotaByEkskul[row.ekskul_id] || 0) + 1
        if (row.user_id === userId) {
          myEskulSet.add(row.ekskul_id)
        }
      })

      const formattedEskul = (eskulData || []).map((e) => ({
        id: e.id,
        nama: e.nama,
        keterangan: e.keterangan || '',
        hari: e.hari || '',
        jam_mulai: e.jam_mulai || '',
        jam_selesai: e.jam_selesai || '',
        pembina_nama: pembinaMap[e.pembina_guru_id] || '',
        jumlah_anggota: anggotaByEkskul[e.id] || 0,
      }))

      setEkskul(formattedEskul)
      setMyEkskul(myEskulSet)
    } catch (err) {
      console.error('Error loading ekskul:', err)
      pushToast('error', 'Gagal memuat data ekstrakurikuler')
    }
  }

  const loadOrganisasi = async () => {
    if (!userId) return
    
    try {
      const { data: organisasiData, error: organisasiError } = await supabase
        .from('organisasi')
        .select('*')
        .order('nama')

      if (organisasiError) throw organisasiError

      const { data: anggotaData, error: anggotaError } = await supabase
        .from('organisasi_anggota')
        .select('*')
        .order('jabatan', { ascending: false })

      if (anggotaError) throw anggotaError

      const anggotaByOrganisasi = {}
      anggotaData?.forEach(anggota => {
        if (!anggotaByOrganisasi[anggota.organisasi_id]) {
          anggotaByOrganisasi[anggota.organisasi_id] = []
        }
        anggotaByOrganisasi[anggota.organisasi_id].push(anggota)
      })

      const organisasiWithAnggota = organisasiData?.map(org => ({
        ...org,
        anggota: anggotaByOrganisasi[org.id] || []
      })) || []

      setOrganisasi(organisasiWithAnggota)
    } catch (err) {
      console.error('Error loading organisasi:', err)
      pushToast('error', 'Gagal memuat data organisasi')
    }
  }

  const toggleEskul = async (item) => {
    if (!userId) return
    const joined = myEskul.has(item.id)

    if (!joined && myEskul.size >= 3) {
      pushToast('error', 'Maksimal 3 ekstrakurikuler yang bisa diikuti')
      return
    }

    try {
      if (joined) {
        const { error } = await supabase
          .from('ekskul_anggota')
          .delete()
          .eq('ekskul_id', item.id)
          .eq('user_id', userId)

        if (error) throw error
        pushToast('success', 'Berhasil membatalkan ekskul')
      } else {
        const { error } = await supabase
          .from('ekskul_anggota')
          .insert({
            ekskul_id: item.id,
            user_id: userId,
            created_at: new Date().toISOString(),
          })

        if (error) throw error
        pushToast('success', 'Berhasil bergabung ekskul!')
      }

      loadEskul()
    } catch (err) {
      console.error('Error toggle ekskul:', err)
      pushToast('error', 'Gagal mengubah keikutsertaan ekskul')
    }
  }

  const handleOrganisasiClick = (org) => {
    setSelectedOrganisasi(org)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedOrganisasi(null)
  }

  /* ============================
   *          RENDER
   * ============================ */

  if (isLoading) {
    return <SkeletonLoader />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* --- HEADER WELCOME --- */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">
                  Selamat Datang, {profile?.nama || 'Siswa'}! 👋
                </h1>
                <p className="text-gray-600 text-base">Pantau aktivitas dan perkembangan akademik Anda</p>
              </div>
            </div>
            {profile?.kelas && (
              <div className="mt-4 md:mt-0">
                <span className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl text-sm font-semibold shadow-sm">
                  🏫 Kelas {profile.kelas}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* MAIN CONTENT - 3/4 width */}
          <div className="xl:col-span-3 space-y-6">
            
            {/* --- PENGUMUMAN --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
              <div className="flex items-center gap-3 p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                <div className="flex items-center justify-between flex-1">
                  <h2 className="text-xl font-bold text-gray-900">📢 Pengumuman Terbaru</h2>
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    {pengumuman.length} Items
                  </span>
                </div>
              </div>
              
              <div className="max-h-80 overflow-y-auto">
                <div className="p-6 space-y-4">
                  {pengumuman.map((p, index) => (
                    <div
                      key={p.id}
                      className={`p-4 rounded-xl border-2 transition-all duration-300 hover:shadow-md cursor-pointer ${
                        index === 0 
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300 shadow-sm' 
                          : 'border-gray-200 hover:border-blue-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="font-bold text-gray-900 text-lg leading-tight">{p.judul}</h3>
                            {index === 0 && (
                              <span className="px-2 py-1 text-xs font-semibold bg-blue-500 text-white rounded-full">
                                🆕 Terbaru
                              </span>
                            )}
                          </div>
                          <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 mb-3">
                            {p.keterangan}
                          </p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full">
                              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                              <span className="capitalize font-medium">{p.target || 'semua'}</span>
                            </span>
                            <span className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full">
                              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              <span className="font-medium">
                                {p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric'
                                }) : ''}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!pengumuman.length && (
                    <div className="text-center py-8 bg-gray-50 rounded-xl">
                      <div className="text-gray-300 text-5xl mb-3">📢</div>
                      <p className="text-gray-500 text-base font-medium">Tidak ada pengumuman baru</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tugas and Organisasi Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* --- TUGAS --- */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-purple-600 rounded-full"></div>
                    <h2 className="text-xl font-bold text-gray-900">📚 Tugas Mendatang</h2>
                  </div>
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
                    {tugas.length} Tugas
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <div className="p-6">
                    <div className="space-y-4">
                      {tugas.map((t) => (
                        <div
                          key={t.id}
                          className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-purple-300 hover:shadow-sm cursor-pointer bg-white group"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <h3 className="font-bold text-gray-900 text-base leading-tight flex-1 pr-3 group-hover:text-purple-700 transition-colors">
                              {t.judul}
                            </h3>
                            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold whitespace-nowrap">
                              {t.mapel}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-xs text-gray-600 mb-3">
                            <span className="flex items-center gap-2 bg-purple-50 px-3 py-1 rounded-lg border border-purple-200">
                              <span className="text-sm">⏰</span>
                              <span className="font-semibold">
                                {t.deadline ? new Date(t.deadline).toLocaleString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                }) : 'Tidak ada deadline'}
                              </span>
                            </span>
                          </div>

                          <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 mb-3">
                            {t.keterangan || 'Tidak ada keterangan tambahan'}
                          </p>

                          <div className="flex flex-wrap gap-2">
                            {renderLink(t.file_url, '📎 File')}
                            {renderLink(t.link, '🔗 Link')}
                          </div>
                        </div>
                      ))}
                      
                      {!tugas.length && (
                        <div className="text-center py-6 bg-gray-50 rounded-xl">
                          <div className="text-gray-300 text-4xl mb-2">📚</div>
                          <p className="text-gray-500 text-base font-medium">Tidak ada tugas baru</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* --- ORGANISASI --- */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">🏛️ Organisasi</h2>
                    </div>
                  </div>
                  <div className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    {organisasi.length} Organisasi
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <div className="p-6">
                    <div className="grid grid-cols-1 gap-4">
                      {organisasi.map((org) => (
                        <div
                          key={org.id}
                          className="border-2 border-gray-200 rounded-xl p-4 transition-all duration-300 hover:border-indigo-300 hover:shadow-md cursor-pointer bg-white group"
                          onClick={() => handleOrganisasiClick(org)}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h3 className="font-bold text-gray-900 text-base leading-tight mb-2 group-hover:text-indigo-700 transition-colors">
                                {org.nama}
                              </h3>
                              
                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mb-3">
                                <span className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                                  <span className="text-indigo-600 text-sm">👨‍🏫</span>
                                  <span className="font-medium truncate">{org.pembina_guru_nama || 'Belum ada pembina'}</span>
                                </span>
                                <span className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                                  <span className="text-indigo-600 text-sm">👥</span>
                                  <span className="font-medium">{org.anggota?.length || 0}</span>
                                </span>
                              </div>

                              {/* Preview Jabatan */}
                              <div className="flex flex-wrap gap-2">
                                {org.anggota
                                  ?.filter(anggota => 
                                    ['Ketua', 'Wakil Ketua', 'Sekretaris', 'Bendahara'].includes(anggota.jabatan)
                                  )
                                  .slice(0, 2)
                                  .map((anggota, idx) => (
                                    <span
                                      key={idx}
                                      className={`px-2 py-1 rounded-lg text-xs font-semibold border ${
                                        anggota.jabatan === 'Ketua' 
                                          ? 'bg-amber-100 text-amber-800 border-amber-300' 
                                          : anggota.jabatan === 'Wakil Ketua'
                                          ? 'bg-blue-100 text-blue-800 border-blue-300'
                                          : 'bg-green-100 text-green-800 border-green-300'
                                      }`}
                                    >
                                      {anggota.jabatan}
                                    </span>
                                  ))}
                                {org.anggota?.length > 2 && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold border border-gray-300">
                                    +{org.anggota.length - 2} lainnya
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-all duration-300 text-lg transform group-hover:translate-x-1">
                              →
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {!organisasi.length && (
                        <div className="text-center py-6 bg-gray-50 rounded-xl">
                          <div className="text-gray-300 text-4xl mb-2">🏛️</div>
                          <p className="text-gray-500 text-base font-medium">Belum ada organisasi</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* --- EKSKUL --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-orange-600 rounded-full"></div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">⚽ Ekstrakurikuler</h2>
                    <p className="text-gray-600 text-sm mt-1">
                      Maksimal <span className="font-semibold text-orange-600">3 ekskul</span> yang bisa diikuti
                    </p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                  {myEskul.size}/3 Terdaftar
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                <div className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {ekskul.map((x) => {
                      const isJoined = myEskul.has(x.id)
                      return (
                        <div
                          key={x.id}
                          className={`border-2 rounded-xl p-4 transition-all duration-300 group ${
                            isJoined
                              ? 'border-orange-400 bg-gradient-to-br from-orange-50 to-amber-50 shadow-sm'
                              : 'border-gray-200 hover:border-orange-300 bg-white hover:shadow-md'
                          }`}
                        >
                          <div className="mb-4">
                            <div className="flex items-start justify-between mb-3">
                              <h3 className="font-bold text-gray-900 text-base leading-tight flex-1 pr-3 group-hover:text-orange-700 transition-colors">
                                {x.nama}
                              </h3>
                              {isJoined && (
                                <span className="px-2 py-1 bg-orange-500 text-white rounded-lg text-xs font-semibold shadow-sm">
                                  ✅ Terdaftar
                                </span>
                              )}
                            </div>

                            <div className="space-y-2 text-sm text-gray-600 mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-base">👨‍🏫</span>
                                <span className="font-medium truncate">{x.pembina_nama || 'Belum ada pembina'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 text-base">📅</span>
                                <span className="font-medium text-xs">
                                  {x.hari || 'TBA'} 
                                  {x.jam_mulai && ` • ${x.jam_mulai} - ${x.jam_selesai}`}
                                </span>
                              </div>
                            </div>

                            {x.keterangan && (
                              <p className="text-gray-700 text-sm leading-relaxed line-clamp-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                {x.keterangan}
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => toggleEskul(x)}
                            className={`w-full py-2.5 px-4 rounded-xl font-semibold transition-all duration-300 text-sm shadow-sm hover:shadow-md ${
                              isJoined
                                ? 'bg-white text-orange-600 border-2 border-orange-300 hover:bg-orange-500 hover:text-white hover:border-orange-500'
                                : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600'
                            }`}
                          >
                            {isJoined ? 'Batalkan' : 'Daftar Sekarang'}
                          </button>
                        </div>
                      )
                    })}
                    
                    {!ekskul.length && (
                      <div className="col-span-full text-center py-8 bg-gray-50 rounded-xl">
                        <div className="text-gray-300 text-5xl mb-3">⚽</div>
                        <p className="text-gray-500 text-base font-medium">Belum ada ekskul tersedia</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SIDEBAR - 1/4 width */}
          <div className="space-y-6">
            
            {/* --- ABSENSI --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-emerald-600 rounded-full"></div>
                  <h2 className="text-xl font-bold text-gray-900">📊 Absensi</h2>
                </div>
                <Badge variant="live">Live</Badge>
              </div>
              
              {/* Status Saya */}
              <div className="mb-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl border-2 border-blue-300 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <span className="text-blue-600">👤</span>
                  Status Anda Hari Ini
                </h3>
                <div className={`text-2xl font-bold mb-1 transition-all duration-300 ${
                  statusUser === 'Hadir' ? 'text-emerald-600' :
                  statusUser === 'Izin' || statusUser === 'Sakit' ? 'text-amber-600' :
                  statusUser === 'Alpha' ? 'text-rose-600' : 'text-blue-600'
                }`}>
                  {statusUser}
                </div>
                <p className="text-xs text-blue-600 font-medium">
                  Status kehadiran hari ini di kelas {profile?.kelas}
                </p>
              </div>

              {/* Ringkasan Kelas */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="text-emerald-600">📈</span>
                  Ringkasan Kelas
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { 
                      label: 'Hadir', 
                      value: ringkas.H, 
                      icon: '✅',
                      bgColor: 'bg-emerald-50',
                      borderColor: 'border-emerald-300',
                      textColor: 'text-emerald-700'
                    },
                    { 
                      label: 'Izin', 
                      value: ringkas.I, 
                      icon: '⚠️',
                      bgColor: 'bg-amber-50',
                      borderColor: 'border-amber-300',
                      textColor: 'text-amber-700'
                    },
                    { 
                      label: 'Alpha', 
                      value: ringkas.A, 
                      icon: '❌',
                      bgColor: 'bg-rose-50',
                      borderColor: 'border-rose-300',
                      textColor: 'text-rose-700'
                    }
                  ].map((item, index) => (
                    <div
                      key={index}
                      className={`${item.bgColor} ${item.borderColor} rounded-xl p-3 text-center border-2 transition-all duration-300 hover:shadow-sm`}
                    >
                      <div className="text-xl mb-2">{item.icon}</div>
                      <div className="text-xs font-semibold text-gray-600 mb-1">{item.label}</div>
                      <div className={`text-xl font-bold ${item.textColor}`}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-purple-600">📋</span>
                Ringkasan Cepat
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Total Pengumuman</span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">
                    {pengumuman.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Tugas Aktif</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">
                    {tugas.length}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm font-medium text-gray-700">Ekskul Diikuti</span>
                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold">
                    {myEskul.size}/3
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Organisasi */}
      <OrganisasiModal 
        organisasi={selectedOrganisasi}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </div>
  )
}