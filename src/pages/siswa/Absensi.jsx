// src/pages/siswa/SAbsensi.jsx
import React, {
  useState,
  useEffect,
  useCallback,
  useRef
} from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'

/* ======================= Helper ======================= */
const getToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getDayName = (tglString) => {
  const date = new Date(`${tglString}T12:00:00Z`)
  const dayIndex = date.getUTCDay()
  const HARI_MAP = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  return HARI_MAP[dayIndex] || ''
}

const toMinutes = (hhmm) => {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

const getCurrentDateTime = () => {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }),
    dayName: getDayName(now.toISOString().slice(0, 10)),
    minutes: now.getHours() * 60 + now.getMinutes(),
    timestamp: now.getTime()
  }
}

/* ======================= Jam realtime ======================= */
const RealTimeClock = () => {
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3 shadow-sm">
      <div className="text-center">
        <div className="text-base font-semibold font-mono text-gray-800">
          {currentTime.toLocaleTimeString('id-ID')}
        </div>
        <div className="text-xs text-gray-600 mt-1">
          {currentTime.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>
    </div>
  )
}

/* ======================= Badge ======================= */
const Badge = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    hadir: 'bg-green-100 text-green-800 border border-green-300',
    izin: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
    alpha: 'bg-red-100 text-red-800 border border-red-300',
    live: 'bg-green-500 text-white',
    warning: 'bg-amber-100 text-amber-800 border border-amber-300',
    info: 'bg-blue-100 text-blue-800 border border-blue-300',
    success: 'bg-green-100 text-green-800 border border-green-300'
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

/* ======================= Tabel Ringkasan Kehadiran Kelas ======================= */
/**
 * NOTE PERMINTAAN:
 * - Hanya tampilkan siswa yang SUDAH punya record absensi (Hadir / Izin / Sakit / Alpha)
 * - Row warna hijau = Hadir, kuning = Izin/Sakit, merah = Alpha
 * - Realtime: listen perubahan tabel absensi (kelas + mapel + tanggal ini)
 */
const RingkasanKelasTable = ({ kelas, mapel, tanggal }) => {
  const [dataSiswa, setDataSiswa] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const loadDataSiswa = useCallback(async () => {
    if (!kelas || !mapel || !tanggal) {
      setDataSiswa([])
      return
    }

    setIsLoading(true)
    try {
      // Ambil hanya siswa yang sudah punya record absensi utk mapel & tanggal ini
      const { data: absensiData, error: absensiError } = await supabase
        .from('absensi')
        .select('uid, status, komentar, oleh, waktu, nama, tanggal, mapel, kelas')
        .eq('kelas', kelas)
        .eq('mapel', mapel)
        .eq('tanggal', tanggal)

      if (absensiError) throw absensiError

      if (!absensiData || absensiData.length === 0) {
        setDataSiswa([])
        return
      }

      const uids = absensiData.map((a) => a.uid).filter(Boolean)

      let siswaData = []
      if (uids.length > 0) {
        const { data, error: siswaError } = await supabase
          .from('profiles')
          .select('id, nama, photo_url, nik, kelas')
          .in('id', uids)

        if (siswaError) throw siswaError
        siswaData = data || []
      }

      const mergedData = absensiData
        .map((abs) => {
          const siswa = siswaData.find((s) => s.id === abs.uid)
          return {
            id: abs.uid,
            nama: siswa?.nama || abs.nama || 'Tanpa Nama',
            foto: siswa?.foto || siswa?.photo_url || null,
            nik: siswa?.nik || null,
            kelas: siswa?.kelas || abs.kelas || kelas,
            status: abs.status,
            komentar: abs.komentar || '',
            oleh: abs.oleh || '',
            waktu: abs.waktu || ''
          }
        })
        .sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))

      setDataSiswa(mergedData)
    } catch (error) {
      console.error('Error loading data siswa:', error)
    } finally {
      setIsLoading(false)
    }
  }, [kelas, mapel, tanggal])

  // initial load / saat filter berubah
  useEffect(() => {
    loadDataSiswa()
  }, [loadDataSiswa])

  // Realtime: listen perubahan absensi untuk kelas ini, lalu filter mapel+tanggal
  useEffect(() => {
    if (!kelas || !mapel || !tanggal) return

    const channel = supabase
      .channel(`absensi-kelas-table-${kelas}-${mapel}-${tanggal}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `kelas=eq.${kelas}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (row && row.mapel === mapel && row.tanggal === tanggal) {
            loadDataSiswa()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [kelas, mapel, tanggal, loadDataSiswa])

  const getStatusColor = (status) => {
    switch (status) {
      case 'Hadir':
        return 'bg-green-50 border-l-4 border-green-400'
      case 'Izin':
      case 'Sakit':
        return 'bg-yellow-50 border-l-4 border-yellow-400'
      case 'Alpha':
        return 'bg-red-50 border-l-4 border-red-400'
      default:
        return 'bg-gray-50 border-l-4 border-gray-200'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'Hadir':
        return 'text-green-800'
      case 'Izin':
      case 'Sakit':
        return 'text-yellow-800'
      case 'Alpha':
        return 'text-red-800'
      default:
        return 'text-gray-800'
    }
  }

  const getDetailAbsensi = (siswa) => {
    if (siswa.status !== 'Hadir') {
      if (siswa.status === 'Izin' || siswa.status === 'Sakit') {
        return siswa.komentar || siswa.status
      }
      return siswa.status
    }
    if (siswa.komentar?.includes('RFID')) return 'Via RFID'
    if (siswa.komentar?.includes('mandiri')) return 'Manual Mandiri'
    if (siswa.oleh === 'guru') return 'Diabsen Guru'
    if (siswa.oleh === 'system') return 'Auto System'
    if (siswa.oleh === 'rfid') return 'RFID'
    return 'Hadir'
  }

  if (isLoading) {
    return (
      <div className="text-center py-4">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-gray-600 text-xs">Memuat data siswa...</p>
      </div>
    )
  }

  if (!dataSiswa.length) {
    return (
      <div className="mt-2 text-xs text-gray-500 italic">
        Belum ada siswa yang tercatat absen untuk mapel ini pada tanggal ini.
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left p-2 font-semibold text-gray-700">Siswa</th>
              <th className="text-left p-2 font-semibold text-gray-700">NIK</th>
              <th className="text-left p-2 font-semibold text-gray-700">Status</th>
              <th className="text-left p-2 font-semibold text-gray-700">Detail</th>
            </tr>
          </thead>
          <tbody>
            {dataSiswa.map((siswa) => (
              <tr
                key={siswa.id}
                className={`border-b border-gray-100 ${getStatusColor(
                  siswa.status
                )}`}
              >
                <td className="p-2">
                  <div className="flex items-center space-x-2">
                    <img
                      src={siswa.foto || '/default-avatar.png'}
                      alt={siswa.nama}
                      className="w-7 h-7 rounded-full object-cover border border-gray-300"
                      onError={(e) => {
                        e.target.src = '/default-avatar.png'
                      }}
                    />
                    <span className="font-medium text-gray-900 text-xs">
                      {siswa.nama}
                    </span>
                  </div>
                </td>
                <td className="p-2 text-gray-600 text-[11px]">
                  {siswa.nik || '-'}
                </td>
                <td className="p-2">
                  <span
                    className={`font-semibold text-[11px] ${getStatusText(
                      siswa.status
                    )}`}
                  >
                    {siswa.status}
                  </span>
                </td>
                <td className="p-2">
                  <span className="text-[11px] text-gray-700">
                    {getDetailAbsensi(siswa)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-gray-500">
        Menampilkan {dataSiswa.length} siswa yang sudah tercatat (Hadir / Izin / Sakit / Alpha)
      </div>
    </div>
  )
}

/* ======================= Jadwal Card ======================= */
const JadwalCard = ({
  jadwal,
  currentTime,
  isCurrent,
  onAbsenClick,
  onCalendarClick
}) => {
  const [waktuSisa, setWaktuSisa] = useState('')

  useEffect(() => {
    const calculateWaktuSisa = () => {
      if (!jadwal.jam_selesai) return ''

      const now = currentTime
      const [jam, menit] = jadwal.jam_selesai.split(':').map(Number)
      const selesai = new Date()
      selesai.setHours(jam, menit, 0, 0)

      if (now > selesai) return 'Selesai'

      const diff = selesai - now
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      if (hours > 0) return `${hours}j ${minutes}m`
      return `${minutes}m`
    }

    setWaktuSisa(calculateWaktuSisa())
    const interval = setInterval(() => setWaktuSisa(calculateWaktuSisa()), 60000)
    return () => clearInterval(interval)
  }, [jadwal.jam_selesai, currentTime])

  const isSesiAktif = () => {
    if (!jadwal.jam_mulai || !jadwal.jam_selesai) return false
    const now = currentTime
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = toMinutes(jadwal.jam_mulai)
    const endMinutes = toMinutes(jadwal.jam_selesai)
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes
  }

  const getCardStyle = () => {
    if (isCurrent && isSesiAktif() && jadwal.mode === 'otomatis' && !jadwal.status) {
      return 'border-green-500 bg-green-50'
    }
    if (isCurrent) return 'border-blue-500 bg-blue-50'
    if (jadwal.status) return 'border-blue-300 bg-blue-50'
    return 'border-gray-200 bg-white'
  }

  const isSesiAktifFlag = isSesiAktif()

  return (
    <div className={`rounded-lg border p-3 transition-all duration-200 ${getCardStyle()}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isCurrent && isSesiAktifFlag && jadwal.mode === 'otomatis' && !jadwal.status
                ? 'bg-green-500 animate-pulse'
                : isCurrent
                ? 'bg-blue-500'
                : jadwal.status
                ? 'bg-blue-400'
                : 'bg-gray-400'
            }`}
          />
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{jadwal.mapel}</h3>
            <p className="text-xs text-gray-600">{jadwal.guru_nama || 'Guru'}</p>
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          {isCurrent && <Badge variant="live" className="text-[10px]">SEKARANG</Badge>}
          {waktuSisa && !isSesiAktifFlag && (
            <Badge variant="info" className="text-[10px]">{waktuSisa}</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="text-center p-2 bg-white rounded border border-gray-200">
          <div className="text-[11px] text-gray-600">Mulai</div>
          <div className="font-semibold text-gray-900 text-sm">
            {jadwal.jam_mulai}
          </div>
        </div>
        <div className="text-center p-2 bg-white rounded border border-gray-200">
          <div className="text-[11px] text-gray-600">Selesai</div>
          <div className="font-semibold text-gray-900 text-sm">
            {jadwal.jam_selesai}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <Badge variant={jadwal.mode === 'otomatis' ? 'hadir' : 'warning'}>
          {jadwal.mode === 'otomatis' ? 'Auto' : 'Manual'}
        </Badge>
        {jadwal.status && (
          <Badge
            variant={
              jadwal.status === 'Hadir'
                ? 'hadir'
                : jadwal.status === 'Izin' || jadwal.status === 'Sakit'
                ? 'izin'
                : 'alpha'
            }
          >
            {jadwal.status}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {isCurrent && isSesiAktifFlag && jadwal.mode === 'otomatis' && !jadwal.status && (
          <button
            className="w-full py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md font-semibold transition-all duration-200 text-[11px]"
            onClick={() => onAbsenClick(jadwal)}
          >
            Absen
          </button>
        )}
        <button
          className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-all duration-200 text-[11px]"
          onClick={() => onCalendarClick(jadwal)}
        >
          Kalender
        </button>
      </div>
    </div>
  )
}

/* ======================= Calendar Overlay ======================= */
const CalendarOverlay = ({ mapel, jadwalMingguIni, onClose, profile, userId }) => {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [absensiData, setAbsensiData] = useState({})
  const [isLoading, setIsLoading] = useState(false)

  const bulanList = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember'
  ]

  const selectedYear = new Date().getFullYear()
  const hariList = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

  const getJadwalHari = () => {
    const hariMapel = []
    Object.keys(jadwalMingguIni || {}).forEach((hari) => {
      if ((jadwalMingguIni[hari] || []).some((j) => j.mapel === mapel)) {
        hariMapel.push(hari)
      }
    })
    return hariMapel
  }

  const loadAbsensiBulanan = async () => {
    if (!mapel || !profile?.kelas || !userId) return

    setIsLoading(true)
    try {
      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
      const endDate = new Date(selectedYear, selectedMonth, 0)
        .toISOString()
        .split('T')[0]

      const { data, error } = await supabase
        .from('absensi')
        .select('*')
        .eq('kelas', profile.kelas)
        .eq('mapel', mapel)
        .eq('uid', userId)
        .gte('tanggal', startDate)
        .lte('tanggal', endDate)

      if (error) throw error

      const absensiMap = {}
      ;(data || []).forEach((item) => {
        absensiMap[item.tanggal] = item.status
      })

      setAbsensiData(absensiMap)
    } catch (error) {
      console.error('Error loading absensi bulanan:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAbsensiBulanan()
  }, [selectedMonth, selectedYear, mapel])

  const generateCalendar = () => {
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay()
    const calendar = []
    const hariMapel = getJadwalHari()

    for (let i = 0; i < firstDay; i++) calendar.push(null)

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(
        day
      ).padStart(2, '0')}`
      const dayName = getDayName(date)
      const hasJadwal = hariMapel.includes(dayName)
      const status = absensiData[date]

      let bgColor = 'bg-white'
      let textColor = 'text-gray-900'
      let borderColor = 'border-gray-200'

      if (hasJadwal) {
        if (status === 'Hadir') {
          bgColor = 'bg-blue-100'
          borderColor = 'border-blue-300'
        } else if (status === 'Alpha') {
          bgColor = 'bg-red-100'
          borderColor = 'border-red-300'
          textColor = 'text-red-900'
        } else if (status === 'Izin' || status === 'Sakit') {
          bgColor = 'bg-gray-100'
          borderColor = 'border-gray-300'
          textColor = 'text-gray-700'
        } else {
          bgColor = 'bg-yellow-100'
          borderColor = 'border-yellow-300'
          textColor = 'text-yellow-900'
        }
      } else {
        bgColor = 'bg-gray-50'
        textColor = 'text-gray-500'
        borderColor = 'border-gray-100'
      }

      calendar.push({
        date,
        day,
        dayName,
        hasJadwal,
        status,
        bgColor,
        textColor,
        borderColor
      })
    }

    return calendar
  }

  const calendar = generateCalendar()

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            Kalender Absensi - {mapel}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Filter Bulan */}
        <div className="mb-6">
          <div className="w-64">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bulan
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {bulanList.map((bulan, index) => (
                <option key={bulan} value={index + 1}>
                  {bulan} {selectedYear}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Legend */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded" />
            <span className="text-xs text-gray-600">Hadir</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded" />
            <span className="text-xs text-gray-600">
              Ada Jadwal (Belum Absen)
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-red-100 border border-red-300 rounded" />
            <span className="text-xs text-gray-600">Alpha</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded" />
            <span className="text-xs text-gray-600">Izin/Sakit</span>
          </div>
        </div>

        {/* Kalender */}
        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-600 text-sm">Memuat data absensi...</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header Hari */}
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
              {hariList.map((hari) => (
                <div
                  key={hari}
                  className="p-3 text-center text-sm font-medium text-gray-700 border-r border-gray-200 last:border-r-0"
                >
                  {hari}
                </div>
              ))}
            </div>

            {/* Tanggal */}
            <div className="grid grid-cols-7">
              {calendar.map((day, index) => (
                <div
                  key={index}
                  className={`min-h-[80px] p-2 border-b border-r border-gray-200 last:border-r-0 ${
                    day ? day.bgColor : 'bg-gray-50'
                  } ${day?.borderColor || ''}`}
                >
                  {day && (
                    <div className="flex flex-col h-full">
                      <div className={`text-sm font-medium mb-1 ${day.textColor}`}>
                        {day.day}
                      </div>
                      {day.hasJadwal && (
                        <div className="mt-auto space-y-1">
                          {day.status && (
                            <div
                              className={`text-xs px-1 py-0.5 rounded ${
                                day.status === 'Hadir'
                                  ? 'bg-blue-200 text-blue-800'
                                  : day.status === 'Alpha'
                                  ? 'bg-red-200 text-red-800'
                                  : 'bg-gray-200 text-gray-800'
                              }`}
                            >
                              {day.status}
                            </div>
                          )}
                          {!day.status && (
                            <div className="text-xs text-yellow-700 bg-yellow-200 px-1 py-0.5 rounded">
                              Belum Absen
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

/* ======================= Mapel Options ======================= */
const MapelOptions = ({ kelas, tanggal }) => {
  const [list, setList] = useState([])

  useEffect(() => {
    if (!kelas) return

    const load = async () => {
      try {
        const hari = tanggal ? getDayName(tanggal) : getDayName(getToday())

        const { data, error } = await supabase
          .from('jadwal')
          .select('mapel, guru_nama, jam_mulai, jam_selesai, hari')
          .eq('kelas_id', kelas)
          .eq('hari', hari)

        if (error) throw error

        const uniqueMap = new Map()
        ;(data || []).forEach((d) => {
          if (!uniqueMap.has(d.mapel)) uniqueMap.set(d.mapel, d)
        })

        const uniqueList = Array.from(uniqueMap.values()).sort((a, b) =>
          a.mapel.localeCompare(b.mapel)
        )
        setList(uniqueList)
      } catch (err) {
        console.error('Error load mapel options:', err)
      }
    }

    load()
  }, [kelas, tanggal])

  return (
    <>
      {list.map((m) => (
        <option key={m.mapel} value={m.mapel}>
          {m.mapel} {m.guru_nama ? `(${m.guru_nama})` : ''} - {m.jam_mulai}-
          {m.jam_selesai}
        </option>
      ))}
    </>
  )
}

/* ======================= MAIN COMPONENT ======================= */
export default function SAbsensi() {
  const { profile, user } = useAuthStore()
  const { pushToast } = useUIStore()
  const userId = profile?.id || user?.id

  // State utama
  const [currentTime, setCurrentTime] = useState(new Date())
  const [currentDateTime, setCurrentDateTime] = useState(getCurrentDateTime())

  const [tab, setTab] = useState('manual')
  const [mapel, setMapel] = useState('')
  const [tgl, setTgl] = useState(getToday())
  const [status, setStatus] = useState(null)
  const [ringkas, setRingkas] = useState({ H: 0, I: 0, A: 0 })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [jadwalHariIni, setJadwalHariIni] = useState([])
  const [jadwalMingguIni, setJadwalMingguIni] = useState({})
  const [currentJadwal, setCurrentJadwal] = useState(null)
  const [currentJadwalIndex, setCurrentJadwalIndex] = useState(-1)
  const [isAbsenOpen, setIsAbsenOpen] = useState(false)

  const [isIzinModalOpen, setIsIzinModalOpen] = useState(false)
  const [izinReason, setIzinReason] = useState('')

  // Statistik kehadiran (HANYA HARI INI)
  const [statistikKehadiran, setStatistikKehadiran] = useState({
    Hadir: 0,
    Izin: 0,
    Alpha: 0
  })

  const [jamKosongList, setJamKosongList] = useState([])
  const [isLoadingJadwalMinggu, setIsLoadingJadwalMinggu] = useState(false)

  // Calendar overlay
  const [showCalendarOverlay, setShowCalendarOverlay] = useState(false)
  const [selectedMapelForCalendar, setSelectedMapelForCalendar] = useState('')

  // RFID
  const [rfidListening, setRfidListening] = useState(false)
  const [rfidSettings, setRfidSettings] = useState({
    rfid_aktif: false,
    rfid_mulai: '07:00',
    rfid_selesai: '15:00'
  })

  // Refs untuk realtime
  const jadwalRef = useRef([])
  const refreshFnsRef = useRef({
    loadRingkasDanStatus: null,
    loadJadwalHariIni: null,
    loadStatistikKehadiran: null
  })
  const rfidChannelRef = useRef(null)
  const mapelRef = useRef(mapel)
  const tglRef = useRef(tgl)
  const currentJadwalRef = useRef(null)
  const statusRef = useRef(status)

  const hariOrder = [
    'Senin',
    'Selasa',
    'Rabu',
    'Kamis',
    'Jumat',
    'Sabtu',
    'Minggu'
  ]

  /* ========== Real-time Clock Global ========== */
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      setCurrentTime(now)
      setCurrentDateTime(getCurrentDateTime())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  /* ========== Load Pengaturan RFID ========== */
  useEffect(() => {
    const loadRfidSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('absensi_rfid_settings')
          .select('*')
          .eq('id', '00000000-0000-0000-0000-000000000001')
          .single()

        if (error && error.code !== 'PGRST116') {
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
        console.error('Failed to load RFID settings:', err)
      }
    }

    loadRfidSettings()
  }, [])

  /* ========== Helper: RFID Time Range ========== */
  const isInRfidTimeRange = useCallback(() => {
    if (!rfidSettings.rfid_aktif) return false

    const now = currentDateTime.minutes
    const [startHour, startMinute] = rfidSettings.rfid_mulai.split(':').map(Number)
    const [endHour, endMinute] = rfidSettings.rfid_selesai.split(':').map(Number)

    const startMinutes = startHour * 60 + startMinute
    const endMinutes = endHour * 60 + endMinute

    return now >= startMinutes && now <= endMinutes
  }, [rfidSettings, currentDateTime])

  const isManualAbsenAllowed = useCallback(() => {
    if (rfidSettings.rfid_aktif && isInRfidTimeRange()) return false
    return true
  }, [rfidSettings, isInRfidTimeRange])

  /* ========== Statistik Kehadiran HARI INI ========== */
  const loadStatistikKehadiran = useCallback(async () => {
    if (!userId) return
    try {
      const today = getToday()

      const { data, error } = await supabase
        .from('absensi')
        .select('status')
        .eq('uid', userId)
        .eq('tanggal', today)

      if (error) throw error

      const statistik = { Hadir: 0, Izin: 0, Alpha: 0 }
      ;(data || []).forEach((item) => {
        if (item.status === 'Hadir') statistik.Hadir++
        else if (item.status === 'Izin' || item.status === 'Sakit') statistik.Izin++
        else if (item.status === 'Alpha') statistik.Alpha++
      })
      setStatistikKehadiran(statistik)
    } catch (error) {
      console.error('Error loading statistik kehadiran:', error)
    }
  }, [userId])

  /* ========== Jam Kosong Hari Ini ========== */
  const loadJamKosongHariIni = useCallback(async () => {
    if (!profile?.kelas) return
    try {
      const { data, error } = await supabase
        .from('jam_kosong')
        .select('*')
        .eq('kelas', profile.kelas)
        .eq('tanggal', getToday())
        .order('jam_mulai')

      if (error) throw error
      setJamKosongList(data || [])
    } catch (error) {
      console.error('Error loading jam kosong:', error)
    }
  }, [profile?.kelas])

  /* ========== Jadwal Hari Ini ========== */
  const loadJadwalHariIni = useCallback(async () => {
    if (!profile?.kelas || !userId) return

    try {
      const hari = getDayName(getToday())

      const { data: jadwalList, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', profile.kelas)
        .eq('hari', hari)
        .order('jam_mulai')

      if (error) throw error

      const { data: settingsList } = await supabase
        .from('absensi_settings')
        .select('*')
        .eq('kelas', profile.kelas)
        .eq('tanggal', getToday())

      const jadwalWithStatus = await Promise.all(
        (jadwalList || []).map(async (jadwalItem) => {
          const settingsForMapel = (settingsList || []).find(
            (s) => s.mapel === jadwalItem.mapel
          )
          const mode = settingsForMapel?.mode || 'manual'

          const { data: absensi } = await supabase
            .from('absensi')
            .select('status')
            .eq('kelas', profile.kelas)
            .eq('tanggal', getToday())
            .eq('mapel', jadwalItem.mapel)
            .eq('uid', userId)
            .maybeSingle()

          const now = currentDateTime.minutes
          const startMinutes = toMinutes(jadwalItem.jam_mulai)
          const endMinutes = toMinutes(jadwalItem.jam_selesai)
          const isOpen = now >= startMinutes && now <= endMinutes

          const jamKosong = jamKosongList.find(
            (jk) => jk.mapel === jadwalItem.mapel
          )

          return {
            ...jadwalItem,
            mode,
            status: absensi?.status || null,
            isOpen,
            jamKosong: jamKosong || null
          }
        })
      )

      const jadwalSorted = jadwalWithStatus.sort(
        (a, b) => toMinutes(a.jam_mulai) - toMinutes(b.jam_mulai)
      )

      setJadwalHariIni(jadwalSorted)

      const nowMinutes = currentDateTime.minutes
      const currentIndex = jadwalSorted.findIndex((jadwal) => {
        const startMinutes = toMinutes(jadwal.jam_mulai)
        const endMinutes = toMinutes(jadwal.jam_selesai)
        return nowMinutes >= startMinutes && nowMinutes <= endMinutes
      })

      if (currentIndex !== -1) {
        setCurrentJadwalIndex(currentIndex)
        const currentJadwalItem = jadwalSorted[currentIndex]
        setCurrentJadwal(currentJadwalItem)
        currentJadwalRef.current = currentJadwalItem
        if (tab === 'manual') setMapel(currentJadwalItem.mapel)
      } else {
        setCurrentJadwalIndex(-1)
        setCurrentJadwal(null)
        currentJadwalRef.current = null
      }
    } catch (error) {
      console.error('Error loading jadwal:', error)
      pushToast('error', 'Gagal memuat jadwal hari ini')
    }
  }, [
    profile?.kelas,
    userId,
    jamKosongList,
    tab,
    pushToast,
    currentDateTime.minutes
  ])

  /* ========== Jadwal Minggu Ini ========== */
  const loadJadwalMingguIni = useCallback(async () => {
    if (!profile?.kelas) return

    setIsLoadingJadwalMinggu(true)
    try {
      const { data: jadwalList, error } = await supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', profile.kelas)
        .order('hari')
        .order('jam_mulai')

      if (error) throw error

      const jadwalByHari = {}
      hariOrder.forEach((hari) => {
        jadwalByHari[hari] = []
      })

      ;(jadwalList || []).forEach((jadwal) => {
        if (jadwalByHari[jadwal.hari]) {
          jadwalByHari[jadwal.hari].push(jadwal)
        }
      })

      Object.keys(jadwalByHari).forEach((hari) => {
        jadwalByHari[hari].sort(
          (a, b) => toMinutes(a.jam_mulai) - toMinutes(b.jam_mulai)
        )
      })

      setJadwalMingguIni(jadwalByHari)
    } catch (error) {
      console.error('Error loading jadwal minggu:', error)
      pushToast('error', 'Gagal memuat jadwal minggu ini')
    } finally {
      setIsLoadingJadwalMinggu(false)
    }
  }, [profile?.kelas, pushToast])

  /* ========== Ringkasan + Status Saya (per mapel & tanggal) ========== */
  const loadRingkasDanStatus = useCallback(async () => {
    if (!profile?.kelas || !userId || !mapel || !tgl) return
    try {
      const { data, error } = await supabase
        .from('absensi')
        .select('uid, status')
        .eq('kelas', profile.kelas)
        .eq('tanggal', tgl)
        .eq('mapel', mapel)

      if (error) throw error

      const agg = { H: 0, I: 0, A: 0 }
      let myStatus = null

      ;(data || []).forEach((row) => {
        if (row.status === 'Hadir') agg.H++
        else if (row.status === 'Izin' || row.status === 'Sakit') agg.I++
        else if (row.status === 'Alpha') agg.A++

        if (row.uid === userId) myStatus = row.status
      })

      setRingkas(agg)
      setStatus(myStatus)
      statusRef.current = myStatus
    } catch (err) {
      console.error('Error loadRingkasDanStatus:', err)
      pushToast('error', 'Gagal memuat data absensi')
    } finally {
      setIsSubmitting(false)
    }
  }, [profile?.kelas, userId, mapel, tgl, pushToast])

  /* ========== Sinkron Refs ========== */
  useEffect(() => {
    jadwalRef.current = jadwalHariIni
  }, [jadwalHariIni])

  useEffect(() => {
    mapelRef.current = mapel
  }, [mapel])

  useEffect(() => {
    tglRef.current = tgl
  }, [tgl])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    refreshFnsRef.current = {
      loadRingkasDanStatus,
      loadJadwalHariIni,
      loadStatistikKehadiran
    }
  }, [loadRingkasDanStatus, loadJadwalHariIni, loadStatistikKehadiran])

  /* ========== Initial Load ========== */
  useEffect(() => {
    loadJadwalHariIni()
    loadStatistikKehadiran()
    loadJamKosongHariIni()
  }, [loadJadwalHariIni, loadStatistikKehadiran, loadJamKosongHariIni])

  /* ========== Jadwal Minggu saat tab "Jadwal" ========== */
  useEffect(() => {
    if (tab === 'jadwal') {
      loadJadwalMingguIni()
    }
  }, [tab, loadJadwalMingguIni])

  /* ========== Saat Mapel Berganti ========== */
  useEffect(() => {
    if (!mapel) {
      setRingkas({ H: 0, I: 0, A: 0 })
      setStatus(null)
      setCurrentJadwal(null)
      return
    }
    loadRingkasDanStatus()
    const jadwal = jadwalHariIni.find((j) => j.mapel === mapel)
    setCurrentJadwal(jadwal || null)
  }, [mapel, loadRingkasDanStatus, jadwalHariIni])

  /* ========== Cek apakah sesi absensi terbuka ========== */
  useEffect(() => {
    const checkAbsenOpen = () => {
      if (!currentJadwal || tgl !== getToday()) {
        setIsAbsenOpen(false)
        return
      }
      const now = currentDateTime.minutes
      const startMinutes = toMinutes(currentJadwal.jam_mulai)
      const endMinutes = toMinutes(currentJadwal.jam_selesai)
      setIsAbsenOpen(now >= startMinutes && now <= endMinutes)
    }

    checkAbsenOpen()
    const interval = setInterval(checkAbsenOpen, 30000)
    return () => clearInterval(interval)
  }, [currentJadwal, tgl, currentDateTime.minutes])

  /* ========== Simpan Absensi ========== */
  const saveAbsensi = async (st, komentar) => {
    const nowIso = new Date().toISOString()
    const payload = {
      kelas: profile.kelas,
      tanggal: tgl,
      uid: userId,
      mapel,
      status: st,
      nama: profile.nama,
      waktu: nowIso,
      komentar,
      oleh: 'siswa'
    }

    const { error } = await supabase.from('absensi').upsert(payload, {
      onConflict: 'kelas,tanggal,mapel,uid'
    })

    if (error) throw error

    setStatus(st)
    statusRef.current = st
    pushToast('success', 'Absensi tersimpan')
    loadRingkasDanStatus()
    loadJadwalHariIni()
    loadStatistikKehadiran()
  }

  /* ========== Ajukan Izin ========== */
  const ajukanIzin = async () => {
    if (!profile?.kelas || !userId || !mapel) {
      pushToast('error', 'Data tidak lengkap')
      return
    }

    try {
      setIsSubmitting(true)
      const { error } = await supabase.from('absensi_ajuan').insert({
        kelas: profile.kelas,
        tanggal: tgl,
        uid: userId,
        nama: profile.nama,
        alasan: izinReason || 'Izin (Tanpa Keterangan)',
        mapel
      })

      if (error) throw error

      pushToast(
        'success',
        'Izin berhasil diajukan, menunggu persetujuan guru'
      )
      setIsIzinModalOpen(false)
      setIzinReason('')
    } catch (err) {
      console.error('Error ajukan izin:', err)
      pushToast('error', 'Gagal mengajukan izin')
    } finally {
      setIsSubmitting(false)
    }
  }

  /* ========== Submit Absensi Manual ========== */
  const submit = async (st) => {
    if (!profile?.kelas || !userId) return
    if (!mapel) {
      pushToast('error', 'Pilih mapel terlebih dahulu')
      return
    }

    if (!isManualAbsenAllowed()) {
      pushToast('error', 'Absensi mandiri ditutup. Silakan gunakan RFID untuk absen.')
      return
    }

    try {
      setIsSubmitting(true)

      if (tgl !== getToday()) {
        if (st === 'Izin') await ajukanIzin()
        else {
          pushToast(
            'error',
            'Untuk tanggal selain hari ini, hanya bisa mengajukan izin'
          )
        }
        return
      }

      if (currentJadwal?.mode !== 'otomatis') {
        pushToast(
          'error',
          'Absensi mandiri belum dibuka. Silakan hubungi guru.'
        )
        return
      }

      const now = currentDateTime.minutes
      const startMinutes = toMinutes(currentJadwal.jam_mulai)
      const endMinutes = toMinutes(currentJadwal.jam_selesai)
      const dalamToleransi = now >= startMinutes && now <= endMinutes + 30

      if (!dalamToleransi && st !== 'Alpha') {
        pushToast(
          'error',
          'Sesi absensi sudah ditutup. Silakan hubungi guru.'
        )
        return
      }

      if (!isAbsenOpen && now > endMinutes + 30) {
        pushToast(
          'error',
          'Sesi absensi sudah ditutup. Silakan hubungi guru.'
        )
        return
      }

      await saveAbsensi(st, `Absen mandiri (${st})`)
    } catch (err) {
      console.error('Error submit absensi siswa:', err)
      pushToast('error', 'Gagal menyimpan absensi')
    } finally {
      setIsSubmitting(false)
    }
  }

  /* ========== Aksi dari Card Jadwal ========== */
  const handleAbsenFromCard = (jadwal) => {
    setMapel(jadwal.mapel)
    setTab('manual')
    setTimeout(() => submit('Hadir'), 100)
  }

  const handleCalendarClick = (jadwal) => {
    setSelectedMapelForCalendar(jadwal.mapel)
    setShowCalendarOverlay(true)
  }

  /* ========== Realtime Listener Absensi & Settings ========== */
  useEffect(() => {
    if (!profile?.kelas || !userId) return

    const channels = []

    // Absensi pribadi
    const absensiChannel = supabase
      .channel(`absensi-realtime-siswa-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `uid=eq.${userId}`
        },
        () => {
          loadRingkasDanStatus()
          loadJadwalHariIni()
          loadStatistikKehadiran()
        }
      )
      .subscribe()
    channels.push(absensiChannel)

    // Ajuan pribadi
    const ajuanChannel = supabase
      .channel(`ajuan-realtime-siswa-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_ajuan',
          filter: `uid=eq.${userId}`
        },
        () => {
          loadJadwalHariIni()
        }
      )
      .subscribe()
    channels.push(ajuanChannel)

    // Settings absensi kelas
    const settingsChannel = supabase
      .channel(`absensi-settings-${profile.kelas}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_settings',
          filter: `kelas=eq.${profile.kelas}`
        },
        () => {
          loadJadwalHariIni()
        }
      )
      .subscribe()
    channels.push(settingsChannel)

    // Ringkasan absensi kelas (untuk update ringkas)
    const ringkasanChannel = supabase
      .channel(`absensi-ringkasan-${profile.kelas}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `kelas=eq.${profile.kelas}`
        },
        (payload) => {
          if (payload.new.mapel === mapel && payload.new.tanggal === tgl) {
            loadRingkasDanStatus()
          }
        }
      )
      .subscribe()
    channels.push(ringkasanChannel)

    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel)
      })
    }
  }, [
    profile?.kelas,
    userId,
    mapel,
    tgl,
    loadRingkasDanStatus,
    loadJadwalHariIni,
    loadStatistikKehadiran
  ])

  /* ========== Realtime Pengaturan RFID ========== */
  useEffect(() => {
    const channel = supabase
      .channel('rfid-settings-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_rfid_settings',
          filter: 'id=eq.00000000-0000-0000-0000-000000000001'
        },
        (payload) => {
          if (payload.new) {
            setRfidSettings({
              rfid_aktif: payload.new.rfid_aktif || false,
              rfid_mulai: payload.new.rfid_mulai || '07:00',
              rfid_selesai: payload.new.rfid_selesai || '15:00'
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  /* ========== Realtime RFID Scan ========== */
  useEffect(() => {
    if (!profile?.rfid_uid || !userId) return

    const cardUid = (profile.rfid_uid || '')
      .toUpperCase()
      .replace(/\s+/g, '')
    if (!cardUid) return

    const handleRfidEvent = async (payload) => {
      const scan = payload.new
      const scanTime = scan.created_at ? new Date(scan.created_at) : new Date()
      const todayKey = getToday()
      const scanDateKey = scanTime.toISOString().slice(0, 10)

      if (scanDateKey !== todayKey) return

      if (!rfidSettings.rfid_aktif) {
        pushToast('warning', 'Kartu RFID terbaca, tetapi fitur RFID sedang non-aktif.')
        return
      }

      if (!isInRfidTimeRange()) {
        pushToast(
          'warning',
          'Kartu RFID terbaca, tetapi di luar waktu yang ditentukan untuk absensi RFID.'
        )
        return
      }

      const scanMinutes = scanTime.getHours() * 60 + scanTime.getMinutes()
      const jadwalList = jadwalRef.current || []
      const jadwalAktif = jadwalList.find((j) => {
        const start = toMinutes(j.jam_mulai)
        const end = toMinutes(j.jam_selesai)
        return scanMinutes >= start && scanMinutes <= end
      })

      if (!jadwalAktif) {
        pushToast(
          'warning',
          'Kartu RFID terbaca, tetapi tidak ada jadwal pelajaran yang aktif.'
        )
        return
      }

      if (jadwalAktif.mode !== 'otomatis') {
        pushToast(
          'warning',
          `Scan RFID untuk ${jadwalAktif.mapel}, tetapi mode absensi masih MANUAL.`
        )
        return
      }

      try {
        const nowIso = new Date().toISOString()
        const payloadAbsensi = {
          kelas: profile.kelas,
          tanggal: todayKey,
          uid: userId,
          mapel: jadwalAktif.mapel,
          status: 'Hadir',
          nama: profile.nama,
          waktu: nowIso,
          komentar: `Absen via RFID (${scan.device_id || 'device'})`,
          oleh: 'rfid'
        }

        const { error } = await supabase
          .from('absensi')
          .upsert(payloadAbsensi, {
            onConflict: 'kelas,tanggal,mapel,uid'
          })

        if (error) {
          console.error('[RFID-SISWA] Error upsert absensi:', error)
          pushToast('error', 'Gagal menyimpan absensi dari RFID')
          return
        }

        try {
          await supabase
            .from('rfid_scans')
            .update({ status: 'processed' })
            .eq('id', scan.id)
        } catch (e) {
          console.warn('Gagal update status rfid_scans:', e)
        }

        setStatus('Hadir')
        setTgl(todayKey)
        setMapel(jadwalAktif.mapel)

        const idx = jadwalList.findIndex((j) => j.mapel === jadwalAktif.mapel)
        if (idx !== -1) {
          setCurrentJadwalIndex(idx)
          setCurrentJadwal(jadwalList[idx])
        }

        pushToast(
          'success',
          `Absensi berhasil melalui kartu RFID (${jadwalAktif.mapel})`
        )

        const {
          loadRingkasDanStatus: refreshRingkas,
          loadJadwalHariIni: refreshJadwal,
          loadStatistikKehadiran: refreshStatistik
        } = refreshFnsRef.current

        if (refreshRingkas) refreshRingkas()
        if (refreshJadwal) refreshJadwal()
        if (refreshStatistik) refreshStatistik()
      } catch (err) {
        console.error('[RFID-SISWA] Error handle scan:', err)
        pushToast('error', 'Terjadi kesalahan saat memproses RFID')
      }
    }

    const channel = supabase
      .channel(`rfid-absen-siswa-${cardUid}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'rfid_scans',
          filter: `card_uid=eq.${cardUid}`
        },
        handleRfidEvent
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRfidListening(true)
        else if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          setRfidListening(false)
        }
      })

    rfidChannelRef.current = channel
    return () => {
      setRfidListening(false)
      if (rfidChannelRef.current) supabase.removeChannel(rfidChannelRef.current)
    }
  }, [
    profile?.rfid_uid,
    profile?.kelas,
    profile?.nama,
    userId,
    pushToast,
    rfidSettings,
    isInRfidTimeRange
  ])

  /* ========== Loading Profile ========== */
  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center max-w-md w-full">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Memuat data...</p>
        </div>
      </div>
    )
  }

  /* ======================= RENDER ======================= */
  return (
    <div className="min-h-screen bg-gray-50 py-4">
      <div className="w-full px-3 sm:px-4 lg:px-5 space-y-4">
        {/* Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Absensi Siswa</h1>
                <p className="text-gray-600 text-sm mt-1">
                  {profile.kelas} • {profile.nama}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Rekap Kehadiran <span className="font-semibold">Hari Ini</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              {/* Statistik Kehadiran HARI INI */}
              <div className="flex gap-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">
                    {statistikKehadiran.Hadir}
                  </div>
                  <div className="text-xs text-gray-600 font-medium">Hadir</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">
                    {statistikKehadiran.Izin}
                  </div>
                  <div className="text-xs text-gray-600 font-medium">Izin/Sakit</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600">
                    {statistikKehadiran.Alpha}
                  </div>
                  <div className="text-xs text-gray-600 font-medium">Alpha</div>
                </div>
              </div>

              {/* Jam Realtime + info RFID */}
              <div className="flex flex-col gap-1">
                <RealTimeClock />
                {profile?.rfid_uid && (
                  <div className="text-xs text-gray-600 bg-white rounded px-2 py-1 border border-gray-300 flex items-center gap-1">
                    <span className="text-green-600">💳</span>
                    <div className="flex-1">
                      <div className="font-medium">
                        RFID: {(profile.rfid_uid || '').toUpperCase()}
                      </div>
                      <div
                        className={`text-[10px] ${
                          rfidListening ? 'text-green-600' : 'text-red-500'
                        }`}
                      >
                        {rfidListening ? 'Siap scan' : 'Tidak terhubung'}
                      </div>
                      {rfidSettings.rfid_aktif && (
                        <div className="text-[10px] text-blue-600 font-medium">
                          Mode RFID:{' '}
                          {isInRfidTimeRange() ? 'AKTIF' : 'NON-AKTIF'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <div className="flex gap-1 px-3">
              <button
                className={`px-3 py-2 font-medium border-b-2 transition-all duration-200 flex items-center space-x-1 text-sm ${
                  tab === 'manual'
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setTab('manual')}
              >
                <span>📝</span>
                <span>Absen Manual</span>
              </button>
              <button
                className={`px-3 py-2 font-medium border-b-2 transition-all duration-200 flex items-center space-x-1 text-sm ${
                  tab === 'jadwal'
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setTab('jadwal')}
              >
                <span>📅</span>
                <span>Jadwal</span>
              </button>
            </div>
          </div>

          <div className="p-3">
            {/* === TAB MANUAL === */}
            {tab === 'manual' && (
              <div className="space-y-4">
                {/* Filter */}
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <h3 className="font-semibold text-sm mb-2 text-gray-800 flex items-center space-x-1">
                    <span>🔍</span>
                    <span>Pilih Mapel & Tanggal</span>
                  </h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Tanggal Absen
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
                          value={tgl}
                          onChange={(e) => setTgl(e.target.value)}
                          max={getToday()}
                        />
                        <button
                          type="button"
                          onClick={() => setTgl(getToday())}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm shadow-sm whitespace-nowrap"
                        >
                          Hari Ini
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Mata Pelajaran
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-sm"
                        value={mapel}
                        onChange={(e) => setMapel(e.target.value)}
                      >
                        <option value="">— Pilih Mapel —</option>
                        {profile?.kelas && (
                          <MapelOptions kelas={profile.kelas} tanggal={tgl} />
                        )}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Status Sesi */}
                {currentJadwal && tgl === getToday() && (
                  <div
                    className={`rounded-lg p-3 border transition-all duration-200 ${
                      isAbsenOpen && currentJadwal.mode === 'otomatis'
                        ? 'bg-green-50 border-green-300 text-green-800'
                        : currentJadwalIndex !== -1
                        ? 'bg-blue-50 border-blue-300 text-blue-800'
                        : 'bg-gray-50 border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-semibold text-sm flex items-center space-x-1">
                          <span>📚</span>
                          <span>{currentJadwal.mapel}</span>
                          {currentJadwalIndex !== -1 && (
                            <Badge variant="live" className="text-xs">
                              JADWAL SAAT INI
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs mt-1 space-y-1">
                          <div className="flex items-center space-x-1">
                            <span className="font-medium">Jam:</span>
                            <span>
                              {currentJadwal.jam_mulai} -{' '}
                              {currentJadwal.jam_selesai}
                            </span>
                          </div>
                          {currentJadwal.guru_nama && (
                            <div className="flex items-center space-x-1">
                              <span className="font-medium">Guru:</span>
                              <span>{currentJadwal.guru_nama}</span>
                            </div>
                          )}
                          <div className="flex items-center space-x-1">
                            <span className="font-medium">Mode:</span>
                            <Badge
                              variant={
                                currentJadwal.mode === 'otomatis'
                                  ? 'hadir'
                                  : 'info'
                              }
                            >
                              {currentJadwal.mode === 'otomatis'
                                ? 'Otomatis'
                                : 'Manual'}
                            </Badge>
                          </div>
                          {rfidSettings.rfid_aktif && (
                            <div className="flex items-center space-x-1">
                              <span className="font-medium">RFID:</span>
                              <Badge
                                variant={
                                  isInRfidTimeRange() ? 'live' : 'warning'
                                }
                              >
                                {isInRfidTimeRange()
                                  ? 'AKTIF'
                                  : 'NON-AKTIF'}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                      {tgl === getToday() && (
                        <>
                          {isAbsenOpen && currentJadwal.mode === 'otomatis' ? (
                            <Badge variant="live" className="text-xs">
                              <div className="flex items-center space-x-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                <span>SESI DIBUKA</span>
                              </div>
                            </Badge>
                          ) : currentJadwalIndex !== -1 ? (
                            <Badge variant="info" className="text-xs">
                              JADWAL AKTIF
                            </Badge>
                          ) : (
                            <Badge variant="warning" className="text-xs">
                              {currentJadwal.mode === 'manual'
                                ? 'MODE MANUAL'
                                : 'SESI DITUTUP'}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Tombol Absensi – versi kecil */}
                <div className="bg-white rounded-lg p-3 border border-gray-200">
                  <h3 className="font-semibold text-sm mb-3 text-gray-800 flex items-center space-x-1">
                    <span>🎯</span>
                    <span>Aksi Absensi</span>
                    {status && (
                      <Badge
                        variant={
                          status === 'Hadir'
                            ? 'hadir'
                            : status === 'Izin' || status === 'Sakit'
                            ? 'izin'
                            : 'alpha'
                        }
                        className="ml-1"
                      >
                        Status: {status}
                      </Badge>
                    )}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {/* Hadir */}
                    <button
                      className={`w-full px-2 py-2 rounded-md border text-xs font-medium transition-all duration-200 ${
                        !mapel ||
                        status ||
                        isSubmitting ||
                        !isAbsenOpen ||
                        currentJadwal?.mode !== 'otomatis' ||
                        !isManualAbsenAllowed()
                          ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                          : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100 hover:border-green-400'
                      }`}
                      disabled={
                        !mapel ||
                        !!status ||
                        isSubmitting ||
                        !isAbsenOpen ||
                        currentJadwal?.mode !== 'otomatis' ||
                        !isManualAbsenAllowed()
                      }
                      onClick={() => submit('Hadir')}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-sm">✅</div>
                        <div className="font-semibold text-[11px]">Hadir</div>
                        <div className="text-[10px] opacity-75 text-center">
                          {!isManualAbsenAllowed()
                            ? 'Hanya via RFID'
                            : 'Tandai kehadiran'}
                        </div>
                      </div>
                    </button>

                    {/* Ajukan Izin */}
                    <button
                      className={`w-full px-2 py-2 rounded-md border text-xs font-medium transition-all duration-200 ${
                        !mapel || status || isSubmitting
                          ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                          : 'bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100 hover:border-yellow-400'
                      }`}
                      disabled={!mapel || !!status || isSubmitting}
                      onClick={() => setIsIzinModalOpen(true)}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-sm">📝</div>
                        <div className="font-semibold text-[11px]">
                          Ajukan Izin
                        </div>
                        <div className="text-[10px] opacity-75 text-center">
                          Dengan alasan
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Info RFID */}
                  {rfidSettings.rfid_aktif && (
                    <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center space-x-2 text-xs text-blue-700">
                        <span>💡</span>
                        <span>
                          <strong>Mode RFID Aktif:</strong>{' '}
                          {isInRfidTimeRange()
                            ? `Absensi hanya via RFID (${rfidSettings.rfid_mulai} - ${rfidSettings.rfid_selesai})`
                            : 'Di luar waktu RFID, absensi manual diperbolehkan'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ringkasan kelas (hanya siswa yang sudah absen/izin/alpha/sakit) */}
                <div className="bg-white rounded-lg p-3 border border-gray-200">
                  <h3 className="font-semibold text-sm mb-2 text-gray-800 flex items-center space-x-1">
                    <span>📊</span>
                    <span>Ringkasan Kehadiran Kelas</span>
                    <Badge variant="live" className="ml-1">
                      Live
                    </Badge>
                  </h3>

                  {/* Statistik ringkas */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="text-center p-3 bg-green-50 border border-green-300 rounded-lg">
                      <div className="text-lg font-bold text-green-700">
                        {ringkas.H}
                      </div>
                      <div className="text-xs text-green-600 font-medium mt-1">
                        Hadir
                      </div>
                    </div>
                    <div className="text-center p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
                      <div className="text-lg font-bold text-yellow-700">
                        {ringkas.I}
                      </div>
                      <div className="text-xs text-yellow-600 font-medium mt-1">
                        Izin/Sakit
                      </div>
                    </div>
                    <div className="text-center p-3 bg-red-50 border border-red-300 rounded-lg">
                      <div className="text-lg font-bold text-red-700">
                        {ringkas.A}
                      </div>
                      <div className="text-xs text-red-600 font-medium mt-1">
                        Alpha
                      </div>
                    </div>
                  </div>

                  {/* Tabel detail siswa (realtime, hanya yang sudah punya record absensi) */}
                  <RingkasanKelasTable
                    kelas={profile?.kelas}
                    mapel={mapel}
                    tanggal={tgl}
                  />
                </div>
              </div>
            )}

            {/* === TAB JADWAL === */}
            {tab === 'jadwal' && (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <h3 className="font-semibold text-sm mb-1 text-gray-800 flex items-center space-x-1">
                    <span>📅</span>
                    <span>Jadwal Pelajaran Minggu Ini</span>
                  </h3>
                  <p className="text-gray-600 text-xs font-medium">
                    {getDayName(getToday())},{' '}
                    {new Date().toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </p>
                </div>

                {isLoadingJadwalMinggu ? (
                  <div className="text-center py-8">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-gray-600 text-sm">Memuat jadwal...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hariOrder.map((hari) => {
                      const jadwalHari = jadwalMingguIni[hari] || []
                      const isHariIni = hari === getDayName(getToday())

                      return (
                        <div
                          key={hari}
                          className="border border-gray-200 rounded-lg overflow-hidden"
                        >
                          <div
                            className={`px-4 py-3 border-b ${
                              isHariIni
                                ? 'bg-blue-50 border-blue-200'
                                : 'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <h3
                                className={`font-semibold ${
                                  isHariIni
                                    ? 'text-blue-800'
                                    : 'text-gray-700'
                                }`}
                              >
                                {hari}
                              </h3>
                              {isHariIni && (
                                <Badge variant="live" className="text-xs">
                                  HARI INI
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="p-4">
                            {jadwalHari.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {jadwalHari.map((jadwal) => {
                                  const isCurrent =
                                    isHariIni &&
                                    jadwalHariIni.find((j) => j.id === jadwal.id) ===
                                      currentJadwal
                                  return (
                                    <JadwalCard
                                      key={jadwal.id}
                                      jadwal={jadwal}
                                      currentTime={currentTime}
                                      isCurrent={isCurrent}
                                      onAbsenClick={handleAbsenFromCard}
                                      onCalendarClick={handleCalendarClick}
                                    />
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-6 text-gray-500">
                                <div className="w-12 h-12 mx-auto mb-2 bg-gray-100 rounded-full flex items-center justify-center">
                                  <svg
                                    className="w-6 h-6 text-gray-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={1}
                                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                    />
                                  </svg>
                                </div>
                                <div className="font-medium text-gray-600">
                                  Tidak ada jadwal untuk hari {hari}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Izin */}
      {isIzinModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg p-4 w-full max-w-md shadow-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-yellow-100 rounded flex items-center justify-center text-yellow-600 text-sm">
                📝
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">
                  Ajukan Izin
                </div>
                <div className="text-gray-500 text-xs">
                  Masukkan alasan izin Anda
                </div>
              </div>
            </div>

            <div className="mb-3 space-y-2">
              <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                <span className="font-medium">Mapel:</span> {mapel}
              </div>
              <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                <span className="font-medium">Tanggal:</span> {tgl}
              </div>
              <textarea
                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 resize-none bg-white text-xs"
                placeholder="Contoh: Sakit, acara keluarga, izin sakit, dll."
                value={izinReason}
                onChange={(e) => setIzinReason(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-all duration-200 font-medium text-xs"
                onClick={() => setIsIzinModalOpen(false)}
              >
                Batal
              </button>
              <button
                className={`px-3 py-1 rounded font-medium transition-all duration-200 text-xs ${
                  isSubmitting
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
                onClick={ajukanIzin}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Mengirim...</span>
                  </div>
                ) : (
                  'Ajukan Izin'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Overlay */}
      {showCalendarOverlay && (
        <CalendarOverlay
          mapel={selectedMapelForCalendar}
          jadwalMingguIni={jadwalMingguIni}
          onClose={() => setShowCalendarOverlay(false)}
          profile={profile}
          userId={userId}
        />
      )}
    </div>
  )
}