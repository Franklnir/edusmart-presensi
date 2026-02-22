// src/pages/guru/AbsensiGuru.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import ProfileAvatar from '../../components/ProfileAvatar'

/* ===== Error Boundary Component ===== */
const ErrorBoundary = ({ children }) => {
  const [hasError, setHasError] = useState(false)
  const [errorInfo, setErrorInfo] = useState(null)

  useEffect(() => {
    const handleError = (error, errorInfo) => {
      console.error('Error caught by boundary:', error, errorInfo)
      setHasError(true)
      setErrorInfo(errorInfo)
    }

    const handleUnhandledRejection = (event) => {
      console.error('Unhandled rejection:', event.reason)
      setHasError(true)
      setErrorInfo(event.reason)
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  if (hasError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200/80 p-8 max-w-md text-center">
          <div className="text-6xl mb-4">😵</div>
          <h2 className="text-xl font-bold text-red-600 mb-2">Terjadi Kesalahan</h2>
          <p className="text-gray-600 mb-4">
            Sistem mengalami gangguan. Silakan refresh halaman atau coba beberapa saat lagi.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-colors"
            >
              🔄 Refresh Halaman
            </button>
            <button
              onClick={() => setHasError(false)}
              className="w-full px-6 py-3 bg-slate-600 text-white rounded-2xl font-bold hover:bg-slate-700 transition-colors"
            >
              ⚡ Coba Lagi
            </button>
          </div>
          {errorInfo && (
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-sm text-slate-500">Detail Error</summary>
              <pre className="text-xs bg-slate-100 p-2 rounded-xl mt-2 overflow-auto">
                {JSON.stringify(errorInfo, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }

  return children
}

/* ===== Helpers ===== */
function initials(name = '?') {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('')
}

const formatKelasDisplay = (kelasSlug) => {
  if (!kelasSlug) return ''
  const parts = kelasSlug.split('-')
  if (parts.length >= 2) {
    const grade = parts[0].toUpperCase()
    const suffix = parts[1].toUpperCase()
    return `${grade} ${suffix}`
  }
  return parts
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const getToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toMinutes = (hhmm) => {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return (h * 60) + (m || 0)
}

const getDayName = (tglString) => {
  try {
    const date = new Date(tglString + 'T12:00:00Z')
    const dayIndex = date.getUTCDay()
    const HARI_MAP = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
    return HARI_MAP[dayIndex]
  } catch (error) {
    console.error('Error getting day name:', error)
    return 'Unknown'
  }
}

const getCurrentDateTime = () => {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    dayName: getDayName(now.toISOString().slice(0, 10)),
    minutes: now.getHours() * 60 + now.getMinutes()
  }
}

const formatDateDisplay = (dateString) => {
  try {
    const date = new Date(dateString + 'T12:00:00Z')
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  } catch (error) {
    return dateString
  }
}

/* ===== Komponen Jam Real-time ===== */
const RealTimeClock = () => {
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="text-sm font-medium text-slate-700 bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2">
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="font-mono font-bold text-blue-700">
        {currentTime.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })}
      </span>
      <span className="text-slate-300">|</span>
      <span>
        {currentTime.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })}
      </span>
    </div>
  )
}

/* ===== Komponen Card Jadwal Hari Ini ===== */
const JadwalHariIniCard = ({ jadwal, currentTimeMinutes, onClick }) => {
  const getStatusJadwal = (jamMulai, jamSelesai) => {
    const mulai = toMinutes(jamMulai)
    const selesai = toMinutes(jamSelesai)
    const toleransi = 5 // dari 15 menjadi 5 menit

    if (currentTimeMinutes > selesai + toleransi) {
      return 'lewat'
    } else if (currentTimeMinutes >= mulai && currentTimeMinutes <= selesai + toleransi) {
      return 'berlangsung'
    } else {
      return 'akan_datang'
    }
  }

  const status = getStatusJadwal(jadwal.jam_mulai, jadwal.jam_selesai)

  const statusConfig = {
    lewat: {
      color: 'bg-red-50 border-red-200',
      badge: 'bg-red-100 text-red-700 border-red-200',
      icon: '❌',
      text: 'Selesai'
    },
    berlangsung: {
      color: 'bg-green-50 border-green-200',
      badge: 'bg-green-100 text-green-700 border-green-200',
      icon: '🟢',
      text: 'Berlangsung'
    },
    akan_datang: {
      color: 'bg-yellow-50 border-yellow-200',
      badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      icon: '🟡',
      text: 'Akan Datang'
    }
  }

  const config = statusConfig[status]

  return (
    <div
      className={`p-3 rounded-2xl border cursor-pointer transition-all duration-200 hover:shadow-md ${config.color}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-slate-900 text-xs">{jadwal.mapel}</h3>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${config.badge}`}>
              {config.icon} {config.text}
            </span>
          </div>
          <div className="space-y-1 text-[10px] text-slate-600">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-700">Kelas:</span>
              <span className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded-xl text-[10px] font-medium">
                {formatKelasDisplay(jadwal.kelas_id)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-700">Jam:</span>
              <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-xl text-[10px] font-medium">
                {jadwal.jam_mulai} - {jadwal.jam_selesai}
              </span>
            </div>
          </div>
        </div>
        <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center ml-2 flex-shrink-0 shadow-sm">
          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
    </div>
  )
}

/* ===== Storage Keys ===== */
const STORAGE_KEYS = {
  VIEW: 'absensi_guru_view',
  KELAS: 'absensi_guru_kelas',
  SELECTED_SCHEDULE: 'absensi_guru_selected_schedule',
  TGL: 'absensi_guru_tgl',
  JAM_KOSONG: 'absensi_guru_jam_kosong',
  ABSEN_MODE: 'absensi_guru_mode'
}

/* ===== Card Jadwal ===== */
const JadwalCard = ({ jadwal, onSelect, isSelected = false }) => {
  return (
    <div
      className={`p-3 rounded-2xl border cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'bg-blue-50 border-blue-400 shadow-md'
          : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-md'
      }`}
      onClick={() => onSelect(jadwal)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-bold text-slate-900 mb-1 text-xs">{jadwal.mapel}</h3>
          <div className="space-y-1 text-[10px] text-slate-600">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-700">Kelas:</span>
              <span className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded-xl text-[10px] font-medium">
                {formatKelasDisplay(jadwal.kelas_id)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-700">Jam:</span>
              <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-xl text-[10px] font-medium">
                {jadwal.jam_mulai} - {jadwal.jam_selesai}
              </span>
            </div>
          </div>
        </div>
        {isSelected && (
          <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center ml-2 flex-shrink-0 shadow-sm">
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

/* ===== Main Component ===== */
function AbsensiGuru() {
  const { user } = useAuthStore()
  const { pushToast } = useUIStore()

  // View state
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.VIEW) || 'absen'
    } catch (error) {
      console.error('Error reading view from localStorage:', error)
      return 'absen'
    }
  })

  const [kelas, setKelas] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.KELAS) || ''
    } catch (error) {
      console.error('Error reading kelas from localStorage:', error)
      return ''
    }
  })

  const [selectedScheduleId, setSelectedScheduleId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SELECTED_SCHEDULE) || ''
    } catch (error) {
      console.error('Error reading selected schedule from localStorage:', error)
      return ''
    }
  })

  const [tgl, setTgl] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.TGL) || getToday()
    } catch (error) {
      console.error('Error reading tgl from localStorage:', error)
      return getToday()
    }
  })

  const [absenMode, setAbsenMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ABSEN_MODE) || 'otomatis'
    } catch (error) {
      console.error('Error reading absen mode from localStorage:', error)
      return 'otomatis'
    }
  })

  // Data states
  const [jadwalAll, setJadwalAll] = useState([])
  const [siswa, setSiswa] = useState([])
  const [absensi, setAbsensi] = useState([])
  const [ajuan, setAjuan] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentSchedule, setCurrentSchedule] = useState(null)
  const [todayName, setTodayName] = useState('')
  const [loadingActions, setLoadingActions] = useState({})

  // Modals
  const [isIzinModalOpen, setIsIzinModalOpen] = useState(false)
  const [izinUid, setIzinUid] = useState(null)
  const [izinReason, setIzinReason] = useState('')

  const [guruList, setGuruList] = useState([])
  const [riwayatJamKosong, setRiwayatJamKosong] = useState([])
  const [isLoadingJamKosong, setIsLoadingJamKosong] = useState(false)
  const [isEditJamKosongModalOpen, setIsEditJamKosongModalOpen] = useState(false)
  const [editingJamKosong, setEditingJamKosong] = useState(null)
  const [isDetailIzinModalOpen, setIsDetailIzinModalOpen] = useState(false)
  const [selectedAjuan, setSelectedAjuan] = useState(null)

  // Auto Alpha State
  const [isRunningAutoAlpha, setIsRunningAutoAlpha] = useState(false)
  const [lastAutoAlphaRun, setLastAutoAlphaRun] = useState(() => {
    try {
      const saved = localStorage.getItem('last_auto_alpha_run')
      return saved ? JSON.parse(saved) : {}
    } catch (error) {
      console.error('Error reading last auto alpha run:', error)
      return {}
    }
  })

  const [jamKosong, setJamKosong] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.JAM_KOSONG)
      return saved ? JSON.parse(saved) : { jadwal_id: '', alasan: '', guru_pengganti: '' }
    } catch (error) {
      console.error('Error reading jam kosong from localStorage:', error)
      return { jadwal_id: '', alasan: '', guru_pengganti: '' }
    }
  })

  const [loadingJamKosong, setLoadingJamKosong] = useState(false)

  // RFID Settings
  const [rfidSettings, setRfidSettings] = useState({
    rfid_aktif: false,
    rfid_mulai: '07:00',
    rfid_selesai: '15:00'
  })

  // Real-time
  const [currentDateTime, setCurrentDateTime] = useState(getCurrentDateTime())
  const [isOnline, setIsOnline] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())

  // Refs
  const siswaRef = useRef([])
  const absensiRef = useRef([])
  const jadwalRef = useRef([])
  const currentScheduleRef = useRef(null)

  useEffect(() => { siswaRef.current = siswa }, [siswa])
  useEffect(() => { absensiRef.current = absensi }, [absensi])
  useEffect(() => { jadwalRef.current = jadwalAll }, [jadwalAll])
  useEffect(() => { currentScheduleRef.current = currentSchedule }, [currentSchedule])

  /* ===== Helper mutasi state ABSENSI & AJUAN (supaya live & ringan) ===== */
  const upsertAbsensiState = (rows) => {
    if (!rows) return
    const arr = Array.isArray(rows) ? rows : [rows]
    setAbsensi(prev => {
      const map = new Map(prev.map(r => [r.id, r]))
      for (const r of arr) {
        if (r?.id) map.set(r.id, r)
      }
      return Array.from(map.values())
    })
    setLastUpdate(new Date())
  }

  const removeAbsensiState = (id) => {
    setAbsensi(prev => prev.filter(a => a.id !== id))
    setLastUpdate(new Date())
  }

  const applyRealtimeChange = (prev, payload) => {
    const { eventType, new: newRow, old: oldRow } = payload
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!newRow?.id) return prev
      const idx = prev.findIndex(r => r.id === newRow.id)
      if (idx === -1) return [...prev, newRow]
      const copy = [...prev]
      copy[idx] = newRow
      return copy
    }
    if (eventType === 'DELETE') {
      if (!oldRow?.id) return prev
      return prev.filter(r => r.id !== oldRow.id)
    }
    return prev
  }

  /* ===== Persist State to localStorage ===== */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.VIEW, view)
    } catch (error) {
      console.error('Error saving view to localStorage:', error)
    }
  }, [view])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.KELAS, kelas)
    } catch (error) {
      console.error('Error saving kelas to localStorage:', error)
    }
  }, [kelas])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_SCHEDULE, selectedScheduleId)
    } catch (error) {
      console.error('Error saving selected schedule to localStorage:', error)
    }
  }, [selectedScheduleId])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TGL, tgl)
    } catch (error) {
      console.error('Error saving tgl to localStorage:', error)
    }
  }, [tgl])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.JAM_KOSONG, JSON.stringify(jamKosong))
    } catch (error) {
      console.error('Error saving jam kosong to localStorage:', error)
    }
  }, [jamKosong])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ABSEN_MODE, absenMode)
    } catch (error) {
      console.error('Error saving absen mode to localStorage:', error)
    }
  }, [absenMode])

  useEffect(() => {
    try {
      localStorage.setItem('last_auto_alpha_run', JSON.stringify(lastAutoAlphaRun))
    } catch (error) {
      console.error('Error saving last auto alpha run to localStorage:', error)
    }
  }, [lastAutoAlphaRun])

  /* ===== Real-time Clock ===== */
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(getCurrentDateTime())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  /* ===== Online Status ===== */
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      pushToast('success', 'Koneksi internet pulih', 3000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      pushToast('warning', 'Mode offline - perubahan akan disinkronkan ketika online', 5000)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [pushToast])

  /* ===== Subscription Jadwal (re-load kalau ada perubahan) ===== */
  useEffect(() => {
    if (!user?.id) return

    const jadwalSubscription = supabase
      .channel('jadwal-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jadwal',
          filter: `guru_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Jadwal changed:', payload)
          loadJadwal()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(jadwalSubscription)
    }
  }, [user?.id])

  /* ===== Subscription Absensi & Ajuan (live, tanpa reload berat) ===== */
  useEffect(() => {
    if (!kelas || !currentScheduleRef.current?.mapel || !tgl) return

    // Realtime ABSENSI
    const absensiChannel = supabase
      .channel(`absensi-changes-${kelas}-${currentScheduleRef.current.mapel}-${tgl}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `kelas=eq.${kelas}`
        },
        (payload) => {
          if (view !== 'absen') return

          const row = payload.new || payload.old
          if (!row) return

          if (
            row.kelas !== kelas ||
            row.mapel !== currentScheduleRef.current?.mapel ||
            row.tanggal !== tgl
          ) {
            return
          }

          console.log('Absensi realtime (filtered):', payload)
          setAbsensi(prev => applyRealtimeChange(prev, payload))
          setLastUpdate(new Date())
        }
      )
      .subscribe()

    // Realtime AJUAN IZIN
    const ajuanChannel = supabase
      .channel(`ajuan-changes-${kelas}-${currentScheduleRef.current.mapel}-${tgl}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_ajuan',
          filter: `kelas=eq.${kelas}`
        },
        (payload) => {
          if (view !== 'absen') return

          const row = payload.new || payload.old
          if (!row) return

          if (
            row.kelas !== kelas ||
            row.mapel !== currentScheduleRef.current?.mapel ||
            row.tanggal !== tgl
          ) {
            return
          }

          console.log('Ajuan realtime (filtered):', payload)
          setAjuan(prev => applyRealtimeChange(prev, payload))
          setLastUpdate(new Date())

          if (
            payload.eventType === 'INSERT' &&
            (row.alasan || '').toLowerCase().includes('sakit')
          ) {
            pushToast('info', `Ajuan izin sakit dari ${row.nama}`)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(absensiChannel)
      supabase.removeChannel(ajuanChannel)
    }
  }, [kelas, tgl, view, pushToast])

  /* ===== Subscription Jam Kosong ===== */
  useEffect(() => {
    if (!user?.id) return

    const jamKosongSubscription = supabase
      .channel('jam-kosong-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jam_kosong',
          filter: `created_by=eq.${user.id}`
        },
        (payload) => {
          console.log('Jam kosong changed:', payload)
          if (view === 'jam_kosong') {
            loadRiwayatJamKosong()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(jamKosongSubscription)
    }
  }, [user?.id, view])

  /* ===== Load RFID Settings ===== */
  useEffect(() => {
    const loadRfidSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('absensi_rfid_settings')
          .select('*')
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (error) {
          console.error('Error loading RFID settings:', error)
          return
        }

        if (data) {
          setRfidSettings({
            rfid_aktif: data.rfid_aktif || false,
            rfid_mulai: data.rfid_mulai || '07:00',
            rfid_selesai: data.rfid_selesai || '15:00'
          })
        }
      } catch (err) {
        console.error('Exception loading RFID settings:', err)
        pushToast('error', 'Gagal memuat pengaturan RFID')
      }
    }
    loadRfidSettings()
  }, [pushToast])

  /* ===== Enhanced Auto Switch Mode ===== */
  useEffect(() => {
    const checkModeSwitch = () => {
      if (!currentSchedule || view !== 'absen') return

      const today = getToday()
      const now = currentDateTime.minutes
      const start = toMinutes(currentSchedule.jam_mulai)
      const end = toMinutes(currentSchedule.jam_selesai)
      const toleransi = 5

      if (tgl !== today) {
        if (absenMode !== 'manual') {
          setAbsenMode('manual')
        }
        return
      }

      const isWithinClassTime = now >= start && now <= end + toleransi
      const isOutsideClassTime = now > end + toleransi

      if (isWithinClassTime && absenMode !== 'otomatis') {
        setAbsenMode('otomatis')
      } else if (isOutsideClassTime && absenMode === 'otomatis') {
        setAbsenMode('manual')
      }
    }

    checkModeSwitch()
  }, [currentDateTime, currentSchedule, tgl, view, absenMode])

  /* ===== Load Data Jadwal & Guru ===== */
  useEffect(() => {
    loadJadwal()
    loadGuruList()
  }, [user?.id])

  const loadJadwal = async () => {
    if (!user?.id) return

    try {
      const { data, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('guru_id', user.id)

      if (error) {
        console.error('Error loading jadwal:', error)
        pushToast('error', 'Gagal memuat jadwal mengajar')
        return
      }

      setJadwalAll(data || [])
      setLastUpdate(new Date())
    } catch (error) {
      console.error('Exception loading jadwal:', error)
      pushToast('error', 'Terjadi kesalahan saat memuat jadwal')
    }
  }

  const loadGuruList = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nama')
        .eq('role', 'guru')
        .order('nama')

      if (error) {
        console.error('Error loading guru list:', error)
        return
      }

      setGuruList(data || [])
    } catch (error) {
      console.error('Exception loading guru list:', error)
    }
  }

  const loadRiwayatJamKosong = async () => {
    if (!user?.id) return

    setIsLoadingJamKosong(true)
    try {
      const { data, error } = await supabase
        .from('jam_kosong')
        .select('*')
        .eq('created_by', user.id)
        .order('tanggal', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        console.error('Error loading riwayat jam kosong:', error)
        pushToast('error', 'Gagal memuat riwayat jam kosong')
        return
      }

      setRiwayatJamKosong(data || [])
    } catch (error) {
      console.error('Exception loading riwayat jam kosong:', error)
      pushToast('error', 'Terjadi kesalahan saat memuat riwayat')
    } finally {
      setIsLoadingJamKosong(false)
    }
  }

  useEffect(() => {
    if (view === 'jam_kosong') loadRiwayatJamKosong()
  }, [view])

  /* ===== Computed Data ===== */
  const { myKelasList, schedulesForSelectedClass, jadwalByHari, jadwalHariIni } = useMemo(() => {
    if (!user?.id || !jadwalAll.length)
      return {
        myKelasList: [],
        schedulesForSelectedClass: [],
        jadwalByHari: {},
        jadwalHariIni: []
      }

    const kelasSet = new Set()
    const jadwalByHariTemp = {}
    const todayDayName = getDayName(getToday())
    const selectedDayName = getDayName(tgl)

    const jadwalHariIniTemp = jadwalAll.filter(j => j.hari === todayDayName)

    jadwalAll.forEach(j => {
      if (j.kelas_id) kelasSet.add(j.kelas_id)
      if (!jadwalByHariTemp[j.hari]) jadwalByHariTemp[j.hari] = []
      jadwalByHariTemp[j.hari].push(j)
    })

    const schedulesList = []
    if (kelas) {
      const now = currentDateTime.minutes
      jadwalAll
        .filter(j => j.kelas_id === kelas && j.hari === selectedDayName)
        .forEach(j => {
          const isCurrent =
            j.hari === todayDayName &&
            now >= toMinutes(j.jam_mulai) - 5 &&
            now <= toMinutes(j.jam_selesai) + 5
          schedulesList.push({
            id: j.id,
            label: `${j.mapel} - ${j.hari} (${j.jam_mulai}-${j.jam_selesai})`,
            schedule: j,
            isCurrent
          })
        })
      schedulesList.sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1))
    }

    return {
      myKelasList: Array.from(kelasSet).sort(),
      schedulesForSelectedClass: schedulesList,
      jadwalByHari: jadwalByHariTemp,
      jadwalHariIni: jadwalHariIniTemp
    }
  }, [jadwalAll, user?.id, kelas, currentDateTime, tgl])

  const jadwalForJamKosongHariIni = useMemo(() => {
    if (!kelas || !jadwalAll.length) return []
    const todayDayName = getDayName(getToday())

    return jadwalAll
      .filter(j => j.kelas_id === kelas && j.hari === todayDayName)
      .map(j => ({
        id: j.id,
        label: `${j.mapel} (${j.jam_mulai}-${j.jam_selesai})`,
        mapel: j.mapel,
        jam_mulai: j.jam_mulai,
        jam_selesai: j.jam_selesai
      }))
  }, [kelas, jadwalAll])

  const canRunAutoAlpha = useMemo(() => {
    if (!currentSchedule || tgl !== getToday()) return false

    const now = currentDateTime.minutes
    const endTime = toMinutes(currentSchedule.jam_selesai)
    return now > endTime + 5
  }, [currentSchedule, tgl, currentDateTime])

  /* ===== Auto Select Schedule ===== */
  useEffect(() => {
    if (jadwalAll.length > 0 && kelas && !selectedScheduleId && view === 'absen') {
      const current = schedulesForSelectedClass.find(s => s.isCurrent)
      if (current) setSelectedScheduleId(current.id)
    }
  }, [jadwalAll, kelas, selectedScheduleId, view, schedulesForSelectedClass])

  useEffect(() => {
    if (kelas && selectedScheduleId && tgl && view === 'absen') loadDataAbsensi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kelas, selectedScheduleId, tgl, view])

  const loadDataAbsensi = async () => {
    if (!kelas || !selectedScheduleId || !tgl) return

    setIsLoading(true)
    setSiswa([])
    setAbsensi([])
    setAjuan([])

    const selectedScheduleObj = schedulesForSelectedClass.find(s => s.id === selectedScheduleId)
    if (!selectedScheduleObj) {
      setIsLoading(false)
      return
    }

    const schedule = selectedScheduleObj.schedule
    setCurrentSchedule(schedule)
    setTodayName(getDayName(tgl))

    try {
      // Load settings
      try {
        const { data: settings, error: settingsError } = await supabase
          .from('absensi_settings')
          .select('mode')
          .eq('kelas', kelas)
          .eq('tanggal', tgl)
          .eq('mapel', schedule.mapel)
          .single()

        if (settingsError && settingsError.code !== 'PGRST116') {
          console.error('Error loading settings:', settingsError)
        } else if (settings) {
          setAbsenMode(settings.mode)
        }
      } catch (settingsErr) {
        console.warn('Error loading settings:', settingsErr)
      }

      // Load siswa
      const { data: students, error: studentsError } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'siswa')
        .eq('kelas', kelas)
        .order('nama')

      if (studentsError) {
        console.error('Error loading students:', studentsError)
        pushToast('error', 'Gagal memuat data siswa')
        setSiswa([])
      } else {
        setSiswa(students || [])
      }

      // Load absensi
      const { data: absen, error: absenError } = await supabase
        .from('absensi')
        .select('*')
        .eq('kelas', kelas)
        .eq('tanggal', tgl)
        .eq('mapel', schedule.mapel)

      if (absenError) {
        console.error('Error loading absensi:', absenError)
        pushToast('error', 'Gagal memuat data absensi')
        setAbsensi([])
      } else {
        setAbsensi(absen || [])
      }

      // Load ajuan
      const { data: reqs, error: reqsError } = await supabase
        .from('absensi_ajuan')
        .select('*')
        .eq('kelas', kelas)
        .eq('tanggal', tgl)
        .eq('mapel', schedule.mapel)

      if (reqsError) {
        console.error('Error loading ajuan:', reqsError)
        pushToast('error', 'Gagal memuat data ajuan izin')
        setAjuan([])
      } else {
        setAjuan(reqs || [])
      }

      setLastUpdate(new Date())
    } catch (e) {
      console.error('General error in loadDataAbsensi:', e)
      pushToast('error', 'Terjadi kesalahan saat memuat data')
    } finally {
      setIsLoading(false)
    }
  }

  /* ===== Computed Status Logic ===== */
  const isAbsenOpen = useMemo(() => {
    if (!currentSchedule || tgl !== getToday()) return false
    const now = currentDateTime.minutes
    return now >= toMinutes(currentSchedule.jam_mulai) && now <= toMinutes(currentSchedule.jam_selesai)
  }, [currentSchedule, tgl, currentDateTime])

  const isWithinTolerance = useMemo(() => {
    if (!currentSchedule || tgl !== getToday()) return false
    const now = currentDateTime.minutes
    return now >= toMinutes(currentSchedule.jam_mulai) && now <= toMinutes(currentSchedule.jam_selesai) + 5
  }, [currentSchedule, tgl, currentDateTime])

  const { listHadir, listIzin, listSakit, listAlpha, listBelumHadir } = useMemo(() => {
    const listHadir = []
    const listIzin = []
    const listSakit = []
    const listAlpha = []
    const listBelumHadir = []

    siswa.forEach(s => {
      const absen = absensi.find(a => a.uid === s.id)
      const row = {
        ...s,
        absenId: absen?.id,
        status: absen?.status,
        komentar: absen?.komentar,
        oleh: absen?.oleh,
        waktu: absen?.waktu
      }
      if (!absen) listBelumHadir.push(row)
      else if (absen.status === 'Hadir') listHadir.push(row)
      else if (absen.status === 'Izin') listIzin.push(row)
      else if (absen.status === 'Sakit') listSakit.push(row)
      else if (absen.status === 'Alpha') listAlpha.push(row)
      else listBelumHadir.push(row)
    })
    return { listHadir, listIzin, listSakit, listAlpha, listBelumHadir }
  }, [siswa, absensi])

  /* ===== Action Handlers ===== */
  const setStatus = async (uid, st, alasan = '') => {
    if (!currentSchedule?.mapel) return

    setLoadingActions(prev => ({ ...prev, [uid]: true }))

    try {
      const siswaData = siswa.find(s => s.id === uid)
      if (!siswaData) {
        pushToast('error', 'Data siswa tidak ditemukan')
        return
      }

      const payload = {
        kelas,
        tanggal: tgl,
        mapel: currentSchedule.mapel,
        uid,
        nama: siswaData.nama,
        status: st,
        komentar: alasan || `${st} (Manual Guru)`,
        oleh: user.id,
        waktu: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('absensi')
        .upsert(payload, {
          onConflict: 'kelas,tanggal,uid,mapel'
        })

      if (error) {
        console.error('Error setting status:', error)
        const msg = error?.message ? `Gagal mengupdate status absensi: ${error.message}` : 'Gagal mengupdate status absensi'
        pushToast('error', msg)
      } else {
        upsertAbsensiState(data)
        pushToast('success', `Status ${st} berhasil disimpan untuk ${siswaData.nama}`)
      }
    } catch (e) {
      console.error('Exception in setStatus:', e)
      pushToast('error', 'Terjadi kesalahan sistem')
    } finally {
      setLoadingActions(prev => ({ ...prev, [uid]: false }))
    }
  }

  const deleteAbsensi = async (id) => {
    if (!id) return

    try {
      const { error } = await supabase
        .from('absensi')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Error deleting absensi:', error)
        pushToast('error', 'Gagal menghapus data absensi')
      } else {
        removeAbsensiState(id)
        pushToast('success', 'Data absensi berhasil dihapus')
      }
    } catch (error) {
      console.error('Exception deleting absensi:', error)
      pushToast('error', 'Terjadi kesalahan saat menghapus data')
    }
  }

  /* ===== Toggle Absen Mode ===== */
  const toggleAbsenMode = async (mode) => {
    if (!currentSchedule?.mapel) {
      pushToast('error', 'Tidak ada jadwal yang dipilih')
      return
    }

    const today = getToday()

    if (mode === 'otomatis' && tgl !== today) {
      pushToast('error', 'Mode otomatis hanya tersedia untuk tanggal hari ini')
      return
    }

    if (mode === 'otomatis') {
      const now = currentDateTime.minutes
      const start = toMinutes(currentSchedule.jam_mulai)
      const end = toMinutes(currentSchedule.jam_selesai)
      const toleransi = 5

      if (now < start || now > end + toleransi) {
        pushToast('error', 'Mode otomatis hanya bisa diaktifkan selama jam pelajaran + 5 menit toleransi')
        return
      }
    }

    try {
      const { error } = await supabase
        .from('absensi_settings')
        .upsert(
          {
            kelas,
            tanggal: tgl,
            mapel: currentSchedule.mapel,
            mode,
            updated_at: new Date().toISOString()
          },
          {
            onConflict: 'kelas,tanggal,mapel'
          }
        )

      if (error) {
        console.error('Error updating absensi mode:', error)
        pushToast('error', 'Gagal mengubah mode absensi')
      } else {
        setAbsenMode(mode)
        const modeText = mode === 'otomatis' ? 'Otomatis (RFID)' : 'Manual'
        pushToast('success', `Mode absensi diubah ke ${modeText}`)
      }
    } catch (err) {
      console.error('Exception in toggleAbsenMode:', err)
      pushToast('error', 'Terjadi kesalahan sistem')
    }
  }

  /* ===== AUTO ALPHA MANUAL ===== */
  const triggerAutoAlphaManual = async () => {
    if (!window.confirm('Anda yakin ingin menjalankan Auto Alpha? Siswa yang belum absen akan di-set Alpha.')) {
      return
    }

    if (!currentSchedule || !kelas) {
      pushToast('error', 'Pilih kelas dan jadwal terlebih dahulu')
      return
    }

    if (!canRunAutoAlpha) {
      pushToast('error', 'Auto Alpha hanya bisa dijalankan setelah jam pelajaran selesai + toleransi 5 menit')
      return
    }

    setIsRunningAutoAlpha(true)

    try {
      const [siswaRes, absensiRes, ajuanRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('role', 'siswa').eq('kelas', kelas).order('nama'),
        supabase.from('absensi').select('*').eq('kelas', kelas).eq('tanggal', tgl).eq('mapel', currentSchedule.mapel),
        supabase.from('absensi_ajuan').select('*').eq('kelas', kelas).eq('tanggal', tgl).eq('mapel', currentSchedule.mapel)
      ])

      if (siswaRes.error) {
        console.error('Error loading siswa for auto-alpha:', siswaRes.error)
        pushToast('error', 'Gagal memuat data siswa')
        return
      }
      if (absensiRes.error) {
        console.error('Error loading absensi for auto-alpha:', absensiRes.error)
        pushToast('error', 'Gagal memuat data absensi')
        return
      }
      if (ajuanRes.error) {
        console.error('Error loading ajuan for auto-alpha:', ajuanRes.error)
        pushToast('error', 'Gagal memuat data ajuan izin')
        return
      }

      const siswa = siswaRes.data || []
      const absensi = absensiRes.data || []
      const ajuan = ajuanRes.data || []

      let updatedCount = 0
      const updates = []

      for (const s of siswa) {
        const sudahAbsen = absensi.find(a => a.uid === s.id)
        const punyaAjuan = ajuan.find(a => a.uid === s.id)

        if (!sudahAbsen && !punyaAjuan) {
          updates.push({
            kelas,
            tanggal: tgl,
            mapel: currentSchedule.mapel,
            uid: s.id,
            nama: s.nama,
            status: 'Alpha',
            komentar: 'Alpha (Manual Trigger)',
            oleh: user.id,
            waktu: new Date().toISOString()
          })
          updatedCount++
        }
      }

      if (updates.length > 0) {
        const { data, error: upsertError } = await supabase
          .from('absensi')
          .upsert(updates, { onConflict: 'kelas,tanggal,uid,mapel' })

        if (upsertError) {
          console.error('Error in auto-alpha upsert:', upsertError)
          pushToast('error', 'Gagal menyimpan data auto-alpha')
          return
        }

        upsertAbsensiState(data)
      }

      if (updatedCount > 0) {
        pushToast('success', `Auto-alpha manual: ${updatedCount} siswa di-set Alpha`)
      } else {
        pushToast('info', 'Tidak ada siswa yang perlu di-set Alpha')
      }
    } catch (error) {
      console.error('Auto-alpha error:', error)
      pushToast('error', 'Gagal melakukan auto-alpha')
    } finally {
      setIsRunningAutoAlpha(false)
    }
  }

  /* ===== Enhanced Real-time Auto Alpha ===== */
  useEffect(() => {
    const checkEnhancedAutoAlpha = async () => {
      if (!currentSchedule || !kelas || !currentSchedule.mapel) return

      const today = getToday()
      const now = currentDateTime.minutes
      const endTime = toMinutes(currentSchedule.jam_selesai)

      const isToday = tgl === today
      const isPastClassTime = now > endTime + 5
      const isPastDate = tgl < today

      if (!isPastDate && (!isToday || !isPastClassTime)) return

      const runKey = `${kelas}-${tgl}-${currentSchedule.mapel}`
      const lastRun = lastAutoAlphaRun?.[runKey]
      if (lastRun && Date.now() - lastRun < 300000) {
        return
      }

      try {
        const [absensiRes, ajuanRes, siswaRes] = await Promise.all([
          supabase
            .from('absensi')
            .select('*')
            .eq('kelas', kelas)
            .eq('tanggal', tgl)
            .eq('mapel', currentSchedule.mapel),
          supabase
            .from('absensi_ajuan')
            .select('*')
            .eq('kelas', kelas)
            .eq('tanggal', tgl)
            .eq('mapel', currentSchedule.mapel),
          supabase
            .from('profiles')
            .select('*')
            .eq('role', 'siswa')
            .eq('kelas', kelas)
            .order('nama')
        ])

        if (absensiRes.error) {
          console.error('Error loading absensi for auto-alpha:', absensiRes.error)
          return
        }
        if (ajuanRes.error) {
          console.error('Error loading ajuan for auto-alpha:', ajuanRes.error)
          return
        }
        if (siswaRes.error) {
          console.error('Error loading siswa for auto-alpha:', siswaRes.error)
          return
        }

        const siswa = siswaRes.data || []
        const absensi = absensiRes.data || []
        const ajuan = ajuanRes.data || []

        const siswaBelumAbsen = siswa.filter(
          s => !absensi.find(a => a.uid === s.id) && !ajuan.find(a => a.uid === s.id)
        )

        if (siswaBelumAbsen.length === 0) return

        const updates = siswaBelumAbsen.map(s => ({
          kelas,
          tanggal: tgl,
          mapel: currentSchedule.mapel,
          uid: s.id,
          nama: s.nama,
          status: 'Alpha',
          komentar: `Alpha (Auto - ${isPastDate ? 'Tanggal Lewat' : 'Jam Berakhir'})`,
          oleh: 'system',
          waktu: new Date().toISOString()
        }))

        const { data, error: upsertError } = await supabase
          .from('absensi')
          .upsert(updates, {
            onConflict: 'kelas,tanggal,uid,mapel'
          })

        if (upsertError) {
          console.error('Error in auto-alpha upsert:', upsertError)
          return
        }

        if (updates.length > 0) {
          console.log(`✅ Auto-alpha: ${updates.length} siswa`)
          setLastAutoAlphaRun(prev => ({ ...prev, [runKey]: Date.now() }))
          upsertAbsensiState(data)

          if (document.visibilityState === 'visible') {
            pushToast('info', `Auto-alpha: ${updates.length} siswa di-set Alpha`)
          }
        }
      } catch (error) {
        console.error('Enhanced auto-alpha error:', error)
      }
    }

    const interval = setInterval(checkEnhancedAutoAlpha, 120000)
    return () => clearInterval(interval)
  }, [currentSchedule, kelas, tgl, currentDateTime, pushToast, lastAutoAlphaRun])

  /* ===== Jam Kosong Functions ===== */
  const handleJamKosong = async () => {
    if (!jamKosong.jadwal_id || !jamKosong.alasan) {
      pushToast('error', 'Pilih jadwal dan isi alasan')
      return
    }

    if (!user?.id) {
      pushToast('error', 'User tidak terautentikasi')
      return
    }

    setLoadingJamKosong(true)

    try {
      const j = jadwalForJamKosongHariIni.find(x => x.id === jamKosong.jadwal_id)
      if (!j) {
        pushToast('error', 'Jadwal tidak ditemukan')
        return
      }

      const { error } = await supabase
        .from('jam_kosong')
        .insert({
          tanggal: getToday(),
          kelas,
          mapel: j.mapel,
          jam_mulai: j.jam_mulai,
          jam_selesai: j.jam_selesai,
          alasan: jamKosong.alasan,
          guru_pengganti: jamKosong.guru_pengganti,
          created_by: user.id
        })

      if (error) {
        console.error('Error saving jam kosong:', error)
        pushToast('error', 'Gagal menyimpan jam kosong')
      } else {
        setJamKosong({ jadwal_id: '', alasan: '', guru_pengganti: '' })
        await loadRiwayatJamKosong()
        pushToast('success', 'Jam kosong berhasil disimpan')
      }
    } catch (e) {
      console.error('Exception in handleJamKosong:', e)
      pushToast('error', 'Terjadi kesalahan sistem')
    } finally {
      setLoadingJamKosong(false)
    }
  }

  const deleteJamKosong = async (id) => {
    try {
      const { error } = await supabase
        .from('jam_kosong')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Error deleting jam kosong:', error)
        pushToast('error', 'Gagal menghapus jam kosong')
      } else {
        await loadRiwayatJamKosong()
        pushToast('success', 'Jam kosong berhasil dihapus')
      }
    } catch (error) {
      console.error('Exception deleting jam kosong:', error)
      pushToast('error', 'Terjadi kesalahan saat menghapus')
    }
  }

  const openEditJamKosongModal = (data) => {
    setEditingJamKosong(data)
    setIsEditJamKosongModalOpen(true)
  }

  const handleUpdateJamKosong = async () => {
    if (!editingJamKosong) return

    try {
      const { error } = await supabase
        .from('jam_kosong')
        .update({
          alasan: editingJamKosong.alasan,
          guru_pengganti: editingJamKosong.guru_pengganti
        })
        .eq('id', editingJamKosong.id)

      if (error) {
        console.error('Error updating jam kosong:', error)
        pushToast('error', 'Gagal mengupdate jam kosong')
      } else {
        setIsEditJamKosongModalOpen(false)
        await loadRiwayatJamKosong()
        pushToast('success', 'Jam kosong berhasil diupdate')
      }
    } catch (error) {
      console.error('Exception updating jam kosong:', error)
      pushToast('error', 'Terjadi kesalahan sistem')
    }
  }

  /* ===== Izin Functions ===== */
  const openIzinModal = (uid) => {
    setIzinUid(uid)
    setIzinReason('')
    setIsIzinModalOpen(true)
  }

  const handleSimpanIzin = async () => {
    if (!izinUid) return

    try {
      await setStatus(izinUid, 'Izin', izinReason || 'Izin (Manual Guru)')
      setIsIzinModalOpen(false)
    } catch (error) {
      console.error('Error saving izin:', error)
    }
  }

  const openDetailIzinModal = (a) => {
    setSelectedAjuan(a)
    setIsDetailIzinModalOpen(true)
  }

  const keputusanAjuan = async (a, action) => {
    setLoadingActions(prev => ({ ...prev, [`ajuan-${a.id}`]: true }))

    try {
      if (action === 'izin') {
        await setStatus(a.uid, 'Izin', a.alasan)
      } else if (action === 'sakit') {
        await setStatus(a.uid, 'Sakit', a.alasan || 'Sakit (Ajuan)')
      }

      if (action === 'izin' || action === 'sakit' || action === 'tolak') {
        const { error } = await supabase
          .from('absensi_ajuan')
          .delete()
          .eq('id', a.id)

        if (error) {
          console.error('Error deleting ajuan:', error)
          pushToast('error', 'Gagal memproses ajuan')
        } else {
          setIsDetailIzinModalOpen(false)
          setAjuan(prev => prev.filter(x => x.id !== a.id))
          setLastUpdate(new Date())
          let teks = 'Ajuan diproses'
          if (action === 'izin') teks = 'Ajuan diterima sebagai Izin'
          if (action === 'sakit') teks = 'Ajuan diterima sebagai Sakit'
          if (action === 'tolak') teks = 'Ajuan ditolak'
          pushToast('success', teks)
        }
      }
    } catch (error) {
      console.error('Exception in keputusanAjuan:', error)
      pushToast('error', 'Terjadi kesalahan sistem')
    } finally {
      setLoadingActions(prev => ({ ...prev, [`ajuan-${a.id}`]: false }))
    }
  }

  /* ===== Real-time RFID Listeners (ringan, tanpa reload penuh) ===== */
  useEffect(() => {
    if (!kelas || !currentScheduleRef.current?.mapel || !siswa.length || absenMode !== 'otomatis' || tgl !== getToday())
      return

    const channel = supabase
      .channel(`rfid-absen-guru-${kelas}-realtime`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'rfid_scans',
          filter: 'status=eq.raw'
        },
        async (payload) => {
          const scan = payload.new
          const cardUid = (scan.card_uid || '').toString().toUpperCase().replace(/\s+/g, '')
          const target = siswaRef.current.find(
            s => (s.rfid_uid || '').toString().toUpperCase().replace(/\s+/g, '') === cardUid
          )

          if (!target) {
            pushToast('warning', 'Kartu tidak dikenal')
            return
          }

          const existing = absensiRef.current.find(a => a.uid === target.id)
          if (existing && existing.status === 'Hadir') {
            pushToast('info', `${target.nama} sudah absen`)
            return
          }

          try {
            const { data, error: upsertError } = await supabase
              .from('absensi')
              .upsert(
                {
                  kelas,
                  tanggal: tgl,
                  mapel: currentScheduleRef.current?.mapel,
                  uid: target.id,
                  nama: target.nama,
                  status: 'Hadir',
                  komentar: 'Hadir (RFID)',
                  oleh: user?.id || 'rfid:device',
                  waktu: new Date().toISOString()
                },
                {
                  onConflict: 'kelas,tanggal,uid,mapel'
                }
              )

            if (upsertError) {
              console.error('Error upsert absensi via RFID:', upsertError)
              pushToast('error', 'Gagal menyimpan absen RFID')
              return
            }

            await supabase
              .from('rfid_scans')
              .update({ status: 'processed' })
              .eq('id', scan.id)

            // Update state lokal → live tanpa reload
            upsertAbsensiState(data)
            pushToast('success', `${target.nama} berhasil absen via RFID`)
          } catch (error) {
            console.error('Error processing RFID scan:', error)
            pushToast('error', 'Gagal memproses absen RFID')
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [kelas, currentSchedule, absenMode, tgl, siswa.length, pushToast, user?.id])

  /* ===== RENDER TABLE SISWA ===== */
  const renderSiswaTable = (list, type) => {
    const rowColors = {
      Hadir: 'bg-green-50/80 hover:bg-green-100',
      Izin: 'bg-yellow-50/80 hover:bg-yellow-100',
      Sakit: 'bg-blue-50/80 hover:bg-blue-100',
      Alpha: 'bg-red-50/80 hover:bg-red-100',
      'Belum Absen': 'bg-white hover:bg-slate-50'
    }

    const badgeColors = {
      Hadir: 'bg-green-100 text-green-700 border-green-200',
      Izin: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      Sakit: 'bg-blue-100 text-blue-700 border-blue-200',
      Alpha: 'bg-red-100 text-red-700 border-red-200',
      'Belum Absen': 'bg-gray-100 text-gray-600 border-gray-200'
    }

    const getSourceInfo = (s) => {
      if (s.status !== 'Hadir') {
        return <span className="text-slate-500 italic text-xs">{s.komentar || '-'}</span>
      }

      const text = (s.komentar || '').toLowerCase()
      const oleh = (s.oleh || '').toLowerCase()

      if (text.includes('rfid') || oleh.includes('rfid')) {
        return (
          <span className="flex items-center gap-1 font-bold text-blue-600 text-xs">
            <span className="text-[10px]">📡</span> RFID
          </span>
        )
      }
      if (text.includes('manual') || oleh === user?.id) {
        return (
          <span className="flex items-center gap-1 font-bold text-slate-600 text-xs">
            <span className="text-[10px]">👨‍🏫</span> Manual Guru
          </span>
        )
      }
      if (text.includes('auto') || oleh === 'system') {
        return (
          <span className="flex items-center gap-1 font-bold text-orange-600 text-xs">
            <span className="text-[10px]">🤖</span> System
          </span>
        )
      }
      return <span className="text-slate-600 text-xs">{s.komentar}</span>
    }

    return (
      <div className="mb-6">
        <h4 className="font-bold text-slate-800 text-sm mb-2 flex items-center gap-2">
          {type === 'Hadir' && '✅'}
          {type === 'Izin' && '🟡'}
          {type === 'Sakit' && '💙'}
          {type === 'Alpha' && '❌'}
          {type === 'Belum Absen' && '⏳'}
          {type}{' '}
          <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-xs min-w-[24px] text-center">
            {list.length}
          </span>
        </h4>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm bg-white">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-xs">
              <tr>
                <th className="px-4 py-3 w-12 text-center border-b border-slate-200">No</th>
                <th className="px-4 py-3 w-16 text-center border-b border-slate-200">Foto</th>
                <th className="px-4 py-3 border-b border-slate-200">Nama Siswa</th>
                <th className="px-4 py-3 border-b border-slate-200">Keterangan</th>
                <th className="px-4 py-3 text-center border-b border-slate-200">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-6 text-center text-slate-400 italic bg-white">
                    Tidak ada siswa dengan status {type}
                  </td>
                </tr>
              ) : (
                list.map((s, index) => (
                  <tr key={s.id} className={`transition-colors ${rowColors[type]}`}>
                    <td className="px-4 py-3 text-center font-medium text-slate-600 border-r border-transparent">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ProfileAvatar
                        src={s.photo_path || s.photo_url || ''}
                        name={s.nama}
                        size={36}
                        className="mx-auto border-slate-300"
                        fallbackClassName="rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs border border-blue-200 mx-auto"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{s.nama}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${badgeColors[type]}`}
                        >
                          {type}
                        </span>
                        {getSourceInfo(s)}
                        {s.waktu && type === 'Hadir' && (
                          <span className="text-slate-400 text-[10px]">
                            {new Date(s.waktu).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {type === 'Belum Absen' ? (
                          <>
                            <button
                              onClick={() => setStatus(s.id, 'Hadir')}
                              disabled={loadingActions[s.id] || (absenMode === 'otomatis' && rfidSettings.rfid_aktif)}
                              className="w-7 h-7 rounded bg-green-500 hover:bg-green-600 text-white flex items-center justify-center text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Hadir"
                            >
                              H
                            </button>
                            <button
                              onClick={() => openIzinModal(s.id)}
                              disabled={loadingActions[s.id] || (absenMode === 'otomatis' && rfidSettings.rfid_aktif)}
                              className="w-7 h-7 rounded bg-yellow-400 hover:bg-yellow-500 text-white flex items-center justify-center text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Izin"
                            >
                              I
                            </button>
                            <button
                              onClick={() => setStatus(s.id, 'Sakit')}
                              disabled={loadingActions[s.id] || (absenMode === 'otomatis' && rfidSettings.rfid_aktif)}
                              className="w-7 h-7 rounded bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Sakit"
                            >
                              S
                            </button>
                            <button
                              onClick={() => setStatus(s.id, 'Alpha')}
                              disabled={loadingActions[s.id] || (absenMode === 'otomatis' && rfidSettings.rfid_aktif)}
                              className="w-7 h-7 rounded bg-red-500 hover:bg-red-600 text-white flex items-center justify-center text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Alpha"
                            >
                              A
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => openIzinModal(s.id)}
                              className="w-7 h-7 rounded bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-sm transition-all"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm('Hapus data absensi ini?')) deleteAbsensi(s.absenId)
                              }}
                              className="w-7 h-7 rounded bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-sm transition-all"
                              title="Hapus"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  /* ===== RENDER UI UTAMA ===== */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-blue-500 to-indigo-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">Absensi Guru</h1>
                <p className="text-slate-600 text-base">Sistem manajemen kehadiran siswa real-time.</p>
              </div>
            </div>
            <div className="flex flex-col items-stretch lg:items-end gap-3">
              <RealTimeClock />
              <div className="flex flex-wrap gap-2">
              <span
                className={`px-3 py-1.5 rounded-2xl text-[10px] font-bold border uppercase tracking-wider ${
                  isOnline
                    ? 'bg-green-100 text-green-700 border-green-300'
                    : 'bg-red-100 text-red-700 border-red-300'
                }`}
              >
                {isOnline ? '● Online' : '○ Offline'}
              </span>
              <span className="px-3 py-1.5 rounded-2xl text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                Sync: {lastUpdate.toLocaleTimeString('id-ID')}
              </span>
              <span className="px-3 py-1.5 rounded-2xl text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Real-time: ON
              </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Jadwal Hari Ini */}
        {jadwalHariIni.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden transition-all duration-300 hover:shadow-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                <h2 className="text-xl font-bold text-slate-900">
                  Jadwal Hari Ini ({getDayName(getToday())})
                </h2>
              </div>
              <span className="text-xs text-blue-700 bg-blue-100 px-3 py-1.5 rounded-2xl border border-blue-200 font-semibold">
                {jadwalHariIni.length} jadwal
              </span>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {jadwalHariIni.map(jadwal => (
                <JadwalHariIniCard
                  key={jadwal.id}
                  jadwal={jadwal}
                  currentTimeMinutes={currentDateTime.minutes}
                  onClick={() => {
                    setKelas(jadwal.kelas_id)
                    setSelectedScheduleId(jadwal.id)
                    setView('absen')
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden transition-all duration-300 hover:shadow-md">
          {/* Filters Area */}
          <div className="p-6 bg-gradient-to-r from-slate-50 to-blue-50/40 border-b border-slate-200">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Filter Absensi</h2>
                <p className="text-xs text-slate-500 mt-0.5">Pilih kelas, jadwal, dan tanggal untuk memulai absensi.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">
                  Pilih Kelas
                </label>
                <select
                  className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
                  value={kelas}
                  onChange={e => {
                    setKelas(e.target.value)
                    setSelectedScheduleId('')
                    setCurrentSchedule(null)
                  }}
                >
                  <option value="">— Pilih Kelas —</option>
                  {myKelasList.map(k => (
                    <option key={k} value={k}>
                      {formatKelasDisplay(k)}
                    </option>
                  ))}
                </select>
              </div>
              {view === 'absen' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">
                      Pilih Jadwal
                    </label>
                    <select
                      className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
                      value={selectedScheduleId}
                      onChange={e => {
                        setSelectedScheduleId(e.target.value)
                        setCurrentSchedule(null)
                      }}
                      disabled={!kelas}
                    >
                      <option value="">— Pilih Jadwal —</option>
                      {schedulesForSelectedClass.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.label} {s.isCurrent ? ' (Sekarang)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">
                      Tanggal Absen
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        className="flex-1 px-4 py-3 rounded-2xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 shadow-sm"
                        value={tgl}
                        onChange={e => setTgl(e.target.value)}
                      />
                      <button
                        onClick={() => setTgl(getToday())}
                        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-bold shadow-sm transition-colors"
                      >
                        Hari Ini
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Compact Info & Toggle Bar */}
          {view === 'absen' && currentSchedule && (
            <div className="bg-slate-50/80 border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Left: Schedule Info */}
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div
                  className={`p-2.5 rounded-2xl flex-shrink-0 ${
                    isAbsenOpen ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-sm">{currentSchedule.mapel}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span>
                      {currentSchedule.jam_mulai} - {currentSchedule.jam_selesai}
                    </span>
                    <span>•</span>
                    <span>{formatKelasDisplay(kelas)}</span>
                    {isWithinTolerance && (
                      <span className="text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-xl border border-amber-200">
                        Toleransi Aktif (5 menit)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Mode Toggle + Auto Alpha Button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={triggerAutoAlphaManual}
                  disabled={isRunningAutoAlpha || !currentSchedule}
                  className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-2xl disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-1 shadow-sm"
                  title="Jalankan Auto Alpha untuk siswa yang belum absen"
                >
                  {isRunningAutoAlpha ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>⚡ Auto Alpha</>
                  )}
                </button>

                <div className="flex items-center bg-slate-100 rounded-2xl p-1 border border-slate-200">
                  <button
                    onClick={() => toggleAbsenMode('manual')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      absenMode === 'manual'
                        ? 'bg-white text-blue-600 shadow-sm border border-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <span>👨‍🏫</span> Manual
                  </button>
                  <button
                    onClick={() => toggleAbsenMode('otomatis')}
                    disabled={tgl !== getToday() || !isWithinTolerance}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      absenMode === 'otomatis'
                        ? 'bg-white text-green-600 shadow-sm border border-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    } ${tgl !== getToday() || !isWithinTolerance ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={
                      tgl !== getToday()
                        ? 'Mode otomatis hanya tersedia untuk hari ini'
                        : !isWithinTolerance
                        ? 'Mode otomatis hanya tersedia selama jam pelajaran'
                        : ''
                    }
                  >
                    <span>🤖</span> Otomatis{' '}
                    {rfidSettings.rfid_aktif && (
                      <span className="text-[9px] bg-green-500 text-white px-1 rounded ml-1">RFID</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="border-b border-slate-200 px-6 pt-2 bg-white">
            <div className="flex gap-2 overflow-x-auto">
              {[
                { key: 'absen', label: 'Absensi Siswa', icon: '📝' },
                { key: 'jadwal', label: 'Jadwal Mengajar', icon: '📅' },
                { key: 'jam_kosong', label: 'Input Jam Kosong', icon: '⛔' }
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key)}
                  className={`py-3 px-4 text-sm font-bold border-b-2 rounded-t-2xl flex items-center gap-2 transition-all whitespace-nowrap ${
                    view === tab.key
                      ? 'border-blue-600 text-blue-600 bg-blue-50/70'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span>{tab.icon}</span> {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="p-6 bg-slate-50/40 min-h-[400px]">
            {/* === TAB: ABSENSI === */}
            {view === 'absen' && (
              <div className="space-y-8">
                {/* Notifikasi Ajuan Izin */}
                {ajuan.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm animate-pulse-slow">
                    <h4 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
                      📨 Ajuan Izin Masuk{' '}
                      <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full text-xs">
                        {ajuan.length}
                      </span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {ajuan.map(a => (
                        <div
                          key={a.id}
                          className="bg-white p-3 rounded-2xl border border-amber-100 flex justify-between items-center shadow-sm"
                        >
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <div className="font-bold text-sm text-gray-800">{a.nama}</div>
                              {a.alasan?.toLowerCase().includes('sakit') && (
                                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200">
                                  Izin Sakit
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 italic">"{a.alasan}"</div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => keputusanAjuan(a, 'izin')}
                              disabled={loadingActions[`ajuan-${a.id}`]}
                              className="px-3 py-1.5 bg-green-500 text-white text-xs rounded-xl font-bold hover:bg-green-600 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Terima (Izin)
                            </button>
                            <button
                              onClick={() => keputusanAjuan(a, 'sakit')}
                              disabled={loadingActions[`ajuan-${a.id}`]}
                              className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-xl font-bold hover:bg-blue-600 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Sakit
                            </button>
                            <button
                              onClick={() => keputusanAjuan(a, 'tolak')}
                              disabled={loadingActions[`ajuan-${a.id}`]}
                              className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-xl font-bold hover:bg-red-600 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Tolak
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tabel Siswa */}
                {isLoading ? (
                  <div className="text-center py-20">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-slate-400 text-sm">Sedang memuat data...</p>
                  </div>
                ) : siswa.length === 0 ? (
                  <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-300">
                    <div className="text-4xl mb-2">🎓</div>
                    <p>
                      Silakan pilih <b>Kelas</b> dan <b>Jadwal</b> terlebih dahulu.
                    </p>
                  </div>
                ) : (
                  <>
                    {renderSiswaTable(listHadir, 'Hadir')}
                    {renderSiswaTable(listIzin, 'Izin')}
                    {renderSiswaTable(listSakit, 'Sakit')}
                    {renderSiswaTable(listAlpha, 'Alpha')}
                    {renderSiswaTable(listBelumHadir, 'Belum Absen')}
                  </>
                )}
              </div>
            )}

            {/* === TAB: JADWAL === */}
            {view === 'jadwal' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Object.keys(jadwalByHari).length === 0 && (
                  <div className="col-span-3 text-center text-slate-400 py-20 italic">
                    Belum ada jadwal mengajar.
                  </div>
                )}
                {Object.entries(jadwalByHari).map(([hari, items]) => (
                  <div
                    key={hari}
                    className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-5 py-3 font-bold text-sm tracking-wide uppercase">
                      {hari}
                    </div>
                    <div className="p-4 space-y-3 bg-slate-50">
                      {items.map(j => (
                        <JadwalCard
                          key={j.id}
                          jadwal={j}
                          onSelect={() => {
                            setKelas(j.kelas_id)
                            setSelectedScheduleId(j.id)
                            setView('absen')
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* === TAB: INPUT JAM KOSONG === */}
            {view === 'jam_kosong' && (
              <div className="space-y-8">
                {/* Form Input Jam Kosong */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <h3 className="font-bold text-slate-800 mb-4 text-lg flex items-center gap-2">
                    ⛔ Form Input Jam Kosong
                  </h3>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Jadwal Hari Ini</label>
                        <select
                          className="w-full px-4 py-3 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 bg-white"
                          value={jamKosong.jadwal_id}
                          onChange={e => setJamKosong(p => ({ ...p, jadwal_id: e.target.value }))}
                          disabled={!kelas}
                        >
                          <option value="">— Pilih Mapel yang Kosong —</option>
                          {jadwalForJamKosongHariIni.map(j => (
                            <option key={j.id} value={j.id}>
                              {j.label}
                            </option>
                          ))}
                        </select>
                        {!kelas && (
                          <p className="text-xs text-red-500 mt-2 font-medium">
                            ⚠️ Mohon pilih kelas terlebih dahulu di bagian filter atas.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">
                          Guru Pengganti (Opsional)
                        </label>
                        <select
                          className="w-full px-4 py-3 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 bg-white"
                          value={jamKosong.guru_pengganti}
                          onChange={e => setJamKosong(p => ({ ...p, guru_pengganti: e.target.value }))}
                        >
                          <option value="">— Tidak Ada —</option>
                          {guruList.map(g => (
                            <option key={g.id} value={g.nama}>
                              {g.nama}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">
                        Alasan <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        className="w-full px-4 py-3 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 bg-white"
                        rows="4"
                        placeholder="Contoh: Sakit, Dinas Luar, Urusan Keluarga, Izin Pribadi..."
                        value={jamKosong.alasan}
                        onChange={e => setJamKosong(p => ({ ...p, alasan: e.target.value }))}
                      ></textarea>
                    </div>
                  </div>

                  <div className="mt-6">
                    <button
                      onClick={handleJamKosong}
                      disabled={loadingJamKosong || !jamKosong.jadwal_id || !jamKosong.alasan}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-lg transition-all"
                    >
                      {loadingJamKosong ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Menyimpan Data...
                        </div>
                      ) : (
                        '💾 Simpan Jam Kosong'
                      )}
                    </button>
                  </div>
                </div>

                {/* Riwayat Jam Kosong */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                      📜 Riwayat Jam Kosong
                    </h3>
                    <button
                      onClick={loadRiwayatJamKosong}
                      className="text-blue-600 text-sm font-bold hover:bg-blue-50 px-3 py-1.5 rounded-2xl transition-colors flex items-center gap-1 border border-blue-100"
                    >
                      🔄 Refresh
                    </button>
                  </div>

                  {isLoadingJamKosong ? (
                    <div className="text-center py-10 text-slate-400">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      Memuat data...
                    </div>
                  ) : riwayatJamKosong.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-300">
                      Tidak ada data jam kosong.
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100 text-slate-700 uppercase text-xs">
                          <tr>
                            <th className="p-3 text-left font-bold border-b border-slate-200">Tanggal</th>
                            <th className="p-3 text-left font-bold border-b border-slate-200">Mapel / Jam</th>
                            <th className="p-3 text-left font-bold border-b border-slate-200">Kelas</th>
                            <th className="p-3 text-left font-bold border-b border-slate-200">Alasan</th>
                            <th className="p-3 text-left font-bold border-b border-slate-200">Pengganti</th>
                            <th className="p-3 text-center font-bold border-b border-slate-200">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {riwayatJamKosong.map(r => (
                            <tr key={r.id} className="hover:bg-slate-50">
                              <td className="p-3">
                                <div className="font-bold text-slate-800 text-sm">
                                  {formatDateDisplay(r.tanggal)}
                                </div>
                                <div className="text-xs text-slate-500">{getDayName(r.tanggal)}</div>
                              </td>
                              <td className="p-3">
                                <div className="font-bold text-slate-800 text-sm">{r.mapel}</div>
                                <div className="text-xs text-slate-500">
                                  {r.jam_mulai} - {r.jam_selesai}
                                </div>
                              </td>
                              <td className="p-3 text-slate-600 font-medium">
                                {formatKelasDisplay(r.kelas)}
                              </td>
                              <td className="p-3 text-slate-600 italic">{r.alasan}</td>
                              <td className="p-3 text-slate-600">{r.guru_pengganti || '-'}</td>
                              <td className="p-3 text-center">
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => openEditJamKosongModal(r)}
                                    className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                                    title="Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (window.confirm('Hapus data jam kosong ini?')) {
                                        deleteJamKosong(r.id)
                                      }
                                    }}
                                    className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors"
                                    title="Hapus"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Izin Manual */}
      {isIzinModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[99] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-md shadow-2xl transform transition-all">
            <h3 className="font-bold text-lg mb-2 text-slate-800">📝 Beri Izin Manual</h3>
            <p className="text-sm text-slate-500 mb-4">Masukkan alasan kenapa siswa ini izin.</p>
            <textarea
              className="w-full border border-slate-300 rounded-2xl p-3 mb-5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              rows="3"
              placeholder="Contoh: Sakit demam, Acara keluarga..."
              value={izinReason}
              onChange={e => setIzinReason(e.target.value)}
            ></textarea>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsIzinModalOpen(false)}
                className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-2xl transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSimpanIzin}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-lg transition-colors"
              >
                Simpan Izin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detail Ajuan */}
      {isDetailIzinModalOpen && selectedAjuan && (
        <div className="fixed inset-0 bg-black/50 z-[99] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4 border-b border-slate-200 pb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-xl">
                📨
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-800">Detail Ajuan Izin</h3>
                <p className="text-xs text-slate-500">{selectedAjuan.tanggal}</p>
              </div>
            </div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Nama Siswa</label>
                <div className="text-slate-800 font-medium">{selectedAjuan.nama}</div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Alasan</label>
                <div className="bg-slate-50 p-3 rounded-2xl text-slate-700 italic border border-slate-200">
                  {selectedAjuan.alasan}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDetailIzinModalOpen(false)}
                className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-2xl"
              >
                Tutup
              </button>
              <button
                onClick={() => keputusanAjuan(selectedAjuan, 'tolak')}
                disabled={loadingActions[`ajuan-${selectedAjuan.id}`]}
                className="px-5 py-2.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-2xl font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tolak
              </button>
              <button
                onClick={() => keputusanAjuan(selectedAjuan, 'izin')}
                disabled={loadingActions[`ajuan-${selectedAjuan.id}`]}
                className="px-5 py-2.5 bg-yellow-500 text-white hover:bg-yellow-600 rounded-2xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Izin
              </button>
              <button
                onClick={() => keputusanAjuan(selectedAjuan, 'sakit')}
                disabled={loadingActions[`ajuan-${selectedAjuan.id}`]}
                className="px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-2xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sakit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Jam Kosong */}
      {isEditJamKosongModalOpen && editingJamKosong && (
        <div className="fixed inset-0 bg-black/50 z-[99] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-md shadow-2xl">
            <h3 className="font-bold text-lg mb-4 text-slate-800">✏️ Edit Jam Kosong</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Alasan</label>
                <textarea
                  className="w-full border border-slate-300 rounded-2xl p-3 focus:ring-2 focus:ring-blue-500 outline-none"
                  rows="3"
                  value={editingJamKosong.alasan}
                  onChange={e =>
                    setEditingJamKosong({
                      ...editingJamKosong,
                      alasan: e.target.value
                    })
                  }
                ></textarea>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Guru Pengganti
                </label>
                <select
                  className="w-full border border-slate-300 rounded-2xl p-3 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={editingJamKosong.guru_pengganti || ''}
                  onChange={e =>
                    setEditingJamKosong({
                      ...editingJamKosong,
                      guru_pengganti: e.target.value
                    })
                  }
                >
                  <option value="">— Pengganti —</option>
                  {guruList.map(g => (
                    <option key={g.id} value={g.nama}>
                      {g.nama}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsEditJamKosongModalOpen(false)}
                className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-2xl transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleUpdateJamKosong}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 shadow-lg transition-colors"
              >
                Update Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Export dengan Error Boundary
export default function AbsensiGuruWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <AbsensiGuru />
    </ErrorBoundary>
  )
}
