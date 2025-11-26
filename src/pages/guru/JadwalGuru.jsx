import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

// --- HELPER FUNCTIONS ---

const getKelasDisplayName = (kelasObj) => {
  if (!kelasObj) return ''
  return kelasObj.nama || kelasObj.id || ''
}

const getNamaKelasFromList = (kelasId, kelasList) => {
  const kelas = kelasList.find((k) => k.id === kelasId)
  return getKelasDisplayName(kelas) || kelasId || '—'
}

const HARI_JS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

const formatDateIndo = (dateStr) => {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export default function JadwalGuru() {
  const { profile, user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  // --- STATE MANAGEMENT ---
  const [jadwal, setJadwal] = useState([])
  const [jamKosongHariIni, setJamKosongHariIni] = useState([])
  const [eskulDiampu, setEskulDiampu] = useState([])
  const [organisasiDiampu, setOrganisasiDiampu] = useState([])
  const [strukturJabatan, setStrukturJabatan] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [waliKelasSaya, setWaliKelasSaya] = useState([])
  
  // State baru untuk Pengumuman
  const [pengumumanList, setPengumumanList] = useState([])

  const [activeHari, setActiveHari] = useState('Hari Ini')
  const [currentTime, setCurrentTime] = useState(new Date())

  // --- TIME SYNCHRONIZATION LOGIC ---
  const { todayStr, todayName } = React.useMemo(() => {
    const now = new Date()
    const todayName = HARI_JS[now.getDay()]
    const todayStr = now.toLocaleDateString('en-CA') 
    return { todayStr, todayName }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])


  // --- DATA FETCHING ---

  // 1. Load Data Kelas
  useEffect(() => {
    const loadAllKelas = async () => {
      try {
        const { data, error } = await supabase
          .from('kelas')
          .select('*')
          .order('grade')
          .order('suffix')
        if (error) throw error
        setKelasList(data || [])
      } catch (error) {
        console.error('Error loading kelas:', error)
      }
    }
    loadAllKelas()
  }, [])

  // 2. Load Pengumuman
  useEffect(() => {
    const loadPengumuman = async () => {
      try {
        const { data, error } = await supabase
          .from('pengumuman')
          .select('*')
          .in('target', ['guru', 'semua']) 
          .order('created_at', { ascending: false })
          .limit(3) 

        if (error) throw error
        setPengumumanList(data || [])
      } catch (error) {
        console.error('Error loading pengumuman:', error)
      }
    }
    loadPengumuman()
  }, [])

  // 3. Load User Data
  useEffect(() => {
    if (!user?.id) return

    const fetchData = async () => {
      try {
        // A. Wali Kelas
        const { data: waliData } = await supabase
          .from('kelas_struktur')
          .select(`kelas_id, wali_guru_id, kelas:kelas_id(id, nama, grade, suffix)`)
          .eq('wali_guru_id', user.id)
        setWaliKelasSaya(waliData || [])

        // B. Jadwal Mengajar
        const { data: jadwalData } = await supabase
          .from('jadwal')
          .select('*')
          .eq('guru_id', user.id)
          .order('jam_mulai', { ascending: true })
        setJadwal(jadwalData || [])

        // C. Ekskul
        const { data: ekskulData } = await supabase
          .from('ekskul')
          .select('*')
          .eq('pembina_guru_id', user.id)
        
        if (ekskulData) {
          const ekskulWithCount = await Promise.all(ekskulData.map(async (e) => {
            const { count } = await supabase
              .from('ekskul_anggota')
              .select('*', { count: 'exact', head: true })
              .eq('ekskul_id', e.id)
            return { ...e, jumlah_anggota: count || 0 }
          }))
          setEskulDiampu(ekskulWithCount)
        }

        // D. Struktur Jabatan
        const { data: jabatanData } = await supabase
          .from('struktur_sekolah')
          .select('*')
          .eq('guru_id', user.id)
        setStrukturJabatan(jabatanData || [])

        // E. Organisasi
        const { data: orgData } = await supabase
          .from('organisasi')
          .select('*')
          .eq('pembina_guru_id', user.id)
        
        if (orgData) {
          const orgWithCount = await Promise.all(orgData.map(async (org) => {
            const { count } = await supabase
              .from('organisasi_anggota')
              .select('*', { count: 'exact', head: true })
              .eq('organisasi_id', org.id)
            return { ...org, jumlah_anggota: count || 0 }
          }))
          setOrganisasiDiampu(orgWithCount)
        }

      } catch (error) {
        console.error('Error fetching user related data:', error)
      }
    }
    fetchData()
  }, [user?.id])

  // 4. Load Jam Kosong
  const loadSemuaJamKosongHariIni = React.useCallback(async () => {
    if (!todayStr) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('jam_kosong')
        .select(`*, profiles!jam_kosong_created_by_fkey ( nama )`)
        .eq('tanggal', todayStr)
        .order('jam_mulai', { ascending: true })

      if (error) throw error

      const formattedData = data?.map((item) => ({
        id: item.id,
        kelas: item.kelas || '-',
        mapel: item.mapel || '-',
        jam_mulai: item.jam_mulai,
        jam_selesai: item.jam_selesai,
        alasan: item.alasan,
        guru_pengganti: item.guru_pengganti,
        guru_pengaju: item.profiles?.nama || 'Guru',
        created_by: item.created_by
      })) || []

      setJamKosongHariIni(formattedData)
    } catch (error) {
      console.error('Error loading jam kosong:', error)
      pushToast('error', 'Gagal memuat data jam kosong')
    } finally {
      setLoading(false)
    }
  }, [todayStr, setLoading, pushToast])

  useEffect(() => {
    loadSemuaJamKosongHariIni()
  }, [loadSemuaJamKosongHariIni])


  // --- LOGIC HANDLERS ---

  const filteredJadwal = React.useMemo(() => {
    if (activeHari === 'Hari Ini') {
      return jadwal.filter((j) => j.hari === todayName)
    }
    return jadwal.filter((j) => j.hari === activeHari)
  }, [jadwal, activeHari, todayName])

  const hariList = React.useMemo(() => {
    const hariSet = new Set(jadwal.map((j) => j.hari).filter(Boolean))
    const sorter = { "Senin":1, "Selasa":2, "Rabu":3, "Kamis":4, "Jumat":5, "Sabtu":6, "Minggu":7 }
    const sortedHari = Array.from(hariSet).sort((a,b) => (sorter[a] || 99) - (sorter[b] || 99))
    return ['Hari Ini', ...sortedHari]
  }, [jadwal])

  const handleToggleJamKosong = async (jamKosongId, currentPengganti) => {
    try {
      setLoading(true)
      const namaUser = profile?.nama || user?.email || 'Guru Pengganti'
      
      const isCanceling = currentPengganti === namaUser
      const newValue = isCanceling ? null : namaUser

      const { error } = await supabase
        .from('jam_kosong')
        .update({
          guru_pengganti: newValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', jamKosongId)

      if (error) throw error

      setJamKosongHariIni((prev) =>
        prev.map((jam) =>
          jam.id === jamKosongId
            ? { ...jam, guru_pengganti: newValue }
            : jam
        )
      )
      
      if (isCanceling) {
        pushToast('info', 'Anda membatalkan pengambilan jam ini.')
      } else {
        pushToast('success', 'Berhasil mengambil jam kosong!')
      }

    } catch (error) {
      console.error('Error updating jam kosong:', error)
      pushToast('error', 'Gagal memperbarui status jam kosong')
    } finally {
      setLoading(false)
    }
  }

  const formatWaktu = (waktu) => (waktu ? String(waktu).slice(0, 5) : '-')

  // --- RENDER COMPONENT ---

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 pb-20">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl -mr-16 -mt-16 opacity-50 pointer-events-none"></div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-5">
              <div className="p-3.5 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-500/20 text-white shrink-0">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Dashboard Mengajar</h1>
                <p className="text-gray-500 font-medium">
                  Selamat Datang, <span className="text-blue-600">{profile?.nama || 'Guru'}</span>
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {profile?.jabatan && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                      🏅 {profile.jabatan}
                    </span>
                  )}
                  {strukturJabatan.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      🏛️ {s.jabatan}
                    </span>
                  ))}
                  {waliKelasSaya.map(w => (
                    <span key={w.kelas_id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-100">
                      👨‍🏫 Wali Kelas {getKelasDisplayName(w.kelas)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg flex flex-col items-center justify-center min-w-[140px]">
                <div className="text-2xl font-mono font-bold leading-none">
                  {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[10px] text-gray-400 font-medium tracking-wider mt-1 uppercase">
                  {todayName}, {formatDateIndo(todayStr)}
                </div>
              </div>

              <button
                onClick={() => {
                  loadSemuaJamKosongHariIni()
                  pushToast('info', 'Data diperbarui')
                }}
                className="group flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-5 py-3 rounded-xl font-semibold transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                <svg className="w-5 h-5 text-gray-500 group-hover:text-blue-600 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh Data</span>
              </button>
            </div>
          </div>
        </div>

        {/* GRID UTAMA */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          
          {/* KOLOM KIRI (Jadwal, Ekskul, Organisasi) */}
          <div className="xl:col-span-4 space-y-6">
            
            {/* Jadwal Mengajar */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[600px]">
              <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <span>📚</span> Jadwal Mengajar
                </h3>
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-md">
                  {filteredJadwal.length} Mapel
                </span>
              </div>
              
              <div className="p-4 flex-1 overflow-hidden flex flex-col">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-2">
                  {hariList.map(hari => (
                    <button
                      key={hari}
                      onClick={() => setActiveHari(hari)}
                      className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                        activeHari === hari 
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20' 
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {hari}
                    </button>
                  ))}
                </div>

                <div className="overflow-y-auto space-y-3 pr-1 pb-2 flex-1 scrollbar-thin scrollbar-thumb-gray-200">
                  {filteredJadwal.length > 0 ? (
                    filteredJadwal.map((j) => (
                      <div key={j.id} className={`group p-4 rounded-xl border transition-all ${
                        j.hari === todayName 
                        ? 'bg-blue-50/50 border-blue-100 hover:border-blue-300' 
                        : 'bg-white border-gray-100 hover:border-gray-300'
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-gray-800 line-clamp-1">{j.mapel}</h4>
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200 font-medium">
                            {formatWaktu(j.jam_mulai)} - {formatWaktu(j.jam_selesai)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-semibold text-gray-700">
                            Kls {getNamaKelasFromList(j.kelas_id, kelasList)}
                          </span>
                          <span>•</span>
                          <span>{j.hari}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-400">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">☕</div>
                      <p className="text-sm">Tidak ada jadwal pada hari ini.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Ekskul & Organisasi */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>🏆</span> Tanggung Jawab Lain
              </h3>
              
              <div className="space-y-4">
                {/* Ekskul Item Updated */}
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ekstrakurikuler ({eskulDiampu.length})</h4>
                  {eskulDiampu.length > 0 ? (
                    <div className="space-y-2">
                      {eskulDiampu.map(e => (
                        <div key={e.id} className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                          <div className="flex items-center justify-between mb-2">
                             <span className="text-sm font-semibold text-purple-900">{e.nama}</span>
                             <span className="text-xs text-purple-700 bg-white px-2 py-0.5 rounded border border-purple-100 font-medium">{e.hari || '-'}</span>
                          </div>
                          
                          {/* Info Tambahan Waktu & Anggota */}
                          <div className="flex items-center gap-3 text-xs text-purple-600">
                             <div className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>{formatWaktu(e.jam_mulai)} - {formatWaktu(e.jam_selesai)}</span>
                             </div>
                             <div className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2a4.978 4.978 0 00-.869-2.773M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2a4.978 4.978 0 01.869-2.773M12 11a3 3 0 100-6 3 3 0 000 6zm5 0a3 3 0 10-6 0 3 3 0 006 0z" />
                                </svg>
                                <span>{e.jumlah_anggota} Anggota</span>
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-gray-400 italic">Tidak ada ekskul</p>}
                </div>

                <hr className="border-gray-100"/>

                {/* Organisasi Item */}
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Organisasi ({organisasiDiampu.length})</h4>
                  {organisasiDiampu.length > 0 ? (
                    <div className="space-y-2">
                      {organisasiDiampu.map(o => (
                        <div key={o.id} className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                          <span className="text-sm font-semibold text-emerald-900">{o.nama}</span>
                          <span className="text-xs text-emerald-700 font-medium">{o.jumlah_anggota} Anggota</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-gray-400 italic">Tidak ada organisasi</p>}
                </div>
              </div>
            </div>
          </div>

          {/* KOLOM KANAN (Pengumuman & Monitoring) */}
          <div className="xl:col-span-8 space-y-6">

            {/* --- CARD PENGUMUMAN (UPDATED: LIGHT MODE) --- */}
            {pengumumanList.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>📢</span> Pengumuman Terbaru
                  </h2>
                </div>
                
                <div className="p-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {pengumumanList.map((p) => (
                      <div key={p.id} className="group flex flex-col justify-between bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all duration-200">
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                              p.target === 'guru' 
                              ? 'bg-purple-50 text-purple-700 border-purple-100' 
                              : 'bg-blue-50 text-blue-700 border-blue-100'
                            }`}>
                              {p.target === 'semua' ? 'Semua' : 'Guru'}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(p.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-blue-600 transition-colors">
                            {p.judul}
                          </h3>
                          <p className="text-sm text-gray-600 line-clamp-3 leading-relaxed">
                            {p.keterangan}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* --- MONITORING JAM KOSONG --- */}
            <div className="bg-white rounded-2xl shadow-md border border-gray-200 flex flex-col h-full min-h-[500px]">
              
              <div className="p-6 border-b border-gray-100">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                      Monitoring Jam Kosong
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Data real-time pengajuan jam kosong hari ini ({todayName}).
                    </p>
                  </div>
                  
                  <div className="flex gap-3">
                      <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-xl text-center">
                        <div className="text-xs text-red-600 font-bold uppercase">Perlu Guru</div>
                        <div className="text-lg font-bold text-red-700 leading-none">
                           {jamKosongHariIni.filter(j => !j.guru_pengganti).length}
                        </div>
                      </div>
                      <div className="bg-green-50 border border-green-100 px-4 py-2 rounded-xl text-center">
                        <div className="text-xs text-green-600 font-bold uppercase">Teratasi</div>
                        <div className="text-lg font-bold text-green-700 leading-none">
                           {jamKosongHariIni.filter(j => j.guru_pengganti).length}
                        </div>
                      </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50/30 flex-1">
                {jamKosongHariIni.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {jamKosongHariIni.map((item) => {
                      const isHandled = !!item.guru_pengganti;
                      const isMe = item.guru_pengganti === (profile?.nama || user?.email);

                      return (
                        <div 
                          key={item.id} 
                          className={`relative p-5 rounded-xl border-2 transition-all duration-200 flex flex-col justify-between group ${
                            isHandled 
                            ? 'bg-white border-green-200' 
                            : 'bg-white border-red-200 shadow-lg shadow-red-100 hover:-translate-y-1'
                          }`}
                        >
                          <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl rounded-tr-lg text-[10px] font-bold tracking-wide uppercase ${
                            isHandled ? 'bg-green-100 text-green-700' : 'bg-red-500 text-white'
                          }`}>
                            {isHandled ? 'Sudah Ada Guru' : 'Butuh Pengganti'}
                          </div>

                          <div className="mb-4">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded">
                                {formatWaktu(item.jam_mulai)} - {formatWaktu(item.jam_selesai)}
                              </span>
                              <span className="text-gray-400 text-xs">•</span>
                              <span className="font-bold text-blue-600 text-sm">
                                Kelas {getNamaKelasFromList(item.kelas, kelasList)}
                              </span>
                            </div>
                            <h3 className="text-lg font-bold text-gray-800 leading-tight mb-2">
                              {item.mapel}
                            </h3>
                            
                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm space-y-1">
                               <div className="flex justify-between">
                                  <span className="text-gray-500">Pengajar:</span>
                                  <span className="font-medium text-gray-800">{item.guru_pengaju}</span>
                               </div>
                               <div className="flex justify-between items-start">
                                  <span className="text-gray-500 shrink-0">Alasan:</span>
                                  <span className="font-medium text-gray-800 text-right line-clamp-2">{item.alasan}</span>
                               </div>
                            </div>
                          </div>

                          <div className="mt-2 pt-3 border-t border-gray-100">
                            {/* LOGIKA TOMBOL AMBIL / BATAL */}
                            {isHandled ? (
                              isMe ? (
                                // JIKA SAYA YANG MENGAMBIL, TAMPILKAN TOMBOL BATALKAN
                                <button
                                  onClick={() => handleToggleJamKosong(item.id, item.guru_pengganti)}
                                  className="w-full py-2.5 px-4 bg-orange-100 hover:bg-orange-200 text-orange-700 border border-orange-300 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                >
                                   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                   </svg>
                                   Batalkan (Saya Penggantinya)
                                </button>
                              ) : (
                                // JIKA ORANG LAIN, TAMPILKAN INFO SAJA
                                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-2 rounded-lg justify-center">
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span className="text-sm font-semibold">
                                    Digantikan oleh: {item.guru_pengganti}
                                  </span>
                                </div>
                              )
                            ) : (
                              // JIKA BELUM DIAMBIL, TAMPILKAN TOMBOL AMBIL
                              <button
                                onClick={() => handleToggleJamKosong(item.id, null)}
                                className="w-full py-2.5 px-4 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors shadow-md shadow-red-200 flex items-center justify-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                </svg>
                                Ambil Jam Ini
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-10 bg-white rounded-xl border border-dashed border-gray-300">
                    <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-5 animate-pulse">
                      <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Semua Aman!</h3>
                    <p className="text-gray-500 mt-2 max-w-sm">
                      Belum ada laporan jam kosong untuk hari {todayName} ini. Semua kelas berjalan kondusif.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}